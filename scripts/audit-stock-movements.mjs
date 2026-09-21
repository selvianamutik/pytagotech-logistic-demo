#!/usr/bin/env node
/**
 * audit-stock-movements.mjs
 *
 * Cross-file trace of the multi-item manual stock in/out feature launched from
 * a modal on /inventory/items ("Input / Keluar Stok"). The bulk mutation creates
 * one stock movement per row + updates currentStockQty + posts the same
 * accounting journal as the single-row modal, performs all validation UP-FRONT
 * (active+valid item, tire mapping, backdated date, stock sufficiency), writes a
 * single CREATE audit log for the whole batch, and reuses the existing
 * stock-movements permission gate.
 *
 * Files covered:
 *   1. src/app/api/data/route.ts
 *   2. src/lib/api/inventory-workflows.ts
 *   3. src/app/(admin)/inventory/_components/StockMovementBulkModal.tsx
 *   4. src/app/(admin)/inventory/items/page.tsx            — trigger + wiring
 *   5. src/proxy.ts + src/lib/rbac.ts                      — must NOT expose a page
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROUTE = join(ROOT, 'src', 'app', 'api', 'data', 'route.ts');
const HANDLER = join(ROOT, 'src', 'lib', 'api', 'inventory-workflows.ts');
const MODAL = join(ROOT, 'src', 'app', '(admin)', 'inventory', '_components', 'StockMovementBulkModal.tsx');
const ITEMS_PAGE = join(ROOT, 'src', 'app', '(admin)', 'inventory', 'items', 'page.tsx');
const PROXY = join(ROOT, 'src', 'proxy.ts');
const RBAC = join(ROOT, 'src', 'lib', 'rbac.ts');

let failures = 0;

function fail(msg) {
  failures++;
  console.error(`  - ${msg}`);
}

function assert(condition, msg) {
  if (!condition) fail(msg);
}

function requireFile(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    fail(`file missing: ${rel}`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

function assertIn(src, needle, msg) {
  if (typeof src !== 'string' || !src.includes(needle)) fail(msg);
}

function assertAbsent(src, needle, msg) {
  if (typeof src === 'string' && src.includes(needle)) fail(msg);
}

console.log('audit-stock-movements — cross-file trace of multi-item manual stock in/out (modal on /inventory/items)');

const routeSource = requireFile('src/app/api/data/route.ts');
const handlerSource = requireFile('src/lib/api/inventory-workflows.ts');
const modalSource = requireFile('src/app/(admin)/inventory/_components/StockMovementBulkModal.tsx');
const itemsPageSource = requireFile('src/app/(admin)/inventory/items/page.tsx');
const proxySource = requireFile('src/proxy.ts');
const rbacSource = requireFile('src/lib/rbac.ts');

// ---------------------------------------------------------------- route wiring
if (routeSource) {
  console.log('--- src/app/api/data/route.ts');
  assertIn(
    routeSource,
    'handleStockMovementCreateMany',
    'handleStockMovementCreateMany tidak di-import di route.'
  );

  const postStart = routeSource.indexOf('export async function POST');
  const postBlock = postStart >= 0 ? routeSource.slice(postStart) : '';
  if (!postBlock) {
    fail('POST /api/data block tidak ditemukan.');
  } else {
    const batchIndex = postBlock.indexOf("entity === 'stock-movements' && action === 'create-many'");
    const singleIndex = postBlock.indexOf("entity === 'stock-movements' && isCreateAction");
    const genericUpdateIndex = postBlock.indexOf("if (action === 'update') {");
    assertIn(
      postBlock,
      "entity === 'stock-movements' && action === 'create-many'",
      'Dispatch stock-movements/create-many tidak ditemukan di POST /api/data.'
    );
    assert(
      batchIndex >= 0 && singleIndex >= 0 && batchIndex < singleIndex,
      'Dispatch create-many harus mendahului create tunggal stock-movements.'
    );
    if (genericUpdateIndex >= 0) {
      assert(
        batchIndex >= 0 && genericUpdateIndex >= 0 && batchIndex < genericUpdateIndex,
        'Dispatch create-many harus sebelum generic update agar tidak tertelan route umum.'
      );
    }
    assertIn(
      postBlock,
      'return await handleStockMovementCreateMany(session, data, addAuditLog);',
      'Dispatch create-many tidak menyalakan handleStockMovementCreateMany(session, data, addAuditLog).'
    );
  }

  assertIn(
    routeSource,
    "(entity === 'stock-movements' && (!action || action === 'create' || action === 'create-many'))",
    'shouldFallbackToBusinessDate harus mencakup action create-many untuk stock-movements.'
  );
  assertIn(
    routeSource,
    "if (entity === 'stock-movements') {",
    'Gate izin stock-movements harus berupa cabang khusus (bukan fallback) untuk action create-many.'
  );
  assertIn(
    routeSource,
    "return hasPermission(session, 'purchases', 'create');",
    'Gate izin stock-movements (purchases.create) harus tetap ada untuk action create-many.'
  );
}

// ---------------------------------------------------------------- handler
if (handlerSource) {
  console.log('--- src/lib/api/inventory-workflows.ts');
  const H = handlerSource;
  const fnStart = H.indexOf('export async function handleStockMovementCreateMany');
  const fnBlock = fnStart >= 0 ? H.slice(fnStart) : '';

  assertIn(H, 'export async function handleStockMovementCreateMany', 'Handler handleStockMovementCreateMany tidak ada.');

  assertIn(fnBlock, "const direction = normalizeText(data.direction).toUpperCase();", 'Handler harus normalisasi direction.');
  assertIn(fnBlock, "direction !== 'IN' && direction !== 'OUT'", 'Handler harus menolak direction selain IN/OUT.');
  assertIn(fnBlock, 'Arah mutasi stok tidak valid', 'Pesan 400 arah mutasi tidak konsisten.');
  assertIn(fnBlock, 'const rawEntries = Array.isArray(data.entries) ? data.entries : [];', 'Handler harus menerima entries sebagai array.');
  assertIn(fnBlock, "if (rawEntries.length === 0)", 'Handler harus menolak entries kosong.');
  assertIn(fnBlock, 'Minimal satu barang wajib diisi', 'Pesan 400 entries kosong tidak konsisten.');
  assertIn(fnBlock, 'rawEntries.length > 50', 'Handler harus membatasi jumlah barang per batch.');
  assertIn(fnBlock, 'tidak boleh duplikat dalam satu mutasi', 'Handler harus menolak ref duplikat dalam satu batch.');
  assertIn(fnBlock, 'assertIsoDate(movementDate', 'Handler wajib memvalidasi movementDate.');
  assertIn(fnBlock, 'parseInventoryQuantity(entry.quantity)', 'Handler wajib menormalkan qty per baris.');
  assertIn(fnBlock, '!Number.isFinite(quantity) || quantity <= 0', 'Handler harus menolak qty <= 0 / tidak valid.');
  assertIn(fnBlock, "listDocumentsByFilter<WarehouseItemDocument>('warehouseItem', {", 'Handler wajib memuat semua barang sekaligus (bukan per baris).');
  assertIn(fnBlock, 'barang gudang tidak ditemukan', 'Handler harus menolak barang yang tidak ditemukan.');
  assertIn(fnBlock, 'getLatestWarehouseStockMovementDateMap', 'Handler wajib memakai peta tanggal mutasi terakhir.');
  assertIn(fnBlock, 'tidak boleh lebih awal dari mutasi stok terakhir', 'Handler harus menolak tanggal backdated per barang.');
  assertIn(fnBlock, 'isTireTrackedWarehouseItem(item)', 'Handler harus menolak barang ban tertracking.');
  assertIn(fnBlock, 'ban tertracking dikelola lewat modul Ban', 'Pesan 409 ban tertracking tidak konsisten.');
  assertIn(fnBlock, 'const sourceType: StockMovementSourceType = direction === \'OUT\' ? \'MANUAL_OUT\' : \'MANUAL_IN\';', 'Handler harus menurunkan sourceType dari direction.');
  assertIn(fnBlock, 'export async function handleStockMovementCreateMany', 'Handler handleStockMovementCreateMany tidak ada.');
  assertIn(fnBlock, 'const planned:', 'Handler harus merencanakan semua baris (validasi + kalkulasi) sebelum menulis.');
  assertIn(fnBlock, 'tidak cukup: tersedia', 'Handler harus menolak stok keluar melebihi saldo dengan pesan berisi item.');
  assertIn(fnBlock, "await updateDocument(item.warehouseItem._id, { currentStockQty: item.nextStockQty }, 'warehouseItem')", 'Handler wajib update currentStockQty per barang.');
  assertIn(fnBlock, "await createDocument(movementDoc as unknown as { _type: string", 'Handler wajib createDocument satu movement per baris.');
  assertIn(fnBlock, 'const movementDoc: StockMovement = {', 'Handler wajib membangun StockMovement.');
  assertIn(fnBlock, "costMethod: 'WAREHOUSE_DEFAULT'", 'Movement wajib memakai costMethod WAREHOUSE_DEFAULT.');
  assertIn(fnBlock, 'balanceAfter: item.nextStockQty', 'Movement wajib mencatat saldo setelah mutasi.');
  assertIn(fnBlock, 'await postStockMovementJournal(session, movementDoc, item.unitCostSnapshot)', 'Handler wajib posting jurnal lalu memakai unitCost snapshot.');
  assertIn(fnBlock, "summaries.push(\n                buildStockMovementAuditSummary", 'Handler wajib mengumpulkan ringkasan audit per baris.');
  assertIn(fnBlock, "'CREATE',\n            'stock-movements',", 'Audit log batch wajib CREATE stock-movements.');
  assertIn(fnBlock, 'batchRef', 'Audit log batch wajib memakai entityRef batch.');
  assertIn(fnBlock, 'return NextResponse.json({ data: { count: movementDocs.length, batchRef, movements: movementDocs }, id: batchRef });', 'Response handler wajib berbentuk { data: { count, batchRef, movements }, id }.');

  const stockCheckIndex = fnBlock.indexOf('tidak cukup: tersedia');
  const firstWriteIndex = fnBlock.indexOf('await updateDocument(');
  assert(
    stockCheckIndex >= 0 && firstWriteIndex >= 0 && stockCheckIndex < firstWriteIndex,
    'Cek ketersediaan stok harus terjadi SEBELUM penulisan pertama (tanpa partial-write saat baris belakangan gagal).'
  );

  assert(
    fnStart >= 0 && fnStart < H.indexOf('export async function handlePurchasePaymentCreate'),
    'handleStockMovementCreateMany harus ditempatkan sebelum handler berikutnya.'
  );
}

// ---------------------------------------------------------------- modal
if (modalSource) {
  console.log('--- src/app/(admin)/inventory/_components/StockMovementBulkModal.tsx');
  assertIn(modalSource, "'use client'", 'Modal harus client component.');
  assertIn(modalSource, "action: 'create-many'", 'Modal harus mengirim action create-many.');
  assertIn(modalSource, "entity: 'stock-movements'", 'Modal harus mengirim entity stock-movements.');
  assertIn(modalSource, 'direction,', 'Modal harus mengirim direction batch.');
  assertIn(modalSource, 'entries: validLines.map', 'Modal harus mengirim banyak entries.');
  assertIn(modalSource, "setDirection('IN')", 'Toggle arah harus mendukung Stok Masuk.');
  assertIn(modalSource, "setDirection('OUT')", 'Toggle arah harus mendukung Stok Keluar.');
  assertIn(modalSource, "filter: JSON.stringify({ sourceType: ['MANUAL_IN', 'MANUAL_OUT'] })", 'Riwayat harus memfilter sourceType manual saja.');
  assertIn(modalSource, 'Stok setelah diproses', 'Setiap baris harus menampilkan stok hasil.');
  assertIn(modalSource, 'Isi minimal satu barang mutasi stok', 'Modal harus menolak tanpa baris valid.');
  assertIn(modalSource, "if (!canManage) return addToast('error', 'Anda tidak punya hak mencatat mutasi stok')", 'Modal wajib menolak tanpa akses canManage.');
  assertIn(modalSource, 'modal modal-lg', 'Modal wajib memakai kelas modal modal-lg.');
  assertIn(modalSource, 'Tinjau &amp; Simpan', 'Tombol simpan (langkah tinjau) harus ada.');
  assertIn(modalSource, "'Konfirmasi Simpan'", 'Tombol konfirmasi simpan pada langkah tinjau harus ada.');
  assertIn(modalSource, "setPhase('review')", 'Modal wajib punya langkah tinjau sebelum menyimpan.');
  assertIn(modalSource, 'Riwayat ini tidak dapat diubah atau dihapus', 'Langkah tinjau wajib memperingatkan riwayat tidak dapat diubah.');
  assertIn(modalSource, 'Riwayat Mutasi Manual Terbaru', 'Modal wajib menampilkan riwayat manual.');
}

// ---------------------------------------------------------------- items page wiring
if (itemsPageSource) {
  console.log('--- src/app/(admin)/inventory/items/page.tsx');
  assertIn(itemsPageSource, "import StockMovementBulkModal from '../_components/StockMovementBulkModal';", 'Items page wajib meng-import StockMovementBulkModal.');
  assertIn(itemsPageSource, 'setShowBulkMovementModal(true)', 'Items page wajib membuka modal lewat state.');
  assertIn(itemsPageSource, 'Input / Keluar Stok', 'Items page wajib menampilkan tombol Input / Keluar Stok.');
  assertIn(itemsPageSource, 'showBulkMovementModal && (', 'Items page wajib me-render modal kondisi (mount = open).');
  assertIn(itemsPageSource, 'items={allItems}', 'Items page harus meneruskan allItems ke modal.');
  assertIn(itemsPageSource, 'onClose={', 'Items page wajib menutup modal lewat onClose.');
  assertIn(itemsPageSource, 'onSaved={loadItems}', 'Items page wajib memuat ulang items setelah save.');
}

// ---------------------------------------------------------------- no standalone page
if (proxySource) {
  assertAbsent(proxySource, '/inventory/stock-movements', 'proxy.ts tidak boleh lagi punya guard /inventory/stock-movements.');
}

if (rbacSource) {
  assertAbsent(rbacSource, '/inventory/stock-movements', 'rbac.ts tidak boleh lagi menautkan /inventory/stock-movements di sidebar.');
}

console.log('');
if (failures > 0) {
  console.error(`AUDIT FAILED — ${failures} problem(s) found`);
  process.exit(1);
} else {
  console.log('AUDIT PASSED — route dispatch, batch handler invariants, modal wiring on /inventory/items, and sidebar/guard removal verified.');
  process.exit(0);
}