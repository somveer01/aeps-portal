# B2B AePS Software — Retailer Panel Specification & Build Plan

| | |
|---|---|
| **Document** | Retailer Panel Specification (functional spec + phased build plan) |
| **Version** | 1.0 |
| **Date** | 2026-09-18 |
| **Status** | Planned (to be built) — reference: retailer demo recording |
| **Owner** | Somveer (somveerkushwaha@gmail.com) |
| **Companion** | Builds on the existing **admin panel** — see `01_spect_admin_document.md` and `CLAUDE.md` |

---

## 1. Purpose & Vision

A **B2B AePS software retailer panel**: a single, self-service interface a retailer (agent /
"Banking Point") logs into to run **all** their day-to-day fintech services and manage their money —
so their shop runs smoothly from one place. It offers a wide range of services:

> **AEPS**, **DMT** (money transfer), **Flight / Hotel / Bus booking**, **Recharge** (mobile + DTH),
> **BBPS** (bill payment), **CMS**, **Micro ATM**, **PAN card (NSDL)**, **LIC payment**,
> **Gas booking**, **FASTag recharge**, plus Aadhaar Pay, Move to Bank, UPI Collection, Fund
> Request/Transfer — and more via pluggable APIs.

From one dashboard the retailer manages **transactions, payments and bookings**, tracks **wallet +
commission**, and pulls **reports (GST/TDS/commission)** — saving time and resources.

**Relationship to the admin panel:** the retailer is a **managed user** (`users.user_type_id` =
Retailer) that the admin already onboards in **Users Manager**. The admin panel controls
services, plans, commission slabs, KYC approval, and funding; the **retailer panel is the
front-of-house** where those services are consumed. Both are the **same monorepo** (`api/` + `app/`),
so most infrastructure is reused, not rebuilt.

---

## 2. Design Principles (carry over from the existing build)

1. **Same monorepo & stack** — Express + PostgreSQL + Knex (`api/`), Expo/React Native web+mobile
   (`app/`). No new stack. Reuse `UI.js`, `theme.js`, `Icon.js`, the master-screen pattern, DB-driven
   menu, image uploads, and the hardening layer (RBAC, idempotency, audit, token revocation).
2. **Role-scoped, not a second app** — the retailer panel is the **role-based experience** of the
   same app. On login, branch by `user.role`: `admin` → current `DashboardScreen`; `retailer` (and
   other managed types) → new `RetailerShell`. The menu is filtered by role.
3. **Runnable with ZERO credentials** — every external service (recharge, BBPS, AEPS device, DMT,
   booking, LIC, FASTag) sits **behind an interface with a mock adapter**, selected by `APP_MODE`
   (default `mock`) — reusing the pattern already added in `services/kyc.service.js`. The whole panel
   must be demo-able end-to-end with no live API keys.
4. **Money is sacred** — every service purchase is a wallet transaction: **debit → call provider →
   on success write commission via the commission engine → ledger rows → receipt; on failure,
   refund**. All money endpoints use **idempotency keys** and write **audit rows** (both already
   implemented).
5. **Ownership isolation** — a retailer sees **only their own** data. Add `requireRole('retailer')`
   and scope every query to `req.user.id` (extends the RBAC already in `middleware/auth.js`).

---

## 3. Personas & Roles

- **Retailer** — the primary user. Consumes services, holds a wallet, earns commission, raises fund
  requests, sees own reports. `role='retailer'`, `user_type_id` set, `kyc_status`.
- **Distributor** (future) — same panel, can fund/oversee downstream retailers.
- **Admin** — existing panel; approves KYC, funds wallets, sets commission slabs, monitors.

---

## 4. Information Architecture (retailer sidebar)

From the recording, the retailer sidebar is:

