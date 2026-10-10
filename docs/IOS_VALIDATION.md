# Independent Salatiq iOS validation — 2026-10-10

## Honest delivery status

The separate source project and bundled Core ML model are implemented. **No
native iPhone application or IPA was built.** The host is Linux aarch64; Xcode,
iPhoneOS SDK, macOS and a physical iPhone are unavailable. The user confirmed
that no Mac build environment can be used. Apple framework typechecking/linking,
`coremlcompiler`, actual `MLModel` prediction and device runtime checks are
blocked. Swift syntax/portable kernel compilation are not iOS native builds.

The desired output `~/Desktop/Salatiq-iOS-test.ipa` does not exist; no synthetic
application, Simulator binary or source archive was packaged as an IPA.

## Copy and Android protection

- Requested Android StudioProjects source did not exist. The user explicitly
  approved `~/Desktop/kosaai-salatiq-android-local` as the source instead.
- Made a complete `cp -a --reflink=auto` copy, including hidden files, source Git
  history, native/resources, node_modules and ignored validation tools, into
  `~/StudioProjects/kosaai-salatiq-ios-local` before modifications.
- All modifications and tool installation are inside the iOS copy.
- Recorded an Android baseline of **104,989 file metadata records** and **156
  tracked-file SHA-256 hashes**, including native code/model/assets/Git state.
- `scripts/verify-android-source-unchanged.py` confirms unchanged file metadata,
  tracked contents, clean Git, and original HEAD
  `8da8a5553836b4b341450f2ca57e46e5e8b1459a`.
- The iOS copy's inherited Android remote was removed; branch is `ios-local`.
  No commits or pushes were made by the iOS task.

## Model inspection/conversion

Original checkpoint: `/home/opc/Desktop/best.pt`, copied exactly into
`model-source/best.pt`. SHA-256:
`e175c18a8e6627c36cc2d8f45eb90a7b80cfc539caf163e16d1d2469bd2c2d09`.

Inspection of checkpoint metadata and the loaded Ultralytics model established
`ClassificationModel`, `yolo26n-cls.yaml`, task `classify`, `imgsz=224`, four
outputs, `Classify` head with Softmax and class order:

| Index | Exact label | iOS/shared pose |
| --- | --- | --- |
| 0 | bowing | BOWING |
| 1 | prostrating | PROSTRATING |
| 2 | sitting | SITTING |
| 3 | standing | STANDING |

Converted output is
`modules/local-classification/ios/Resources/best.mlpackage`, **3,134,282 bytes**
including manifest, protobuf and weight blob. The package uses ML Program,
minimum model target iOS 16; application minimum is iOS 16.4. Input `images` is
FLOAT32 RGB NCHW `[1,3,224,224]`; output `probabilities` is FLOAT32 `[1,4]`;
internal weights/compute are FP16. This model takes a normalized tensor, not a
Core ML image feature. Normalization is applied once in Swift, not by an implicit
image scale/color conversion. Output already has Softmax, and iOS selects argmax
with max probability as confidence, no confidence threshold or new class.

Preprocessing matches installed Ultralytics classification transforms:
unmirrored portrait BGRA buffer -> RGB, antialiased PIL-compatible bilinear
short-edge resize to 224, center crop to 224 with round-to-even crop coordinates,
uint8 rounding after separable passes, `/255`, FLOAT32 NCHW. No ImageNet mean/std,
letterboxing, detection NMS or duplicate Softmax is used.

Tools were pinned to Torch 2.7.0 CPU, torchvision 0.22.0, coremltools 9.0,
Ultralytics 8.4.175, NumPy 1.26.4 and Pillow 12.3.0. Initial latest-NumPy conversion
failed because coremltools attempted scalar conversion of a size-one array;
pinning the compatible NumPy version resolved it. Linux aarch64 lacked wheel
serialization extensions, so Apple's coremltools 9.0 C++ `libmodelpackage` and
`libmilstoragepython` were compiled from source inside `.ios-tools/`. This enables
package serialization, **not Apple's runtime**, which is a separate macOS-only
extension/framework.

### Comparison actually executed

- Used **12 real prayer validation images**, three from each existing dataset
  class, not only an icon or random input.
