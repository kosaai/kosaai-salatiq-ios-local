import AVFoundation
import ExpoModulesCore
import UIKit

// All capture state/model access runs on one serial queue. Late frames are
// discarded, with inference capped at 4 Hz and no encoded images/uploads.
final class LocalClassificationView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onCameraReady = EventDispatcher()
  let onCameraUnavailable = EventDispatcher()
  let onPrediction = EventDispatcher()
  let onMountError = EventDispatcher()
  private static let captureQueue = DispatchQueue(label: "com.kosaai.salatiq.front-camera", qos: .userInitiated)
  private let queue = LocalClassificationView.captureQueue
  private let session = AVCaptureSession()
  private var preview: AVCaptureVideoPreviewLayer!
  private var observers: [NSObjectProtocol] = []
  private var classifier: PoseClassifier?
  private var preprocessor: RgbPreprocessor?
  private var configured = false
  private var attached = false
  private var foreground = false
  private var destroyed = false
  private var ready = false
  private var inferenceEnabled = false
  private var sessionId = 0
  private var lastInference: TimeInterval = 0
  // Only accessed on main; prevents two views from starting capture sessions.
  private static weak var owner: LocalClassificationView?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    layer.addSublayer(preview)
    foreground = UIApplication.shared.applicationState == .active
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.setForeground(true)
    })
    observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.setForeground(false)
    })
    observers.append(center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: .main) { [weak self] _ in
      self?.setForeground(false)
    })
    observers.append(center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: .main) { [weak self] _ in
      self?.setForeground(UIApplication.shared.applicationState == .active)
    })
    observers.append(center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: .main) { [weak self] note in
      guard let self else { return }
      let error = note.userInfo?[AVCaptureSessionErrorKey] as? AVError
      if error?.code == .mediaServicesWereReset {
        self.queue.async { [weak self] in
          self?.ready = false
          self?.onCameraUnavailable([:])
          self?.updateSession()
        }
      } else { self.fail(error?.localizedDescription ?? "تعذر تشغيل الكاميرا الأمامية.") }
    })
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    preview.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      if Self.owner === self { Self.owner = nil }
      queue.async { [weak self] in
        guard let self else { return }
        self.attached = false
        self.updateSession()
        // Clear the delegate and inputs on detach, even before ARC deinit, so
        // capture can never keep a removed view/session alive through a cycle.
        self.session.beginConfiguration()
        for output in self.session.outputs {
          (output as? AVCaptureVideoDataOutput)?.setSampleBufferDelegate(nil, queue: nil)
          self.session.removeOutput(output)
        }
        self.session.inputs.forEach { self.session.removeInput($0) }
        self.session.commitConfiguration()
        self.configured = false
        self.classifier = nil
        self.preprocessor = nil
      }
      return
    }
    guard Self.owner == nil || Self.owner === self else {
      fail("الكاميرا الأمامية مستخدمة بالفعل.")
      return
    }
    Self.owner = self
    let active = UIApplication.shared.applicationState == .active
    queue.async { [weak self] in
      self?.attached = true
      self?.foreground = active
      self?.authorize()
    }
  }

  private func authorize() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: updateSession()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
        self?.queue.async { [weak self] in
          if allowed { self?.updateSession() }
          else { self?.fail("اسمح بالوصول إلى الكاميرا الأمامية من الإعدادات.") }
        }
      }
    default: fail("لم يتم السماح بالوصول إلى الكاميرا الأمامية.")
    }
  }

  private func setForeground(_ active: Bool) {
    queue.async { [weak self] in
      self?.foreground = active
      self?.updateSession()
    }
  }

  func setInferenceEnabled(_ enabled: Bool) {
    queue.async { [weak self] in
      self?.inferenceEnabled = enabled
      self?.lastInference = 0
    }
  }

  func setSessionId(_ id: Int) {
    queue.async { [weak self] in
      self?.sessionId = id
      self?.lastInference = 0
    }
  }

  private func updateSession() {
    guard !destroyed else { return }
    if !attached || !foreground {
      if session.isRunning { session.stopRunning() }
      ready = false
      lastInference = 0
      onCameraUnavailable([:])
      return
    }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      fail("اسمح بالوصول إلى الكاميرا الأمامية من الإعدادات.")
      return
    }
    do {
      if !configured { try configure() }
      if !session.isRunning { session.startRunning() }
    } catch { fail(error.localizedDescription) }
  }

  private func configure() throws {
    classifier = try PoseClassifier.shared()
    preprocessor = try RgbPreprocessor()
    // Never discover/select a rear device, and expose no facing/switch API.
    guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
      throw NSError(domain: "Salatiq", code: 10, userInfo: [NSLocalizedDescriptionKey: "لا تتوفر كاميرا أمامية على هذا الجهاز."])
    }
    let input = try AVCaptureDeviceInput(device: camera)
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.sessionPreset = .vga640x480
    guard session.canAddInput(input), session.canAddOutput(output) else {
      throw NSError(domain: "Salatiq", code: 11)
    }
    session.addInput(input)
    session.addOutput(output)
    if let connection = output.connection(with: .video) {
      // Capture connection physically rotates delivered buffers to portrait.
      // Inference is unmirrored; only the selfie preview is mirrored.
      orientPortrait(connection)
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
    configured = true
    DispatchQueue.main.async { [weak self] in
      guard let self, let connection = self.preview.connection else { return }
      self.orientPortrait(connection)
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = true
      }
    }
  }

  private func orientPortrait(_ connection: AVCaptureConnection) {
    // Use AVFoundation's portrait mapping instead of assuming a 90-degree
    // sensor angle for every front-camera model. AVCaptureVideoDataOutput
    // physically rotates its buffers; supported on the iOS 16.4 minimum too.
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard !destroyed, attached, foreground, session.isRunning,
          let classifier, let preprocessor,
          let frame = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    if !ready {
      ready = true
      onCameraReady([:]) // Model loaded AND first actual front-camera frame.
    }
    let now = ProcessInfo.processInfo.systemUptime
    guard inferenceEnabled, now - lastInference >= 0.25 else { return }
    lastInference = now
    do {
      let result = try classifier.classify(preprocessor.prepare(frame))
      onPrediction(["pose": result.pose, "confidence": result.confidence, "sessionId": sessionId])
    } catch { fail(error.localizedDescription) }
  }

  private func fail(_ message: String) {
    queue.async { [weak self] in
      guard let self, !self.destroyed else { return }
      self.ready = false
      self.inferenceEnabled = false
      if self.session.isRunning { self.session.stopRunning() }
      self.onCameraUnavailable([:])
      self.onMountError(["message": message])
    }
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    // No closure captures self here. Finish already-queued capture work, then
    // clear delegate/input/output and stop on the same capture queue.
    let capture = session
    queue.async {
      if capture.isRunning { capture.stopRunning() }
      for output in capture.outputs {
        (output as? AVCaptureVideoDataOutput)?.setSampleBufferDelegate(nil, queue: nil)
      }
      capture.beginConfiguration()
      capture.inputs.forEach { capture.removeInput($0) }
      capture.outputs.forEach { capture.removeOutput($0) }
      capture.commitConfiguration()
    }
  }
}
