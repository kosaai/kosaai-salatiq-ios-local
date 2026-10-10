from pathlib import Path

import numpy as np
from PIL import Image

destination = Path(__file__).resolve().parent.parent / 'validation-output/ios-preprocessing'
destination.mkdir(parents=True, exist_ok=True)
for width, height in [(320, 480), (480, 321), (13, 5), (224, 224), (480, 640)]:
    y, x = np.indices((height, width))
    rgb = np.stack(((x * 7 + y * 3) % 256, np.where((x // 3 + y // 5) % 2 == 0, 255, 0), (x * 2 + y * 11) % 256), axis=-1).astype(np.uint8)
    rows = np.full((height, width * 4 + 16), 171, dtype=np.uint8)
    bgra = np.full((height, width, 4), 255, dtype=np.uint8)
    bgra[:, :, :3] = rgb[:, :, ::-1]
    rows[:, :width * 4] = bgra.reshape(height, width * 4)
    resized = (224, 224 * height // width) if width <= height else (224 * width // height, 224)
    image = Image.fromarray(rgb).resize(resized, Image.Resampling.BILINEAR)
    left, top = round((resized[0] - 224) / 2), round((resized[1] - 224) / 2)
    golden = image.crop((left, top, left + 224, top + 224))
    (destination / f'{width}x{height}.bgra').write_bytes(rows.tobytes())
    (destination / f'{width}x{height}.rgb').write_bytes(golden.tobytes())
print('Independent PIL oracle fixtures prepared:', destination)
