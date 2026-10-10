# صلاتك — independent iPhone / Core ML version

This is the independent copy at **`~/StudioProjects/kosaai-salatiq-ios-local`**.
The source Android project remains at `~/Desktop/kosaai-salatiq-android-local`
(the user confirmed this actual source because the requested StudioProjects
Android path did not exist). The complete source folder was copied before any
edits; all iOS changes are confined to this copy. Its inherited Android Git remote
was removed and work is on the local `ios-local` branch; nothing was pushed.

## iOS implementation and actual build status

**Implemented:** front-only AVFoundation preview/capture, local Core ML
classification, existing prayer engine/stability/countdown/Sahw rules, exact
bundled Subhan Allah sound, original app icon and 1.28-second startup animation.

**Not built:** this machine is Linux ARM64, with no Xcode, iPhoneOS SDK or
accessible Mac. No valid iPhone `.app` or IPA has been produced. The requested
`~/Desktop/Salatiq-iOS-test.ipa` does not exist. Apple Core ML runtime and native
camera/audio execution remain unverified. See **[actual iOS validation results](docs/IOS_VALIDATION.md)**.

### Local model

The supplied checkpoint is preserved unchanged at `model-source/best.pt`.
The converted model is **`modules/local-classification/ios/Resources/best.mlpackage`**.
Its task is **YOLO26n classification**, not object detection, with these indices:

| Index | Label | Prayer pose |
| --- | --- | --- |
| 0 | bowing | BOWING |
| 1 | prostrating | PROSTRATING |
| 2 | sitting | SITTING |
| 3 | standing | STANDING |

Input is FLOAT32 **RGB NCHW `[1,3,224,224]`**, unlike Android's NHWC tensor.
Native BGRA frames are physically oriented upright portrait and unmirrored for
classification. The real Swift kernel respects row stride, converts BGRA to RGB,
uses antialiased PIL-compatible bilinear short-edge resize to 224, center crop
with round-to-even origin, and divides by 255. No ImageNet mean/std or second
normalization is applied. Output is FLOAT32 `[1,4]` Softmax probabilities with
FP16 internal computation; argmax selects the pose and its probability is
confidence. There is no extra softmax, class, detector postprocessing or threshold.
`model-contract.json` records the inspected contract and checkpoint provenance.

CocoaPods declares the package in the `SalatiqCoreML` resource bundle; Xcode
compiles it to `best.mlmodelc`. `PoseClassifier` loads only that compiled bundled
model, reuses it, validates the actual tensor contract, and permits all Apple
compute units (CPU/GPU/Neural Engine). Camera capture uses a single serial queue
and a single front-camera owner, discards late frames and samples at most 4 Hz.
Preview is mirrored; inference is not. Backgrounding/interruption stops capture,
invalidates readiness/stability and cancels a pending countdown. Detach clears
delegates/inputs/outputs and releases per-view preprocessing resources.

### iPhone device build and re-signable IPA

The generated `ios/` project is included; lasting customization lives in config,
plugins and the local Expo module. The minimum OS is iOS 16.4, bundle identifier
is `com.kosaai.salatiq.ioslocal`, and display name remains **صلاتك**. No iCloud,
App Groups, push, background audio/recording or other restricted entitlement is
enabled. Camera permission text is Arabic and no microphone permission is added.

The following script, when run on macOS with a compatible Xcode and CocoaPods,
performs the work automatically rather than building a Simulator app:

```sh
npm ci
npm run ios:device-ipa
```

It regenerates/verifies the native project, installs pods, builds **Release for
`generic/platform=iOS`, `iphoneos`, ARM64** with Apple signing disabled, and
packages the real application as **`Payload/Salatiq.app`**. Only then does it
write `~/Desktop/Salatiq-iOS-test.ipa` and inspect its device Mach-O, JS/Hermes
bundle, compiled Core ML model, exact MP3, native frameworks and splash/icon
resources. The user can re-sign the unsigned IPA with SideStore/SideInstaller.
Before packaging, it also runs a real Apple-framework model compile/load/predict
smoke test and compares deterministic input against original PyTorch probabilities
in `docs/COREML_SMOKE_REFERENCE.json`.
The script fails before packaging if any build or asset requirement fails.

Release uses the generated Expo `export:embed` build phase and loads
`Bundle.main/main.jsbundle`; Metro is only a development tool. All iOS inference
services are platform-local, with no API URL, backend readiness or uploaded
frames. The Start Prayer button requires permission, first real front-camera
frame, loaded model and foreground readiness, then uses the existing five-second
countdown. Pose icons are embedded SVG strings, so their appearance is preserved
without an asset fetch. Audio uses a `Bundle.main` file URI and the unchanged
one-shot tracker/player queue.

