import type {
  PrayerEngineEvent,
  PrayerPose,
  PrayerSequenceState,
  SahwAlert,
  SahwSkippedStage,
  SahwAlertType,
  PrayerStage,
  PrayerState,
  PrayerType,
} from '../types/prayer';
import { prayerConfig } from '../constants/prayers';
import { fajrSequence, type PrayerSequenceStage } from '../constants/fajrSequence';
import { maghribSequence } from '../constants/maghribSequence';
import { fourRakahSequence } from '../constants/fourRakahSequence';

export function createInitialPrayerState(prayer: PrayerType = 'FAJR'): PrayerState {
  return {
    prayerType: prayer,
    currentPose: null,
    prayerStage: null,
    confidence: null,
    currentRakah: 1,
    totalRakahs: prayerConfig[prayer].rakahs,
    currentSujud: 0,
    sequence: {
      pendingBowing: false,
      rukuDone: false,
      awaitingFirstTashahhud: false,
      awaitingFinalTashahhud: false,
    },
    sahwWarning: null,
    sahwAlerts: [],
    activeSahwEvent: null,
    expectedIndex: 0,
    completedStageIds: [],
    skippedStageIds: [],
    prayerCompleted: false,
    firstTashahhudStartedAt: null,
    preSujudTransitionStartedAt: null,
    postSujudTransitionStartedAt: null,
    finalTashahhudConfirmationStartedAt: null,
    finalTashahhudConfirmationPose: null,
    prayerStarted: false,
  };
}

const poses: ReadonlySet<PrayerPose> = new Set([
  'STANDING',
  'BOWING',
  'PROSTRATING',
  'SITTING',
  'TRANSITION',
  'UNKNOWN',
]);

const stages: ReadonlySet<Exclude<PrayerStage, null>> = new Set([
  'STANDING',
  'BOWING',
  'ITIDAL',
  'SUJUD_1',
  'SITTING_BETWEEN_SUJUD',
  'SUJUD_2',
  'TASHAHHUD',
]);

const sahwMessages: Record<SahwAlertType, string> = {
  MISSING_BOWING: 'تم تجاوز الركوع',
  MISSING_SECOND_SUJUD: 'تم تجاوز السجود الثاني',
  EXTRA_BOWING: 'ركوع زائد',
  EXTRA_SUJUD: 'تم رصد سجود زائد',
  MISSING_STAGE: 'تم تجاوز مرحلة من الصلاة',
  EXTRA_STAGE: 'تم تكرار مرحلة من الصلاة',
  EXTRA_RAKAH: 'تم البدء بركعة زائدة بعد إتمام ركعتي الفجر',
  EARLY_TASHAHHUD: 'تم الجلوس للتشهد قبل إكمال الركعة الثانية',
  MOVEMENT_AFTER_FINAL_TASHAHHUD: 'يبدو أنك بدأت ركعة جديدة بعد التشهد الأخير',
};

const sahwSkippedStages: Record<SahwAlertType, SahwSkippedStage[]> = {
  MISSING_BOWING: [{ stage: 'BOWING' }],
  MISSING_SECOND_SUJUD: [{ stage: 'SUJUD_2' }],
  EXTRA_BOWING: [],
  EXTRA_SUJUD: [],
  MISSING_STAGE: [],
  EXTRA_STAGE: [],
  EXTRA_RAKAH: [],
  EARLY_TASHAHHUD: [],
  MOVEMENT_AFTER_FINAL_TASHAHHUD: [],
};

function addSahwAlert(
  state: PrayerState,
  type: SahwAlertType,
  rakah = state.currentRakah,
): PrayerState {
  const alert: SahwAlert = {
    type,
    kind: type.startsWith('MISSING') ? 'MISSING' : 'EXTRA',
    rakah,
    message_ar: sahwMessages[type],
    skippedStages: sahwSkippedStages[type],
  };
  const hasAlreadyBeenReported = state.sahwAlerts.some(
    (item) => item.type === alert.type && item.rakah === alert.rakah,
  );

  if (hasAlreadyBeenReported) return state;

  return {
    ...state,
    sahwWarning: alert.message_ar,
    sahwAlerts: [...state.sahwAlerts, alert],
  };
}

