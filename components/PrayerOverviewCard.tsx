import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors, lightColors } from '../constants/theme';
import { prayerConfig } from '../constants/prayers';
import type { PrayerState, PrayerType } from '../types/prayer';
import { FontAwesomeIcon } from './FontAwesomeIcon';

type PrayerOverviewCardProps = {
  prayer: PrayerType;
  state: PrayerState;
  isDarkMode: boolean;
};

export function PrayerOverviewCard({ prayer, state, isDarkMode }: PrayerOverviewCardProps) {
  const theme = isDarkMode ? colors : lightColors;
  const prayerName = prayerConfig[prayer].arabicName;
  const totalRakahs = state.totalRakahs;
  const currentRakah = Math.min(Math.max(state.currentRakah, 1), totalRakahs);

  return (
    <LinearGradient
      colors={isDarkMode ? ['#152A37', '#0D1B25'] : ['#FFFDF8', '#F4EFE4']}
      style={[styles.card, { borderColor: theme.line }]}
    >
      <View style={styles.column}>
        <Text style={[styles.label, { color: theme.muted }]}>الصلاة المختارة</Text>
        <Text style={[styles.prayerName, { color: theme.ivory }]}>صلاة {prayerName}</Text>
        <Text style={[styles.detail, { color: theme.brassSoft }]}>{totalRakahs} ركعات</Text>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.line }]} />

      <View style={[styles.column, styles.progressColumn]}>
        <Text style={[styles.rakahText, { color: theme.ivory }]}>
          الركعة {currentRakah} من {totalRakahs}
        </Text>
        <View
          accessibilityLabel={`التقدم: الركعة ${currentRakah} من ${totalRakahs}`}
          style={styles.progressDots}
        >
          {Array.from({ length: totalRakahs }, (_, index) => (
            <View
              key={index}
              style={[
                styles.progressDot,
                index + 1 === currentRakah && styles.progressDotActive,
              ]}
            />
          ))}
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.line }]} />

      <View style={[styles.column, styles.statusColumn]}>
        <View style={styles.privacyLine}>
          <FontAwesomeIcon name="lock" size={15} color={theme.brassSoft} />
          <Text style={[styles.statusPrivacy, { color: theme.muted }]}>
            {Platform.OS === 'ios'
              ? 'تتم معالجة صور الكاميرا محلياً'
              : Platform.OS === 'android'
              ? 'تتم المعالجة بأمان على جهازك'
              : 'تتم معالجة صور الكاميرا عبر الخادم'}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    ...(Platform.OS === 'ios' ? { direction: 'rtl' as const } : {}),
    minHeight: 88,
    marginBottom: 22,
    paddingVertical: 16,
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse',
    alignItems: 'center',
  },
  column: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  label: {
    color: colors.muted,
    fontSize: 10.5,
    textAlign: Platform.OS === 'ios' ? 'auto' : 'right',
    writingDirection: 'rtl',
  },
  prayerName: {
    color: colors.ivory,
    fontSize: 14,
    fontWeight: '700',
    textAlign: Platform.OS === 'ios' ? 'auto' : 'right',
    writingDirection: 'rtl',
    marginTop: 4,
  },
  detail: {
    color: colors.brassSoft,
    fontSize: 11.5,
    textAlign: Platform.OS === 'ios' ? 'auto' : 'right',
    writingDirection: 'rtl',
    marginTop: 3,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: 10,
    backgroundColor: colors.line,
  },
  progressColumn: {
    alignItems: 'center',
  },
  rakahText: {
    color: colors.ivory,
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
    fontVariant: ['tabular-nums'],
  },
  progressDots: {
    flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 11,
  },
  progressDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(124,139,148,0.58)',
  },
  progressDotActive: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.brass,
  },
  statusColumn: {
    alignItems: 'flex-start',
  },
  privacyLine: {
    flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  statusPrivacy: {
    color: colors.muted,
    fontSize: 11.5,
    flexShrink: 1,
    textAlign: Platform.OS === 'ios' ? 'auto' : 'right',
    writingDirection: 'rtl',
  },
});
