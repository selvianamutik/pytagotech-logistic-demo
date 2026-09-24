import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import {
    inferExpenseCategoryScope,
    isManualExpenseCategory,
    resolveExpenseCategoryAccountKey,
} from '@/lib/expense-category-scope';
import {
    createDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { hasPermission } from '@/lib/rbac';
import type { BankTransaction, Expense, ExpenseCategory } from '@/lib/types';

import { postExpenseJournal, voidJournalEntryForSource } from './accounting-posting';
import { recomputeBankLedgerBalancesForAccounts } from './bank-balance-helpers';
import {
    assertIsoDate,
    computeLedgerDebitBalance,
    getLedgerAccount,
    normalizeCurrencyNumber,
    normalizeOptionalText,
    readLedgerBalance,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

function validateIsoDateOrResponse(dateValue: string, label: string, fallbackMessage: string) {
    try {
        assertIsoDate(dateValue, label);
        return null;
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : fallbackMessage },
            { status: 400 }
        );
    }
}

function formatAuditMoney(amount: number) {
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

function buildExpenseAuditSummary(input: {
    amount: number;
    categoryName?: string;
    bankName?: string;
    note?: string;
    description?: string;
}) {
    const contextLabel = normalizeOptionalText(input.note) || normalizeOptionalText(input.description);
    const summary = [
        `Pengeluaran ${formatAuditMoney(input.amount)}`,
        input.categoryName ? `untuk ${input.categoryName}` : '',
        input.bankName ? `via ${input.bankName}` : 'tanpa rekening',
    ]
        .filter(Boolean)
        .join(' ');

    return contextLabel ? `${summary} - ${contextLabel}` : summary;
}

function sanitizePatchSet(input: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
    );
}

const WORKFLOW_LINK_FIELDS: Array<{ field: keyof Expense; label: string }> = [
    { field: 'relatedIncidentSettlementLineRef', label: 'penyelesaian insiden' },
    { field: 'relatedIncidentRef', label: 'insiden' },
    { field: 'relatedMaintenanceRef', label: 'maintenance' },
    { field: 'voucherRef', label: 'bon trip' },
    { field: 'boronganRef', label: 'slip borongan' },
    { field: 'relatedDeliveryOrderRef', label: 'DO / trip' },
];

