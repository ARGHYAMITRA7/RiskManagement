"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiClientError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Human-readable message from an API error, including field-level validation messages. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (Array.isArray(err.details) && err.details.length) {
      const parts = err.details
        .map((d) => (d && typeof d === "object" && "message" in d ? String((d as { message: unknown }).message) : null))
        .filter(Boolean);
      if (parts.length) return `${err.message}: ${parts.join("; ")}`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    credentials: "same-origin",
    headers: {},
    cache: "no-store",
  };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiClientError("Network error. Check that the server is running.", 0);
  }
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiClientError((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status, (data as { details?: unknown } | null)?.details);
  }
  return data as T;
}

/** Simple data hook: fetches on mount and whenever `path` changes. Call reload() after mutations. */
export function useFetch<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: !!path,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path)
      .then((d) => alive && setState({ data: d, error: null, loading: false }))
      .catch((e) => alive && setState({ data: null, error: errorMessage(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function downloadUrl(url: string) {
  window.location.href = url;
}
