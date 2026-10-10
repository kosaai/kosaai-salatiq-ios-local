import { SvgXml } from 'react-native-svg';
import { StyleSheet, View } from 'react-native';
import icons from '../assets/ios/pose-icons.json';
import { colors } from '../constants/theme';
import type { PrayerPose, PrayerStage } from '../types/prayer';

// Identical artwork/crop/color to the shared component, but the SVG bytes are
// embedded in JS so native rendering never fetches/downloads a pose icon.
const crops = {
  STANDING: [0.4352, 0.3153, 0.1659, 0.3226],
  BOWING: [0.4032, 0.4206, 0.2474, 0.233],
  PROSTRATING: [0.3532, 0.4844, 0.2813, 0.1556],
  SITTING: [0.3962, 0.3468, 0.1869, 0.2743],
} as const;

export function PrayerPoseIcon({ pose, stage, size = 56 }: { pose: PrayerPose | null; stage: PrayerStage; size?: number }) {
  const displayPose = stage === 'ITIDAL' && pose === 'STANDING' ? 'STANDING' : pose;
  const key = displayPose && displayPose in icons ? displayPose as keyof typeof icons : null;
  let xml = key ? icons[key] : null;
  if (xml && key) {
    xml = xml.replace(/\b(fill|stroke)=(['"])(#000(?:000)?|black)\2/gi, `$1=$2${colors.brassSoft}$2`)
      .replace(/\b(fill|stroke)\s*:\s*(#000(?:000)?|black)/gi, `$1: ${colors.brassSoft}`);
    const match = xml.match(/\bviewBox=(['"])([^'"]+)\1/i);
    if (match) {
      const [minX, minY, width, height] = match[2].trim().split(/[\s,]+/).map(Number);
      const [x, y, w, h] = crops[key];
      const viewBox = [minX + width * x, minY + height * y, width * w, height * h].join(' ');
      xml = xml.replace(/\bviewBox=(['"])[^'"]+\1/i, `viewBox=${match[1]}${viewBox}${match[1]}`);
    }
  }
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {xml ? <SvgXml xml={xml} width={size} height={size} override={{ fill: colors.brassSoft, color: colors.brassSoft, preserveAspectRatio: 'xMidYMid meet' }} />
        : <View style={styles.placeholder} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  placeholder: { width: '100%', height: '100%' },
});
