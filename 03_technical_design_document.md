# Technical Design Document — B2B AePS Retailer Panel

| | |
|---|---|
| **Document** | Technical Design Document (TDD) — Retailer Panel |
| **Version** | 1.0 |
| **Date** | 2026-09-18 |
| **Status** | Design (ready to build, phase by phase) |
| **Owner** | Somveer (somveerkushwaha@gmail.com) |
| **Source spec** | `02_spect_retailer_document.md` (what to build) |
| **Related** | `01_spect_admin_document.md` (admin as-built), `CLAUDE.md`, `NOTICE.md` |

> **How to read:** the spec (02) is the *what*; this TDD is the *how*. §3–§9 are the build blueprint;
> §9 has an ASCII wireframe for **every** screen. §15 maps each spec section to a design section so
> nothing is dropped. All named files/functions below already exist in the repo and are meant to be
> reused, not rewritten.

---

## 1. Overview, Goals & Non-Goals

The retailer panel is the **front-of-house** experience of the existing monorepo: a managed user
(`role='retailer'`) logs into the *same* Expo app and API, and runs AEPS, DMT, recharge, BBPS, CMS,
Micro ATM, LIC, Gas, FASTag, PAN, UPI, bookings, etc., against their wallet — earning commission and
pulling their own reports.

**Goals**
- One role-scoped app (no second codebase); reuse auth, RBAC, theming, hardening, reports.
- Every external integration behind a **mock-first adapter** so the panel demos with **zero credentials**.
- Every money action is **atomic, idempotent, audited, refund-on-failure**, and feeds the commission/GST/TDS ledger.
- A retailer can only ever see/act on **their own** data.

**Non-Goals (this design)**
- No live provider integrations shipped in mock mode (live adapters are stubs until keys are wired).
- No new tech stack; no microservices; no separate deployment for the retailer (same origin).
- Settlement/reconciliation with banks/NPCI is out of scope (handled by providers in live mode).

---

## 2. Traceability at a glance

| Spec 02 § | Topic | TDD § |
|---|---|---|
| §2 principles | Reuse, mock-first, money-safe, ownership | §3, §6, §7, §10 |
| §4 IA / sidebar | Retailer navigation | §9 (shell + catalogue) |
| §5 services & flows | Every service screen | §7 pipeline, §8 API, §9 catalogue |
| §6 data model | Tables | §5 |
| §7 provider abstraction | Adapters | §6 |
| §8 API surface | Endpoints | §8 |
| §9 phased plan | Build order | §4, §14 |
| §10 non-functional | NFRs | §11, §12, §13 |

---

## 3. Architecture

### 3.1 Role-based single app
Login is unchanged (password + captcha → OTP → access JWT). `App.js` already applies theme before
screens load; it will branch on `user.role` after auth:

```
LoginScreen → OtpScreen → (access token, user)
                               │
              role === 'admin' ┤→ DashboardScreen        (existing)
        role === 'retailer'    └→ RetailerShell          (new; same shell mechanics)
```

`RetailerShell` is a near-clone of `app/src/screens/DashboardScreen.js` (sidebar profile card + blue
topbar + DB-driven menu + route chain) — the difference is the **menu is filtered to retailer routes**
and the content pane maps retailer routes to retailer screens.

### 3.2 Layered API (unchanged shape)
```
HTTP → middleware (requireAuth → requireRole('retailer') → idempotency*)
     → controller (validate via utils/validate.js)
     → repository (Knex, owner-scoped queries)
     → domain service (recharge/bbps/aeps/dmt/booking …)
        └→ provider adapter (mock | live, chosen by APP_MODE)
     → transaction pipeline (wallet debit → provider → commission → ledger → refund on fail)
     → audit.repo.log(...)                         (*idempotency only on money POSTs)
```

### 3.3 Component & deployment view
```mermaid
flowchart LR
  subgraph app [Expo app (web/iOS/Android)]
    RS[RetailerShell] --> SC[Service screens] --> AC[api/client.js]
  end
  AC -->|Bearer JWT + Idempotency-Key| API[(Express API)]
  subgraph API
    MW[auth / role / idempotency] --> CT[controllers] --> RP[repositories]
    CT --> DS[domain services] --> AD{provider adapter}
    CT --> PL[txn pipeline] --> COMM[commission.service]
  end
  RP --> PG[(PostgreSQL)]
  PL --> PG
  AD -->|mock| MOCK[deterministic responses]
  AD -->|live| EXT[(external provider APIs)]
```
Deployment is the same single API + static app bundle; retailer and admin share the origin. `APP_MODE`
(default `mock`) decides mock vs live adapters.

