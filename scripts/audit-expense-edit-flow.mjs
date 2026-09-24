#!/usr/bin/env node
/**
 * audit-expense-edit-flow.mjs
 *
 * Cross-file trace of the manual expense edit function. The "edit" is a
 * conventional update: it must be dispatched to a dedicated workflow (never the
 * generic update route), reject workflow-linked expenses, re-validate category
 * + amount + date + privacy + bank account, REPLACE the bank transaction sub-ledger
 * row, VOID + repost the journal so history is preserved, recompute affected bank
 * balances, and keep the UI buttons gated behind permission + editability.
 *
 * Files covered:
 *   1. src/app/api/data/route.ts                   — dispatch + module mapping
 *   2. src/lib/api/expense-update.ts               — the update handler
 *   3. src/components/ExpenseEditModal.tsx         — shared edit modal payload
 *   4. src/app/(admin)/expenses/page.tsx           — list page edit gating
 *   5. src/app/(admin)/expenses/[id]/page.tsx      — detail page edit gating
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROUTE = join(ROOT, 'src', 'app', 'api', 'data', 'route.ts');
const HANDLER = join(ROOT, 'src', 'lib', 'api', 'expense-update.ts');
const MODAL = join(ROOT, 'src', 'components', 'ExpenseEditModal.tsx');
const LIST_PAGE = join(ROOT, 'src', 'app', '(admin)', 'expenses', 'page.tsx');
const DETAIL_PAGE = join(ROOT, 'src', 'app', '(admin)', 'expenses', '[id]', 'page.tsx');

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

function assertCount(src, needle, minCount, msg) {
  if (typeof src !== 'string') {
    fail(msg);
    return;
  }
  const count = src.split(needle).length - 1;
  if (count < minCount) fail(`${msg} (ditemukan ${count}, minimal ${minCount})`);
}

console.log('audit-expense-edit-flow — cross-file trace of manual expense edit');

const routeSource = requireFile('src/app/api/data/route.ts');
const handlerSource = requireFile('src/lib/api/expense-update.ts');
const modalSource = requireFile('src/components/ExpenseEditModal.tsx');
const listPageSource = requireFile('src/app/(admin)/expenses/page.tsx');
const detailPageSource = requireFile('src/app/(admin)/expenses/[id]/page.tsx');

// ---------------------------------------------------------------- route wiring
if (routeSource) {
  console.log('--- src/app/api/data/route.ts');
  assertIn(
    routeSource,
    "import { handleExpenseUpdate } from '@/lib/api/expense-update';",
    'handleExpenseUpdate tidak di-import di route.'
  );

  const postStart = routeSource.indexOf('export async function POST');
  const postBlock = postStart >= 0 ? routeSource.slice(postStart) : '';
  if (!postBlock) {
    fail('POST /api/data block tidak ditemukan.');
  } else {
    const dispatchIndex = postBlock.indexOf("entity === 'expenses' && action === 'update'");
    const genericUpdateIndex = postBlock.indexOf("if (action === 'update') {");
    assertIn(
      postBlock,
      "entity === 'expenses' && action === 'update'",
      'Dispatch expenses/update tidak ditemukan di POST /api/data.'
    );
    if (dispatchIndex >= 0 && genericUpdateIndex >= 0) {
      assert(
        dispatchIndex < genericUpdateIndex,
        'Dispatch expenses/update harus sebelum generic update agar tidak tertelan route umum.'
      );
    }
    assertIn(
      postBlock,
      'return await handleExpenseUpdate(session, data, addAuditLog);',
      'Dispatch expenses/update tidak menyala sebagai handleExpenseUpdate(session, data, addAuditLog).'
    );
  }

  const mapStart = routeSource.indexOf('const ENTITY_MODULE_MAP');
  const mapBlock = mapStart >= 0 ? routeSource.slice(mapStart, routeSource.indexOf('function validateEntity', mapStart)) : '';
  assertIn(mapBlock, "expenses: 'expenses',", 'ENTITY_MODULE_MAP harus memetakan expenses ke module expenses.');
}

// ---------------------------------------------------------------- handler
if (handlerSource) {
  console.log('--- src/lib/api/expense-update.ts');
  const H = handlerSource;

  assertIn(H, "normalizeOptionalText(data._id) || normalizeOptionalText(data.id)", 'Handler harus menerima _id atau id.');
  assertIn(H, "{ error: 'Pengeluaran tidak valid' }, { status: 400 }", 'Id kosong harus ditolak dengan 400.');
  assertIn(H, "if (!hasPermission(session, 'expenses', 'update'))", 'Handler harus menolak tanpa izin update expenses.');
  assertIn(H, "'Tidak memiliki izin untuk mengubah pengeluaran'", 'Pesan 403 izin update expenses tidak konsisten.');
  assertIn(H, "getDocumentById<Expense>(id, 'expense')", 'Handler harus memuat expense by id.');
  assertIn(H, "{ error: 'Pengeluaran tidak ditemukan' }, { status: 404 }", 'Expense tidak ditemukan harus 404.');

  assertIn(H, 'WORKFLOW_LINK_FIELDS', 'Handler harus memakai WORKFLOW_LINK_FIELDS untuk menolak expense workflow.');
  for (const label of ['penyelesaian insiden', 'insiden', 'maintenance', 'bon trip', 'slip borongan', 'DO / trip']) {
    assertIn(H, `label: '${label}'`, `WORKFLOW_LINK_FIELDS belum mencakup label '${label}'.`);
  }
  assertIn(H, 'tidak bisa diubah manual. Ubah lewat workflow sumber.', 'Pesan 409 expense workflow tidak konsisten.');

  assertIn(H, 'Kategori pengeluaran wajib dipilih', 'Kategori wajib harus divalidasi.');
  assertIn(H, "getDocumentById<ExpenseCategory>(categoryRef, 'expenseCategory')", 'Handler harus memuat kategori by ref.');
  assertIn(H, "category.active === false", 'Kategori non-aktif harus ditolak.');
  assertIn(H, "if (!isManualExpenseCategory(category))", 'Kategori workflow harus ditolak dari edit manual.');
  assertIn(H, 'Kategori ini khusus workflow. Gunakan kategori Pengeluaran Umum untuk input manual.', 'Pesan 409 kategori workflow tidak konsisten.');

  assertIn(H, 'normalizeCurrencyNumber(data.amount ?? expense.amount)', 'Nominal wajib dinormalisasi dari payload/expense.');
  assertIn(H, "amount <= 0", 'Nominal <= 0 harus ditolak.');
  assertIn(H, "{ error: 'Nominal pengeluaran tidak valid' }, { status: 400 }", 'Pesan 400 nominal tidak konsisten.');

  assertIn(H, 'assertIsoDate', 'Tanggal wajib melalui assertIsoDate.');
  assertIn(H, "'Tanggal pengeluaran tidak valid'", 'Pesan 400 tanggal tidak konsisten.');

  assertIn(H, 'privacyLevel', 'Handler harus memvalidasi privacyLevel.');
  assertIn(H, "'ownerOnly' && rawPrivacyLevel !== 'internal'", 'Nilai privacyLevel selain ownerOnly/internal harus ditolak.');
  assertIn(H, "requestedPrivacyLevel === 'ownerOnly' && !hasPermission(session, 'expenses', 'update')", 'ownerOnly wajib butuh izin update.');
  assertIn(H, "'Hanya OWNER yang boleh membuat pengeluaran owner-only'", 'Pesan 403 privacy tidak konsisten.');

  assertIn(H, 'getLedgerAccount(selectedAccountRef)', 'Rekening bank wajib divalidasi via getLedgerAccount.');
  assertIn(H, "{ error: 'Rekening bank tidak ditemukan' }, { status: 404 }", 'Rekening tidak ditemukan harus 404.');
  assertIn(H, 'oldDebitOnTarget', 'Cek saldo wajib memperhitungkan mutasi lama di rekening yang sama.');
  assertIn(H, 'nextBalance < 0', 'Saldo tidak cukup harus ditolak.');
  assertIn(H, 'computeLedgerDebitBalance', 'Cek saldo wajib memakai computeLedgerDebitBalance.');

  assertIn(H, "listDocumentsByFilter<BankTransaction>('bankTransaction', {", 'Handler wajib memuat transaksi bank lama expense.');
  assertIn(H, "relatedExpenseRef: id", 'Filter transaksi bank lama wajib via relatedExpenseRef.');
  assertIn(H, "deleteDocument(transaction._id, 'bankTransaction')", 'Transaksi bank lama harus di-replace (hapus + buat ulang), bukan ditimpa.');
  assertIn(H, "relatedExpenseRef: id,", 'Transaksi bank baru harus tetap menautkan relatedExpenseRef.');
  assertIn(H, "type: 'DEBIT',", 'Transaksi bank expense harus DEBIT.');
  assertIn(H, 'balanceAfter: nextBalance', 'Transaksi bank baru wajib mencatat saldo berjalan.');

  assertIn(H, "voidJournalEntryForSource(session, 'EXPENSE', id, 'CREATE')", 'Handler wajib void jurnal EXPENSE/CREATE lama.');
  assertIn(H, 'postExpenseJournal(session, updatedExpense as Expense, bankAcc)', 'Handler wajib posting ulang jurnal expense.');
  assertIn(H, 'recomputeBankLedgerBalancesForAccounts(recomputeRefs)', 'Handler wajib recompute saldo rekening lama + baru.');
  assertIn(H, 'addAuditLog(', 'Handler wajib mencatat audit log.');
  assertIn(H, "'UPDATE',", 'Audit log wajib ber-action UPDATE.');
  assertIn(H, "'expenses',", 'Audit log wajib menunjuk entity expenses.');
  assertIn(H, 'Koreksi:', 'Audit log update wajib memakai summary Koreksi.');
  assertIn(H, "return NextResponse.json({ data: updatedExpense, id });", 'Response handler wajib berbentuk { data, id }.');

  assertIn(
    H,
    'normalizeOptionalText(data.description) ?? expense.description',
    'description lama harus dipertahankan ketika payload tidak mengirim description.'
  );
  assertIn(
    H,
    'normalizeOptionalText(data.receiptUrl) ?? expense.receiptUrl',
    'receiptUrl lama harus dipertahankan ketika payload tidak mengirim receiptUrl.'
  );
}

// ---------------------------------------------------------------- modal
if (modalSource) {
  console.log('--- src/components/ExpenseEditModal.tsx');
  assertIn(modalSource, "fetchOptionalCollection<ExpenseCategory[]>('/api/data?entity=expense-categories', [])", 'Modal harus lazy-load kategori optional.');
  assertIn(modalSource, "fetchOptionalCollection<BankAccount[]>('/api/data?entity=bank-accounts', [])", 'Modal harus lazy-load rekening optional.');
  assertIn(modalSource, 'isManualExpenseCategory', 'Modal hanya boleh menawarkan kategori manual.');
  assertIn(modalSource, 'category.active !== false', 'Modal harus menyaring kategori non-aktif.');
  assertIn(modalSource, 'account.active !== false', 'Modal harus menyaring rekening non-aktif.');
  assertIn(modalSource, "entity: 'expenses'", 'Modal harus mengirim entity expenses.');
  assertIn(modalSource, "action: 'update'", 'Modal harus mengirim action update.');
  assertIn(modalSource, '_id: expense._id', 'Modal harus mengirim _id expense yang diedit.');
  assertIn(modalSource, "/^\\d{4}-\\d{2}-\\d{2}$/", 'Modal harus memvalidasi format tanggal ISO.');
  assertIn(modalSource, 'Number(form.amount) > 0', 'Modal harus menolak nominal <= 0.');
  assertIn(modalSource, 'hasValidBankRef', 'Modal harus memvalidasi rekening terpilih masih dikenal.');
  assertIn(modalSource, 'onSaved(', 'Modal harus meneruskan hasil simpan via onSaved.');
}

// ---------------------------------------------------------------- list page
if (listPageSource) {
  console.log('--- src/app/(admin)/expenses/page.tsx');
  assertIn(listPageSource, "import ExpenseEditModal from '@/components/ExpenseEditModal';", 'List page harus import ExpenseEditModal.');
  assertIn(listPageSource, "const canUpdateExpenses = user ? hasPermission(user, 'expenses', 'update') : false;", 'List page harus menghitung canUpdateExpenses via permission.');
  assertCount(listPageSource, 'canUpdateExpenses && expenseSource.editable', 2, 'Edit tombol desktop + mobile harus gate canUpdateExpenses && expenseSource.editable.');
  assertIn(listPageSource, 'getExpenseSource(expense, referenceMaps, linkPermissions)', 'List page harus memakai getExpenseSource untuk editability.');
  assertIn(listPageSource, "onSaved={() => void loadExpenses()}", 'List page harus reload data setelah simpan.');
}

// ---------------------------------------------------------------- detail page
if (detailPageSource) {
  console.log('--- src/app/(admin)/expenses/[id]/page.tsx');
  assertIn(detailPageSource, "import ExpenseEditModal from '@/components/ExpenseEditModal';", 'Detail page harus import ExpenseEditModal.');
  assertIn(detailPageSource, "const canUpdateExpense = user ? hasPermission(user, 'expenses', 'update') : false;", 'Detail page harus menghitung canUpdateExpense via permission.');
  assertIn(detailPageSource, 'canUpdateExpense && expenseSource.editable', 'Tombol edit detail harus gate canUpdateExpense && expenseSource.editable.');
  assertIn(detailPageSource, 'getExpenseSource(expense, referenceMaps, linkPermissions)', 'Detail page harus memakai getExpenseSource untuk editability.');
  assertIn(detailPageSource, 'onSaved={updated => setExpense(updated)}', 'Detail page harus memperbarui expense dari respons simpan.');
}

console.log('');
if (failures > 0) {
  console.error(`AUDIT FAILED — ${failures} problem(s) found`);
  process.exit(1);
} else {
  console.log('AUDIT PASSED — route dispatch, handler invariants, modal payload, and UI gating verified.');
  process.exit(0);
}