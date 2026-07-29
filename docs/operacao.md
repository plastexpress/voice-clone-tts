# Operação

## Comandos do dia a dia

```bash
./start.sh              # sobe a stack
./start.sh --status     # estado dos containers
./start.sh --logs       # sobe e acompanha os logs
./start.sh --restart    # derruba e sobe
./start.sh --down       # para tudo (os dados em ./data continuam)
./start.sh --build      # força rebuild
```

Logs de um serviço só:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f backend
```

## VRAM

Medido numa RTX 3060 12 GB com o modelo padrão (`Local-Transformer-v1.5`, 5B, bf16):

| Item | VRAM |
| --- | --- |
| pesos do modelo | ~8,5 GB |
| **audio tokenizer** (`MOSS-Audio-Tokenizer-v2`) | **~4,2 GB** |
| cache de atenção (varia com o texto) | 0,3–1,5 GB |
| área de trabalho do Windows | 0,4–1,0 GB |

Somando, passa de 14 GB: **o tokenizer e o modelo não cabem juntos numa placa de
12 GB**. A saída é deixar o tokenizer na CPU, que é o padrão (`auto`) para GPUs
com menos de 16 GB:

```env
MOSS_TOKENIZER_DEVICE=auto   # cpu em GPUs <16GB, cuda nas maiores
```

O tokenizer só entra em ação nas pontas (codificar a referência do clone e
converter os tokens em forma de onda), então rodá-lo na CPU custa alguns
segundos por geração e libera a placa inteira para o modelo.

Se ainda aparecer erro `507` (VRAM insuficiente), na ordem:

1. Feche o que estiver usando a GPU (jogos, outro modelo, navegador com aceleração pesada).
2. Force `MOSS_TOKENIZER_DEVICE=cpu` (caso esteja em `cuda`).
3. Divida o texto em parágrafos — o cache reaproveita cada trecho.
4. Baixe `MOSS_MAX_NEW_TOKENS` (ex.: `2048`, ~160 s de fala).
5. Troque para o modelo menor:
   ```env
   MOSS_MODEL_ID=OpenMOSS-Team/MOSS-TTS-Local-Transformer
   ```
6. Em último caso, `MOSS_DTYPE=float16` (mesma memória do bf16, às vezes mais estável em Ampere).

### Espaço em disco

Os dois repositórios somam ~17 GB baixados em `data/hf-cache`:

| Repositório | Tamanho |
| --- | --- |
| `MOSS-TTS-Local-Transformer-v1.5` | 8,5 GB |
| `MOSS-Audio-Tokenizer-v2` | 8,0 GB |

Eles ficam **fora da imagem Docker**, num volume do host. Você pode apagar e
reconstruir a imagem à vontade que o download não se repete.

`PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` já vem ligado no `.env.example`
e ajuda contra fragmentação.

Na página **Sistema** você acompanha o uso de VRAM e pode **descarregar** o modelo
para liberar a placa sem derrubar o serviço.

## Desempenho

- A GPU atende **uma requisição por vez**; o resto espera na fila. É o comportamento
  correto para uma placa só — paralelizar deixaria tudo mais lento e estouraria a VRAM.
- O primeiro request depois do boot inclui o carregamento do modelo (dezenas de
  segundos). Com `MOSS_PRELOAD=true` isso acontece no boot, em segundo plano.
- Ordens de grandeza numa 3060: cerca de 1 a 3 segundos de processamento por
  segundo de áudio gerado. Uma frase curta sai em poucos segundos.
- **Cache hit responde em milissegundos.** Se seu caso tem textos repetidos
  (notificações, respostas padrão), a maior parte das chamadas nem toca na GPU.

## Timeouts

`SYNC_TIMEOUT_SECONDS` (padrão 300) é quanto o `POST /v1/tts` espera. Ao estourar,
a API responde `504` — **mas a geração continua** e o resultado vai para o cache.
Repetir a mesma chamada depois traz o áudio pronto.

Para textos longos, prefira `POST /v1/tts/async`.

O nginx da interface está com `proxy_read_timeout 900s`, então o Playground
aguenta gerações longas.

## Cache em disco

- Limite: `CACHE_MAX_GB` (padrão 20). Ao ultrapassar, os itens com `last_hit_at`
  mais antigo são apagados até voltar abaixo do limite.
- `CACHE_MAX_GB=0` desliga a limpeza automática.
- `CACHE_ENABLED=false` desliga o cache por completo (toda chamada passa pela GPU).
- Limpeza manual: página **Cache de áudio** → *Limpar tudo*.

Estimativa: 64 kbps mono ≈ **0,5 MB por minuto** de áudio. 20 GB dão cerca de
650 horas.

## Backup

```bash
./start.sh --down
tar czf backup-$(date +%F).tar.gz data/pocketbase data/audio
```

`data/hf-cache` não precisa de backup (é baixado de novo). Para restaurar, extraia
por cima de `data/` e suba de novo.

## Problemas comuns

### `could not select device driver "nvidia"`
O Docker não enxerga a GPU. Confira o driver NVIDIA no Windows, o WSL2 no Docker
Desktop e teste com `docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi`.

### Backend fica reiniciando no primeiro boot
Provavelmente ainda está baixando os pesos (~10 GB). O healthcheck tem
`start_period: 180s`; em conexões lentas, aumente esse valor no
`deploy/docker-compose.yml` ou use `MOSS_PRELOAD=false` para carregar só no
primeiro request.

### `ffmpeg não encontrado`
Rebuild da imagem do backend: `./start.sh --build`.

### 401 num token que deveria funcionar
- Confira se copiou o token inteiro (começa com `vct_`).
- Veja se está ativo e não expirou, na página **Tokens**.
- Alterações levam até 20 s para valer (`token_cache_ttl_seconds`).

### A interface abre mas nada carrega
Veja se os três containers estão de pé (`./start.sh --status`). A interface
conversa com o PocketBase por `/pb` e com o backend por `/api`, ambos via nginx —
se um deles estiver fora, aparece "backend offline" na barra lateral.

### O áudio saiu ruim / não parece a voz
- Áudio de referência com ruído, música ou muito curto costuma ser a causa.
- Preencha a transcrição da referência.
- Baixe a `temperature` (ex.: 1.3) para uma leitura mais estável, ou suba para
  mais expressividade.
- Confira se o `language` bate com o idioma do texto.

### Esqueci a senha do usuário da interface
Troque pela admin UI do PocketBase (`http://localhost:8090/_/` → *users*), com as
credenciais de `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`.

## Expondo na internet

O projeto nasceu para rede local. Antes de expor:

1. Troque **todas** as senhas do `deploy/.env`.
2. Ponha um proxy reverso com HTTPS na frente (Caddy, Traefik, nginx).
3. Não publique a porta 8090 do PocketBase — deixe só a interface e a API.
4. Ajuste `CORS_ORIGINS` no backend para os domínios que você usa (o padrão é `*`).
5. Considere marcar o campo `reference_audio` como `protected` na coleção `voices`
   (admin UI do PocketBase) e sirva os arquivos com file token — hoje a URL é
   pública, embora não-adivinhável.
6. Use `rate_limit_per_min` em todos os tokens.
7. Coloque data de expiração nos tokens de terceiros.

## Atualizando o MOSS-TTS

A imagem fixa o repositório por um argumento de build:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml build \
  --build-arg MOSS_TTS_REF=main backend
./start.sh --restart
```

Troque `main` por uma tag para fixar uma versão específica.
