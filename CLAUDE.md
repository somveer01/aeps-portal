# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **AEPS / fintech admin portal**, built as a **monorepo**:
- `api/` — Node.js + Express **JSON API**, JWT auth, PostgreSQL (Knex migrations + seeds).
- `app/` — **Expo / React Native** app (runs on **web, iOS, Android** from one codebase; `react-native-web` for web).

There is no build step for the API (plain Node). The app builds via Expo/Metro.

## Commands

Run the two halves in separate terminals (start the API first — the app needs it):

```bash
cd api && npm run dev      # nodemon, API on http://localhost:3000
cd app && npm run dev      # expo start; press w for web (http://localhost:8081)
```

Database (Knex):
```bash
cd api && npm run migrate            # apply latest migrations
cd api && npm run migrate:rollback   # roll back last batch
cd api && npm run seed               # run all seeds (idempotent)
cd api && npm run assign-service-icons [-- --force]   # generate+assign service icons (sharp)
```

Seeded admin login: `admin` / `Admin@12345`. Seeded **retailer** login: `retailer` / `Retailer@123` (managed user → **retailer panel**). In dev the login **OTP is `123456`** (`DEV_MASTER_OTP`) and, with `CAPTCHA_DEV_ECHO=true`, the captcha answer is printed to the API terminal.

**Two panels, one app:** `App.js` branches on `user.role` — `admin` → `DashboardScreen`; any managed user (has `user_type_id`) → `RetailerShell` (retailer panel). The sidebar menu is role-scoped via `menu_items.scope` ('admin' | 'retailer' | 'both'); `GET /api/menu` returns rows for the caller's role. Retailer APIs are under `requireManaged` and owner-scoped to `req.user.id`. External services (recharge/BBPS/AEPS/DMT/booking) run through `services/providers.service.js` (mock by default via `APP_MODE`) and the shared money `services/txnPipeline.service.js` (debit → provider → commission → refund-on-failure), idempotent + audited.

Windows/PowerShell note: `psql` lives at `C:\Program Files\PostgreSQL\17\bin\psql.exe` (not on PATH); the local DB is `fintech_aeps` (superuser `postgres`/`postgres`, port 5432). Connection comes from `api/.env` (gitignored; copy `api/.env.example`).

### Tests & lint
Backend tests use the **built-in `node --test`** runner (no extra deps): `cd api && npm test`
(the file list is in `api/package.json`; add new `test/*.test.js` files there). They run on the dev DB and must
also pass on a freshly migrated + seeded one (CI does that): create your own types/users, never rely on hand-made
data. `test/helper.js` boots the in-process app,
mints an admin token via `token.service.signAccess(user)`, and provides fetch helpers; tests restore
any DB state they change. Lint: `cd api && npm run lint` (ESLint `.eslintrc.json`, eslint:recommended).
For quick one-offs you can still write an ad-hoc in-process script to the scratchpad and `node` it.

## Architecture (big picture)

**Auth flow (cookieless, token-based):** password + image **captcha** → **SMS OTP** (dev provider prints to terminal) → API returns a short-lived **pending JWT**, then an **access JWT** after OTP. Captcha is a stateless in-memory id→answer store (`api/src/services/captcha.service.js`). Middleware `api/src/middleware/auth.js` exposes `requireAuth` / `requirePending`. Per-account lockout + an `audit_log` back the login.

**Database-driven menu:** the app sidebar is built from the `menu_items` table (`GET /api/menu`), self-referencing `parent_id` for nesting. Adding a row makes a screen appear — no frontend change. Top level = Dashboard, a **Modules** group, and top-level **Company Banks** / **Users Manager**.

**Master-screen pattern (every admin screen follows it):** a single screen component toggles a `view` state between `'list'` and `'form'`. The list has debounced search, a status `Switch` (optimistic), row actions, and pagination; **Add/Edit opens IN-PAGE** (a form Card with a header + "ALL X" back button), **not a modal** — only delete/fund confirms use a `Modal`. Backend for each resource = migration → `repositories/<x>.repo.js` (queries, joins return `*_name` fields) → `controllers/<x>.controller.js` (validation) → routes in `api/src/routes/api.routes.js` → a `menu_items` row → app screen + `api.<x>` methods in `app/src/api/client.js` → wire the route in `app/src/screens/DashboardScreen.js`. Copy an existing screen (e.g. `ServiceCategoryScreen`, `CityMasterScreen`, `UserManagerScreen`).

