# AEPS Fintech Admin Panel — Specification (As-Built)

| | |
|---|---|
| **Document** | Admin Panel Specification |
| **Version** | 1.0 |
| **Date** | 2026-09-17 |
| **Status** | As-built (reflects the current `C:\FintechApp` codebase + database) |
| **Owner** | Somveer (somveerkushwaha@gmail.com) |
| **Scope of file** | Technical + functional specification and a prioritized list of improvements |

---

## 1. Introduction & Purpose

This document specifies the **AEPS (Aadhaar Enabled Payment System) / fintech admin panel** currently
implemented at `C:\FintechApp`. It captures the system **as it exists today** — architecture, stack,
security model, data model, and every screen — and closes with a **prioritized "Improvement
Opportunities" section (§14)** so the design can be reviewed before the next phase.

**How to read it:** §2–§13 describe *what is built*. §14 is the review focus — *what to improve*,
graded **P0** (do before real users/money), **P1** (do before production launch), **P2**
(quality / polish). Every claim here was verified against the live source and the local PostgreSQL
database while writing.

---

## 2. Product Overview

The panel is the **back-office control plane** for an AEPS/fintech platform. From it an administrator:

- authenticates through a hardened login (password + captcha + SMS OTP);
- manages **master data** (service categories, cities, user types, services, plans, commission slabs,
  banks, banners, ticket departments, announcements);
- onboards and manages **portal users** (retailers, distributors, employees) and their wallets;
- moves money — **fund transfers** to user wallets, **fund requests** approval, **payout banks**
  approval, and an **admin wallet** top-up ledger;
- runs **reports** (account history, service report, GST, TDS, commission slab);
- performs **KYC checks** (PAN / Aadhaar — sandbox);
- configures the app (theming, login banner, app identity) and changes their own password.

The **left navigation is generated from the database** (`menu_items`): adding a row makes a screen
appear, without a frontend change.

---

## 3. Scope

**In scope (built):** admin authentication, DB-driven menu, all master screens, users manager,
company/payout banks, fund transfer + fund requests, admin wallet, reports (account/service/GST/TDS/
commission slab), sandbox PAN/Aadhaar verify, settings/theming, change password.

**Out of scope (not built / deliberately stubbed):**
- Live AEPS/DMT/recharge/BBPS **switch integrations** (no real transaction rails).
- **Real KYC gateway** (NSDL/UIDAI) — PAN/Aadhaar verify is a sandbox stub.
- **Retailer / customer-facing** apps (this is the admin side only).
- Production **SMS gateway** credentials (dev provider prints OTP to the terminal; MSG91 adapter is
  scaffolded but unconfigured).

---

## 4. System Architecture

**Monorepo, two halves:**

```
                         ┌──────────────────────────────┐
   Browser / iOS /       │  app/  (Expo / React Native)  │
   Android  ───────────► │  react-native-web on web      │
                         │  screens + api/client.js      │
                         └───────────────┬───────────────┘
                                         │  HTTPS/JSON  (Bearer JWT)
                                         ▼
                         ┌──────────────────────────────┐
                         │  api/  (Express, plain Node)   │
                         │  routes → controllers → repos  │
                         │  middleware: auth, rateLimit,  │
                         │  upload; services: token, otp, │
                         │  sms, captcha                  │
                         └───────────────┬───────────────┘
                                         │  Knex query builder
                                         ▼
                         ┌──────────────────────────────┐
                         │  PostgreSQL 17 (fintech_aeps)  │
                         │  schema via Knex migrations    │
                         └──────────────────────────────┘
   Static images: GET /uploads/* served from api local disk (multer).
```

- **API** (`api/`): Express JSON API, no build step. Layering is **routes → controllers
  (validation) → repositories (queries)**; business logic stays out of routes. Auth is stateless
  (JWT), so the API is horizontally scalable.
- **App** (`app/`): one Expo/React Native codebase for **web + iOS + Android**. A single
  `DashboardScreen` renders the sidebar from `/api/menu` and switches the content pane by route.
- **Request flow:** app attaches `Authorization: Bearer <accessJWT>`; `requireAuth` verifies it and
  sets `req.user`; controller validates input and calls a repository; repository uses Knex.

---

