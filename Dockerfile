# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc .yarnrc.yml ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json types.d.ts ./
COPY src ./src

RUN yarn build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json yarn.lock .yarnrc .yarnrc.yml ./
RUN yarn install --frozen-lockfile --production=true && yarn cache clean

COPY --from=builder /app/dist ./dist

RUN chown -R node:node /app
USER node

VOLUME ["/app/userbot-session"]

CMD ["node", "dist/index.js"]
