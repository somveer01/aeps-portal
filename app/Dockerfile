# AEPS web app — build the Expo web bundle, then serve it via nginx which also
# reverse-proxies /api and /uploads to the API container (same origin).

# ---- build stage ----
FROM node:20-bookworm-slim AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
# Empty = same origin: the app calls a relative "/api" that nginx proxies.
ARG EXPO_PUBLIC_API_URL=""
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN npx expo export --platform web --output-dir dist

# ---- serve stage ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/src/app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
