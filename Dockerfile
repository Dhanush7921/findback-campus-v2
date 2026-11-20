# Cloud Run image for the FindBack API (Node.js). Build context: repository root.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY shared ./shared
COPY api/src ./api/src
COPY server ./server
RUN npx esbuild server/main.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist-server/main.mjs

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist-server/main.mjs ./main.mjs
USER node
CMD ["node", "main.mjs"]
