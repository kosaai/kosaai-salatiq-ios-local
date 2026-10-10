import { requireNativeView } from 'expo';
import type { LocalClassificationCameraProps } from './LocalClassificationCamera';

// No facing prop is passed to iOS: native capture has exactly one front device.
const NativeCamera = requireNativeView<Omit<LocalClassificationCameraProps, 'facing'>>('LocalClassification');
export function LocalClassificationCamera({ facing: _facing, ...props }: LocalClassificationCameraProps) {
  return <NativeCamera {...props} />;
}
