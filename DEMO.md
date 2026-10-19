# DEMO PT Logistik Demo

Panduan singkat untuk presentasi demo aplikasi logistik.

## 1. Persiapan

1. Reset data demo:

```bash
npm run reseed:supabase
```

2. Akun demo utama:
- Owner: `owner@company.local / owner12345`
- Operasional: `admin@company.local / admin12345`
- Finance: `finance@company.local / admin12345`
- Armada: `armada@company.local / admin12345`
- Driver:
  - `driver.agus@company.local / driver12345`
  - `driver.budi@company.local / driver12345`
  - `driver.catur@company.local / driver12345`
  - `driver.eko@company.local / driver12345`

3. Halaman utama yang perlu siap:
- `/dashboard`
- `/orders`
- `/delivery-orders`
- `/invoices`
- `/driver-vouchers`
- `/bank-accounts`
- `/expenses`
- `/reports`
- `/fleet/vehicles`
- `/fleet/drivers`

## 2. Istilah yang Dipakai di Sistem

- `Customer / Pengirim`: perusahaan yang order jasa dan yang ditagih
- `Lokasi Ambil`: lokasi pickup barang milik customer
- `Tujuan / Penerima`: lokasi atau orang penerima barang
- `Order / Resi`: order awal customer
- `Surat Jalan`: dokumen trip per pengiriman
- `Nota Ongkos`: tagihan customer
- `Penerimaan Customer`: uang masuk dari customer
- `Potongan Tagihan`: klaim, diskon, penalty, atau pengurang tagihan
- `Borongan`: upah driver per DO
- `Uang Jalan Trip`: uang jalan di depan dan settlement trip

## 3. Alur Demo yang Disarankan

1. Login owner dan buka dashboard.
2. Tunjukkan customer, barang customer, lokasi ambil, dan tujuan.
3. Buat order baru.
4. Buat surat jalan dari order.
5. Tunjukkan portal driver dan tracking.
6. Selesaikan DO dari admin.
7. Buat nota dari DO selesai.
8. Catat penerimaan customer.
9. Tunjukkan borongan dan uang jalan trip.
10. Tunjukkan armada, maintenance, ban, dan insiden.
11. Tunjukkan rekening, kas, dan laporan.

## 3A. Skenario Seed Setelah Reset

Setelah `npm run reseed:supabase`, dataset baseline sudah menyiapkan contoh ini:

- `DO-202603-0003`: trip aktif `ON_DELIVERY`
- `DO-202603-0004`: driver sudah `Ajukan Selesai`, admin tinggal review
- `DO-202603-0005`: DO sudah dibuat tapi armada dan supir belum dipilih
- `DO-202603-0011`: contoh partial qty dengan sisa barang di-hold
- `NOTA-202603-0001`: belum lunas
- `NOTA-202603-0004`: dibayar sebagian
- `RCV-202603-0002`: contoh `Kredit Customer` karena bayar lebih

## 4. Demo Customer dan Master Data

Di detail customer, jelaskan bahwa master data customer sekarang mencakup:
- barang customer
- lokasi ambil
- tujuan / penerima

Tujuannya:
- input order lebih cepat
- mengurangi typo
- alamat pickup dan tujuan lebih konsisten

## 5. Demo Order sampai Surat Jalan

### Buat order

1. Buka `Order / Resi`.
2. Klik `Buat Order Baru`.
3. Pilih customer.
4. Perlihatkan bahwa:
- `Lokasi Ambil` bisa autofill dari master customer
- `Tujuan / Penerima` bisa autofill dari master customer
- barang customer bisa autofill deskripsi dan muatan
5. Simpan order.

### Buat surat jalan

1. Buka detail order.
2. Klik `Buat Surat Jalan`.
3. Pilih item.
4. Pilih kendaraan.
5. Pilih supir, atau biarkan kosong dulu untuk menunjukkan workflow pelengkapan armada belakangan.
6. Simpan.

Hal penting:
- satu order bisa dibuat beberapa DO
- kendaraan atau supir yang masih dipakai DO aktif tidak muncul
- DO tanpa supir masih bisa dibuat, tapi harus dilengkapi sebelum masuk workflow trip berikutnya

