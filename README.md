# PT Logistik Demo - Admin Panel

Sistem manajemen logistik berbasis web untuk operasional pengiriman, penagihan, kas/bank, armada, dan tracking driver.

Stack utama:
- Next.js 16
- Supabase PostgreSQL
- Vercel
- Flutter untuk app driver mobile

## Modul utama

- `/dashboard` untuk ringkasan owner/admin
- `/orders` untuk order/resi
- `/delivery-orders` untuk surat jalan dan tracking per DO
- `/invoices` untuk nota ongkos angkut
- `/borongan` untuk arsip slip borongan supir
- `/driver-vouchers` untuk uang jalan trip dan settlement per DO
- `/expenses` untuk pengeluaran umum
- `/bank-accounts` untuk rekening bank dan kas tunai
- `/reports` untuk laba rugi dan arus kas
- `/fleet/*` untuk supir, kendaraan, maintenance, ban, dan insiden
- `/settings/*` untuk profil, perusahaan, user, dan audit log

## Workflow inti

1. Order dibuat dari customer/pengirim.
2. Dari order, admin membuat Delivery Order.
3. Driver menjalankan tracking dan hanya boleh mengirim progres perjalanan.
4. Admin menyelesaikan DO dan mengisi POD pada langkah yang sama.
5. DO yang selesai bisa ditagihkan ke customer lewat Nota Ongkos.
6. Nota sekarang mendukung klaim / potongan dan satu penerimaan customer bisa dialokasikan ke beberapa nota sekaligus.
7. Pembayaran nota atau penerimaan customer otomatis mem-posting income dan mutasi rekening/kas.
8. DO yang selesai bisa dipakai untuk slip borongan bila perusahaan memang memakai workflow itu.
9. Workflow utama trip driver memakai Uang Jalan Trip yang tertaut ke 1 DO untuk uang jalan awal, top up, biaya perjalanan aktual, upah trip, dan settlement akhir.

Dokumen alur lengkap ada di:
- [WORKFLOW.md](./WORKFLOW.md)
- [docs/HANDOFF.md](./docs/HANDOFF.md) — indeks handoff: peta halaman → API, redundansi, sumber kebenaran
- [docs/HANDOFF-API.md](./docs/HANDOFF-API.md) — indeks `/api/data`: entity, action, workflow handlers
- [docs/SYSTEM_MODULES_AND_WORKFLOWS.md](./docs/SYSTEM_MODULES_AND_WORKFLOWS.md)
- [docs/UAT_ALL_MODULES_COMPREHENSIVE.md](./docs/UAT_ALL_MODULES_COMPREHENSIVE.md)
- [AUDIT.md](./AUDIT.md)
- [security_best_practices_report.md](./security_best_practices_report.md)

Workbook UAT lengkap:
- [artifacts/uat/UAT_ALL_MODULES_COMPREHENSIVE.xlsx](./artifacts/uat/UAT_ALL_MODULES_COMPREHENSIVE.xlsx)

## Demo seed

Script seed aktif:
- `npm run seed:supabase`
- `npm run reseed:supabase`

Dataset demo saat ini mencakup kondisi:
- customer, layanan, kategori biaya aktif dan nonaktif
- master barang per customer
- order `OPEN`, `PARTIAL`, `COMPLETE`, `CANCELLED`
- DO `CREATED`, `ON_DELIVERY`, `ARRIVED`, `PARTIAL_HOLD`, `DELIVERED`, `CANCELLED`
- nota `UNPAID`, `PARTIAL`, `PAID`
- penerimaan customer untuk bayar beberapa nota sekaligus
- klaim / potongan nota
- borongan `UNPAID`, `PAID`
- uang jalan trip `ISSUED`, `SETTLED`, termasuk skenario sisa uang kembali dan tambahan bayar ke supir
- maintenance, insiden, tracking log, mutasi rekening, kas tunai, dan laporan

Profil perusahaan demo:
- Nama: `PT Logistik Demo`
- Alamat: `JL. LOGISTIK DEMO INDONESIA`
- Telepon: `08123456789`
- Email: `logistikdemo@email.com`

Akun demo:
- owner web: `owner@company.local / owner12345`
- admin web: `admin@company.local / admin12345`
- driver mobile:
  - `driver.agus@company.local / driver12345`
  - `driver.budi@company.local / driver12345`
  - `driver.catur@company.local / driver12345`

## Status DO yang aktif

Flow status DO yang benar saat demo:
- `CREATED`
- `ON_DELIVERY`
- `ARRIVED`
- `DELIVERED`
- `CANCELLED`

Catatan penting:
- driver tidak boleh set `DELIVERED` atau `CANCELLED`
- `DELIVERED` hanya di-set admin
- POD diisi saat admin menyelesaikan DO

## Driver mobile

App driver resmi ada di:
- [apps/driver_app/README.md](./apps/driver_app/README.md) — build & signing Android
- [docs/HANDOFF-MOBILE.md](./docs/HANDOFF-MOBILE.md) — layar Flutter, API `/api/driver/*`

Flow mobile:
- login driver
- lihat DO milik sendiri
- mulai / pulihkan tracking
- kirim progres perjalanan
- heartbeat lokasi ke dashboard admin

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run audit:finance
```

Seed ulang demo:

```bash
npm run reseed:supabase
```

## Build note

Jalur build produksi yang stabil di repo ini:
- `npm run build`

`build:turbopack` hanya untuk eksperimen lokal.

## Environment variables

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
JWT_SECRET=...

# Optional: WhatsApp notification to one Admin Operasional number
WHATSAPP_PROVIDER=green_api
GREEN_API_URL=https://api.green-api.com
GREEN_API_INSTANCE_ID=...
GREEN_API_TOKEN=...
OPERATIONAL_ADMIN_WHATSAPP_PHONE=628xxxxxxxxxx
OPERATIONAL_ADMIN_WHATSAPP_ENABLED=true

# Optional scheduled reminders
WHATSAPP_REMINDER_SECRET=...
OPERATIONAL_ADMIN_REMINDER_LOOKAHEAD_DAYS=3
OPERATIONAL_ADMIN_MAINTENANCE_ODOMETER_LOOKAHEAD_KM=1000
```

`SUPABASE_PROJECT_URL` can be used instead of `SUPABASE_URL`. `SUPABASE_SERVICE_KEY`, `SUPABASE_SECRET_KEY`, or `SUPABASE_SERVICE_ROLE` are accepted as service-role key aliases, but keep them server-side only.

WhatsApp notification is only sent after the main workflow succeeds, such as incident reports, driver incident resolution requests, SJ/trip status updates, trip closure requests, invoice due reminders, supplier payable reminders, and maintenance due reminders. If WhatsApp is not configured or the provider fails, the workflow still succeeds and the failure is logged server-side.

Green API is the preferred provider for current deployment. CallMeBot environment variables are still accepted by the code as fallback compatibility, but do not put provider tokens in tracked files. Keep WhatsApp alerts low-volume; this is not a replacement for the official WhatsApp Business API.
