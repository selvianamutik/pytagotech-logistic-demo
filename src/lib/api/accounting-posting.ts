import {
    DEFAULT_CHART_OF_ACCOUNTS,
    buildDefaultChartOfAccountDocument,
    formatJournalNumber,
    normalizeLedgerAmount,
    type AccountingSystemKey,
} from '@/lib/accounting';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    createDocument,
    getAllDocuments,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { clearRelationalReadCache } from '@/lib/supabase-relational';
import type {
    AccountingAccountType,
    BankAccount,
    ChartOfAccount,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    Expense,
    FreightNota,
    Invoice,
    InvoiceAdjustment,
    JournalEntry,
    JournalLine,
    Payment,
    Purchase,
    PurchasePayment,
    StockMovement,
} from '@/lib/types';

import type { ApiSession, BankAccountSummary } from './data-helpers';

type JournalLineInput = {
    account: AccountingSystemKey;
    debit?: number;
    credit?: number;
    memo?: string;
    entityRef?: string;
    entityType?: string;
};

type JournalInput = {
    entryDate: string;
    memo: string;
    sourceType: string;
    sourceRef: string;
    sourceEvent: string;
    sourceNumber?: string;
    sourceLabel?: string;
    lines: JournalLineInput[];
};

type ResolvedJournalLineInput = JournalLineInput & {
    debit: number;
    credit: number;
    accountDocument: ChartOfAccount;
};

type ReceiptAllocationPosting = {
    invoiceRef: string;
    amount: number;
    label?: string;
};

type DriverVoucherPosting = {
    _id: string;
    bonNumber?: string;
    issuedDate?: string;
    settledDate?: string;
    totalIssuedAmount?: number;
    initialCashGiven?: number;
    cashGiven?: number;
    driverFeeAmount?: number;
    totalSpent?: number;
    balance?: number;
    issueBankRef?: string;
    issueBankName?: string;
    settlementBankRef?: string;
    settlementBankName?: string;
};

type BankAccountOpeningPosting = Pick<
    BankAccount,
    '_id' | 'bankName' | 'accountNumber' | 'accountType' | 'systemKey' | 'initialBalance'
>;

let defaultAccountsEnsured = false;
let accountCacheBySystemKey: Map<AccountingSystemKey, ChartOfAccount> | null = null;

function isMissingAccountingStorageError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /chart_of_accounts|journal_entries|journal_lines|accounting_periods|Unsupported relational document type|Failed to create relational document/i.test(message);
}

function cleanLineAmount(value: unknown) {
    return Math.max(normalizeLedgerAmount(value), 0);
}

function resolveDriverVoucherIssuedAmount(voucher: DriverVoucherPosting, totalExpense: number, balance: number) {
    const explicitIssuedAmount = cleanLineAmount(
        voucher.totalIssuedAmount ?? voucher.cashGiven ?? voucher.initialCashGiven
    );
    if (explicitIssuedAmount > 0) {
        return explicitIssuedAmount;
    }

    return cleanLineAmount(totalExpense + balance);
}

function resolveCashBankAccount(bankAccount?: Pick<BankAccount, 'accountType' | 'systemKey'> | BankAccountSummary | null): AccountingSystemKey {
    const accountType = typeof bankAccount?.accountType === 'string' ? bankAccount.accountType : '';
    const systemKey = typeof bankAccount?.systemKey === 'string' ? bankAccount.systemKey : '';
    return accountType === 'CASH' || systemKey === 'cash' || systemKey === 'cash_on_hand'
        ? 'cash_on_hand'
        : 'bank';
}

function isAccountingSystemKey(value: unknown): value is AccountingSystemKey {
    return typeof value === 'string' && DEFAULT_CHART_OF_ACCOUNTS.some(account => account.systemKey === value);
}

function resolveExpenseAccount(expense: Pick<Expense, 'categoryName' | 'accountSystemKey' | 'relatedIncidentRef' | 'relatedMaintenanceRef' | 'voucherRef' | 'boronganRef'>): AccountingSystemKey {
    if (isAccountingSystemKey(expense.accountSystemKey)) {
        return expense.accountSystemKey;
    }
    const category = String(expense.categoryName || '').toLowerCase();
    if (expense.relatedIncidentRef || /insiden|kecelakaan|santunan|towing|evakuasi|darurat|mogok|klaim kerusakan/.test(category)) return 'incident_expense';
    if (expense.relatedMaintenanceRef || /maintenance|servis|service|oli|ban|sparepart/.test(category)) return 'maintenance_expense';
    if (expense.boronganRef || /borongan|upah supir|upah driver/.test(category)) return 'driver_fee_expense';
    if (expense.voucherRef || /uang jalan|trip|solar|tol|parkir|makan|konsumsi|menginap|bongkar/.test(category)) return 'trip_misc_expense';
    return 'operational_expense';
}

