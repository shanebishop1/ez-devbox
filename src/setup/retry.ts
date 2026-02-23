export interface RetryPolicy {
  attempts: number;
  delayMs: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  attempts: 1,
  delayMs: 0
};

export type SleepFn = (delayMs: number) => Promise<void>;

export function validateRetryPolicy(policy: RetryPolicy): RetryPolicy {
  if (!Number.isInteger(policy.attempts) || policy.attempts <= 0) {
    throw new Error("Invalid retry policy attempts: expected a positive integer.");
  }

  if (!Number.isInteger(policy.delayMs) || policy.delayMs < 0) {
    throw new Error("Invalid retry policy delayMs: expected a non-negative integer.");
  }

  return policy;
}

export function resolveRetryPolicy(policy?: Partial<RetryPolicy>): RetryPolicy {
  return validateRetryPolicy({
    attempts: policy?.attempts ?? defaultRetryPolicy.attempts,
    delayMs: policy?.delayMs ?? defaultRetryPolicy.delayMs
  });
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options?: {
    sleep?: SleepFn;
    onRetry?: (error: unknown, attempt: number, nextAttempt: number) => void;
  }
): Promise<T> {
  const validated = validateRetryPolicy(policy);
  const sleep = options?.sleep ?? defaultSleep;

  let attempt = 1;
  while (attempt <= validated.attempts) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= validated.attempts) {
        throw error;
      }

      options?.onRetry?.(error, attempt, attempt + 1);
      if (validated.delayMs > 0) {
        await sleep(validated.delayMs);
      }
    }

    attempt += 1;
  }

  throw new Error("Retry operation failed unexpectedly.");
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
