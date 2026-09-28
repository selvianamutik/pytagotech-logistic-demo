# Audit Registry Baseline - 2026-06-07

Status: Baseline Task 1
Repo: `C:\LOGISTIK\app`
Branch: `main`
Server audit HTTP: `http://127.0.0.1:3000`

## Summary

Baseline ini menjalankan audit utama untuk role, DO/SJ/trip, invoice, finance, accounting, supplier price, gudang, maintenance, incident, mobile driver API, master import, reseed, dan Supabase migration.

Hasil ringkas:

- PASS: 40 checks/audit commands.
- SKIP: 0.
- FAIL produk: 0.
- FAIL environment: 0.
- Cleanup user audit: PASS, tidak ada user audit sementara yang tersisa aktif.
- Coverage gap `audit:driver-shipper-reference-flow` sudah ditutup dengan fixture mandiri.
- Default audit HTTP mobile/role sudah dinormalisasi ke `http://127.0.0.1:3000`; `AUDIT_BASE_URL` tetap tersedia untuk override.
- Fast role smoke suite sudah tersedia untuk daily regression.
- Dashboard work queue audit sudah tersedia untuk cek angka, role guard, link kerja, dan masking finansial.

## Environment Notes

- `npm run typecheck` lulus.
- `npm run lint` lulus.
- `lint` memberi warning Babel: `src/app/(admin)/_components/TripDetailPage.tsx` lebih dari 500KB sehingga code generator deoptimised. Ini bukan bug runtime, tetapi masuk risiko maintainability/performance.
- Audit HTTP memakai default `http://127.0.0.1:3000`. Jika server audit berjalan di port lain, override dengan:

```powershell
$env:AUDIT_BASE_URL='http://127.0.0.1:3000'
```

## Baseline Results

