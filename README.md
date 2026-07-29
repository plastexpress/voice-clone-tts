# voice-clone-tts

Serviço **local** de Text-to-Speech com clonagem de voz, rodando o
[MOSS-TTS Local](https://github.com/OpenMOSS/MOSS-TTS) na sua própria GPU.

- **API** (porta **8096**) — recebe `{"text": "..."}` com um token no header e devolve um arquivo **Opus**.
- **Interface** (porta **8095**) — login por usuário e senha para gerenciar tokens, clones de voz, cache e logs.
- **PocketBase** (porta **8090**) — banco de dados e autenticação.

Tudo em Docker, com CUDA, pensado para uma **RTX 3060 12GB**.

```
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  Interface   │  8095  │   Backend    │  8096  │  PocketBase  │  8090
│ React + Vite │───────▶│   FastAPI    │───────▶│   SQLite     │
│ estilo Notion│        │  MOSS-TTS    │        │  + auth      │
└──────────────┘        └──────┬───────┘        └──────────────┘
                               │
                        ┌──────▼───────┐
                        │  RTX 3060    │  fila de 1 job por vez
                        │  CUDA 12.8   │  cache local em ./data/audio
                        └──────────────┘
```

## Começando

```bash
./start.sh
```

O script cria `deploy/.env` a partir do exemplo, checa o acesso à GPU e sobe os três
containers. Na primeira execução o backend baixa ~10 GB de pesos do modelo.

Depois abra **http://localhost:8095** e entre com as credenciais de
`PB_INITIAL_USER_EMAIL` / `PB_INITIAL_USER_PASSWORD` do `deploy/.env`.

> **Antes de expor na rede, troque as senhas em `deploy/.env`.**

Para testar a stack inteira **sem GPU e sem download** (gerador sintético):

```bash
./start.sh --dev
```

## Uso da API

Crie um clone de voz e um token na interface. Depois:

```bash
curl -X POST http://localhost:8096/v1/tts \
  -H "Authorization: Bearer vct_seu_token" \
  -H "Content-Type: application/json" \
  -d '{"text": "Olá, tudo bem com você?"}' \
  --output fala.opus
```

O token já carrega a voz e os parâmetros configurados na interface — quem consome
a API só precisa mandar o texto. Textos repetidos vêm do cache local, sem passar
pela GPU.

## Estrutura

```
voice-clone-tts/
├── start.sh              sobe tudo no Docker
├── deploy/               docker-compose (produção e dev) + .env
├── database/             PocketBase: Dockerfile e migrations das coleções
├── backend/              FastAPI + MOSS-TTS (porta 8096)
│   └── app/
│       ├── main.py       aplicação e ciclo de vida
│       ├── auth.py       token no header + rate limit
│       ├── queue.py      fila com um worker de GPU
│       ├── cache.py      cache local dos áudios gerados
│       ├── audio.py      conversão para Opus via ffmpeg
│       └── tts/          motores: moss (GPU) e dummy (sem GPU)
├── frontend/             React + Vite + Tailwind (porta 8095)
├── docs/                 documentação
└── data/                 volumes: banco, áudios e pesos do modelo (gitignored)
```

## Documentação

| Documento | Assunto |
| --- | --- |
| [docs/arquitetura.md](docs/arquitetura.md) | Como as peças se encaixam e o caminho de uma requisição |
| [docs/instalacao.md](docs/instalacao.md) | Pré-requisitos, GPU no Docker, primeira execução |
| [docs/api.md](docs/api.md) | Referência completa dos endpoints |
| [docs/interface.md](docs/interface.md) | Guia da interface: tokens, clones, playground |
| [docs/modelo-de-dados.md](docs/modelo-de-dados.md) | Coleções do PocketBase |
| [docs/operacao.md](docs/operacao.md) | VRAM, desempenho, backup e problemas comuns |

## Comandos úteis

```bash
./start.sh --dev        # stack sem GPU (engine dummy)
./start.sh --build      # força rebuild das imagens
./start.sh --logs       # sobe e acompanha os logs
./start.sh --status     # estado dos containers
./start.sh --down       # derruba tudo (os dados em ./data continuam)
```

## Licença dos componentes

O MOSS-TTS é distribuído sob Apache 2.0. Este projeto apenas o consome como
dependência — respeite a licença do modelo ao usar as vozes geradas, e só clone
vozes que você tem autorização para usar.
