import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MinootsSDK, {
  type CreateTimerRequest,
  type DurationInput,
  type MinootsSDKOptions,
  type Timer,
} from '../minoots-sdk.js';

export interface UseMinootsTimerOptions extends Partial<CreateTimerRequest> {
  /**
   * Automatically start the timer when the component mounts.
   * Defaults to `true`.
   */
  autoStart?: boolean;
  /**
   * Polling interval (ms) while waiting for timer completion.
   * Defaults to 1000ms.
   */
  pollIntervalMs?: number;
  /**
   * Optional SDK instance. If omitted, the hook will create one using `sdkOptions`.
   */
  sdk?: MinootsSDK;
  /**
   * Options used when the hook creates its own SDK instance.
   */
  sdkOptions?: MinootsSDKOptions;
  /**
   * Callback invoked when the timer settles (expired/completed/etc.).
   */
  onSettled?: (timer: Timer) => void;
}

export interface UseMinootsTimerState {
  timer: Timer | null;
  status: 'idle' | 'creating' | 'running' | 'settled' | 'error';
  loading: boolean;
  error: unknown;
  start: (overrides?: { duration?: DurationInput } & Partial<CreateTimerRequest>) => Promise<Timer | null>;
  cancel: () => void;
  reset: () => void;
}

const DEFAULT_OPTIONS: UseMinootsTimerOptions = {
  autoStart: true,
  pollIntervalMs: 1000,
};

export function useMinootsTimer(
  duration: DurationInput,
  options: UseMinootsTimerOptions = DEFAULT_OPTIONS,
): UseMinootsTimerState {
  const {
    autoStart = true,
    pollIntervalMs = 1000,
    sdk: providedSdk,
    sdkOptions,
    onSettled,
    ...timerDefaults
  } = options;

  const sdk = useMemo(() => providedSdk ?? new MinootsSDK(sdkOptions), [providedSdk, sdkOptions]);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [status, setStatus] = useState<UseMinootsTimerState['status']>('idle');
  const [loading, setLoading] = useState<boolean>(Boolean(autoStart));
  const [error, setError] = useState<unknown>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setTimer(null);
    setStatus('idle');
    setLoading(false);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const start = useCallback<UseMinootsTimerState['start']>(
    async (overrides = {}) => {
      const effectiveDuration = overrides.duration ?? duration;
      if (!effectiveDuration) {
        throw new Error('Duration is required when starting a MINOOTS timer');
      }

      const controller = new AbortController();
      controllerRef.current?.abort();
      controllerRef.current = controller;

      setLoading(true);
      setStatus('creating');
      setError(null);

      try {
        const quickResponse = await sdk.quickWait(effectiveDuration, {
          ...timerDefaults,
          ...overrides,
        });

        const createdTimer = quickResponse?.timer ?? null;
        setTimer(createdTimer);
        setStatus('running');

        if (!createdTimer) {
          throw new Error('Timer creation response did not include a timer payload');
        }

        const finalTimer = await sdk.pollTimer(createdTimer.id, pollIntervalMs, {
          signal: controller.signal,
        });

        setTimer(finalTimer);
        setStatus('settled');
        setLoading(false);
        controllerRef.current = null;

        onSettled?.(finalTimer);
        return finalTimer;
      } catch (err) {
        if ((err as Error)?.name === 'MinootsError' && controller.signal.aborted) {
          setStatus('idle');
          setLoading(false);
          return null;
        }

        setError(err);
        setStatus('error');
        setLoading(false);
        controllerRef.current = null;
        return null;
      }
    },
    [duration, onSettled, pollIntervalMs, sdk, timerDefaults],
  );

  useEffect(() => {
    if (!autoStart) {
      setLoading(false);
      return undefined;
    }

    start().catch((err) => {
      setError(err);
      setStatus('error');
      setLoading(false);
    });

    return () => {
      controllerRef.current?.abort();
    };
  }, [autoStart, start]);

  return useMemo(
    () => ({
      timer,
      status,
      loading,
      error,
      start,
      cancel,
      reset,
    }),
    [cancel, error, loading, reset, start, status, timer],
  );
}

export default useMinootsTimer;