async function ensureDefaultAccounts() {
    if (defaultAccountsEnsured && accountCacheBySystemKey) {
        return accountCacheBySystemKey;
    }

    let existing = await getAllDocuments<ChartOfAccount>('chartOfAccount');
    let bySystemKey = new Map(existing.map(account => [account.systemKey, account]));
    let didCreateMissingAccount = false;

    for (const definition of DEFAULT_CHART_OF_ACCOUNTS) {
        const current = bySystemKey.get(definition.systemKey);
        if (current?._id) continue;
        await createDocument(buildDefaultChartOfAccountDocument(definition) as unknown as { _type: string; [key: string]: unknown });
        didCreateMissingAccount = true;
    }

    if (didCreateMissingAccount) {
        existing = await getAllDocuments<ChartOfAccount>('chartOfAccount');
        bySystemKey = new Map(existing.map(account => [account.systemKey, account]));
    }

    accountCacheBySystemKey = bySystemKey as Map<AccountingSystemKey, ChartOfAccount>;
    defaultAccountsEnsured = true;
    return accountCacheBySystemKey;
}

async function resolveAccount(systemKey: AccountingSystemKey) {
    const accountsBySystemKey = await ensureDefaultAccounts();
    const account = accountsBySystemKey.get(systemKey) || null;
    if (!account || account.active === false) {
        throw new Error(`Akun ${systemKey} tidak tersedia atau nonaktif`);
    }
    return account;
}

/**
 * Build journal number after collision - starts from lastAttemptedSequence + 1
 * to avoid reusing a number that just caused a collision.
 */
async function buildJournalNumberAfterCollision(entryDate: string, lastAttemptedSequence: number) {
    const monthPrefix = entryDate.replace(/-/g, '').slice(0, 6);
    const monthStart = `${monthPrefix.slice(0, 4)}-${monthPrefix.slice(4, 6)}-01`;
    const lastDay = new Date(Number(monthPrefix.slice(0, 4)), Number(monthPrefix.slice(4, 6)), 0).getDate();
    const monthEnd = `${monthPrefix.slice(0, 4)}-${monthPrefix.slice(4, 6)}-${String(lastDay).padStart(2, '0')}`;
    const monthEntries = await listDocumentsByFilter<JournalEntry>('journalEntry', {
        entryDate__gte: monthStart,
        entryDate__lte: monthEnd,
    });
    const maxSequence = monthEntries.reduce((max, entry) => {
        const entryNumber = typeof entry.entryNumber === 'string' ? entry.entryNumber : '';
        if (!entryNumber.startsWith(`JRN-${monthPrefix}-`)) return max;
        const sequence = Number.parseInt(entryNumber.slice(`JRN-${monthPrefix}-`.length), 10);
        return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 0);
    // After collision, MUST start from max+1 to avoid stale reads
    return formatJournalNumber(entryDate, Math.max(maxSequence + 1, lastAttemptedSequence + 1));
}

async function buildJournalNumber(entryDate: string, existing?: JournalEntry | null) {
    if (existing?.entryNumber) return existing.entryNumber;
    return buildJournalNumberAfterCollision(entryDate, 0);
}

function isDuplicateJournalNumberError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /entry_number|journal_entries_entry_number|duplicate key|unique constraint|23505/i.test(message);
}

