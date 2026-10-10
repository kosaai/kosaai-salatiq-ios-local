import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { checkEngineConnection, getEngineApiUrl } from '../services/engineConnection';
import type { EngineStatus } from '../types/prayer';

export function useEngineConnection() {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('disconnected');
  const requestId = useRef(0);

  const checkConnection = useCallback(async () => {
    const currentRequest = ++requestId.current;

    if (Platform.OS === 'web' && !getEngineApiUrl()) {
      setEngineStatus('disconnected');
      return 'disconnected' as const;
    }

    setEngineStatus('connecting');
    const result = await checkEngineConnection();

    if (currentRequest === requestId.current) {
      setEngineStatus(result);
    }

    return result;
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  return { engineStatus, checkConnection };
}
