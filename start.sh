#!/usr/bin/env bash
# =============================================================================
# voice-clone-tts — sobe toda a stack no Docker
#
#   ./start.sh                 sobe tudo (GPU, MOSS-TTS)      -> build se preciso
#   ./start.sh --build         força rebuild das imagens
#   ./start.sh --dev           sobe a stack sem GPU (engine dummy)
#   ./start.sh --code          stack GPU com o código montado do host (--reload,
#                              sem rebuild a cada alteração)
#   ./start.sh --logs          sobe e fica seguindo os logs
#   ./start.sh --down          derruba a stack
#   ./start.sh --restart       derruba e sobe de novo
#   ./start.sh --status        mostra o estado dos containers
#   ./start.sh --pull          atualiza as imagens base antes de buildar
#   ./start.sh --slim          rebuilda o backend cortando libs de multi-GPU (~1GB)
#
# Windows: rode pelo Git Bash ou WSL. Requer Docker Desktop com WSL2 + GPU.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
ENV_FILE="$DEPLOY_DIR/.env"
ENV_EXAMPLE="$DEPLOY_DIR/.env.example"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"

# --- cores -------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi
info()  { echo "${BLUE}==>${RESET} $*"; }
ok()    { echo "${GREEN}  ok${RESET} $*"; }
warn()  { echo "${YELLOW}  !!${RESET} $*"; }
die()   { echo "${RED}erro:${RESET} $*" >&2; exit 1; }

# --- flags -------------------------------------------------------------------
ACTION="up"
DO_BUILD=""
DO_PULL=""
FOLLOW_LOGS=""
DEV_MODE=""
CODE_MODE=""
SLIM=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dev)        DEV_MODE=1; COMPOSE_FILE="$DEPLOY_DIR/docker-compose.dev.yml" ;;
    --code)       CODE_MODE=1 ;;
    --build)      DO_BUILD="--build" ;;
    --slim)       SLIM=1; DO_BUILD="--build" ;;
    --pull)       DO_PULL=1 ;;
    --logs|-f)    FOLLOW_LOGS=1 ;;
    --down|--stop) ACTION="down" ;;
    --restart)    ACTION="restart" ;;
    --status|--ps) ACTION="status" ;;
    -h|--help)    sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            die "opção desconhecida: $1 (use --help)" ;;
  esac
  shift
done

[ -n "$DEV_MODE" ] && [ -n "$CODE_MODE" ] && die "--dev e --code não fazem sentido juntos"

# --- pré-requisitos ----------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker não encontrado no PATH."
docker info >/dev/null 2>&1 || die "Docker não está rodando. Abra o Docker Desktop e tente de novo."
docker compose version >/dev/null 2>&1 || die "Plugin 'docker compose' não encontrado (precisa do Compose v2)."
[ -f "$COMPOSE_FILE" ] || die "arquivo não encontrado: $COMPOSE_FILE"

# --- .env --------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  [ -f "$ENV_EXAMPLE" ] || die "faltando $ENV_EXAMPLE"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  warn "criei $ENV_FILE a partir do .env.example"
  warn "TROQUE as senhas em deploy/.env antes de expor este serviço na rede."
fi

# lê algumas variáveis para o resumo final
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true; }
FRONTEND_PORT="$(get_env FRONTEND_PORT)"; FRONTEND_PORT="${FRONTEND_PORT:-8095}"
API_PORT="$(get_env API_PORT)";           API_PORT="${API_PORT:-8096}"
PB_PORT="$(get_env PB_PORT)";             PB_PORT="${PB_PORT:-8090}"
TTS_ENGINE="$(get_env TTS_ENGINE)";       TTS_ENGINE="${TTS_ENGINE:-moss}"
[ -n "$DEV_MODE" ] && TTS_ENGINE="dummy"

DC=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
if [ -n "$CODE_MODE" ]; then
  DC+=(-f "$DEPLOY_DIR/docker-compose.gpu-dev.yml")
fi

# --- ações -------------------------------------------------------------------
case "$ACTION" in
  down)
    info "derrubando a stack..."
    "${DC[@]}" down
    ok "containers parados (os dados em ./data continuam intactos)"
    exit 0
    ;;
  status)
    "${DC[@]}" ps
    exit 0
    ;;
  restart)
    info "derrubando a stack..."
    "${DC[@]}" down
    ;;
esac

# --- pastas de dados ---------------------------------------------------------
if [ -n "$DEV_MODE" ]; then
  mkdir -p "$ROOT_DIR/data/dev/pocketbase" "$ROOT_DIR/data/dev/audio" "$ROOT_DIR/data/dev/voices"
else
  mkdir -p "$ROOT_DIR/data/pocketbase" "$ROOT_DIR/data/audio" "$ROOT_DIR/data/voices" "$ROOT_DIR/data/hf-cache"
fi

# --- checagem de GPU (só no modo produção) -----------------------------------
if [ -z "$DEV_MODE" ] && [ "$TTS_ENGINE" = "moss" ]; then
  if ! docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi >/dev/null 2>&1; then
    warn "não consegui acessar a GPU pelo Docker (--gpus all falhou)."
    warn "verifique: Docker Desktop > Settings > Resources > WSL Integration + driver NVIDIA atualizado."
    warn "para testar sem GPU: ./start.sh --dev"
    printf "continuar mesmo assim? [s/N] "
    read -r resp
    case "$resp" in [sSyY]*) ;; *) exit 1 ;; esac
  else
    ok "GPU acessível pelo Docker"
  fi
fi

# --- sobe --------------------------------------------------------------------
if [ -n "$DO_PULL" ]; then
  info "atualizando imagens base..."
  "${DC[@]}" build --pull
  DO_BUILD=""
fi

if [ -n "$SLIM" ]; then
  info "rebuildando o backend sem as libs de multi-GPU (nccl, nvshmem)..."
  "${DC[@]}" build --build-arg PRUNE_MULTIGPU=true backend
  DO_BUILD=""
fi

info "subindo a stack${DEV_MODE:+ (modo dev, engine dummy)}${CODE_MODE:+ (código montado do host, --reload)}..."
"${DC[@]}" up -d ${DO_BUILD}

echo
echo "${BOLD}voice-clone-tts no ar${RESET}"
echo "  ${BOLD}Interface${RESET}   http://localhost:${FRONTEND_PORT}"
echo "  ${BOLD}API${RESET}         http://localhost:${API_PORT}        ${DIM}(docs em /docs)${RESET}"
echo "  ${BOLD}PocketBase${RESET}  http://localhost:${PB_PORT}/_/"
echo "  ${BOLD}Engine${RESET}      ${TTS_ENGINE}"
echo
if [ -z "$DEV_MODE" ] && [ "$TTS_ENGINE" = "moss" ]; then
  echo "${DIM}Na primeira execução o backend baixa ~10GB de pesos do modelo."
  echo "Acompanhe com: docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f backend${RESET}"
  echo
fi

if [ -n "$FOLLOW_LOGS" ]; then
  "${DC[@]}" logs -f
fi
