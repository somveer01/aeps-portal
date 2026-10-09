# Database ER diagram

Generated from the live schema (PostgreSQL, 40 tables, 60 foreign keys). Crow's foot: `||` exactly one, `|o` zero or one, `o{` zero or many. `PK` primary key, `FK` foreign key (the label on a line is the FK column). Only keys and the most important columns are drawn; a `_plus_N_more_columns` row says how many were left out.

Open in GitHub (renders automatically), VS Code with a Mermaid preview extension, or double-click `er-diagram.html` for a standalone page.

## How the pieces connect (one line each)

- `users.parent_id` -> `users.id`: the chain Admin -> Super Distributor -> Distributor -> Retailer (commission follows it). `users.user_type_id` -> `user_types`; `user_types.parent_type_id` -> `user_types` is the tree that decides who may create whom.
- `service_transactions` (a recharge / payout) -> `commission_ledger` (one row per person paid, `level` 0 = the user, 1+ = uplines, `source_user_id` = who transacted) and -> `admin_margins` (what the company keeps).
- `commission_slots` = admin rates per user type + service + plan; `commission_packages` / `commission_package_items` = what an upline re-shares with its direct users.
- `account_transactions` = the wallet statement; `users.wallet_balance` is the running balance.

## 1. Users and hierarchy

Who exists, how they are arranged (parent chain) and what each type may use.

Tables: `users` (~4 rows locally), `user_types` (~5 rows locally), `plans` (~4 rows locally), `user_type_services` (~22 rows locally), `user_service_overrides` (~18 rows locally), `commission_packages` (~0 rows locally)

```mermaid
erDiagram
  users {
    int id PK
    int user_type_id FK
    int plan_id FK
    int parent_id FK
    int state_id FK
    int city_id FK
    int assigned_employee_id FK
    int created_by FK
    int commission_package_id FK
    string username
    string password_hash
    string full_name
    string mobile
    string _plus_27_more_columns
  }
  user_types {
    int id PK
    int parent_type_id FK
    string name
    bool is_active
    string _plus_2_more_columns
  }
  plans {
    int id PK
    int user_type_id FK
    string name
    bool is_active
    string _plus_2_more_columns
  }
  user_type_services {
    int user_type_id PK,FK
    int service_id PK,FK
    int updated_by FK
    string _plus_1_more_columns
  }
  user_service_overrides {
    int user_id PK,FK
    int service_id PK,FK
    int updated_by FK
    bool allowed
    string _plus_1_more_columns
  }
  commission_packages {
    int id PK
    int owner_user_id FK
    int user_type_id FK
    string name
    bool is_active
    string _plus_2_more_columns
  }
  user_types |o--o{ plans : "user_type_id"
  user_types |o--o{ users : "user_type_id"
  plans |o--o{ users : "plan_id"
  users |o--o{ users : "parent_id"
  users |o--o{ users : "assigned_employee_id"
  users |o--o{ users : "created_by"
  user_types |o--o{ user_types : "parent_type_id"
  user_types |o--o{ user_type_services : "user_type_id"
  users |o--o{ user_type_services : "updated_by"
  users |o--o{ user_service_overrides : "user_id"
  users |o--o{ user_service_overrides : "updated_by"
  users |o--o{ commission_packages : "owner_user_id"
  user_types |o--o{ commission_packages : "user_type_id"
  commission_packages |o--o{ users : "commission_package_id"
```

## 2. Services, menu and master data

What can be sold, the sidebar menu, operators and lookups.

Tables: `service_categories` (~0 rows locally), `services` (~22 rows locally), `operators` (~0 rows locally), `menu_items` (~65 rows locally), `settings` (~0 rows locally), `banks` (~0 rows locally), `states` (~0 rows locally), `cities` (~250 rows locally), `user_types` (~5 rows locally)

