import { Platform, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { createPrayerTimeline, getActivePrayerTimelineNodeId } from '../constants/prayerTimeline';
import { fajrSequence } from '../constants/fajrSequence';
import { maghribSequence } from '../constants/maghribSequence';
import { fourRakahSequence } from '../constants/fourRakahSequence';
import { colors, lightColors } from '../constants/theme';
import type { EngineStatus, PrayerPose, PrayerStage, PrayerState, PrayerType } from '../types/prayer';
import { PrayerPoseIcon } from './PrayerPoseIcon';
import { getSemanticStagePose } from '../services/prayerPresentation';

type PrayerStageCardProps = {
  prayer: PrayerType;
  engineStatus: EngineStatus;
  currentPose: PrayerPose | null;
  state: PrayerState;
  isDarkMode: boolean;
};

const stageLabels: Record<Exclude<PrayerStage, null>, string> = {
  STANDING: 'قيام',
  BOWING: 'ركوع',
  ITIDAL: 'اعتدال',
  SUJUD_1: 'السجود الأول',
  SITTING_BETWEEN_SUJUD: 'الجلوس بين السجدتين',
  SUJUD_2: 'السجود الثاني',
  TASHAHHUD: 'التشهد',
};

const poseLabels: Partial<Record<PrayerPose, string>> = {
  STANDING: 'قيام',
  BOWING: 'ركوع',
  PROSTRATING: 'سجود',
  SITTING: 'جلوس',
  TRANSITION: 'انتقال',
};

function getStageMessage(
  engineStatus: EngineStatus,
  pose: PrayerPose | null,
  stage: PrayerStage,
  isExtraBowing: boolean,
  connectingDots: number,
  tashahhudKind: 'first' | 'final' | null,
) {
  if (isExtraBowing) return 'المرحلة الحالية: ركوع زائد';
  if (stage === 'TASHAHHUD' && tashahhudKind === 'first') {
    return 'المرحلة الحالية: جلوس التشهد الأول';
  }
  if (stage === 'TASHAHHUD' && tashahhudKind === 'final') {
    return 'المرحلة الحالية: جلوس التشهد الأخير';
  }
  const label = stage ? stageLabels[stage] : pose ? poseLabels[pose] : undefined;
  if (label) return `المرحلة الحالية: ${label}`;

  if (engineStatus === 'disconnected') return 'المحرك غير متصل';
  if (engineStatus === 'connecting') return `جاري الاتصال${'.'.repeat(connectingDots)}`;

  return 'بانتظار ظهور المصلي';
}

export function PrayerStageCard({
  prayer,
  engineStatus,
  currentPose,
  state,
  isDarkMode,
}: PrayerStageCardProps) {
  const theme = isDarkMode ? colors : lightColors;
  const [connectingDots, setConnectingDots] = useState(1);
  const timelineRows = createPrayerTimeline(prayer);
  const timelineNodes = timelineRows.flatMap((row) => row.nodes);
  const activeNodeId = getActivePrayerTimelineNodeId(state);
  const activeIndex = activeNodeId ? timelineNodes.findIndex((node) => node.id === activeNodeId) : -1;
  const validatorSequence = state.prayerType === 'FAJR'
    ? fajrSequence
    : state.prayerType === 'MAGHRIB'
      ? maghribSequence
      : state.prayerType === 'DHUHR' || state.prayerType === 'ASR' || state.prayerType === 'ISHA'
        ? fourRakahSequence
        : null;
  const validatorNodeIdByStageId = new Map(
    (validatorSequence ?? []).map((stage) => [
      stage.id,
      `${stage.rakah}-${stage.stage}-${stage.tashahhud ?? 'none'}`,
    ]),
  );
  const completedNodeIds = new Set(
    state.completedStageIds
      .map((stageId) => validatorNodeIdByStageId.get(stageId))
      .filter((nodeId): nodeId is string => Boolean(nodeId)),
  );
  const prayerStage = state.prayerStage;
  const latestSahwAlert = state.sahwAlerts[state.sahwAlerts.length - 1];
  const isPreSujudTransitionGrace =
    state.preSujudTransitionStartedAt !== null &&
    prayerStage === 'ITIDAL';
  const isPostSujudTransitionGrace =
    state.postSujudTransitionStartedAt !== null &&
    prayerStage === 'SUJUD_2';
  const displayedPrayerStage = isPreSujudTransitionGrace
    ? 'ITIDAL'
    : isPostSujudTransitionGrace
    ? 'SUJUD_2'
    : prayerStage;
  const legacyDisplayedPose = isPreSujudTransitionGrace
    ? 'STANDING'
    : isPostSujudTransitionGrace
      ? 'PROSTRATING'
      : currentPose;
  const isExtraBowing = currentPose === 'BOWING' && latestSahwAlert?.type === 'EXTRA_BOWING';
  // The extra-Ruku label is itself a semantic override; use the same stage for
  // its icon. Otherwise the displayed stage always wins over raw observations.
  const displayedIconStage = Platform.OS === 'ios' && isExtraBowing ? 'BOWING' : displayedPrayerStage;
  const displayedPose = Platform.OS === 'ios'
    ? getSemanticStagePose(displayedIconStage, legacyDisplayedPose)
    : legacyDisplayedPose;
  const tashahhudKind = state.sequence.awaitingFirstTashahhud
    ? 'first'
    : state.sequence.awaitingFinalTashahhud
      ? 'final'
      : null;

  useEffect(() => {
    if (engineStatus !== 'connecting') return;

    const timer = setInterval(() => {
      setConnectingDots((current) => (current % 3) + 1);
    }, 400);

    return () => clearInterval(timer);
  }, [engineStatus]);
  const showPoseIcon =
    engineStatus === 'connected' &&
    (displayedPose === 'STANDING' ||
      displayedPose === 'BOWING' ||
      displayedPose === 'PROSTRATING' ||
      displayedPose === 'SITTING');

  return (
    <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.panel }]}>
        <View style={styles.currentRow}>
          <View style={styles.currentStage}>
            <View style={styles.iconSlot}>
              {showPoseIcon ? <PrayerPoseIcon pose={displayedPose} stage={displayedIconStage} size={56} /> : <View style={styles.iconPlaceholder} />}
            </View>
            <View style={styles.stageCopy}>
            <Text
              style={[styles.currentText, { color: theme.ivory }]}
            >
              {getStageMessage(
                engineStatus,
                displayedPose,
                displayedPrayerStage,
                isExtraBowing,
                connectingDots,
                tashahhudKind,
              )}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.separator, { backgroundColor: theme.line }]} />
      <Text style={[styles.timelineTitle, { color: theme.muted }]}>تسلسل الركعة</Text>
      <View style={styles.timelineRows}>
        {timelineRows.map((row) => (
          <View key={row.rakah} style={styles.timelineRow}>
            <View
              pointerEvents="none"
              style={[
                styles.timelineLine,
                { backgroundColor: theme.brass },
                {
                  left: `${50 / row.nodes.length}%`,
                  right: `${50 / row.nodes.length}%`,
                },
              ]}
            />
            {row.nodes.map((node) => {
              const nodeIndex = timelineNodes.findIndex((item) => item.id === node.id);
              const isCurrent = nodeIndex === activeIndex;
              const isComplete = validatorSequence
                ? completedNodeIds.has(node.id)
                : activeIndex >= 0 && nodeIndex < activeIndex;
              const isGold = isCurrent || isComplete;

              return (
                <View key={node.id} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: isGold ? theme.brass : 'rgba(124,139,148,0.50)' }]} />
                  <Text style={[styles.timelineLabel, { color: isGold ? theme.brassSoft : theme.muted }]}>
                    {node.label}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {state.sahwAlerts.length ? (
        <View style={styles.sahwSection}>
          <View style={[styles.sahwSeparator, { backgroundColor: theme.line }]} />
          <Text style={[styles.sahwTitle, { color: theme.brassSoft }]}>تنبيهات السهو</Text>
          <View style={styles.sahwList}>
            {state.sahwAlerts.map((alert, index) => (
              <View
                key={`${alert.type}:${alert.rakah}:${alert.stageId ?? index}`}
                style={[
                  styles.sahwEntry,
                  {
                    borderColor: theme.brassDim,
                    backgroundColor: isDarkMode ? 'rgba(201, 147, 46, 0.12)' : 'rgba(180, 122, 22, 0.08)',
                  },
                ]}
              >
                <Text style={[styles.sahwEntryText, { color: theme.brassSoft }]}>
                   {`${index + 1}. ${alert.message_ar}${alert.type === 'MOVEMENT_AFTER_FINAL_TASHAHHUD' ? '' : ` في الركعة ${alert.rakah}`}`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...(Platform.OS === 'ios' ? { direction: 'rtl' as const } : {}),
    marginTop: 22,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
  },
  currentRow: { flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  currentStage: { flex: 1, minWidth: 0, flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse', alignItems: 'center', gap: 12 },
  iconSlot: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  iconPlaceholder: { width: 56, height: 56 },
  stageCopy: { flex: 1, minWidth: 0 },
  // iOS Fabric swaps explicit left/right in RTL. Natural alignment plus an
  // Arabic paragraph direction keeps the text on the right, including numbers.
  currentText: { color: colors.ivory, fontSize: 15, fontWeight: '700', textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: 16 },
  timelineTitle: { color: colors.muted, fontSize: 11, textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl', marginBottom: 13 },
  timelineRows: { gap: 16 },
  timelineRow: { flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse', alignItems: 'flex-start' },
  timelineItem: { flex: 1, minWidth: 0, alignItems: 'center', position: 'relative' },
  timelineLine: { position: 'absolute', top: 4, height: StyleSheet.hairlineWidth, backgroundColor: colors.brass },
  timelineDot: { zIndex: 1, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(124,139,148,0.50)' },
  timelineDotCurrent: { backgroundColor: colors.brass },
  timelineDotComplete: { backgroundColor: colors.brass },
  timelineLabel: { marginTop: 7, minHeight: 24, color: colors.muted, fontSize: 8.5, textAlign: 'center', writingDirection: 'rtl' },
  timelineLabelCurrent: { color: colors.brassSoft, fontWeight: '700' },
  timelineLabelComplete: { color: colors.brassSoft },
  sahwSection: { marginTop: 18 },
  sahwSeparator: { height: StyleSheet.hairlineWidth, marginBottom: 14 },
  sahwTitle: { fontSize: 13, fontWeight: '700', textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl', marginBottom: 10 },
  sahwList: { gap: 7 },
  sahwEntry: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  sahwEntryText: { fontSize: 12.5, fontWeight: '600', lineHeight: 20, textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl' },
});