## 5. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| API runtime | Node.js + Express | Express ^4.19 |
| DB access | Knex (migrations/seeds/queries) + pg | Knex ^3.1, pg ^8.12 |
| Auth | jsonwebtoken, bcryptjs | jwt ^9.0, bcryptjs ^2.4 |
| Hardening | helmet, cors, express-rate-limit | helmet ^7.1, rate-limit ^7.4 |
| Uploads | multer + sharp (icon processing) | multer ^1.4-lts, sharp ^0.35 |
| Captcha | svg-captcha | ^1.4 |
| Database | PostgreSQL | 17 (local) |
| App framework | Expo / React Native | Expo ~57, RN 0.86 |
| React | react / react-dom | 19.2 |
| Web | react-native-web | ^0.21 |
| UI primitives | react-native-svg, expo-image-picker, async-storage | — |
| Dev | nodemon | ^3.1 |

There is **no test runner** and **no ESLint config** (despite `eslint-disable` comments). Backend
features are verified with **ad-hoc in-process scripts** (require `src/app`, `app.listen`, mint an
admin token, `fetch`, assert, delete).

---

## 6. Environment & Configuration

Config is **entirely env-driven** (`api/.env`, gitignored; `api/.env.example` committed). Delivery
posture is **dev-first, prod-ready**: it runs locally with mock SMS and prints the OTP; every
environment-specific value drops in for production with no code change.

| Group | Keys |
|---|---|
| App | `NODE_ENV`, `PORT`, `CORS_ORIGINS` |
| JWT | `JWT_SECRET`, `JWT_ACCESS_TTL` (8h), `JWT_PENDING_TTL` (10m) |
| Database | `DATABASE_URL` **or** `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`, `PGSSL` |
| OTP policy | `OTP_LENGTH`, `OTP_TTL_SECONDS` (300), `OTP_DAILY_LIMIT` (5), `OTP_MAX_VERIFY_ATTEMPTS` (5) |
| SMS | `SMS_PROVIDER` (`dev`\|`msg91`), `MSG91_AUTH_KEY/SENDER_ID/TEMPLATE_ID` |
| Seed admin | `SEED_ADMIN_USERNAME/PASSWORD/FULLNAME/MOBILE/EMAIL` |
| Lockout | `LOGIN_MAX_FAILED` (5), `LOGIN_LOCKOUT_MINUTES` (15) |
| **Dev-only** | `DEV_MASTER_OTP` (fixed OTP, skips SMS + daily cap), `CAPTCHA_DEV_ECHO` (logs captcha) |

**Dev flags are ignored when `NODE_ENV=production`.** The app **does not provision the database** —
the operator's own script creates it; this app only *connects* and *migrates*.

Seeded admin: `admin` / `Admin@12345`. Dev OTP: `123456`.

---

## 7. Security & Authentication

**Login flow (cookieless, token-based):**

1. `GET /api/auth/captcha` → svg-captcha image + id (answer held in a stateless in-memory store).
2. `POST /api/auth/login` (password + captcha) → on success issues a **pending JWT** (10m) and sends
   an **SMS OTP** (dev provider prints it to the API terminal).
3. `POST /api/auth/verify-otp` (with pending JWT) → issues the **access JWT** (8h).
4. App stores the access token (async-storage) and sends it as `Bearer` on every call.

**Controls in place:**
- **bcrypt** password hashing (cost 12).
- **Per-account lockout** after `LOGIN_MAX_FAILED` failures for `LOGIN_LOCKOUT_MINUTES`.
- **Daily OTP cap** + **per-OTP attempt cap** + OTP **TTL**; OTPs stored hashed.
- **`audit_log`** records login events.
- **Rate limiting** (`express-rate-limit`) on `/api/auth/*`.
- **helmet** headers; **CORS** allow-list (`CORS_ORIGINS`); native/no-origin allowed.
- **Uploads**: controllers only accept paths matching `/^\/uploads\/...$/` (external URLs rejected).
- **Transaction authorization**: fund transfer and Aadhaar-verify require re-entering the **admin's
  own login password** (bcrypt-checked) as a transaction password.
- **Error handler** hides internal messages when `NODE_ENV=production`.

**Roles:** `users.role` = `admin` for the operator; managed users have `user_type_id` set. RBAC is
**not yet enforced at the API** — see §14 (P0).

---

## 8. Data Model

26 application tables (grouped). All money is `numeric(14,2)`; timestamps default to `now()`.

