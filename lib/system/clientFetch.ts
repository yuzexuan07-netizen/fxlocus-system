type RetryContext = {
  attempt: number;
  status: number;
  errorCode: string;
  rateLimited: boolean;
};

export type SystemJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  body: unknown;
  errorCode: string;
  retryAfterMs: number;
  rateLimited: boolean;
};

export type FetchSystemJsonOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  cache?: RequestCache;
  signal?: AbortSignal;
  timeoutMs?: number;
  dedupeKey?: string;
  dedupeWindowMs?: number;
  allowStaleOnRateLimit?: boolean;
  allowStaleOnServerError?: boolean;
  staleTtlMs?: number;
  preferStale?: boolean;
  revalidateInBackground?: boolean;
  retries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  retryOnRateLimit?: boolean;
  fresh?: boolean;
  skipInflight?: boolean;
  shouldRetry?: (ctx: RetryContext) => boolean;
};

const RATE_LIMIT_CODES = new Set(["RATE_LIMITED", "TOO_MANY_REQUESTS"]);
const RETRYABLE_CODES = new Set(["DB_BUSY", "SERVICE_UNAVAILABLE", "FETCH_FAILED"]);
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 260;
const DEFAULT_RETRY_MAX_MS = 1800;
const DEFAULT_DEDUPE_WINDOW_MS = 900;
const DEFAULT_STALE_TTL_MS = 15 * 60_000;
const DEFAULT_TIMEOUT_GET_MS = 12_000;
const DEFAULT_TIMEOUT_MUTATION_MS = 20_000;

const INFLIGHT = new Map<string, Promise<SystemJsonResult<any>>>();
const SHORT_CACHE = new Map<string, { exp: number; value: SystemJsonResult<any> }>();
const LAST_SUCCESS = new Map<string, { exp: number; value: SystemJsonResult<any> }>();

function getErrorCode(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const errorRaw =
    (body as any).error ??
    (body as any).code ??
    (typeof (body as any).message === "string" ? (body as any).message : "");
  return String(errorRaw || "").trim().toUpperCase();
}

function getRetryAfterMs(headers: Headers) {
  const retryAfter = Number(headers.get("retry-after") || "0");
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) return 0;
  return retryAfter * 1000;
}

function shouldRetryDefault(ctx: RetryContext) {
  if (ctx.rateLimited) return true;
  if (ctx.status === 503) return true;
  if (ctx.status >= 500) return true;
  if (RETRYABLE_CODES.has(ctx.errorCode)) return true;
  if (ctx.status === 0) return true;
  return false;
}

function toDedupeKey(url: string, method: string, explicit?: string) {
  if (explicit) return explicit;
  if (method.toUpperCase() !== "GET") return "";
  return `GET:${url}`;
}

function sweepShortCache(now: number) {
  if (!SHORT_CACHE.size) return;
  for (const [key, entry] of SHORT_CACHE.entries()) {
    if (entry.exp <= now) SHORT_CACHE.delete(key);
  }
}

function sweepLastSuccess(now: number) {
  if (!LAST_SUCCESS.size) return;
  for (const [key, entry] of LAST_SUCCESS.entries()) {
    if (entry.exp <= now) LAST_SUCCESS.delete(key);
  }
}

