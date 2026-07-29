# Instalação

## Pré-requisitos

| Item | Versão | Observação |
| --- | --- | --- |
| Docker Desktop | 24+ com Compose v2 | no Windows, com backend **WSL2** |
| Driver NVIDIA | 550+ | o driver fica no host, não no container |
| GPU | RTX 3060 12GB ou superior | veja [operacao.md](operacao.md#vram) para placas menores |
| Disco | ~50 GB livres | ~17 GB de pesos + ~12 GB de imagem + cache de áudio |
| Git Bash ou WSL | — | para rodar o `start.sh` no Windows |

## GPU dentro do Docker (Windows)

1. Instale o driver NVIDIA mais recente **no Windows** (não instale driver dentro do WSL).
2. Docker Desktop → *Settings* → *General* → **Use the WSL 2 based engine**.
3. Docker Desktop → *Settings* → *Resources* → *WSL Integration* → habilite sua distro.
4. Teste:

```bash
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi
```

Se aparecer a tabela do `nvidia-smi` com a sua 3060, está pronto. O `start.sh`
faz esse teste sozinho antes de subir a stack.

## Primeira execução

```bash
git clone <seu-repo> voice-clone-tts
cd voice-clone-tts
./start.sh
```

O que acontece:

1. `deploy/.env` é criado a partir de `deploy/.env.example` (**edite as senhas**);
2. as pastas em `data/` são criadas;
3. o acesso à GPU é verificado;
4. as três imagens são construídas — a do backend demora (baixa PyTorch cu128 e o pacote MOSS-TTS);
5. os containers sobem.

Na **primeira requisição** (ou já no boot, se `MOSS_PRELOAD=true`) o backend baixa
os pesos — cerca de **17 GB** (8,5 GB do modelo + 8,0 GB do audio tokenizer),
gravados em `data/hf-cache/`. Eles ficam fora da imagem: você pode apagar e
reconstruir a imagem sem repetir o download. Acompanhe:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f backend
```

Quando aparecer `modelo pronto em NNs (sample rate 48000 Hz)`, o serviço está operacional.

## Acessos

| O quê | Endereço | Credenciais |
| --- | --- | --- |
| Interface | http://localhost:8095 | `PB_INITIAL_USER_EMAIL` / `PB_INITIAL_USER_PASSWORD` |
| API | http://localhost:8096 | token criado na interface |
| Documentação da API | http://localhost:8096/docs | — |
| PocketBase admin | http://localhost:8090/_/ | `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` |

## Modo de desenvolvimento (sem GPU)

Para mexer na interface ou validar a integração sem esperar o download do modelo:

```bash
./start.sh --dev
```

Sobe a mesma stack com `TTS_ENGINE=dummy` — um gerador sintético em Python puro.
Tudo funciona (tokens, clones, fila, cache, Opus), só o áudio é um zumbido
modulado em vez de fala. Os dados ficam separados, em `data/dev/`.

## Rodando o frontend fora do Docker

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173, com proxy para 8090 e 8096
```

O `vite.config.ts` já faz proxy de `/pb` e `/api` para os containers.

## Primeiros passos na interface

1. Entre em http://localhost:8095.
2. **Clones de voz → Novo clone**: envie de 3 a 10 segundos de fala limpa e escreva
   a transcrição exata do trecho.
3. **Tokens → Novo token**: dê um nome, escolha o clone e ajuste o que quiser.
   **Copie o token na hora** — ele só aparece uma vez.
4. **Playground**: escreva um texto e gere. Se sair como esperado, entregue o
   token para quem vai consumir a API.

## Iterando no backend sem rebuildar

Rebuildar depois de mexer no código já é rápido (~5 s: só a camada `COPY app`
muda). Mas dá para evitar o build por completo montando o código do host:

```bash
./start.sh --code
```

O uvicorn sobe com `--reload` e recarrega ao salvar o arquivo. Lembre que
recarregar o processo **recarrega o modelo na VRAM** (dezenas de segundos, lendo
do cache local) — isso é inerente a um serviço de GPU. Para iterar em código que
não depende do modelo, use `./start.sh --dev`, onde o reload é instantâneo.

## Tamanho da imagem

A imagem do backend fica na casa dos 11–12 GB. O piso é alto porque as wheels do
PyTorch cu128 trazem as bibliotecas CUDA embutidas:

| Item | Tamanho |
| --- | --- |
| bibliotecas NVIDIA (cudnn, cublas, cusparse, cusolver…) | ~4,4 GB |
| torch | ~1,7 GB |
| triton | ~0,6 GB |
| resto (transformers, scipy, numpy, ffmpeg, base Ubuntu) | ~1 GB |

O `Dockerfile` usa dois estágios, então `build-essential`, `python3-dev` e `git`
não vão para a imagem final. Para cortar mais ~600 MB removendo `nccl` e
`nvshmem` (multi-GPU/multi-nó, inúteis numa placa só):

```bash
./start.sh --slim
```

**Os pesos do modelo nunca entram na imagem** — ficam em `data/hf-cache`.

## Escolhendo o modelo

O padrão é o `MOSS-TTS-Local-Transformer-v1.5` (48 kHz estéreo, 31 idiomas). Ele
**só cabe numa 3060 de 12 GB com o audio tokenizer na CPU** (padrão `auto`, veja
[operacao.md](operacao.md#vram)). Se quiser tudo na GPU e mais velocidade, troque
no `deploy/.env`:

```env
MOSS_MODEL_ID=OpenMOSS-Team/MOSS-TTS-Local-Transformer
```

(1.7B, 24 kHz mono, ~5 GB de VRAM, bem mais rápido). Depois:

```bash
./start.sh --restart
```

## FlashAttention 2 (opcional)

Acelera e reduz o uso de VRAM, mas exige compilar com o `nvcc`. Em
`backend/Dockerfile`, troque a base para `nvidia/cuda:12.8.1-devel-ubuntu24.04` e
acrescente, depois da instalação do MOSS-TTS:

```dockerfile
RUN MAX_JOBS=4 pip install --extra-index-url https://download.pytorch.org/whl/cu128 \
    -e "/opt/moss-tts[torch-runtime,flash-attn]"
```

Sem ele o backend usa `sdpa`, que funciona bem — a detecção é automática.
