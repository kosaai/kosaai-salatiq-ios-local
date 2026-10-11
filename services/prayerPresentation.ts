import type { PrayerPose, PrayerStage } from '../types/prayer';

const stagePoses: Record<Exclude<PrayerStage, null>, PrayerPose> = {
  STANDING: 'STANDING',
  BOWING: 'BOWING',
  ITIDAL: 'STANDING',
  SUJUD_1: 'PROSTRATING',
  SITTING_BETWEEN_SUJUD: 'SITTING',
  SUJUD_2: 'PROSTRATING',
  TASHAHHUD: 'SITTING',
};

/** Presentation only: the semantic stage wins over a stale classifier pose. */
export function getSemanticStagePose(stage: PrayerStage, fallback: PrayerPose | null): PrayerPose | null {
  return stage ? stagePoses[stage] : fallback;
}
