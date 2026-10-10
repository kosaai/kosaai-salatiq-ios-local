import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, useAnimatedValue, View } from 'react-native';
import branding from '../assets/startup/provenance.json';

// Must run at module scope, before the Router mounts a screen and auto-hides it.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const MARK_WIDTH = 184; // Matches the native splash imageWidth, including padding.
const SCALE = MARK_WIDTH / branding.assets.mark.size[0];
const MARK_HEIGHT = branding.assets.mark.size[1] * SCALE;
const NAME_WIDTH = branding.assets.name.size[0] * SCALE;
const NAME_HEIGHT = branding.assets.name.size[1] * SCALE;
const GAP = 16;
const MARK_FINAL_Y = -(GAP + NAME_HEIGHT) / 2;
const NAME_FINAL_Y = (MARK_HEIGHT + GAP) / 2;

export function StartupSplash({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  const [laidOut, setLaidOut] = useState(false);
  const [markLoaded, setMarkLoaded] = useState(false);
  const [nameLoaded, setNameLoaded] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const reveal = useAnimatedValue(0);
  const opacity = useAnimatedValue(1);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {
      if (mounted) setReduceMotion(false);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!visible || !laidOut || !markLoaded || !nameLoaded || reduceMotion === null) return;

    let mounted = true;
    const timing = { useNativeDriver: true, isInteraction: false };
    const animation = reduceMotion
      ? Animated.timing(opacity, { ...timing, toValue: 0, duration: 180 })
      : Animated.sequence([
        Animated.delay(140), // A short logo-only first beat.
        Animated.timing(reveal, {
          ...timing, toValue: 1, duration: 640, easing: Easing.bezier(0.22, 0.61, 0.36, 1),
        }),
        Animated.delay(240),
        Animated.timing(opacity, {
          ...timing, toValue: 0, duration: 260, easing: Easing.inOut(Easing.quad),
        }),
      ]);

    if (reduceMotion) reveal.setValue(1);
    // Both bundled images have decoded and the app underneath has laid out.
    // Let that frame commit before handing off from the matching native screen.
    const frame = requestAnimationFrame(() => {
      SplashScreen.hide();
      animation.start(({ finished }) => {
        if (mounted && finished) setVisible(false);
      });
    });

    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
      animation.stop();
    };
  }, [laidOut, markLoaded, nameLoaded, opacity, reduceMotion, reveal, visible]);

  return (
    <View style={styles.root}>
      {/* Keep the navigator mounted throughout: no session/audio/camera remount. */}
      <View
        style={styles.app}
        onLayout={() => setLaidOut(true)}
        pointerEvents={visible ? 'none' : 'auto'}
        accessibilityElementsHidden={visible}
        importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {visible && (
        <Animated.View
          style={[styles.splash, { opacity }]}
          accessible
          accessibilityRole="image"
          accessibilityLabel="صلاتك — Salatiq"
        >
          <StatusBar style="dark" />
          <Animated.View style={[styles.mark, {
            transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, MARK_FINAL_Y] }) }],
          }]}>
            <Image
              source={require('../assets/startup/mark.png')}
              style={styles.image}
              resizeMode="contain"
              fadeDuration={0}
              onLoadEnd={() => setMarkLoaded(true)}
              accessible={false}
            />
          </Animated.View>
          <Animated.View style={[styles.name, {
            opacity: reveal,
            transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [NAME_FINAL_Y - 12, NAME_FINAL_Y] }) }],
          }]}>
            <Image
              source={require('../assets/startup/name.png')}
              style={styles.image}
              resizeMode="contain"
              fadeDuration={0}
              onLoadEnd={() => setNameLoaded(true)}
              accessible={false}
            />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: branding.backgroundColor },
  app: { flex: 1 },
  splash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: branding.backgroundColor,
    alignItems: 'center',
    zIndex: 1,
  },
  mark: { position: 'absolute', top: '50%', marginTop: -MARK_HEIGHT / 2, width: MARK_WIDTH, height: MARK_HEIGHT },
  name: { position: 'absolute', top: '50%', marginTop: -NAME_HEIGHT / 2, width: NAME_WIDTH, height: NAME_HEIGHT },
  image: { width: '100%', height: '100%' },
});
