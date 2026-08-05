/** Chamadas ao backend de TTS (porta 8096, via proxy /api do nginx). */

import { config } from "./config";
import { pb } from "./pb";
import type { GenerationResult, SystemStatus } from "./types";

export type JobStatus = {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed" | "canceled";
  cached: boolean;
  audioId: string | null;
  durationMs: number;
  queueMs: number;
  generationMs: number;
  error: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  /** Cifra um token recém-gerado, pra guardar junto com o hash (permite revelar depois). */
  encryptToken: (raw: string) =>
    internal<{ encrypted: string }>("/tokens/encrypt", {
      method: "POST",
      body: JSON.stringify({ raw }),
    }),

  /** Devolve o valor original de um token salvo com `token_encrypted`. */
  revealToken: (tokenId: string) => internal<{ token: string }>(`/tokens/${tokenId}/reveal`),

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

  /**
   * Playground/produção em escala: enfileira e devolve na hora (202), sem
   * esperar a geração terminar. Evita o teto de ~100s que proxies/túneis na
   * frente da API costumam impor a uma resposta síncrona.
   */
  async submitAsync(rawToken: string, body: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${config.apiBase}/v1/tts/async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rawToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ApiError(await readError(response), response.status);
    const data = (await response.json()) as { job_id: string };
    return data.job_id;
  },

  async getJob(rawToken: string, jobId: string): Promise<JobStatus> {
    const response = await fetch(`${config.apiBase}/v1/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    if (!response.ok) throw new ApiError(await readError(response), response.status);
    const data = await response.json();
    return {
      jobId: data.job_id,
      status: data.status,
      cached: !!data.cached,
      audioId: data.audio_id || null,
      durationMs: Number(data.duration_ms || 0),
      queueMs: Number(data.queue_ms || 0),
      generationMs: Number(data.generation_ms || 0),
      error: data.error || null,
    };
  },

  /** Submete via /v1/tts/async e faz polling até terminar; baixa o áudio no final. */
  async generateAsync(
    rawToken: string,
    body: Record<string, unknown>,
    onTick?: (job: JobStatus) => void,
  ): Promise<GenerationResult> {
    const started = performance.now();
    const jobId = await this.submitAsync(rawToken, body);

    let job: JobStatus;
    while (true) {
      job = await this.getJob(rawToken, jobId);
      onTick?.(job);
      if (job.status === "completed" || job.status === "failed" || job.status === "canceled") break;
      await sleep(1500);
    }

    if (job.status !== "completed" || !job.audioId) {
      throw new ApiError(job.error || `job terminou como "${job.status}"`, 500);
    }

    const { url, blob } = await this.audioObjectUrl(job.audioId);
    return {
      url,
      blob,
      cached: job.cached,
      audioId: job.audioId,
      durationMs: job.durationMs,
      queueMs: job.queueMs,
      generationMs: job.generationMs,
      totalMs: Math.round(performance.now() - started),
      sizeBytes: blob.size,
      model: "",
      voice: "",
    };
  },

  /**
   * Playground: enfileira usando a sessão logada (não um token de API), então
   * sempre pode trocar voz e ajustar parâmetros — sem depender de nenhum
   * token ter `allow_overrides` ligado.
   */
  async playgroundSubmitAsync(body: Record<string, unknown>): Promise<string> {
    const data = await internal<{ job_id: string }>("/playground/tts/async", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return data.job_id;
  },

  async playgroundGetJob(jobId: string): Promise<JobStatus> {
    const data = await internal<Record<string, unknown>>(`/playground/jobs/${jobId}`);
    return {
      jobId: String(data.job_id),
      status: data.status as JobStatus["status"],
      cached: !!data.cached,
      audioId: (data.audio_id as string) || null,
      durationMs: Number(data.duration_ms || 0),
      queueMs: Number(data.queue_ms || 0),
      generationMs: Number(data.generation_ms || 0),
      error: (data.error as string) || null,
    };
  },

  /** Playground: submete via sessão e faz polling até terminar; baixa o áudio no final. */
  async generatePlaygroundAsync(
    body: Record<string, unknown>,
    onTick?: (job: JobStatus) => void,
  ): Promise<GenerationResult> {
    const started = performance.now();
    const jobId = await this.playgroundSubmitAsync(body);

    let job: JobStatus;
    while (true) {
      job = await this.playgroundGetJob(jobId);
      onTick?.(job);
      if (job.status === "completed" || job.status === "failed" || job.status === "canceled") break;
      await sleep(1500);
    }

    if (job.status !== "completed" || !job.audioId) {
      throw new ApiError(job.error || `job terminou como "${job.status}"`, 500);
    }

    const { url, blob } = await this.audioObjectUrl(job.audioId);
    return {
      url,
      blob,
      cached: job.cached,
      audioId: job.audioId,
      durationMs: job.durationMs,
      queueMs: job.queueMs,
      generationMs: job.generationMs,
      totalMs: Math.round(performance.now() - started),
      sizeBytes: blob.size,
      model: "",
      voice: "",
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
