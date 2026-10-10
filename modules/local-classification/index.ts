import { requireOptionalNativeModule } from 'expo';

type LocalClassificationModule = {
  checkAvailability(): Promise<boolean>;
  alertAudioUri?: string;
};

// Optional only to allow a useful error in Expo Go; there is no remote fallback.
export const localClassification =
  requireOptionalNativeModule<LocalClassificationModule>('LocalClassification');
