# =============================================================================
# PocketBase — banco de dados + autenticação da interface
# =============================================================================
FROM alpine:3.21

ARG PB_VERSION=0.39.9
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates unzip wget

WORKDIR /pb

RUN wget -q -O /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip -q /tmp/pb.zip -d /pb \
 && rm /tmp/pb.zip \
 && chmod +x /pb/pocketbase

# Migrations JS: criam as coleções (tokens, clones, cache, jobs, logs)
COPY pb_migrations /pb/pb_migrations
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8090
VOLUME ["/pb/pb_data"]

ENTRYPOINT ["/entrypoint.sh"]
