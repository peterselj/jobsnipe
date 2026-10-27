export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
  }
}

/** GET JSON with a timeout and one retry on network errors or 5xx. 404s fail immediately. */
export async function getJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const r = await getJsonIfChanged<T>(url, undefined, timeoutMs);
  return r.data!;
}

/**
 * Like getJson, but sends the version tag (ETag) from last time; boards answer 304 with no body
 * when nothing changed, which is most hours. Returns { unchanged: true } then.
 */
export async function getJsonIfChanged<T>(
  url: string,
  etag?: string,
  timeoutMs = 30_000,
): Promise<{ unchanged?: true; data?: T; etag?: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": "JobSnipe/0.1 (personal job alerts)",
          // With a tag, fetch() would otherwise add "Cache-Control: no-cache", and some boards (Lever)
          // then send everything again instead of answering 304.
          ...(etag ? { "if-none-match": etag, "cache-control": "max-age=0" } : {}),
        },
      });
      if (res.status === 304) return { unchanged: true };
      // Same tag but a full answer anyway: nothing changed, so skip the work.
      if (etag && res.ok && res.headers.get("etag") === etag) {
        await res.body?.cancel();
        return { unchanged: true };
      }
      if (!res.ok) {
        const err = new HttpError(res.status, url);
        if (res.status < 500) throw err;
        lastErr = err;
        continue;
      }
      return { data: (await res.json()) as T, etag: res.headers.get("etag") ?? undefined };
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
