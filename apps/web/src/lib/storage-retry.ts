export async function retryStorageRequest<T>(
  operation: () => Promise<T>,
  attempts = 4,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await pause(2 ** attempt * 200);
    }
  }
  throw lastError;
}