- Original PyTorch and TorchScript predictions agree exactly on these fixtures.
- Exported, saved, reopened the Core ML package and read its serialized ML
  Program and actual FP16 weights back into a reference evaluator.
- Executed every converted graph operation through explicit Torch CPU reference
  implementations; unsupported operations fail the check.
- All 12 argmax classifications agree with original PyTorch; maximum absolute
  probability difference is **0.003548949956893921**. Tolerance was `atol=0.01`,
  `rtol=0.05`, with explicit equal-argmax and probability-sum checks.
- Results: `validation-output/coreml/graph-reference-comparison.json`; original
  inputs/predictions are saved there for Apple-host comparison. The model
  contract/provenance is included alongside the package.
- **This is reference evaluation of the converted model, not actual Apple
  `MLModel` execution.** `scripts/test-coreml-runtime.py` tried the real API and
  failed/blocked with “Model prediction is only supported on macOS version
  10.13 or later.” Runtime loading/compiled-model inference is not marked passed.

## Native camera and shared logic

The local Expo module has an Apple registration and CocoaPods spec, linking
AVFoundation/CoreML/UIKit/CoreVideo. Apple autolinking resolves
`LocalClassificationModule` and its resource-bearing `LocalClassification` pod.

`LocalClassificationView.swift` selects only
`AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)`.
There is no native facing/switch API or rear-device fallback. The iOS wrapper
does not pass a facing prop; the camera-switch control is absent on iOS.

The capture and preview connections use AVFoundation's `.portrait` orientation
mapping, rather than assuming the same sensor rotation angle for every front
camera. Video-data output physically rotates its BGRA buffers. Mirroring is
explicitly disabled on video-data output and enabled on preview only; inference
therefore observes original unmirrored RGB content. `.portrait` uses the older,
still-supported orientation API for the iOS 16.4 deployment range. Preview uses
aspect-fill, while model preprocessing uses the training center crop.

A shared serial capture queue and front-camera owner prevent concurrent capture
sessions. Frames are dropped when late, no encoding/upload is performed, and
classification is sampled at most every 250 ms. Model/preprocessing buffers are
reused. Only permission-granted/running capture with a loaded validated model
and first actual frame reports camera readiness. Background/interruptions stop
capture and invalidate readiness; detach stops capture, clears delegates and
removes inputs/outputs. Notifications are removed at deinit. Actual camera
correctness/preview accuracy/lifecycle performance remain physical-device work.

`services/prayerEngine.ts`, sequence constants, `services/sahwAudio.ts` and
`hooks/usePrayerSession.ts` remain byte-identical to the Android source. Shared
`receivePrediction`, result-driven 1-second stability, `lastLivePoseRef`, prayer
selection, rak'ahs, contextual stage rules, transition timers, Sahw recovery and
10-second final-tashahhud protection are preserved.

The iOS readiness service loads the local Core ML model. The shared connection
hook gates API URL only on Web, so a null URL cannot block native iOS readiness.
Start requires camera permission, first frame, loaded model, foreground and no
pending countdown/prayer; it runs the original five-second countdown. Background
and native interruptions cancel a pending countdown and pose candidate.

`scripts/test-ios-readiness.cjs` executes the actual local service and connection
hook with simulated native availability, including missing-model failure.
`scripts/test-ios-camera.cjs` executes the real component with simulated native
events/effects/time, verifying permission/model/session gates, no switch,
five-second countdown, one-second stability, 100 duplicate results, stale session
rejection, background result suppression/stability reset and interruption
cancellation. No remote prediction path was invoked. These tests do not establish
physical native camera readiness.

## Audio, UI and resources

Exact source MP3, Arabic UI, prayer selection/cards, fonts, colors, icons and
startup artwork are retained. The iOS source returns the native bundled sound
URL from `Bundle.main`, then reuses Expo Audio's iOS-native player with no download,
loop or network fallback. The identity/history-based event tracker and serialized
one-shot playback queue are unchanged. All five prayer regressions and one-shot
Sahw tests passed; actual hook tests used the iOS file URI with a simulated player.
Physical audible playback/volume is not claimed.

