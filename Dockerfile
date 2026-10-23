# syntax=docker/dockerfile:1
#
# The app's image for Fly.io (Phase 6). Fly builds it from this folder on
# each fly deploy. Two stages: the first builds the screens and the server,
# the second is what runs, with only what running needs. No key is ever in
# the image: they come from Fly secrets when it runs.

# Node 22, pinned to the exact image (Debian bookworm, slim).
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app
# The browser tests' browsers are not needed to build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json .npmrc ./
COPY packages/money/package.json packages/money/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN node scripts/build.mjs && npm prune --omit=dev

# Litestream, the release from its own GitHub page, checked against its
# SHA-256 (the same as in scripts/litestream.mjs: a test checks).
ADD --checksum=sha256:cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d https://github.com/benbjohnson/litestream/releases/download/v0.5.17/litestream-0.5.17-linux-x86_64.tar.gz /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream && litestream version

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /usr/local/bin/litestream /usr/local/bin/litestream
# The database driver and web push, which the built server loads from here.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/server/dist/serve /app/serve
COPY --from=build /app/packages/web/dist /app/web
COPY litestream.yml /etc/litestream.yml
ENV WEB_ROOT=/app/web
ENV LITESTREAM_CONFIG=/etc/litestream.yml
EXPOSE 8080
# The server and Litestream, kept running (packages/server/src/serve/start.ts).
CMD ["node", "/app/serve/start.mjs"]