**Settings & theming:** app-wide settings are a key/value `settings` table (`GET/POST /api/settings/app`, whitelisted keys). `GET /api/settings/public` (no auth) exposes theme + login banner + app name/logo for the login/boot. Theme primary/secondary are stored there; `app/src/theme.js` `applyTheme()` **mutates a shared `colors` object at startup** — `App.js` applies the saved theme BEFORE requiring the screens (so `StyleSheet.create` picks it up), and the web reloads after a theme save. **Secondary color = sidebar menu highlight.**

**Images:** generic `POST /api/uploads/image` (multer) returns `{ path: '/uploads/..' }`, served statically; controllers only accept `/uploads/...` paths (reject external URLs). Use `pickImage()` (`app/src/api/imagePicker.js`, web file-input + native picker) → `api.uploadImage(picked)` → store the path → render with `assetUrl(path)`.

**Users table is dual-purpose:** `users` holds both the admin (role `admin`, `user_type_id` null) and **managed portal users** (retailers/distributors/employees — `user_type_id NOT NULL`, extended onboarding fields, `service_access`/`module_access` jsonb, `user_code` = settings `user_id_prefix` + seq, also the login username). Users Manager lists only managed users; wallet is adjusted via `POST /api/users/:id/fund`.

**Reusable UI:** `app/src/components/UI.js` (`Button` incl. `navy` variant, `TextField` with eye toggle, `Select` searchable dropdown that opens a modal, `Alert`, `Card`), and `app/src/components/Icon.js` (inline-SVG icons keyed by the `menu_items.icon` name — add a `case` when introducing a new icon). Row action buttons in lists use `app/src/components/ActionIcon.js` (`<ActionIcon name="edit|delete|view|fund|key" onPress={...} />`, SVG + tint + hover) - never emoji.
**Account menu & profile (every user type):** the topbar avatar opens `components/AccountMenu.js` (identity, wallet card, account links, sign out) and a wallet pill sits beside it; both panels use it - `DashboardScreen` (admin) and `RetailerShell` (retailer, distributor, super distributor, employees). `screens/ProfileScreen.js` (`/profile`) + `GET/PUT /api/account/profile` (own row only): name parts, email (needs current password), photo (`users.photo`, `/uploads/...`). Mobile, user type, KYC fields are read-only; a KYC-verified non-admin cannot rename themselves (`NAME_LOCKED`). `components/Avatar.js` shows the photo or initials. The look of the shells is the classic one (on purpose; a separate TopBar component and a logo band that replaced the wallet band were tried and removed at the user's request - see git history 74ef51d..3386670): a solid theme-Primary topbar with the menu search, wallet pill and avatar chip, and in the sidebar the blue wallet band (admin) / profile card with balance (retailer-type users). At the very top of the sidebar (both shells) sits the company logo band, `components/BrandLogo.js`, the same height as the topbar: the Web Logo (native: Mobile App Logo) from Application Settings -> Branding & Logos via `GET /api/settings/public` (`app.webLogo / mobileLogo / logoIcon / appName`), falling back to the Logo Icon, then an "A" badge + app name; a logo file that does not load falls back too. Everything coloured follows the Primary / Secondary saved in Application Settings. **One shell for every panel:** `app/src/shell/` - `useShellCore.js` (menu, active item, expanded groups, drawer, account menu, profile, collapse, app name), `AppShell.js` (sidebar + header + content + `AccountMenu`, Classic or Modern; `ScreenTitle`), `ClassicSidebar.js` / `ClassicHeader.js` (the classic look, `panel` = 'admin' | 'retailer' for the few differences). `screens/DashboardScreen.js` (admin) and `screens/RetailerShell.js` (distributor / super distributor / retailer / employees) only hold their route -> screen map, their wallet source and their dashboard; do not copy sidebar / header code back into them - change the shell once and every panel follows. **Layout style:** Application Settings -> Theme Colors -> Layout style, setting `layout_style` = `classic` (default) | `modern`, delivered to the app as `theme.layout` in `GET /api/settings/public` and cached with the theme (`theme.js` `ui.layout`, set by `applyTheme`). `modern` swaps the admin shell in `DashboardScreen.js` for `components/ModernSidebar.js` (wide, a coloured icon tile per top-level menu item picked automatically by position, collapsible), `components/ModernHeader.js` (white; sidebar toggle, app name + API mode "Mock / Live mode" from `GET /api/health`, wallet pill, settings gear, account chip) and `screens/ModernDashboard.js` (KPI cards, commission in / out / net, success / pending / failed / refund tiles, pay in / pay out, sales trend, top services, needs attention, recent transactions, with a Start / End date filter). The Modern sidebar / header are used by every panel (while the sidebar is collapsed the menu search moves to the header); each panel has its own Modern dashboard page (see Modern dashboards below). Its numbers come from the `range` block of `GET /api/admin/dashboard?from=&to=` (`dashboard.controller.js` `rangeStats`; refund = wallet credits whose remark starts "Refund"; pay in = approved fund requests; pay out = successful money transfer / move to bank).  **Colours from the logo:** `POST /api/settings/logo-colors { path }` (admin, `services/logoColors.service.js`, `sharp`) returns the brand colours of an uploaded logo (`{ primary, secondary, palette }`, nulls for a colourless logo); Application Settings -> Theme Colors shows "Colours from your logo" (auto after a Web Logo / Logo Icon upload, or the button) with Apply, and palette swatches under each picker; nothing changes until Save. The default theme (until colours are saved, and for "Reset theme to default") is "Royal navy and gold": `DEFAULT_PRIMARY #1e3a8a` / `DEFAULT_SECONDARY #b45309` in `theme.js`; the Settings boxes show it when nothing is saved. Without a logo the manual pickers work as before: hex typing, presets, "More colours" (a hue x lightness spectrum grid + greys, every platform) and, on the web, the big colour box opens the browser's full colour dialog (any colour, eyedropper in Chrome / Edge). `TOPBAR_HEIGHT` is shared with the sidebar logo band. Any colour the admin picks must stay readable (white Primary / Secondary included): `theme.js` `resolveTheme()` / `applyTheme()` split the Primary in two. `colors.brand` / `colors.onBrand` / `colors.brandBorder` are the EXACT chosen Primary and the text colour that reads on it - used only by the header (topbar, its pills, search, avatar disc), so a white Primary gives a white header with dark text and a thin border. `colors.primary` is `readable(Primary)` (unchanged for dark / mid colours, a darker shade for light ones) and is what everything else uses: buttons, table headers, menu icons, links, charts, so white text on it and it on white both read. `colors.onPrimary`, `colors.activeBg` (the Secondary, or the readable primary when the Secondary is too light - a white Secondary once hid the active "Dashboard") and `colors.onActive` complete the set. Never hard-code `'#fff'` on a primary / active / header background; use these. Application Settings shows a live preview (`ThemePreview`) built from `resolveTheme()`.

**Modern dashboards:** admin = `screens/ModernDashboard.js` (`GET /api/admin/dashboard?from&to` -> `range`); Distributor / Super Distributor / Retailer / employees = `screens/retailer/ModernRetailerDashboard.js` (`GET /api/retailer/dashboard?from&to`, owner-scoped to `req.user.id`: own status breakdown, refunds, commission own (ledger level 0) + from network (level > 0), pay in / pay out, sales trend, top services; types with a downline also get `network` = whole-downline successful volume, commission from it, head count). `RetailerShell` shows it on route `/` only when `ui.layout === 'modern'`; Classic keeps `RetailerDashboard`. Shared blocks (Kpi, StatusTile, FlowCard, SalesChart, TopServices, RangeFilter, styles `ds`) live in `components/DashboardParts.js`; the day-by-day trend is `dashboard.controller.salesTrendFor`. Tests: `test/dashboardrange.test.js`, `test/retailerdashboard.test.js`.

## Hierarchy & commission rules

- **Who may create whom** comes from the **User Type tree** (`user_types.parent_type_id`, edited in User Type Master):
  a user may create every type *below* its own type at any depth (SD -> Distributor and Retailer, Distributor ->
  Retailer, Retailer -> nothing). `network.repo.typesBelow/typesAbove/isTypeBelow` implement it; `canHaveDownline`
  (menu + `/api/network/*` gate) uses the same rule. The seed builds SD -> D -> R on a fresh DB; an existing DB keeps its tree.
- The creator becomes the **parent** (`parent_id`) and `created_by`. The admin form: no parent picked = the admin; a picked
  parent must be of a type above the new user's type (`PARENT_TYPE_MISMATCH`); types with no parent type always sit under
  the admin. `fund requests` are approved by `created_by` (unchanged).
- **Changing a user's type or parent** (admin, `PUT /api/users/:id`, preview `GET /api/users/:id/change-impact`): the
  new type must fit under the parent; direct children that no longer fit must be moved (`moveChildrenTo`, else
  `409 DOWNLINE_TYPE_MISMATCH`); a foreign plan and the received commission package are cleared, owned packages that no
  longer fit are switched off, the user is signed out (`token_epoch`), all in one transaction. Past ledger rows are never
  rewritten. Users with users below or with money/commission history cannot be deleted (`HAS_DOWNLINE` / `HAS_HISTORY`) - deactivate them.
- **Commission** (`commission.service.js`): the transacting user is paid its own slab; every upline up the `parent_id`
  chain (depth 10) is paid from **its own type + plan `chain` slab**, so a retailer straight under an SD pays the SD only
  (the skipped Distributor's share stays with the company as margin, by decision). An upline with no chain slab earns
  nothing - the Commission Slots screen warns about it (`GET /commission-slots/chain-gaps`).
- **Commission Report**: managed users `GET /api/retailer/commission-report` (own + whole downline, filters level /
  downline user / direct child, totals, via-child column) and `/retailer/commission-summary` (per direct child); admin
  `GET /api/commission-report`. Filters that name a user are checked against the caller's downline (404 otherwise).

## Deploy & rollback

Production is one EC2 box running Docker Compose (db, api, web); the server holds no git repo. CI (`.github/workflows/ci.yml`) runs lint + API tests on a fresh Postgres + a web build on every push/PR; it never deploys.

```bash
scripts/deploy.sh --dry-run        # plan + read-only checks (works offline too)
scripts/deploy.sh                  # deploy origin/main: tests, drift check, backup, rebuild changed services, health check, auto-rollback
scripts/deploy.sh rollback [sha]   # hot rollback (code only, ~15 s)
scripts/deploy.sh status
```

Setup once: copy `.deploy.env.example` to `.deploy.env` (git-ignored) and set `DEPLOY_HOST` (changes on every EC2 stop/start) and `DEPLOY_KEY` (path to the .pem, kept outside the repo). The very first run needs `--from <sha currently on the server>`; after that the server keeps a `~/fintech/.deployed_sha` marker. `scripts/remote-deploy.sh` / `remote-rollback.sh` are uploaded and run on the server by the script. Rollback restores the old files and re-tags the saved images; migration/data changes stay in the DB (the pre-deploy dump is in `~/backups/`). `docker-compose.yml` is not deployed by the script (it warns when it changes).

## Password reset & recovery

- **No one can see a password** (bcrypt only). Admin → Users Manager 🔑 → `POST /api/users/:id/reset-password {newPassword?}` sets a temporary password
  (given, min 8, else generated; returned once, never stored/logged), signs the user out everywhere (`token_epoch`), clears the failed-login lock and sets
  `users.must_change_password`. While it is set, `middleware/auth.js` answers `403 PASSWORD_CHANGE_REQUIRED` to everything except `/api/me`,
  `/api/account/change-password`, `/api/account/logout`; the app shows only the Change Password screen (`App.js`). Admin only, managed users only.
- **Admin forgot their own password:** on the server `docker compose exec api node scripts/reset-admin-password.js [--username admin]` prints a new random password once.
- Blocking a user (Status switch) also bumps `token_epoch`, so an unblock does not revive old sessions.
- No self-service "Forgot password?" yet: it needs a real SMS provider + `NODE_ENV=production` first (the dev master OTP would let anyone reset any account).

## Conventions & gotchas

- Module routes are `/modules/<x>`; top-level ones are `/<x>` (e.g. `/company-banks`). Match them in `DashboardScreen.js`'s route chain.
- The app is theme-mutation based: a theme change needs the app to reload to fully apply (web reload is automatic on save; native applies next launch).
- `app/AGENTS.md` (via `app/CLAUDE.md`): **Expo has changed — read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing app code.** Stick to standard RN APIs used by existing screens.
- Dev-only env flags (`api/.env`, ignored when `NODE_ENV=production`): `DEV_MASTER_OTP`, `CAPTCHA_DEV_ECHO`.
- Learning UI from screen recordings: extract frames with the bundled ffmpeg (see the `ffmpeg-for-recordings` note) and read the JPGs.

## Git & sensitive data

- **Never commit sensitive information**: passwords, API keys/tokens, `.pem`/`.key` files, `api/.env`, production IPs or credentials, DB dumps, or real personal/bank data (real mobile numbers, account numbers, Aadhaar/PAN). Seed and test data must use obviously dummy values.
- Already git-ignored: `.env`, `raw_data/`, `api/uploads/`, `.vscode/settings.json`, `*.pem`, `.claude/`. A local `pre-commit` hook (`.git/hooks/pre-commit`) blocks secret-looking files and content; never bypass it with `--no-verify`.
- Review `git diff --cached` before every commit. The repo is local only — do not push unless asked.

## Intellectual property

This is an **independent, original implementation**; reference videos are used only as functional reference. Never introduce third-party branding ("Dactilar") name/logo/content, and author all user-facing copy (Terms, Privacy, About Us). See `NOTICE.md`.
