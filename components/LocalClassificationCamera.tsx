import type { ViewProps } from 'react-native';
import type { PredictionResponse } from '../services/predictionApi';

export type LocalClassificationCameraProps = ViewProps & {
  facing: 'front' | 'back';
  inferenceEnabled: boolean;
  sessionId: number;
  onCameraReady: () => void;
  onCameraUnavailable?: () => void;
  onPrediction: (event: { nativeEvent: PredictionResponse & { sessionId: number } }) => void;
  onMountError: (event: { nativeEvent: { message: string } }) => void;
};

export function LocalClassificationCamera(_props: LocalClassificationCameraProps) {
  return null;
}
