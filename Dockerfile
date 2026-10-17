# One Cloud Run service: API and front end together.
# Node 22 (Node 20 reached end of life on 30 April 2026).
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY seed-photos ./seed-photos
# Writable folder for the local photo adapter (only used when PHOTO_BUCKET is not set).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