export async function handleExpenseUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeOptionalText(data._id) || normalizeOptionalText(data.id);
    if (!id) {
        return NextResponse.json({ error: 'Pengeluaran tidak valid' }, { status: 400 });
    }

    if (!hasPermission(session, 'expenses', 'update')) {
        return NextResponse.json({ error: 'Tidak memiliki izin untuk mengubah pengeluaran' }, { status: 403 });
    }

    const expense = await getDocumentById<Expense>(id, 'expense');
    if (!expense) {
        return NextResponse.json({ error: 'Pengeluaran tidak ditemukan' }, { status: 404 });
    }

    const workflowLink = WORKFLOW_LINK_FIELDS.find(entry => Boolean(expense[entry.field]));
    if (workflowLink) {
        return NextResponse.json(
            { error: `Pengeluaran dari ${workflowLink.label} tidak bisa diubah manual. Ubah lewat workflow sumber.` },
            { status: 409 }
        );
    }

    const categoryRef =
        typeof data.categoryRef === 'string' && data.categoryRef ? data.categoryRef : expense.categoryRef;
    if (!categoryRef) {
        return NextResponse.json({ error: 'Kategori pengeluaran wajib dipilih' }, { status: 400 });
    }

    const category = await getDocumentById<ExpenseCategory>(categoryRef, 'expenseCategory');
    if (!category) {
        return NextResponse.json({ error: 'Kategori pengeluaran tidak ditemukan' }, { status: 404 });
    }
    if (category.active === false) {
        return NextResponse.json({ error: 'Kategori pengeluaran tidak aktif' }, { status: 409 });
    }
    if (!isManualExpenseCategory(category)) {
        return NextResponse.json(
            { error: 'Kategori ini khusus workflow. Gunakan kategori Pengeluaran Umum untuk input manual.' },
            { status: 409 }
        );
    }

    const amount = normalizeCurrencyNumber(data.amount ?? expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pengeluaran tidak valid' }, { status: 400 });
    }

    const expenseDate =
        typeof data.date === 'string' && data.date ? data.date : expense.date || getBusinessDateValue();
    const expenseDateError = validateIsoDateOrResponse(
        expenseDate,
        'Tanggal pengeluaran',
        'Tanggal pengeluaran tidak valid'
    );
    if (expenseDateError) {
        return expenseDateError;
    }

    const hasPrivacyLevel = Object.prototype.hasOwnProperty.call(data, 'privacyLevel');
    const rawPrivacyLevel = normalizeOptionalText(data.privacyLevel);
    if (hasPrivacyLevel && (!rawPrivacyLevel || (rawPrivacyLevel !== 'ownerOnly' && rawPrivacyLevel !== 'internal'))) {
        return NextResponse.json({ error: 'Level privasi pengeluaran tidak valid' }, { status: 400 });
    }
    const requestedPrivacyLevel =
        (hasPrivacyLevel ? rawPrivacyLevel : expense.privacyLevel) === 'ownerOnly' ? 'ownerOnly' : 'internal';
    if (requestedPrivacyLevel === 'ownerOnly' && !hasPermission(session, 'expenses', 'update')) {
        return NextResponse.json({ error: 'Hanya OWNER yang boleh membuat pengeluaran owner-only' }, { status: 403 });
    }
    const privacyLevel = requestedPrivacyLevel;

    const expenseNote = normalizeOptionalText(data.note);
    const expenseDescription = normalizeOptionalText(data.description) ?? expense.description;
    const receiptUrl = normalizeOptionalText(data.receiptUrl) ?? expense.receiptUrl;

    const categoryName = category.name;
    const categoryScope = inferExpenseCategoryScope(category);
    const accountSystemKey = resolveExpenseCategoryAccountKey(category);

    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;

    const existingBankTransactions = await listDocumentsByFilter<BankTransaction>('bankTransaction', {
        relatedExpenseRef: id,
    });
    const affectedAccountRefs = [
        ...new Set(
            existingBankTransactions
                .map(transaction => transaction.bankAccountRef)
                .filter((ref): ref is string => Boolean(ref))
        ),
    ];

    let bankAcc: BankAccountSummary | null = null;
    let oldDebitOnTarget = 0;
    if (selectedAccountRef) {
        bankAcc = await getLedgerAccount(selectedAccountRef);
        if (!bankAcc) {
            return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
        }
        oldDebitOnTarget = existingBankTransactions
            .filter(transaction => transaction.bankAccountRef === selectedAccountRef)
            .reduce((sum, transaction) => sum + readLedgerBalance(transaction.amount), 0);

        const { startingBalance, nextBalance } = computeLedgerDebitBalance(
            readLedgerBalance(bankAcc.currentBalance) + oldDebitOnTarget,
            amount
        );
        if (nextBalance < 0) {
            return NextResponse.json(
                {
                    error: `Saldo ${bankAcc.bankName} tidak cukup untuk pengeluaran. Saldo tersedia ${formatAuditMoney(startingBalance)}`,
                },
                { status: 409 }
            );
        }
    }

    if (existingBankTransactions.length > 0) {
        await Promise.all(existingBankTransactions.map(transaction => deleteDocument(transaction._id, 'bankTransaction')));
    }

    const now = new Date().toISOString();
    const expensePatch = sanitizePatchSet({
        categoryRef,
        categoryName,
        categoryScope,
        accountSystemKey,
        date: expenseDate,
        amount,
        note: expenseNote ?? null,
        description: expenseDescription ?? null,
        receiptUrl: receiptUrl ?? null,
        privacyLevel,
        bankAccountRef: bankAcc?._id || null,
        bankAccountName: bankAcc?.bankName || null,
        bankAccountNumber: bankAcc?.accountNumber || null,
        updatedAt: now,
        updatedBy: session._id,
        updatedByName: session.name,
    });
    const updatedExpense = await updateDocument<Expense & { [key: string]: unknown }>(id, expensePatch, 'expense');

    await voidJournalEntryForSource(session, 'EXPENSE', id, 'CREATE');
    await postExpenseJournal(session, updatedExpense as Expense, bankAcc);

    if (bankAcc) {
        const { nextBalance } = computeLedgerDebitBalance(
            readLedgerBalance(bankAcc.currentBalance) + oldDebitOnTarget,
            amount
        );
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'bankTransaction',
            bankAccountRef: bankAcc._id,
            bankAccountName: bankAcc.bankName,
            bankAccountNumber: bankAcc.accountNumber,
            type: 'DEBIT',
            amount,
            date: expenseDate,
            description: expenseDescription || expenseNote || 'Pengeluaran',
            balanceAfter: nextBalance,
            relatedExpenseRef: id,
        });
    }

    const recomputeRefs = [...new Set([...affectedAccountRefs, bankAcc?._id])].filter(
        (ref): ref is string => Boolean(ref)
    );
    if (recomputeRefs.length > 0) {
        await recomputeBankLedgerBalancesForAccounts(recomputeRefs);
    }

    await addAuditLog(
        session,
        'UPDATE',
        'expenses',
        id,
        `Koreksi: ${buildExpenseAuditSummary({
            amount,
            categoryName,
            bankName: bankAcc?.bankName,
            note: expenseNote,
            description: expenseDescription,
        })}`
    );

    return NextResponse.json({ data: updatedExpense, id });
}
