/** A Telegram Bot API error. */
export class TelegramError extends Error {
  readonly status: number;
  /** Seconds to wait, when Telegram limits the request rate. */
  readonly retryAfter: number | undefined;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Telegram answered 400, so nothing was sent. */
export class RejectedError extends TelegramError {}

/** The Bot API server. Tests point it at a fake one. */
export function apiBase(): string {
  return process.env.PI_TELEGRAM_API_BASE ?? "https://api.telegram.org";
}

export interface CallOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/** Call a Bot API method and return its result. Error messages never contain the token. */
export async function callTelegram<T>(
  token: string,
  method: string,
  body: Record<string, unknown> | FormData,
  options: CallOptions = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeout ?? 15_000);
  const response = await fetch(`${apiBase()}/bot${token}/${method}`, {
    method: "POST",
    ...(body instanceof FormData
      ? { body }
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
  });
  let result: { ok?: boolean; description?: string; result?: T; parameters?: { retry_after?: number } };
  try {
    result = await response.json() as typeof result;
  } catch {
    result = {};
  }
  if (!response.ok || result.ok !== true) {
    const reason = (result.description || `Telegram request failed (HTTP ${response.status}).`).split(token).join("[redacted]");
    const ErrorType = response.status === 400 ? RejectedError : TelegramError;
    throw new ErrorType(reason, response.status, result.parameters?.retry_after);
  }
  return result.result as T;
}

/** Download a file that getFile returned. */
export async function downloadTelegramFile(token: string, filePath: string, signal?: AbortSignal): Promise<Uint8Array> {
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(`${apiBase()}/file/bot${token}/${filePath}`, {
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  if (!response.ok) throw new TelegramError(`Telegram file download failed (HTTP ${response.status}).`, response.status);
  return new Uint8Array(await response.arrayBuffer());
}
