"""Host reference execution of the converted MIL graph (NOT Core ML runtime).

Every op must be supported explicitly; unsupported ops fail instead of being
approximated. Constants are the converted graph's actual FP16 weights.
"""
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from ultralytics.data.augment import classify_transforms


def run(program, array):
    fn = program.functions["main"]
    values = {next(iter(fn.inputs)): torch.from_numpy(array)}

    def get(var):
        if isinstance(var, (list, tuple)):
            return [get(v) for v in var]
        if var.name in values:
            return values[var.name]
        v = var.val
        if isinstance(v, np.ndarray):
            return torch.from_numpy(v.copy()) if v.dtype.kind in "fiu" else v
        return v.item() if isinstance(v, np.generic) else v

    def scalar(v):
        return v.item() if isinstance(v, torch.Tensor) and v.numel() == 1 else v

    def ints(v):
        return [int(i) for i in v]

    for op in fn.operations:
        a = {name: get(var) for name, var in op.inputs.items()}
        kind = op.op_type
        if kind == "const":
            result = get(op.outputs[0])
        elif kind == "cast":
            result = a["x"].to({"fp16": torch.float16, "fp32": torch.float32, "int32": torch.int32}[scalar(a["dtype"])])
        elif kind == "conv":
            x, weight = a["x"], a["weight"]
            pads = ints(a["pad"])
            if scalar(a["pad_type"]) == "same":
                raise AssertionError("Same padding needs explicit reference implementation")
            x = F.pad(x, [pads[2], pads[3], pads[0], pads[1]]) if any(pads) else x
            result = F.conv2d(x, weight, a.get("bias"), stride=ints(a["strides"]), dilation=ints(a["dilations"]), groups=int(scalar(a["groups"])))
        elif kind == "linear": result = F.linear(a["x"], a["weight"], a.get("bias"))
        elif kind == "sigmoid": result = torch.sigmoid(a["x"])
        elif kind == "silu": result = F.silu(a["x"])
        elif kind == "mul": result = a["x"] * a["y"]
        elif kind == "add": result = a["x"] + a["y"]
        elif kind == "sub": result = a["x"] - a["y"]
        elif kind == "real_div": result = a["x"] / a["y"]
        elif kind == "concat": result = torch.cat(a["values"], dim=int(scalar(a["axis"])))
        elif kind == "split": result = torch.split(a["x"], ints(a["split_sizes"]), dim=int(scalar(a["axis"])))
        elif kind == "reshape": result = a["x"].reshape(ints(a["shape"]))
        elif kind == "transpose": result = a["x"].permute(ints(a["perm"]))
        elif kind == "matmul":
            x = a["x"].transpose(-1, -2) if scalar(a["transpose_x"]) else a["x"]
            y = a["y"].transpose(-1, -2) if scalar(a["transpose_y"]) else a["y"]
            result = torch.matmul(x, y)
        elif kind == "softmax": result = torch.softmax(a["x"], dim=int(scalar(a["axis"])))
        elif kind == "reduce_mean": result = torch.mean(a["x"], dim=tuple(ints(a["axes"])), keepdim=bool(scalar(a["keep_dims"])))
        elif kind == "squeeze":
            result = a["x"]
            for axis in sorted(ints(a["axes"]), reverse=True): result = result.squeeze(axis)
        elif kind == "identity": result = a["x"]
        else: raise AssertionError(f"Unsupported converted op: {kind}")
        if len(op.outputs) == 1:
            values[op.outputs[0].name] = result
        else:
            assert len(result) == len(op.outputs)
            values.update({v.name: r for v, r in zip(op.outputs, result)})
    return values[fn.outputs[0].name].float().numpy()


def compare_graph(program, network, images, destination):
    reports = []
    with torch.inference_mode():
        for image_path in images:
            array = classify_transforms(size=224)(Image.open(image_path).convert("RGB")).unsqueeze(0).numpy()
            expected = network(torch.from_numpy(array)).numpy()
            actual = run(program, array)
            assert actual.shape == (1, 4) and np.isfinite(actual).all()
            assert np.allclose(actual.sum(1), 1, atol=0.005)
            assert actual.argmax() == expected.argmax()
            assert np.allclose(actual, expected, atol=0.01, rtol=0.05)
            reports.append({"image": str(image_path), "pytorch": expected.tolist(), "converted_graph_reference": actual.tolist(), "max_abs_error": float(np.abs(actual - expected).max()), "argmax_equal": True})
    report = {"status": "PASS", "method": "FP16 converted MIL graph reference execution using Torch CPU; NOT Apple MLModel inference", "images": reports}
    (Path(destination) / "graph-reference-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
