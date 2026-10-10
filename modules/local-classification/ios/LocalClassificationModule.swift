import ExpoModulesCore
import Foundation

public final class LocalClassificationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LocalClassification")
    Constant("alertAudioUri") {
      Bundle.main.url(forResource: "subhan_allah", withExtension: "mp3")?.absoluteString ?? ""
    }
    AsyncFunction("checkAvailability") { () -> Bool in
      _ = try PoseClassifier.shared()
      return true
    }
    View(LocalClassificationView.self) {
      Events("onCameraReady", "onCameraUnavailable", "onPrediction", "onMountError")
      Prop("inferenceEnabled") { (view: LocalClassificationView, enabled: Bool) in
        view.setInferenceEnabled(enabled)
      }
      Prop("sessionId") { (view: LocalClassificationView, sessionId: Int) in
        view.setSessionId(sessionId)
      }
    }
  }
}
