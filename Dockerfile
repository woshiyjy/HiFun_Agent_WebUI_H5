FROM node:24.13.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY index.html vite.config.js ./
RUN npm run build

FROM node:24.13.1-bookworm-slim
ENV NODE_ENV=production HOST=127.0.0.1 PORT=1842
WORKDIR /app
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node skills ./skills
COPY --chown=node:node contracts ./contracts
COPY --chown=node:node knowledge/source ./knowledge/source
COPY --chown=node:node knowledge/snapshot.json ./knowledge/snapshot.json
RUN mkdir -p /app/.runtime && chown node:node /app/.runtime
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:1842/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