### 3.4 Request lifecycle (money POST)
1. `requireAuth` verifies JWT + re-checks `is_active`/`token_epoch` (revocation), sets `req.user`.
2. `requireRole('retailer')` gates the route.
3. `idempotency` reserves the `Idempotency-Key` (dedupes retries).
4. Controller validates, calls the pipeline; repository queries are `where user_id = req.user.id`.
5. Pipeline runs in a DB transaction; `audit.repo.log` records the action.

---

## 4. Module Decomposition (what to add, by phase)

Naming mirrors existing files (`<x>.controller.js`, `<x>.repo.js`, `<x>.service.js`).

**API (`api/src/`)**
- middleware: reuse `auth.js` (add nothing — `requireRole` exists), `idempotency.js`.
- services (adapters): `recharge.service.js`, `bbps.service.js`, `aeps.service.js`, `dmt.service.js`,
  `booking.service.js`, `lic.service.js`, `gas.service.js`, `fastag.service.js`, `cms.service.js`,
  `pan.service.js`; plus `txnPipeline.service.js` (the shared money helper).
- controllers: `retailer.controller.js` (summary/stats/catalogue), one per service family, `dmt.controller.js`, `booking.controller.js`; reuse `reports.controller.js` (owner-scoped variants), `account.controller.js`, `fundTransfer.controller.js`.
- repositories: `operator.repo.js`, `dmt.repo.js`, `booking.repo.js`, `serviceTxn.repo.js`; reuse `reports.repo.js`, `audit.repo.js`.
- routes: extend `api.routes.js` with a retailer block.
- migrations/seeds: one migration per phase (§5, §14); seeds for `operators` + mock data.

**App (`app/src/`)**
- `screens/RetailerShell.js` (+ menu filter helper).
- `screens/retailer/*.js` — one screen per §9 catalogue.
- `components/Receipt.js` (printable), `components/ServiceTile.js`, `components/BiometricCapture.js`.
- `api/client.js` — add `api.retailer.*`, `api.recharge.*`, `api.bbps.*`, `api.aeps.*`, `api.dmt.*`, `api.booking.*` (idempotency keys on money calls via existing `idemKey()`).

---

## 5. Data Model Design

Reuse: `users`, `account_transactions`, `service_transactions`, `commission_slots`,
`commission_ledger`, `fund_requests`, `fund_transfers`, `services`, `banks`, `settings`,
`kyc_verifications`, `menu_items`.

### 5.1 New tables (illustrative Knex)
```js
// operators — recharge/DTH/BBPS/gas/fastag operators
t.increments('id'); t.integer('service_id').references('id').inTable('services');
t.string('name',120).notNullable(); t.string('category',60); // Electricity, DTH, Prepaid…
t.string('code',60); t.boolean('circle_required').defaultTo(false);
t.boolean('is_active').defaultTo(true); t.timestamps(true,true);

// dmt_senders — remitter registration (per retailer)
t.increments('id'); t.integer('retailer_id').references('id').inTable('users').onDelete('CASCADE');
t.string('mobile',15).notNullable(); t.string('name',120);
t.string('kyc_status',20).defaultTo('pending'); t.decimal('monthly_limit',14,2).defaultTo(25000);
t.decimal('used_limit',14,2).defaultTo(0); t.timestamps(true,true);
t.unique(['retailer_id','mobile']);

// dmt_beneficiaries
t.increments('id'); t.integer('sender_id').references('id').inTable('dmt_senders').onDelete('CASCADE');
t.string('name',120); t.string('bank_name',120); t.string('account_no',40);
t.string('ifsc',20); t.boolean('verified').defaultTo(false); t.timestamps(true,true);

// bookings — flight/hotel/bus
t.increments('id'); t.integer('retailer_id').references('id').inTable('users').onDelete('CASCADE');
t.string('type',10); // flight|hotel|bus
t.string('pnr',40); t.jsonb('pax'); t.decimal('amount',14,2);
t.string('status',20).defaultTo('booked'); t.string('provider_ref',80);
t.jsonb('detail'); t.timestamps(true,true);

// provider_credentials — encrypted, admin-managed, used only in live mode
t.increments('id'); t.string('provider',60).unique(); t.text('config_enc'); // AES-GCM blob
t.boolean('is_active').defaultTo(false); t.timestamps(true,true);
```

