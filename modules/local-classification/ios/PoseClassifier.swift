import CoreML
import Foundation

final class PoseClassifier {
  static let poses = ["BOWING", "PROSTRATING", "SITTING", "STANDING"]
  private static let lock = NSLock()
  private static var cached: PoseClassifier?
  let model: MLModel

  static func shared() throws -> PoseClassifier {
    lock.lock()
    defer { lock.unlock() }
    if let cached { return cached }
    let loaded = try PoseClassifier()
    cached = loaded
    return loaded
  }

  private init() throws {
    let host = Bundle(for: PoseClassifier.self)
    guard let bundleURL = host.url(forResource: "SalatiqCoreML", withExtension: "bundle"),
          let bundle = Bundle(url: bundleURL),
          let url = bundle.url(forResource: "best", withExtension: "mlmodelc") else {
      throw NSError(domain: "Salatiq", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bundled compiled Core ML model is missing"])
    }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all
    model = try MLModel(contentsOf: url, configuration: configuration)
    guard let input = model.modelDescription.inputDescriptionsByName["images"]?.multiArrayConstraint,
          input.shape.map({ $0.intValue }) == [1, 3, 224, 224],
          input.dataType == .float32,
          let output = model.modelDescription.outputDescriptionsByName["probabilities"]?.multiArrayConstraint,
          output.shape.map({ $0.intValue }) == [1, 4],
          output.dataType == .float32 else {
      throw NSError(domain: "Salatiq", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unexpected Core ML input/output contract"])
    }
  }

  func classify(_ input: MLMultiArray) throws -> (pose: String, confidence: Double) {
    let features = try MLDictionaryFeatureProvider(dictionary: ["images": MLFeatureValue(multiArray: input)])
    let result = try model.prediction(from: features)
    guard let values = result.featureValue(for: "probabilities")?.multiArrayValue,
          values.count == 4 else {
      throw NSError(domain: "Salatiq", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid Core ML probabilities"])
    }
    let scores = (0..<4).map { values[$0].doubleValue }
    guard scores.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }),
          abs(scores.reduce(0, +) - 1) < 0.02 else {
      throw NSError(domain: "Salatiq", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid Softmax output"])
    }
    var index = 0
    for candidate in 1..<4 where scores[candidate] > scores[index] { index = candidate }
    // Output already contains Softmax. No extra softmax or confidence threshold.
    return (Self.poses[index], scores[index])
  }
}