### Reproducible conversion and checks

```sh
python3 -m venv .ios-tools/python
.ios-tools/python/bin/python -m pip install -r scripts/coreml-requirements.txt
.ios-tools/python/bin/python scripts/convert-coreml.py model-source/best.pt --image /path/to/prayer.jpg
.ios-tools/python/bin/python scripts/test-coreml-runtime.py
npm run ios:prepare
npm run typecheck
npm run lint
node scripts/test-ios-readiness.cjs
node scripts/test-ios-camera.cjs
npx tsc services/prayerEngine.ts services/sahwAudio.ts constants/fajrSequence.ts constants/fourRakahSequence.ts constants/maghribSequence.ts --module commonjs --target ES2020 --outDir validation-output/prayer --skipLibCheck --ignoreConfig
node scripts/test-prayer-regression.cjs validation-output/prayer
TEST_PLATFORM=ios node scripts/test-sahw-audio.cjs validation-output/prayer
```

Conversion/runtime comparison automatically uses Apple's prediction API on
macOS. On Linux, it explicitly reports that runtime test as unavailable and
separately compares the **saved/reloaded converted MIL graph** with PyTorch
using a CPU reference evaluator. The latter is not Apple Core ML inference.
The included package was checked on 12 real validation images across all four
poses. All argmax labels agree; maximum probability difference was 0.00355.
Actual Swift preprocessing was compiled/executed against independent Pillow
fixtures on the host, with at most one byte difference and mean error below 0.002.

## Inherited Android reference

The sections below are retained from the original Android project for context.

Independent repository: `kosaai/kosaai-salatiq-android-local`.

Android uses a bundled four-class TFLite model and native CameraX frames. Web
retains its existing `EXPO_PUBLIC_API_URL` backend. Android never calls `/health`
or `/predict` and never uploads classification frames.

## Open in Android Studio

Use Node.js 22.13+ (Node 24 was used for validation), Android Studio with Android
SDK 36, and the JDK supported by the generated Gradle/Android plugin. Install the
NDK version requested by Gradle during sync. From this repository:

```sh
npm ci
npm run android:prepare
npm run typecheck
npm run lint
```

Open the **`android/` directory** in Android Studio, sync Gradle, select an
emulator/device, then build/run `app`. `android:prepare` generates the local
debug signing key and synchronizes config/plugins. It can regenerate the native
project: keep custom camera code in `modules/` and configuration in `plugins/`.
Do not hand-edit generated Android files for lasting changes.

A debug build uses Metro: run `npm start`, and on a USB phone run
`adb reverse tcp:8081 tcp:8081`. This development JS connection is separate from
classification, which always stays on-device. A release build embeds the JS and
model and works without Metro or internet. For local release testing:

```sh
cd android
./gradlew :app:assembleRelease
```

The generated template uses its standard debug signing configuration for local
release testing. Configure your own release signing credentials before publishing.
For the equivalent Windows commands, use `gradlew.bat`.

Expo Go does not contain this local native module. Use the Android Studio build
or `npm run android`.

## Launcher image: exact `salatiq.png`

The launcher uses the user-supplied root **`salatiq.png`**, copied byte-for-byte
to `assets/launcher/source.png`. Its SHA-256 is
`9dbcfd9a0988089d0c8040c0db3100cc3adf522e7aab68d5454a5990cbe54fae`.
Prepared assets and generated native resources are included. To regenerate:

```sh
python -m pip install Pillow
python scripts/prepare-launcher-icon.py salatiq.png
npm run android:prepare
node scripts/verify-android-assets.mjs --require-icon
```

This copies the original bytes to `assets/launcher/source.png`, records its
SHA-256, and derives `icon.png` and `adaptive-foreground.png` without cropping or
changing the aspect ratio. Expo generates `ic_launcher`, `ic_launcher_round`
and `ic_launcher_foreground` in `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}` plus the
adaptive XML resources in `mipmap-anydpi-v26`. There is no substituted monochrome
logo. The background color is sampled from the supplied image.

`app.config.js` selects those prepared assets. The generated Android manifest
references `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`; the adaptive
XML selects the derived foreground and background `#FDFAEC`. The entire square
source is fitted inside the adaptive safe circle, including its corners, so its
artwork/aspect ratio is preserved across launcher masks. Check final size and
appearance on the target launchers.

## Android animated startup

The startup sequence uses **only artwork derived from `salatiq.png`**:
`assets/startup/mark.png` contains the Arabic calligraphic logo;
`assets/startup/name.png` contains its original Latin **Salatiq** wordmark.
The preparation script crops the inspected source and removes the pale paper
backdrop with feathered transparency. Original RGB values, dark/gold artwork,
lettering and aspect ratios are preserved; no replacement font/logo is used.
Source hash and crop bounds are recorded in `assets/startup/provenance.json`.

