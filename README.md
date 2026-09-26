# AEPS Portal (monorepo)

An AEPS / fintech portal with a **React Native (Expo)** frontend that runs on **web, iOS and
Android** from one codebase, backed by a **Node.js + Express JSON API** on **PostgreSQL**.

```
C:\FintechApp
  api/   Express JSON API, JWT auth, PostgreSQL (knex migrations + seeds)
  app/   Expo / React Native app (react-native-web for web)
```

> **Intellectual property:** This is an independent, original implementation (own code and assets).
> Reference material was used only as functional reference — no third-party branding, content, or
> code was copied. See [NOTICE.md](NOTICE.md) for details. Not legal advice; get an IP review before
> commercial launch.

## Phase 1 features
- **Admin login**: username + password (bcrypt) + image **captcha**, then an **SMS OTP** second
  factor, with a **per-user daily OTP limit**.
- **Dynamic menu**: the app's left navigation is loaded from the `menu_items` table via the API —
  change rows, and the menu updates (no code change). Service screens are placeholders for now.
- **JWT auth**: pending token after password, access token after OTP (works for native apps).

## Prerequisites
- Node.js 18+ and a reachable **PostgreSQL** (you provide/provision it).

## 1) Backend (api/)
```bash
cd api
npm install
copy .env.example .env      # then edit DB connection + secrets
npm run migrate
npm run seed
npm run dev                 # http://localhost:3000
```
Dev mode prints the login **OTP** (and, if `CAPTCHA_DEV_ECHO=true`, the captcha) to this terminal.
Seeded admin: `admin` / `Admin@12345`.

## 2) Frontend (app/)
```bash
cd app
npm install
npx expo start
```
- Press **`w`** to open the **web** app (http://localhost:8081).
- Or install **Expo Go** on your phone and scan the QR to run the **native app**. The app
  auto-detects your PC's LAN IP for the API; ensure phone and PC are on the same network and that
  port 3000 is reachable (Windows Firewall may prompt).

## Configuration notes
- API URL: web uses `http://localhost:3000`; native derives the LAN IP from Expo's host. Override
  via `app.json` → `expo.extra.apiUrl` if needed.
- CORS: allowed web origins are set by `CORS_ORIGINS` in `api/.env` (defaults include Expo's 8081).
- Production: set `NODE_ENV=production`, a strong `JWT_SECRET`, `PGSSL=true` if required, real SMS
  via `SMS_PROVIDER=msg91` (+ `MSG91_*`), and `CAPTCHA_DEV_ECHO=false`.

## API endpoints
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | health check |
| GET | `/api/auth/captcha` | `{ captchaId, svg }` |
| POST | `/api/auth/login` | `{username,password,captchaId,captcha}` → `{pendingToken,...}` |
| POST | `/api/auth/verify-otp` | `{pendingToken,otp}` → `{accessToken,user}` |
| POST | `/api/auth/resend-otp` | `{pendingToken}` |
| GET | `/api/me` | current user (Bearer access token) |
| GET | `/api/menu` | dynamic menu tree (Bearer access token) |
| GET | `/api/service-categories` | list (`?q=&page=&pageSize=`), Bearer |
| POST | `/api/service-categories` | create `{name,isActive?}`, Bearer |
| PUT | `/api/service-categories/:id` | update `{name?,isActive?}`, Bearer |
| DELETE | `/api/service-categories/:id` | delete, Bearer |
