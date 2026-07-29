# Referência da API

Base: `http://localhost:8096` · Documentação interativa: `/docs`

## Autenticação

Todo endpoint sob `/v1` exige o token no header:

```
Authorization: Bearer vct_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Também aceito: `X-API-Key: vct_…`.

| Situação | Resposta |
| --- | --- |
| sem header | `401` |
| token inexistente | `401` |
| token desativado | `403` |
| token expirado | `403` |
| acima do `rate_limit_per_min` | `429` + `Retry-After` |

---

## POST /v1/tts

Gera o áudio e devolve o arquivo. Este é o endpoint principal.

### Corpo

Só `text` é obrigatório. Os demais campos **só são aceitos se o token tiver
`allow_overrides` ligado** — caso contrário a API responde `403`.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `text` | string | **obrigatório**. Texto a ser falado (limite: `TTS_MAX_TEXT_LENGTH`, padrão 5000) |
| `voice` | string | slug ou id do clone |
| `language` | string | `"Portuguese"`, `"English"`, … |
| `format` | `opus` \| `wav` | padrão `opus` |
| `bitrate` | string | ex.: `"64k"` |
| `channels` | 1 \| 2 | padrão 1 (mono) |
| `temperature` | float | padrão 1.7 |
| `top_p` | float | padrão 0.8 |
| `top_k` | int | padrão 25 |
| `repetition_penalty` | float | padrão 1.0 |
| `max_new_tokens` | int | teto de tokens de áudio |
| `duration_tokens` | int | controle de duração — 1 s ≈ 12,5 tokens |
| `seed` | int | torna a geração reproduzível |
| `cache` | bool | `false` força regerar mesmo havendo cache |

### Resposta

`200 OK` com `Content-Type: audio/ogg` e o arquivo `.opus` no corpo.

| Header | Significado |
| --- | --- |
| `X-Cache` | `hit` (veio do disco) ou `miss` (passou pela GPU) |
| `X-Audio-Id` | id do áudio, usável em `GET /v1/audio/{id}` |
| `X-Audio-Duration-Ms` | duração do áudio |
| `X-Queue-Ms` | tempo esperando na fila |
| `X-Generation-Ms` | tempo de síntese |
| `X-Total-Ms` | tempo total do request |
| `X-Voice` | slug do clone usado |
| `X-Model` | modelo que gerou |
| `X-Sample-Rate` | taxa de amostragem |

### Exemplos

```bash
curl -X POST http://localhost:8096/v1/tts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Bom dia! Seu pedido saiu para entrega."}' \
  --output fala.opus
```

```python
import requests

resp = requests.post(
    "http://localhost:8096/v1/tts",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={"text": "Bom dia! Seu pedido saiu para entrega."},
    timeout=300,
)
resp.raise_for_status()
open("fala.opus", "wb").write(resp.content)
print("cache:", resp.headers["X-Cache"], resp.headers["X-Audio-Duration-Ms"], "ms")
```

### Resposta em JSON

`POST /v1/tts?format=json` devolve o áudio em base64:

```json
{
  "id": "v38f8rqswedsi2q",
  "audio_base64": "T2dnUwACAAAA…",
  "format": "opus",
  "mime_type": "audio/ogg",
  "duration_ms": 2006,
  "size_bytes": 16439,
  "sample_rate": 48000,
  "channels": 1,
  "cached": false,
  "voice": "maria-narradora",
  "model": "OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5",
  "queue_ms": 0,
  "generation_ms": 253,
  "total_ms": 281
}
```

### Erros

| Código | Quando |
| --- | --- |
| `403` | override enviado num token que não permite |
| `404` | clone de voz inexistente |
| `413` | texto acima do limite |
| `422` | corpo inválido |
| `503` | fila cheia |
| `504` | passou de `SYNC_TIMEOUT_SECONDS` — **a geração continua** e vai para o cache; repita o request |
| `507` | VRAM insuficiente |

---

## POST /v1/tts/async

Mesmo corpo do `/v1/tts`, mas responde na hora com um job. Use para textos longos.

```json
{
  "job_id": "icxbiest4v49hne",
  "status": "queued",
  "status_url": "/v1/jobs/icxbiest4v49hne",
  "queue_position": 2
}
```

Se o texto já estiver em cache, o job já nasce `completed`.

## GET /v1/jobs/{job_id}

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

`status`: `queued` · `processing` · `completed` · `failed` · `canceled`.
Um job só pode ser consultado pelo token que o criou.

## GET /v1/audio/{audio_id}

Baixa um áudio já gerado. Aceita token de API ou sessão da interface.

## GET /v1/me

O que o token já traz configurado — útil para o cliente descobrir a voz e os
parâmetros sem adivinhar.

```json
{
  "name": "integração do site",
  "prefix": "vct_sFReo65Q",
  "active": true,
  "allow_overrides": false,
  "voice": { "id": "…", "slug": "maria-narradora", "name": "Maria narradora", "language": "Portuguese", "has_reference_audio": true },
  "defaults": { "language": "Portuguese", "temperature": 1.7, "top_p": 0.8, "top_k": 25, "format": "opus", "bitrate": "64k", "channels": 1 },
  "request_count": 128,
  "cached_count": 43,
  "rate_limit_per_min": 0
}
```

## GET /v1/voices

Clones disponíveis. Sem `allow_overrides`, devolve só a voz do próprio token.

## GET /v1/status

Motor, fila, GPU e cache. Mesmo payload que a interface usa.

## GET /health

Sem autenticação — usado pelo healthcheck do Docker.

```json
{ "status": "ok", "version": "1.0.0", "engine": "moss", "model": "…", "model_loaded": true, "device": "cuda", "pocketbase": true }
```

---

## Como o cache funciona

A chave é o `sha256` de: texto + clone (e a data de modificação dele) + idioma +
parâmetros de amostragem + formato + bitrate + canais + engine + modelo.

Consequências práticas:

- o mesmo texto pedido duas vezes devolve **exatamente o mesmo arquivo**, sem GPU;
- dois tokens diferentes com a mesma configuração **compartilham** o cache;
- trocar o áudio de referência de um clone invalida o cache daquele clone;
- `{"cache": false}` regera e **substitui** o arquivo em cache;
- `seed` faz parte da chave: sem seed, o cache é o que garante consistência entre chamadas.

## Recomendações de integração

- Use timeout de cliente **maior** que `SYNC_TIMEOUT_SECONDS` (padrão 300 s) ou o caminho assíncrono.
- Em `504`, repita a mesma requisição depois de alguns segundos: a geração terminou em segundo plano e a resposta virá do cache.
- Divida textos muito longos em parágrafos: além de mais rápido, o cache é reaproveitado por trecho.
- `.opus` toca nativamente em navegadores, Android, Telegram e WhatsApp. Para telefonia, use `"bitrate": "32k"` e `channels: 1`.