`expo-splash-screen ~57.0.9` configures the immediate native launch screen with
the same centered mark (184 dp) and cream background `#FDFAEC`, in both Android
light/dark modes. The official plugin generates the Android splash theme,
density images and `MainActivity` registration. The native splash is held until
both local images decode and the app content lays out, then handed off on the
next animation frame to `components/StartupSplash.android.tsx`.

The React Native overlay runs a **1,280 ms**, native-driven sequence:

1. **140 ms:** centered logo only; wordmark opacity is zero.
2. **640 ms:** logo rises about 22 dp while the original wordmark fades in and
   moves **down** by 12 dp; smooth cubic easing, no spring/bounce.
3. **240 ms:** centered final logo-above/name-below composition.
4. **260 ms:** the entire overlay fades away onto the already-mounted app.

Only transform/opacity are animated. Expo Router mounts once beneath the overlay;
navigation, prayer/session/camera state and Sahw playback are not reset at the
transition. The overlay blocks interaction/accessibility with underlying content
until it disappears, and stops/cancels its animation on unmount. System reduced
motion uses the final composition with a short 180 ms fade instead of movement.
The non-Android component renders children normally.

To regenerate the source-derived branding and native resources:

```sh
python scripts/prepare-startup-branding.py
npm run android:prepare
```

Validate the native-to-React handoff in an installed **release build**, including
Android 12+, cold launches in light/dark mode, reduced motion, and activity
recreation. Expo Go/development splash presentation is not representative of the
release splash. Native startup/visual smoothness still requires device testing.

## Bundled one-shot Sahw alert

The exact root **`سبحان الله (1).mp3`** is copied, without transcoding, to
`assets/audio/subhan_allah.mp3`. The configured `expo-asset` plugin embeds it in
**`android/app/src/main/res/raw/subhan_allah.mp3`**, so the installed app contains
the sound. All copies have SHA-256
`d383c705a06644e1b6fb1cff5d0ee568e5a2ba404eee26f590b3b63d7e6fafb7`.
The original MP3 is approximately 1.72 seconds long (44.1 kHz stereo).

`hooks/useSahwAlertAudio.ts` uses the already-installed **`expo-audio ~57.0.5`**:
`useAudioPlayer`, `useAudioPlayerStatus`, `seekTo(0)` and `play()`. Android reads
only `file:///android_res/raw/subhan_allah.mp3`, even in a native debug build;
there is no sound download or HTTP fallback. The player loads on screen mount,
is reused, has looping disabled, and is automatically released on unmount.

The read-only tracker in `services/sahwAudio.ts` claims each new event before
asynchronous playback. Since the existing engine has no event ID, a WeakSet
tracks the stable `activeSahwEvent` object identity within a session. Append-only
`sahwAlerts` history also captures events created and recovered in the same
engine update. A simultaneous activation/history append counts once. Repeated
renders/results and recovery add no sound; a genuinely new activation of the
same type/stage still counts once. Pending sounds are serialized, and a new
session/unmount invalidates pending seeks. Audio never modifies engine state.

Run the engine and one-shot regression checks:

```sh
npx tsc services/prayerEngine.ts services/sahwAudio.ts constants/fajrSequence.ts constants/fourRakahSequence.ts constants/maghribSequence.ts --module commonjs --target ES2020 --outDir validation-output/prayer --skipLibCheck --ignoreConfig
node scripts/test-prayer-regression.cjs validation-output/prayer
node scripts/test-sahw-audio.cjs validation-output/prayer
```

The audio test checks real engine identities/events and runs the actual hook
with simulated effects/player. Audible playback, volume, timing and native
lifecycle still require a physical device. The APK verifier below checks the
exact bundled MP3 as well as the model.

## Model and native pipeline

- Original build source: `salatiq_yolo26n_cls_fp16.tflite` (3,106,940 bytes).
- Application asset: **`android/app/src/main/assets/salatiq_yolo26n_cls_fp16.tflite`**.
- APK entry: **`assets/salatiq_yolo26n_cls_fp16.tflite`**.
- AAB entry: **`base/assets/salatiq_yolo26n_cls_fp16.tflite`**.
- SHA-256: `884c2a67eeb20a38e9125faa66bc49a553b983563119e663a385862b4061dea6`.
- `withLocalClassification` copies the model during prebuild and configures
  `noCompress` for `.tflite`; runtime memory-maps `context.assets.openFd(...)`.
