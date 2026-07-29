/** Chamadas ao backend de TTS (porta 8096, via proxy /api do nginx). */

import { config } from "./config";
import { pb } from "./pb";
import type { GenerationResult, SystemStatus } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data?.detail || data?.error || response.statusText;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

/** Endpoints internos: autenticados com a sessão da interface. */
async function internal<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.apiBase}/internal${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pb.authStore.token}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

export const api = {
  status: () => internal<SystemStatus>("/status"),

  loadModel: () => internal<Record<string, unknown>>("/model/load", { method: "POST" }),

  unloadModel: () => internal<Record<string, unknown>>("/model/unload", { method: "POST" }),

  deleteCacheEntry: (id: string) =>
    internal<{ status: string }>(`/cache/${id}`, { method: "DELETE" }),

  purgeCache: () =>
    internal<{ status: string; removed: number }>("/cache/purge", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    }),

  /** Baixa um áudio do cache já autenticado e devolve uma object URL. */
  async audioObjectUrl(audioId: string): Promise<{ url: string; blob: Blob }> {
    const response = await fetch(`${config.apiBase}/v1/audio/${audioId}`, {
      headers: { Authorization: `Bearer ${pb.authStore.token}` },
    });
    if (!response.ok) throw new ApiError(await readError(response), response.status);
    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), blob };
  },

  /** Playground: gera áudio usando um token de API de verdade. */
  async generate(rawToken: string, body: Record<string, unknown>): Promise<GenerationResult> {
    const started = performance.now();
    const response = await fetch(`${config.apiBase}/v1/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rawToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new ApiError(await readError(response), response.status);

    const blob = await response.blob();
    const header = (name: string) => Number(response.headers.get(name) || 0);

    return {
      url: URL.createObjectURL(blob),
      blob,
      cached: response.headers.get("X-Cache") === "hit",
      audioId: response.headers.get("X-Audio-Id") || "",
      durationMs: header("X-Audio-Duration-Ms"),
      queueMs: header("X-Queue-Ms"),
      generationMs: header("X-Generation-Ms"),
      totalMs: header("X-Total-Ms") || Math.round(performance.now() - started),
      sizeBytes: blob.size,
      model: response.headers.get("X-Model") || "",
      voice: response.headers.get("X-Voice") || "",
    };
  },

  /** GET /v1/me com um token de API — mostra o que o token já traz configurado. */
  async tokenInfo(rawToken: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${config.apiBase}/v1/me`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    if (!response.ok) throw new ApiError(await readError(response), response.status);
    return (await response.json()) as Record<string, unknown>;
  },
};
