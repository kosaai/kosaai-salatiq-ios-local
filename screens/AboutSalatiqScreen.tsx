import { PageShell } from '../components/PageShell';
import { FontAwesomeIcon } from '../components/FontAwesomeIcon';
import { colors, lightColors } from '../constants/theme';
import { usePageTheme } from '../hooks/usePageTheme';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

// Use the device's Arabic-capable sans-serif fonts without a font download.
const arabicFont = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  ios: 'System',
  default: 'sans-serif',
});

const paragraphs = [
  'صلاتك هو تطبيق ذكي صُمم لمساعدة المصلّي على متابعة تسلسل صلاته والتنبيه عند حدوث خطأ محتمل بسبب الزيادة أو النقص في حركات الصلاة أو الركعات.',
  'تم تطوير التطبيق للمساعدة في حال حدوث نسيان أو سهو غير متوقع أثناء الصلاة، بحيث يتابع تسلسل الصلاة باستخدام تقنيات الذكاء الاصطناعي.',
  'يتعرّف التطبيق على وضعيات الصلاة الأساسية، مثل القيام والركوع والسجود والجلوس، ويتابع انتقال المصلّي بينها بحسب الصلاة التي اختارها.',
  'وعند اكتشاف خطأ محتمل في تسلسل الصلاة، يقوم التطبيق بالتحقق من الحالة أولًا، ثم يصدر تنبيهًا صوتيًا لمساعدة المصلّي على الانتباه عند حدوث زيادة أو نقص محتمل.',
  'صلاتك ليس بديلًا عن انتباه المصلّي أو معرفته بصلاته، وقد تحدث أخطاء في التعرّف أو المتابعة بحسب وضع الكاميرا، والإضاءة، وزاوية التصوير، أو ظروف الاستخدام المختلفة.',
  'لذلك يُستخدم صلاتك كوسيلة مساعدة إضافية في حال حدوث نسيان أو سهو غير متوقع أثناء الصلاة.',
];

export function AboutSalatiqScreen() {
  const isDarkMode = usePageTheme();
  const theme = isDarkMode ? colors : lightColors;

  return (
    <PageShell
      title="عن صلاتك"
      isDarkMode={isDarkMode}
      watermark
      renderHeader={(onBack) => (
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="رجوع"
            onPress={onBack}
            style={({ pressed }) => [
              styles.backButton,
              { backgroundColor: theme.panel, borderColor: theme.line, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <FontAwesomeIcon name="arrow-right" size={18} color={theme.brassSoft} />
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.ivory }]}>عن صلاتك</Text>
        </View>
      )}
      headerExtra={
        <Image
          accessibilityLabel="شعار صلاتك"
          source={
            isDarkMode
              ? require('../assets/branding/salatiq-logo-dark.png')
              : require('../assets/branding/salatiq-logo-light.png')
          }
          resizeMode="contain"
          style={styles.heroLogo}
        />
      }
    >
      <View style={styles.paragraphs}>
        {paragraphs.map((paragraph, index) => (
          <Text key={index} style={[styles.paragraph, { color: theme.ivory }]}>
            {paragraph}
          </Text>
        ))}
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse', alignItems: 'center', justifyContent: 'flex-start', gap: 12, width: '100%', minHeight: 48, zIndex: 1 },
  backButton: { width: 44, height: 44, minWidth: 44, minHeight: 44, flexShrink: 0, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: arabicFont, fontSize: 28, lineHeight: 40, fontWeight: '600', textAlign: Platform.OS === 'ios' ? 'auto' : 'right', writingDirection: 'rtl', flexShrink: 1 },
  heroLogo: { width: 150, height: 150, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  paragraphs: { gap: 20 },
  paragraph: {
    color: colors.ivory,
    fontFamily: arabicFont,
    fontSize: 16,
    lineHeight: 30,
    textAlign: Platform.OS === 'ios' ? 'auto' : 'right',
    writingDirection: 'rtl',
  },
});
