# Mapa da API — Voice Clone TTS (para agente de IA)

> Documento de referência rápida para um agente de IA consumir esta API por conta própria.
> Fluxo recomendado: **assíncrono com polling** (evita timeout de requisição síncrona).

## 1. Essencial

| | |
|---|---|
| Base URL | `https://voice-api.plastexpress.com.br` |
| Auth | header `Authorization: Bearer vct_xxxxx...` (ou `X-API-Key: vct_xxxxx...`) |
| Content-Type | `application/json` no corpo dos POSTs |
| Docs interativas | `GET /docs` (Swagger) |
| Health (sem auth) | `GET /health` |

Erros de auth: `401` sem token/token inexistente · `403` token desativado/expirado · `429` rate limit (header `Retry-After`).

## 2. Decisão: síncrono ou assíncrono?

O endpoint síncrono `POST /v1/tts` tem timeout de **300s** (`SYNC_TIMEOUT_SECONDS`). Se estourar, responde `504` **mas a geração continua rodando em segundo plano** e o áudio vai parar no cache — só que você perdeu a resposta.

**Regra prática para um agente automatizado: sempre use `POST /v1/tts/async` + polling em `GET /v1/jobs/{id}`.** Isso remove o problema de timeout por completo — a chamada inicial responde na hora (`202`) e você consulta o status quantas vezes quiser, sem limite de tempo. Use o endpoint síncrono só se o seu cliente aceitar ficar bloqueado por até 5 minutos em uma única chamada HTTP (não é o caso típico de um agente).

## 3. Fluxo recomendado (assíncrono + polling)

### Passo 1 — criar o job

```http
POST /v1/tts/async
Authorization: Bearer vct_xxxxx
Content-Type: application/json

{
  "text": "Texto a ser falado."
}
```

Resposta `202`:

```json
{
  "job_id": "icxbiest4v49hne",
  "status": "queued",
  "status_url": "/v1/jobs/icxbiest4v49hne",
  "queue_position": 2
}
```

Se o texto já estiver em cache, o job já nasce `status: "completed"` — vale checar antes de entrar no loop de polling.

### Passo 2 — consultar o status até terminar

```http
GET /v1/jobs/{job_id}
Authorization: Bearer vct_xxxxx
```

```json
{
  "job_id": "icxbiest4v49hne",
  "status": "completed",
  "audio_url": "/v1/audio/4k4rfjb7jzf9dxe",
  "audio_id": "4k4rfjb7jzf9dxe",
  "duration_ms": 2578,
  "queue_ms": 0,
  "generation_ms": 292,
  "error": null
}
```

`status` possíveis: `queued` → `processing` → `completed` | `failed` | `canceled`.
Só o token que criou o job pode consultá-lo (`403` se for de outro token).

Estratégia de polling sugerida: intervalo inicial de 1–2s com backoff até ~5s, sem timeout total (jobs de textos longos podem levar minutos). Pare quando `status` for `completed`, `failed` ou `canceled`.

### Passo 3 — baixar o áudio

```http
GET /v1/audio/{audio_id}
Authorization: Bearer vct_xxxxx
```

Devolve o binário `.opus` (`audio/ogg`) direto — ou monte a URL completa com `Base URL + audio_url` do passo 2.

### Alternativa ao polling: webhook

Se o agente tiver um endpoint HTTP público acessível, pode mandar `callback_url` no `POST /v1/tts/async` em vez de fazer polling — a API chama essa URL sozinha quando o job terminar (até 3 tentativas com backoff se o endpoint estiver fora do ar).

```json
{
  "text": "Texto a ser falado.",
  "callback_url": "https://seu-endpoint.com/webhooks/tts-pronto",
  "callback_headers": {"X-Api-Key": "um-token-seu-para-validar-a-chamada"}
}
```

Corpo recebido no `callback_url`:

```json
{
  "job_id": "icxbiest4v49hne",
  "status": "completed",
  "cached": false,
  "audio_url": "https://voice-api.plastexpress.com.br/v1/audio/4k4rfjb7jzf9dxe",
  "audio_id": "4k4rfjb7jzf9dxe",
  "duration_ms": 2578,
  "queue_ms": 0,
  "generation_ms": 292,
  "error": null,
  "finished_at": "2026-07-30 03:23:01.468310Z"
}
```

Restrições: só `http://`/`https://`, não pode apontar para `localhost`/IP privado/serviços internos do docker-compose (proteção contra SSRF). O resultado sempre fica disponível em `GET /v1/jobs/{id}` mesmo se o callback falhar — não é preciso escolher exclusivamente um método ou outro.

Autenticação do callback no seu servidor: `callback_token` (atalho → vira `Authorization: Bearer <valor>`) ou `callback_headers` (headers livres, até 20; vence em caso de colisão com `callback_token`).

## 4. Campos do corpo (`POST /v1/tts` e `/v1/tts/async` — mesmo schema)

Só `text` é obrigatório. **Todos os demais campos exigem que o token tenha `allow_overrides` ligado** — sem isso, enviar qualquer um deles retorna `403`. Descubra as permissões e defaults do seu token em `GET /v1/me` antes de tentar overrides.