```mermaid
erDiagram
  service_categories {
    int id PK
    string name
    bool is_active
    string _plus_2_more_columns
  }
  services {
    int id PK
    int service_category_id FK
    string title
    string service_type
    bool is_active
    string icon
    string provider_commission_type
    decimal provider_commission_value
    decimal daily_limit
    string _plus_2_more_columns
  }
  operators {
    int id PK
    string service
    string category
    string name
    string code
    bool circle_required
    bool is_active
    string _plus_1_more_columns
  }
  menu_items {
    int id PK
    int parent_id FK
    string title
    string icon
    string route
    int sort_order
    bool is_active
    string scope
    string _plus_1_more_columns
  }
  settings {
    string key PK
    text value
    string _plus_1_more_columns
  }
  banks {
    int id PK
    string name
    bool is_active
    string _plus_1_more_columns
  }
  states {
    int id PK
    string name
    bool is_active
    string _plus_1_more_columns
  }
  cities {
    int id PK
    int state_id FK
    string name
    bool is_active
    string _plus_1_more_columns
  }
  user_types {
    int id PK
    int parent_type_id FK
    string name
    bool is_active
    string _plus_2_more_columns
  }
  menu_items |o--o{ menu_items : "parent_id"
  states |o--o{ cities : "state_id"
  service_categories |o--o{ services : "service_category_id"
  user_types |o--o{ user_types : "parent_type_id"
```

## 3. Commission and margin

Slabs, packages, every commission payout (ledger) and what the company keeps.

Tables: `commission_slots` (~7 rows locally), `commission_packages` (~0 rows locally), `commission_package_items` (~0 rows locally), `commission_ledger` (~3 rows locally), `admin_margins` (~0 rows locally), `service_transactions` (~5 rows locally)

```mermaid
erDiagram
  commission_slots {
    int id PK
    int user_type_id FK
    int service_id FK
    int plan_id FK
    string operator
    string commission_type
    decimal min_amount
    decimal max_amount
    decimal value
    string chain_type
    bool is_active
    string specific_user
    string _plus_3_more_columns
  }
  commission_packages {
    int id PK
    int owner_user_id FK
    int user_type_id FK
    string name
    bool is_active
    string _plus_2_more_columns
  }
  commission_package_items {
    int id PK
    int package_id FK
    int service_id FK
    string operator
    string commission_type
    decimal value
  }
  commission_ledger {
    int id PK
    int user_id FK
    int source_user_id FK
    int service_transaction_id FK
    string service_name
    string slot_type
    decimal type_value
    decimal type_value_amount
    decimal gst_percent
    decimal gst_amount
    decimal tds_percent
    decimal tds_amount
    string _plus_8_more_columns
  }
  admin_margins {
    int id PK
    int service_transaction_id FK
    int user_id FK
    string service_name
    decimal amount
    decimal provider_commission
    decimal charges_collected
    decimal commission_paid
    decimal margin
    string _plus_1_more_columns
  }
  service_transactions {
    int id PK
    int user_id FK
    string service
    string operator
    string target
    decimal amount
    string reference_id
    string status
    text response
    string client_ref
    decimal debit_amount
    decimal service_charge
    string _plus_7_more_columns
  }
  services {
    int id PK
    string title
  }
  plans {
    int id PK
    string name
  }
  user_types {
    int id PK
    string name
  }
  users {
    int id PK
    string full_name
    string user_code
  }
  user_types |o--o{ plans : "user_type_id"
  user_types |o--o{ commission_slots : "user_type_id"
  services |o--o{ commission_slots : "service_id"
  plans |o--o{ commission_slots : "plan_id"
  user_types |o--o{ users : "user_type_id"
  plans |o--o{ users : "plan_id"
  users |o--o{ users : "parent_id"
  users |o--o{ users : "assigned_employee_id"
  users |o--o{ service_transactions : "user_id"
  users |o--o{ commission_ledger : "user_id"
  users |o--o{ users : "created_by"
  users |o--o{ commission_ledger : "source_user_id"
  service_transactions |o--o{ commission_ledger : "service_transaction_id"
  service_transactions |o--o{ admin_margins : "service_transaction_id"
  users |o--o{ admin_margins : "user_id"
  user_types |o--o{ user_types : "parent_type_id"
  users |o--o{ commission_packages : "owner_user_id"
  user_types |o--o{ commission_packages : "user_type_id"
  commission_packages |o--o{ commission_package_items : "package_id"
  services |o--o{ commission_package_items : "service_id"
  commission_packages |o--o{ users : "commission_package_id"
```