| Area | Command | Status | Evidence |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` | PASS | Route types generated, typecheck selesai tanpa error. |
| Lint | `npm run lint` | PASS | ESLint selesai tanpa error; ada warning file TripDetailPage besar. |
| Role/API guard | `npm run audit:admin-data-route-flow` | PASS | 8 delivery-order actions, freight-nota, manual journal, menu guards, detail UI guards, import/reminder/driver API guards, Supabase RLS coverage OK. |
| Setting dokumen | `npm run audit:settings-document-format` | PASS | Document format audit OK. |
| Password | `npm run audit:password-hashes` | PASS | 8 user rows memakai bcrypt hashes. |
| Accounting | `npm run audit:accounting-integrity` | PASS | 66 posted entries, debit dan credit sama, balance sheet gap 0. |
| Finance | `npm run audit:finance-integrity` | PASS | Bank, nota, payments, receipts, purchases, stock movements, vouchers, posted journals konsisten. |
| Bank/invoice/journal link | `npm run audit:bank-invoice-journal-links` | PASS | Payment, receipt, purchase, expense links terbaca. |
| Accounting privacy/period | `npm run audit:accounting-privacy-period-flow` | PASS | Owner-only journal masked for finance, closed period blocks manual journal, reopen allows date. |
| Supplier price history | `npm run audit:supplier-price-revision-stress` | PASS | Harga supplier 10000 -> 20000 -> 30000 -> 40000 plus backdated purchase valid; overwrite/delete historical used price blocked. |
| Order item auto weight | `npm run audit:order-item-auto-weight` | PASS | Auto weight audit OK. |
| DO billing eligibility | `npm run audit:delivery-order-billing-eligibility` | PASS | Delivered non-billable DO tidak menghasilkan row nota billable. |
| DO nota integrity | `npm run audit:delivery-order-nota-integrity` | PASS | 10 delivered rows dan 6 nota rows konsisten. |
| DO/SJ invariants | `npm run audit:delivery-order-sj-invariants` | PASS | 19 DO, 21 expected SJ, 21 dokumen SJ sinkron. |
| DO actual edit permission | `npm run audit:delivery-order-actual-edit-permissions` | PASS | Finance ditolak 403; invalid SJ ditahan. |
| Role access smoke | `npm run audit:role-access-smoke` | PASS | 34 detik; owner, operasional, finance, armada, driver admin-denied, page/API/detail/mutation smoke verified. |
| Role access E2E | `npm run audit:role-access-e2e` | PASS | Owner, operasional, finance, armada, driver admin-denied, detail view-only, SJ detail for Armada, and conditional mutations verified. |
| Dashboard work queue | `npm run audit:dashboard-work-queue` | PASS | Owner, operasional, finance, armada dashboard summary dibandingkan dengan hitung ulang sumber data; link KPI, role guard, on-hold order, dan masking nominal finansial verified. |
| Driver shipper reference | `npm run audit:driver-shipper-reference-flow` | PASS | Jika seed tidak punya kandidat, audit membuat driver/user/order/DO/SJ fixture sementara, login lewat mobile driver token, no-op save, tambah SJ, restore, dan cleanup. |
| Driver approval corrections | `npm run audit:driver-approval-corrections-flow` | PASS | Pending actual locks admin edit, reject/resubmit/approve, other SJ editable, odometer closure guard, incident draft cost correction OK. |
| Driver incident | `npm run audit:driver-incident-flow` | PASS | Create incident, duplicate active guard, resolution draft, admin approve, close guard, reopen after closed valid. |
| Incident before voucher | `npm run audit:incident-before-voucher-flow` | PASS | Deferred expense before voucher, company expense tire route, tire asset creation/install, voucher sync idempotent. |
| Incident maintenance static | `npm run audit:incident-maintenance-handling` | PASS | Generic sparepart excludes tire, duplicate refs rejected, leftover stock cumulative, stock mutation validation, usage movement checks OK. |
| Incident maintenance E2E | `npm run audit:incident-maintenance-handling:e2e` | PASS | Warehouse multi item, duplicate/tire/backdated reject, direct purchase leftover, over-allocation, double-link, service-only guard OK. |
| Mobile incident voucher | `npm run audit:mobile-incident-voucher-integrity` | PASS | Incident timestamp normalization and voucher disbursement order OK. |
| Mobile timezone | `npm run audit:mobile-timezone-consistency` | PASS | Backend business date, incident dates, and mobile display/default dates use Asia/Jakarta/WIB. |
| Driver trip closure | `npm run audit:driver-trip-closure-flow` | PASS | Mobile request, API guards, admin approval, odometer, and resource locks verified. |
| Mobile manifest | `npm run audit:mobile-driver-manifest-flow` | PASS | Endpoints, payloads, multi-SJ, completion, stable inputs verified. |
| Mobile batch status | `npm run audit:mobile-batch-status-selection` | PASS | Updating one SJ status does not alter another SJ status. |
| Mobile add SJ status | `npm run audit:mobile-add-sj-status-preservation` | PASS | Adding SJ preserves existing ARRIVED status and new SJ starts CREATED. |
| Conditional mobile/admin | `npm run audit:conditional-mobile-admin-flow` | PASS | Incident, voucher links, active vehicle lock, delivered-no-closure lock, and second assignment verified. |
| Freight nota revision | `npm run audit:freight-nota-revision-flow` | PASS | Create, revise to manual, relink DO row, replace active rows, void cleanup OK. |
| Order to nota E2E | `npm run audit:order-to-nota-e2e` | PASS | Multi-trip DO, multi-item SJ, ambiguous drop guard, hold/drop, split item, invoice lock, void, actual edit guard all verified. |
| Order status consistency | `npm run audit:order-status-consistency` | PASS | 18 orders verified with no header/item progress mismatch. |
| Hold continuation | `npm run audit:hold-continuation-origin` | PASS | Hold continuation origin passed. |
| Overtonase driver trip | `npm run audit:overtonase-driver-trip` | PASS | Route rate -> driver entitlement, customer invoice without overtonase charge. |
| Trip resource assignments | `npm run audit:trip-resource-locks` | PASS | Trip resource assignment audit passed (multi-DO drivers/vehicles allowed). |
| Master data import | `npm run audit:master-data-import` | PASS | Template/parser guards, supplier, warehouse item, trip route rate, customer, customer product create/update/validation passed. |
| Reseed coverage | `npm run audit:reseed-test-coverage` | PASS | 1147 docs, DO statuses, partial hold, incidents, tire tracking, vouchers, freight notas covered. |
| Supabase migration | `npm run audit:supabase` | PASS | Required files, workflow functions, data route aggregation, relational adapter, seed data, and sanity usage checks passed. |
| Audit user cleanup | `npm run cleanup:audit-users` | PASS | 8 matched audit users, 0 disabled, no active temporary audit users left. |

## Findings From Baseline

### Closed - `audit:driver-shipper-reference-flow` fixture gap

Status: closed in this baseline follow-up.

The audit no longer depends on production-like seed data. If no suitable existing DO/driver pair is found, it creates a temporary driver, login user, order, delivery order, and SJ reference fixture. The driver logs in through the mobile driver login endpoint, calls the real `/api/driver/delivery-orders/cargo` endpoint, verifies no-op save, appends a new SJ reference, restores the original SJ list, and cleans up the temporary fixture.

Verification:

- `npm run audit:driver-shipper-reference-flow` PASS.
- `npm run typecheck` PASS.
- `npm run audit:mobile-driver-manifest-flow` PASS.
- `npm run audit:delivery-order-sj-invariants` PASS.

### Closed - HTTP audit scripts default to port 3000

Status: closed in this baseline follow-up.

HTTP audits that previously defaulted to `http://127.0.0.1:3217` now default to `http://127.0.0.1:3000`, matching the normal local Next dev server. `AUDIT_BASE_URL` override support remains available for non-standard ports.