### 5.2 `service_transactions` extension (feeds receipts + reports)
Add if missing: `operator`, `target` (number/account), `amount`, `charge`, `commission`, `gst`,
`tds`, `status` (`success|failed|pending`), `provider_ref` (RRN), `request` jsonb, `response` jsonb,
`before_balance`, `updated_balance`. Index `(user_id, created_at)`, `(service, status)`.

### 5.3 ER (new + key existing)
```
users(id) 1───* dmt_senders 1───* dmt_beneficiaries
users(id) 1───* service_transactions *───1 services
users(id) 1───* bookings
services(id) 1───* operators
users(id) 1───* account_transactions   users(id) 1───* commission_ledger
```
All money `numeric(14,2)`; every ledger row carries `before_balance`/`updated_balance`.

---

## 6. Provider Abstraction

Mirror `api/src/services/kyc.service.js`: each service module exports one interface, and
`module.exports = env.isLive ? live : mock` (with `.mode`). Selection is by **`APP_MODE`** in
`api/src/config/env.js` — never inferred from a key being present.

### 6.1 Interface (per family)
```js
// recharge.service.js
{ mode, async plans({operator,circle}), async recharge({operator,number,amount,ref}),
  async dthInfo({operator,number}) }
// bbps.service.js  { categories(), operators(cat), fetchBill(input), payBill(input) }
// aeps.service.js  { devices(), capture(input), transact({txnType,aadhaar,bank,amount,bio}) }
// dmt.service.js   { registerSender(input), verifyBeneficiary(input), transfer(input) }
// booking.service  { search(type,q), book(type,input), cancel(type,ref) }
```

### 6.2 Mock vs live
- **mock (default):** deterministic success + seeded failure cases (e.g. amount `1` → declined,
  invalid operator → error) so tests and demos are stable. No network.
- **live:** reads `provider_credentials` (decrypted at call time); throws
  `{status:503, code:'PROVIDER_NOT_CONFIGURED'}` until wired. HTTP calls use a **timeout (e.g. 30s)**
  and **bounded retry** on network errors only (never on a definitive decline).

### 6.3 Error taxonomy
`INSUFFICIENT_BALANCE` (400), `PROVIDER_DECLINED` (402), `PROVIDER_TIMEOUT` (504),
`PROVIDER_NOT_CONFIGURED` (503), `INVALID_INPUT` (400), `IDEMPOTENT_IN_PROGRESS` (409). Surfaced via
the existing error handler (`api/src/app.js`) which already emits `{error, code}`.

### 6.4 Health
Extend `/api/health` `adapters` (in `app.js`) to include `recharge/bbps/aeps/dmt/booking` → `mock|live`.

---

## 7. Transaction Pipeline (the heart of the panel)

One reusable helper `txnPipeline.service.run()` used by **every** paid service. It composes the
already-built pieces: guarded wallet update (see `fundTransfer.repo.transfer`), `commission.service
.recordServiceCommission()`, `audit.repo.log()`, and the `idempotency` middleware on the route.

```js
async function run({ user, service, amount, charge=0, target, meta, providerCall }) {
  return db.transaction(async (trx) => {
    const u = await trx('users').where({id:user.id}).forUpdate().first('wallet_balance','user_type_id');
    const debit = amount + charge;
    if (Number(u.wallet_balance) < debit) throw err(400,'INSUFFICIENT_BALANCE');
    const before = Number(u.wallet_balance), afterDebit = before - debit;
    await trx('users').where({id:user.id}).update({wallet_balance:afterDebit});
    await trx('account_transactions').insert({user_id:user.id, service_name:service, type:'debit',
      amount:debit, before_balance:before, updated_balance:afterDebit, remark:meta.remark});
    let res;
    try { res = await providerCall(); }                    // adapter (mock|live), idempotent
    catch (e) {                                            // refund + record failure
      await trx('users').where({id:user.id}).update({wallet_balance:before});
      await trx('service_transactions').insert({user_id:user.id, service, status:'failed',
        amount, charge, target, response: e.detail || {error:e.message}});
      throw e;
    }
    await trx('service_transactions').insert({user_id:user.id, service, status:'success',
      amount, charge, target, provider_ref:res.ref, response:res});
    // commission (+GST +TDS) → commission_ledger, then credit wallet if any
    const comm = await commission.recordServiceCommission({trx, userId:user.id,
      userTypeId:u.user_type_id, serviceName:service, amount, wallet:{before:afterDebit}});
    return { receipt: buildReceipt(service, res, {before, afterDebit}), providerRef:res.ref };
  });
}
```
Notes: the route wraps this with `idempotency` (dedupe retries) and the controller calls
`audit.repo.log` after commit. `commission.service.js` already computes commission/GST/TDS.