## 4. Money: wallet, transactions, funds

Wallet history, service transactions, fund requests/transfers, banks and bookings.

Tables: `service_transactions` (~5 rows locally), `account_transactions` (~165 rows locally), `fund_requests` (~2 rows locally), `fund_transfers` (~70 rows locally), `company_banks` (~0 rows locally), `payout_banks` (~0 rows locally), `admin_wallet_transactions` (~0 rows locally), `idempotency_keys` (~2 rows locally), `bookings` (~0 rows locally), `dmt_senders` (~0 rows locally), `dmt_beneficiaries` (~0 rows locally)

```mermaid
erDiagram
  service_transactions {
    int id PK
    int user_id FK
    string service
    string operator
    string target
    decimal amount
    string reference_id
    string status
    text response
    string client_ref
    decimal debit_amount
    decimal service_charge
    string _plus_7_more_columns
  }
  account_transactions {
    int id PK
    int user_id FK
    string service_name
    string type
    text remark
    decimal amount
    decimal before_balance
    decimal updated_balance
    string _plus_1_more_columns
  }
  fund_requests {
    int id PK
    int user_id FK
    int company_bank_id FK
    int approver_id FK
    int acted_by FK
    date deposit_date
    string payment_mode
    decimal amount
    string request_id
    string receipt_no
    string receipt_img
    string status
    string _plus_5_more_columns
  }
  fund_transfers {
    int id PK
    int from_user_id FK
    int to_user_id FK
    decimal amount
    string transfer_type
    text remark
    decimal before_balance
    decimal updated_balance
    string status
    string _plus_1_more_columns
  }
  company_banks {
    int id PK
    int bank_id FK
    string bank_name
    string account_holder
    string account_no
    string ifsc_code
    bool is_active
    string _plus_2_more_columns
  }
  payout_banks {
    int id PK
    int user_id FK
    string bank_name
    string account_no
    string ifsc_code
    string ac_holder
    string passbook
    string status
    text remark
    string _plus_2_more_columns
  }
  admin_wallet_transactions {
    int id PK
    int admin_id FK
    decimal amount
    string txn_type
    text remark
    decimal before_balance
    decimal updated_balance
    string _plus_1_more_columns
  }
  idempotency_keys {
    int id PK
    int user_id FK
    string idem_key
    string endpoint
    int response_status
    text response_body
    string _plus_1_more_columns
  }
  bookings {
    int id PK
    int retailer_id FK
    string type
    string pnr
    json pax
    decimal amount
    string status
    string provider_ref
    json detail
    string _plus_1_more_columns
  }
  dmt_senders {
    int id PK
    int retailer_id FK
    string mobile
    string name
    string kyc_status
    decimal monthly_limit
    decimal used_limit
    string _plus_1_more_columns
  }
  dmt_beneficiaries {
    int id PK
    int sender_id FK
    string name
    string bank_name
    string account_no
    string ifsc
    bool verified
    string _plus_1_more_columns
  }
  users {
    int id PK
    string full_name
    string user_code
  }
  users |o--o{ users : "parent_id"
  users |o--o{ users : "assigned_employee_id"
  users |o--o{ account_transactions : "user_id"
  users |o--o{ service_transactions : "user_id"
  users |o--o{ fund_requests : "user_id"
  company_banks |o--o{ fund_requests : "company_bank_id"
  users |o--o{ payout_banks : "user_id"
  users |o--o{ fund_transfers : "from_user_id"
  users |o--o{ fund_transfers : "to_user_id"
  users |o--o{ admin_wallet_transactions : "admin_id"
  users |o--o{ idempotency_keys : "user_id"
  users |o--o{ dmt_senders : "retailer_id"
  dmt_senders |o--o{ dmt_beneficiaries : "sender_id"
  users |o--o{ bookings : "retailer_id"
  users |o--o{ users : "created_by"
  users |o--o{ fund_requests : "approver_id"
  users |o--o{ fund_requests : "acted_by"
```

