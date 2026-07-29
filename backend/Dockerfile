# =============================================================================
# Backend GPU — FastAPI + MOSS-TTS Local (CUDA 12.8 / RTX 3060)
#
# Build em dois estágios: as ferramentas de compilação (gcc, headers, git)
# ficam só no estágio `builder` e não vão para a imagem final.
#
# IMPORTANTE: os pesos do modelo NÃO ficam na imagem. Eles são baixados uma
# única vez para o volume ../data/hf-cache (montado em /models via HF_HOME) e
# sobrevivem a qualquer rebuild.
#
# As wheels do PyTorch cu128 já trazem as bibliotecas CUDA necessárias, então a
# base pode ser um Ubuntu limpo — o driver é injetado pelo runtime NVIDIA.
# Para compilar o FlashAttention 2, troque a base do builder por
# nvidia/cuda:12.8.1-devel-ubuntu24.04 (precisa do nvcc) — ver docs/setup.
# =============================================================================

# -----------------------------------------------------------------------------
# 1) builder — instala tudo num virtualenv isolado
# -----------------------------------------------------------------------------
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-dev \
        build-essential \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN pip install --upgrade pip setuptools wheel

# --- MOSS-TTS (traz torch cu128, transformers e o código dos modelos) --------
ARG MOSS_TTS_REPO=https://github.com/OpenMOSS/MOSS-TTS.git
ARG MOSS_TTS_REF=main
RUN git clone --depth 1 --branch "${MOSS_TTS_REF}" "${MOSS_TTS_REPO}" /opt/moss-tts \
    && rm -rf /opt/moss-tts/.git \
    && pip install --extra-index-url https://download.pytorch.org/whl/cu128 \
        -e "/opt/moss-tts[torch-runtime]"

# --- dependências da API -----------------------------------------------------
COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# --- limpeza -----------------------------------------------------------------
# Interface web de demonstração do MOSS: não usamos (temos a nossa na 8095).
ARG PRUNE_DEMO_UI=true
RUN if [ "${PRUNE_DEMO_UI}" = "true" ]; then \
        pip uninstall -y gradio gradio-client safehttpx ruff 2>/dev/null || true; \
    fi

# Bibliotecas CUDA usadas só em multi-GPU / multi-nó — inúteis numa placa só.
# Desligado por padrão: ligue com --build-arg PRUNE_MULTIGPU=true se quiser
# economizar ~1GB e não pretende usar torch.distributed.
ARG PRUNE_MULTIGPU=false
RUN if [ "${PRUNE_MULTIGPU}" = "true" ]; then \
        pip uninstall -y nvidia-nccl-cu12 nvidia-nvshmem-cu12 2>/dev/null || true; \
    fi

RUN find /opt/venv -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true; \
    find /opt/venv -type f -name "*.pyc" -delete 2>/dev/null || true

# -----------------------------------------------------------------------------
# 2) runtime — só o que o serviço precisa para rodar
# -----------------------------------------------------------------------------
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    HF_HOME=/models \
    PYTHONPATH=/app \
    PATH="/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        ffmpeg \
        libsndfile1 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/moss-tts /opt/moss-tts

WORKDIR /app
RUN mkdir -p /data/audio /data/voices /models

# Última camada: só o nosso código. Alterar o backend rebuilda apenas isto
# (poucos KB, ~5 segundos) — nada de reinstalar torch nem re-baixar o modelo.
COPY app /app/app

EXPOSE 8096

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8096", \
     "--timeout-keep-alive", "600", \
     "--no-access-log"]