/**
 * Single normalization boundary for future API/YOLO engine events.
 * UI code reads PrayerState only and never parses transport responses.
 */
export function normalizePrayerEngineState(
  update: PrayerEngineEvent['state'],
): Partial<PrayerState> {
  const normalized: Partial<PrayerState> = {};

  if (update.currentPose === null || (update.currentPose && poses.has(update.currentPose))) {
    normalized.currentPose = update.currentPose;
  }

  if (update.prayerStage === null || (update.prayerStage && stages.has(update.prayerStage))) {
    normalized.prayerStage = update.prayerStage;
  }

  if (
    update.confidence === null ||
    (typeof update.confidence === 'number' &&
      Number.isFinite(update.confidence) &&
      update.confidence >= 0 &&
      update.confidence <= 1)
  ) {
    normalized.confidence = update.confidence;
  }

  if (typeof update.currentRakah === 'number') normalized.currentRakah = update.currentRakah;
  if (typeof update.totalRakahs === 'number') normalized.totalRakahs = update.totalRakahs;
  if (typeof update.currentSujud === 'number') normalized.currentSujud = update.currentSujud;
  if (typeof update.prayerStarted === 'boolean') normalized.prayerStarted = update.prayerStarted;
  if (update.sahwWarning === null || typeof update.sahwWarning === 'string') {
    normalized.sahwWarning = update.sahwWarning;
  }

  return normalized;
}

export function getTotalRakahs(prayer: PrayerType) {
  return prayerConfig[prayer].rakahs;
}

function completeSecondSujud(state: PrayerState, sequence: PrayerSequenceState): PrayerState {
  const isFinalRakah = state.currentRakah === state.totalRakahs;
  const needsFirstTashahhud = state.currentRakah === 2 && state.totalRakahs > 2;

  return {
    ...state,
    prayerStage: 'SUJUD_2',
    currentSujud: 2,
    currentRakah:
      isFinalRakah || needsFirstTashahhud ? state.currentRakah : state.currentRakah + 1,
    sequence: {
      ...sequence,
      pendingBowing: false,
      awaitingFirstTashahhud: needsFirstTashahhud,
      awaitingFinalTashahhud: isFinalRakah,
    },
  };
}

/**
 * Advances the prayer sequence from one stable pose only.
 * TRANSITION and UNKNOWN deliberately do not advance any stage or counter.
 */
