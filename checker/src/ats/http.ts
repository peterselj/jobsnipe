export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
  }
}

/** GET JSON with a timeout and one retry on network errors or 5xx. 404s fail immediately. */
export async function getJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "JobSnipe/0.1 (personal job alerts)" },
      });
      if (!res.ok) {
        const err = new HttpError(res.status, url);
        if (res.status < 500) throw err;
        lastErr = err;
        continue;
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) throw e;
      lastErr = e;
    }
  }
  // Node's fetch hides the useful part ("ENOTFOUND", "ECONNRESET") in `cause`.
  const cause = (lastErr as { cause?: { code?: string; message?: string } })?.cause;
  if (lastErr instanceof Error && cause) {
    throw new Error(`${lastErr.message} (${cause.code ?? cause.message}) for ${url}`);
  }
  throw lastErr;
}
