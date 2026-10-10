"""Actual Apple MLModel load/inference test, with saved PyTorch inputs/outputs.

Use after scripts/convert-coreml.py. Never falls back to a reference evaluator.
"""
import json
import platform
from pathlib import Path

import coremltools as ct
import numpy as np

root = Path(__file__).resolve().parent.parent
model = ct.models.MLModel(str(root / 'modules/local-classification/ios/Resources/best.mlpackage'))
fixtures = root / 'validation-output/coreml'
if platform.system() != 'Darwin':
    # Try the actual API, so a missing runtime cannot be mistaken for success.
    try:
        model.predict({'images': np.load(fixtures / 'input-0.npy')})
    except Exception as error:
        print('FAIL / BLOCKED: actual Apple Core ML load/inference:', error)
        raise SystemExit(2)
    raise AssertionError('Unexpected Apple Core ML runtime on non-Apple host')

results = []
for file in sorted(fixtures.glob('input-*.npy')):
    index = file.stem.split('-')[-1]
    expected = np.load(fixtures / f'pytorch-{index}.npy')
    actual = model.predict({'images': np.load(file)})['probabilities']
    assert expected.argmax() == actual.argmax()
    assert np.allclose(expected, actual, atol=0.01, rtol=0.05)
    results.append({'fixture': index, 'max_abs_error': float(np.abs(actual - expected).max())})
assert results
report = {'status': 'PASS', 'method': 'Apple MLModel loading and real prediction API', 'comparisons': results}
(fixtures / 'apple-runtime-comparison.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
