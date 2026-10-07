# One image, one port: the Bun server serves the API on /api and the built client everywhere else.

FROM oven/bun:1.4.2 AS client
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/client apps/client
RUN bun run --cwd apps/client build

# The commit being built, shown at startup (no git in the image). Read from `.git` when the build receives it,
# or given with `--build-arg GIT_COMMIT=...` (some build methods do not send `.git`).
FROM oven/bun:1.4.2-slim AS version
ARG GIT_COMMIT
# `package.json` keeps the copy valid when `.git` is missing; `.git*` copies the content of `.git` into /git/.
COPY package.json .git* /git/
RUN cd /git \
  && if [ -n "$GIT_COMMIT" ]; then commit="$GIT_COMMIT"; \
  elif [ -f HEAD ]; then \
    ref=$(sed -n 's/^ref: //p' HEAD); \
    if [ -z "$ref" ]; then commit=$(cat HEAD); \
    elif [ -f "$ref" ]; then commit=$(cat "$ref"); \
    else commit=$(grep " $ref\$" packed-refs 2>/dev/null | cut -d' ' -f1); fi; \
  fi \
  && echo "${commit:-unknown}" | cut -c1-7 > /VERSION

FROM oven/bun:1.4.2-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3998 \
    DATABASE_PATH=/data/inscript-carte.sqlite \
    CLIENT_DIST_PATH=/app/apps/client/dist

# Only the server's runtime packages, at the versions of the lockfile. Scripts are skipped: better-sqlite3 loads
# its prebuilt binary from `prebuilds/`, and its useless rebuild would need Python and a C++ compiler.
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @inscript-carte/server

# Bun runs the TypeScript sources directly; the shared package is used as source too.
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY --from=client /app/apps/client/dist apps/client/dist
COPY --from=version /VERSION ./VERSION

# The database holds personal data: keep it in a volume, outside the image.
RUN mkdir /data && chown bun:bun /data
VOLUME /data
USER bun

EXPOSE 3998
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "apps/server/src/main.ts"]