function advanceBasePrayerSequence(state: PrayerState, pose: PrayerPose): PrayerState {
  if (pose === 'TRANSITION' || pose === 'UNKNOWN') {
    return { ...state, currentPose: pose };
  }

  const nextState = { ...state, currentPose: pose };
  const sequence = { ...state.sequence };

  switch (pose) {
    case 'BOWING':
      if (sequence.rukuDone) {
        return addSahwAlert(nextState, 'EXTRA_BOWING');
      }

      if (state.prayerStage === 'STANDING') {
        return {
          ...nextState,
          prayerStage: 'BOWING',
          sequence: { ...sequence, pendingBowing: true },
        };
      }
      return nextState;

    case 'STANDING':
      if (sequence.pendingBowing) {
        return {
          ...nextState,
          prayerStage: 'ITIDAL',
          sequence: { ...sequence, pendingBowing: false, rukuDone: true },
        };
      }

      if (sequence.awaitingFirstTashahhud) {
        return {
          ...nextState,
          prayerStage: 'STANDING',
          currentRakah: state.currentRakah + 1,
          currentSujud: 0,
          sequence: { ...sequence, awaitingFirstTashahhud: false, rukuDone: false },
        };
      }

      if (sequence.awaitingFinalTashahhud) {
        return nextState;
      }

      if (
        state.prayerStage === 'SUJUD_1' ||
        state.prayerStage === 'SITTING_BETWEEN_SUJUD'
      ) {
        return {
          ...addSahwAlert(nextState, 'MISSING_SECOND_SUJUD'),
          prayerStage: 'STANDING',
          currentRakah:
            state.currentRakah < state.totalRakahs ? state.currentRakah + 1 : state.currentRakah,
          currentSujud: 0,
          sequence: { ...sequence, pendingBowing: false, rukuDone: false },
        };
      }

      return {
        ...nextState,
        prayerStage: 'STANDING',
        currentSujud: 0,
        sequence:
          state.prayerStage === 'SUJUD_2'
            ? { ...sequence, rukuDone: false }
            : sequence,
      };

    case 'PROSTRATING':
      if (sequence.pendingBowing) {
        sequence.pendingBowing = false;
        return {
          ...(usesSingleSahwAlert(state.prayerType)
            ? nextState
            : addSahwAlert(nextState, 'MISSING_BOWING')),
          prayerStage: 'SUJUD_1',
          currentSujud: 1,
          sequence,
        };
      }

      if (state.prayerStage === 'SITTING_BETWEEN_SUJUD') {
        return completeSecondSujud(nextState, sequence);
      }

      if (state.prayerStage === 'SUJUD_1') {
        return completeSecondSujud(nextState, sequence);
      }

      if (state.prayerStage === 'STANDING') {
        return {
          ...addSahwAlert(nextState, 'MISSING_BOWING'),
          prayerStage: 'SUJUD_1',
          currentSujud: 1,
          sequence,
        };
      }

      if (state.prayerStage === 'ITIDAL') {
        return {
          ...nextState,
          prayerStage: 'SUJUD_1',
          currentSujud: 1,
          sequence,
        };
      }

      if (state.prayerStage === 'SUJUD_2') {
        const completedRakah =
          sequence.awaitingFirstTashahhud || sequence.awaitingFinalTashahhud
            ? state.currentRakah
            : state.currentRakah - 1;
        return addSahwAlert(nextState, 'EXTRA_SUJUD', completedRakah);
      }

      return { ...nextState, sequence };

    case 'SITTING':
      if (state.prayerStage === 'SUJUD_1') {
        return {
          ...nextState,
          prayerStage: 'SITTING_BETWEEN_SUJUD',
          currentSujud: 1,
          sequence,
        };
      }

      if (
        state.prayerStage === 'SUJUD_2' &&
        (sequence.awaitingFirstTashahhud || sequence.awaitingFinalTashahhud)
      ) {
        return { ...nextState, prayerStage: 'TASHAHHUD', sequence };
      }

      return { ...nextState, sequence };

    default:
      return nextState;
  }
}

function addFajrAlert(
  state: PrayerState,
  type: 'MISSING_STAGE' | 'EXTRA_STAGE' | 'EXTRA_RAKAH',
  stage: PrayerSequenceStage | null,
): PrayerState {
  const stageId = stage?.id ?? 'EXTRA_RAKAH';
  if (state.sahwAlerts.some((alert) => alert.type === type && alert.stageId === stageId)) {
    return state;
  }

  const message_ar =
    type === 'EXTRA_RAKAH'
      ? state.prayerType === 'MAGHRIB'
        ? 'تم البدء بركعة زائدة بعد إتمام ثلاث ركعات المغرب'
        : state.prayerType === 'DHUHR' || state.prayerType === 'ASR' || state.prayerType === 'ISHA'
          ? 'تم البدء بركعة زائدة بعد إتمام أربع ركعات'
          : sahwMessages.EXTRA_RAKAH
      : type === 'MISSING_STAGE'
        ? `تم تجاوز ${stage?.label}`
        : `تم تكرار ${stage?.label}`;
  const alert: SahwAlert = {
    type,
    kind: type === 'MISSING_STAGE' ? 'MISSING' : 'EXTRA',
    rakah: stage?.rakah ?? 3,
    message_ar,
    skippedStages:
      type === 'MISSING_STAGE' && stage
        ? [{ stage: stage.stage, ...(stage.tashahhud ? { tashahhud: stage.tashahhud } : {}) }]
        : [],
    stageId,
  };

  return {
    ...state,
    sahwWarning: message_ar,
    sahwAlerts: [...state.sahwAlerts, alert],
  };
}