function writeSuccessCache<T>(
  dedupeKey: string,
  result: SystemJsonResult<T>,
  dedupeWindowMs: number,
  staleTtlMs: number
) {
  if (!dedupeKey || !result.ok) return;
  const now = Date.now();
  if (dedupeWindowMs > 0) {
    SHORT_CACHE.set(dedupeKey, {
      exp: now + dedupeWindowMs,
      value: result
    });
  }
  if (staleTtlMs > 0) {
    LAST_SUCCESS.set(dedupeKey, {
      exp: now + staleTtlMs,
      value: result
    });
  }
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function computeBackoffMs(attempt: number, retryBaseMs: number, retryMaxMs: number) {
  return Math.min(retryMaxMs, retryBaseMs * 2 ** attempt);
}

function withJitter(ms: number) {
  const normalized = Math.max(1, Math.floor(ms));
  const jitter = Math.floor(Math.random() * Math.max(25, Math.floor(normalized * 0.2)));
  return normalized + jitter;
}

function toAbortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function toTimeoutError() {
  return new DOMException("The operation timed out.", "TimeoutError");
}

function createTimedSignal(source: AbortSignal | undefined, timeoutMs: number) {
  if (timeoutMs <= 0) {
    return {
      signal: source,
      cleanup: () => {}
    };
  }

  const controller = new AbortController();
  let done = false;
  const clear = (timerId: number, onSourceAbort: (() => void) | null) => {
    if (done) return;
    done = true;
    window.clearTimeout(timerId);
    if (source && onSourceAbort) {
      source.removeEventListener("abort", onSourceAbort);
    }
  };

  const timerId = window.setTimeout(() => {
    controller.abort(toTimeoutError());
  }, timeoutMs);

  let onSourceAbort: (() => void) | null = null;
  if (source) {
    if (source.aborted) {
      controller.abort(source.reason ?? toAbortError());
    } else {
      onSourceAbort = () => controller.abort(source.reason ?? toAbortError());
      source.addEventListener("abort", onSourceAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => clear(timerId, onSourceAbort)
  };
}

async function runFetch<T>(url: string, options: FetchSystemJsonOptions): Promise<SystemJsonResult<T>> {
  const method = String(options.method || "GET").toUpperCase();
  const timeoutMs =
    Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Math.max(500, Number(options.timeoutMs))
      : method === "GET"
        ? DEFAULT_TIMEOUT_GET_MS
        : DEFAULT_TIMEOUT_MUTATION_MS;
  const retries = Math.max(0, Number(options.retries ?? DEFAULT_RETRIES));
  const retryBaseMs = Math.max(10, Number(options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS));
  const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS));
  const retryOnRateLimit =
    typeof options.retryOnRateLimit === "boolean" ? options.retryOnRateLimit : method === "GET";
  const shouldRetry = options.shouldRetry || shouldRetryDefault;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw toAbortError();

    let response: Response | null = null;
    let body: unknown = null;
    let status = 0;
    let retryAfterMs = 0;
    let errorCode = "";
    let contentType = "";

    const timed = createTimedSignal(options.signal, timeoutMs);
    try {
      response = await fetch(url, {
        method,
        headers: options.headers,
        body: options.body,
        cache: options.cache ?? "no-store",
        signal: timed.signal
      });
      status = response.status;
      retryAfterMs = getRetryAfterMs(response.headers);
      contentType = String(response.headers.get("content-type") || "").toLowerCase();
      body = await response.json().catch(() => null);
      errorCode = getErrorCode(body);
    } catch (error: any) {
      const wasExternalAbort = Boolean(options.signal?.aborted);
      const wasTimeout = error?.name === "TimeoutError";
      if (error?.name === "AbortError" && wasExternalAbort && !wasTimeout) {
        throw error;
      }
      if (attempt < retries) {
        const delayMs = withJitter(computeBackoffMs(attempt, retryBaseMs, retryMaxMs));
        await wait(delayMs);
        continue;
      }
      return {
        ok: false,
        status: 0,
        data: null,
        body: null,
        errorCode: "FETCH_FAILED",
        retryAfterMs: 0,
        rateLimited: false
      };
    } finally {
      timed.cleanup();
    }

    const payloadOk = body && typeof body === "object" && (body as any).ok === false ? false : true;
    const ok = response.ok && payloadOk;
    if (ok) {
      const data = body && typeof body === "object" && "data" in (body as any)
        ? ((body as any).data as T)
        : ((body as T) ?? null);
      return {
        ok: true,
        status,
        data,
        body,
        errorCode: "",
        retryAfterMs,
        rateLimited: false
      };
    }

    const rateLimited = status === 429 || RATE_LIMIT_CODES.has(errorCode);
    let retryable = shouldRetry({ attempt, status, errorCode, rateLimited });
    const cloudflareHtmlError =
      status >= 500 &&
      !errorCode &&
      (contentType.includes("text/html") || contentType.includes("text/plain"));
    if (cloudflareHtmlError) {
      // Cloudflare edge errors often return HTML bodies (e.g. 1102/5xx).
      // For idempotent reads, retry with backoff instead of surfacing instant "load_failed".
      retryable = method === "GET" || method === "HEAD";
    }
    if (rateLimited && !retryOnRateLimit) retryable = false;
    if (retryable && attempt < retries) {
      const delayMs =
        retryAfterMs > 0
          ? retryAfterMs + Math.floor(Math.random() * 250)
          : withJitter(computeBackoffMs(attempt, retryBaseMs, retryMaxMs) + 50 * attempt);
      await wait(delayMs);
      continue;
    }

    return {
      ok: false,
      status,
      data: null,
      body,
      errorCode,
      retryAfterMs,
      rateLimited
    };
  }

  return {
    ok: false,
    status: 0,
    data: null,
    body: null,
    errorCode: "FETCH_FAILED",
    retryAfterMs: 0,
    rateLimited: false
  };
}

