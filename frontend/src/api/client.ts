import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { useTrace } from "../store/trace";

export const api = createClient<paths>({ baseUrl: "" });

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Run one API call, record it in the live engine trace (method, route, timing)
 * and unwrap the typed result. The trace is what lets a viewer see that every
 * answer is computed on request, not pre-baked.
 */
export async function traced<T>(
  label: string,
  route: string,
  call: () => Promise<{ data?: T; error?: unknown; response: Response }>,
  detail?: (data: T) => string,
): Promise<T> {
  const id = useTrace.getState().start(label, route);
  const started = performance.now();
  try {
    const { data, error, response } = await call();
    const ms = performance.now() - started;
    if (error || data === undefined) {
      const body = (error ?? {}) as { detail?: string; code?: string };
      const message = typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
      useTrace.getState().finish(id, ms, `failed · ${message}`, true);
      throw new ApiError(message, response.status, body.code);
    }
    useTrace.getState().finish(id, ms, detail ? detail(data) : `HTTP ${response.status}`);
    return data;
  } catch (err) {
    if (!(err instanceof ApiError)) {
      useTrace.getState().finish(id, performance.now() - started, "network error", true);
    }
    throw err;
  }
}
