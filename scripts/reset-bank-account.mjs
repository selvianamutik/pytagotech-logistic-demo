import { loadScriptEnv, requireAnyEnv } from './_env.mjs';

loadScriptEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

const ADJUSTMENT_TYPES = ['ADJUSTMENT', 'ADJUSTMENT_DEBIT'];
const DEFAULT_TARGET = 'bank-cash-on-hand';

function getArgValue(flag, fallback = '') {
    const match = process.argv.find(arg => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : fallback;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function money(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function bankDelta(transaction) {
    const amount = money(transaction.amount);
    return transaction.type === 'DEBIT' || transaction.type === 'TRANSFER_OUT' || transaction.type === 'ADJUSTMENT_DEBIT' ? -amount : amount;
}

function bankTransactionOrderKey(transaction) {
    return `${transaction.date || ''} ${transaction.document_created_at || ''} ${transaction.source_document_id || ''}`;
}

async function supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
        ...init,
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response;
}

async function fetchAll(table, query = '') {
    const pageSize = 1000;
    const rows = [];

    for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const response = await supabaseRequest(`${table}?select=*${query}`, {
            headers: {
                Range: `${from}-${to}`,
            },
        });
        const batch = await response.json();
        rows.push(...batch);
        if (batch.length < pageSize) break;
    }

    return rows;
}

async function deleteById(table, id) {
    await supabaseRequest(`${table}?source_document_id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
            Prefer: 'return=minimal',
        },
    });
}

async function patchById(table, id, patch) {
    await supabaseRequest(`${table}?source_document_id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
            Prefer: 'return=minimal',
        },
        body: JSON.stringify(patch),
    });
}

async function cleanupAccountJournals(accountId) {
    const entries = await fetchAll('journal_entries', `&source_type=eq.BANK_ACCOUNT&source_ref=eq.${encodeURIComponent(accountId)}`);
    for (const entry of entries) {
        const lines = await fetchAll('journal_lines', `&journal_entry_ref=eq.${encodeURIComponent(entry.source_document_id)}`);
        for (const line of lines) {
            await deleteById('journal_lines', line.source_document_id);
        }
        await deleteById('journal_entries', entry.source_document_id);
    }
    return entries.length;
}

async function sweepOrphanAccountJournals() {
    const entries = await fetchAll('journal_entries', '&source_type=eq.BANK_ACCOUNT');
    const accounts = await fetchAll('bank_accounts');
    const accountIds = new Set(accounts.map(account => account.source_document_id));
    let removed = 0;
    for (const entry of entries) {
        if (accountIds.has(entry.source_ref)) continue;
        const lines = await fetchAll('journal_lines', `&journal_entry_ref=eq.${encodeURIComponent(entry.source_document_id)}`);
        for (const line of lines) {
            await deleteById('journal_lines', line.source_document_id);
        }
        await deleteById('journal_entries', entry.source_document_id);
        removed += 1;
    }
    return removed;
}

async function main() {
    const target = getArgValue('--account', DEFAULT_TARGET);
    const pruneTestArtifacts = hasFlag('--prune-test-artifacts');

    const accounts = await fetchAll('bank_accounts', `&source_document_id=eq.${encodeURIComponent(target)}`);
    const account = accounts[0];
    if (!account) {
        throw new Error(`Rekening ${target} tidak ditemukan`);
    }

    const transactions = await fetchAll('bank_transactions', `&bank_account_ref=eq.${encodeURIComponent(target)}`);
    const adjustmentRows = transactions.filter(row => ADJUSTMENT_TYPES.includes(row.type));
    const keptRows = transactions.filter(row => !ADJUSTMENT_TYPES.includes(row.type));

    for (const row of adjustmentRows) {
        await deleteById('bank_transactions', row.source_document_id);
    }

    let runningBalance = money(account.initial_balance);
    let recomputedTransactions = 0;
    const ordered = [...keptRows].sort((left, right) => bankTransactionOrderKey(left).localeCompare(bankTransactionOrderKey(right)));

    for (const row of ordered) {
        runningBalance += bankDelta(row);
        if (money(row.balance_after) !== runningBalance) {
            await patchById('bank_transactions', row.source_document_id, { balance_after: runningBalance });
            recomputedTransactions += 1;
        }
    }

    if (money(account.current_balance) !== runningBalance) {
        await patchById('bank_accounts', target, { current_balance: runningBalance });
        account.current_balance = runningBalance;
    }

    const summary = {
        account: target,
        deletedAdjustments: adjustmentRows.map(row => ({
            id: row.source_document_id,
            type: row.type,
            amount: money(row.amount),
            description: row.description,
        })),
        recomputedTransactions,
        initialBalance: money(account.initial_balance),
        currentBalance: runningBalance,
    };

    const orphanJournalsRemoved = await sweepOrphanAccountJournals();
    if (orphanJournalsRemoved > 0) {
        summary.removedOrphanAccountJournals = orphanJournalsRemoved;
    }

    if (pruneTestArtifacts) {
        const testAccounts = await fetchAll('bank_accounts', '&bank_name=eq.TEST');
        for (const testAccount of testAccounts) {
            const testTransactions = await fetchAll('bank_transactions', `&bank_account_ref=eq.${encodeURIComponent(testAccount.source_document_id)}`);
            for (const row of testTransactions) {
                await deleteById('bank_transactions', row.source_document_id);
            }
            await cleanupAccountJournals(testAccount.source_document_id);
            await deleteById('bank_accounts', testAccount.source_document_id);
        }
        summary.removedTestAccounts = testAccounts.map(account => account.source_document_id);
    }

    console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});