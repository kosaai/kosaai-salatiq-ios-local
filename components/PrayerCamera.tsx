import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, lightColors } from '../constants/theme';
import { canStartLocalPrayer } from '../services/localReadiness';
import { isAwaitingItidal } from '../services/prayerEngine';
import { predictImage, type PredictionPose, type PredictionResponse } from '../services/predictionApi';
import type { CameraStatus, EngineStatus, PrayerState } from '../types/prayer';
import { FontAwesomeIcon } from './FontAwesomeIcon';
import { LocalClassificationCamera } from './LocalClassificationCamera';

type PrayerCameraProps = {
  onStatusChange: (status: CameraStatus) => void;
  engineStatus: EngineStatus;
  onCheckEngine: () => Promise<EngineStatus>;
  onPoseDetected: (pose: PredictionPose, confidence: number) => void;
  onStartNewPrayerSession: () => void;
  sessionId: number;
  prayerState: PrayerState;
  preSujudTransitionStartedAt: number | null;
  postSujudTransitionStartedAt: number | null;
  firstTashahhudStartedAt: number | null;
  isDarkMode: boolean;
};

type SessionValue<T> = {
  sessionId: number;
  value: T;
};

type PoseCandidate = {
  pose: PredictionPose;
  startedAt: number;
};

const POSE_STABILITY_MS = 1_000;
// Three standing observations at the native 250ms cadence span at least 500ms.
const ITIDAL_MIN_EVIDENCE_MS = 500;
const LIVE_NEXT_CAPTURE_DELAY_MS = 0;
const MAX_UPLOAD_WIDTH = 640;
const WEB_FRAME_WIDTH = 384;
const WEB_FRAME_HEIGHT = 640;
const WEB_JPEG_QUALITY = 0.95;

function loadWebFrame(uri: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the captured web frame.'));
    image.src = uri;
  });
}

function encodeWebFrame(source: CanvasImageSource, sourceWidth: number, sourceHeight: number) {
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Captured web frame has no dimensions.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = WEB_FRAME_WIDTH;
  canvas.height = WEB_FRAME_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a canvas context for the web frame.');
  }

  const scale = Math.min(WEB_FRAME_WIDTH / sourceWidth, WEB_FRAME_HEIGHT / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const originX = (WEB_FRAME_WIDTH - width) / 2;
  const originY = (WEB_FRAME_HEIGHT - height) / 2;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, WEB_FRAME_WIDTH, WEB_FRAME_HEIGHT);
  context.drawImage(source, originX, originY, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Unable to encode the web frame as JPEG.'))),
      'image/jpeg',
      WEB_JPEG_QUALITY,
    );
  });
}

async function prepareWebFrame(uri: string) {
  const image = await loadWebFrame(uri);
  return encodeWebFrame(image, image.naturalWidth, image.naturalHeight);
}

function isDetectedPrayerPose(pose: PredictionPose | null): pose is PredictionPose {
  return (
    pose === 'STANDING' ||
    pose === 'BOWING' ||
    pose === 'PROSTRATING' ||
    pose === 'SITTING'
  );
}

function getEnginePresentation(status: EngineStatus, cameraActive: boolean) {
  if (Platform.OS !== 'web') {
    switch (status) {
      case 'connected': return { text: 'المحرك المحلي جاهز', color: colors.sage };
      case 'connecting': return { text: 'جاري تهيئة المحرك المحلي...', color: colors.brassSoft };
      case 'error': return { text: 'تعذر تشغيل المحرك المحلي — يلزم بناء التطبيق الأصلي', color: colors.danger };
      default: return { text: 'المحرك المحلي غير جاهز', color: colors.muted };
    }
  }
  switch (status) {
    case 'connecting':
      return { text: 'جاري الاتصال بالمحرك...', color: colors.brassSoft };
    case 'connected':
      return {
        text: 'المحرك متصل',
        color: colors.sage,
      };
    case 'error':
      return { text: 'تعذر الاتصال بالمحرك', color: colors.danger };
    case 'disconnected':
    default:
      return {
        text: cameraActive ? 'الكاميرا تعمل — المحرك غير متصل' : 'المحرك غير متصل',
        color: colors.muted,
      };
  }
}

