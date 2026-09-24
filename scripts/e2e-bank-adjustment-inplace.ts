import { loadScriptEnv } from './_env';

loadScriptEnv();

import { handleBankAdjustmentCreate, handleBankAdjustmentUpdate, handleBankAdjustmentDelete } from '../src/lib/api/finance-workflows';
import { recomputeBankLedgerBalancesForAccounts } from '../src/lib/api/bank-balance-helpers';
import { getLedgerAccount } from '../src/lib/api/data-helpers';
import { getAllDocuments, getDocumentById } from '../src/lib/repositories/document-store';
import type { ApiSession, AuditLogFn, BankTransaction } from '../src/lib/types';

const session: ApiSession = {
    _id: 'user-owner-001',
    name: 'Raka Prasetya',
    email: 'owner@company.local',
    role: 'OWNER',
};

const auditEvents: Array<{ event: string; entity: string; ref: string; detail: string }> = [];
const noopAuditLog: AuditLogFn = async (_session, event, entity, ref, detail) => {
    auditEvents.push({ event, entity, ref, detail });
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function money(value: unknown) {
    const amount = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function readBody<T>(response: Awaited<ReturnType<typeof handleBankAdjustmentCreate>>): T {
    const body = response as unknown as { __body?: T };
    return body.__body as T;
}

async function listAccountTransactions(accountRef: string) {
    const all = await getAllDocuments<BankTransaction>('bankTransaction');
    const rows = all.filter(row => row.bankAccountRef === accountRef);
    return rows.sort((left, right) => `${left.date || ''} ${left._createdAt || ''} ${left._id}`.localeCompare(`${right.date || ''} ${right._createdAt || ''} ${right._id}`));
}

async function verifyLedger(accountRef: string, expectedBalance: number, label: string) {
    const account = await getLedgerAccount(accountRef);
    assert(account, `akun ${accountRef} tidak ditemukan`);
    const rows = await listAccountTransactions(accountRef);
    let running = money(account.currentBalance ?? 0);
    let chainRunning = money(account.initialBalance ?? 0);
    const stored = rows.map(row => ({ id: row._id, type: row.type, amount: money(row.amount), after: money(row.balanceAfter ?? 0) }));
    assert(chainRunning + stored.reduce((sum, row) => sum + (row.type === 'DEBIT' || row.type === 'TRANSFER_OUT' || row.type === 'ADJUSTMENT_DEBIT' ? -row.amount : row.amount), 0) === expectedBalance, `${label}: saldo akhir = ${running}, expected ${expectedBalance}`);
    for (const row of stored) {
        const delta = row.type === 'DEBIT' || row.type === 'TRANSFER_OUT' || row.type === 'ADJUSTMENT_DEBIT' ? -row.amount : row.amount;
        chainRunning += delta;
        assert(row.after === chainRunning, `${label}: balance setelah mutasi ${row.id} = ${row.after}, expected ${chainRunning}`);
    }
    assert(chainRunning === expectedBalance, `${label}: saldo akhir = ${chainRunning}, expected ${expectedBalance}`);
    assert(running === expectedBalance, `${label}: current_balance akun = ${running}, expected ${expectedBalance}`);
    return stored;
}

function inspectAdjustmentRows(rows: Array<{ id: string; type: string; amount: number; after: number }>) {
    return rows.filter(row => row.type === 'ADJUSTMENT' || row.type === 'ADJUSTMENT_DEBIT');
}

async function main() {
    const accountRef = 'bank-cash-on-hand';

    const before = await verifyLedger(accountRef, 8000000, 'baseline');
    console.log(`[e2e:ank] baseline ledger rows=${before.length}, balance=8.000.000  OK`);

    const created = await handleBankAdjustmentCreate(session, {
        bankAccountRef: accountRef,
        direction: 'in',
        amount: 250000,
        date: '2026-09-16',
    }, noopAuditLog);
    assert(created.status === 200, `create status=${created.status}`);
    const createBody = await created.json();
    const adjustmentId = createBody.adjustmentId;
    assert(adjustmentId, 'create harus mengembalikan adjustmentId');

    let rows = inspectAdjustmentRows(await verifyLedger(accountRef, 8250000, 'setelah create'));
    assert(rows.length === 1, `setelah create harus 1 baris penyesuaian, got ${rows.length}`);
    assert(rows[0].id === adjustmentId && rows[0].type === 'ADJUSTMENT' && rows[0].amount === 250000, `row create tidak cocok: ${JSON.stringify(rows[0])}`);
    console.log(`[e2e:ank] create -> 1 ADJUSTMENT row (+250k, balance=8.250.000)  OK`);

    const originalRow = await getDocumentById<BankTransaction>(adjustmentId, 'bankTransaction');
    assert(originalRow && !originalRow.reversesBankTransactionRef && !originalRow.replacedByBankTransactionRef && !originalRow.replacesBankTransactionRef, 'row baru tidak boleh punya ref reversal/replacement');

    const updated = await handleBankAdjustmentUpdate(session, {
        id: adjustmentId,
        direction: 'in',
        amount: 150000,
        date: '2026-09-16',
    }, noopAuditLog);
    assert(updated.status === 200, `update status=${updated.status}`);
    const updateBody = await updated.json();
    assert(updateBody.adjustmentId === adjustmentId, 'update harus mengembalikan id yang sama (in-place)');

    rows = inspectAdjustmentRows(await verifyLedger(accountRef, 8150000, 'setelah update'));
    assert(rows.length === 1, `setelah update harus tetap 1 baris penyesuaian, got ${rows.length}`);
    assert(rows[0].id === adjustmentId && rows[0].type === 'ADJUSTMENT' && rows[0].amount === 150000, `row update tidak cocok: ${JSON.stringify(rows[0])}`);
    const updatedRow = await getDocumentById<BankTransaction>(adjustmentId, 'bankTransaction');
    assert(updatedRow && !updatedRow.reversesBankTransactionRef && !updatedRow.replacedByBankTransactionRef && !updatedRow.replacesBankTransactionRef, 'row diupdate harus tetap tanpa ref reversal/replacement');
    console.log(`[e2e:ank] update -> masih 1 ADJUSTMENT row (+150k in-place, balance=8.150.000)  OK`);

    const deleted = await handleBankAdjustmentDelete(session, { id: adjustmentId }, noopAuditLog);
    assert(deleted.status === 200, `delete status=${deleted.status}`);

    const afterDelete = await verifyLedger(accountRef, 8000000, 'setelah delete');
    assert(inspectAdjustmentRows(afterDelete).length === 0, 'setelah delete harus 0 baris penyesuaian');
    console.log(`[e2e:ank] delete -> 0 ADJUSTMENT rows, balance kembali 8.000.000  OK`);

    const createEvents = auditEvents.filter(event => event.event === 'CREATE');
    const updateEvents = auditEvents.filter(event => event.event === 'UPDATE');
    const deleteEvents = auditEvents.filter(event => event.event === 'DELETE');
    assert(createEvents.length === 1 && updateEvents.length === 1 && deleteEvents.length === 1, `audit events: create=${createEvents.length} update=${updateEvents.length} delete=${deleteEvents.length}`);
    console.log(`[e2e:ank] audit log: CREATE x1, UPDATE x1, DELETE x1  OK`);

    await recomputeBankLedgerBalancesForAccounts([accountRef]);
    await verifyLedger(accountRef, 8000000, 'final recompute');
    console.log('[e2e:ank] ALL OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});