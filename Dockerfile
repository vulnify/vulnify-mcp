# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN addgroup -S -g 10001 vulnify && adduser -S -u 10001 -G vulnify vulnify
WORKDIR /app
COPY --from=build --chown=vulnify:vulnify /app/package.json /app/package-lock.json ./
COPY --from=build --chown=vulnify:vulnify /app/node_modules ./node_modules
COPY --from=build --chown=vulnify:vulnify /app/dist ./dist
USER vulnify
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/cli.js", "--http"]
