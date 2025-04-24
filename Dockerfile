# syntax=docker/dockerfile:1

###############################################################################
# 1) DEFINE VERSÃO DO NODE E IMAGEM BASE
ARG NODE_VERSION=18.20.8
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /usr/src/app

###############################################################################
# 2) BAIXA AS DEPENDÊNCIAS DE PRODUÇÃO (cacheável)
FROM base AS deps
# só package.json e lockfile para cachear npm ci
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

###############################################################################
# 3) STAGE DE BUILD (inclui devDependencies)
FROM base AS builder
# instala tudo (dev + prod) pra build funcionar
COPY package.json package-lock.json ./
RUN npm ci
# copia o restante e gera o dist
COPY . .
RUN npm run build

###############################################################################
# 4) IMAGEM FINAL DE PRODUÇÃO
FROM node:${NODE_VERSION}-alpine AS final
WORKDIR /usr/src/app

# variável de ambiente
ENV NODE_ENV=production

# roda como usuário menos privilegiado
USER node

# copia pacote e só as deps de produção
COPY --from=deps   /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package.json   ./package.json

# copia o dist compilado
COPY --from=builder /usr/src/app/dist   ./dist

# copia assets (certificados, schemas, etc) que você guardou em src/ssl
# e que foram incluídos no dist via configuração de assets ou manualmente
COPY --from=builder /usr/src/app/src/ssl ./dist/ssl

# exemplo de healthcheck (supondo que você tenha /health ou similar)
HEALTHCHECK --interval=30s --timeout=5s \
    CMD wget -qO- http://localhost:3000/health || exit 1

# expõe porta da sua API
EXPOSE 3000

# comando de start
CMD ["node", "dist/main.js"]
