#!/bin/sh
# Cria/atualiza o superusuário do PocketBase e sobe o servidor.
# As migrations em /pb/pb_migrations são aplicadas automaticamente no boot.
set -e

if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  echo "[pocketbase] garantindo superusuário $PB_ADMIN_EMAIL"
  /pb/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/pb/pb_data \
    || echo "[pocketbase] aviso: falha ao criar/atualizar o superusuário (a senha precisa ter 10+ caracteres)"
fi

exec /pb/pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/pb/pb_data \
  "$@"