export async function fetchSystemJson<T = any>(
  url: string,
  options: FetchSystemJsonOptions = {}
): Promise<SystemJsonResult<T>> {
  const method = String(options.method || "GET").toUpperCase();
  const fresh = Boolean(options.fresh && method === "GET");
  const dedupeKey = toDedupeKey(url, method, options.dedupeKey);
  const dedupeWindowMs = fresh
    ? 0
    : Math.max(0, Number(options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS));
  const staleTtlMs = Math.max(0, Number(options.staleTtlMs ?? DEFAULT_STALE_TTL_MS));
  const preferStale = method === "GET" ? (fresh ? false : options.preferStale !== false) : false;
  const revalidateInBackground = preferStale ? options.revalidateInBackground !== false : false;
  const allowStaleOnRateLimit =
    method === "GET"
      ? fresh
        ? false
        : typeof options.allowStaleOnRateLimit === "boolean"
          ? options.allowStaleOnRateLimit
          : preferStale
      : Boolean(options.allowStaleOnRateLimit);
  const allowStaleOnServerError =
    method === "GET"
      ? fresh
        ? false
        : typeof options.allowStaleOnServerError === "boolean"
          ? options.allowStaleOnServerError
          : preferStale
      : Boolean(options.allowStaleOnServerError);
  const bypassInflight =
    fresh ||
    Boolean(options.skipInflight) ||
    (method === "GET" && dedupeWindowMs === 0 && !preferStale && !revalidateInBackground);
  const now = Date.now();
  if (dedupeWindowMs > 0) sweepShortCache(now);
  if (staleTtlMs > 0) sweepLastSuccess(now);

  if (dedupeKey && dedupeWindowMs > 0) {
    const cached = SHORT_CACHE.get(dedupeKey);
    if (cached && cached.exp > now) {
      return cached.value as SystemJsonResult<T>;
    }
  }

  if (dedupeKey && preferStale) {
    const stale = LAST_SUCCESS.get(dedupeKey);
    if (stale && stale.exp > now) {
      if (revalidateInBackground && !INFLIGHT.has(dedupeKey)) {
        const backgroundOptions: FetchSystemJsonOptions = {
          ...options,
          preferStale: false
        };
        delete (backgroundOptions as any).signal;
        const backgroundTask = runFetch<T>(url, backgroundOptions)
          .then((fresh) => {
            writeSuccessCache(dedupeKey, fresh, dedupeWindowMs, staleTtlMs);
            return fresh;
          })
          .finally(() => {
            INFLIGHT.delete(dedupeKey);
          });
        INFLIGHT.set(dedupeKey, backgroundTask);
        void backgroundTask;
      }
      return stale.value as SystemJsonResult<T>;
    }
  }

  if (dedupeKey && !bypassInflight) {
    const pending = INFLIGHT.get(dedupeKey);
    if (pending) return (await pending) as SystemJsonResult<T>;
  }

  const task = runFetch<T>(url, options).finally(() => {
    if (dedupeKey && !bypassInflight) INFLIGHT.delete(dedupeKey);
  });

  if (dedupeKey && !bypassInflight) INFLIGHT.set(dedupeKey, task);
  const result = await task;

  if (dedupeKey) {
    writeSuccessCache(dedupeKey, result, dedupeWindowMs, staleTtlMs);
  }

  if (dedupeKey && !result.ok) {
    const transientFailure =
      result.status === 0 || RETRYABLE_CODES.has(result.errorCode) || result.errorCode === "SERVICE_UNAVAILABLE";
    const canUseStale =
      (result.rateLimited && allowStaleOnRateLimit) ||
      ((result.status >= 500 || transientFailure) && allowStaleOnServerError);
    if (canUseStale) {
      const stale = LAST_SUCCESS.get(dedupeKey);
      if (stale && stale.exp > Date.now()) {
        return stale.value as SystemJsonResult<T>;
      }
    }
  }

  return result;
}