Verification:

- `npm run audit:mobile-batch-status-selection` PASS without env override.
- `npm run audit:mobile-add-sj-status-preservation` PASS without env override.
- `npm run audit:conditional-mobile-admin-flow` PASS without env override.
- `npm run audit:role-access-e2e` PASS without env override.

### P2 - `TripDetailPage.tsx` is too large

Status: maintainability/performance risk.

ESLint completed successfully, but Babel warned that `TripDetailPage.tsx` exceeds 500KB and code generation is deoptimised.

Recommended fix:

- Split Trip detail into smaller presentational components/hooks in a later UI/performance task.
- Avoid changing behavior during the split.

Acceptance:

- No Babel deoptimisation warning for this file.
- Trip detail UI and audit scripts still pass.

### Closed - Fast role smoke suite

Status: closed in this baseline follow-up.

Role access E2E tetap tersedia untuk deep/pre-release audit, tetapi daily regression sekarang punya smoke suite cepat.

Verification:

- `npm run audit:role-access-smoke` PASS dalam 34 detik.
- Smoke mencakup page access, API read 403/200, detail view-only SJ untuk Armada, invoice detail blocked untuk Armada, dan mutation boundary wakil operasional/finance/armada.
- `npm run audit:role-access-e2e` tetap PASS setelah smoke ditambahkan.

### Closed - Dashboard work queue audit

Status: closed in this baseline follow-up.

Dashboard summary sekarang punya audit role-aware. Script menghitung ulang order, DO, invoice, uang jalan, borongan, fleet, recent order, dan recent invoice dari sumber data lalu membandingkannya dengan API `/api/data?entity=dashboard-summary` untuk OWNER, OPERASIONAL, FINANCE, dan ARMADA.

Perbaikan tambahan:

- Statistik DO di backend dashboard sekarang ikut guard `deliveryOrders:view`.
- Order `ON_HOLD` dihitung sebagai `onHold`, bukan dicampur ke `partial`.
- Static audit memastikan card/reminder dashboard punya link kerja dan nominal finansial tetap dimasking untuk role non-owner/non-finance.

Verification:

- `npm run audit:dashboard-work-queue` PASS.

## Next Move After Baseline

Recommended next order:

1. Continue PRD Task 8: responsive UI sweep for key detail pages.
2. Continue PRD Task 11: performance and bandwidth cleanup for heavy pages.
3. Continue PRD Task 9: print/export global.
4. Continue PRD Task 4/5 deep UAT if DO/invoice behavior changes again.

## Commands That Need Server Running

These should be run while Next dev/prod server is reachable:

- `npm run audit:delivery-order-billing-eligibility`
- `npm run audit:delivery-order-nota-integrity`
- `npm run audit:delivery-order-sj-invariants`
- `npm run audit:mobile-batch-status-selection`
- `npm run audit:mobile-add-sj-status-preservation`
- `npm run audit:conditional-mobile-admin-flow`
- `npm run audit:role-access-e2e`
- `npm run audit:dashboard-work-queue`

Recommended local invocation for port 3000:

```powershell
$env:AUDIT_BASE_URL='http://127.0.0.1:3000'
npm run audit:role-access-e2e
```