### 7.1 Sequence — AEPS cash withdrawal
```
Retailer→App: fill AEPS form, Capture Fingerprint
App→API: POST /api/aeps/transact {txnType:'withdrawal',aadhaar,bank,amount,bio}  (+Idempotency-Key)
API: requireRole('retailer') → idempotency reserve
API→aeps.service.transact(): device+provider (mock returns RRN, status)
pipeline: debit wallet → on success service_transactions(success) → commission → (credit)
API→App: {receipt:{RRN,ack,ref,status,balance}}
App: render Customer Copy receipt → Print
```

### 7.2 Sequence — mobile recharge
```
App→API GET /api/recharge/plans?operator&circle   (browse plans)
App→API POST /api/recharge/mobile {number,operator,amount}  (+Idempotency-Key)
pipeline: debit → recharge.service.recharge() → success → commission → receipt
```

### 7.3 Sequence — DMT transfer
```
App→API POST /api/dmt/sender {mobile}          → register/find sender (KYC)
App→API GET  /api/dmt/beneficiaries?senderId
App→API POST /api/dmt/beneficiary/:id/verify   → penny-drop verify (mock)
App→API POST /api/dmt/transfer {beneficiaryId,amount,mode,txnPin} (+Idempotency-Key)
API: txnAuth.verify(user, txnPin) → pipeline debit → dmt.service.transfer() → receipt
```

### 7.4 Sequence — booking (flight/hotel/bus)
```
App→API GET  /api/booking/flight/search?...     → results
App→API POST /api/booking/flight/book {offerId,pax} (+Idempotency-Key)
pipeline: debit → booking.service.book() → bookings row + service_transactions → e-ticket
```

---

## 8. API Contracts (representative)

All retailer routes: `requireAuth → requireRole('retailer')`; money POSTs also take `Idempotency-Key`
and run through `idempotency`. Every list/report is **owner-scoped** (`user_id = req.user.id`). Error
envelope: `{ "error": string, "code": string }` with HTTP status from §6.3.

```
GET /api/retailer/summary
 → { balance, kycStatus, today:{count,amount}, commissionToday }

GET /api/retailer/service-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 → { rows:[{ service, amount, count }] }

GET /api/services/catalogue
 → { b2b:[{key,title,icon,route}], online:[...] }

GET /api/recharge/plans?operator=Airtel&circle=Delhi
 → { tabs:[{key:'TOPUP',plans:[{price,validity,desc}]}] }
POST /api/recharge/mobile   { number, operator, circle, amount }
 → 201 { receipt:{ ref, status, amount, before, updated } }   | 400 INSUFFICIENT_BALANCE | 402 PROVIDER_DECLINED

POST /api/bbps/fetch-bill   { category, operator, params }   → { bill:{name, amount, dueDate, billNo, ... } }
POST /api/bbps/pay          { category, operator, params, amount } → 201 { receipt }

GET  /api/aeps/devices      → { devices:['Morpho','Mantra','Startek'] }
POST /api/aeps/transact     { txnType, deviceType, mobile, aadhaar, bank, amount?, bio } → 201 { receipt }

POST /api/dmt/sender             { mobile }                → { sender:{id,name,kycStatus,availableLimit} }
GET  /api/dmt/beneficiaries?senderId=..                   → { rows:[{id,name,bank,accountNo,ifsc,verified}] }
POST /api/dmt/beneficiary        { senderId,name,bank,accountNo,ifsc } → 201 { row }
POST /api/dmt/beneficiary/:id/verify                      → { verified:true, name }
POST /api/dmt/transfer           { beneficiaryId, amount, mode, txnPin } → 201 { receipt }

GET  /api/booking/:type/search?...   → { results:[...] }
POST /api/booking/:type/book         { offerId, pax } → 201 { ticket }

GET  /api/retailer/account-history | /service-report | /gst-report | /tds-report
   | /commission-report | /my-commission-slab           (filters: from,to,service,type,page,pageSize)
POST /api/fund-requests   (retailer raises; admin approves via existing flow)
POST /api/account/change-password | /account/txn-pin | /account/logout   (reuse existing)
```