function logLive(message: string) {
  if (__DEV__) {
    console.log(`[LIVE] ${message}`);
  }
}

export function PrayerCamera({
  onStatusChange,
  engineStatus,
  onCheckEngine,
  onPoseDetected,
  onStartNewPrayerSession,
  sessionId,
  prayerState,
  preSujudTransitionStartedAt,
  postSujudTransitionStartedAt,
  firstTashahhudStartedAt,
  isDarkMode,
}: PrayerCameraProps) {
  const theme = isDarkMode ? colors : lightColors;
  const cameraRef = useRef<CameraView>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRequestControllerRef = useRef<AbortController | null>(null);
  const liveLoopActiveRef = useRef(false);
  const predictionInFlightRef = useRef(false);
  const lastLivePoseRef = useRef<PredictionPose | null>(null);
  const lastReceivedPoseRef = useRef<string | null>(null);
  const poseCandidateRef = useRef<PoseCandidate | null>(null);
  const awaitingItidalRef = useRef(false);
  const itidalEvidenceRef = useRef<{ pose: PredictionPose; at: number }[]>([]);
  const lastLiveSkipLogRef = useRef(0);
  const onPoseDetectedRef = useRef(onPoseDetected);
  const cameraActiveRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const appForegroundRef = useRef(AppState.currentState === 'active');
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');
  const [permission, requestPermission] = useCameraPermissions();
  const [isActive, setIsActive] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>('front');
  const [error, setError] = useState<string | null>(null);
  const [earlySittingNow, setEarlySittingNow] = useState(0);
  const [countdownState, setCountdownState] = useState<SessionValue<number> | null>(null);
  const [prayerStartedSessionId, setPrayerStartedSessionId] = useState<number | null>(null);
  const [finishedPrayer, setFinishedPrayer] = useState(false);
  const [pendingNewSessionStartId, setPendingNewSessionStartId] = useState<number | null>(null);
  const [firstTashahhudReminderSessionId, setFirstTashahhudReminderSessionId] = useState<number | null>(null);
  const isPrayerStarted = prayerStartedSessionId === sessionId;
  const showFirstTashahhudReminder = firstTashahhudReminderSessionId === sessionId;
  const graceStartedAt = preSujudTransitionStartedAt ?? postSujudTransitionStartedAt;
  const graceNoticePrefix = 'تم اكتشاف حركة انتقال';
  const countdown = countdownState?.sessionId === sessionId ? countdownState.value : null;
  const canStartPrayer = Platform.OS === 'ios' ? canStartLocalPrayer({
    permissionGranted: permission?.granted === true,
    cameraReady: isCameraReady,
    cameraActive: isActive,
    foreground: isForeground,
    engineStatus,
    prayerStarted: isPrayerStarted,
    countdown,
    pendingSession: pendingNewSessionStartId,
  }) : engineStatus === 'connected' &&
    isCameraReady &&
    !isPrayerStarted &&
    countdown === null &&
    pendingNewSessionStartId === null;
  const engine = getEnginePresentation(engineStatus, isActive);
  const localInferenceEnabled = engineStatus === 'connected' && isCameraReady &&
    isActive && isPrayerStarted && countdown === null;

  useEffect(() => {
    onPoseDetectedRef.current = onPoseDetected;
  }, [onPoseDetected]);

  useEffect(() => {
    const awaitingItidal = Platform.OS === 'ios' && localInferenceEnabled &&
      isAwaitingItidal(prayerState);
    if ((awaitingItidalRef.current || awaitingItidal) && lastLivePoseRef.current === 'BOWING' &&
        poseCandidateRef.current?.pose === 'STANDING') poseCandidateRef.current = null;
    awaitingItidalRef.current = awaitingItidal;
    // Never carry rising evidence through a state update, restart or stopped loop.
    itidalEvidenceRef.current = [];
  }, [prayerState, sessionId, localInferenceEnabled]);

  // General recognition keeps the result-driven 1-second filter. Only an iOS
  // Ruku already confirmed by the engine may use the contextual rising window.
  const receivePrediction = useCallback((result: PredictionResponse) => {
    const pose = result.pose;
    if (pose !== lastReceivedPoseRef.current) {
      logLive(`pose received: ${pose}`);
      lastReceivedPoseRef.current = pose;
    }

    if (!isDetectedPrayerPose(pose)) {
      poseCandidateRef.current = null;
      itidalEvidenceRef.current = [];
    } else {
      const now = Date.now();
      if (awaitingItidalRef.current && lastLivePoseRef.current === 'BOWING') {
        let evidence = itidalEvidenceRef.current;
        const last = evidence[evidence.length - 1];
        if (last && (now <= last.at || now - last.at >= POSE_STABILITY_MS)) {
          evidence = [];
          if (poseCandidateRef.current?.pose === 'STANDING') poseCandidateRef.current = null;
        }
        if (pose !== 'STANDING' && pose !== 'BOWING') {
          evidence = [];
        } else if (pose === 'BOWING' && (!evidence.length || evidence[evidence.length - 1].pose === 'BOWING')) {
          evidence = []; // Two consecutive Ruku results end the rising attempt.
        } else {
          evidence = [...evidence, { pose, at: now }].slice(-4);
        }
        itidalEvidenceRef.current = evidence;
        const standing = evidence.filter((item) => item.pose === 'STANDING');
        if (pose === 'STANDING' && standing.length >= 3 && now - standing[0].at >= ITIDAL_MIN_EVIDENCE_MS) {
          // Feed generic STANDING through the existing contextual state machine.
          // Synchronize duplicate/general-filter state on this same observation.
          itidalEvidenceRef.current = [];
          poseCandidateRef.current = { pose, startedAt: now };
          lastLivePoseRef.current = pose;
          onPoseDetectedRef.current(pose, result.confidence);
          logLive(`pose: ${pose}`);
          return;
        }
      } else {
        itidalEvidenceRef.current = [];
      }
      const candidate = poseCandidateRef.current;

      if (!candidate || candidate.pose !== pose) {
        poseCandidateRef.current = { pose, startedAt: now };
      } else if (now - candidate.startedAt >= POSE_STABILITY_MS && pose !== lastLivePoseRef.current) {
        onPoseDetectedRef.current(pose, result.confidence);
        logLive(`pose: ${pose}`);
        lastLivePoseRef.current = pose;
      }
    }
  }, []);

  useEffect(() => {
    if (!graceStartedAt) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const updateCountdown = () => {
      const now = Date.now();
      setEarlySittingNow(now);
      if (now - graceStartedAt < 10_000) {
        timeout = setTimeout(updateCountdown, 1_000 - ((now - graceStartedAt) % 1_000));
      }
    };

    updateCountdown();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [graceStartedAt]);

  useEffect(() => {
    if (!isPrayerStarted || !firstTashahhudStartedAt) return;

    const reminderSessionId = sessionId;
    const reminderTimer = setTimeout(() => {
      if (reminderSessionId === sessionIdRef.current) {
        setFirstTashahhudReminderSessionId(reminderSessionId);
      }
    }, Math.max(0, firstTashahhudStartedAt + 60_000 - Date.now()));

    return () => clearTimeout(reminderTimer);
  }, [firstTashahhudStartedAt, isPrayerStarted, sessionId]);

  const setCountdown = useCallback((value: number | null) => {
    setCountdownState(value === null ? null : { sessionId: sessionIdRef.current, value });
  }, []);

  const setPrayerStarted = useCallback(() => {
    setPrayerStartedSessionId(sessionIdRef.current);
  }, []);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const stopLiveLoop = useCallback(() => {
    const wasActive = liveLoopActiveRef.current;
    liveLoopActiveRef.current = false;

    if (liveTimerRef.current) {
      clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }

    liveRequestControllerRef.current?.abort();
    liveRequestControllerRef.current = null;
    poseCandidateRef.current = null;
    itidalEvidenceRef.current = [];

    if (wasActive) {
      logLive('stopped');
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      appForegroundRef.current = state === 'active';
      setIsForeground(state === 'active');
      // Background time is never evidence of observed pose stability.
      poseCandidateRef.current = null;
      itidalEvidenceRef.current = [];
      if (Platform.OS === 'ios' && state !== 'active') {
        cameraReadyRef.current = false;
        setIsCameraReady(false);
        clearCountdownTimer();
        setCountdown(null);
        stopLiveLoop();
      }
    });
    return () => subscription.remove();
  }, [clearCountdownTimer, setCountdown, stopLiveLoop]);

  const beginCamera = useCallback(async () => {
    setError(null);
    void onCheckEngine();
    if (!permission) {
      onStatusChange('REQUESTING_PERMISSION');
      return;
    }

    if (!permission.granted) {
      onStatusChange('REQUESTING_PERMISSION');
      const result = await requestPermission();
      if (!result.granted) {
        setError('لم يتم السماح بالوصول إلى الكاميرا. اسمح بالوصول ثم حاول مجددًا.');
        onStatusChange('PERMISSION_DENIED');
        return;
      }
    }

    cameraReadyRef.current = false;
    setIsCameraReady(false);
    cameraActiveRef.current = true;
    setIsActive(true);
    onStatusChange('STARTING');
  }, [onCheckEngine, onStatusChange, permission, requestPermission]);

  const stopCamera = useCallback(() => {
    clearCountdownTimer();
    stopLiveLoop();
    cameraActiveRef.current = false;
    cameraReadyRef.current = false;
    setIsActive(false);
    setIsCameraReady(false);
    setCountdown(null);
    setError(null);
    onStatusChange('OFF');
  }, [clearCountdownTimer, onStatusChange, setCountdown, stopLiveLoop]);

  const toggleFacing = useCallback(() => {
    if (Platform.OS === 'ios') return;
    if (Platform.OS === 'android') {
      poseCandidateRef.current = null;
      cameraReadyRef.current = false;
      setIsCameraReady(false);
    }
    setFacing((current) => (current === 'front' ? 'back' : 'front'));
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    const countdownSessionId = sessionId;

    countdownTimerRef.current = setTimeout(() => {
      countdownTimerRef.current = null;

      if (countdownSessionId !== sessionIdRef.current) return;

      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }

      setCountdown(null);
      setPrayerStarted();
    }, 1_000);

    return clearCountdownTimer;
  }, [clearCountdownTimer, countdown, sessionId, setCountdown, setPrayerStarted]);

  useEffect(
    () => () => {
      clearCountdownTimer();
      stopLiveLoop();
    },
    [clearCountdownTimer, stopLiveLoop],
  );

  useEffect(() => {
    sessionIdRef.current = sessionId;
    lastLivePoseRef.current = null;
    lastReceivedPoseRef.current = null;
    poseCandidateRef.current = null;
    itidalEvidenceRef.current = [];
    clearCountdownTimer();
    stopLiveLoop();
  }, [clearCountdownTimer, sessionId, stopLiveLoop]);

  useEffect(() => {
    if (pendingNewSessionStartId === null || pendingNewSessionStartId !== sessionId) return;

    const startTimer = setTimeout(() => {
      setPendingNewSessionStartId(null);
      if (engineStatus !== 'connected') return;

      setFinishedPrayer(false);
      setCountdown(5);
    }, 0);

    return () => clearTimeout(startTimer);
  }, [engineStatus, pendingNewSessionStartId, sessionId, setCountdown]);

  useEffect(() => {
    if (engineStatus === 'connected') return;

    clearCountdownTimer();
    stopLiveLoop();
    const resetSession = setTimeout(() => {
      setCountdown(null);
      setPrayerStartedSessionId(null);
    }, 0);

    return () => clearTimeout(resetSession);
  }, [clearCountdownTimer, engineStatus, setCountdown, stopLiveLoop]);

  useEffect(() => {
    if (Platform.OS === 'web' || !localInferenceEnabled) return;
    liveLoopActiveRef.current = true;
    return stopLiveLoop;
  }, [localInferenceEnabled, sessionId, stopLiveLoop]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (
      engineStatus !== 'connected' ||
      !isCameraReady ||
      !isActive ||
      !isPrayerStarted ||
      countdown !== null
    ) {
      return;
    }

    const loopSessionId = sessionId;
    let cancelled = false;
    liveLoopActiveRef.current = true;

    const scheduleNext = () => {
      if (cancelled || loopSessionId !== sessionIdRef.current || !liveLoopActiveRef.current) return;

      liveTimerRef.current = setTimeout(() => {
        liveTimerRef.current = null;
        void runLiveCycle();
      }, LIVE_NEXT_CAPTURE_DELAY_MS);
    };

    const runLiveCycle = async () => {
      if (
        cancelled ||
        loopSessionId !== sessionIdRef.current ||
        !liveLoopActiveRef.current ||
        !cameraRef.current ||
        !cameraActiveRef.current ||
        !cameraReadyRef.current
      ) {
        return;
      }

      if (predictionInFlightRef.current) {
        const now = Date.now();
        if (now - lastLiveSkipLogRef.current > 2_000) {
          logLive('skipped: request in flight');
          lastLiveSkipLogRef.current = now;
        }
        scheduleNext();
        return;
      }

      const requestController = new AbortController();
      liveRequestControllerRef.current = requestController;
      predictionInFlightRef.current = true;

      try {
        logLive('capture');
        let uploadFrame: string | Blob;

        const picture = await cameraRef.current!.takePictureAsync({
          quality: 0.3,
          shutterSound: false,
          base64: false,
          exif: false,
        });

        if (cancelled || loopSessionId !== sessionIdRef.current || !liveLoopActiveRef.current) {
          return;
        }

        uploadFrame = picture.uri;

        if (Platform.OS === 'web') {
          try {
            uploadFrame = await prepareWebFrame(picture.uri);
          } catch {
            logLive('web frame preparation failed; using fallback');
          }
        }

        if (typeof uploadFrame === 'string' && picture.width > MAX_UPLOAD_WIDTH) {
          const image = ImageManipulator.manipulate(picture.uri);
          image.resize({ width: MAX_UPLOAD_WIDTH, height: null });
          const renderedImage = await image.renderAsync();
          const resizedImage = await renderedImage.saveAsync({
            format: SaveFormat.JPEG,
            compress: 0.3,
          });
          uploadFrame = resizedImage.uri;
        }

        if (cancelled || loopSessionId !== sessionIdRef.current || !liveLoopActiveRef.current) {
          return;
        }

        const result = await predictImage(uploadFrame, requestController.signal);

        if (cancelled || loopSessionId !== sessionIdRef.current) return;

        receivePrediction(result);
      } catch {
        // predictionApi logs the detailed request failure in development.
      } finally {
        if (liveRequestControllerRef.current === requestController) {
          liveRequestControllerRef.current = null;
        }
        predictionInFlightRef.current = false;
        scheduleNext();
      }
    };

    void runLiveCycle();

    return () => {
      cancelled = true;
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [
    countdown,
    engineStatus,
    isActive,
    isPrayerStarted,
    isCameraReady,
    sessionId,
    stopLiveLoop,
    receivePrediction,
  ]);

  const startPrayer = useCallback(() => {
    if (!canStartPrayer) return;

    if (finishedPrayer) {
      setPendingNewSessionStartId(sessionId + 1);
      onStartNewPrayerSession();
      return;
    }

    setCountdown(5);
  }, [canStartPrayer, finishedPrayer, onStartNewPrayerSession, sessionId, setCountdown]);

  const finishPrayer = useCallback(() => {
    clearCountdownTimer();
    stopLiveLoop();
    setCountdown(null);
    setPrayerStartedSessionId(null);
    setFirstTashahhudReminderSessionId(null);
    setFinishedPrayer(true);
  }, [clearCountdownTimer, setCountdown, stopLiveLoop]);

  const handleCameraReady = () => {
    cameraReadyRef.current = true;
    setIsCameraReady(true);
    onStatusChange('READY');
  };

  const handleCameraError = (message: string) => {
    clearCountdownTimer();
    stopLiveLoop();
    cameraActiveRef.current = false;
    cameraReadyRef.current = false;
    setError(message || 'تعذر تشغيل معاينة الكاميرا.');
    setIsActive(false);
    setIsCameraReady(false);
    setCountdown(null);
    onStatusChange('ERROR');
  };

  const handleCameraUnavailable = () => {
    // Do not let background/interrupted capture count as observed stability or
    // allow a countdown to finish while the front camera is unavailable.
    cameraReadyRef.current = false;
    setIsCameraReady(false);
    poseCandidateRef.current = null;
    itidalEvidenceRef.current = [];
    clearCountdownTimer();
    setCountdown(null);
    onStatusChange('STARTING');
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(201, 147, 46, 0.36)', 'rgba(201, 147, 46, 0)']}
        style={styles.frame}
      >
        <View
          style={[
            styles.cameraClip,
            { borderColor: theme.line },
            !isActive && !isDarkMode && { backgroundColor: theme.panelRaised },
          ]}
        >
          {isActive ? (
            <>
              {Platform.OS !== 'web' ? (
                <LocalClassificationCamera
                  style={StyleSheet.absoluteFill}
                  facing={Platform.OS === 'ios' ? 'front' : facing}
                  inferenceEnabled={localInferenceEnabled}
                  sessionId={sessionId}
                  onCameraReady={handleCameraReady}
                  onCameraUnavailable={handleCameraUnavailable}
                  onMountError={({ nativeEvent }) => handleCameraError(nativeEvent.message)}
                  onPrediction={({ nativeEvent }) => {
                    if (nativeEvent.sessionId === sessionId && nativeEvent.sessionId === sessionIdRef.current &&
                        liveLoopActiveRef.current && cameraActiveRef.current &&
                        cameraReadyRef.current && appForegroundRef.current) {
                      receivePrediction(nativeEvent);
                    }
                  }}
                />
              ) : (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={facing}
                mirror={facing === 'front'}
                onCameraReady={handleCameraReady}
                onMountError={({ message }) => handleCameraError(message)}
              />
              )}
              {countdown !== null ? (
                <View pointerEvents="none" style={styles.countdownOverlay}>
                  <Text style={styles.countdownText}>{countdown}</Text>
                </View>
              ) : null}
              {engineStatus !== 'error' && engineStatus !== 'connected' ? (
                <View pointerEvents="none" style={styles.statusPill}>
                  <View style={[styles.engineDot, { backgroundColor: engine.color }]} />
                  <Text style={styles.statusText}>{engine.text}</Text>
                </View>
              ) : null}
              {Platform.OS !== 'ios' && <Pressable
                accessibilityLabel="تبديل الكاميرا"
                onPress={toggleFacing}
                style={styles.flipButton}
              >
                <Text style={styles.flipText}>↻</Text>
              </Pressable>}
            </>
          ) : (
            <View style={styles.offContent}>
              {permission === null ? (
                <ActivityIndicator color={colors.brassSoft} />
              ) : (
                <FontAwesomeIcon
                  name="video-slash"
                  size={48}
                  color={theme.brassSoft}
                />
              )}
              <Text style={[styles.offText, !isDarkMode && { color: theme.muted }]}>
                الكاميرا متوقفة
              </Text>
              <Text style={[styles.offHint, !isDarkMode && { color: theme.muted }]}>
                اضغط «بدء الكاميرا» للمتابعة
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {graceStartedAt ? (
        <View style={[styles.earlySittingNotice, { borderColor: theme.brassDim }]}>
          <Text style={[styles.earlySittingNoticeText, { color: theme.brassSoft }]}>
            {graceNoticePrefix} — جاري الانتظار {Math.min(10, Math.max(0, 10 - Math.floor((earlySittingNow - graceStartedAt) / 1_000)))} ثوانٍ
          </Text>
        </View>
      ) : null}

      {showFirstTashahhudReminder ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.firstTashahhudReminder,
            {
              borderColor: theme.brassDim,
              backgroundColor: isDarkMode ? 'rgba(201, 147, 46, 0.12)' : 'rgba(180, 122, 22, 0.08)',
            },
          ]}
        >
          <Text style={[styles.firstTashahhudReminderText, { color: theme.brassSoft }]}>
            ربما نسيت القيام بعد التشهد الأول. إذا كنت قد أتممت الصلاة فتجاهل هذا التنبيه.
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={permission === null}
        onPress={isActive ? stopCamera : beginCamera}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.brass },
          isActive && styles.stopButton,
          pressed && styles.pressed,
          permission === null && styles.disabled,
        ]}
      >
          <Text style={[styles.primaryButtonText, { color: isActive ? theme.brassSoft : '#1A1305' }]}>
            {isActive ? '■  إيقاف الكاميرا' : '◉  بدء الكاميرا'}
          </Text>
      </Pressable>

      {isActive ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPrayerStarted ? 'إتمام الصلاة' : 'بدء الصلاة'}
            disabled={isPrayerStarted ? false : !canStartPrayer}
            onPress={isPrayerStarted ? finishPrayer : startPrayer}
            style={({ pressed }) => [
              styles.testButton,
              { borderColor: theme.brassDim, backgroundColor: theme.panel },
              !isPrayerStarted && !canStartPrayer && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.testButtonText, { color: theme.brassSoft }]}>
              {countdown !== null ? `استعد: ${countdown}` : isPrayerStarted ? 'إتمام الصلاة' : 'بدء الصلاة'}
            </Text>
          </Pressable>
        </>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={beginCamera} style={styles.retryButton}>
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...(Platform.OS === 'ios' ? { direction: 'rtl' as const } : {}) },
  frame: {
    borderRadius: 150,
    padding: 1,
    paddingBottom: 14,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  cameraClip: {
    aspectRatio: 3 / 4.2,
    overflow: 'hidden',
    borderRadius: 140,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    backgroundColor: '#0C1C26',
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offContent: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 28 },
  offText: { color: colors.muted, fontSize: 14, fontWeight: '700', textAlign: 'center', writingDirection: 'rtl' },
  offHint: { color: colors.muted, fontSize: 11.5, textAlign: 'center', writingDirection: 'rtl', marginTop: -7 },
  statusPill: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(10,20,28,0.80)',
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
  },
  engineDot: { height: 7, width: 7, borderRadius: 4 },
  statusText: { color: colors.ivory, fontSize: 12, ...(Platform.OS === 'ios' ? { textAlign: 'auto' as const, writingDirection: 'rtl' as const } : {}) },
  countdownOverlay: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,20,28,0.82)',
    borderWidth: 1,
    borderColor: colors.brass,
  },
  countdownText: { color: colors.brassSoft, fontSize: 42, fontWeight: '700', fontVariant: ['tabular-nums'] },
  earlySittingNotice: {
    marginTop: 12,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(10,20,28,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  earlySittingNoticeText: { fontSize: 13.5, fontWeight: '700', textAlign: 'center', writingDirection: 'rtl' },
  firstTashahhudReminder: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  firstTashahhudReminderText: { fontSize: 13.5, fontWeight: '700', lineHeight: 22, textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl' },
  flipButton: {
    position: 'absolute',
    left: 14,
    bottom: 14,
    height: 36,
    width: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,20,28,0.78)',
    borderColor: colors.line,
    borderWidth: 1,
  },
  flipText: { color: colors.ivory, fontSize: 24, lineHeight: 28 },
  primaryButton: {
    marginTop: 22,
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brass,
  },
  stopButton: { backgroundColor: 'transparent', borderColor: colors.brassDim, borderWidth: 1.5 },
  primaryButtonText: { color: '#1A1305', fontSize: 16, fontWeight: '700', writingDirection: 'rtl' },
  stopButtonText: { color: colors.brassSoft },
  testButton: {
    marginTop: 10,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brassDim,
    backgroundColor: colors.panel,
  },
  testButtonText: { color: colors.brassSoft, fontSize: 14, fontWeight: '700', writingDirection: 'rtl' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.55 },
  errorBanner: {
    marginTop: 12,
    backgroundColor: 'rgba(90,20,20,0.95)',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  errorText: { color: '#FFFFFF', fontSize: 13, textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl', lineHeight: 20 },
  retryButton: { alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 7 },
  retryText: { color: '#FFFFFF', fontSize: 12 },
});
