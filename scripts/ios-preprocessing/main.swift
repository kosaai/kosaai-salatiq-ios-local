import Foundation

// Compiles with the same portable resize kernel used by real CVPixelBuffer
// preprocessing. Pillow generates independent oracle bytes, including odd crops
// and padded native BGRA row strides.
let root = CommandLine.arguments[1]
let resize = RgbResize()
for (width, height) in [(320, 480), (480, 321), (13, 5), (224, 224), (480, 640)] {
  let name = "\(width)x\(height)"
  let bgra = [UInt8](try Data(contentsOf: URL(fileURLWithPath: "\(root)/\(name).bgra")))
  let expected = [UInt8](try Data(contentsOf: URL(fileURLWithPath: "\(root)/\(name).rgb")))
  var values = [Float](repeating: -1, count: 3 * 224 * 224)
  bgra.withUnsafeBufferPointer { source in
    values.withUnsafeMutableBufferPointer { output in
      resize.write(pixels: source.baseAddress!, width: width, height: height,
                   rowBytes: width * 4 + 16, floats: output.baseAddress!, strides: [3 * 224 * 224, 224 * 224, 224, 1])
    }
  }
  var maxError = 0
  var sumError = 0
  for y in 0..<224 {
    for x in 0..<224 {
      for channel in 0..<3 {
        let actual = values[channel * 224 * 224 + y * 224 + x]
        precondition(actual >= 0 && actual <= 1)
        let error = abs(Int((actual * 255).rounded()) - Int(expected[(y * 224 + x) * 3 + channel]))
        maxError = max(maxError, error)
        sumError += error
      }
    }
  }
  precondition(maxError <= 1, "Preprocessing disagrees with PIL: \(name), \(maxError)")
  precondition(Double(sumError) / Double(expected.count) < 0.02)
  print("PASS \(name): actual Swift BGRA/stride/RGB/NCHW/PIL resize-crop-/255; max byte error \(maxError), mean \(Double(sumError) / Double(expected.count))")
}
