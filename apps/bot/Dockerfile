# syntax=docker/dockerfile:1
# Contexto de build: a raiz do repositório (veja compose.yaml e .dockerignore).
# Nenhum segredo entra na imagem: o token chega só em tempo de execução, por variável de ambiente.
# Multiarquitetura (amd64 e arm64), para a VM da F0-06.
ARG NODE_IMAGE=node:24.19.0-alpine

FROM ${NODE_IMAGE} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# A versão do pnpm vem de `packageManager`, no package.json da raiz.
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/

FROM base AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @studyrooms/bot --store-dir /pnpm/store

# Estágio só para validar o bot no Linux (sinais reais): `docker build --target test .` roda typecheck e testes.
FROM base AS test
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @studyrooms/bot --store-dir /pnpm/store
COPY apps/bot/tsconfig.json apps/bot/
COPY apps/bot/src apps/bot/src
WORKDIR /app/apps/bot
RUN node --run typecheck && node --run test

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --chmod=a=rX apps/bot/package.json apps/bot/
COPY --chmod=a=rX --exclude=*.test.ts --exclude=*.test-preload.ts apps/bot/src apps/bot/src
WORKDIR /app/apps/bot
# Os arquivos ficam com o dono root e só leitura (o checkout no Windows chega como 777);
# o processo roda como `node`, sem poder alterá-los.
USER node
# Forma exec: o Node recebe o SIGTERM do `docker stop` direto (sem shell nem pnpm no meio).
# Com `init: true` no compose, o PID 1 é o tini; sem ele, o Node é o PID 1 e trata os sinais no index.ts.
CMD ["node", "src/index.ts"]