---

## 9. Frontend Design + Screen Catalogue

### 9.1 Shell & conventions
- `RetailerShell` = `DashboardScreen` mechanics with a **role-filtered menu**. Menu filtering: add a
  `roles`/`user_type` scope to `menu_items` (or a `menu_roles` map) and have `GET /api/menu` return
  rows for the caller's role. Route chain maps retailer routes → retailer screens (same `active.route`
  switch pattern).
- **Service-screen template:** left **form Card**, right **result/info Card**, then a **Receipt** on
  success. Reuse `UI.js` (`Card`, `Button`, `TextField`, `Select`, `DateField`, `Alert`) and
  `theme.js` (`shadows`). Reports reuse `AccountHistoryScreen`'s `Fld`/`Pager`/`reportStyles`.
- **Receipt component** (`Receipt.js`): centered table + `window.print()` on web.
- **Biometric** (`BiometricCapture.js`): web = mock capture button (returns a fake PID block in mock
  mode); native/live = RD-service intent hook. The UI is identical.

### 9.2 Screen catalogue (wireframe + reuse + route)

**Login** `/login` — reuse existing `LoginScreen`.
```
┌────────────────────────┬───────────────────────┐
│ AEPS banner + bullets  │  logo                  │
│ (Fund Transfer, Cash   │  Username [_________]  │
│  Withdrawal, Balance…) │  Password [_______][👁]│
│                        │  [captcha][↻] [_____]  │
│                        │  [   SUBMIT   ]        │
└────────────────────────┴───────────────────────┘
```

**Dashboard** `/` — reuse stat `Card`s + a small SVG chart (react-native-svg).
```
┌ Commission Earning ┐ ┌ Wallet History ┐ ┌ History ┐
│ ₹25.27  ╱╲         │ │ ₹0.00  ╲╱      │ │ ₹0.00   │
Service Statics            From[dd/mm/yy] To[dd/mm/yy]
 ▇  ▁  ▃  █  ▅  ▂  ▂   (bar per service)
```

**Services** `/services` — tabbed tile grid; `ServiceTile` = `Icon` + label; tiles route out.
```
[ B2B SERVICES ] [ Online Services ]
(₹)Mobile  (📡)DTH  (B)Bill Pay  (👆)AEPS  (⇄)Money Tx  (🏦)Move2Bank
(👛)FundReq (Pay)Aadhar (ATM)MicroATM (⏱)FundTx (Ⓕ)FASTag (▦)UPI
(♻)FinoCMS (LIC)LIC  (▤)NSDL PAN (⛽)Gas
Online → (✈)Flight (🏨)Hotel (🚌)Bus
```

**Mobile Recharge** `/services/mobile-recharge`
```
┌ Mobile Recharge ─────┐  ┌ Browse Plans ───────────────┐
│ Mobile No [________] │  │ [FULLTT][TOPUP][3G/4G][2G]… │
│ Operator  [Airtel ▾] │  │ Circle | Validity | ₹ | Desc │
│ Circle    [Delhi ▾]  │  │ Delhi  | N/A | ₹10 | Talktime │
│ Amount    [__] Plans↗│  │ …                            │
│ [   RECHARGE   ]     │  └──────────────────────────────┘
```

**DTH Recharge** `/services/dth-recharge` — same layout; right card = **DTH Info** (balance, name,
next recharge, status, plan).

**Bill Payment (BBPS)** `/services/bill-payment`
```
┌ Bill Payment ────────┐  ┌ Bill Details ───────────────┐
│ Category [Electricity]│  │ (after Check Bill)          │
│ Operator [search ▾]  │  │ Name / Amount / Due / BillNo │
│ Mode     [Select ▾]  │  │ [ PAY BILL ]                 │
│ [ CHECK BILL ]       │  └──────────────────────────────┘
```
**LIC / Gas / FASTag** `/services/lic|gas|fastag` — same form+details+pay shape.

**AEPS / Aadhar Pay / Micro ATM** `/services/aeps|aadhar-pay|micro-atm`
```
AADHAAR ENABLED PAYMENT SYSTEM
Txn Type[▾] Device[▾] Mobile[____]      ┌ Biometrics ┐
Aadhaar[____] Bank[▾] Amount[____]      │  🔒 capture │
☑ customer T&C   ☑ retailer T&C         └────────────┘
[ CAPTURE FINGERPRINT ]  → Receipt (RRN, Ack, status, balance)
```

