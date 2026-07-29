# Arquitetura

## Visão geral

Três containers, uma rede Docker interna (`vct`), três portas publicadas no host.

| Container | Porta | Papel |
| --- | --- | --- |
| `vct-frontend` | 8095 | Interface web (nginx servindo o build do Vite) |
| `vct-backend` | 8096 | API pública de TTS (FastAPI) + inferência na GPU |
| `vct-pocketbase` | 8090 | Banco de dados, autenticação e admin UI |

O navegador fala **só com o frontend**: o nginx faz proxy de `/pb` para o
PocketBase e de `/api` para o backend. Isso evita CORS e mantém uma única origem.
Clientes externos (seus sistemas) falam direto com a porta 8096.

```
navegador ──▶ nginx :80 ─┬─▶ /pb/*  ──▶ pocketbase:8090
                         └─▶ /api/* ──▶ backend:8096

cliente externo ─────────────────────▶ backend:8096  (Authorization: Bearer vct_…)
```

## Por que o PocketBase

É um binário único com SQLite, autenticação por e-mail/senha, upload de arquivos e
uma admin UI pronta. O backend acessa como **superusuário** (ignora as regras de
API); a interface acessa como **usuário logado**, sujeita às regras por coleção
definidas nas migrations.

Isso significa que grande parte do CRUD da interface (tokens, clones) acontece
direto entre o navegador e o PocketBase — o backend só é chamado para o que
envolve GPU, arquivos de áudio gerados ou estado do sistema.

## Caminho de uma requisição

```
POST /v1/tts  { "text": "..." }
  │
  ├─ 1. auth.py       hash sha256 do token → busca em api_tokens (cache de 20s)
  │                   valida ativo/expirado + rate limit por minuto
  │
  ├─ 2. params.py     mescla: padrão do serviço ← settings do token ← body
  │                   (o body só entra se allow_overrides estiver ligado)
  │
  ├─ 3. cache.py      chave = sha256(texto + voz + versão da voz + parâmetros)
  │                   acerto → devolve o arquivo do disco. Fim. (sem GPU)
  │
  ├─ 4. queue.py      enfileira; um worker por vez
  │      ├─ voices.py       baixa o áudio de referência do PocketBase (1ª vez)
  │      │                  e normaliza para WAV mono em /data/voices
  │      ├─ tts/moss.py     processor.build_user_message(text, reference=[...])
  │      │                  model.generate(...) → torchaudio.save(WAV)
  │      └─ audio.py        ffmpeg -c:a libopus → /data/audio/xx/yy/<chave>.opus
  │
  ├─ 5. cache.py      grava o índice em tts_cache
  └─ 6. resposta      audio/ogg + headers X-Cache, X-Audio-Duration-Ms, …
```

### A fila

A RTX 3060 processa **uma geração por vez**. Todos os requests entram numa
`asyncio.Queue` atendida por um único worker, que executa a parte pesada num
`ThreadPoolExecutor` de uma thread — o event loop continua respondendo enquanto a
GPU trabalha.

Uma propriedade útil: se um cliente síncrono desiste por timeout, **o job continua
até o fim** e o resultado vai para o cache. A próxima chamada com o mesmo texto é
instantânea.

Para textos longos existe o caminho assíncrono (`POST /v1/tts/async` +
`GET /v1/jobs/{id}`), que espelha o estado do job na coleção `tts_jobs`.

### O cache

A chave inclui tudo que muda o áudio: texto, id do clone, `updated` do clone
(trocar o áudio de referência invalida o cache), idioma, parâmetros de amostragem,
formato, bitrate, canais, engine e modelo.

- Binários: `data/audio/<2 chars>/<2 chars>/<chave>.opus` (fragmentado para não criar um diretório gigante)
- Índice: coleção `tts_cache` no PocketBase
- Limite: `CACHE_MAX_GB`; ao ultrapassar, os itens de `last_hit_at` mais antigo são removidos

## Camada de motores

`app/tts/base.py` define a interface; há duas implementações:

- **`moss`** — MOSS-TTS Local na GPU. Carrega `AutoProcessor` + `AutoModel` com
  `trust_remote_code`, resolve `flash_attention_2` → `sdpa` → `eager` conforme o
  que estiver disponível, e passa os parâmetros `audio_temperature`, `audio_top_p`,
  `audio_top_k` e `audio_repetition_penalty`.
- **`dummy`** — gerador sintético em Python puro, sem GPU e sem download. Usado
  pela stack `--dev` para validar interface, tokens, fila, cache e Opus.

Trocar de motor é uma variável de ambiente (`TTS_ENGINE`). Adicionar um terceiro
motor é implementar `TTSEngine` e registrá-lo em `app/tts/__init__.py`.

## Segurança

- O token da API é gerado **no navegador** (32 bytes aleatórios via WebCrypto). O
  servidor recebe e guarda apenas o `sha256` — um token perdido não é recuperável,
  só rotacionável.
- Uma cópia em claro fica no `localStorage` **deste navegador** apenas para o
  Playground funcionar sem colar o token toda vez.
- O áudio gerado fica no volume do backend e só é servido com token de API ou
  sessão da interface (`GET /v1/audio/{id}`).
- O áudio de referência dos clones fica no PocketBase com URL não-adivinhável.
  Como o serviço é de rede local, o campo não usa arquivos protegidos — se for
  expor na internet, veja [operacao.md](operacao.md#expondo-na-internet).
