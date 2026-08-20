# The server runs on Node with no runtime dependencies. The only thing the
# build stage exists for is bundling the Discord Embedded App SDK for the
# Activity, so the final image carries no node_modules at all.
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY build.mjs ./
COPY src ./src
RUN node build.mjs

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app

# Only what the server actually runs.
COPY package.json ./
COPY server ./server
COPY src ./src
COPY public ./public
COPY --from=build /build/public/vendor ./public/vendor

# The report list, roster, users and results live on a volume so they survive
# redeploys.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
