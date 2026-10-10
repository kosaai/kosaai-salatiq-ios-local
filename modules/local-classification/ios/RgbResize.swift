import Foundation

// Ultralytics classify_transforms: RGB PIL bilinear short-edge resize to 224,
// center crop with round-to-even coordinates, then ToTensor (/255), NCHW.
// The export consumes FLOAT32 NCHW, unlike the Android NHWC TFLite model.
final class RgbResize {
  private struct Tap { let start: Int; let weights: [Float] }
  private var width = 0
  private var height = 0
  private var horizontal: [UInt8] = []
  private var xTaps: [Tap] = []
  private var yTaps: [Tap] = []
  func write(pixels: UnsafePointer<UInt8>, width w: Int, height h: Int, rowBytes: Int,
             floats: UnsafeMutablePointer<Float>, strides: [Int]) {
    if w != width || h != height {
      width = w; height = h
      let resizedWidth = w <= h ? 224 : 224 * w / h
      let resizedHeight = h <= w ? 224 : 224 * h / w
      let left = Int((Double(resizedWidth - 224) / 2).rounded(.toNearestOrEven))
      let top = Int((Double(resizedHeight - 224) / 2).rounded(.toNearestOrEven))
      xTaps = taps(w, resizedWidth, left)
      yTaps = taps(h, resizedHeight, top)
      horizontal = [UInt8](repeating: 0, count: h * 224 * 3)
    }
    // BGRA input converted to RGB by explicit channel offsets. Honor row stride.
    let channels = [2, 1, 0]
    for y in 0..<h {
      for x in 0..<224 {
        let tap = xTaps[x]
        for c in 0..<3 {
          var sum: Float = 0
          for i in tap.weights.indices {
            sum += Float(pixels[y * rowBytes + (tap.start + i) * 4 + channels[c]]) * tap.weights[i]
          }
          horizontal[(y * 224 + x) * 3 + c] = UInt8(max(0, min(255, Int(sum.rounded()))))
        }
      }
    }
    for y in 0..<224 {
      let tap = yTaps[y]
      for x in 0..<224 {
        for c in 0..<3 {
          var sum: Float = 0
          for i in tap.weights.indices {
            sum += Float(horizontal[((tap.start + i) * 224 + x) * 3 + c]) * tap.weights[i]
          }
          floats[c * strides[1] + y * strides[2] + x * strides[3]] = Float(max(0, min(255, Int(sum.rounded())))) / 255
        }
      }
    }
  }

  private func taps(_ source: Int, _ resized: Int, _ crop: Int) -> [Tap] {
    let scale = Double(source) / Double(resized)
    let support = max(1, scale)
    return (0..<224).map { index in
      let center = (Double(crop + index) + 0.5) * scale
      let start = max(0, Int(floor(center - support + 0.5)))
      let end = min(source, max(start + 1, Int(ceil(center + support - 0.5))))
      var weights = (start..<end).map { Float(max(0, 1 - abs((Double($0) + 0.5 - center) / support))) }
      let total = weights.reduce(0, +)
      for i in weights.indices { weights[i] /= total }
      return Tap(start: start, weights: weights)
    }
  }
}
