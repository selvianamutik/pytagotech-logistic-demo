#!/usr/bin/env node
/**
 * audit-stock-movements.mjs
 *
 * Cross-file trace of the dedicated multi-item manual stock in/out page
 * ("Input / Pengeluaran Barang"). The bulk mutation creates one stock movement
 * per row + updates currentStockQty + posts the same accounting journal as the
 * single-row modal, performs all validation UP-FRONT (active+valid item, tire
 * mapping, backdated date, stock sufficiency), writes a single CREATE audit log
 * for the whole batch, and reuses the existing stock-movements permission gate.
 *
 * Files covered:
 *   1. src/app/api/data/route.ts                        — dispatch + fallback
 *   2. src/lib/api/inventory-workflows.ts               — the bulk handler
 *   3. src/app/(admin)/inventory/stock-movements/page.tsx — dedicated page
 *   4. src/proxy.ts                                     — route guard
 *   5. src/lib/rbac.ts                                  — sidebar entry
 *   6. src/app/(admin)/layout.tsx                       — sidebar icon
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROUTE = join(ROOT, 'src', 'app', 'api', 'data', 'route.ts');
const HANDLER = join(ROOT, 'src', 'lib', 'api', 'inventory-workflows.ts');
const PAGE = join(ROOT, 'src', 'app', '(admin)', 'inventory', 'stock-movements', 'page.tsx');
const PROXY = join(ROOT, 'src', 'proxy.ts');
const RBAC = join(ROOT, 'src', 'lib', 'rbac.ts');
const LAYOUT = join(ROOT, 'src', 'app', '(admin)', 'layout.tsx');

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

console.log('audit-stock-movements — cross-file trace of multi-item manual stock in/out');

const routeSource = requireFile('src/app/api/data/route.ts');
const handlerSource = requireFile('src/lib/api/inventory-workflows.ts');
const pageSource = requireFile('src/app/(admin)/inventory/stock-movements/page.tsx');
const proxySource = requireFile('src/proxy.ts');
const rbacSource = requireFile('src/lib/rbac.ts');
const layoutSource = requireFile('src/app/(admin)/layout.tsx');

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

// ---------------------------------------------------------------- page
if (pageSource) {
  console.log('--- src/app/(admin)/inventory/stock-movements/page.tsx');
  assertIn(pageSource, "'use client'", 'Page harus client component.');
  assertIn(pageSource, "action: 'create-many'", 'Page harus mengirim action create-many.');
  assertIn(pageSource, "entity: 'stock-movements'", 'Page harus mengirim entity stock-movements.');
  assertIn(pageSource, 'direction,', 'Page harus mengirim direction batch.');
  assertIn(pageSource, 'entries: validLines.map', 'Page harus mengirim banyak entries.');
  assertIn(pageSource, "setDirection('IN')", 'Toggle arah harus mendukung Stok Masuk.');
  assertIn(pageSource, "setDirection('OUT')", 'Toggle arah harus mendukung Stok Keluar.');
  assertIn(pageSource, "filter: JSON.stringify({ sourceType: ['MANUAL_IN', 'MANUAL_OUT'] })", 'Riwayat harus memfilter sourceType manual saja.');
  assertIn(pageSource, 'Stok setelah diproses', 'Setiap baris harus menampilkan stok hasil.');
  assertIn(pageSource, 'Isi minimal satu barang mutasi stok', 'Client harus menolak tanpa baris valid.');
  assertIn(pageSource, 'tidak cukup', 'Client harus memvalidasi stok keluar sebelum kirim.');
  assertIn(pageSource, "hasPermission(user, 'warehouseItems', 'create') || hasPermission(user, 'warehouseItems', 'update')", 'Page wajib menghitung canManage via permission.');
  assertIn(pageSource, 'Simpan Mutasi', 'Tombol simpan harus ada.');
  assertIn(pageSource, 'Riwayat Mutasi Manual Terbaru', 'Page wajib menampilkan riwayat manual.');
}

// ---------------------------------------------------------------- registration
if (proxySource) {
  console.log('--- src/proxy.ts');
  assertIn(proxySource, "{ path: '/inventory/stock-movements', module: 'warehouseItems' }", 'Guard /inventory/stock-movements belum didaftarkan.');
}

if (rbacSource) {
  console.log('--- src/lib/rbac.ts');
  assertIn(rbacSource, "href: '/inventory/stock-movements'", 'Sidebar belum menautkan /inventory/stock-movements.');
  assertIn(rbacSource, "icon: 'ArrowLeftRight'", 'Sidebar belum memakai ikon ArrowLeftRight.');
}

if (layoutSource) {
  console.log('--- src/app/(admin)/layout.tsx');
  assertIn(layoutSource, 'ArrowLeftRight', 'Ikon ArrowLeftRight belum di-import/didaftarkan di ICON_MAP.');
  assertIn(layoutSource, 'ArrowLeftRight: <ArrowLeftRight size={20} />', 'ICON_MAP belum memuat ArrowLeftRight.');
}

console.log('');
if (failures > 0) {
  console.error(`AUDIT FAILED — ${failures} problem(s) found`);
  process.exit(1);
} else {
  console.log('AUDIT PASSED — route dispatch, batch handler invariants, dedicated page wiring, and registration verified.');
  process.exit(0);
}