# Local I'tidal latency investigation

The original investigation below is preserved as pre-fix evidence. The authorized
local, transition-specific fix and its before/after results are recorded in the
follow-up section at the end of this document.

## Finding and evidence boundary

The inspected implementation has **no additional Ruku-to-I'tidal timer or
stability gate**. Equal prediction sequences produce equal confirmation latency
for all five tested transitions. The exact cause of the reported real-device
asymmetry is therefore **not established** by source inspection and synthetic
replay alone. No production logic or threshold has been changed.

One latency mechanism is established: `PrayerCamera.receivePrediction` restarts
its one-second candidate window whenever the top-1 class changes. A brief return
to BOWING after STANDING therefore discards the elapsed standing confirmation
time. This can explain an asymmetry **if** rising predictions fluctuate more than
the other transitions. The local simulation demonstrates this conditional case;
it is not a recording of the user's iPhone or an Apple Core ML execution.

## Complete inspected path

1. `modules/local-classification/ios/LocalClassificationView.swift`,
   `captureOutput`: AVFoundation BGRA frame, serial capture/inference queue,
   discarded late frames, `now - lastInference >= 0.25` throttle. The same
   throttle applies to all classes. No queued pose history or exit counter.
2. `RgbPreprocessor.prepare` / `RgbResize.write`: per-frame RGB NCHW conversion
   to the model's input. Reuses buffers, not previous frame classifications.
3. `PoseClassifier.classify`: validates the four Softmax probabilities and takes
   argmax in BOWING, PROSTRATING, SITTING, STANDING order. No minimum confidence,
   probability smoothing, majority vote, hysteresis or I'tidal class. Only top-1
   pose/confidence and session ID are emitted to JavaScript.
4. `PrayerCamera` native `onPrediction`: session, foreground, camera-ready and
   active-loop gates. `receivePrediction` uses `POSE_STABILITY_MS = 1000`.
   A new top-1 pose starts a candidate; any different top-1 pose resets it.
   After the candidate has persisted for a second, a nonduplicate pose reaches
   `onPoseDetected`. No Ruku-specific condition exists here.
5. `screens/HomeScreen.tsx`: immediately sends currentPose/confidence to
   `usePrayerSession.applyEngineEvent`.
6. `hooks/usePrayerSession.ts`: normalizes the update, then invokes the real
   `advancePrayerSequence` in the state updater. Confidence is range-validated,
   not thresholded. No second pose filter.
7. `services/prayerEngine.ts`: BOWING after Qiyam sets `pendingBowing = true`.
   STANDING with that flag immediately sets `prayerStage = ITIDAL`, clears the
   flag and sets `rukuDone = true`. There is no independent Ruku-exit observation.
   Fajr validates BOWING and then ITIDAL in two synchronous calls; other prayers
   validate ITIDAL directly. Neither branch waits for additional frames/time.
8. `components/PrayerStageCard.tsx`: displays `state.prayerStage` and the
   contextual standing icon. No I'tidal display debounce. The ten-second
   pre-Sujud/post-Sujud/final-Tashahhud protections are not entrance gates for
   I'tidal. Their existing behavior is preserved.

## Deterministic simulation

`scripts/test-itidal-latency.cjs` transpiles and executes the **actual**
`PrayerCamera`, `usePrayerSession`, imported engine/sequence modules and
`PrayerStageCard`. React hooks, native event delivery and time are host harnesses;
the temporal filter and state machine are not copied or simplified. Synthetic
probabilities use the Swift class order/argmax behavior. The script reads the
cadence and stability constants from the production sources.

Frame numbers refer to inference results, not the higher-frequency preview
frames. Extra frames are confirmation frame minus first target-class frame:
four extra frames means five observations spanning one second at 250ms cadence.
An 80% probability marker identifies "clearly" classified synthetic frames for
measurement only; the application still has no confidence threshold.

All five prayers pass each scenario for standing -> Ruku, Ruku -> I'tidal,
I'tidal -> Sujud, Sujud -> sitting, and sitting -> Sujud:

| Synthetic scenario | First target to confirmation | First clear target to confirmation |
| --- | --- | --- |
| A: clear and sustained | 4 extra frames / 1000ms | 4 / 1000ms |
| B: noisy overlap with two BOWING returns | 10 / 2500ms | 10 / 2500ms |
| C: one-frame wrong class, then original pose | No transition | No transition |
| D: slow overlapping movement | 9 / 2250ms | 4 / 1000ms |

For Fajr, the clear I'tidal case first reports STANDING on frame 30 and confirms
ITIDAL on frame 34. The noisy control first reports clear STANDING on frame 36
and confirms on frame 46. UI stage and engine stage change in the same simulated
update; there is no extra downstream frame delay. No valid sequence creates a
Sahw alert, and single-frame wrong observations are rejected at every transition.

A separate mixed scenario supplies noisy rising observations but clear
observations for the other transitions. It reproduces the *appearance* of the
reported asymmetry: I'tidal first reports clear STANDING on frame 30, confirms on
frame 40 (2500ms), while each comparison transition takes 1000ms. This proves
that input fluctuation alone is sufficient, not that it occurred on the device.

250ms is the native minimum interval, not a measured iPhone cadence. At an
illustrative 30 camera fps, the throttle can select every eighth camera frame:
266.67ms result intervals give 1067ms clear confirmation. Model execution and
event/render scheduling may add time; those are not measured on Linux.

## Before / after and required evidence

There is no production fix, so the measured local before/after values are
identical. Lowering thresholds or permitting arbitrary noise without a captured
failure would be speculative and would violate the diagnosis-first requirement.

