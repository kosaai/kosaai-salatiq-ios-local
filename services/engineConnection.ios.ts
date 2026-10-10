import { localClassification } from '../modules/local-classification';
import type { EngineStatus } from '../types/prayer';

export function getEngineApiUrl(): null { return null; }

// Loads and validates the bundled Core ML model. Session readiness is reported
// separately by the front-camera view after its first actual video frame.
export async function checkEngineConnection(): Promise<EngineStatus> {
  try {
    return (await localClassification?.checkAvailability()) ? 'connected' : 'error';
  } catch {
    return 'error';
  }
}
