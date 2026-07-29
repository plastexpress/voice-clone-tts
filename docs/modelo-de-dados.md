# Modelo de dados (PocketBase)

Definido em [`database/pb_migrations/`](../database/pb_migrations/) e aplicado
automaticamente no boot do container. Admin UI em `http://localhost:8090/_/`.

O backend acessa como **superusuário** e ignora as regras de API. As regras
abaixo valem para a interface.

## users (auth, nativa)

Usuários da interface. A migration acrescenta o campo `role` (`admin` | `member`).
O primeiro usuário é criado a partir de `PB_INITIAL_USER_*`.

Regras: as padrão do PocketBase (cada um vê e edita o próprio registro).

## voices — clones de voz

| Campo | Tipo | Observação |
| --- | --- | --- |
| `name` | text | nome exibido |
| `slug` | text (único) | usado na API: `{"voice": "maria-narradora"}` |
| `description` | text | |
| `reference_audio` | file | até 25 MB, formatos de áudio comuns |
| `reference_text` | text | transcrição do áudio — melhora a clonagem |
| `language` | text | idioma principal |
| `owner` | relation → users | |
| `active` | bool | clones inativos são recusados pela API |

Regras: leitura para qualquer usuário logado; alterar e apagar só o dono.

## api_tokens

| Campo | Tipo | Observação |
| --- | --- | --- |
| `name` | text | identificação |
| `token_hash` | text (único, 64) | **sha256** do token — o valor em claro nunca é gravado |
| `token_prefix` | text | 12 primeiros caracteres, para exibição |
| `owner` | relation → users | apaga em cascata com o usuário |
| `voice` | relation → voices | clone padrão do token |
| `settings` | json | idioma, temperature, top_p, top_k, repetition_penalty, max_new_tokens, format, bitrate, channels |
| `allow_overrides` | bool | permite parâmetros no corpo do request |
| `active` | bool | |
| `expires_at` | date | vazio = não expira |
| `rate_limit_per_min` | number | 0 = sem limite |
| `last_used_at`, `request_count`, `cached_count` | | atualizados pelo backend |

Regras: só o dono lista, cria, edita e apaga.

## tts_cache — índice dos áudios gerados

| Campo | Observação |
| --- | --- |
| `cache_key` | sha256 (único) de texto + voz + parâmetros — a chave do cache |
| `text`, `text_length` | texto original |
| `voice`, `token` | quem gerou primeiro |
| `file_path` | caminho relativo dentro de `/data/audio` |
| `format`, `bitrate`, `sample_rate`, `channels` | formato entregue |
| `size_bytes`, `duration_ms`, `generation_ms` | métricas |
| `params` | snapshot dos parâmetros |
| `model_id` | modelo que gerou |
| `hits`, `last_hit_at` | usados na limpeza por LRU |

Regras: leitura para usuários logados; escrita e remoção só pelo backend
(a interface remove chamando `DELETE /internal/cache/{id}`, que também apaga o
arquivo do disco).

## tts_jobs — gerações assíncronas

`token`, `status` (`queued`/`processing`/`completed`/`failed`/`canceled`), `text`,
`params`, `cache` (→ tts_cache), `error`, `queue_ms`, `duration_ms`,
`started_at`, `finished_at`.

Jobs mais velhos que `JOB_RETENTION_HOURS` (padrão 48 h) são removidos por uma
rotina que roda de hora em hora.

## request_logs — auditoria

`token`, `token_name`, `endpoint`, `status_code`, `cached`, `text_preview`,
`text_length`, `queue_ms`, `duration_ms`, `audio_ms`, `voice_name`, `ip`, `error`.

Gravado em segundo plano, sem atrasar a resposta. Desligue com
`REQUEST_LOG_ENABLED=false`.

> Não há expurgo automático de logs. Se o volume crescer, apague pela admin UI do
> PocketBase ou crie uma rotina própria.

## Onde ficam os arquivos

| Caminho | Conteúdo |
| --- | --- |
| `data/pocketbase/` | banco SQLite e uploads (áudios de referência) |
| `data/audio/xx/yy/<chave>.opus` | áudios gerados (o cache) |
| `data/voices/<id>/<versão>.wav` | cópia normalizada da referência, usada na inferência |
| `data/hf-cache/` | pesos do modelo |

Backup: pare a stack e copie `data/pocketbase` e `data/audio`. O `data/hf-cache`
é recuperável (basta baixar de novo).
