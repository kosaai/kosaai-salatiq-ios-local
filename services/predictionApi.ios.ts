export type { PredictionPose, PredictionResponse } from './predictionApi';

// No network fallback. Native camera events supply all iOS predictions.
export async function predictImage(): Promise<never> {
  throw new Error('iOS predictions require the bundled front-camera Core ML classifier.');
}