async function createJournalEntryWithRetry(entryDoc: JournalEntry, entryDate: string) {
    let lastError: unknown = null;
    let lastAttemptedSequence = 0;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        // After collision, rebuild from collision point to avoid stale reads
        const entryNumber = attempt === 0
            ? await buildJournalNumber(entryDate)
            : await buildJournalNumberAfterCollision(entryDate, lastAttemptedSequence);

        // Track sequence for next retry
        const match = entryNumber.match(/JRN-\d{6}-(\d+)/);
        lastAttemptedSequence = match ? Number.parseInt(match[1], 10) : lastAttemptedSequence + 1;

        const nextEntry = {
            ...entryDoc,
            entryNumber,
        };
        try {
            await createDocument(nextEntry as unknown as { _type: string; [key: string]: unknown });
            return nextEntry;
        } catch (error) {
            lastError = error;
            if (!isDuplicateJournalNumberError(error)) {
                throw error;
            }
            clearRelationalReadCache();
            // After collision, rebuild number from current max to avoid stale reads
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('Gagal membuat nomor jurnal yang unik');
}

function resolveExpenseEntity(expense: Expense) {
    if (expense.relatedVehicleRef) return { entityRef: expense.relatedVehicleRef, entityType: 'vehicle' };
    if (expense.voucherRef) return { entityRef: expense.voucherRef, entityType: 'driverVoucher' };
    if (expense.relatedIncidentRef) return { entityRef: expense.relatedIncidentRef, entityType: 'incident' };
    if (expense.relatedMaintenanceRef) return { entityRef: expense.relatedMaintenanceRef, entityType: 'maintenance' };
    if (expense.boronganRef) return { entityRef: expense.boronganRef, entityType: 'driverBorongan' };
    if (expense.relatedDeliveryOrderRef) return { entityRef: expense.relatedDeliveryOrderRef, entityType: 'deliveryOrder' };
    return { entityRef: undefined, entityType: undefined };
}

function sameOptionalText(left: unknown, right: unknown) {
    return String(left || '') === String(right || '');
}

function isSamePostedJournal(
    existing: JournalEntry,
    existingLines: JournalLine[],
    input: JournalInput,
    resolvedLines: ResolvedJournalLineInput[],
    totalDebit: number,
    totalCredit: number,
) {
    if (
        existing.entryDate !== input.entryDate ||
        existing.memo !== input.memo ||
        !sameOptionalText(existing.sourceNumber, input.sourceNumber) ||
        !sameOptionalText(existing.sourceLabel, input.sourceLabel) ||
        cleanLineAmount(existing.totalDebit) !== totalDebit ||
        cleanLineAmount(existing.totalCredit) !== totalCredit
    ) {
        return false;
    }

    const sortedExistingLines = [...existingLines].sort((left, right) => {
        const leftLine = Number(left.lineNumber || 0);
        const rightLine = Number(right.lineNumber || 0);
        return leftLine - rightLine;
    });
    if (sortedExistingLines.length !== resolvedLines.length) return false;

    return resolvedLines.every((line, index) => {
        const existingLine = sortedExistingLines[index];
        return (
            existingLine.accountRef === line.accountDocument._id &&
            cleanLineAmount(existingLine.debit) === line.debit &&
            cleanLineAmount(existingLine.credit) === line.credit &&
            sameOptionalText(existingLine.memo, line.memo) &&
            sameOptionalText(existingLine.entityRef, line.entityRef) &&
            sameOptionalText(existingLine.entityType, line.entityType)
        );
    });
}

export async function postJournalEntry(
    session: Pick<ApiSession, '_id' | 'name'>,
    input: JournalInput,
) {
    try {
        const normalizedLines = input.lines
            .map(line => ({
                ...line,
                debit: cleanLineAmount(line.debit),
                credit: cleanLineAmount(line.credit),
            }))
            .filter(line => line.debit > 0 || line.credit > 0);

        if (normalizedLines.length === 0) return null;

        const totalDebit = normalizedLines.reduce((sum, line) => sum + line.debit, 0);
        const totalCredit = normalizedLines.reduce((sum, line) => sum + line.credit, 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
            throw new Error(`Jurnal tidak balance: debit ${totalDebit}, kredit ${totalCredit}`);
        }

        const accountCache = new Map<AccountingSystemKey, ChartOfAccount>();
        const resolvedLines: ResolvedJournalLineInput[] = [];
        for (const line of normalizedLines) {
            let account = accountCache.get(line.account);
            if (!account) {
                account = await resolveAccount(line.account);
                accountCache.set(line.account, account);
            }
            resolvedLines.push({ ...line, accountDocument: account });
        }

        const sourceEntries = await listDocumentsByFilter<JournalEntry>('journalEntry', {
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            sourceEvent: input.sourceEvent,
        });
        const activeEntries = sourceEntries.filter(entry => entry.status !== 'VOID');
        const activeExisting = activeEntries[0] || null;
        if (activeExisting) {
            const existingLines = await listDocumentsByFilter<JournalLine>('journalLine', {
                journalEntryRef: activeExisting._id,
            });
            if (
                activeEntries.length === 1 &&
                isSamePostedJournal(activeExisting, existingLines, input, resolvedLines, totalDebit, totalCredit)
            ) {
                return activeExisting;
            }
            await Promise.all(activeEntries.map(entry => updateDocument(entry._id, {
                status: 'VOID',
                voidedAt: new Date().toISOString(),
                voidedBy: session._id,
                voidedByName: session.name,
            }, 'journalEntry')));
        }

        const entryId = `journal-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const entryDoc: JournalEntry = {
            _id: entryId,
            _type: 'journalEntry',
            entryNumber: '',
            entryDate: input.entryDate,
            memo: input.memo,
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            sourceEvent: input.sourceEvent,
            sourceNumber: input.sourceNumber,
            sourceLabel: input.sourceLabel,
            status: 'POSTED',
            totalDebit,
            totalCredit,
            postedAt: now,
            postedBy: session._id,
            postedByName: session.name,
        };

        const createdEntry = await createJournalEntryWithRetry(entryDoc, input.entryDate);

        for (const [index, line] of resolvedLines.entries()) {
            const account = line.accountDocument;
            const lineDoc: JournalLine = {
                _id: `journal-line-${crypto.randomUUID()}`,
                _type: 'journalLine',
                journalEntryRef: entryId,
                lineNumber: index + 1,
                accountRef: account._id,
                accountCode: account.code,
                accountName: account.name,
                accountType: account.accountType as AccountingAccountType,
                debit: line.debit,
                credit: line.credit,
                memo: line.memo,
                entityRef: line.entityRef,
                entityType: line.entityType,
            };
            await createDocument(lineDoc as unknown as { _type: string; [key: string]: unknown });
        }

        return createdEntry;
    } catch (error) {
        if (isMissingAccountingStorageError(error)) {
            console.warn('[accounting] jurnal dilewati karena tabel akuntansi belum tersedia', error);
            return null;
        }
        throw error;
    }
}

export async function voidJournalEntryForSource(
    session: Pick<ApiSession, '_id' | 'name'>,
    sourceType: string,
    sourceRef: string,
    sourceEvent: string,
) {
    try {
        const existing = (await listDocumentsByFilter<JournalEntry>('journalEntry', {
            sourceType,
            sourceRef,
            sourceEvent,
        })).filter(entry => entry.status !== 'VOID');
        if (existing.length === 0) return;
        await Promise.all(existing.map(entry => updateDocument(entry._id, {
            status: 'VOID',
            voidedAt: new Date().toISOString(),
            voidedBy: session._id,
            voidedByName: session.name,
        }, 'journalEntry')));
    } catch (error) {
        if (isMissingAccountingStorageError(error)) return;
        throw error;
    }
}

export async function postFreightNotaIssueJournal(session: Pick<ApiSession, '_id' | 'name'>, nota: FreightNota) {
    const grossAmount = cleanLineAmount(nota.totalAmount);
    await postJournalEntry(session, {
        entryDate: nota.issueDate,
        memo: `Invoice ongkos ${nota.notaDisplayNumber || nota.notaNumber}`,
        sourceType: 'FREIGHT_NOTA',
        sourceRef: nota._id,
        sourceEvent: 'ISSUE',
        sourceNumber: nota.notaNumber,
        sourceLabel: nota.customerName,
        lines: [
            { account: 'accounts_receivable', debit: grossAmount, entityRef: nota.customerRef, entityType: 'customer' },
            { account: 'freight_revenue', credit: grossAmount, entityRef: nota._id, entityType: 'freightNota' },
        ],
    });
    const pph23Amount = cleanLineAmount(nota.pph23Amount);
    if (pph23Amount > 0) {
        await postJournalEntry(session, {
            entryDate: nota.issueDate,
            memo: `PPh 23 dipotong invoice ${nota.notaDisplayNumber || nota.notaNumber}`,
            sourceType: 'FREIGHT_NOTA',
            sourceRef: nota._id,
            sourceEvent: 'PPH23',
            sourceNumber: nota.notaNumber,
            sourceLabel: nota.customerName,
            lines: [
                { account: 'prepaid_pph23', debit: pph23Amount, entityRef: nota._id, entityType: 'freightNota' },
                { account: 'accounts_receivable', credit: pph23Amount, entityRef: nota.customerRef, entityType: 'customer' },
            ],
        });
    } else {
        await voidJournalEntryForSource(session, 'FREIGHT_NOTA', nota._id, 'PPH23');
    }
}

export async function postLegacyInvoiceIssueJournal(session: Pick<ApiSession, '_id' | 'name'>, invoice: Invoice) {
    const grossAmount = cleanLineAmount(invoice.totalAmount);
    await postJournalEntry(session, {
        entryDate: invoice.issueDate,
        memo: `Invoice legacy ${invoice.invoiceNumber}`,
        sourceType: 'INVOICE',
        sourceRef: invoice._id,
        sourceEvent: 'ISSUE',
        sourceNumber: invoice.invoiceNumber,
        sourceLabel: invoice.customerName,
        lines: [
            { account: 'accounts_receivable', debit: grossAmount, entityRef: invoice.customerRef, entityType: 'customer' },
            { account: 'freight_revenue', credit: grossAmount, entityRef: invoice._id, entityType: 'invoice' },
        ],
    });
    const pph23Amount = cleanLineAmount(invoice.pph23Amount);
    if (pph23Amount > 0) {
        await postJournalEntry(session, {
            entryDate: invoice.issueDate,
            memo: `PPh 23 dipotong invoice legacy ${invoice.invoiceNumber}`,
            sourceType: 'INVOICE',
            sourceRef: invoice._id,
            sourceEvent: 'PPH23',
            sourceNumber: invoice.invoiceNumber,
            sourceLabel: invoice.customerName,
            lines: [
                { account: 'prepaid_pph23', debit: pph23Amount, entityRef: invoice._id, entityType: 'invoice' },
                { account: 'accounts_receivable', credit: pph23Amount, entityRef: invoice.customerRef, entityType: 'customer' },
            ],
        });
    } else {
        await voidJournalEntryForSource(session, 'INVOICE', invoice._id, 'PPH23');
    }
}

export async function postPaymentJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    payment: Payment,
    bankAccount?: BankAccountSummary | null,
    sourceLabel?: string,
) {
    const amount = cleanLineAmount(payment.amount);
    await postJournalEntry(session, {
        entryDate: payment.date,
        memo: `Pembayaran invoice ${sourceLabel || payment.invoiceRef}`,
        sourceType: 'PAYMENT',
        sourceRef: payment._id,
        sourceEvent: 'RECEIVE',
        sourceNumber: payment.receiptNumber,
        sourceLabel,
        lines: [
            { account: resolveCashBankAccount(bankAccount), debit: amount, entityRef: payment.bankAccountRef, entityType: 'bankAccount' },
            { account: 'accounts_receivable', credit: amount, entityRef: payment.invoiceRef, entityType: 'invoice' },
        ],
    });
}

export async function postCustomerReceiptJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    receipt: CustomerReceipt,
    bankAccount: BankAccountSummary | null | undefined,
    allocations: ReceiptAllocationPosting[],
) {
    const totalAmount = cleanLineAmount(receipt.totalAmount);
    await postJournalEntry(session, {
        entryDate: receipt.date,
        memo: `Penerimaan customer ${receipt.receiptNumber}`,
        sourceType: 'CUSTOMER_RECEIPT',
        sourceRef: receipt._id,
        sourceEvent: 'RECEIVE',
        sourceNumber: receipt.receiptNumber,
        sourceLabel: receipt.customerName,
        lines: [
            { account: resolveCashBankAccount(bankAccount), debit: totalAmount, entityRef: receipt.bankAccountRef, entityType: 'bankAccount' },
            { account: 'customer_deposit', credit: totalAmount, entityRef: receipt.customerRef, entityType: 'customer' },
        ],
    });

    for (const allocation of allocations) {
        const amount = cleanLineAmount(allocation.amount);
        await postJournalEntry(session, {
            entryDate: receipt.date,
            memo: `Alokasi penerimaan ${receipt.receiptNumber} ke invoice ${allocation.label || allocation.invoiceRef}`,
            sourceType: 'CUSTOMER_RECEIPT',
            sourceRef: `${receipt._id}:${allocation.invoiceRef}`,
            sourceEvent: 'ALLOCATE',
            sourceNumber: receipt.receiptNumber,
            sourceLabel: allocation.label,
            lines: [
                { account: 'customer_deposit', debit: amount, entityRef: receipt.customerRef, entityType: 'customer' },
                { account: 'accounts_receivable', credit: amount, entityRef: allocation.invoiceRef, entityType: 'invoice' },
            ],
        });
    }
}

export async function postInvoiceAdjustmentJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    adjustment: InvoiceAdjustment,
    label?: string,
) {
    const amount = cleanLineAmount(adjustment.amount);
    await postJournalEntry(session, {
        entryDate: adjustment.date,
        memo: `Klaim/potongan invoice ${label || adjustment.invoiceRef}`,
        sourceType: 'INVOICE_ADJUSTMENT',
        sourceRef: adjustment._id,
        sourceEvent: 'APPROVE',
        sourceLabel: label || adjustment.customerName,
        lines: [
            { account: 'sales_deduction', debit: amount, entityRef: adjustment.invoiceRef, entityType: 'invoice' },
            { account: 'accounts_receivable', credit: amount, entityRef: adjustment.customerRef, entityType: 'customer' },
        ],
    });
}

export async function postCustomerOverpaymentRefundJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    refund: CustomerOverpaymentRefund,
    bankAccount?: BankAccountSummary | null,
) {
    const amount = cleanLineAmount(refund.amount);
    await postJournalEntry(session, {
        entryDate: refund.date,
        memo: `Refund kelebihan bayar customer ${refund.customerName || ''}`.trim(),
        sourceType: 'CUSTOMER_OVERPAYMENT_REFUND',
        sourceRef: refund._id,
        sourceEvent: 'REFUND',
        sourceNumber: refund.sourceReceiptNumber || refund.sourceInvoiceNumber,
        sourceLabel: refund.customerName,
        lines: [
            { account: 'customer_deposit', debit: amount, entityRef: refund.customerRef, entityType: 'customer' },
            { account: resolveCashBankAccount(bankAccount), credit: amount, entityRef: refund.bankAccountRef, entityType: 'bankAccount' },
        ],
    });
}

export async function postExpenseJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    expense: Expense,
    bankAccount?: BankAccountSummary | null,
) {
    const amount = cleanLineAmount(expense.amount);
    const expenseEntity = resolveExpenseEntity(expense);
    await postJournalEntry(session, {
        entryDate: expense.date,
        memo: expense.description || expense.note || `Pengeluaran ${expense.categoryName || ''}`.trim(),
        sourceType: 'EXPENSE',
        sourceRef: expense._id,
        sourceEvent: 'CREATE',
        sourceLabel: expense.categoryName,
        lines: [
            {
                account: resolveExpenseAccount(expense),
                debit: amount,
                entityRef: expenseEntity.entityRef,
                entityType: expenseEntity.entityType,
            },
            {
                account: bankAccount ? resolveCashBankAccount(bankAccount) : 'accrued_expense',
                credit: amount,
                entityRef: expense.bankAccountRef,
                entityType: bankAccount ? 'bankAccount' : undefined,
            },
        ],
    });
}

export async function postBankTransferJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    input: {
        transferId: string;
        date: string;
        amount: number;
        fromAccount: BankAccountSummary;
        toAccount: BankAccountSummary;
    },
) {
    const amount = cleanLineAmount(input.amount);
    await postJournalEntry(session, {
        entryDate: input.date,
        memo: `Transfer ${input.fromAccount.bankName} ke ${input.toAccount.bankName}`,
        sourceType: 'BANK_TRANSFER',
        sourceRef: input.transferId,
        sourceEvent: 'TRANSFER',
        sourceLabel: `${input.fromAccount.bankName} -> ${input.toAccount.bankName}`,
        lines: [
            { account: resolveCashBankAccount(input.toAccount), debit: amount, entityRef: input.toAccount._id, entityType: 'bankAccount' },
            { account: resolveCashBankAccount(input.fromAccount), credit: amount, entityRef: input.fromAccount._id, entityType: 'bankAccount' },
        ],
    });
}

export async function postBankAccountOpeningBalanceJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    bankAccount: BankAccountOpeningPosting,
    entryDate = getBusinessDateValue(),
) {
    const amount = cleanLineAmount(bankAccount.initialBalance);
    if (amount <= 0) {
        await voidJournalEntryForSource(session, 'BANK_ACCOUNT', bankAccount._id, 'OPENING_BALANCE');
        return;
    }

    const accountLabel = [bankAccount.bankName, bankAccount.accountNumber].filter(Boolean).join(' - ');
    await postJournalEntry(session, {
        entryDate,
        memo: `Saldo awal ${accountLabel || bankAccount._id}`,
        sourceType: 'BANK_ACCOUNT',
        sourceRef: bankAccount._id,
        sourceEvent: 'OPENING_BALANCE',
        sourceNumber: bankAccount.accountNumber,
        sourceLabel: bankAccount.bankName,
        lines: [
            {
                account: resolveCashBankAccount(bankAccount),
                debit: amount,
                entityRef: bankAccount._id,
                entityType: 'bankAccount',
            },
            {
                account: 'equity_capital',
                credit: amount,
                entityRef: bankAccount._id,
                entityType: 'bankAccount',
            },
        ],
    });
}

export async function postPurchaseReceiptJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    purchase: Pick<Purchase, '_id' | 'purchaseNumber' | 'supplierRef' | 'supplierName'>,
    receiptDate: string,
    receivedValue: number,
    receiptBatchRef?: string,
) {
    const amount = cleanLineAmount(receivedValue);
    const batchRef = receiptBatchRef || `${purchase._id}:${receiptDate}`;
    await postJournalEntry(session, {
        entryDate: receiptDate,
        memo: `Penerimaan barang pembelian ${purchase.purchaseNumber}`,
        sourceType: 'PURCHASE',
        sourceRef: batchRef,
        sourceEvent: 'RECEIVE',
        sourceNumber: purchase.purchaseNumber,
        sourceLabel: purchase.supplierName,
        lines: [
            { account: 'inventory', debit: amount, entityRef: purchase._id, entityType: 'purchase' },
            { account: 'accounts_payable', credit: amount, entityRef: purchase.supplierRef, entityType: 'supplier' },
        ],
    });
}

export async function postPurchasePaymentJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    payment: PurchasePayment,
    bankAccount: BankAccountSummary,
) {
    const amount = cleanLineAmount(payment.amount);
    await postJournalEntry(session, {
        entryDate: payment.date,
        memo: `Pembayaran supplier ${payment.purchaseNumber || payment.purchaseRef}`,
        sourceType: 'PURCHASE_PAYMENT',
        sourceRef: payment._id,
        sourceEvent: 'PAY',
        sourceNumber: payment.purchaseNumber,
        sourceLabel: payment.supplierName,
        lines: [
            { account: 'accounts_payable', debit: amount, entityRef: payment.supplierRef, entityType: 'supplier' },
            { account: resolveCashBankAccount(bankAccount), credit: amount, entityRef: payment.bankAccountRef, entityType: 'bankAccount' },
        ],
    });
}

export async function postStockMovementJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    movement: StockMovement,
    unitValue: number,
) {
    const stockMovementEvents = ['MANUAL_IN', 'MANUAL_OUT', 'STOCK_OPENING', 'MAINTENANCE_USAGE'];
    await Promise.all(
        stockMovementEvents
            .filter(event => event !== movement.sourceType)
            .map(event => voidJournalEntryForSource(session, 'STOCK_MOVEMENT', movement._id, event))
    );

    const shouldPostInventoryUsage =
        movement.sourceType === 'MANUAL_IN' ||
        movement.sourceType === 'MANUAL_OUT' ||
        movement.sourceType === 'STOCK_OPENING' ||
        movement.sourceType === 'MAINTENANCE_USAGE';
    if (!shouldPostInventoryUsage) {
        await voidJournalEntryForSource(session, 'STOCK_MOVEMENT', movement._id, movement.sourceType);
        return;
    }
    const snapshotSubtotal = cleanLineAmount(movement.subtotalCost);
    const amount = snapshotSubtotal > 0
        ? snapshotSubtotal
        : cleanLineAmount(unitValue * cleanLineAmount(movement.quantity));
    if (amount <= 0) return;

    const isStockIn =
        movement.type === 'IN' &&
        (movement.sourceType === 'MANUAL_IN' || movement.sourceType === 'STOCK_OPENING');
    await postJournalEntry(session, {
        entryDate: movement.movementDate,
        memo: `${isStockIn
            ? movement.sourceType === 'STOCK_OPENING'
                ? `Stok awal ${movement.itemName || movement.itemCode || movement._id}`
                : `Penyesuaian stok masuk ${movement.itemName || movement.itemCode || movement._id}`
            : `Pemakaian stok keluar ${movement.itemName || movement.itemCode || movement._id}`}`,
        sourceType: 'STOCK_MOVEMENT',
        sourceRef: movement._id,
        sourceEvent: movement.sourceType,
        sourceNumber: movement.itemCode,
        sourceLabel: movement.itemName,
        lines: isStockIn
            ? [
                { account: 'inventory', debit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
                { account: 'inventory_usage_expense', credit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
            ]
            : [
                { account: 'inventory_usage_expense', debit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
                { account: 'inventory', credit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
            ],
    });
}

export async function postDriverVoucherIssueJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    voucher: DriverVoucherPosting,
    bankAccount?: BankAccountSummary | null,
) {
    const amount = cleanLineAmount(voucher.cashGiven || voucher.initialCashGiven || voucher.totalIssuedAmount);
    await postJournalEntry(session, {
        entryDate: voucher.issuedDate || getBusinessDateValue(),
        memo: `Pencairan uang jalan ${voucher.bonNumber || voucher._id}`,
        sourceType: 'DRIVER_VOUCHER',
        sourceRef: voucher._id,
        sourceEvent: 'ISSUE',
        sourceNumber: voucher.bonNumber,
        sourceLabel: voucher.issueBankName,
        lines: [
            { account: 'driver_advance', debit: amount, entityRef: voucher._id, entityType: 'driverVoucher' },
            { account: resolveCashBankAccount(bankAccount), credit: amount, entityRef: voucher.issueBankRef, entityType: 'bankAccount' },
        ],
    });
}

export async function postDriverVoucherTopUpJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    input: {
        voucherId: string;
        bonNumber?: string;
        date: string;
        amount: number;
        disbursementId: string;
        bankAccount: BankAccountSummary;
    },
) {
    const amount = cleanLineAmount(input.amount);
    await postJournalEntry(session, {
        entryDate: input.date,
        memo: `Tambahan uang jalan ${input.bonNumber || input.voucherId}`,
        sourceType: 'DRIVER_VOUCHER_DISBURSEMENT',
        sourceRef: input.disbursementId,
        sourceEvent: 'TOP_UP',
        sourceNumber: input.bonNumber,
        lines: [
            { account: 'driver_advance', debit: amount, entityRef: input.voucherId, entityType: 'driverVoucher' },
            { account: resolveCashBankAccount(input.bankAccount), credit: amount, entityRef: input.bankAccount._id, entityType: 'bankAccount' },
        ],
    });
}

export async function postDriverVoucherSettlementJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    voucher: DriverVoucherPosting,
    settlementBank?: BankAccountSummary | null,
) {
    const tripMiscAmount = cleanLineAmount(voucher.totalSpent);
    const driverFeeAmount = cleanLineAmount(voucher.driverFeeAmount);
    const totalExpense = tripMiscAmount + driverFeeAmount;
    const balance = normalizeLedgerAmount(voucher.balance);
    const driverAdvanceCloseAmount = resolveDriverVoucherIssuedAmount(voucher, totalExpense, balance);
    const returnToCompanyAmount = Math.max(balance, 0);
    const additionalPaymentAmount = Math.max(-balance, 0);
    const lines: JournalLineInput[] = [];

    if (tripMiscAmount > 0) lines.push({ account: 'trip_misc_expense', debit: tripMiscAmount, entityRef: voucher._id, entityType: 'driverVoucher' });
    if (driverFeeAmount > 0) lines.push({ account: 'driver_fee_expense', debit: driverFeeAmount, entityRef: voucher._id, entityType: 'driverVoucher' });
    if (returnToCompanyAmount > 0) lines.push({ account: resolveCashBankAccount(settlementBank), debit: returnToCompanyAmount, entityRef: voucher.settlementBankRef, entityType: 'bankAccount' });
    if (driverAdvanceCloseAmount > 0) lines.push({ account: 'driver_advance', credit: driverAdvanceCloseAmount, entityRef: voucher._id, entityType: 'driverVoucher' });
    if (additionalPaymentAmount > 0) lines.push({ account: resolveCashBankAccount(settlementBank), credit: additionalPaymentAmount, entityRef: voucher.settlementBankRef, entityType: 'bankAccount' });

    await postJournalEntry(session, {
        entryDate: voucher.settledDate || getBusinessDateValue(),
        memo: `Settlement uang jalan ${voucher.bonNumber || voucher._id}`,
        sourceType: 'DRIVER_VOUCHER',
        sourceRef: voucher._id,
        sourceEvent: 'SETTLE',
        sourceNumber: voucher.bonNumber,
        sourceLabel: voucher.settlementBankName || voucher.issueBankName,
        lines,
    });
}
