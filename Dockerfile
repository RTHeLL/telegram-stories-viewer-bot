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

RUN apk add --no-cache su-exec

RUN corepack enable

COPY package.json yarn.lock .yarnrc .yarnrc.yml ./
RUN yarn install --frozen-lockfile --production=true && yarn cache clean

COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && chown -R node:node /app

VOLUME ["/app/userbot-session"]
VOLUME ["/app/data"]

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
