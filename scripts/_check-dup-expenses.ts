import { loadScriptEnv } from './_env';

loadScriptEnv();

import { getAllDocuments } from '../src/lib/repositories/document-store';
import type { Expense, JournalEntry } from '../src/lib/types';

async function main() {
    const expenses = await getAllDocuments<Expense>('expense');
    const journalEntries = await getAllDocuments<JournalEntry>('journalEntry');
    const journalBySource = new Map<string, JournalEntry>();
    for (const entry of journalEntries) {
        if (entry.sourceType === 'EXPENSE' && entry.status !== 'VOID') {
            journalBySource.set(entry.sourceRef, entry);
        }
    }

    const recent = expenses
        .filter(expense => expense.date >= '2026-09-01')
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    console.log(`expenses since 2026-09-01: ${recent.length}`);
    for (const expense of recent) {
        const journal = journalBySource.get(expense._id);
        console.log(JSON.stringify({
            _id: expense._id,
            createdAt: expense.createdAt,
            amount: expense.amount,
            note: expense.note,
            hasJournal: Boolean(journal),
            journalId: journal?._id || null,
            journalNumber: journal?.entryNumber || null,
        }));
    }

    const sameKey = recent.every(expense => (
        expense.amount === recent[0].amount &&
        expense.note === recent[0].note &&
        expense.bankAccountRef === recent[0].bankAccountRef &&
        expense.date === recent[0].date
    ));
    console.log(`all recent rows share identical amount/note/bank/date: ${sameKey}`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});