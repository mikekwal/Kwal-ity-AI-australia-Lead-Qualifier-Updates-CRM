// First try plus up to 3 retries (1s, 4s, 10s). Retries network errors, timeouts, 429 and 5xx.
// Fails fast on 400/401/403/404: those will not fix themselves.
const WAITS = [1000, 4000, 10000];
const NO_RETRY = new Set([400, 401, 403, 404]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function retry(fn, { onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= WAITS.length; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (NO_RETRY.has(err.status)) {
        err.message = `${err.message} (not retried: this will not fix itself)`;
        throw err;
      }
      if (attempt === WAITS.length) break;
      let wait = WAITS[attempt];
      if (err.status === 429 && err.retryAfter) {
        const s = Number(err.retryAfter);
        if (!Number.isNaN(s)) wait = Math.max(wait, s * 1000);
      }
      onRetry?.(attempt + 1, wait, err);
      await sleep(wait);
    }
  }
  throw lastErr;
}