## 5. KYC, support, audit and reconciliation

Verification, tickets, security trail, OTPs and daily reconciliation.

Tables: `kyc_submissions` (~0 rows locally), `kyc_verifications` (~0 rows locally), `tickets` (~0 rows locally), `ticket_replies` (~0 rows locally), `ticket_departments` (~0 rows locally), `audit_log` (~532 rows locally), `otp_requests` (~0 rows locally), `announcements` (~0 rows locally), `application_banners` (~0 rows locally), `reconciliation_runs` (~4 rows locally), `reconciliation_items` (~0 rows locally)

```mermaid
erDiagram
  kyc_submissions {
    int id PK
    int user_id FK
    int reviewed_by FK
    string status
    string aadhaar_last4
    string pan_number
    string bank_name
    string account_holder
    string account_no
    string ifsc_code
    string aadhaar_front
    string aadhaar_back
    string _plus_8_more_columns
  }
  kyc_verifications {
    int id PK
    int admin_id FK
    string kind
    string doc_number
    string name
    string status
    string ref_id
    text remark
    string _plus_1_more_columns
  }
  tickets {
    int id PK
    int user_id FK
    int department_id FK
    string ticket_no
    string subject
    text description
    string priority
    string status
    string _plus_2_more_columns
  }
  ticket_replies {
    int id PK
    int ticket_id FK
    int sender_id FK
    string sender_role
    text message
    string _plus_1_more_columns
  }
  ticket_departments {
    int id PK
    string name
    bool is_active
    string _plus_2_more_columns
  }
  audit_log {
    bigint id PK
    int user_id FK
    string username
    string event
    string ip
    string user_agent
    json detail
    string _plus_1_more_columns
  }
  otp_requests {
    int id PK
    int user_id FK
    string otp_hash
    string purpose
    timestamp expires_at
    int verify_attempts
    timestamp consumed_at
    string _plus_1_more_columns
  }
  announcements {
    int id PK
    int user_type_id FK
    string title
    text message
    bool is_active
    string _plus_2_more_columns
  }
  application_banners {
    int id PK
    string title
    string image
    string link
    int sort_order
    bool is_active
    string type
    date banner_date
    string _plus_2_more_columns
  }
  reconciliation_runs {
    int id PK
    int run_by FK
    date run_date
    string status
    int total
    int matched
    int mismatched
    int auto_fixed
    text error
    timestamp started_at
    timestamp finished_at
  }
  reconciliation_items {
    int id PK
    int run_id FK
    int service_transaction_id FK
    int resolved_by FK
    string client_ref
    string type
    string our_status
    string provider_status
    decimal our_amount
    decimal provider_amount
    string state
    text note
    string _plus_2_more_columns
  }
  users {
    int id PK
    string full_name
    string user_code
  }
  users |o--o{ otp_requests : "user_id"
  users |o--o{ audit_log : "user_id"
  users |o--o{ users : "parent_id"
  users |o--o{ users : "assigned_employee_id"
  users |o--o{ kyc_verifications : "admin_id"
  users |o--o{ tickets : "user_id"
  ticket_departments |o--o{ tickets : "department_id"
  tickets |o--o{ ticket_replies : "ticket_id"
  users |o--o{ ticket_replies : "sender_id"
  users |o--o{ users : "created_by"
  users |o--o{ kyc_submissions : "user_id"
  users |o--o{ kyc_submissions : "reviewed_by"
  users |o--o{ reconciliation_runs : "run_by"
  reconciliation_runs |o--o{ reconciliation_items : "run_id"
  users |o--o{ reconciliation_items : "resolved_by"
```

