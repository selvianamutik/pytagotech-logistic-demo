import { loadScriptEnv } from './_env';

loadScriptEnv();

import {
    getAllDocuments,
    listDocumentsByFilter,
    deleteDocument,
} from '../src/lib/repositories/document-store';
import type { Expense, JournalEntry, BankTransaction } from '../src/lib/types';
import { recomputeBankLedgerBalancesForAccounts } from '../src/lib/api/bank-balance-helpers';

async function main() {
    const expenses = await getAllDocuments<Expense>('expense');
    const journalEntries = await getAllDocuments<JournalEntry>('journalEntry');
    const journalBySource = new Map<string, JournalEntry>();
    for (const entry of journalEntries) {
        if (entry.sourceType === 'EXPENSE' && entry.status !== 'VOID') {
            journalBySource.set(entry.sourceRef, entry);
        }
    }

    const orphans = expenses.filter(expense => (
        expense.date >= '2026-09-01' &&
        !journalBySource.has(expense._id) &&
        expense.amount === 1234567 &&
        expense.note === 'TEST aja' &&
        expense.bankAccountRef === 'bank-jatim-001' &&
        expense.date === '2026-09-15'
    ));

    console.log(`orphan duplicates to delete: ${orphans.length}`);

    const affectedAccountRefs = new Set<string>();
    let deletedBankTransactions = 0;
    for (const expense of orphans) {
        const bankTransactions = await listDocumentsByFilter<BankTransaction>(
            'bankTransaction',
            { relatedExpenseRef: expense._id }
        );
        for (const transaction of bankTransactions) {
            if (transaction.bankAccountRef) {
                affectedAccountRefs.add(transaction.bankAccountRef);
            }
            await deleteDocument(transaction._id, 'bankTransaction');
            deletedBankTransactions += 1;
        }
        await deleteDocument(expense._id, 'expense');
        console.log(`deleted expense ${expense._id}`);
    }

    console.log(`deleted bank transactions: ${deletedBankTransactions}`);

    if (affectedAccountRefs.size > 0) {
        await recomputeBankLedgerBalancesForAccounts([...affectedAccountRefs]);
        console.log(`recomputed accounts: ${[...affectedAccountRefs].join(', ')}`);
    }

    const freshExpenses = await getAllDocuments<Expense>('expense');
    const deletedIds = new Set(orphans.map(orphan => orphan._id));
    const stillPresent = freshExpenses.filter(expense => deletedIds.has(expense._id));
    console.log(`orphans still present (re-fetched): ${stillPresent.length}`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});