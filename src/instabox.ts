import { randomUUID } from "node:crypto";
import { config } from "./config.js";

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export class InstaBoxError extends Error {}

export async function api<T = any>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Query; idempotent?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(config.instaboxApiUrl + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === null) continue;
    for (const item of ([] as unknown[]).concat(v)) url.searchParams.append(k, String(item));
  }
  const headers: Record<string, string> = { "X-API-Key": config.instaboxApiKey, Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotent) headers["Idempotency-Key"] = randomUUID();
  Object.assign(headers, opts.headers);

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const e = data?.error;
    throw new InstaBoxError(
      `InstaBox ${res.status}` +
        (e ? ` ${e.code}: ${e.message}${e.retryable ? " (retryable)" : ""}${e.operationId ? ` [operation ${e.operationId}]` : ""}` : `: ${text}`),
    );
  }
  return data as T;
}

/**
 * Header InstaBox checks on machine and snapshot deletes: the ID or exact name of what is being
 * deleted. Anything else (or, for newer API keys, leaving it out) is 409 delete_confirmation_required
 * and nothing is deleted.
 */
export const confirmDelete = (idOrName: string) => ({ "X-Confirm-Delete": idOrName });

export interface Operation {
  id: string;
  machineId: string;
  type: string;
  state: "queued" | "running" | "succeeded" | "failed";
  phase?: string;
  error: { code: string; message: string } | null;
  machine?: unknown;
}

/** Long-poll an operation until it finishes or the wait budget runs out. */
export async function waitForOperation(op: Operation, maxSeconds = config.maxWaitSeconds) {
  const deadline = Date.now() + maxSeconds * 1000;
  let cur = op;
  while (!["succeeded", "failed"].includes(cur.state)) {
    const remaining = Math.floor((deadline - Date.now()) / 1000);
    if (remaining < 2) {
      return { ...cur, note: `Still ${cur.state}. Call get_operation with id ${cur.id} to keep following it.` };
    }
    cur = await api<Operation>("GET", `/v1/operations/${cur.id}`, { query: { wait: `${Math.min(25, remaining)}s` } });
  }
  return cur;
}
