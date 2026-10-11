import { FontAwesomeIcon } from '../components/FontAwesomeIcon';
import { PageShell } from '../components/PageShell';
import { colors, lightColors } from '../constants/theme';
import { themeParam, usePageTheme } from '../hooks/usePageTheme';
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

type MoreRoute = '/about' | '/privacy' | '/usage' | '/disclaimer' | '/licenses';

const moreItems: { title: string; pathname: MoreRoute }[] = [
  { title: 'عن صلاتك', pathname: '/about' },
  { title: 'الخصوصية', pathname: '/privacy' },
  { title: '📖 كيفية الاستخدام', pathname: '/usage' },
  { title: '⚖️ إخلاء المسؤولية', pathname: '/disclaimer' },
  { title: '©️ الحقوق والتراخيص', pathname: '/licenses' },
];

export function MoreScreen() {
  const isDarkMode = usePageTheme();
  const theme = isDarkMode ? colors : lightColors;

  return (
    <PageShell title="المزيد" isDarkMode={isDarkMode}>
      <View style={styles.list}>
        {moreItems.map((item) => (
          <Pressable
            key={item.pathname}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => router.push({ pathname: item.pathname, params: themeParam(isDarkMode) })}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: theme.panel, borderColor: theme.line },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.rowTitle, { color: theme.ivory }]}>{item.title}</Text>
            <FontAwesomeIcon name="chevron-left" size={14} color={theme.muted} />
          </Pressable>
        ))}
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: {
    flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  rowTitle: {
    color: colors.ivory,
    fontSize: 14.5,
    flexShrink: 1,
    textAlign: Platform.OS === 'ios' ? 'auto' : 'right',
    writingDirection: 'rtl',
  },
  pressed: { opacity: 0.8 },
});
