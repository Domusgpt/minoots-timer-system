import { computed, onScopeDispose, ref, shallowRef, watch, watchEffect } from 'vue';
import MinootsSDK, {
  type CreateTimerRequest,
  type DurationInput,
  type MinootsSDKOptions,
  type Timer,
} from '../minoots-sdk.js';

type MaybeRef<T> = T | Readonly<{ value: T }>;

export interface UseMinootsTimerOptions extends Partial<CreateTimerRequest> {
  autoStart?: boolean;
  pollIntervalMs?: number;
  sdk?: MinootsSDK;
  sdkOptions?: MinootsSDKOptions;
  onSettled?: (timer: Timer) => void;
}

export interface UseMinootsTimerResult {
  timer: Readonly<{ value: Timer | null }>;
  status: Readonly<{ value: 'idle' | 'creating' | 'running' | 'settled' | 'error' }>;
  loading: Readonly<{ value: boolean }>;
  error: Readonly<{ value: unknown }>;
  start: (
    overrides?: { duration?: DurationInput } & Partial<CreateTimerRequest>,
  ) => Promise<Timer | null>;
  cancel: () => void;
  reset: () => void;
}

function toValue<T>(input: MaybeRef<T>): T {
  return (typeof input === 'object' && input !== null && 'value' in input)
    ? (input as Readonly<{ value: T }>).value
    : (input as T);
}

export function useMinootsTimer(
  duration: MaybeRef<DurationInput>,
  options: UseMinootsTimerOptions = {},
): UseMinootsTimerResult {
  const {
    autoStart = true,
    pollIntervalMs = 1000,
    sdk: providedSdk,
    sdkOptions,
    onSettled,
    ...timerDefaults
  } = options;

  const sdk = computed(() => providedSdk ?? new MinootsSDK(sdkOptions));
  const timer = shallowRef<Timer | null>(null);
  const status = ref<UseMinootsTimerResult['status']['value']>('idle');
  const loading = ref<boolean>(Boolean(autoStart));
  const error = ref<unknown>(null);
  const controller = ref<AbortController | null>(null);

  const reset = () => {
    controller.value?.abort();
    controller.value = null;
    timer.value = null;
    status.value = 'idle';
    loading.value = false;
    error.value = null;
  };

  const cancel = () => {
    controller.value?.abort();
  };

  const start: UseMinootsTimerResult['start'] = async (overrides = {}) => {
    const effectiveDuration = overrides.duration ?? toValue(duration);
    if (!effectiveDuration) {
      throw new Error('Duration is required when starting a MINOOTS timer');
    }

    const newController = new AbortController();
    controller.value?.abort();
    controller.value = newController;

    loading.value = true;
    status.value = 'creating';
    error.value = null;

    try {
      const quickResponse = await sdk.value.quickWait(effectiveDuration, {
        ...timerDefaults,
        ...overrides,
      });

      const createdTimer = quickResponse?.timer ?? null;
      timer.value = createdTimer;
      status.value = 'running';

      if (!createdTimer) {
        throw new Error('Timer creation response did not include a timer payload');
      }

      const finalTimer = await sdk.value.pollTimer(createdTimer.id, pollIntervalMs, {
        signal: newController.signal,
      });

      timer.value = finalTimer;
      status.value = 'settled';
      loading.value = false;
      controller.value = null;
      onSettled?.(finalTimer);
      return finalTimer;
    } catch (err) {
      if ((err as Error)?.name === 'MinootsError' && newController.signal.aborted) {
        status.value = 'idle';
        loading.value = false;
        return null;
      }

      error.value = err;
      status.value = 'error';
      loading.value = false;
      controller.value = null;
      return null;
    }
  };

  if (autoStart) {
    watchEffect(() => {
      start().catch((err) => {
        error.value = err;
        status.value = 'error';
        loading.value = false;
      });
    });
  } else {
    loading.value = false;
  }

  watch(
    () => toValue(duration),
    (newDuration, oldDuration) => {
      if (!autoStart || newDuration === oldDuration) {
        return;
      }
      start({ duration: newDuration }).catch((err) => {
        error.value = err;
        status.value = 'error';
        loading.value = false;
      });
    },
  );

  onScopeDispose(() => {
    controller.value?.abort();
  });

  return {
    timer,
    status,
    loading,
    error,
    start,
    cancel,
    reset,
  };
}

export default useMinootsTimer;
