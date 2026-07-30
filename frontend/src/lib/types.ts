/** Registros do PocketBase e respostas do backend. */

export type BaseRecord = {
  id: string;
  created: string;
  updated: string;
  collectionId?: string;
  collectionName?: string;
};

export type User = BaseRecord & {
  email: string;
  name?: string;
  role?: "admin" | "member";
  avatar?: string;
};

export type Voice = BaseRecord & {
  name: string;
  slug: string;
  description?: string;
  reference_audio?: string;
  reference_text?: string;
  language?: string;
  owner: string;
  active: boolean;
};

/** Parâmetros que o token aplica automaticamente em cada request. */
export type TokenSettings = {
  language?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  max_new_tokens?: number;
  duration_tokens?: number | null;
  speech_rate?: number;
  seed?: number | null;
  format?: "opus" | "wav";
  bitrate?: string;
  channels?: number;
};

export type ApiToken = BaseRecord & {
  name: string;
  token_hash: string;
  token_prefix: string;
  token_encrypted?: string;
  owner: string;
  voice?: string;
  settings?: TokenSettings;
  allow_overrides: boolean;
  active: boolean;
  expires_at?: string;
  rate_limit_per_min?: number;
  last_used_at?: string;
  request_count?: number;
  cached_count?: number;
  expand?: { voice?: Voice };
};

export type CacheEntry = BaseRecord & {
  cache_key: string;
  text: string;
  text_length: number;
  voice?: string;
  token?: string;
  file_path: string;
  format: string;
  bitrate: string;
  sample_rate: number;
  channels: number;
  size_bytes: number;
  duration_ms: number;
  generation_ms: number;
  model_id?: string;
  hits: number;
  last_hit_at?: string;
  expand?: { voice?: Voice; token?: ApiToken };
};

export type TtsJob = BaseRecord & {
  token?: string;
  status: "queued" | "processing" | "completed" | "failed" | "canceled";
  text: string;
  cache?: string;
  error?: string;
  queue_ms?: number;
  duration_ms?: number;
  started_at?: string;
  finished_at?: string;
  expand?: { token?: ApiToken; cache?: CacheEntry };
};

export type RequestLog = BaseRecord & {
  token?: string;
  token_name?: string;
  endpoint?: string;
  status_code: number;
  cached: boolean;
  text_preview?: string;
  text_length?: number;
  queue_ms?: number;
  duration_ms?: number;
  audio_ms?: number;
  voice_name?: string;
  ip?: string;
  error?: string;
};

export type GpuInfo = {
  name: string;
  total_mb: number;
  free_mb: number;
  used_mb: number;
  allocated_mb: number;
  reserved_mb: number;
  capability: string;
};

export type CacheStats = {
  entries: number;
  size_bytes: number;
  size_mb: number;
  audio_hours: number;
  hits: number;
  truncated: boolean;
  limit_gb: number;
  enabled: boolean;
};

export type SystemStatus = {
  engine: string;
  model: string;
  model_loaded: boolean;
  device: string;
  dtype?: string;
  queue_depth: number;
  queue_max: number;
  processing: boolean;
  current_job?: string | null;
  gpu?: GpuInfo | null;
  cache: CacheStats;
  uptime_seconds: number;
};

/** Resultado de uma geração feita no playground. */
export type GenerationResult = {
  url: string;
  blob: Blob;
  cached: boolean;
  audioId: string;
  durationMs: number;
  queueMs: number;
  generationMs: number;
  totalMs: number;
  sizeBytes: number;
  model: string;
  voice: string;
};