function isFourRakahPrayer(prayer: PrayerType) {
  return prayer === 'DHUHR' || prayer === 'ASR' || prayer === 'ISHA';
}

function usesSingleSahwAlert(prayer: PrayerType) {
  return prayer === 'MAGHRIB' || isFourRakahPrayer(prayer);
}

function isNextStanding(stage: PrayerSequenceStage | undefined) {
  return stage?.stage === 'STANDING';
}

function isNextFirstSujud(stage: PrayerSequenceStage | undefined) {
  return stage?.stage === 'SUJUD_1';
}

function validateSequenceStage(
  state: PrayerState,
  sequence: readonly PrayerSequenceStage[],
  stage: Exclude<PrayerStage, null>,
  detectedPose: PrayerPose,
): PrayerState {
  if (state.prayerCompleted) {
    return stage === 'STANDING' ? addFajrAlert(state, 'EXTRA_RAKAH', null) : state;
  }

  const expected = sequence[state.expectedIndex];
  if (!expected) return state;
  const nextIndex = sequence.findIndex((item, index) => index >= state.expectedIndex && item.stage === stage);

  if (nextIndex < 0) {
    const repeated = sequence.find((item) => state.completedStageIds.includes(item.id) && item.stage === stage);
    return repeated ? addFajrAlert(state, 'EXTRA_STAGE', repeated) : state;
  }

  const missingStages = sequence.slice(state.expectedIndex, nextIndex);
  const completed = sequence[nextIndex];
  const missing = missingStages[0];
  if (missing) {
    return resolveActiveSahwEvent(
      startActiveSahwEvent(
        state,
        'MISSING_STAGE',
        missing,
        getActiveSahwRecoveryStageIds(sequence, missing, completed),
      ),
      sequence,
      detectedPose,
    );
  }

  const completedStageIds = [...state.completedStageIds, completed.id];
  const expectedIndex = nextIndex + 1;

  return {
    ...state,
    expectedIndex,
    completedStageIds,
    prayerCompleted: expectedIndex === sequence.length,
    firstTashahhudStartedAt:
      completed.id === 'R2_FIRST_TASHAHHUD'
        ? Date.now()
        : completed.id === 'R3_STANDING'
          ? null
          : state.firstTashahhudStartedAt,
  };
}

export function confirmPreSujudTransitionTimeout(state: PrayerState): PrayerState {
  const expected = getValidatorSequence(state.prayerType)?.[state.expectedIndex];
  if (!state.preSujudTransitionStartedAt) return state;

  if (
    state.prayerStage !== 'ITIDAL' ||
    !isNextFirstSujud(expected)
  ) {
    return { ...state, preSujudTransitionStartedAt: null };
  }

  return {
    ...startActiveSahwEvent(
      state,
      'MISSING_STAGE',
      expected ?? null,
      expected ? [expected.id] : [],
    ),
    preSujudTransitionStartedAt: null,
  };
}

export function confirmPostSujudTransitionTimeout(state: PrayerState): PrayerState {
  const expected = getValidatorSequence(state.prayerType)?.[state.expectedIndex];
  if (!state.postSujudTransitionStartedAt) return state;

  if (state.prayerStage !== 'SUJUD_2' || !isNextStanding(expected)) {
    return { ...state, postSujudTransitionStartedAt: null };
  }

  return {
    ...startActiveSahwEvent(
      state,
      'MISSING_STAGE',
      expected ?? null,
      expected ? [expected.id] : [],
    ),
    postSujudTransitionStartedAt: null,
  };
}

