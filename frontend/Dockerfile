# =============================================================================
# Interface web — build com Vite, servida pelo nginx (porta 80 -> 8095 no host)
# =============================================================================
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund

COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/99-vct-config.sh

RUN chmod +x /docker-entrypoint.d/99-vct-config.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.d/99-vct-config.sh"]
