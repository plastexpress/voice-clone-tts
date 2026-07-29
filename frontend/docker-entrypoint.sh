#!/bin/sh
# Gera /config.js com as variáveis de ambiente do container e sobe o nginx.
set -e

CONFIG_PATH=/usr/share/nginx/html/config.js

cat > "$CONFIG_PATH" <<EOF
window.__VCT_CONFIG__ = {
  pbBase: "/pb",
  apiBase: "/api",
  publicApiUrl: "${PUBLIC_API_URL:-http://localhost:8096}",
  appName: "${APP_NAME:-Voice Clone TTS}"
};
EOF

echo "[frontend] config.js gerado (API pública: ${PUBLIC_API_URL:-http://localhost:8096})"

exec nginx -g "daemon off;"