function getValidatorSequence(prayer: PrayerType) {
  if (prayer === 'FAJR') return fajrSequence;
  if (prayer === 'MAGHRIB') return maghribSequence;
  if (prayer === 'DHUHR' || prayer === 'ASR' || prayer === 'ISHA') return fourRakahSequence;
  return null;
}

/** Read-only eligibility for the iOS rising evidence filter, not a stage advance. */
export function isAwaitingItidal(state: PrayerState): boolean {
  if (state.prayerStage !== 'BOWING' || !state.sequence.pendingBowing ||
      state.sequence.rukuDone || state.activeSahwEvent || state.prayerCompleted) return false;

  const sequence = getValidatorSequence(state.prayerType);
  const expected = sequence?.[state.expectedIndex];
  // Fajr deliberately validates its already-observed Ruku when standing arrives.
  // Its next semantic stage is I'tidal even though expectedIndex still names Ruku.
  const next = state.prayerType === 'FAJR' && expected?.stage === 'BOWING'
    ? sequence?.[state.expectedIndex + 1]
    : expected;
  return next?.stage === 'ITIDAL' && next.rakah === state.currentRakah;
}

/** True only while the final tashahhud is the active, already validated stage. */
function isAtFinalTashahhud(state: PrayerState) {
  const finalStage = getFinalTashahhudStage(state.prayerType);
  return state.prayerStage === 'TASHAHHUD' &&
    state.sequence.awaitingFinalTashahhud &&
    state.currentRakah === state.totalRakahs &&
    Boolean(finalStage && state.completedStageIds.includes(finalStage.id));
}

function getFinalTashahhudStage(prayer: PrayerType) {
  return getValidatorSequence(prayer)?.find((stage) => stage.tashahhud === 'final') ?? null;
}

/**
 * Fires only after the same wrong pose stayed stable for the full confirmation
 * window at the final tashahhud. One alert per event through activeSahwEvent.
 */
export function confirmFinalTashahhudTimeout(state: PrayerState): PrayerState {
  const validatorSequence = getValidatorSequence(state.prayerType);
  const finalTashahhudStage = getFinalTashahhudStage(state.prayerType);

  if (state.finalTashahhudConfirmationStartedAt === null || state.activeSahwEvent) return state;

  if (!isAtFinalTashahhud(state) || !validatorSequence || !finalTashahhudStage) {
    return {
      ...state,
      finalTashahhudConfirmationStartedAt: null,
      finalTashahhudConfirmationPose: null,
    };
  }

  if (
    state.finalTashahhudConfirmationPose === null ||
    state.finalTashahhudConfirmationPose === 'UNKNOWN' ||
    state.finalTashahhudConfirmationPose === 'SITTING' ||
    Date.now() - state.finalTashahhudConfirmationStartedAt < 10_000
  ) return state;

  return {
    ...startActiveSahwEvent(
      state,
      'MOVEMENT_AFTER_FINAL_TASHAHHUD',
      finalTashahhudStage,
      getActiveSahwRecoveryStageIds(validatorSequence, finalTashahhudStage),
    ),
    finalTashahhudConfirmationStartedAt: null,
    finalTashahhudConfirmationPose: null,
  };
}

function startActiveSahwEvent(
  state: PrayerState,
  alertType: SahwAlertType,
  sourceStage: PrayerSequenceStage | null,
  recoveryStageIds: string[],
): PrayerState {
  const nextState =
    alertType === 'MISSING_STAGE'
      ? addFajrAlert(state, alertType, sourceStage)
      : addSahwAlert(state, alertType);

  return {
    ...nextState,
    activeSahwEvent: {
      alertType,
      sourceStageId: sourceStage?.id,
      recoveryStageIds,
    },
  };
}