The four pose SVG artworks are embedded byte-for-byte as JS strings for iOS,
avoiding the original local-asset `fetch`/loading path while retaining its crop
and color presentation. The prepared launcher artwork generates a 1024×1024
opaque iPhone icon. Native storyboard/asset colors and the same 1.28-second
React startup animation use exact `salatiq.png` derivatives.

Info.plist has Arabic front-camera text, portrait-only iPhone configuration,
display name **صلاتك** and bundle ID `com.kosaai.salatiq.ioslocal`. Entitlements
are empty. Microphone permission, background recording/playback, iCloud, App
Groups and push are absent. The sound is an Xcode Copy Bundle Resources reference
to the exact MP3, and the Core ML package is a CocoaPods resource-bundle entry
that requires Xcode compilation into `best.mlmodelc`.

## Checks executed and outcomes

| Check | Actual outcome |
| --- | --- |
| TypeScript / Expo lint / diff whitespace | PASS |
| Expo dependency compatibility / autolinking verify | PASS |
| Apple native-module resolution | PASS |
| Expo prebuild iOS / project-resource verification | PASS |
| Swift compiler parsing all native module source | PASS (Linux syntax check only) |
| Actual Swift preprocessing kernel compile/execute | PASS |
| Swift BGRA/stride/RGB/NCHW/resize/crop against independent Pillow | PASS: 5 fixtures; 4 exact, 480×640 max 1 byte, mean 0.00164089 |
| PyTorch / saved converted graph comparison | PASS: 12 images, same classes, max probability error 0.00355 |
| Actual Apple Core ML load/predict API | BLOCKED / FAIL: no Apple runtime |
| All-five prayer logic and Sahw regressions | PASS |
| Actual audio hook with simulated iOS player | PASS |
| Actual iOS readiness service + shared hook/component tests | PASS (native behavior simulated) |
| iOS/Web production JS export | PASS (`--no-bytecode` for host-only verification) |
| iOS exported source map excludes remote services/API URLs | PASS after local SVG embedding |
| Release AppDelegate / bundle build-phase structure | PASS; embedded JS path configured |
| Expo Doctor | 20/21: native/config synchronization advisory; build script always runs prebuild |
| Android source metadata / SHA-256 / Git verification | PASS |
| ARM64 iPhone native build | FAIL / BLOCKED: no macOS/Xcode/iPhoneOS SDK |
| IPA creation / final archive inspection | NOT RUN: no real device .app exists |
| Real iPhone camera/audio/offline/end-to-end run | NOT RUN: no physical iPhone |

The host JS export intentionally disables Hermes bytecode because Apple's Hermes
compiler cannot run here. The actual macOS build script does **not** disable it:
it uses the generated Release `export:embed` phase and the normal iOS Hermes
toolchain. `AppDelegate` uses a Metro URL only under `#if DEBUG`, and loads
`Bundle.main/main.jsbundle` in Release. Export verification is not proof of an
installed app's offline behavior or of final IPA contents.

## Completing the blocked build

`npm run ios:device-ipa` was actually executed and failed clearly at its host
precondition. On macOS/Xcode it regenerates/verifies the project, installs pods,
builds Release for `iphoneos` / `generic/platform=iOS` / ARM64 with signing
disabled, validates the application, and packages `Payload/Salatiq.app`.
Before packaging, the pipeline executes `scripts/test-coreml-smoke.swift` through
macOS `xcrun swift`: it actually compiles/loads the Core ML package and compares
real Apple prediction output for a deterministic tensor with probabilities
computed from the original checkpoint and recorded in
`docs/COREML_SMOKE_REFERENCE.json`. That Apple-framework gate is **not run** on
this Linux host; only its Swift syntax and the original Torch reference were
checked here.
`scripts/verify-ios-ipa.py` then checks device Mach-O platform, bundled JS, compiled
model, native frameworks, MP3 provenance and icon/splash, and prints real size
and SHA-256. Signing is left to SideStore/SideInstaller.

Before claiming a final working IPA, actual Apple model compilation/loading and
inference must pass, the real device build must pass, and its actual archive must
pass inspection. After that, the one physical acceptance scenario is an **offline
front-camera end-to-end prayer session**: upright mirrored preview/unmirrored
classification, permission/readiness/countdown, all prayer poses/Sahw sound,
background/resume and sustained performance. None of these native-device outcomes
was claimed to have been physically tested here.
