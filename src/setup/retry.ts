export interface RetryPolicy {
  attempts: number;
  delayMs: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  attempts: 1,
  delayMs: 0
};