**Money Transfer (DMT)** `/services/money-transfer`
```
[ Search sender mobile ______ ] [SEARCH]  → sender KYC banner
┌ Sender: Name | Available 25,000 | Used 0 ┐   [ADD BENEFICIARY]
Beneficiary Info                        Search[___]
# | Name | Bank | Account | IFSC | Action[Verify][Transfer][🗑]
1 | XYZ  | HDFC | 1234    | HDFC…| [₹Verify][₹Transfer][🗑]
(Transfer → modal: amount, mode IMPS/NEFT, txn PIN)
```

**Move To Bank / UPI Collection / Fino CMS / NSDL PAN** `/services/*` — form + result + receipt.

**Fund Request** `/services/fund-request` — amount, company bank, mode, reference, screenshot →
submitted (admin approves in existing flow). **Fund Transfer** `/services/fund-transfer` — reuse the
admin fund-transfer form (to downstream user, amount, txn PIN).

**Bookings — Flight/Hotel/Bus** `/services/flight|hotel|bus`
```
Search: [From][To][Date][Pax]  [SEARCH]
Results:  ✈ 06:00→08:10  ₹4,120  [SELECT]
Details:  passenger/guest form → [ PAY ] → e-ticket/voucher (Print)
```

**Receipt / Invoice** (component, opened after any success)
```
        ── Customer Copy ──
Shop / BC Code / Date / Ref / RRN / Amount / Status
[ Print ]
```

**Reports** `/account-history · /service-report · /gst-report · /tds-report · /commission-report ·
/my-commission-slab` — filter bar (`Fld` + `DateField` + `Select`) + grid (`reportStyles`, `Pager`),
owner-scoped. My Commission Slab is read-only (like admin Commission Slab).

**Profile** `/profile` — details + **Authorized Banking Point certificate** (printable, own copy).
**KYC** `/kyc` — e-KYC status + steps. **Account Settings** `/account-settings` — tabs **Account
Password / Transaction Password** (reuse change-password + txn-PIN endpoints).

---

## 10. Security Design

- **AuthZ:** `requireRole('retailer')` on all retailer routes; **owner scoping** — repositories filter
  by `req.user.id`; never trust an id from the body for reads.
- **Transaction credential:** AEPS, DMT, Move-to-Bank, Fund Transfer require the **transaction PIN**
  (`txnAuth.service.verify`, falls back to login password).
- **Token revocation:** access token carries `token_epoch`; logout/password-change bump it (built).
- **Idempotency:** all money POSTs (built middleware) — no double charge on retry.
- **PII masking:** store masked Aadhaar/PAN (`XXXX-XXXX-1234`) as done in `verify.controller.js`;
  never log full biometrics/PID.
- **Provider creds:** `provider_credentials.config_enc` encrypted at rest (AES-GCM, key from env);
  decrypt only at call time in live mode.
- **Audit catalogue:** `service_txn`, `dmt_transfer`, `aeps_txn`, `booking`, `fund_request`,
  `fund_transfer`, `password_changed`, `txn_pin_set`, `login/logout` (extend `audit.repo`).
- **Rate limiting:** apply the existing `authLimiter` pattern to sensitive endpoints (OTP, verify).

---

## 11. Non-Functional

- **Performance:** indexes on `(user_id, created_at)` and `(service, status)`; JOIN-only count in
  pagination (reuse `reports.repo` helper); paginate all grids.
- **Reliability:** refund-on-failure + idempotency make retries safe; provider timeouts bounded.
- **Observability:** `audit_log` for actions; `/api/health` reports `mode` + all adapters + version.
- **Cross-platform:** one Expo codebase; biometric RD-service only on device/live; web uses mock capture.
- **i18n / copy:** keep helpline + banner copy in `settings`; author own copy (no third-party brand).
- **Accessibility:** labels on inputs, focus ring (already in `UI.js`), sufficient contrast.

---

## 12. Config & Environment

- `APP_MODE` (default `mock`) — adapter selection (already in `env.js`).
- Provider keys — only in `provider_credentials` (live mode); never required for mock.
- `settings` keys — `retailer_panel_url`, helpline text, banner copy, per-service charges.
- `/api/health` — extend `adapters` to list retailer providers.

---

## 13. Testing Strategy (`node --test`, extend `api/test/`)