function getActiveSahwRecoveryStageIds(
  sequence: readonly PrayerSequenceStage[],
  sourceStage: PrayerSequenceStage | null,
  observedStage?: PrayerSequenceStage,
) {
  if (!sourceStage) return observedStage ? [observedStage.id] : [];

  const sourceIndex = sequence.findIndex((stage) => stage.id === sourceStage.id);
  const nextStage = sourceIndex >= 0 ? sequence[sourceIndex + 1] : undefined;
  return [sourceStage.id, nextStage?.id, observedStage?.id].filter(
    (stageId): stageId is string => Boolean(stageId),
  ).filter((stageId, index, ids) => ids.indexOf(stageId) === index);
}

function doesPoseConfirmStage(pose: PrayerPose, stage: Exclude<PrayerStage, null>) {
  if (stage === 'STANDING' || stage === 'ITIDAL') return pose === 'STANDING';
  if (stage === 'BOWING') return pose === 'BOWING';
  if (stage === 'SUJUD_1' || stage === 'SUJUD_2') return pose === 'PROSTRATING';
  return pose === 'SITTING';
}

function confirmActiveSahwRecovery(
  state: PrayerState,
  sequence: readonly PrayerSequenceStage[],
  recoveryIndex: number,
  recoveryStage: PrayerSequenceStage,
  pose: PrayerPose,
): PrayerState {
  const expectedIndex = recoveryIndex + 1;
  const nextStage = sequence[expectedIndex];
  const completedStageIds = state.completedStageIds.includes(recoveryStage.id)
    ? state.completedStageIds
    : [...state.completedStageIds, recoveryStage.id];
  const isFirstTashahhud = recoveryStage.tashahhud === 'first';
  const isFinalTashahhud = recoveryStage.tashahhud === 'final';
  const sequenceState = { ...state.sequence };
  let currentRakah = recoveryStage.rakah;
  let currentSujud = state.currentSujud;

  switch (recoveryStage.stage) {
    case 'STANDING':
      currentSujud = 0;
      sequenceState.pendingBowing = false;
      sequenceState.rukuDone = false;
      sequenceState.awaitingFirstTashahhud = false;
      sequenceState.awaitingFinalTashahhud = false;
      break;
    case 'BOWING':
      currentSujud = 0;
      sequenceState.pendingBowing = true;
      sequenceState.rukuDone = false;
      sequenceState.awaitingFirstTashahhud = false;
      sequenceState.awaitingFinalTashahhud = false;
      break;
    case 'ITIDAL':
      currentSujud = 0;
      sequenceState.pendingBowing = false;
      sequenceState.rukuDone = true;
      sequenceState.awaitingFirstTashahhud = false;
      sequenceState.awaitingFinalTashahhud = false;
      break;
    case 'SUJUD_1':
      currentSujud = 1;
      sequenceState.pendingBowing = false;
      sequenceState.awaitingFirstTashahhud = false;
      sequenceState.awaitingFinalTashahhud = false;
      break;
    case 'SITTING_BETWEEN_SUJUD':
      currentSujud = 1;
      sequenceState.awaitingFirstTashahhud = false;
      sequenceState.awaitingFinalTashahhud = false;
      break;
    case 'SUJUD_2':
      currentSujud = 2;
      currentRakah = nextStage?.stage === 'STANDING' ? recoveryStage.rakah + 1 : recoveryStage.rakah;
      sequenceState.pendingBowing = false;
      sequenceState.awaitingFirstTashahhud = nextStage?.tashahhud === 'first';
      sequenceState.awaitingFinalTashahhud = nextStage?.tashahhud === 'final';
      break;
    case 'TASHAHHUD':
      currentSujud = 2;
      sequenceState.pendingBowing = false;
      sequenceState.awaitingFirstTashahhud = isFirstTashahhud;
      sequenceState.awaitingFinalTashahhud = isFinalTashahhud;
      break;
  }

  return {
    ...state,
    currentPose: pose,
    prayerStage: recoveryStage.stage,
    currentRakah,
    currentSujud,
    sequence: sequenceState,
    activeSahwEvent: null,
    expectedIndex,
    completedStageIds,
    prayerCompleted: expectedIndex === sequence.length,
    firstTashahhudStartedAt:
      recoveryStage.id === 'R2_FIRST_TASHAHHUD'
        ? Date.now()
        : recoveryStage.id === 'R3_STANDING'
          ? null
          : state.firstTashahhudStartedAt,
  };
}

