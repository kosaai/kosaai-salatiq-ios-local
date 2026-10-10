import CoreML
import CoreVideo
import Foundation

final class RgbPreprocessor {
  private let resize = RgbResize()
  private let input: MLMultiArray

  init() throws {
    input = try MLMultiArray(shape: [1, 3, 224, 224], dataType: .float32)
  }

  func prepare(_ pixelBuffer: CVPixelBuffer) throws -> MLMultiArray {
    guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA else {
      throw NSError(domain: "Salatiq", code: 5, userInfo: [NSLocalizedDescriptionKey: "Expected native BGRA camera frame"])
    }
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else {
      throw NSError(domain: "Salatiq", code: 6)
    }
    resize.write(
      pixels: base.assumingMemoryBound(to: UInt8.self),
      width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer),
      rowBytes: CVPixelBufferGetBytesPerRow(pixelBuffer),
      floats: input.dataPointer.assumingMemoryBound(to: Float.self),
      strides: input.strides.map { $0.intValue }
    )
    return input
  }
}
