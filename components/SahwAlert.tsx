import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/theme';
import type { SahwAlert as SahwAlertData } from '../types/prayer';

type SahwAlertProps = { alert: SahwAlertData | null };

/** Presentational only: the prayer engine supplies deduplicated alerts. */
export function SahwAlert({ alert }: SahwAlertProps) {
  if (!alert) return null;

  return (
    <View accessibilityRole="alert" style={styles.container}>
      <Text style={styles.icon}>⚠</Text>
      <Text style={styles.text}>تنبيه سهو: {alert.message_ar} في الركعة {alert.rakah}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...(Platform.OS === 'ios' ? { direction: 'rtl' as const } : {}), marginTop: 14, flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse', gap: 9, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,147,46,0.22)', backgroundColor: 'rgba(201,147,46,0.10)', padding: 12 },
  icon: { color: colors.brassSoft, fontSize: 16 },
  text: { flex: 1, color: colors.brassSoft, fontSize: 13, textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl', lineHeight: 21 },
});
