# AEPS API — production image (Debian slim so `sharp` gets prebuilt binaries).
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

# A solid bold font for the login captcha (DejaVu Sans Bold, free licence) - see src/services/captcha.service.js.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

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