- **Dashboard** — wallet + commission cards (sparklines) + **Service Statics** bar chart (per service, From/To date filter).
- **Profile** ▸ (details, **Authorized Banking Point certificate**, downloads)
- **KYC** ▸ (e-KYC / KYC status)
- **Services** — **B2B Services** tab + **Online Services** tab (grids of service tiles).
- **Service Report** ▸
- **Account History** (wallet transaction ledger with filters)
- **My Commission Slab** (read-only view of the retailer's applicable slabs)
- **GST Report**
- **TDS Report**
- **Commission Report**
- **Account** → **Account Settings** ▸ (Account Password / Transaction Password — OTP based)

Profile card (top of sidebar): avatar, name, **Retailer | KYC ✓**, **Balance ₹**.
Topbar: welcome/marquee helpline text + user menu.

**Services — B2B tab tiles:** Mobile Recharge · DTH Recharge · Bill Payment (BBPS) · AEPS · Money
Transfer (DMT) · Move To Bank · Fund Request · Aadhar Pay · Micro ATM · Fund Transfer · FASTag · UPI
Collection · Fino CMS · LIC Bill Payment · NSDL PAN Card · Gas Booking.
**Services — Online tab tiles:** Flight Booking · Hotel Booking · Bus Booking (+ future travel/utility).

---

## 5. Service Catalogue & Flows (from the recording)

Each service is a focused screen. Common shape: a left **input form** card + a right **info/result**
card, then a **printable receipt** on success.

| Service | Key inputs | Flow / result |
|---|---|---|
| **Mobile Recharge** | Mobile No, Operator, Circle, Amount (+ **Browse Plans** tabs: FULLTT/TOPUP/3G-4G/2G/SMS/COMBO/Roaming) | debit → recharge → receipt |
| **DTH Recharge** | DTH No, Operator, Amount (+ **Check DTH Info**: balance, name, next recharge, plan) | debit → recharge → receipt |
| **Bill Payment (BBPS)** | Category (Electricity/Insurance/Gas/…), Operator (searchable), Mode → **Check Bill** → Bill Details → Pay | fetch bill → pay → receipt |
| **AEPS** | Txn Type (Balance Enquiry / Cash Withdrawal / Mini Statement), Device Type (Morpho/Mantra/…), Mobile, Aadhaar, Bank Name, **Biometrics capture**, Amount (withdrawal), T&C → **Capture Fingerprint** | device capture → provider → **Customer Copy** receipt (RRN, Ack no, Ref id, status) |
| **Aadhar Pay** | like AEPS but card-less merchant payment | capture → receipt |
| **Micro ATM** | device-based card txn | capture → receipt |
| **Money Transfer (DMT)** | Sender by mobile (KYC/register) → **Beneficiaries** (Name, Available/Used limit; add/verify/delete) → **Transfer** (amount, mode IMPS/NEFT) | verify → transfer → receipt |
| **Move To Bank** | payout to a bank account | debit → payout → receipt |
| **UPI Collection** | collect via UPI id/QR | create request → status |
| **Fino CMS** | cash management deposit | debit/collect → receipt |
| **LIC Bill Payment** | Policy no, Email, Mode, Amount → **Bill Details** → pay | fetch → pay → receipt |
| **NSDL PAN Card** | new/correction PAN application | submit → status |
| **Gas Booking** | provider, consumer no → bill → pay | fetch → pay → receipt |
| **FASTag Recharge** | provider, vehicle/tag → amount | debit → recharge → receipt |
| **Fund Request** | amount, company bank, mode, reference, screenshot | request → admin approves (existing admin flow) |
| **Fund Transfer** | to downstream user, amount, txn PIN | atomic transfer (reuse admin fund-transfer engine) |
| **Flight / Hotel / Bus** (Online) | search → select → passenger/guest details → pay → ticket/voucher | search → book → e-ticket |

---

## 6. Data Model (additions to the existing schema)

Reuse existing tables where possible: `users` (retailer rows), `account_transactions` (wallet
ledger), `service_transactions` (per-service report), `commission_slots` + `commission_ledger`
(commission/GST/TDS), `fund_requests`, `fund_transfers`, `services`, `banks`, `settings`,
`kyc_verifications`, `menu_items`.

**New tables (per feature phase):**
- `operators` — recharge/BBPS/DTH/gas operators (name, service_id, category, circle support, active).
- `dmt_senders` — DMT remitter registration (mobile, name, kyc status, monthly limit).
- `dmt_beneficiaries` — sender_id, name, bank, account_no, ifsc, verified flag, limit used.
- `service_transactions` (extend) — provider ref/RRN, status, request/response JSON, operator, target,
  amount, charge, commission, gst, tds (feeds receipts + reports).
- `bookings` — type (flight/hotel/bus), pnr/voucher, pax JSON, amount, status, provider ref.
- `receipts` (optional) — or render from `service_transactions`.
- `provider_credentials` (admin, encrypted) — per-provider API keys used only in `live` mode.

All money columns `numeric(14,2)`; every txn keeps `before_balance`/`updated_balance`.

---

## 7. Provider Abstraction (the key to "zero-credentials")

Every external integration is an **interface with `mock` (default) + `live` adapters**, selected by
`env.appMode` — mirroring `services/kyc.service.js`. Suggested services under `api/src/services/`:

- `recharge.service.js` (mobile/DTH: `plans()`, `recharge()`, `dthInfo()`)
- `bbps.service.js` (`categories()`, `operators()`, `fetchBill()`, `payBill()`)
- `aeps.service.js` (`devices()`, `capture()`, `balanceEnquiry()`, `withdraw()`, `miniStatement()`)
- `dmt.service.js` (`registerSender()`, `verifyBeneficiary()`, `transfer()`)
- `booking.service.js` (`search()`, `book()`, `cancel()` for flight/hotel/bus)
- `pan.service.js`, `lic.service.js`, `fastag.service.js`, `gas.service.js`, `cms.service.js`

**Mock adapters** return realistic, deterministic responses (success + a few failure cases) so the
whole panel demos without keys. **Live adapters** are clearly-marked stubs that read
`provider_credentials` and throw `PROVIDER_NOT_CONFIGURED` until wired. `/api/health` already reports
`mode` + `adapters`; extend `adapters` to list these.

**Transaction pipeline (single helper, reused by every service):**
```
begin txn
  lock wallet, check balance >= amount+charge      (guarded, atomic)
  debit wallet, write account_transactions (debit)
  call provider adapter (idempotent, timeout+retry)
  if success:
     write service_transactions (success + provider ref)
     commission.service.recordServiceCommission(...)  → commission_ledger (+GST/TDS)
     if commission credited, write account_transactions (credit)
  else:
     refund debit (reverse), mark service_transactions failed
commit
→ return receipt payload
```
Reuse the **idempotency middleware** on every service POST and **audit** every one.

---

## 8. API Surface (new, all `requireRole('retailer')` + owner-scoped)

`GET /api/retailer/summary` (wallet + today's stats + commission) ·
`GET /api/retailer/service-stats?from&to` (dashboard chart) ·
`GET /api/services/catalogue` (B2B + online tiles from `services`) ·
recharge: `GET /recharge/plans`, `POST /recharge/mobile`, `POST /recharge/dth`, `GET /recharge/dth-info` ·
bbps: `GET /bbps/operators`, `POST /bbps/fetch-bill`, `POST /bbps/pay` ·
aeps: `GET /aeps/devices`, `POST /aeps/transact` ·
dmt: `POST /dmt/sender`, `GET /dmt/beneficiaries`, `POST /dmt/beneficiary`, `POST /dmt/beneficiary/:id/verify`, `POST /dmt/transfer` ·
booking: `GET /booking/:type/search`, `POST /booking/:type/book` ·
`POST /lic/pay`, `POST /fastag/recharge`, `POST /gas/pay`, `POST /pan/apply`, `POST /cms/*` ·
reports (owner-scoped): `GET /retailer/account-history`, `/service-report`, `/gst-report`, `/tds-report`, `/commission-report`, `/my-commission-slab` ·
`POST /fund-requests` (retailer raises), account: `change-password`, `txn-pin` (reuse existing).

---

## 9. Phased Build Plan (develop step-by-step)

> Each phase is shippable and demo-able on its own (mock mode). Follow the **master-screen +
> repo→controller→route→menu→screen** pattern from `CLAUDE.md`.

**Phase 0 — Foundation & role routing**
- Add `requireRole('retailer')`; give managed users a login (they already have `user_code` + a
  password — confirm login works for a retailer, otherwise add credential set in Users Manager).
- `App.js`: after auth, branch on `user.role` → `RetailerShell` vs admin `DashboardScreen`.
- Build `RetailerShell` (sidebar profile card with balance/KYC, topbar, DB-menu filtered to retailer
  routes). Seed retailer `menu_items` (a role/`user_type` column or a `menu_roles` map).
- *Deliverable:* a retailer logs in and sees an (empty) themed shell.

**Phase 1 — Dashboard & wallet**
- `GET /api/retailer/summary` + `service-stats`. Dashboard cards (Commission Earning, Wallet, History)
  + **Service Statics** bar chart with From/To (use `react-native-svg`; no chart dep needed).
- *Deliverable:* live balance + stats.

**Phase 2 — Services framework**
- `ServicesScreen` with **B2B**/**Online** tabs and a responsive tile grid (reuse `Icon.js`; add
  service icons). Tiles route to service screens. `GET /api/services/catalogue`.
- Build the **transaction pipeline helper** (§7) + provider interface skeletons (mock).
- *Deliverable:* the services grid navigates; pipeline proven with one mock service.

**Phase 3 — Recharge & BBPS family** (Mobile, DTH, Bill Payment, LIC, Gas, FASTag)
- Recharge screens with **Browse Plans** / **Check DTH Info**; BBPS Category→Operator→Fetch→Pay;
  LIC/Gas/FASTag. All via mock adapters → receipts.
- *Deliverable:* end-to-end recharge/bill flows with commission + receipt.

**Phase 4 — AEPS suite** (AEPS, Aadhar Pay, Micro ATM)
- Biometric **device abstraction** (mock capture on web; RD-service hook on native/live). Txn types:
  Balance Enquiry / Cash Withdrawal / Mini Statement. **Customer Copy** printable receipt.
- *Deliverable:* AEPS balance/withdrawal/mini-statement with receipts.

**Phase 5 — DMT & payouts** (Money Transfer, Move To Bank, UPI Collection, Fino CMS)
- Sender registration/KYC → **beneficiary CRUD + verify** → transfer (IMPS/NEFT). Limits tracking.
- *Deliverable:* DMT with beneficiaries and transfers.

**Phase 6 — Online bookings** (Flight, Hotel, Bus)
- `booking.service` (mock search/book) → search results → passenger/guest details → pay → e-ticket
  voucher (print). `bookings` table.
- *Deliverable:* one booking type fully, then replicate.

**Phase 7 — Reports & receipts**
- Owner-scoped Account History, Service Report, GST, TDS, Commission Report, My Commission Slab
  (reuse the admin report screens + `reportStyles`; filter to `req.user.id`). Reusable **receipt/
  invoice** component + print.
- *Deliverable:* retailer sees only their own data across all reports.

**Phase 8 — Profile, KYC, Account Settings**
- Profile + **Authorized Banking Point certificate** (generate as an HTML/print view — author your own
  copy, no third-party branding). KYC / e-KYC status. Account Settings tabs (Account Password /
  Transaction Password) — reuse change-password + txn-PIN endpoints.
- *Deliverable:* self-service account management.

**Phase 9 — Commission wiring & hardening**
- Wire `commission.service.recordServiceCommission()` into the pipeline so **GST/TDS/Commission
  reports are generated from real transactions** (closes the P1 item in `01_spect_admin_document.md`
  §14). Fund Request/Transfer; final RBAC/idempotency/audit review; mock→live adapter switch by
  `APP_MODE`.
- *Deliverable:* production-ready retailer panel (mock by default, live-capable).

---

## 10. Non-Functional & Reuse Checklist

- **Theming:** reuse `theme.js` (`applyTheme`, `shadows`); the polished UI kit already applies.
- **Cross-platform:** one Expo codebase (web + Android + iOS); biometric RD-service only on
  device/live.
- **Security:** owner-scoped queries, `requireRole`, idempotency + audit on money, token revocation,
  transaction PIN for AEPS/DMT/transfers (already built).
- **Receipts/print:** web `window.print()` view; native share/PDF later.
- **i18n:** the login/dashboard show Hindi copy in the reference — keep copy configurable in
  `settings` (author your own; **no "Dactilar" branding** — see `NOTICE.md`).
- **Tests:** extend `api/test/` (node:test) — pipeline debit/refund, commission on success,
  ownership isolation, idempotency per service.

---

## 11. Link from the Admin Panel

A **"Retailer Panel"** entry is added to the **admin** sidebar (top-level `menu_items` row →
`/retailer-panel`). It opens an in-app screen that:
- summarizes the B2B + Online service catalogue this spec covers,
- links to this document (`02_spect_retailer_document.md`),
- and provides an **"Open Retailer Panel"** button that navigates to the retailer panel URL
  (configurable in `settings` as `retailer_panel_url`; defaults to the app origin, since the retailer
  panel is the role-based experience of the same app).

This gives the admin a one-click jump to the retailer experience while it is being built out phase by
phase.

---

## 12. Appendix

**Glossary** — **AEPS** Aadhaar Enabled Payment System · **DMT** Domestic Money Transfer · **BBPS**
Bharat Bill Payment System · **CMS** Cash Management Services · **RD service** Registered Device
(biometric) · **RRN** Retrieval Reference Number · **BC** Business Correspondent.

**IP** — independent, original implementation; reference videos are functional reference only. No
third-party branding; author all user-facing copy. See `NOTICE.md`.

*End of document.*
