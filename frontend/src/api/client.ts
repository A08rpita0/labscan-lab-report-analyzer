import type { Analysis, ApiErrorBody, ConfigSummary, Health, Sample } from "./types";

/** A failed request, normalised so every error state can say what happened, what was
 *  processed, and what to do next - whether the server answered, timed out or was
 *  unreachable. */
export class ApiError extends Error {
  readonly code: string;
  readonly hint: string | null;
  readonly status: number;
  readonly requestId: string | null;
  readonly body: ApiErrorBody | null;

  constructor(code: string, message: string, opts: { hint?: string | null; status?: number; requestId?: string | null; body?: ApiErrorBody | null } = {}) {
    super(message);
    this.code = code;
    this.hint = opts.hint ?? null;
    this.status = opts.status ?? 0;
    this.requestId = opts.requestId ?? null;
    this.body = opts.body ?? null;
  }
}

export const ACCEPTED_EXTENSIONS = [".pdf", ".csv", ".tsv", ".txt", ".json"];
const CLIENT_TIMEOUT_MS = 90_000;
const STARTUP_TIMEOUT_MS = 45_000;

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = CLIENT_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const onAbort = () => controller.abort("cancelled");
  signal?.addEventListener("abort", onAbort);
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: controller.signal, headers: { Accept: "application/json", ...(init.headers || {}) } });
  } catch {
    if (controller.signal.aborted && controller.signal.reason === "cancelled") {
      throw new ApiError("cancelled", "The request was cancelled.");
    }
    if (controller.signal.aborted) {
      throw new ApiError("client_timeout", `No response within ${Math.round(timeoutMs / 1000)} seconds.`, {
        hint: "The server may be starting up or busy. Wait a moment and try again.",
      });
    }
    throw new ApiError("network_error", "The analysis service could not be reached.", {
      hint: "Check your connection. If the service was idle it may take a few seconds to wake up.",
    });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  const requestId = res.headers.get("x-request-id");
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = body as ApiErrorBody | null;
    throw new ApiError(b?.error?.code ?? `http_${res.status}`, b?.error?.message ?? b?.detail ?? `The server answered ${res.status}.`, {
      hint: b?.error?.hint ?? null,
      status: res.status,
      requestId: b?.request_id ?? requestId,
      body: b,
    });
  }
  if (body === null) {
    throw new ApiError("bad_response", "The server returned a response that could not be read.", { status: res.status, requestId });
  }
  return body as T;
}

export interface Demographics {
  sex?: "male" | "female" | "";
  age?: string;
}

function form(fields: Record<string, string | Blob | undefined>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== "") fd.append(k, v);
  }
  return fd;
}

export const api = {
  // Start-up requests allow for a sleeping free-tier host, which takes ~30 s to wake.
  health: () => request<Health>("/api/health", {}, STARTUP_TIMEOUT_MS),
  samples: () => request<Sample[]>("/api/samples", {}, STARTUP_TIMEOUT_MS),
  configSummary: () => request<ConfigSummary>("/api/config/summary", {}, STARTUP_TIMEOUT_MS),
  sampleInputUrl: (file: string) => `/api/samples/${encodeURIComponent(file)}`,
  analyseFile: (file: File, demo: Demographics, signal?: AbortSignal) =>
    request<Analysis>("/api/analyse", { method: "POST", body: form({ file, sex: demo.sex, age: demo.age }) }, CLIENT_TIMEOUT_MS, signal),
  analyseSample: (name: string, demo: Demographics, signal?: AbortSignal) =>
    request<Analysis>("/api/analyse/sample", { method: "POST", body: form({ file: name, sex: demo.sex, age: demo.age }) }, CLIENT_TIMEOUT_MS, signal),
};

/** Checks the browser can make before uploading anything. The server repeats every one
 *  of them; these exist so a wrong file is caught instantly, without a round trip. */
export function validateFile(file: File, maxMb: number): ApiError | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return new ApiError("unsupported_type", ext ? `Files of type '${ext}' are not supported.` : "This file has no extension, so its format cannot be identified.", {
      hint: "Upload a PDF (with selectable text), CSV, TSV, TXT or JSON report.",
    });
  }
  if (file.size === 0) {
    return new ApiError("empty_file", "The selected file is empty.", { hint: "Check that the export completed, then choose it again." });
  }
  if (file.size > maxMb * 1024 * 1024) {
    return new ApiError("file_too_large", `The file is larger than ${maxMb} MB.`, {
      hint: `Upload the report as a text PDF, CSV or JSON under ${maxMb} MB.`,
    });
  }
  return null;
}
