/** Retry an async op with exponential backoff + jitter while `shouldRetry` says so. */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
  { attempts = 4, baseMs = 300 }: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  let result = await fn();
  for (let i = 1; i < attempts && shouldRetry(result); i++) {
    await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1) + Math.random() * baseMs));
    result = await fn();
  }
  return result;
}
