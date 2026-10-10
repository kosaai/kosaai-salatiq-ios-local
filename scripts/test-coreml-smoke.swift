import CoreML
import Foundation

// Real Apple-framework compilation/loading/inference gate for the IPA build.
// Input is deterministic and its expected probabilities come from best.pt.
let package = URL(fileURLWithPath: CommandLine.arguments[1])
let referenceURL = URL(fileURLWithPath: CommandLine.arguments[2])
let reference = try JSONSerialization.jsonObject(with: Data(contentsOf: referenceURL)) as! [String: Any]
let expected = reference["pytorch_probabilities"] as! [Double]
let compiled = try MLModel.compileModel(at: package)
let configuration = MLModelConfiguration()
configuration.computeUnits = .all
let model = try MLModel(contentsOf: compiled, configuration: configuration)
let input = try MLMultiArray(shape: [1, 3, 224, 224], dataType: .float32)
let floats = input.dataPointer.assumingMemoryBound(to: Float.self)
for i in 0..<input.count { floats[i] = Float(i % 251) / 250 }
let features = try MLDictionaryFeatureProvider(dictionary: ["images": MLFeatureValue(multiArray: input)])
let prediction = try model.prediction(from: features)
guard let probabilities = prediction.featureValue(for: "probabilities")?.multiArrayValue, probabilities.count == 4 else {
  fatalError("Invalid Core ML output")
}
let actual = (0..<4).map { probabilities[$0].doubleValue }
precondition(actual.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 })
precondition(abs(actual.reduce(0, +) - 1) < 0.005)
let error = zip(actual, expected).map { pair in abs(pair.0 - pair.1) }.max()!
precondition(error < 0.01, "Core ML differs from original PyTorch: \(error)")
precondition(actual.firstIndex(of: actual.max()!) == expected.firstIndex(of: expected.max()!))
print("PASS: real Apple Core ML compile/load/predict, matching original best.pt; maximum probability error \(error)")
