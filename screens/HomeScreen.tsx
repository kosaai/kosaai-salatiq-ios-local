import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { FontAwesomeIcon } from '../components/FontAwesomeIcon';
import { PrayerCamera } from '../components/PrayerCamera';
import { PrayerOverviewCard } from '../components/PrayerOverviewCard';
import { PrayerStageCard } from '../components/PrayerStageCard';
import { prayerConfig, prayerTypes } from '../constants/prayers';
import { colors, lightColors } from '../constants/theme';
import { useEngineConnection } from '../hooks/useEngineConnection';
import { themeParam } from '../hooks/usePageTheme';
import { usePrayerSession } from '../hooks/usePrayerSession';
import { useSahwAlertAudio } from '../hooks/useSahwAlertAudio';

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const {
    selectedPrayer,
    prayerState,
    sessionId,
    selectPrayer,
    startNewPrayerSession,
    setCameraStatus,
    applyEngineEvent,
  } = usePrayerSession();
  const { engineStatus, checkConnection } = useEngineConnection();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const theme = isDarkMode ? colors : lightColors;
  const horizontalPadding = width < 360 ? 12 : 16;
  const cardWidth = useMemo(() => Math.max(54, (width - horizontalPadding * 2 - 40 - 28) / 5), [horizontalPadding, width]);
  useSahwAlertAudio(sessionId, prayerState);

  return (
    <LinearGradient colors={isDarkMode ? ['#16303F', colors.background] : ['#FFF9EC', lightColors.background]} locations={[0, 0.38]} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding }]}
          showsVerticalScrollIndicator={false}
          >
          <View style={styles.themeHeader}>
            <Image
              accessibilityLabel="شعار صلاتك"
              source={
                isDarkMode
                  ? require('../assets/branding/salatiq-logo-dark.png')
                  : require('../assets/branding/salatiq-logo-light.png')
              }
              resizeMode="contain"
              style={styles.brandLogo}
            />
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isDarkMode ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
                onPress={() => setIsDarkMode((current) => !current)}
                hitSlop={10}
                style={styles.themeButton}
              >
                <FontAwesomeIcon name={isDarkMode ? 'moon' : 'sun'} size={23} color={theme.brassSoft} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="المزيد"
                onPress={() => router.push({ pathname: '/more', params: themeParam(isDarkMode) })}
                hitSlop={10}
                style={styles.menuButton}
              >
                <FontAwesomeIcon name="bars" size={22} color={theme.brassSoft} />
              </Pressable>
            </View>
          </View>
          <View style={[styles.selector, { backgroundColor: theme.panel, borderColor: theme.line }]}>
            <Text style={[styles.selectorTitle, { color: theme.muted }]}>اختر الصلاة</Text>
            <View style={styles.prayerGrid}>
              {prayerTypes.map((prayer) => {
                const selected = selectedPrayer === prayer;
                return (
                  <Pressable
                    key={prayer}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => selectPrayer(prayer)}
                    style={({ pressed }) => [
                      styles.prayerOption,
                      { width: cardWidth },
                      { borderColor: selected ? theme.brass : theme.line, backgroundColor: selected ? theme.brassDim : 'rgba(255,255,255,0.025)' },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.prayerText, { color: selected ? theme.brassSoft : theme.muted }, selected && styles.prayerTextSelected]}>
                      {prayerConfig[prayer].arabicName}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <PrayerOverviewCard
            prayer={selectedPrayer}
            state={prayerState}
            isDarkMode={isDarkMode}
          />
          <PrayerCamera
            onStatusChange={setCameraStatus}
            engineStatus={engineStatus}
            onCheckEngine={checkConnection}
            onPoseDetected={(pose, confidence) => applyEngineEvent({ state: { currentPose: pose, confidence } })}
            onStartNewPrayerSession={startNewPrayerSession}
            sessionId={sessionId}
            prayerState={prayerState}
            preSujudTransitionStartedAt={prayerState.preSujudTransitionStartedAt}
            postSujudTransitionStartedAt={prayerState.postSujudTransitionStartedAt}
            firstTashahhudStartedAt={prayerState.firstTashahhudStartedAt}
            isDarkMode={isDarkMode}
          />

          <PrayerStageCard
            prayer={selectedPrayer}
            engineStatus={engineStatus}
            currentPose={prayerState.currentPose}
            state={prayerState}
            isDarkMode={isDarkMode}
          />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  // Use one RTL layout direction on iOS; row-reverse would mirror it twice.
  flex: { flex: 1, ...(Platform.OS === 'ios' ? { direction: 'rtl' as const } : {}) },
  content: { width: '100%', maxWidth: 460, alignSelf: 'center', paddingTop: 14, paddingBottom: 48 },
  themeHeader: { width: '100%', marginBottom: 10, minHeight: 54, paddingHorizontal: 4, flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse', alignItems: 'center', justifyContent: 'space-between', overflow: 'visible' },
  brandLogo: { width: 108, height: 54, flexShrink: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  themeButton: { width: 38, height: 38, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  menuButton: { width: 38, height: 38, minWidth: 44, minHeight: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  selector: { marginBottom: 22, padding: 16, borderRadius: 18, borderWidth: 1 },
  selectorTitle: { color: colors.muted, fontSize: 12, textAlign: 'center', writingDirection: 'rtl', marginBottom: 12 },
  prayerGrid: { flexDirection: Platform.OS === 'ios' ? 'row' : 'row-reverse', justifyContent: 'space-between', gap: 7 },
  prayerOption: { minHeight: 42, paddingHorizontal: 2, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  prayerText: { fontSize: 11.5, writingDirection: 'rtl' },
  prayerTextSelected: { fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
