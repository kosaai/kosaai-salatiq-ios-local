"""Export the supplied classification checkpoint and verify its actual contract.

macOS or Linux with coremltools serialization libraries. Apple runtime validation
is performed only on macOS, never claimed from the Linux graph-reference test.
"""
import argparse
import hashlib
import json
import platform
from pathlib import Path

import coremltools as ct
import numpy as np
import torch
from PIL import Image
from ultralytics import YOLO
from ultralytics.data.augment import classify_transforms


class Probabilities(torch.nn.Module):
    def __init__(self, network):
        super().__init__()
        self.network = network

    def forward(self, images):
        result = self.network(images)
        return result[0] if isinstance(result, tuple) else result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--image", type=Path, action="append", default=[])
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    destination = root / "modules/local-classification/ios/Resources"
    destination.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)
    loaded = YOLO(str(args.checkpoint))
    assert loaded.task == "classify", f"Unexpected task: {loaded.task}"
    labels = [loaded.names[i] for i in range(len(loaded.names))]
    assert labels == ["bowing", "prostrating", "sitting", "standing"], labels
    assert loaded.model.args["imgsz"] == 224
    network = Probabilities(loaded.model.float().eval()).eval()
    torch.manual_seed(42)
    sample = torch.rand(1, 3, 224, 224)
    with torch.inference_mode():
        expected = network(sample)
        assert tuple(expected.shape) == (1, 4)
        assert torch.allclose(expected.sum(1), torch.ones(1), atol=1e-5)
        traced = torch.jit.trace(network, sample)
    converted = ct.convert(
        traced,
        inputs=[ct.TensorType(name="images", shape=(1, 3, 224, 224), dtype=np.float32)],
        outputs=[ct.TensorType(name="probabilities", dtype=np.float32)],
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.iOS16,
        compute_precision=ct.precision.FLOAT16,
        skip_model_load=platform.system() != "Darwin",
    )
    converted.short_description = "Salatiq YOLO26n four-pose local classification"
    converted.user_defined_metadata["class_order"] = json.dumps(labels)
    converted.user_defined_metadata["preprocessing"] = "RGB PIL bilinear antialiased short-edge Resize(224), CenterCrop(224), /255, NCHW; no ImageNet mean/std"
    converted.user_defined_metadata["checkpoint_sha256"] = hashlib.sha256(args.checkpoint.read_bytes()).hexdigest()
    converted.save(str(destination / "best.mlpackage"))
    spec = converted.get_spec()
    assert list(spec.description.input[0].type.multiArrayType.shape) == [1, 3, 224, 224]
    assert list(spec.description.output[0].type.multiArrayType.shape) == [1, 4]
    assert spec.description.input[0].type.multiArrayType.dataType == 65568  # FLOAT32
    operations = [op.op_type for fn in converted._mil_program.functions.values() for op in fn.operations]
    assert "softmax" in operations
    # Save true TorchScript predictions and original preprocessing for Apple-host
    # comparison; these are not substitute Core ML runtime results.
    comparison = []
    fixtures = root / "validation-output/coreml"
    fixtures.mkdir(parents=True, exist_ok=True)
    images = args.image or [root / "salatiq.png"]
    for index, image_path in enumerate(images):
        image = Image.open(image_path).convert("RGB")
        tensor = classify_transforms(size=224)(image).unsqueeze(0)
        with torch.inference_mode():
            original = network(tensor).numpy()
            traced_result = traced(tensor).numpy()
        assert np.allclose(original, traced_result, atol=1e-5)
        np.save(fixtures / f"input-{index}.npy", tensor.numpy())
        np.save(fixtures / f"pytorch-{index}.npy", original)
        item = {"image": str(image_path), "pytorch": original.tolist(), "trace_max_abs_error": float(np.abs(original - traced_result).max())}
        if platform.system() == "Darwin":
            coreml = converted.predict({"images": tensor.numpy()})["probabilities"]
            assert original.argmax() == coreml.argmax(), "Classification differs"
            assert np.allclose(original, coreml, atol=0.01, rtol=0.05)
            item.update(coreml=coreml.tolist(), coreml_max_abs_error=float(np.abs(original - coreml).max()))
        comparison.append(item)
    report = {
        "architecture": loaded.model.yaml["yaml_file"], "task": loaded.task,
        "checkpoint_sha256": hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
        "class_order": labels, "ios_poses": [s.upper() for s in labels],
        "input": {"name": "images", "shape": [1, 3, 224, 224], "dtype": "FLOAT32", "color": "RGB", "normalization": "divide by 255; no mean/std"},
        "preprocessing": "Portrait unmirrored BGRA -> RGB; antialiased PIL bilinear short-edge resize to 224; centered 224 crop, round-to-even crop origin",
        "output": {"name": "probabilities", "shape": [1, 4], "dtype": "FLOAT32", "interpretation": "Softmax probabilities; argmax class, max probability confidence; no threshold"},
        "weights": "FLOAT16 internal; FLOAT32 input/output", "minimum_ios_model": 16,
        "versions": {"torch": torch.__version__, "coremltools": ct.__version__},
        "apple_runtime_test": "PASS" if platform.system() == "Darwin" else "NOT RUN: Apple Core ML runtime unavailable on Linux",
        "comparisons": comparison, "operation_types": sorted(set(operations)),
    }
    (destination / "model-contract.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    # Additional verification executes the converted MIL graph on the host using
    # a reference evaluator. This explicitly is not Apple's MLModel runtime.
    from verify_coreml_graph import compare_graph
    saved = ct.models.MLModel(str(destination / "best.mlpackage"), skip_model_load=True)
    from coremltools.converters.mil.frontend.milproto.load import load
    saved_spec = saved.get_spec()
    reloaded_graph = load(saved_spec, saved_spec.specificationVersion, saved.weights_dir)
    compare_graph(reloaded_graph, network, images, fixtures)


if __name__ == "__main__":
    main()
