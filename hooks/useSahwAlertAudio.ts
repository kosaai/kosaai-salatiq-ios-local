import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { localClassification } from '../modules/local-classification';
import { createSahwAudioEventTracker } from '../services/sahwAudio';
import type { PrayerState } from '../types/prayer';

// expo-asset embeds the exact MP3 into res/raw. This local URI also works in
// native debug builds: Android never falls back to a Metro/HTTP audio download.
const source = Platform.OS === 'android'
  ? { uri: 'file:///android_res/raw/subhan_allah.mp3' }
  : Platform.OS === 'ios'
    ? { uri: localClassification?.alertAudioUri ?? '' }
    : require('../assets/audio/subhan_allah.mp3');

export function useSahwAlertAudio(
  sessionId: number,
  { sahwAlerts, activeSahwEvent }: Pick<PrayerState, 'sahwAlerts' | 'activeSahwEvent'>,
) {
  // Starts loading on mount, before the camera countdown or first possible alert.
  // The Expo hook automatically releases the player on unmount.
  const player = useAudioPlayer(source, { downloadFirst: false });
  const status = useAudioPlayerStatus(player);
  const ready = useRef(false);
  const tracker = useRef(createSahwAudioEventTracker());
  const playback = useRef({
    alive: false,
    sessionId,
    generation: 0,
    pending: 0,
    phase: 'idle' as 'idle' | 'seeking' | 'playing',
  });

  const playNext = useCallback(() => {
    const current = playback.current;
    if (!current.alive || !ready.current || current.phase !== 'idle' || current.pending === 0) return;

    current.pending--;
    current.phase = 'seeking';
    const generation = current.generation;
    void player.seekTo(0).then(() => {
      if (!current.alive || generation !== current.generation) return;
      current.phase = 'playing';
      player.play();
    }).catch(() => {
      if (generation === current.generation) current.phase = 'idle';
      // Never retry the same event or let an audio failure affect prayer logic.
    });
  }, [player]);

  useEffect(() => {
    const current = playback.current;
    current.alive = true;
    player.loop = false;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => {});
    return () => {
      current.alive = false;
      current.generation++;
      current.pending = 0;
      current.phase = 'idle';
      ready.current = false;
    };
  }, [player]);

  useEffect(() => {
    const current = playback.current;
    // Unlike player.isLoaded, status.isLoaded remains true at Android STATE_ENDED,
    // allowing the next event to seek/replay this same already-loaded player.
    ready.current = status.isLoaded;
    if (status.didJustFinish && current.phase === 'playing') current.phase = 'idle';
    playNext(); // Only drains already-claimed events; status updates create none.
  }, [status.didJustFinish, status.isLoaded, playNext]);

  useEffect(() => {
    const current = playback.current;
    if (current.sessionId !== sessionId) {
      current.sessionId = sessionId;
      current.generation++;
      current.pending = 0;
      current.phase = 'idle';
      player.pause();
    }

    // Claim synchronously before starting any asynchronous seek/play work.
    current.pending += tracker.current.consume(sessionId, sahwAlerts, activeSahwEvent);
    playNext();
  }, [activeSahwEvent, sahwAlerts, sessionId, player, playNext]);
}