| Area | Test |
|---|---|
| Pipeline | debit+success credits commission; provider failure **refunds** wallet to `before` |
| Idempotency | same `Idempotency-Key` on `/recharge/mobile` charges once |
| Ownership | retailer A cannot read retailer B's `/account-history` (403/empty) |
| RBAC | admin token blocked from retailer-only route and vice-versa where scoped |
| Adapters | mock adapters deterministic (success + seeded decline) |
| Commission | `recordServiceCommission` math per slab (already covered in `commission.test.js`) |
| DMT | verify + transfer requires txn PIN; limit tracking decrements available |

Run: `cd api && npm test` (helper boots app + mints tokens). Lint: `npm run lint`.

---

## 14. Migration & Rollout (phase → work)

| Phase (spec §9) | Migration/seed | Modules | Menu rows |
|---|---|---|---|
| 0 Foundation | menu role scope | `RetailerShell`, role branch in `App.js`, `requireRole` | retailer set |
| 1 Dashboard | — | `retailer.controller` summary/stats | Dashboard |
| 2 Services fwk | `operators` (+seed) | `ServicesScreen`, `txnPipeline.service`, adapter skeletons | Services |
| 3 Recharge/BBPS | extend `service_transactions` | recharge/bbps/lic/gas/fastag | tiles |
| 4 AEPS | — | `aeps.service`, `BiometricCapture`, `Receipt` | tiles |
| 5 DMT | `dmt_senders`,`dmt_beneficiaries` | dmt.* | tile |
| 6 Bookings | `bookings` | booking.* | Online tiles |
| 7 Reports | — | owner-scoped report screens | report rows |
| 8 Profile/KYC/Acct | — | profile, kyc, account settings, certificate | rows |
| 9 Commission/hardening | `provider_credentials` | pipeline wiring, live stubs, final RBAC/audit | — |

Backward compatible: admin panel untouched; new menu rows are additive; features gate by presence of
their `menu_items` row (turn a service off by deactivating its row).

---

## 15. Traceability Matrix (spec 02 → this TDD)

| Spec 02 | Covered by |
|---|---|
| §4 sidebar/IA | §9.1 shell + §9.2 catalogue |
| §5 Mobile/DTH/BBPS/LIC/Gas/FASTag | §6 adapters, §7.2, §8, §9.2 |
| §5 AEPS/Aadhar Pay/Micro ATM | §6, §7.1, §9.2, §10 (PIN/PII) |
| §5 DMT/Move2Bank/UPI/CMS | §5 tables, §7.3, §8, §9.2 |
| §5 Bookings | §5 `bookings`, §7.4, §9.2 |
| §5 Fund Request/Transfer | §8, §9.2 (reuse existing) |
| §6 data model | §5 |
| §7 provider abstraction | §6, §7 |
| §8 API surface | §8 |
| §9 phases | §4, §14 |
| §10 non-functional | §11, §12, §13 |

---

## 16. Risks & Open Questions

- **Biometric on web:** real AEPS needs an RD-service (native/desktop bridge); web stays mock. Confirm
  target platforms per phase.
- **DMT/AEPS compliance:** live mode requires a sponsor bank/BC agreement + NPCI limits; design keeps
  these behind adapters, but go-live is a business/legal step.
- **Menu role model:** decide `menu_items.roles` column vs a `menu_roles` join (Phase 0) — both work;
  a column is simpler.
- **Managed-user login:** confirm retailers can authenticate (they have `user_code` + password); if
  not, add credential set in Users Manager (Phase 0).

---

## 17. Appendix

**Error codes:** `INSUFFICIENT_BALANCE`, `PROVIDER_DECLINED`, `PROVIDER_TIMEOUT`,
`PROVIDER_NOT_CONFIGURED`, `INVALID_INPUT`, `IDEMPOTENT_IN_PROGRESS`, `BAD_TXN_PASSWORD`, `FORBIDDEN`,
`TOKEN_REVOKED`.

**Glossary:** AEPS, DMT, BBPS, CMS, RD service, RRN, BC, PID (biometric packet).

**Diagram notation:** triple-backtick fenced blocks are ASCII wireframes/sequences; `mermaid` blocks
are flow/ER diagrams (render in any Mermaid-aware viewer).

**IP:** independent, original implementation; reference videos are functional reference only; author
all user-facing copy; no third-party branding. See `NOTICE.md`.

*End of document.*