**Identity & access**
- `users` — **dual-purpose**: the admin (`role=admin`, `user_type_id` null) **and** managed portal
  users (`user_type_id NOT NULL`, `user_code`, `shop_name`, `wallet_balance`, `plan_id`, `parent_id`,
  `kyc_status`, `ekyc_status`, onboarding fields, `service_access`/`module_access` jsonb).
- `user_types` — retailer/distributor/employee/etc.
- `menu_items` — self-referencing (`parent_id`) navigation tree.
- `settings` — key/value app configuration.
- `audit_log`, `otp_requests` — auth security.
- `session` — **legacy/unused** (JWT replaced cookie sessions).

**Masters**
- `service_categories`, `states`, `cities`, `services`, `plans`, `commission_slots`
  (+ `txn_type` credit/debit), `banks`, `company_banks`, `application_banners`,
  `ticket_departments`, `announcements`.

**Money & operations**
- `account_transactions` — wallet ledger (service_name, type credit/debit, before/updated balance).
- `service_transactions` — service usage report source.
- `fund_requests` — user deposit requests (admin approve/reject → wallet credit).
- `payout_banks` — user payout accounts (admin approve/reject; passbook image).
- `fund_transfers` — admin→user wallet moves.
- `admin_wallet_transactions` — admin's own wallet top-up/adjust ledger.
- `commission_ledger` — per-transaction commission with GST + TDS breakdown (backs GST/TDS reports).
- `kyc_verifications` — PAN/Aadhaar verification audit (doc numbers masked).

**Key relationships:** `commission_slots` → user_type + service + plan; `company_banks` → banks;
managed `users` → user_types + plans + cities/states + parent user; all ledgers → users.

---

## 9. Navigation & Menu (DB-driven)

`GET /api/menu` returns the active `menu_items` as a nested tree (by `parent_id`, ordered by
`sort_order`). The app renders it in the sidebar and matches `route` to a screen component in
`DashboardScreen`. Adding/reordering a row changes the menu with no code change; a special route
`/logout` triggers sign-out instead of navigation.

**Current tree (33 rows):**

- **Dashboard** (`/`)
- **Modules** ▸ Service Category · City Master · User Type Master · Service Master · Plan Master ·
  Commission Slots · Application Settings · Application Banners · Ticket Departments · Announcements
- **Company Banks** (`/company-banks`)
- **Users Manager** (`/users-manager`)
- **Account History** (`/account-history`)
- **Service Report** (`/service-report`)
- **Fund Requests** (`/fund-requests`)
- **Payout Banks** (`/payout-banks`)
- **Fund Transfer** ▸ Fund Transfer (`/fund-transfer`) · All Fund Transfers (`/fund-transfers`)
- **Aadhar & Pan Verify** ▸ PAN Verify (`/pan-verify`) · Aadhaar Verify (`/aadhaar-verify`)
- **Commission Slab** (`/commission-slab`)
- **GST Report** (`/gst-report`)
- **TDS Report** (`/tds-report`)
- **Admin Wallet** ▸ Add Fund (`/admin-wallet/add`) · View All (`/admin-wallet/all`)
- **Account Settings** ▸ Change Password (`/change-password`) · Logout (`/logout`)

---

## 10. Functional Specification — by Module

**Master-screen pattern** (used by every master): one component toggles a `view` state between
`list` and `form`. The list has debounced search, an optimistic status `Switch`, row actions, and
pagination; **Add/Edit opens in-page** (a form card with an "ALL X" back button) — only delete/fund/
review confirmations use a modal. Backend per resource: migration → repo → controller → route →
`menu_items` row → screen + `api.<x>` client methods.

### 10.1 Authentication / Login
Password + captcha + SMS OTP (see §7). Login banner + app name/logo/theme come from
`GET /api/settings/public` (no auth).

### 10.2 Dashboard (`/`)
Landing page: stat cards, a welcome card, and a cycling **announcement banner** (active
announcements for the user type via `GET /api/announcements/active`). The sidebar profile card shows
the admin avatar/name and **live wallet balance**.