| Campo | Tipo | Notas |
|---|---|---|
| `text` | string | obrigatório, limite `TTS_MAX_TEXT_LENGTH` (padrão 5000 chars) |
| `voice` | string | slug ou id do clone |
| `language` | string | `"Portuguese"`, `"English"`, `"Spanish"`, … |
| `format` | `"opus"` \| `"wav"` | padrão `opus` |
| `bitrate` | string | ex.: `"64k"`; use `"32k"` + `channels: 1` para telefonia |
| `channels` | 1 \| 2 | padrão 1 |
| `temperature` | float (0, 3] | padrão 1.7 |
| `top_p` | float (0, 1] | padrão 0.8 |
| `top_k` | int [0, 500] | padrão 25 |
| `repetition_penalty` | float [0.5, 3] | padrão 1.0 |
| `max_new_tokens` | int [32, 32768] | teto de tokens de áudio |
| `duration_tokens` | int ≥ 1 | controle direto de duração (1s ≈ 12.5 tokens); tem prioridade sobre `speech_rate` |
| `speech_rate` | float (0.4, 2.5] | 1.0 normal, 1.3 ≈30% mais rápido, 0.7 ≈30% mais devagar — é o modelo falando diferente, não pós-processamento |
| `seed` | int ≥ 0 | reprodutibilidade |
| `instruction` | string, máx. 500 | instrução livre (sotaque/emoção/entonação), ex. `"fale com sotaque americano"` — não oficial, tentativa e erro |
| `cache` | bool | `false` força regerar mesmo com cache disponível |
| `callback_url` | string | só em `/v1/tts/async` |
| `callback_token` | string | ver seção 3 |
| `callback_headers` | objeto | ver seção 3 |

## 5. Descoberta antes de chamar

- `GET /v1/me` → nome/voz/limites/defaults do token, incluindo se `allow_overrides` está ligado.
- `GET /v1/voices` → clones disponíveis (sem `allow_overrides`, só devolve a voz do próprio token).
- `GET /v1/status` → engine, fila, GPU, cache — útil para decidir se vale a pena esperar ou tentar depois.

## 6. Erros a tratar

| Código | Situação | Ação recomendada do agente |
|---|---|---|
| `401` | token ausente/inválido | parar e reportar — reconfigurar token |
| `403` | token desativado/expirado, ou override sem `allow_overrides` | parar e reportar |
| `404` | clone de voz inexistente / job de outro token | verificar `voice` enviado |
| `413` | texto acima do limite | dividir o texto em partes menores |
| `422` | corpo inválido (schema) | corrigir payload |
| `429` | rate limit do token | respeitar `Retry-After` e tentar de novo |
| `503` | fila cheia | backoff e retry |
| `504` (só no `/v1/tts` síncrono) | passou do timeout, geração continua em background | repetir a mesma chamada depois de alguns segundos (cai no cache) — ou trocar para o fluxo assíncrono |
| `507` | VRAM insuficiente | reduzir `max_new_tokens` ou tentar depois |

## 7. Cache (por que repetir a mesma chamada é seguro/barato)

Chave = hash de texto + clone (+ versão do áudio de referência) + idioma + parâmetros de amostragem + formato/bitrate/canais + engine/modelo. Implicações:

- mesmo texto + mesma config → mesmo áudio, sem gastar GPU de novo;
- `seed` entra na chave — sem `seed`, é o cache que garante repetibilidade entre chamadas;
- `{"cache": false}` força regenerar e substitui o arquivo cacheado;
- dividir textos longos em parágrafos aproveita cache por trecho e acelera jobs grandes.

## 8. Exemplo completo (Python, fluxo assíncrono com polling)

```python
import time
import requests

BASE = "https://voice-api.plastexpress.com.br"
TOKEN = "vct_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

def gerar_audio(texto: str) -> bytes:
    r = requests.post(f"{BASE}/v1/tts/async", headers=HEADERS, json={"text": texto}, timeout=30)
    r.raise_for_status()
    job = r.json()

    status = job["status"]
    job_id = job["job_id"]
    delay = 1.0
    while status in ("queued", "processing"):
        time.sleep(delay)
        delay = min(delay * 1.5, 5.0)
        r = requests.get(f"{BASE}/v1/jobs/{job_id}", headers=HEADERS, timeout=30)
        r.raise_for_status()
        job = r.json()
        status = job["status"]

    if status != "completed":
        raise RuntimeError(f"job {job_id} terminou como {status}: {job.get('error')}")

    r = requests.get(f"{BASE}{job['audio_url']}", headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.content  # bytes do .opus

audio_bytes = gerar_audio("Bom dia! Seu pedido saiu para entrega.")
open("saida.opus", "wb").write(audio_bytes)
```

---
Fonte: `docs/api.md` do repositório (gerado a partir do código atual em `backend/app/routers/{tts,jobs,meta,system}.py`, `schemas.py`, `config.py`, `webhooks.py`).
