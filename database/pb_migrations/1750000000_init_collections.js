/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// voice-clone-tts — schema inicial
//
// Coleções:
//   users        (auth, nativa)  usuários da interface  + campo `role`
//   voices                        clones de voz (áudio de referência)
//   api_tokens                    tokens da API + configuração por token
//   tts_cache                     índice dos áudios .opus já gerados
//   tts_jobs                      jobs assíncronos de geração
//   request_logs                  log de requisições da API
//
// O backend acessa tudo como superusuário (ignora as API rules).
// As rules abaixo valem para a interface (usuário logado com e-mail/senha).
// =============================================================================

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    // -------------------------------------------------------------------------
    // users: papel do usuário na interface
    // -------------------------------------------------------------------------
    if (!users.fields.getByName("role")) {
      users.fields.add(
        new Field({
          type: "select",
          name: "role",
          required: false,
          maxSelect: 1,
          values: ["admin", "member"],
        })
      );
      app.save(users);
    }

    // -------------------------------------------------------------------------
    // voices — clones de voz
    // -------------------------------------------------------------------------
    const voices = new Collection({
      type: "base",
      name: "voices",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != "" && owner = @request.auth.id',
      updateRule: "owner = @request.auth.id",
      deleteRule: "owner = @request.auth.id",
      fields: [
        { type: "text", name: "name", required: true, max: 120, presentable: true },
        {
          type: "text",
          name: "slug",
          required: true,
          max: 60,
          // usado na API: {"voice": "maria-narradora"}
          pattern: "^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$",
        },
        { type: "text", name: "description", required: false, max: 500 },
        {
          type: "file",
          name: "reference_audio",
          required: false,
          maxSelect: 1,
          maxSize: 26214400, // 25 MB
          protected: false,
          mimeTypes: [
            "audio/wav",
            "audio/x-wav",
            "audio/wave",
            "audio/mpeg",
            "audio/mp3",
            "audio/flac",
            "audio/x-flac",
            "audio/ogg",
            "audio/opus",
            "audio/mp4",
            "audio/x-m4a",
            "audio/aac",
            "video/mp4",
          ],
        },
        // transcrição do áudio de referência — melhora bastante a clonagem
        { type: "text", name: "reference_text", required: false, max: 2000 },
        { type: "text", name: "language", required: false, max: 40 },
        {
          type: "relation",
          name: "owner",
          required: true,
          maxSelect: 1,
          collectionId: users.id,
          cascadeDelete: false,
        },
        { type: "bool", name: "active" },
        { type: "autodate", name: "created", onCreate: true, onUpdate: false },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_voices_slug` ON `voices` (`slug`)",
        "CREATE INDEX `idx_voices_owner` ON `voices` (`owner`)",
      ],
    });
    app.save(voices);

    // -------------------------------------------------------------------------
    // api_tokens — token da API + configuração aplicada a quem usa o token
    // -------------------------------------------------------------------------
    const apiTokens = new Collection({
      type: "base",
      name: "api_tokens",
      listRule: "owner = @request.auth.id",
      viewRule: "owner = @request.auth.id",
      createRule: '@request.auth.id != "" && owner = @request.auth.id',
      updateRule: "owner = @request.auth.id",
      deleteRule: "owner = @request.auth.id",
      fields: [
        { type: "text", name: "name", required: true, max: 120, presentable: true },
        // sha256 do token; o valor em claro nunca é gravado
        { type: "text", name: "token_hash", required: true, min: 64, max: 64 },
        // prefixo exibido na interface, ex.: "vct_a1b2c3d4"
        { type: "text", name: "token_prefix", required: true, max: 32 },
        {
          type: "relation",
          name: "owner",
          required: true,
          maxSelect: 1,
          collectionId: users.id,
          cascadeDelete: true,
        },
        // clone de voz padrão deste token
        {
          type: "relation",
          name: "voice",
          required: false,
          maxSelect: 1,
          collectionId: voices.id,
          cascadeDelete: false,
        },
        // { language, temperature, top_p, top_k, repetition_penalty,
        //   max_new_tokens, bitrate, channels, format, speed_tokens }
        { type: "json", name: "settings", maxSize: 20000 },
        // permite que o cliente sobrescreva os parâmetros no body do request
        { type: "bool", name: "allow_overrides" },
        { type: "bool", name: "active" },
        { type: "date", name: "expires_at" },
        { type: "number", name: "rate_limit_per_min", onlyInt: true, min: 0 },
        { type: "date", name: "last_used_at" },
        { type: "number", name: "request_count", onlyInt: true, min: 0 },
        { type: "number", name: "cached_count", onlyInt: true, min: 0 },
        { type: "autodate", name: "created", onCreate: true, onUpdate: false },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_api_tokens_hash` ON `api_tokens` (`token_hash`)",
        "CREATE INDEX `idx_api_tokens_owner` ON `api_tokens` (`owner`)",
      ],
    });
    app.save(apiTokens);

    // -------------------------------------------------------------------------
    // tts_cache — índice dos arquivos .opus salvos em disco
    // (os arquivos ficam no volume do backend, em /data/audio)
    // -------------------------------------------------------------------------
    const ttsCache = new Collection({
      type: "base",
      name: "tts_cache",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null, // só o backend (superusuário)
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "cache_key", required: true, min: 64, max: 64 },
        { type: "text", name: "text", required: true, max: 20000 },
        { type: "number", name: "text_length", onlyInt: true, min: 0 },
        {
          type: "relation",
          name: "voice",
          required: false,
          maxSelect: 1,
          collectionId: voices.id,
          cascadeDelete: false,
        },
        {
          type: "relation",
          name: "token",
          required: false,
          maxSelect: 1,
          collectionId: apiTokens.id,
          cascadeDelete: false,
        },
        // caminho relativo dentro de /data/audio
        { type: "text", name: "file_path", required: true, max: 300 },
        { type: "text", name: "format", required: false, max: 20 },
        { type: "text", name: "bitrate", required: false, max: 20 },
        { type: "number", name: "sample_rate", onlyInt: true, min: 0 },
        { type: "number", name: "channels", onlyInt: true, min: 0 },
        { type: "number", name: "size_bytes", onlyInt: true, min: 0 },
        { type: "number", name: "duration_ms", onlyInt: true, min: 0 },
        { type: "number", name: "generation_ms", onlyInt: true, min: 0 },
        { type: "json", name: "params", maxSize: 20000 },
        { type: "text", name: "model_id", required: false, max: 200 },
        { type: "number", name: "hits", onlyInt: true, min: 0 },
        { type: "date", name: "last_hit_at" },
        { type: "autodate", name: "created", onCreate: true, onUpdate: false },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_tts_cache_key` ON `tts_cache` (`cache_key`)",
        "CREATE INDEX `idx_tts_cache_last_hit` ON `tts_cache` (`last_hit_at`)",
        "CREATE INDEX `idx_tts_cache_voice` ON `tts_cache` (`voice`)",
      ],
    });
    app.save(ttsCache);

    // -------------------------------------------------------------------------
    // tts_jobs — geração assíncrona
    // -------------------------------------------------------------------------
    const ttsJobs = new Collection({
      type: "base",
      name: "tts_jobs",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "relation",
          name: "token",
          required: false,
          maxSelect: 1,
          collectionId: apiTokens.id,
          cascadeDelete: false,
        },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["queued", "processing", "completed", "failed", "canceled"],
        },
        { type: "text", name: "text", required: true, max: 20000 },
        { type: "json", name: "params", maxSize: 20000 },
        {
          type: "relation",
          name: "cache",
          required: false,
          maxSelect: 1,
          collectionId: ttsCache.id,
          cascadeDelete: false,
        },
        { type: "text", name: "error", required: false, max: 2000 },
        { type: "number", name: "queue_ms", onlyInt: true, min: 0 },
        { type: "number", name: "duration_ms", onlyInt: true, min: 0 },
        { type: "date", name: "started_at" },
        { type: "date", name: "finished_at" },
        { type: "autodate", name: "created", onCreate: true, onUpdate: false },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX `idx_tts_jobs_status` ON `tts_jobs` (`status`)",
        "CREATE INDEX `idx_tts_jobs_created` ON `tts_jobs` (`created`)",
      ],
    });
    app.save(ttsJobs);

    // -------------------------------------------------------------------------
    // request_logs — auditoria das chamadas da API
    // -------------------------------------------------------------------------
    const requestLogs = new Collection({
      type: "base",
      name: "request_logs",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "relation",
          name: "token",
          required: false,
          maxSelect: 1,
          collectionId: apiTokens.id,
          cascadeDelete: false,
        },
        { type: "text", name: "token_name", required: false, max: 120 },
        { type: "text", name: "endpoint", required: false, max: 120 },
        { type: "number", name: "status_code", onlyInt: true, min: 0 },
        { type: "bool", name: "cached" },
        { type: "text", name: "text_preview", required: false, max: 300 },
        { type: "number", name: "text_length", onlyInt: true, min: 0 },
        { type: "number", name: "queue_ms", onlyInt: true, min: 0 },
        { type: "number", name: "duration_ms", onlyInt: true, min: 0 },
        { type: "number", name: "audio_ms", onlyInt: true, min: 0 },
        { type: "text", name: "voice_name", required: false, max: 120 },
        { type: "text", name: "ip", required: false, max: 60 },
        { type: "text", name: "error", required: false, max: 500 },
        { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      ],
      indexes: [
        "CREATE INDEX `idx_request_logs_created` ON `request_logs` (`created`)",
        "CREATE INDEX `idx_request_logs_token` ON `request_logs` (`token`)",
      ],
    });
    app.save(requestLogs);
  },

  // ---------------------------------------------------------------------------
  // rollback
  // ---------------------------------------------------------------------------
  (app) => {
    for (const name of ["request_logs", "tts_jobs", "tts_cache", "api_tokens", "voices"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (err) {
        // coleção já removida
      }
    }

    try {
      const users = app.findCollectionByNameOrId("users");
      const role = users.fields.getByName("role");
      if (role) {
        users.fields.removeByName("role");
        app.save(users);
      }
    } catch (err) {
      // nada a desfazer
    }
  }
);