### 10.3 Modules group
| Screen | Purpose / key fields | Endpoints |
|---|---|---|
| Service Category | Category name + status | `/api/service-categories` CRUD |
| City Master | States + cities (reusable state→city dropdowns) | `/api/states`, `/api/cities` CRUD |
| User Type Master | Retailer/distributor/etc. | `/api/user-types` CRUD |
| Service Master | Services with icon upload; joins category | `/api/services` CRUD, `/api/uploads/image` |
| Plan Master | Plans per user type | `/api/plans` CRUD |
| Commission Slots | User type + service + plan + operator, commission type (%/amount), amount range, value, chain type, **txn type** | `/api/commission-slots` CRUD |
| Application Settings | App identity, prefixes, charges, theme, cert/legal text | `/api/settings/app`, `/settings/theme`, `/settings/login-banner` |
| Application Banners | Login/App banner images + dates | `/api/banners` CRUD |
| Ticket Departments | Support routing departments | `/api/ticket-departments` CRUD |
| Announcements | Target `user_type_id` + message; shown as dashboard banner | `/api/announcements` CRUD + `/active` |

### 10.4 Company Banks (`/company-banks`)
Admin bank accounts; **bank name chosen from the banks master** (`GET /api/banks`, 25 seeded banks),
stores `bank_id` + denormalized `bank_name`. CRUD at `/api/company-banks`.

### 10.5 Users Manager (`/users-manager`)
Full onboarding of managed users (5 sections: Basic, Address via state→city, AEPS/Parent, Service
Access checkboxes, **Employee Module Access** — shown only when the account type is Employee).
`user_code` = settings `user_id_prefix` + zero-padded sequence (also the login username, generated
with retry-on-conflict). Wallet adjusted via `POST /api/users/:id/fund` (atomic, guarded).
API: `/api/users` (list w/ filters + q, POST/PUT/DELETE), `/api/module-options`.

### 10.6 Reports
| Screen | Source | Filters |
|---|---|---|
| Account History (`/account-history`) | `account_transactions` | date, user type, user, service, txn type |
| Service Report (`/service-report`) | `service_transactions` | date, user type, user, service, status |
| Fund Requests (`/fund-requests`) | `fund_requests` | date, user type, user, status; approve/reject → wallet credit + ledger row (atomic) |

Report repositories paginate with a **JOIN-only count query** (no select columns) to avoid Postgres
GROUP BY errors.

### 10.7 Payout Banks (`/payout-banks`)
User payout accounts. Admin can **add/edit** (User, Bank Name, Account No, IFSC, AC Holder, +
**passbook image upload**) and **approve/reject** (Review modal). Passbook thumbnail opens a full
viewer. `GET/POST /api/payout-banks`, `PUT /api/payout-banks/:id` (status action **or** field edit).

### 10.8 Fund Transfer group
- **Fund Transfer** (`/fund-transfer`): look up receiver by `user_code`
  (`GET /api/fund-transfer/lookup`), then `POST /api/fund-transfers` {amount, txnType credit|debit,
  remark, **transactionPassword = admin login password**}. Atomic: adjusts receiver wallet (debit
  guarded ≥0), writes `account_transactions` + `fund_transfers` rows.
- **All Fund Transfers** (`/fund-transfers`): filterable list with **Status** column + horizontal
  scrollbar.

### 10.9 Aadhar & Pan Verify group (sandbox KYC)
- **PAN Verify** (`/pan-verify`): PAN number → `POST /api/verify/pan` (validates format, returns
  simulated verified result).
- **Aadhaar Verify** (`/aadhaar-verify`): Aadhaar + transaction password → `POST /api/verify/aadhaar`
  (validates 12 digits, checks admin password, returns simulated OTP dispatch).
- Both log to `kyc_verifications` with **masked** document numbers. **No live UIDAI/NSDL gateway.**

### 10.10 Commission Slab (`/commission-slab`)
Read-only view of `commission_slots` filtered by User Type + Service. Columns: User Type, Service,
Commision Type (By %/Amount), Amount Range, Amount/Percentage, Plan, **Type** (credit/debit), Chain
Type. `GET /api/commission-slab`.

### 10.11 GST Report (`/gst-report`) & TDS Report (`/tds-report`)
Both read the same `commission_ledger` (per-transaction commission with GST% / GST amt, TDS% / TDS
amt, net amount, wallet txn type/amount, before/updated balance). One shared `TaxReportScreen`
(`kind="gst"|"tds"`) swaps the tax columns. Filters: date, user type, user, service.
`GET /api/gst-report`, `/api/tds-report`. **Rows are seeded demo data**, not generated by a live
transaction engine (see §14 P1).

### 10.12 Admin Wallet group
- **Add Fund** (`/admin-wallet/add`): Amount, Txn Type (credit/debit), Remark → `POST
  /api/admin-wallet/add`. Atomic top-up/adjust of the admin's `wallet_balance` (debit guarded ≥0) +
  `admin_wallet_transactions` ledger row.