To establish the real-device cause, the affected session needs timestamped
prediction events through rising (including top-1 pose/confidence), the stable
callback time and stage-update time, and the installed build revision. Ideally
the native trace also includes all four probabilities and capture/inference
start/end times. This distinguishes candidate resets, late initial STANDING,
slow result delivery and a mismatched installed build. Existing Release events
do not contain the full probability vector or native timing information.

## Local verification performed

- `node scripts/test-itidal-latency.cjs /tmp/opencode/salatiq-itidal-latency.json`
  — PASS: 75 equal-input transition comparisons, five mixed-input comparisons,
  five 30fps-cadence comparisons, transient false positives rejected.
- Local TypeScript compilation of engine/audio/sequence modules to
  `/tmp/opencode/salatiq-itidal-prayer` — PASS.
- `node scripts/test-prayer-regression.cjs /tmp/opencode/salatiq-itidal-prayer`
  — PASS for all five prayers, final protection and recovery.
- `TEST_PLATFORM=ios node scripts/test-sahw-audio.cjs /tmp/opencode/salatiq-itidal-prayer`
  — PASS, including one-shot events and playback lifecycle simulation.
- `node scripts/test-ios-camera.cjs` — PASS, including countdown, one-second
  stability, duplicate/stale sessions, interruption and foreground handling.
- `node scripts/test-ios-readiness.cjs` — PASS.
- `npm run typecheck`, `npm run lint`, `git diff --check` — PASS.

Git commit: NONE. Git push: NONE. GitHub Actions run: NONE.
IPA build: NONE. Camera/model/prayer/UI/Android production files: unchanged.

## Follow-up: authorized local transition-specific fix

The general 1000ms filter remains intact. Only iOS predictions while the real
prayer engine has confirmed Ruku and awaits I'tidal may use a faster rising path.
`services/prayerEngine.ts:isAwaitingItidal` is a read-only eligibility helper;
it does not advance stages or change existing engine/Sahw rules. It handles
Fajr's deferred Ruku validation explicitly. `HomeScreen` supplies the real prayer
state to `PrayerCamera`, where the prediction adapter applies this policy:

- Start evidence only when STANDING is observed after confirmed Ruku.
- Retain at most the latest four observations.
- Require at least three STANDING votes and newest observation STANDING.
- Permit confirmation with three available observations (3/3), not only a full
  four-element window, but require standing evidence to span at least 500ms.
- Permit one BOWING blip. Two consecutive BOWING observations clear the attempt.
- Any other/unknown pose clears it immediately.
- A prayer-state update, stopped/disabled session, restart, camera interruption,
  backgrounding or a result gap of at least 1000ms clears evidence. A pending
  generic STANDING timer from that rising attempt is also cleared when necessary
  so it cannot bypass the reset through the ordinary filter.
- Generic STANDING is passed to the existing engine, which derives ITIDAL from
  `pendingBowing`. Duplicate protection is updated on the same observation.

This is the smallest vote count that rejects both single and two-frame standing
errors. A 3/3 uninterrupted rise spans 500ms at 250ms cadence; 3/4 with one blip
spans 750ms. The explicit minimum span prevents compressed/duplicate callbacks
from confirming based on count alone. Window eviction and persistent-BOWING
reset prevent stale Ruku observations from accumulating.

### Deterministic before/after measurements

The extended simulation compares the committed, actual pre-fix camera component
(`git show 2211693f639b37baaa635ec1cdb37203b940c55b:components/PrayerCamera.tsx`,
read-only, pinned so future local commits do not change the baseline) with the working-tree
component, using the same real session hook, engine and stage card for both.
The baseline was run before production edits using `--before-only`.

| Ruku -> I'tidal scenario | Before: extra frames / ms | After: extra frames / ms |
| --- | --- | --- |
| Clear STANDING | 4 / 1000 | 2 / 500 |
| STANDING, STANDING, BOWING, STANDING, STANDING… | 7 / 1750 | 3 / 750 |
| Original noisy overlap, two intermittent BOWING predictions | 10 / 2500 | 3 / 750 |
| Original slow mixed rise, from first top-1 STANDING | 9 / 2250 | 3 / 750 |
| Single false STANDING while remaining in Ruku | No confirmation | No confirmation |
| Two standing predictions then Ruku, isolated or consecutive | No confirmation | No confirmation |
| Persistent BOWING / alternating BOWING-STANDING | No confirmation | No confirmation |

Two extra frames mean three observations from first STANDING to confirmation.
Three extra frames mean four observations in the evidence window. In the slow
sequence, four observations following the first top-1 STANDING contain the
required three standing votes; lower-confidence top-1 results are not discarded
by a new confidence threshold. Persistent alternation never meets the criterion.

These are local deterministic timing estimates, not physical iPhone measurements.
With the illustrative 30fps capture quantization, clear I'tidal confirms in 533ms
instead of 1067ms. Native camera code and its inference throttle are unchanged.

### Follow-up verification

- `node scripts/test-itidal-latency.cjs --before-only /tmp/opencode/salatiq-itidal-before.json`
  — PASS before production changes.
- `node scripts/test-itidal-latency.cjs /tmp/opencode/salatiq-itidal-after.json`
  — PASS: 100 before/after transition comparisons across five prayers; unchanged
  timing for every unrelated transition; all rakahs of every prayer through the
  real component/hook/engine; single/two-frame false positives and persistent
  alternation rejected; newest-observation/span safeguards; eligibility,
  state/session/lifecycle/gap/other-pose resets; original Android timings retained.

The existing camera test now loads the real eligibility helper and supplies an
initial prayer state. Its original general-filter/readiness assertions remain.
Post-fix `test-ios-camera.cjs`, `test-ios-readiness.cjs`, all five prayer regression
cases, iOS Sahw/audio simulations, `npm run typecheck`, `npm run lint`, and
`git diff --check` also passed.
All changes stay local; no commit, push, Actions trigger or IPA build.
