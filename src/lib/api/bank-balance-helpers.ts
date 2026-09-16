/**
 * Bank Balance Helpers - Reusable functions for bank balance recomputation
 *
 * Ensures bank balance consistency across all financial operations by using
 * a standardized recompute pattern instead of manual read-then-write.
 */

import {
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { readLedgerBalance } from './data-helpers';
import type { BankAccount, BankTransaction } from '@/lib/types';

/**
 * Normalize a currency amount to non-negative whole number.
 * Used for transaction amounts which should always be positive.
 */
function normalizeWholeMoneyAmount(value: unknown): number {
    const normalized = typeof value === 'number'
        ? value
        : typeof value === 'string' ? parseFormattedNumberish(value, { maxFractionDigits: 0 }) : 0;
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return 0;
    }
    return Math.round(normalized);
}

/**
 * Compute bank transaction delta (positive for CREDIT/TRANSFER_IN, negative for DEBIT/TRANSFER_OUT)
 */
function bankTransactionDelta(transaction: Pick<BankTransaction, 'type' | 'amount'>): number {
    const amount = normalizeWholeMoneyAmount(transaction.amount);
    return transaction.type === 'DEBIT' || transaction.type === 'TRANSFER_OUT' || transaction.type === 'ADJUSTMENT_DEBIT'
        ? -amount
        : amount;
}

/**
 * Create deterministic ordering key for transactions
 * Uses date + createdAt + _id for stable sort across recomputes
 */
export function bankTransactionOrderKey(transaction: Pick<BankTransaction, '_id' | '_createdAt' | 'date'>) {
    return `${transaction.date || ''} ${transaction._createdAt || ''} ${transaction._id}`;
}

/**
 * Recompute bank ledger balances for specified accounts from scratch.
 *
 * This function recalculates balance by summing all transactions chronologically,
 * ensuring no drift accumulates from manual read-then-write operations.
 *
 * PERF: Optimized to fetch only needed accounts and filter transactions.
 *
 * @param accountRefs - Array of bank account IDs to recompute
 */
export async function recomputeBankLedgerBalancesForAccounts(accountRefs: Array<string | null | undefined>) {
    const refs = [...new Set(accountRefs.filter((value): value is string => Boolean(value)))];
    if (refs.length === 0) return;

    // PERF: Fetch only the specific accounts we need, not all accounts
    const accounts = await Promise.all(refs.map(ref => getDocumentById<BankAccount>(ref, 'bankAccount')));
    const validAccounts = accounts.filter((acc): acc is BankAccount => acc !== null);
    const accountById = new Map(validAccounts.map(account => [account._id, account]));

    if (validAccounts.length === 0) return;

    // PERF: Fetch transactions only for the accounts we're recomputing
    // Use batch queries per account to limit data fetched
    const allTransactions: BankTransaction[] = [];
    for (const ref of refs) {
        const accountTxs = await listDocumentsByFilter<BankTransaction>('bankTransaction', {
            bankAccountRef: ref,
        });
        allTransactions.push(...accountTxs);
    }

    for (const accountRef of refs) {
        const account = accountById.get(accountRef);
        if (!account) continue;

        let runningBalance = readLedgerBalance(account.initialBalance);
        const accountTransactions = allTransactions
            .filter(transaction => transaction.bankAccountRef === accountRef)
            .sort((left, right) => bankTransactionOrderKey(left).localeCompare(bankTransactionOrderKey(right)));

        for (const transaction of accountTransactions) {
            runningBalance += bankTransactionDelta(transaction);
            if ((transaction.balanceAfter ?? 0) !== runningBalance) {
                await updateDocument(transaction._id, { balanceAfter: runningBalance }, 'bankTransaction');
            }
        }

        if (readLedgerBalance(account.currentBalance) !== runningBalance) {
            await updateDocument(accountRef, { currentBalance: runningBalance }, 'bankAccount');
        }
    }
}