- **View All** (`/admin-wallet/all`): Filter Data (date, txn type) + Wallet Transaction History grid
  (Added Amount, Txn Type, Before/Updated Balance, Remark, User, Created on). `GET /api/admin-wallet`,
  `/api/admin-wallet/balance`.

### 10.13 Account Settings group
- **Change Password** (`/change-password`): current + new + confirm → `POST
  /api/account/change-password` (bcrypt-verifies current, min 8 chars, must differ).
- **Logout**: menu row (`/logout`) that signs out; also available in the top-bar user dropdown.

---

## 11. API Surface (reference)

Auth column: **P** = public, **A** = requires access JWT, **Pend** = requires pending JWT.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | P | Liveness (`{ok, service}`) |
| GET | `/api/auth/captcha` | P | New captcha |
| POST | `/api/auth/login` | P | Password + captcha → pending JWT + OTP |
| POST | `/api/auth/verify-otp` | Pend | OTP → access JWT |
| POST | `/api/auth/resend-otp` | Pend | Resend OTP (honors daily cap) |
| GET | `/api/settings/public` | P | Theme + login banner + identity |
| GET | `/api/me`, `/api/menu` | A | Current user; menu tree |
| GET/POST | `/api/settings/app` · POST `/settings/theme` · POST/DELETE `/settings/login-banner` | A | Settings + theming |
| CRUD | `/api/service-categories` · `/states` `/cities` · `/user-types` · `/services` · `/plans` · `/commission-slots` · `/banners` · `/ticket-departments` · `/announcements` (+`/active`) | A | Masters |
| POST | `/api/uploads/image` | A | Generic image upload → `{path}` |
| GET | `/api/banks` | A | Banks master (dropdown) |
| CRUD | `/api/company-banks` | A | Company banks |
| CRUD | `/api/users` (+ `POST /:id/fund`) · `/module-options` | A | Users Manager |
| GET | `/api/account-history` · `/service-report` · `/fund-requests` (+ `PUT /:id`) | A | Reports + fund-request action |
| GET/POST/PUT | `/api/payout-banks` (+ `/:id`) | A | Payout banks |
| GET/POST | `/api/fund-transfers` (+ `GET /fund-transfer/lookup`) | A | Fund transfer + history |
| GET | `/api/gst-report` · `/tds-report` · `/commission-slab` | A | Tax + commission reports |
| POST | `/api/verify/pan` · `/verify/aadhaar` | A | Sandbox KYC |
| GET/POST | `/api/admin-wallet` (+ `/balance`, `/add`) | A | Admin wallet |
| POST | `/api/account/change-password` | A | Change password |

---

## 12. Non-Functional Aspects

- **Theming:** primary/secondary colors in `settings`; `app/src/theme.js` `applyTheme()` mutates a
  shared `colors` object at startup (App.js applies before screens load; web reloads on save).
  **Secondary color = sidebar menu highlight.**
- **Images:** generic upload → `/uploads/..`, served statically; only `/uploads/...` paths accepted.
  Service icons generated with sharp (`npm run assign-service-icons`).
- **Cross-platform:** one Expo codebase for web/iOS/Android; the app derives the API base URL from
  the Expo host on native, `localhost:3000` on web.
- **Formatting:** amounts rendered as `₹x.xx`; dates via a shared formatter and a custom `DateField`
  calendar (cross-platform).
- **Performance:** stateless JWT (scalable API); indexed ledger tables; paginated lists.

---

## 13. Run & Verify (operations)

```
cd api && npm run migrate && npm run seed   # schema + admin/menu/demo data
cd api && npm run dev                        # API on http://localhost:3000
cd app && npm run dev                        # Expo; press w for web (http://localhost:8081)
```

Login `admin` / `Admin@12345`; dev OTP `123456`. Backend features verified with in-process scripts
(no test runner). `psql` at `C:\Program Files\PostgreSQL\17\bin\psql.exe`.

---

## 14. Improvement Opportunities (prioritized) — with status

> Status legend: **✅ Done** · **◑ Partial** (foundation built, more to wire) · **☐ Open**.
> Most P0/P1 items were implemented in the hardening pass (migrations `20260917100000_hardening`,
> new middleware/services, and a `node --test` suite). Details below.

