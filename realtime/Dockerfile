# Servicio realtime de Nova Sync Systems. La misma imagen corre en dos modos:
#   relay    publica en Kafka los eventos de outbox_events (una sola réplica)
#   gateway  consume Kafka y envía los cambios al navegador por SSE
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# Sin privilegios de root.
USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD if [ "$NOVA_REALTIME_MODE" = "gateway" ]; then wget -qO- http://127.0.0.1:3001/realtime/health >/dev/null || exit 1; fi

ENTRYPOINT ["node", "src/index.js"]
CMD ["gateway"]
