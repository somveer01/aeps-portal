# AEPS API — production image (Debian slim so `sharp` gets prebuilt binaries).
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install production dependencies first (better layer caching).
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

# Uploaded images live here; mounted as a volume in compose so they persist.
RUN mkdir -p uploads && chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
