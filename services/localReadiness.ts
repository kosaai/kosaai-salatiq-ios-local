import type { EngineStatus } from '../types/prayer';

export function canStartLocalPrayer({ permissionGranted, cameraReady, cameraActive, foreground, engineStatus, prayerStarted, countdown, pendingSession }: {
  permissionGranted: boolean;
  cameraReady: boolean;
  cameraActive: boolean;
  foreground: boolean;
  engineStatus: EngineStatus;
  prayerStarted: boolean;
  countdown: number | null;
  pendingSession: number | null;
}) {
  return permissionGranted && cameraReady && cameraActive && foreground &&
    engineStatus === 'connected' && !prayerStarted && countdown === null && pendingSession === null;
}