## 6. Demo Tracking Driver

### Dari sisi driver

1. Login sebagai driver.
2. Buka daftar DO driver.
3. Mulai tracking.
4. Ubah progres:
- `ON_DELIVERY`
- `ARRIVED`
5. Untuk `DELIVERED`, jelaskan bahwa driver hanya mengajukan, admin yang menyetujui.

### Dari sisi admin

1. Buka detail surat jalan.
2. Tunjukkan status tracking, lokasi terakhir, akurasi, dan histori tracking.
3. Jika DO dibuat tanpa supir, tunjukkan tombol `Pilih Supir` atau `Ganti Armada / Supir`.

## 7. Demo Penyelesaian DO

1. Di detail DO, klik `Ubah Status`.
2. Pilih `DELIVERED`.
3. Isi POD:
- nama penerima
- tanggal terima
- catatan jika ada
4. Tunjukkan aktual muatan per item dan titik drop aktual.
5. Simpan.

Hal penting:
- status final tetap dikendalikan admin
- POD masuk di langkah yang sama
- setelah selesai, DO siap dipakai untuk nota, borongan, dan uang jalan trip

## 8. Demo Nota Ongkos dan Penerimaan Customer

### Buat nota

1. Buka `Tagihan / Nota`.
2. Klik `Baru`.
3. Pilih DO yang sudah selesai.
4. Perlihatkan bahwa baris nota bisa diisi dari DO.
5. Simpan.

### Catat potongan tagihan

1. Buka detail nota.
2. Tambah `Potongan Tagihan`.
3. Jelaskan bahwa potongan mengurangi nilai tagihan, bukan uang masuk.

### Catat penerimaan customer

1. Kembali ke daftar nota.
2. Klik `Catat Penerimaan`.
3. Pilih customer.
4. Isi nominal.
5. Jelaskan bahwa:
- satu penerimaan bisa dialokasikan ke beberapa nota
- sisa lebih bayar akan menjadi `Kredit Customer`

## 9. Demo Borongan dan Uang Jalan Trip

### Borongan

1. Buka `Borongan`.
2. Buat slip dari DO selesai.
3. Bayar slip borongan.

### Uang jalan trip

1. Buka `Uang Jalan Trip`.
2. Pilih DO yang masih operasional.
3. Terbitkan uang jalan awal.
4. Tunjukkan top up dan penyelesaian akhir di detail trip.

Hal penting:
- borongan adalah upah driver
- uang jalan trip adalah kas operasional trip

## 10. Demo Armada

Yang perlu ditunjukkan:
- data kendaraan
- data supir
- slot ban per kendaraan
- maintenance
- insiden

Hal penting:
- setup ban utama sekarang dilakukan dari detail kendaraan
- ban terdaftar bisa dipilih berdasarkan kode ban, jadi input tidak mudah mismatch

## 11. Demo Rekening, Kas, dan Laporan

### Rekening dan kas

Tunjukkan:
- saldo rekening
- mutasi
- transfer antar rekening
- dampak pembayaran dan pengeluaran ke kas / rekening

### Laporan

Jelaskan perbedaan:
- `Laba Rugi`: performa usaha
- `Arus Kas`: uang masuk dan keluar nyata

## 12. Skenario Demo Cepat

Kalau waktu singkat, jalankan urutan ini:

1. Owner login
2. Customer -> lihat barang, lokasi ambil, tujuan
3. Buat order
4. Buat surat jalan
5. Driver login -> mulai tracking
6. Admin -> selesaikan DO
7. Buat nota
8. Catat penerimaan customer
9. Buka laporan

## 13. Catatan Penting Saat Presentasi

- Jangan jelaskan struktur database ke client.
- Jelaskan dengan bahasa operasional.
- Bedakan jelas antara:
  - `Potongan Tagihan`
  - `Penerimaan Customer`
  - `Borongan`
  - `Uang Jalan Trip`
- Kalau mau ulang demo dari awal, cukup jalankan:

```bash
npm run reseed:supabase
```