### P0 — correctness, security, money integrity
1. **✅ RBAC / permission enforcement.** `requireAuth` now revalidates the user against the DB every
   request (active + token epoch, authoritative role) and `requireAdmin`/`requireRole` guard admin
   endpoints; only `role=admin` may reach management/money routes (`middleware/auth.js`,
   `routes/api.routes.js`). Verified by test (anon→401, admin→200, managed user→403).
2. **✅ Idempotency on money endpoints.** `Idempotency-Key` header dedupe with an atomic key
   reservation (`middleware/idempotency.js`, `idempotency_keys` table) applied to fund transfer,
   admin-wallet add, user fund, and fund-request approval; the app sends a UUID per action. Verified
   (repeated key does not double-credit).
3. **✅ Sensitive actions audited.** Fund transfer, admin-wallet adjust, user wallet fund,
   fund-request action, payout review, password change, logout, PIN set, and KYC now write
   `audit_log` rows. Verified.
4. **✅ Automated test suite.** `node --test` (no new deps): `test/api.test.js` (auth/RBAC,
   idempotency, wallet, token revocation, PIN) + `test/commission.test.js` (engine math). 11 tests
   green via `npm test`.

### P1 — production readiness
5. **✅ KYC behind an interface.** `services/kyc.service.js` with a mock (default) and a live stub,
   selected by `APP_MODE` (never inferred from a key). `verify.controller` calls it.
6. **◑ Commission/GST/TDS engine.** `services/commission.service.js` computes commission + GST + TDS
   from the matching slab and writes `commission_ledger` (unit-tested). It is ready to call from the
   transaction pipeline; until live service rails exist the reports still show seed data. **Open:**
   wire it into real service transactions.
7. **✅ Upload limits + ◑ storage.** multer already enforces 5 MB + image MIME allow-list
   (`middleware/upload.js`). **Open:** swap local disk for a storage interface (local ↔ S3) — deferred.
8. **✅ Explicit run mode + rich health.** `APP_MODE`/`MODE` (default `mock`) in `config/env.js`;
   `/api/health` returns `{ok, service, version, mode, adapters}`. Verified.
9. **◑ Shared validation.** `utils/validate.js` (ValidationError + helpers) added and used by the
   new/refactored controllers; the error handler surfaces `code`. **Open:** migrate older controllers
   onto it incrementally.
10. **◑ SMS/email delivery.** SMS already has a `dev`/`msg91` seam; adapters now respect `APP_MODE`.
    **Open:** implement a real email-OTP adapter for `enable_email_otp`.

### P2 — quality, maintainability, UX
11. **✅ ESLint config.** `.eslintrc.json` + `npm run lint` (eslint:recommended); clean (0 errors).
12. **✅ Token revocation.** `users.token_epoch` embedded in the access token and checked each
    request; bumped on logout (`POST /api/account/logout`) and password change → old tokens rejected
    with `TOKEN_REVOKED`. Verified. **Open (future):** full refresh-token rotation.
13. **✅ Separate transaction PIN.** `users.txn_pin_hash` + `POST /api/account/txn-pin` + a
    "Transaction PIN" screen; `services/txnAuth.service.js` prefers the PIN and falls back to the
    login password. Fund transfer uses it. Verified.
14. **✅ Legacy `session` table dropped** (in the hardening migration).
15. **✅ Duplicate balance removed.** Sidebar now shows a single "Wallet Balance" (live admin wallet).
16. **☐ UX polish** (skeletons, error boundaries, accessibility) — open.
17. **☐ CI/CD** — open; `npm run lint` + `npm test` are ready to wire into a pipeline. Git checkpoints
    are per the user's workflow (not committed automatically).

---

## 15. Appendix

**Glossary** — **AEPS**: Aadhaar Enabled Payment System. **DMT**: Domestic Money Transfer.
**AC/A/c**: bank account. **IFSC**: Indian Financial System Code (bank branch id). **TDS**: Tax
Deducted at Source. **GST**: Goods & Services Tax. **KYC/eKYC**: (electronic) Know Your Customer.
**Wallet**: prepaid balance a user spends on services.

**Intellectual property** — This is an **independent, original implementation**; reference videos are
used only as functional reference. No third-party branding ("Dactilar") name/logo/content is used;
all user-facing copy is authored in-house. See `NOTICE.md`.

**Related project docs** — `CLAUDE.md` (repo guide), `NOTICE.md` (IP), `api/.env.example` (config
template).

*End of document.*