function resolveActiveSahwEvent(
  state: PrayerState,
  sequence: readonly PrayerSequenceStage[],
  pose: PrayerPose,
): PrayerState {
  const activeSahwEvent = state.activeSahwEvent;
  if (!activeSahwEvent) return state;

  const recoveryIndex = sequence.findIndex(
    (stage) =>
      activeSahwEvent.recoveryStageIds.includes(stage.id) &&
      doesPoseConfirmStage(pose, stage.stage),
  );
  const recoveryStage = sequence[recoveryIndex];
  if (!recoveryStage) {
    return { ...state, currentPose: pose };
  }

  return confirmActiveSahwRecovery(state, sequence, recoveryIndex, recoveryStage, pose);
}

/** Applies an explicit validator for all supported prayer sequences. */
export function advancePrayerSequence(state: PrayerState, pose: PrayerPose): PrayerState {
  const validatorSequence = getValidatorSequence(state.prayerType);
  if (!validatorSequence) return advanceBasePrayerSequence(state, pose);

  if (state.activeSahwEvent) {
    return resolveActiveSahwEvent(state, validatorSequence, pose);
  }

  if (isAtFinalTashahhud(state)) {
    // An unknown observation is not evidence of a new movement and breaks
    // the continuous confirmation window without changing the display.
    if (pose === 'UNKNOWN') {
      return {
        ...state,
        currentPose: 'SITTING',
        finalTashahhudConfirmationStartedAt: null,
        finalTashahhudConfirmationPose: null,
      };
    }
    if (pose !== 'SITTING') {
      // Wrong pose at the final tashahhud: freeze the display on the tashahhud,
      // change no stage, show no pose, fire no alert until the window elapses.
      const isSamePendingPose = state.finalTashahhudConfirmationPose === pose;
      return {
        ...state,
        currentPose: 'SITTING',
        finalTashahhudConfirmationStartedAt:
          isSamePendingPose && state.finalTashahhudConfirmationStartedAt !== null
            ? state.finalTashahhudConfirmationStartedAt
            : Date.now(),
        finalTashahhudConfirmationPose: pose,
      };
    }

    if (state.finalTashahhudConfirmationStartedAt !== null) {
      // Correct pose returned: cancel the confirmation completely, then continue normally.
      return advancePrayerSequence(
        {
          ...state,
          finalTashahhudConfirmationStartedAt: null,
          finalTashahhudConfirmationPose: null,
        },
        pose,
      );
    }
  }

  const expected = validatorSequence[state.expectedIndex];
  const shouldWaitForPreSujudTransition =
    pose !== 'PROSTRATING' &&
    state.prayerStage === 'ITIDAL' &&
    isNextFirstSujud(expected);
  if (shouldWaitForPreSujudTransition) {
    if (
      state.sahwAlerts.some(
        (alert) => alert.type === 'MISSING_STAGE' && alert.stageId === expected?.id,
      )
    ) {
      return { ...state, currentPose: pose };
    }

    return {
      ...state,
      currentPose: pose,
      preSujudTransitionStartedAt: state.preSujudTransitionStartedAt ?? Date.now(),
    };
  }

  const postSecondSujudRecovery = validatorSequence[state.expectedIndex + 1];
  const shouldStartMissingSecondSujudEvent =
    state.prayerStage === 'SITTING_BETWEEN_SUJUD' &&
    expected?.stage === 'SUJUD_2' &&
    postSecondSujudRecovery?.stage === 'STANDING' &&
    pose !== 'PROSTRATING';
  if (shouldStartMissingSecondSujudEvent) {
    const stateWithActiveSahwEvent = startActiveSahwEvent(
      state,
      'MISSING_STAGE',
      expected,
      getActiveSahwRecoveryStageIds(validatorSequence, expected, postSecondSujudRecovery),
    );

    return resolveActiveSahwEvent(stateWithActiveSahwEvent, validatorSequence, pose);
  }

  const shouldWaitForPostSujudTransition =
    pose !== 'STANDING' &&
    state.prayerStage === 'SUJUD_2' &&
    isNextStanding(expected);
  if (shouldWaitForPostSujudTransition) {
    if (
      state.sahwAlerts.some(
        (alert) => alert.type === 'MISSING_STAGE' && alert.stageId === expected?.id,
      )
    ) {
      return { ...state, currentPose: pose };
    }

    return {
      ...state,
      currentPose: pose,
      postSujudTransitionStartedAt: state.postSujudTransitionStartedAt ?? Date.now(),
    };
  }

  if (pose === 'TRANSITION' || pose === 'UNKNOWN') return advanceBasePrayerSequence(state, pose);

  const baseState = advanceBasePrayerSequence(state, pose);
  const nextState =
    baseState.sahwAlerts.length > state.sahwAlerts.length
      ? { ...baseState, sahwAlerts: state.sahwAlerts, sahwWarning: state.sahwWarning }
      : baseState;
  const stateAfterPreSujudTransition =
    state.preSujudTransitionStartedAt && pose === 'PROSTRATING'
      ? { ...nextState, preSujudTransitionStartedAt: null }
      : nextState;
  const stateAfterPostSujudTransition =
    state.postSujudTransitionStartedAt && pose === 'STANDING'
      ? { ...stateAfterPreSujudTransition, postSujudTransitionStartedAt: null }
      : stateAfterPreSujudTransition;

  if (state.prayerCompleted && pose === 'STANDING') {
    return validateSequenceStage(stateAfterPostSujudTransition, validatorSequence, 'STANDING', pose);
  }

  if (pose === 'STANDING' && state.sequence.pendingBowing) {
    if (usesSingleSahwAlert(state.prayerType)) {
      return validateSequenceStage(stateAfterPostSujudTransition, validatorSequence, 'ITIDAL', pose);
    }

    const stateAfterBowing = validateSequenceStage(
      stateAfterPostSujudTransition,
      validatorSequence,
      'BOWING',
      pose,
    );
    return stateAfterBowing.activeSahwEvent
      ? stateAfterBowing
      : validateSequenceStage(stateAfterBowing, validatorSequence, 'ITIDAL', pose);
  }

  if (pose === 'BOWING' && state.sequence.rukuDone) {
    const recoveryStage = validatorSequence[stateAfterPostSujudTransition.expectedIndex];
    return recoveryStage
      ? startActiveSahwEvent(
          stateAfterPostSujudTransition,
          'EXTRA_BOWING',
          recoveryStage,
          getActiveSahwRecoveryStageIds(validatorSequence, recoveryStage),
        )
      : addSahwAlert(stateAfterPostSujudTransition, 'EXTRA_BOWING');
  }

  if (pose === 'BOWING') {
    return usesSingleSahwAlert(state.prayerType)
      ? validateSequenceStage(stateAfterPostSujudTransition, validatorSequence, 'BOWING', pose)
      : stateAfterPostSujudTransition;
  }

  if (pose === 'STANDING' && state.prayerStage === 'STANDING') {
    return stateAfterPostSujudTransition;
  }

  const stage = stateAfterPostSujudTransition.prayerStage;
  return stage
    ? validateSequenceStage(stateAfterPostSujudTransition, validatorSequence, stage, pose)
    : stateAfterPostSujudTransition;
}

/**
 * Boundary for the future on-device or remote prayer engine.
 * It intentionally has no inference implementation in the Expo Go phase.
 */
export interface PrayerEngine {
  start(onEvent: (event: PrayerEngineEvent) => void): void;
  stop(): void;
}
