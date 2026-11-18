FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
COPY db ./db
COPY public ./public
COPY scripts ./scripts
COPY .env.example ./
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 DB_PATH=/app/data/kodeks.sqlite
COPY --from=build /app/dist/ ./
COPY --from=build /app/node_modules/ ./node_modules/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node","server.mjs"]