- Native dependencies: **`com.google.ai.edge.litert:litert:1.4.2`**, the maintained
  standalone Interpreter API, and **CameraX 1.6.0**, matching Expo Camera SDK 57.
  No Google Play runtime initialization, model download or API fallback.

The model has **FP16 internal weights**, **FLOAT32 input `[1,224,224,3]` NHWC**,
and **FLOAT32 Softmax output `[1,4]`**. The interpreter verifies actual tensor
types/shapes when opened. It is created once per active classification session,
reused on a single background executor with two inference threads, and closed
on session stop, backgrounding, detach or view destruction.

CameraX supplies native `YUV_420_888` frames near 640×480. Inference is sampled
at most once every **250 ms**, with `KEEP_ONLY_LATEST` backpressure. Every frame
is closed in `finally`; no bitmap/JPEG/Base64/file upload is used. Only pose,
confidence and session ID reach JavaScript.

### Preprocessing

The verified Ultralytics classification inference transform is
`Resize(shortest_edge=224, BILINEAR) → CenterCrop(224) → ToTensor → Normalize`.
Its mean is `(0,0,0)` and std is `(1,1,1)`:

1. Respect CameraX crop rectangle and each Y/U/V plane's row/pixel stride.
2. Convert limited-range BT.601 YUV to 8-bit RGB.
3. Apply `ImageInfo.rotationDegrees` (0/90/180/270) to produce upright pixels.
   Front preview is mirrored; classification sees the unmirrored scene.
4. Preserve aspect ratio; resize the shortest edge to 224 and truncate the
   proportional long dimension as torchvision does.
5. Use separable bilinear interpolation, with a scale-aware antialias filter
   during downsampling. Center crop to 224×224 with round-to-even crop origins.
   This matches the Pillow reference within one 8-bit channel level; not a claim
   of bit-identical Pillow fixed-point arithmetic on every pixel.
6. Normalize each RGB channel as `value / 255.0f`; no ImageNet mean/std.
7. Write interleaved RGB, row-major **FLOAT32 NHWC `[1,224,224,3]`** into a reused
   native-order direct buffer. No FLOAT16 image input.

Sources inspected:
- [Ultralytics v8.4.0 classify_transforms and defaults](https://github.com/ultralytics/ultralytics/blob/v8.4.0/ultralytics/data/augment.py)
- [Current classification predictor](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/models/yolo/classify/predict.py)
- [CameraX image analysis](https://developer.android.com/media/camera/camerax/analyze)
- [LiteRT standalone Android APIs](https://ai.google.dev/edge/litert/android)

### Authoritative mapping and prayer integration

| Index | Original class | Application pose |
| --- | --- | --- |
| 0 | bowing | BOWING |
| 1 | prostrating | PROSTRATING |
| 2 | sitting | SITTING |
| 3 | standing | STANDING |

Always take the maximum model Softmax score. **No confidence threshold** and no
additional AI classes are introduced. Contextual ITIDAL, sujud stages, tashahhud
and rak'ah progression remain the responsibility of `services/prayerEngine.ts`.

Both inference paths call the same `receivePrediction` in `PrayerCamera.tsx`:
first observation creates a candidate; another matching result at least one
second later confirms it. A timer alone never confirms a candidate.
`lastLivePoseRef` suppresses duplicate confirmed-pose events. `prayerEngine`,
`usePrayerSession`, `activeSahwEvent`, transition timers, sahw recovery and final
tashahhud's **10-second protection** are preserved. Stale native session results
are discarded; background intervals are not counted as observed stability.

## Verification

```sh
npm run android:verify-assets
npx expo install --check
npx expo-modules-autolinking verify
npx expo-doctor
```

Because the generated native project is committed for Android Studio, Expo
Doctor reports the config-sync advisory. Run `npm run android:prepare` whenever
config/dependencies change, as in the documented preparation/build workflow.

Additional model/reference checks (Python packages are tooling, never shipped):

```sh
python -m pip install ai-edge-litert numpy Pillow
python scripts/check-model.py
python scripts/generate-preprocessing-goldens.py
cd android
./gradlew :local-classification:testDebugUnitTest
```

After producing an APK/AAB, verify its actual ZIP contents:

```sh
python scripts/verify-apk-model.py android/app/build/outputs/apk/release/app-release.apk
```

See `docs/ANDROID_VALIDATION.md` for commands actually executed, outcomes and
remaining physical-device checks. A host model smoke test is not a camera
accuracy test or proof of a successful Android build.

Native Kotlin compilation, JUnit, Gradle asset merge and manifest merge passed.
The full APK build failed on this Linux ARM64 host because AGP's AAPT2 executable
is x86-64; finish APK/AAB validation in Android Studio on a supported host.
