import { NextResponse } from 'next/server';

import { addDaysToDateValue, getBusinessDateValue } from '@/lib/business-date';
import { resolveCompanyLogoUrl } from '@/lib/branding';
import {
    calculateFreightNotaRowAmount,
    normalizeFreightNotaBillingMode,
    resolveFreightNotaBillingModeInput,
} from '@/lib/freight-nota-billing';
import {
    getDeliveryOrderActualDropDestinations,
    getDeliveryOrderBillableCargoSummary,
    hasDeliveryOrderBillableCargo,
} from '@/lib/delivery-order-completion';
import {
    inferExpenseCategoryScope,
    isManualExpenseCategory,
    resolveExpenseCategoryAccountKey,
} from '@/lib/expense-category-scope';
import {
    createDocument,
    getAllDocuments,
    getCompanyProfile,
    getDocumentById,
    getNextNumber,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { buildFreightNotaDisplayNumberFromParts } from '@/lib/nota-numbering';
import { findMatchingCustomerBillingRate } from '@/lib/customer-billing-rates';
import { buildFreightNotaCoverageRowKeys, buildNotaRowsFromDeliveryOrder } from '@/lib/invoice-create-page-support';
import { DEFAULT_PPH23_RATE_PERCENT, normalizePph23BaseMode, normalizePph23Enabled, normalizePph23RatePercent } from '@/lib/pph23';
import type {
    BankTransaction,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    DeliveryOrder,
    DeliveryOrderItem,
    DriverVoucher,
    Expense,
    ExpenseCategory,
    FreightNota,
    IncidentExpenseRoute,
    IncidentSettlementLine,
    FreightNotaInstructionAccount,
    InvoiceAdjustment,
    InvoiceAdjustmentKind,
    Order,
    Payment,
    PaymentMethod,
    Pph23BaseMode,
} from '@/lib/types';

import {
    assertIsoDate,
    computeLedgerDebitBalance,
    ensureCashAccount,
    extractRefId,
    getLedgerAccount,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizePaymentMethod,
    normalizeText,
    readLedgerBalance,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import { recomputeBankLedgerBalancesForAccounts, bankTransactionOrderKey } from './bank-balance-helpers';
import {
    INVOICE_ADJUSTMENT_KIND_SET,
    buildReceivablePatch,
    computeReceivableSnapshot,
    isFreightNotaRowEmpty,
    summarizeDeliveryOrderItems,
    type CustomerReceiptAllocationInput,
    type FreightNotaDeliveryOrderItemSource,
    type FreightNotaOrderSource,
    type InvoiceAdjustmentDoc,
    type NormalizedFreightNotaRow,
    type ReceivableDoc,
    type ReceivableSnapshot,
} from './finance-workflow-support';
import {
    findVoucherForIncidentDeliveryOrder,
    syncIncidentSettlementLineToDriverVoucherItem,
} from './incident-voucher-linking';
import {
    postBankTransferJournal,
    postCustomerOverpaymentRefundJournal,
    postCustomerReceiptJournal,
    postExpenseJournal,
    postFreightNotaIssueJournal,
    postInvoiceAdjustmentJournal,
    postPaymentJournal,
    voidJournalEntryForSource,
} from './accounting-posting';
import {
    buildIncidentSettlementActionRequiredMessage,
    scheduleOperationalAdminWhatsApp,
} from './operational-admin-notifications';
import { hasPermission } from '@/lib/rbac';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type ReceiptCustomerSource = {
    _id: string;
    _rev?: string;
    name?: string;
    active?: boolean;
};

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

function normalizeIncidentExpenseRoute(value: unknown): IncidentExpenseRoute | '' {
    const route = normalizeOptionalText(value)?.toUpperCase();
    return route === 'DRIVER_VOUCHER' || route === 'COMPANY_EXPENSE'
        ? route
        : '';
}

function normalizeFreightNotaAmount(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.round(value);
}

function normalizeFreightNotaLineMeta(row: Record<string, unknown>) {
    const invoiceLineDate = normalizeOptionalText(row.invoiceLineDate);
    if (invoiceLineDate) {
        assertIsoDate(invoiceLineDate, 'Tanggal kolom TGL invoice');
    }

    return {
        plt: normalizeOptionalText(row.plt),
        pc: normalizeOptionalText(row.pc),
        kbl: normalizeOptionalText(row.kbl),
        invoiceLineDate,
    };
}

function normalizeFreightNotaRowItemRefs(row: Pick<NormalizedFreightNotaRow, 'deliveryOrderItemRef' | 'deliveryOrderItemRefs'>) {
    const refs = Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
        ? row.deliveryOrderItemRefs
        : row.deliveryOrderItemRef
            ? [row.deliveryOrderItemRef]
            : [];
    return [...new Set(
        refs
            .map(value => normalizeOptionalText(value))
            .filter((value): value is string => Boolean(value))
    )];
}

function buildFreightNotaPayloadItemCoverageKey(params: {
    doRef?: string;
    itemRef: string;
    tujuan?: string;
    actualDropPointKey?: string;
}) {
    const doRef = normalizeOptionalText(params.doRef) || 'manual';
    const itemRef = normalizeOptionalText(params.itemRef) || '-';
    const tujuan = normalizeOptionalText(params.tujuan) || '-';
    const actualDropPointKey = normalizeOptionalText(params.actualDropPointKey) || '-';
    return `${doRef}::item::${itemRef}::tujuan::${tujuan}::drop::${actualDropPointKey}`;
}

function buildFreightNotaPayloadItemDestinationKey(params: {
    itemRef: string;
    tujuan?: string;
    actualDropPointKey?: string;
}) {
    const itemRef = normalizeOptionalText(params.itemRef) || '-';
    const tujuan = normalizeOptionalText(params.tujuan) || '-';
    const actualDropPointKey = normalizeOptionalText(params.actualDropPointKey) || '-';
    return `${itemRef}::${tujuan}::drop::${actualDropPointKey}`;
}

function buildFreightNotaLegacyItemCoverageKey(params: {
    doRef?: string;
    itemRef: string;
    tujuan?: string;
}) {
    const doRef = normalizeOptionalText(params.doRef) || 'manual';
    const itemRef = normalizeOptionalText(params.itemRef) || '-';
    const tujuan = normalizeOptionalText(params.tujuan) || '-';
    return `${doRef}::item::${itemRef}::tujuan::${tujuan}`;
}

function buildFreightNotaLegacyItemDestinationKey(params: {
    itemRef: string;
    tujuan?: string;
}) {
    const itemRef = normalizeOptionalText(params.itemRef) || '-';
    const tujuan = normalizeOptionalText(params.tujuan) || '-';
    return `${itemRef}::${tujuan}`;
}

function haveSameFreightNotaRowItemRefs(left: string[], right: string[]) {
    return left.length === right.length && left.every(value => right.includes(value));
}

function findBuiltNotaRowMatch(params: {
    row: NormalizedFreightNotaRow;
    deliveryOrder: DeliveryOrder;
    builtRows: ReturnType<typeof buildNotaRowsFromDeliveryOrder>;
}) {
    const { row, deliveryOrder, builtRows } = params;
    const rowItemRefs = normalizeFreightNotaRowItemRefs(row);
    if (rowItemRefs.length > 0) {
        const candidates = builtRows.filter(candidate =>
            haveSameFreightNotaRowItemRefs(
                normalizeFreightNotaRowItemRefs({
                    deliveryOrderItemRef: candidate.deliveryOrderItemRef,
                    deliveryOrderItemRefs: candidate.deliveryOrderItemRefs,
                }),
                rowItemRefs
            )
        );
        if (candidates.length <= 1) {
            return candidates[0] || null;
        }
        const normalizedActualDropPointKey = normalizeOptionalText(row.actualDropPointKey);
        if (normalizedActualDropPointKey) {
            const exactDropCandidate = candidates.find(candidate =>
                normalizeOptionalText(candidate.actualDropPointKey) === normalizedActualDropPointKey
            );
            if (exactDropCandidate) {
                return exactDropCandidate;
            }
        }
        const normalizedDestination = normalizeOptionalText(row.tujuan);
        return candidates.find(candidate => normalizeOptionalText(candidate.tujuan) === normalizedDestination)
            || candidates[0]
            || null;
    }

    const rowCoverageKeys = buildFreightNotaCoverageRowKeys({
        deliveryOrder,
        noSJ: row.noSJ,
    });

    return builtRows.find(candidate => {
        const candidateCoverageKeys = buildFreightNotaCoverageRowKeys({
            deliveryOrder,
            noSJ: candidate.noSJ,
            deliveryOrderItemRefs: normalizeFreightNotaRowItemRefs({
                deliveryOrderItemRef: candidate.deliveryOrderItemRef,
                deliveryOrderItemRefs: candidate.deliveryOrderItemRefs,
            }),
        });
        return (
            candidateCoverageKeys.some(key => rowCoverageKeys.includes(key))
            || normalizeOptionalText(candidate.noSJ) === normalizeOptionalText(row.noSJ)
        );
    }) || null;
}

async function syncFreightNotaDeliveryOrderLinks(params: {
    notaId: string;
    notaNumber: string;
    nextDeliveryOrderRefs: string[];
}) {
    const currentlyLinkedDeliveryOrders = await listDocumentsByFilter<Array<{
        _id: string;
        freightNotaRef?: string | null;
    }>[number]>('deliveryOrder', { freightNotaRef: params.notaId });
    const refsToClear = currentlyLinkedDeliveryOrders
        .map(item => normalizeOptionalText(item._id))
        .filter((value): value is string => Boolean(value));

    await Promise.all(refsToClear.map(deliveryOrderRef => updateDocument(deliveryOrderRef, {
            freightNotaRef: null,
            freightNotaNumber: null,
        }, 'deliveryOrder')));
}

function normalizeWholeMoneyAmount(value: unknown) {
    const normalized = normalizeNumber(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return 0;
    }
    return Math.round(normalized);
}

function formatAuditMoney(amount: number) {
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

function buildPostedIncidentSettlementFollowUpAction(line: Pick<IncidentSettlementLine, 'lineType' | 'category'> | { lineType?: string; category?: string }) {
    if (line.lineType !== 'COST') {
        return '';
    }
    if (line.category === 'TIRE') {
        return 'Catat aset ban dari insiden; lanjut pasang ke unit atau jadwalkan maintenance bila perlu.';
    }
    if (line.category === 'REPAIR' || line.category === 'SPAREPART') {
        return 'Buat follow-up maintenance supaya histori unit dan biaya perbaikan tidak putus.';
    }
    return '';
}

function schedulePostedIncidentSettlementFollowUpReminder(params: {
    line: {
        incidentNumber?: string;
        lineType?: string;
        category?: string;
        description?: string;
        amount?: number;
    };
    incident?: {
        incidentNumber?: string;
        relatedDONumber?: string;
        vehiclePlate?: string;
    } | null;
}) {
    const actionLabel = buildPostedIncidentSettlementFollowUpAction(params.line);
    if (!actionLabel) return;
    scheduleOperationalAdminWhatsApp(buildIncidentSettlementActionRequiredMessage({
        incidentNumber: params.incident?.incidentNumber || params.line.incidentNumber,
        doNumber: params.incident?.relatedDONumber,
        vehiclePlate: params.incident?.vehiclePlate,
        category: params.line.category,
        description: params.line.description,
        amount: params.line.amount,
        statusLabel: 'Sudah diposting',
        actionLabel,
    }));
}

function normalizePph23SettingsInput(
    data: Record<string, unknown>,
    fallback?: {
        enabled?: boolean;
        ratePercent?: number;
        baseMode?: Pph23BaseMode;
    }
) {
    const enabled = Object.prototype.hasOwnProperty.call(data, 'pph23Enabled')
        ? normalizePph23Enabled(data.pph23Enabled, fallback?.enabled ?? false)
        : fallback?.enabled ?? false;
    const ratePercent = Object.prototype.hasOwnProperty.call(data, 'pph23RatePercent')
        ? normalizePph23RatePercent(data.pph23RatePercent, fallback?.ratePercent ?? DEFAULT_PPH23_RATE_PERCENT)
        : fallback?.ratePercent ?? DEFAULT_PPH23_RATE_PERCENT;
    const baseMode = Object.prototype.hasOwnProperty.call(data, 'pph23BaseMode')
        ? normalizePph23BaseMode(data.pph23BaseMode, fallback?.baseMode ?? 'BEFORE_CLAIM')
        : fallback?.baseMode ?? 'BEFORE_CLAIM';

    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
        throw new Error('Tarif PPh 23 tidak valid');
    }
    if (enabled && ratePercent <= 0) {
        throw new Error('Tarif PPh 23 harus lebih dari 0%');
    }

    return {
        pph23Enabled: enabled,
        pph23RatePercent: ratePercent,
        pph23BaseMode: baseMode,
    };
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

function parseOptionalStrictNotaRowNumber(
    value: unknown,
    label: string,
    options?: { allowDecimal?: boolean; maxFractionDigits?: number }
) {
    if (value === undefined || value === null) {
        return 0;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return 0;
        }
        if (!/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            throw new Error(label);
        }
    }

    const normalized = normalizeNumber(value, options);
    if (!Number.isFinite(normalized)) {
        throw new Error(label);
    }
    return normalized;
}

async function loadFreightNotaDocumentSettings(): Promise<{
    instructionAccounts: FreightNotaInstructionAccount[];
    notaSeriesCode?: string;
    footerNote?: string;
    issuerCompanyName?: string;
    issuerCompanyAddress?: string;
    issuerCompanyPhone?: string;
    issuerCompanyEmail?: string;
    issuerCompanyLogoUrl?: string;
    issuerCompanySignatureStampUrl?: string;
    issuerCompanySignatureName?: string;
    issuerCompanyNpwp?: string;
}> {
    const companyDoc = await getCompanyProfile<{
        _id?: string;
        name?: string;
        address?: string;
        phone?: string;
        email?: string;
        logoUrl?: string;
        signatureStampUrl?: string;
        npwp?: string;
        bankName?: string;
        bankAccount?: string;
        bankHolder?: string;
        numberingSettings?: {
            notaSeriesCode?: string;
        };
        invoiceSettings?: {
            invoiceBankAccountRefs?: string[];
            defaultInvoiceBankAccountRef?: string;
            footerNote?: string;
        };
    }>();

    const selectedRefs = Array.isArray(companyDoc?.invoiceSettings?.invoiceBankAccountRefs)
        ? companyDoc.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];

    if (selectedRefs.length > 0) {
        const selectedAccounts = await listDocumentsByFilter<Array<{
            _id: string;
            bankName?: string;
            accountNumber?: string;
            accountHolder?: string;
            accountType?: string;
            active?: boolean;
        }>[number]>('bankAccount', { _id: selectedRefs });
        const eligibleAccounts = selectedAccounts
            .filter(account => account.active !== false && account.accountType !== 'CASH')
            .map<FreightNotaInstructionAccount>(account => ({
                bankAccountRef: account._id,
                bankName: normalizeText(account.bankName),
                accountNumber: normalizeOptionalText(account.accountNumber),
                accountHolder: normalizeOptionalText(account.accountHolder),
            }))
            .filter(account => Boolean(account.bankName));

        if (eligibleAccounts.length > 0) {
            const defaultRef = typeof companyDoc?.invoiceSettings?.defaultInvoiceBankAccountRef === 'string'
                ? companyDoc.invoiceSettings.defaultInvoiceBankAccountRef
                : undefined;
            return {
                instructionAccounts: eligibleAccounts.sort((left, right) => {
                    if (defaultRef) {
                        if (left.bankAccountRef === defaultRef) return -1;
                        if (right.bankAccountRef === defaultRef) return 1;
                    }
                    return selectedRefs.indexOf(left.bankAccountRef || '') - selectedRefs.indexOf(right.bankAccountRef || '');
                }),
                notaSeriesCode: normalizeOptionalText(companyDoc?.numberingSettings?.notaSeriesCode),
                footerNote: normalizeOptionalText(companyDoc?.invoiceSettings?.footerNote),
                issuerCompanyName: normalizeOptionalText(companyDoc?.name),
                issuerCompanyAddress: normalizeOptionalText(companyDoc?.address),
                issuerCompanyPhone: normalizeOptionalText(companyDoc?.phone),
                issuerCompanyEmail: normalizeOptionalText(companyDoc?.email),
                issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyDoc),
                issuerCompanySignatureStampUrl: normalizeOptionalText(companyDoc?.signatureStampUrl),
                issuerCompanySignatureName:
                    normalizeOptionalText(companyDoc?.bankHolder)
                    || eligibleAccounts.find(account => account.accountHolder)?.accountHolder
                    || 'Bagian Administrasi',
                issuerCompanyNpwp: normalizeOptionalText(companyDoc?.npwp),
            };
        }
    }

    const legacyBankName = normalizeOptionalText(companyDoc?.bankName);
    if (!legacyBankName) {
        return {
            instructionAccounts: [],
            notaSeriesCode: normalizeOptionalText(companyDoc?.numberingSettings?.notaSeriesCode),
            footerNote: normalizeOptionalText(companyDoc?.invoiceSettings?.footerNote),
            issuerCompanyName: normalizeOptionalText(companyDoc?.name),
            issuerCompanyAddress: normalizeOptionalText(companyDoc?.address),
            issuerCompanyPhone: normalizeOptionalText(companyDoc?.phone),
            issuerCompanyEmail: normalizeOptionalText(companyDoc?.email),
            issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyDoc),
            issuerCompanySignatureStampUrl: normalizeOptionalText(companyDoc?.signatureStampUrl),
            issuerCompanySignatureName:
                normalizeOptionalText(companyDoc?.bankHolder)
                || 'Bagian Administrasi',
            issuerCompanyNpwp: normalizeOptionalText(companyDoc?.npwp),
        };
    }

    return {
        instructionAccounts: [{
            bankName: legacyBankName,
            accountNumber: normalizeOptionalText(companyDoc?.bankAccount),
            accountHolder: normalizeOptionalText(companyDoc?.bankHolder),
        }],
        notaSeriesCode: normalizeOptionalText(companyDoc?.numberingSettings?.notaSeriesCode),
        footerNote: normalizeOptionalText(companyDoc?.invoiceSettings?.footerNote),
        issuerCompanyName: normalizeOptionalText(companyDoc?.name),
        issuerCompanyAddress: normalizeOptionalText(companyDoc?.address),
        issuerCompanyPhone: normalizeOptionalText(companyDoc?.phone),
        issuerCompanyEmail: normalizeOptionalText(companyDoc?.email),
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyDoc),
        issuerCompanySignatureStampUrl: normalizeOptionalText(companyDoc?.signatureStampUrl),
        issuerCompanySignatureName:
            normalizeOptionalText(companyDoc?.bankHolder)
            || 'Bagian Administrasi',
        issuerCompanyNpwp: normalizeOptionalText(companyDoc?.npwp),
    };
}

async function loadReceivableSnapshot(invoiceRef: string) {
    const doc = await getDocumentById<ReceivableDoc>(invoiceRef);
    if (!doc) {
        return { error: NextResponse.json({ error: 'Dokumen invoice tidak ditemukan' }, { status: 404 }) };
    }
    if (doc._type !== 'freightNota' && doc._type !== 'invoice') {
        return {
            error: NextResponse.json(
                { error: 'Pembayaran hanya boleh dicatat untuk invoice ongkos atau arsip invoice lama' },
                { status: 409 }
            ),
        };
    }
    if (doc.status === 'VOID') {
        return {
            error: NextResponse.json(
                { error: 'Invoice yang sudah dibatalkan tidak bisa diproses lagi' },
                { status: 409 }
            ),
        };
    }

    const grossAmount = Math.max(normalizeNumber(doc.totalAmount || 0), 0);
    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
        return { error: NextResponse.json({ error: 'Total invoice tidak valid' }, { status: 400 }) };
    }

    const [allPayments, approvedAdjustments, overpaymentRefunds] = await Promise.all([
        listDocumentsByFilter<Payment>('payment', { invoiceRef }),
        listDocumentsByFilter<InvoiceAdjustmentDoc>('invoiceAdjustment', { invoiceRef, status: 'APPROVED' }),
        listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'amount'>>('customerOverpaymentRefund', {
            sourceType: 'INVOICE_OVERPAID',
            sourceInvoiceRef: invoiceRef,
        }),
    ]);

    return computeReceivableSnapshot(
        doc,
        allPayments,
        approvedAdjustments,
        overpaymentRefunds.reduce((sum, item) => sum + normalizeWholeMoneyAmount(item.amount), 0)
    );
}

function getReceivableDocumentType(snapshot: ReceivableSnapshot) {
    return snapshot.doc._type === 'freightNota' ? 'freightNota' : 'invoice';
}

async function updateReceivableSnapshot(
    snapshot: ReceivableSnapshot,
    totalPaid: number,
    totalAdjustmentAmount: number,
    pph23Override?: Partial<Pick<ReceivableSnapshot, 'pph23Enabled' | 'pph23RatePercent' | 'pph23BaseMode'>>
) {
    const patch = buildReceivablePatch(snapshot, totalPaid, totalAdjustmentAmount, pph23Override);
    await updateDocument(snapshot.doc._id, patch, getReceivableDocumentType(snapshot));
    return patch;
}

async function loadReceiptOverpaymentSnapshot(receiptRef: string) {
    const receipt = await getDocumentById<{
        _id: string;
        _rev?: string;
        _type?: string;
        receiptNumber?: string;
        customerRef?: string;
        customerName?: string;
        totalAmount?: unknown;
        date?: string;
    }>(receiptRef);
    if (!receipt || receipt._id !== receiptRef || receipt._type !== 'customerReceipt') {
        return { error: NextResponse.json({ error: 'Penerimaan customer tidak ditemukan' }, { status: 404 }) };
    }

    const [receiptPayments, refunds] = await Promise.all([
        listDocumentsByFilter<Pick<Payment, 'amount'>>('payment', { receiptRef }),
        listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'amount'>>('customerOverpaymentRefund', {
            sourceType: 'RECEIPT_UNAPPLIED',
            sourceReceiptRef: receiptRef,
        }),
    ]);

    const totalAmount = normalizeWholeMoneyAmount(receipt.totalAmount);
    const allocatedAmount = receiptPayments.reduce((sum, item) => sum + normalizeWholeMoneyAmount(item.amount), 0);
    const rawOverpaymentAmount = Math.max(totalAmount - allocatedAmount, 0);
    const refundedOverpaymentAmount = Math.min(
        refunds.reduce((sum, item) => sum + normalizeWholeMoneyAmount(item.amount), 0),
        rawOverpaymentAmount
    );
    const openOverpaymentAmount = Math.max(rawOverpaymentAmount - refundedOverpaymentAmount, 0);

    return {
        receipt,
        totalAmount,
        allocatedAmount,
        rawOverpaymentAmount,
        refundedOverpaymentAmount,
        openOverpaymentAmount,
    };
}

function buildCustomerReceiptOverpaymentPatch(params: {
    totalAmount: number;
    allocatedAmount: number;
    refundedOverpaymentAmount: number;
}) {
    const unappliedAmount = Math.max(params.totalAmount - params.allocatedAmount, 0);
    const refundedOverpaymentAmount = Math.min(
        Math.max(params.refundedOverpaymentAmount, 0),
        unappliedAmount
    );
    const openOverpaymentAmount = Math.max(unappliedAmount - refundedOverpaymentAmount, 0);

    return {
        allocatedAmount: params.allocatedAmount,
        unappliedAmount: unappliedAmount > 0 ? unappliedAmount : undefined,
        refundedOverpaymentAmount: refundedOverpaymentAmount > 0 ? refundedOverpaymentAmount : undefined,
        openOverpaymentAmount: openOverpaymentAmount > 0 ? openOverpaymentAmount : undefined,
        overpaymentStatus:
            openOverpaymentAmount > 0
                ? 'OPEN'
                : refundedOverpaymentAmount > 0
                    ? 'REFUNDED'
                    : undefined,
    };
}

function validateAdjustmentChangeAgainstRefunds(
    snapshot: ReceivableSnapshot,
    nextAdjustmentAmount: number
) {
    const nextNetAmount = buildReceivablePatch(
        snapshot,
        snapshot.totalPaid,
        nextAdjustmentAmount
    ).netAmount;
    const nextRawOverpaymentAmount = Math.max(snapshot.paidBeforeRefund - nextNetAmount, 0);
    if (snapshot.refundedOverpaymentAmount > nextRawOverpaymentAmount) {
        return NextResponse.json(
            {
                error: 'Potongan tidak bisa dikurangi karena kelebihan bayar dari invoice ini sudah dikonfirmasi transfer balik. Batalkan refund terkait dulu jika memang perlu.',
            },
            { status: 409 }
        );
    }
    return null;
}

async function resolveReceiptBankAccount(method: PaymentMethod, selectedAccountRef?: string) {
    let bankAcc: BankAccountSummary | null = null;
    if (selectedAccountRef) {
        bankAcc = await getLedgerAccount(selectedAccountRef);
        if (!bankAcc) {
            return { error: NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 }) };
        }
    } else if (method === 'CASH') {
        bankAcc = await ensureCashAccount();
    }

    if (method === 'TRANSFER' && bankAcc?.accountType === 'CASH') {
        return {
            error: NextResponse.json(
                { error: 'Metode transfer harus memakai rekening bank, bukan akun Kas Tunai' },
                { status: 400 }
            ),
        };
    }

    if (method === 'CASH' && bankAcc?.accountType && bankAcc.accountType !== 'CASH') {
        return {
            error: NextResponse.json(
                { error: 'Metode tunai harus memakai akun Kas Tunai, bukan rekening bank' },
                { status: 400 }
            ),
        };
    }

    return { bankAcc };
}

export async function handlePaymentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pembayaran tidak valid' }, { status: 400 });
    }

    const invoiceRef = typeof data.invoiceRef === 'string' ? data.invoiceRef : '';
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi invoice wajib diisi' }, { status: 400 });
    }

    const paymentMethod = normalizePaymentMethod(data.method);
    if (!paymentMethod) {
        return NextResponse.json({ error: 'Metode pembayaran tidak valid' }, { status: 400 });
    }
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const paymentDate =
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const paymentDateError = validateIsoDateOrResponse(paymentDate, 'Tanggal pembayaran', 'Tanggal pembayaran tidak valid');
    if (paymentDateError) {
        return paymentDateError;
    }

    const paymentId = crypto.randomUUID();
    const incomeId = crypto.randomUUID();
    const bankTransactionId = crypto.randomUUID();

    const loaded = await loadReceivableSnapshot(invoiceRef);
    if ('error' in loaded) return loaded.error;

    if (amount > loaded.remainingAmount) {
        return NextResponse.json(
            { error: `Pembayaran melebihi sisa invoice netto (${loaded.remainingAmount})` },
            { status: 400 }
        );
    }

    const resolvedBank = await resolveReceiptBankAccount(paymentMethod, selectedAccountRef);
    if ('error' in resolvedBank) return resolvedBank.error;
    const { bankAcc } = resolvedBank;

    const paymentNote = normalizeOptionalText(data.note);
    const paymentAttachmentUrl = normalizeOptionalText(data.attachmentUrl);
    const receiptNumber = await getNextNumber('receipt', paymentDate);
    const paymentDoc: Payment & { [key: string]: unknown } = {
        _id: paymentId,
        _type: 'payment',
        invoiceRef,
        receiptNumber,
        date: paymentDate,
        amount,
        method: paymentMethod,
    };
    if (paymentNote) {
        paymentDoc.note = paymentNote;
    }
    if (paymentAttachmentUrl) {
        paymentDoc.attachmentUrl = paymentAttachmentUrl;
    }
    if (bankAcc) {
        paymentDoc.bankAccountRef = bankAcc._id;
        paymentDoc.bankAccountName = bankAcc.bankName;
        paymentDoc.bankAccountNumber = bankAcc.accountNumber;
    } else {
        delete paymentDoc.bankAccountRef;
        delete paymentDoc.bankAccountName;
        delete paymentDoc.bankAccountNumber;
    }

    await createDocument(paymentDoc);
    await createDocument({
        _id: incomeId,
        _type: 'income',
        sourceType: 'INVOICE_PAYMENT',
        paymentRef: paymentId,
        date: paymentDate,
        amount,
        note: loaded.doc._type === 'freightNota' ? 'Pembayaran invoice ongkos' : 'Pembayaran arsip invoice',
    });
    await createDocument({
        _id: bankTransactionId,
        _type: 'bankTransaction',
        bankAccountRef: bankAcc?._id || '',
        bankAccountName: bankAcc?.bankName || '',
        bankAccountNumber: bankAcc?.accountNumber || '',
        type: 'CREDIT',
        amount,
        date: paymentDate,
        description:
            bankAcc?.accountType === 'CASH'
                ? 'Pembayaran tunai masuk'
                : loaded.doc._type === 'freightNota'
                    ? 'Pembayaran invoice masuk'
                    : 'Pembayaran arsip invoice masuk',
        balanceAfter: bankAcc ? readLedgerBalance(bankAcc.currentBalance) + amount : 0,
        relatedPaymentRef: paymentId,
    });

    // Race-condition guard: re-validate snapshot AFTER creating payment
    // If concurrent payment was processed, this will detect overpay and rollback
    const reloadedSnapshot = await loadReceivableSnapshot(invoiceRef);
    if (!('error' in reloadedSnapshot)) {
        const actualRemaining = reloadedSnapshot.remainingAmount;
        if (actualRemaining < 0) {
            // Concurrent payment caused overpay — rollback all created documents
            const { deleteDocument } = await import('@/lib/repositories/document-store');
            await deleteDocument(paymentId, 'payment');
            await deleteDocument(incomeId, 'income');
            await deleteDocument(bankTransactionId, 'bankTransaction');
            return NextResponse.json(
                { error: `Pembayaran tidak bisa diproses karena ada pembayaran lain yang sedang diproses. Sisa invoice netto sekarang: ${actualRemaining}` },
                { status: 409 }
            );
        }
        // Safe to update snapshot with fresh data
        await updateDocument(
            reloadedSnapshot.doc._id,
            buildReceivablePatch(reloadedSnapshot, reloadedSnapshot.totalPaid + amount, reloadedSnapshot.totalAdjustmentAmount),
            getReceivableDocumentType(reloadedSnapshot)
        );
    }

    // Bank balance update via recompute to ensure consistency
    // This eliminates drift that accumulates with manual read-then-write
    if (bankAcc) {
        await recomputeBankLedgerBalancesForAccounts([bankAcc._id]);
    }

    await postPaymentJournal(session, paymentDoc, bankAcc, loaded.label);

    await addAuditLog(
        session,
        'CREATE',
        'payments',
        paymentId,
        `Pembayaran ${receiptNumber} dicatat untuk ${loaded.doc._type === 'freightNota' ? 'invoice' : 'arsip invoice'} ${loaded.label || invoiceRef}`
    );
    return NextResponse.json({ data: paymentDoc, id: paymentId });
}

export async function handlePaymentUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const paymentId =
        normalizeOptionalText(data._id) ||
        normalizeOptionalText(data.id) ||
        normalizeOptionalText(data.paymentRef);
    if (!paymentId) {
        return NextResponse.json({ error: 'Referensi pembayaran wajib diisi' }, { status: 400 });
    }

    const payment = await getDocumentById<Payment>(paymentId, 'payment');
    if (!payment) {
        return NextResponse.json({ error: 'Pembayaran tidak ditemukan' }, { status: 404 });
    }
    if (payment.receiptRef) {
        return NextResponse.json(
            { error: 'Pembayaran dari penerimaan customer harus dikoreksi dari menu penerimaan customer.' },
            { status: 409 }
        );
    }

    const invoiceRef = normalizeOptionalText(data.invoiceRef) || payment.invoiceRef;
    if (!invoiceRef || invoiceRef !== payment.invoiceRef) {
        return NextResponse.json({ error: 'Invoice pembayaran tidak boleh diubah' }, { status: 400 });
    }

    const loaded = await loadReceivableSnapshot(invoiceRef);
    if ('error' in loaded) return loaded.error;
    if (loaded.doc.status === 'VOID') {
        return NextResponse.json({ error: 'Pembayaran invoice batal tidak bisa diedit' }, { status: 409 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pembayaran tidak valid' }, { status: 400 });
    }

    const paymentMethod = normalizePaymentMethod(data.method);
    if (!paymentMethod) {
        return NextResponse.json({ error: 'Metode pembayaran tidak valid' }, { status: 400 });
    }
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const paymentDate =
        typeof data.date === 'string' && data.date ? data.date : payment.date || getBusinessDateValue();
    const paymentDateError = validateIsoDateOrResponse(paymentDate, 'Tanggal pembayaran', 'Tanggal pembayaran tidak valid');
    if (paymentDateError) {
        return paymentDateError;
    }

    const previousAmount = normalizeWholeMoneyAmount(payment.amount);
    const nextPaidBeforeRefund = Math.max(loaded.paidBeforeRefund - previousAmount + amount, 0);
    const nextPaidAfterRefund = Math.max(nextPaidBeforeRefund - loaded.refundedOverpaymentAmount, 0);
    if (loaded.refundedOverpaymentAmount > Math.max(nextPaidBeforeRefund - loaded.netAmount, 0)) {
        return NextResponse.json(
            {
                error: 'Pembayaran tidak bisa dikurangi karena kelebihan bayar dari invoice ini sudah dikonfirmasi transfer balik. Batalkan refund terkait dulu jika memang perlu.',
            },
            { status: 409 }
        );
    }
    if (nextPaidAfterRefund > loaded.netAmount) {
        return NextResponse.json(
            { error: `Pembayaran melebihi sisa invoice netto (${Math.max(loaded.netAmount - (loaded.totalPaid - previousAmount), 0)})` },
            { status: 400 }
        );
    }

    const resolvedBank = await resolveReceiptBankAccount(paymentMethod, selectedAccountRef);
    if ('error' in resolvedBank) return resolvedBank.error;
    const { bankAcc } = resolvedBank;

    const previousBankRef = normalizeOptionalText(payment.bankAccountRef);
    const previousBankAcc = previousBankRef ? await getLedgerAccount(previousBankRef) : null;
    if (previousBankRef && !previousBankAcc) {
        return NextResponse.json(
            { error: 'Rekening bank pembayaran lama tidak ditemukan, koreksi manual diperlukan sebelum pembayaran diedit.' },
            { status: 409 }
        );
    }

    const paymentNote = normalizeOptionalText(data.note);
    const paymentAttachmentUrl = normalizeOptionalText(data.attachmentUrl);
    const previousDate = normalizeOptionalText(payment.date);
    const previousMethod = normalizePaymentMethod(payment.method) || payment.method;
    const needsBankCorrection =
        previousBankRef !== (bankAcc?._id || '') ||
        previousAmount !== amount ||
        previousDate !== paymentDate ||
        previousMethod !== paymentMethod;
    let reversalBankTransactionRef: string | null = null;
    let replacementBankTransactionRef: string | null = null;

    if (needsBankCorrection) {
        const existingPaymentBankTransactions = (await listDocumentsByFilter<BankTransaction>('bankTransaction', {
            relatedPaymentRef: paymentId,
        }))
            .filter(transaction => transaction.bankAccountRef === previousBankRef && transaction.type === 'CREDIT')
            .sort((left, right) => bankTransactionOrderKey(left).localeCompare(bankTransactionOrderKey(right)));
        const previousPaymentBankTransaction = existingPaymentBankTransactions[existingPaymentBankTransactions.length - 1];
        const correctionDate = getBusinessDateValue();
        let previousBankBalanceAfterReversal: number | null = null;
        if (previousBankAcc) {
            previousBankBalanceAfterReversal = readLedgerBalance(previousBankAcc.currentBalance) - previousAmount;
            reversalBankTransactionRef = crypto.randomUUID();
            await createDocument({
                _id: reversalBankTransactionRef,
                _type: 'bankTransaction',
                bankAccountRef: previousBankAcc._id,
                bankAccountName: previousBankAcc.bankName,
                bankAccountNumber: previousBankAcc.accountNumber,
                type: 'DEBIT',
                amount: previousAmount,
                date: correctionDate,
                description: `Koreksi balik pembayaran invoice ${loaded.label || invoiceRef}`,
                balanceAfter: previousBankBalanceAfterReversal,
                relatedPaymentRef: paymentId,
                reversesBankTransactionRef: previousPaymentBankTransaction?._id,
            });
        }

        if (bankAcc) {
            const replacementBaseBalance =
                previousBankAcc && previousBankAcc._id === bankAcc._id && previousBankBalanceAfterReversal !== null
                    ? previousBankBalanceAfterReversal
                    : readLedgerBalance(bankAcc.currentBalance);
            const nextBankBalance = replacementBaseBalance + amount;
            replacementBankTransactionRef = crypto.randomUUID();
            await createDocument({
                _id: replacementBankTransactionRef,
                _type: 'bankTransaction',
                bankAccountRef: bankAcc._id,
                bankAccountName: bankAcc.bankName,
                bankAccountNumber: bankAcc.accountNumber,
                type: 'CREDIT',
                amount,
                date: paymentDate,
                description: `Koreksi pembayaran invoice ${loaded.label || invoiceRef}`,
                balanceAfter: nextBankBalance,
                relatedPaymentRef: paymentId,
                replacesBankTransactionRef: previousPaymentBankTransaction?._id,
            });
        }

        await recomputeBankLedgerBalancesForAccounts([previousBankAcc?._id, bankAcc?._id]);
    }

    const paymentPatch = sanitizePatchSet({
        date: paymentDate,
        amount,
        method: paymentMethod,
        note: paymentNote || null,
        attachmentUrl: paymentAttachmentUrl || null,
        bankAccountRef: bankAcc?._id || null,
        bankAccountName: bankAcc?.bankName || null,
        bankAccountNumber: bankAcc?.accountNumber || null,
        editedAt: new Date().toISOString(),
        editedBy: session._id,
        editedByName: session.name,
        ...(needsBankCorrection
            ? {
                reversalBankTransactionRef,
                replacementBankTransactionRef,
                previousAmount,
            }
            : {}),
    });
    const updatedPayment = await updateDocument<Payment & { [key: string]: unknown }>(
        paymentId,
        paymentPatch,
        'payment'
    );

    const incomeRows = await listDocumentsByFilter<{ _id: string }>('income', { paymentRef: paymentId });
    const incomeNote =
        loaded.doc._type === 'freightNota' ? 'Pembayaran invoice ongkos' : 'Pembayaran arsip invoice';
    if (incomeRows[0]?._id) {
        await updateDocument(incomeRows[0]._id, { date: paymentDate, amount, note: incomeNote }, 'income');
    } else {
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'income',
            sourceType: 'INVOICE_PAYMENT',
            paymentRef: paymentId,
            date: paymentDate,
            amount,
            note: incomeNote,
        });
    }

    await updateReceivableSnapshot(loaded, nextPaidAfterRefund, loaded.totalAdjustmentAmount);
    await postPaymentJournal(session, updatedPayment, bankAcc, loaded.label);

    await addAuditLog(
        session,
        'UPDATE',
        'payments',
        paymentId,
        `Pembayaran ${payment.receiptNumber || paymentId} untuk invoice ${loaded.label || invoiceRef} dikoreksi: ${formatAuditMoney(previousAmount)} -> ${formatAuditMoney(amount)}`
    );
    return NextResponse.json({ data: updatedPayment, id: paymentId });
}

export async function handleCustomerReceiptCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const totalAmount = normalizeCurrencyNumber(data.totalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return NextResponse.json({ error: 'Total penerimaan tidak valid' }, { status: 400 });
    }

    const receiptDate =
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const receiptDateError = validateIsoDateOrResponse(receiptDate, 'Tanggal penerimaan', 'Tanggal penerimaan tidak valid');
    if (receiptDateError) {
        return receiptDateError;
    }

    const paymentMethod = normalizePaymentMethod(data.method);
    if (!paymentMethod) {
        return NextResponse.json({ error: 'Metode penerimaan tidak valid' }, { status: 400 });
    }
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const rawAllocations = Array.isArray(data.allocations) ? data.allocations : [];
    const allocations: CustomerReceiptAllocationInput[] = [];
    for (const row of rawAllocations.filter(isPlainObject)) {
        const invoiceRef = normalizeText(row.invoiceRef);
        const amount = normalizeCurrencyNumber(row.amount);
        const note = normalizeOptionalText(row.note);

        if (!invoiceRef) {
            return NextResponse.json({ error: 'Semua alokasi penerimaan wajib memilih invoice' }, { status: 400 });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return NextResponse.json({ error: 'Nominal alokasi penerimaan tidak valid' }, { status: 400 });
        }

        allocations.push({ invoiceRef, amount, note });
    }

    const uniqueInvoiceRefs = [...new Set(allocations.map(item => item.invoiceRef))];
    if (uniqueInvoiceRefs.length !== allocations.length) {
        return NextResponse.json({ error: 'Satu invoice hanya boleh muncul sekali dalam 1 penerimaan' }, { status: 400 });
    }

    const totalAllocated = allocations.reduce((sum, item) => sum + item.amount, 0);
    if (totalAllocated - totalAmount > 0.00001) {
        return NextResponse.json(
            { error: `Total alokasi (${totalAllocated}) tidak boleh melebihi total penerimaan (${totalAmount})` },
            { status: 400 }
        );
    }
    const unappliedAmount = Math.max(totalAmount - totalAllocated, 0);

    const explicitCustomerRef = typeof data.customerRef === 'string' && data.customerRef ? data.customerRef : undefined;
    const receiptNote = normalizeOptionalText(data.note);
    if (!explicitCustomerRef && allocations.length === 0) {
        return NextResponse.json({ error: 'Customer wajib dipilih untuk menyimpan kredit customer' }, { status: 400 });
    }

    let loadedSnapshots: ReceivableSnapshot[] = [];
    if (allocations.length > 0) {
        const snapshots = await Promise.all(allocations.map(item => loadReceivableSnapshot(item.invoiceRef)));
        for (const result of snapshots) {
            if ('error' in result) {
                return result.error;
            }
        }

        loadedSnapshots = snapshots as ReceivableSnapshot[];
    }

    let baseCustomerRef = explicitCustomerRef;
    let customerName = '-';
    let linkedCustomer: ReceiptCustomerSource | null = null;
    if (loadedSnapshots.length > 0) {
        if (
            explicitCustomerRef &&
            loadedSnapshots.some(snapshot => snapshot.customerRef && snapshot.customerRef !== explicitCustomerRef)
        ) {
            return NextResponse.json(
                { error: 'Customer penerimaan tidak cocok dengan invoice yang dipilih' },
                { status: 409 }
            );
        }

        const derivedCustomerRef = explicitCustomerRef ?? loadedSnapshots[0]?.customerRef;
        const baseCustomerName = loadedSnapshots[0]?.customerName || '-';

        if (
            loadedSnapshots.some(snapshot =>
                (derivedCustomerRef && snapshot.customerRef !== derivedCustomerRef) ||
                (!derivedCustomerRef && snapshot.customerName !== baseCustomerName)
            )
        ) {
            return NextResponse.json(
                { error: 'Penerimaan customer hanya boleh dialokasikan ke invoice customer yang sama' },
                { status: 409 }
            );
        }

        baseCustomerRef = derivedCustomerRef;
        customerName = baseCustomerName;
    } else if (explicitCustomerRef) {
        const customer = await getDocumentById<ReceiptCustomerSource>(explicitCustomerRef, 'customer');
        if (!customer) {
            return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
        }
        if (customer.active === false) {
            return NextResponse.json({ error: 'Customer tidak aktif' }, { status: 409 });
        }
        baseCustomerRef = customer._id;
        customerName = normalizeText(customer.name) || '-';
        linkedCustomer = customer;
    }
    if (!linkedCustomer && baseCustomerRef) {
        linkedCustomer = await getDocumentById<ReceiptCustomerSource>(baseCustomerRef, 'customer');
        if (!linkedCustomer) {
            return NextResponse.json({ error: 'Customer penerimaan tidak ditemukan' }, { status: 404 });
        }
    }

    for (const allocation of allocations) {
        const snapshot = loadedSnapshots.find(item => item.doc._id === allocation.invoiceRef);
        if (!snapshot) {
        return NextResponse.json({ error: 'Invoice alokasi tidak ditemukan' }, { status: 404 });
        }
        if (allocation.amount > snapshot.remainingAmount) {
            return NextResponse.json(
                { error: `Alokasi ke ${snapshot.label} melebihi sisa netto (${snapshot.remainingAmount})` },
                { status: 400 }
            );
        }
    }

    const resolvedBank = await resolveReceiptBankAccount(paymentMethod, selectedAccountRef);
    if ('error' in resolvedBank) return resolvedBank.error;
    const { bankAcc } = resolvedBank;

    const receiptId = crypto.randomUUID();
    const incomeId = crypto.randomUUID();
    const bankTransactionId = crypto.randomUUID();
    const receiptNumber = await getNextNumber('receipt', receiptDate);
    const receiptDoc: CustomerReceipt = {
        _id: receiptId,
        _type: 'customerReceipt',
        receiptNumber,
        customerRef: baseCustomerRef,
        customerName,
        date: receiptDate,
        totalAmount,
        allocatedAmount: totalAllocated,
        unappliedAmount: unappliedAmount > 0 ? unappliedAmount : undefined,
        allocationCount: allocations.length,
        method: paymentMethod,
        bankAccountRef: bankAcc?._id,
        bankAccountName: bankAcc?.bankName,
        bankAccountNumber: bankAcc?.accountNumber,
        note: receiptNote,
    };
    await createDocument(receiptDoc as unknown as { _type: string; [key: string]: unknown });
    await createDocument({
        _id: incomeId,
        _type: 'income',
        sourceType: 'CUSTOMER_RECEIPT',
        receiptRef: receiptId,
        date: receiptDate,
        amount: totalAmount,
        note: `Penerimaan customer ${receiptNumber}`,
    });
    if (linkedCustomer) {
        await updateDocument(linkedCustomer._id, { updatedAt: new Date().toISOString() }, 'customer');
    }

    if (bankAcc) {
        const nextBankBalance = readLedgerBalance(bankAcc.currentBalance) + totalAmount;
        await createDocument({
            _id: bankTransactionId,
            _type: 'bankTransaction',
            bankAccountRef: bankAcc._id,
            bankAccountName: bankAcc.bankName,
            bankAccountNumber: bankAcc.accountNumber,
            type: 'CREDIT',
            amount: totalAmount,
            date: receiptDate,
            description:
                bankAcc.accountType === 'CASH'
                    ? `Penerimaan tunai customer ${receiptNumber}`
                    : `Penerimaan customer ${receiptNumber}`,
            balanceAfter: nextBankBalance,
            relatedReceiptRef: receiptId,
        });
        // Bank balance update via recompute to ensure consistency
        await recomputeBankLedgerBalancesForAccounts([bankAcc._id]);
    }

    const createdPaymentIds: string[] = [];
    for (const allocation of allocations) {
        const snapshot = loadedSnapshots.find(item => item.doc._id === allocation.invoiceRef);
        if (!snapshot) continue;
        const paymentId = crypto.randomUUID();
        createdPaymentIds.push(paymentId);
        await createDocument({
            _id: paymentId,
            _type: 'payment',
            invoiceRef: allocation.invoiceRef,
            receiptRef: receiptId,
            receiptNumber,
            bankAccountRef: bankAcc?._id,
            bankAccountName: bankAcc?.bankName,
            bankAccountNumber: bankAcc?.accountNumber,
            date: receiptDate,
            amount: allocation.amount,
            method: paymentMethod,
            note: allocation.note ?? receiptNote,
        });
        await updateReceivableSnapshot(
            snapshot,
            snapshot.totalPaid + allocation.amount,
            snapshot.totalAdjustmentAmount,
        );
    }

    await postCustomerReceiptJournal(
        session,
        receiptDoc,
        bankAcc,
        allocations.map(allocation => ({
            invoiceRef: allocation.invoiceRef,
            amount: allocation.amount,
            label: loadedSnapshots.find(snapshot => snapshot.doc._id === allocation.invoiceRef)?.label,
        }))
    );

    await addAuditLog(
        session,
        'CREATE',
        'customer-receipts',
        receiptId,
        `Penerimaan ${receiptNumber} diterima untuk customer ${customerName}${allocations.length > 0 ? `, dialokasikan ke ${allocations.length} invoice` : ''}${unappliedAmount > 0 ? `, kredit tersisa ${unappliedAmount}` : ''}`
    );
    for (const paymentId of createdPaymentIds) {
        await addAuditLog(
            session,
            'CREATE',
            'payments',
            paymentId,
            `Alokasi penerimaan ${receiptNumber} dicatat`
        );
    }
    return NextResponse.json({
        data: {
            _id: receiptId,
            _type: 'customerReceipt',
            receiptNumber,
            customerRef: baseCustomerRef,
            customerName,
            date: receiptDate,
            totalAmount,
            allocatedAmount: totalAllocated,
            unappliedAmount: unappliedAmount > 0 ? unappliedAmount : undefined,
            allocationCount: allocations.length,
            method: paymentMethod,
            bankAccountRef: bankAcc?._id,
            bankAccountName: bankAcc?.bankName,
            bankAccountNumber: bankAcc?.accountNumber,
            note: receiptNote,
        },
        id: receiptId,
    });
}

export async function handleInvoiceAdjustmentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const invoiceRef = typeof data.invoiceRef === 'string' ? data.invoiceRef : '';
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi invoice wajib diisi' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal klaim/potongan tidak valid' }, { status: 400 });
    }

    const date = typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const adjustmentDateError = validateIsoDateOrResponse(date, 'Tanggal klaim/potongan', 'Tanggal klaim/potongan tidak valid');
    if (adjustmentDateError) {
        return adjustmentDateError;
    }

    const kind = typeof data.kind === 'string' ? data.kind as InvoiceAdjustmentKind : 'OTHER';
    if (!INVOICE_ADJUSTMENT_KIND_SET.has(kind)) {
        return NextResponse.json({ error: 'Jenis klaim/potongan tidak valid' }, { status: 400 });
    }

    const note = normalizeOptionalText(data.note);
    const snapshot = await loadReceivableSnapshot(invoiceRef);
    if ('error' in snapshot) return snapshot.error;

    const nextAdjustmentAmount = snapshot.totalAdjustmentAmount + amount;
    if (nextAdjustmentAmount > snapshot.grossAmount) {
        return NextResponse.json(
                { error: `Total potongan melebihi nilai bruto invoice (${snapshot.grossAmount})` },
            { status: 400 }
        );
    }

    const adjustmentId = crypto.randomUUID();
    const adjustmentDoc: InvoiceAdjustment & { [key: string]: unknown } = {
        _id: adjustmentId,
        _type: 'invoiceAdjustment',
        invoiceRef,
        customerRef: snapshot.customerRef,
        customerName: snapshot.customerName,
        date,
        amount,
        kind,
        status: 'APPROVED',
        note,
        createdBy: session._id,
        createdByName: session.name,
    };
    await createDocument(adjustmentDoc);
    await updateReceivableSnapshot(snapshot, snapshot.totalPaid, nextAdjustmentAmount);
    await postInvoiceAdjustmentJournal(session, adjustmentDoc as InvoiceAdjustment, snapshot.label);

    await addAuditLog(
        session,
        'CREATE',
        'invoice-adjustments',
        adjustmentId,
        `Potongan/klaim ${amount} dicatat untuk ${snapshot.label}`
    );
    return NextResponse.json({ data: { _id: adjustmentId }, id: adjustmentId });
}

export async function handleInvoiceAdjustmentUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const adjustmentId = typeof data.id === 'string' ? data.id : '';
    if (!adjustmentId) {
        return NextResponse.json({ error: 'Adjustment tidak valid' }, { status: 400 });
    }

    const adjustment = await getDocumentById<InvoiceAdjustmentDoc & {
        kind?: string;
        note?: string;
        date?: string;
        customerName?: string;
    }>(adjustmentId, 'invoiceAdjustment');
    if (!adjustment || adjustment._id !== adjustmentId) {
        return NextResponse.json({ error: 'Adjustment tidak ditemukan' }, { status: 404 });
    }
    if (adjustment.status === 'VOID') {
        return NextResponse.json({ error: 'Adjustment yang sudah dihapus tidak bisa diedit' }, { status: 409 });
    }

    const invoiceRef = normalizeText(adjustment.invoiceRef);
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi invoice pada adjustment tidak valid' }, { status: 409 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal klaim/potongan tidak valid' }, { status: 400 });
    }

    const date = typeof data.date === 'string' && data.date ? data.date : adjustment.date || getBusinessDateValue();
    const adjustmentDateError = validateIsoDateOrResponse(date, 'Tanggal klaim/potongan', 'Tanggal klaim/potongan tidak valid');
    if (adjustmentDateError) {
        return adjustmentDateError;
    }

    const kind = typeof data.kind === 'string' ? data.kind as InvoiceAdjustmentKind : adjustment.kind as InvoiceAdjustmentKind;
    if (!INVOICE_ADJUSTMENT_KIND_SET.has(kind)) {
        return NextResponse.json({ error: 'Jenis klaim/potongan tidak valid' }, { status: 400 });
    }

    const note = normalizeOptionalText(data.note);
    const previousAmount = normalizeWholeMoneyAmount(adjustment.amount);

    const snapshot = await loadReceivableSnapshot(invoiceRef);
    if ('error' in snapshot) return snapshot.error;

    const nextAdjustmentAmount = Math.max(snapshot.totalAdjustmentAmount - previousAmount + amount, 0);
    if (nextAdjustmentAmount > snapshot.grossAmount) {
        return NextResponse.json(
                { error: `Total potongan melebihi nilai bruto invoice (${snapshot.grossAmount})` },
            { status: 400 }
        );
    }

    const refundConflict = validateAdjustmentChangeAgainstRefunds(snapshot, nextAdjustmentAmount);
    if (refundConflict) {
        return refundConflict;
    }

    await updateDocument(adjustmentId, sanitizePatchSet({
        date,
        amount,
        kind,
        note,
        editedAt: new Date().toISOString(),
        editedBy: session._id,
        editedByName: session.name,
    }), 'invoiceAdjustment');
    await updateReceivableSnapshot(snapshot, snapshot.totalPaid, nextAdjustmentAmount);
    await postInvoiceAdjustmentJournal(session, {
        ...adjustment,
        date,
        amount,
        kind,
        note,
        status: adjustment.status || 'APPROVED',
    } as InvoiceAdjustment, snapshot.label);

    await addAuditLog(
        session,
        'UPDATE',
        'invoice-adjustments',
        adjustmentId,
        `Potongan/klaim ${adjustmentId} diperbarui untuk ${snapshot.label}`
    );
    return NextResponse.json({ success: true, id: adjustmentId });
}

async function finalizeInvoiceAdjustmentDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
    auditAction: 'UPDATE' | 'DELETE',
    auditVerb: string
) {
    const adjustmentId = typeof data.id === 'string' ? data.id : '';
    if (!adjustmentId) {
        return NextResponse.json({ error: 'Adjustment tidak valid' }, { status: 400 });
    }

    const adjustment = await getDocumentById<InvoiceAdjustmentDoc & {
        kind?: string;
        note?: string;
    }>(adjustmentId, 'invoiceAdjustment');
    if (!adjustment || adjustment._id !== adjustmentId) {
        return NextResponse.json({ error: 'Adjustment tidak ditemukan' }, { status: 404 });
    }
    if (adjustment.status === 'VOID') {
        return NextResponse.json({ error: 'Adjustment sudah dihapus' }, { status: 409 });
    }

    const invoiceRef = normalizeText(adjustment.invoiceRef);
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi invoice pada adjustment tidak valid' }, { status: 409 });
    }

    const snapshot = await loadReceivableSnapshot(invoiceRef);
    if ('error' in snapshot) return snapshot.error;

    const nextAdjustmentAmount = Math.max(snapshot.totalAdjustmentAmount - normalizeNumber(adjustment.amount || 0), 0);
    const refundConflict = validateAdjustmentChangeAgainstRefunds(snapshot, nextAdjustmentAmount);
    if (refundConflict) {
        return refundConflict;
    }

    await updateDocument(adjustmentId, {
        status: 'VOID',
        voidedAt: new Date().toISOString(),
        voidedBy: session._id,
        voidedByName: session.name,
    }, 'invoiceAdjustment');
    await updateReceivableSnapshot(snapshot, snapshot.totalPaid, nextAdjustmentAmount);
    await voidJournalEntryForSource(session, 'INVOICE_ADJUSTMENT', adjustmentId, 'APPROVE');

    await addAuditLog(
        session,
        auditAction,
        'invoice-adjustments',
        adjustmentId,
        `Adjustment ${adjustmentId} ${auditVerb} untuk ${snapshot.label}`
    );
    return NextResponse.json({ success: true });
}

export async function handleInvoiceAdjustmentVoid(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    return finalizeInvoiceAdjustmentDelete(session, data, addAuditLog, 'UPDATE', 'dihapus');
}

export async function handleInvoiceAdjustmentDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    return finalizeInvoiceAdjustmentDelete(session, data, addAuditLog, 'DELETE', 'dihapus');
}

export async function handleCustomerOverpaymentRefund(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const sourceType =
        data.sourceType === 'RECEIPT_UNAPPLIED' || data.sourceType === 'INVOICE_OVERPAID'
            ? data.sourceType
            : null;
    if (!sourceType) {
        return NextResponse.json({ error: 'Sumber kelebihan bayar tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal refund kelebihan bayar tidak valid' }, { status: 400 });
    }

    const refundDate =
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const refundDateError = validateIsoDateOrResponse(refundDate, 'Tanggal refund kelebihan bayar', 'Tanggal refund kelebihan bayar tidak valid');
    if (refundDateError) {
        return refundDateError;
    }

    const bankAccountRef = typeof data.bankAccountRef === 'string' ? data.bankAccountRef : '';
    if (!bankAccountRef) {
        return NextResponse.json({ error: 'Rekening atau kas sumber refund wajib dipilih' }, { status: 400 });
    }

    const note = normalizeOptionalText(data.note);
    const requestedReceiptRef =
        sourceType === 'RECEIPT_UNAPPLIED' && typeof data.sourceReceiptRef === 'string'
            ? data.sourceReceiptRef
            : '';
    const requestedInvoiceRef =
        sourceType === 'INVOICE_OVERPAID' && typeof data.sourceInvoiceRef === 'string'
            ? data.sourceInvoiceRef
            : '';

    if (sourceType === 'RECEIPT_UNAPPLIED' && !requestedReceiptRef) {
        return NextResponse.json({ error: 'Referensi penerimaan customer wajib diisi' }, { status: 400 });
    }
    if (sourceType === 'INVOICE_OVERPAID' && !requestedInvoiceRef) {
        return NextResponse.json({ error: 'Referensi invoice wajib diisi' }, { status: 400 });
    }

    const bankAcc = await getLedgerAccount(bankAccountRef);
    if (!bankAcc) {
        return NextResponse.json({ error: 'Rekening atau kas sumber refund tidak ditemukan' }, { status: 404 });
    }

    let customerRef: string | undefined;
    let customerName = '-';
    let sourceReceiptRef: string | undefined;
    let sourceReceiptNumber: string | undefined;
    let sourceInvoiceRef: string | undefined;
    let sourceInvoiceNumber: string | undefined;
    let openRefundableAmount = 0;
    let receiptPatch:
        | {
            receiptRef: string;
            totalAmount: number;
            allocatedAmount: number;
            nextRefundedOverpaymentAmount: number;
        }
        | undefined;
    let invoicePatch:
        | {
            invoiceRef: string;
            nextTotalPaid: number;
            totalAdjustmentAmount: number;
            snapshot: ReceivableSnapshot;
        }
        | undefined;

    if (sourceType === 'RECEIPT_UNAPPLIED') {
        const receiptSnapshot = await loadReceiptOverpaymentSnapshot(requestedReceiptRef);
        if ('error' in receiptSnapshot) return receiptSnapshot.error;

        sourceReceiptRef = receiptSnapshot.receipt._id;
        sourceReceiptNumber = normalizeOptionalText(receiptSnapshot.receipt.receiptNumber);
        customerRef = normalizeOptionalText(receiptSnapshot.receipt.customerRef) || undefined;
        customerName = normalizeText(receiptSnapshot.receipt.customerName) || '-';
        openRefundableAmount = receiptSnapshot.openOverpaymentAmount;
        receiptPatch = {
            receiptRef: receiptSnapshot.receipt._id,
            totalAmount: receiptSnapshot.totalAmount,
            allocatedAmount: receiptSnapshot.allocatedAmount,
            nextRefundedOverpaymentAmount: Math.min(
                receiptSnapshot.refundedOverpaymentAmount + amount,
                receiptSnapshot.rawOverpaymentAmount
            ),
        };
    } else {
        const snapshot = await loadReceivableSnapshot(requestedInvoiceRef);
        if ('error' in snapshot) return snapshot.error;
        if (snapshot.doc._type !== 'freightNota') {
            return NextResponse.json(
                { error: 'Refund kelebihan bayar aktif hanya didukung untuk invoice ongkos' },
                { status: 409 }
            );
        }

        sourceInvoiceRef = requestedInvoiceRef;
        sourceInvoiceNumber = normalizeOptionalText(snapshot.doc.notaNumber);
        customerRef = snapshot.customerRef;
        customerName = snapshot.customerName;
        openRefundableAmount = snapshot.creditAmount;
        invoicePatch = {
            invoiceRef: requestedInvoiceRef,
            nextTotalPaid: Math.max(snapshot.totalPaid - amount, 0),
            totalAdjustmentAmount: snapshot.totalAdjustmentAmount,
            snapshot,
        };
    }

    if (openRefundableAmount <= 0) {
        return NextResponse.json({ error: 'Tidak ada kelebihan bayar terbuka untuk ditransfer balik' }, { status: 409 });
    }
    if (amount > openRefundableAmount) {
        return NextResponse.json(
            { error: `Nominal refund melebihi kelebihan bayar terbuka (${formatAuditMoney(openRefundableAmount)})` },
            { status: 400 }
        );
    }

    const { startingBalance, nextBalance } = computeLedgerDebitBalance(bankAcc.currentBalance, amount);
    if (nextBalance < 0) {
        return NextResponse.json(
            { error: `Saldo ${bankAcc.bankName} tidak cukup untuk refund. Saldo tersedia ${formatAuditMoney(startingBalance)}` },
            { status: 409 }
        );
    }

    const refundId = crypto.randomUUID();
    const bankTransactionId = crypto.randomUUID();
    const refundDoc: CustomerOverpaymentRefund = {
        _id: refundId,
        _type: 'customerOverpaymentRefund',
        sourceType,
        sourceReceiptRef,
        sourceReceiptNumber,
        sourceInvoiceRef,
        sourceInvoiceNumber,
        customerRef,
        customerName,
        date: refundDate,
        amount,
        bankAccountRef: bankAcc._id,
        bankAccountName: bankAcc.bankName,
        bankAccountNumber: bankAcc.accountNumber,
        bankTransactionRef: bankTransactionId,
        note,
        createdBy: session._id,
        createdByName: session.name,
    };
    await createDocument(refundDoc as unknown as { _type: string; [key: string]: unknown });
    await createDocument({
        _id: bankTransactionId,
        _type: 'bankTransaction',
        bankAccountRef: bankAcc._id,
        bankAccountName: bankAcc.bankName,
        bankAccountNumber: bankAcc.accountNumber,
        type: 'DEBIT',
        amount,
        date: refundDate,
        description:
            sourceType === 'RECEIPT_UNAPPLIED'
                ? `Refund kelebihan bayar customer ${sourceReceiptNumber || sourceReceiptRef || ''}`.trim()
        : `Refund kelebihan bayar invoice ${sourceInvoiceNumber || sourceInvoiceRef || ''}`.trim(),
        balanceAfter: nextBalance,
        relatedOverpaymentRefundRef: refundId,
    });
    // Bank balance update via recompute to ensure consistency
    await recomputeBankLedgerBalancesForAccounts([bankAcc._id]);

    if (receiptPatch) {
        await updateDocument(receiptPatch.receiptRef, buildCustomerReceiptOverpaymentPatch({
            totalAmount: receiptPatch.totalAmount,
            allocatedAmount: receiptPatch.allocatedAmount,
            refundedOverpaymentAmount: receiptPatch.nextRefundedOverpaymentAmount,
        }), 'customerReceipt');
    }

    if (invoicePatch) {
        await updateReceivableSnapshot(
            invoicePatch.snapshot,
            invoicePatch.nextTotalPaid,
            invoicePatch.totalAdjustmentAmount
        );
    }
    await postCustomerOverpaymentRefundJournal(session, refundDoc, bankAcc);

    const refundSourceLabel =
        sourceType === 'RECEIPT_UNAPPLIED'
            ? sourceReceiptNumber || sourceReceiptRef || 'penerimaan customer'
        : sourceInvoiceNumber || sourceInvoiceRef || 'invoice';
    await addAuditLog(
        session,
        'CREATE',
        'customer-overpayment-refunds',
        refundId,
        note
            ? `Refund kelebihan bayar ${formatAuditMoney(amount)} untuk ${refundSourceLabel} via ${bankAcc.bankName} - ${note}`
            : `Refund kelebihan bayar ${formatAuditMoney(amount)} untuk ${refundSourceLabel} via ${bankAcc.bankName}`
    );
    return NextResponse.json({ success: true, id: refundId });
}

export async function handleBankTransfer(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal transfer tidak valid' }, { status: 400 });
    }

    const fromAccountRef = typeof data.fromAccountRef === 'string' ? data.fromAccountRef : '';
    const toAccountRef = typeof data.toAccountRef === 'string' ? data.toAccountRef : '';
    if (!fromAccountRef || !toAccountRef || fromAccountRef === toAccountRef) {
        return NextResponse.json({ error: 'Rekening transfer tidak valid' }, { status: 400 });
    }

    const transferDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue();
    const transferDateError = validateIsoDateOrResponse(transferDate, 'Tanggal transfer', 'Tanggal transfer tidak valid');
    if (transferDateError) {
        return transferDateError;
    }
    const transferDescription = normalizeOptionalText(data.description);

    const transferId = `transfer-${crypto.randomUUID()}`;
    const fromAcc = await getLedgerAccount(fromAccountRef);
    const toAcc = await getLedgerAccount(toAccountRef);
    if (!fromAcc || !toAcc) {
        return NextResponse.json({ error: 'Akun sumber atau tujuan tidak ditemukan' }, { status: 404 });
    }

    const { startingBalance: fromStartingBalance, nextBalance: fromBalance } = computeLedgerDebitBalance(fromAcc.currentBalance, amount);
    if (fromBalance < 0) {
        return NextResponse.json(
            { error: `Saldo ${fromAcc.bankName} tidak cukup untuk transfer. Saldo tersedia ${formatAuditMoney(fromStartingBalance)}` },
            { status: 409 }
        );
    }
    const toBalance = readLedgerBalance(toAcc.currentBalance) + amount;

    await createDocument({
        _id: `${transferId}-out`,
        _type: 'bankTransaction',
        bankAccountRef: fromAccountRef,
        bankAccountName: fromAcc.bankName,
        bankAccountNumber: fromAcc.accountNumber,
        type: 'TRANSFER_OUT',
        amount,
        date: transferDate,
        description: `Transfer ke ${toAcc.bankName}`,
        balanceAfter: fromBalance,
        relatedTransferRef: transferId,
    });
    await createDocument({
        _id: `${transferId}-in`,
        _type: 'bankTransaction',
        bankAccountRef: toAccountRef,
        bankAccountName: toAcc.bankName,
        bankAccountNumber: toAcc.accountNumber,
        type: 'TRANSFER_IN',
        amount,
        date: transferDate,
        description: `Transfer dari ${fromAcc.bankName}`,
        balanceAfter: toBalance,
        relatedTransferRef: transferId,
    });
    await updateDocument(fromAccountRef, { currentBalance: fromBalance }, 'bankAccount');
    await updateDocument(toAccountRef, { currentBalance: toBalance }, 'bankAccount');
    await postBankTransferJournal(session, {
        transferId,
        date: transferDate,
        amount,
        fromAccount: fromAcc,
        toAccount: toAcc,
    });

    await addAuditLog(
        session,
        'CREATE',
        'bank-transactions',
        transferId,
        transferDescription
            ? `Transfer ${formatAuditMoney(amount)} dari ${fromAcc.bankName} ke ${toAcc.bankName} - ${transferDescription}`
            : `Transfer ${formatAuditMoney(amount)} dari ${fromAcc.bankName} ke ${toAcc.bankName}`
    );
    return NextResponse.json({ success: true, transferId });
}

export async function handleExpenseCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const categoryRef = typeof data.categoryRef === 'string' ? data.categoryRef : '';
    if (!categoryRef) {
        return NextResponse.json({ error: 'Kategori pengeluaran wajib dipilih' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pengeluaran tidak valid' }, { status: 400 });
    }

    const expenseDate =
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const expenseDateError = validateIsoDateOrResponse(expenseDate, 'Tanggal pengeluaran', 'Tanggal pengeluaran tidak valid');
    if (expenseDateError) {
        return expenseDateError;
    }

    const category = await getDocumentById<ExpenseCategory>(categoryRef, 'expenseCategory');
    if (!category) {
        return NextResponse.json({ error: 'Kategori pengeluaran tidak ditemukan' }, { status: 404 });
    }
    if (category.active === false) {
        return NextResponse.json({ error: 'Kategori pengeluaran tidak aktif' }, { status: 409 });
    }

    let relatedVehicleRef =
        typeof data.relatedVehicleRef === 'string' && data.relatedVehicleRef ? data.relatedVehicleRef : undefined;
    let relatedVehiclePlate: string | undefined;

    let relatedIncidentRef =
        typeof data.relatedIncidentRef === 'string' && data.relatedIncidentRef ? data.relatedIncidentRef : undefined;
    const relatedIncidentSettlementLineRef =
        typeof data.relatedIncidentSettlementLineRef === 'string' && data.relatedIncidentSettlementLineRef
            ? data.relatedIncidentSettlementLineRef
            : undefined;
    const relatedIncidentSettlementLineRevision =
        typeof data.relatedIncidentSettlementLineRevision === 'string' && data.relatedIncidentSettlementLineRevision
            ? data.relatedIncidentSettlementLineRevision
            : undefined;
    const relatedMaintenanceRef =
        typeof data.relatedMaintenanceRef === 'string' && data.relatedMaintenanceRef ? data.relatedMaintenanceRef : undefined;
    const boronganRef =
        typeof data.boronganRef === 'string' && data.boronganRef ? data.boronganRef : undefined;
    let voucherRef =
        typeof data.voucherRef === 'string' && data.voucherRef ? data.voucherRef : undefined;
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    const incidentExpenseRoute = relatedIncidentSettlementLineRef
        ? normalizeIncidentExpenseRoute(data.incidentExpenseRoute)
        : '';
    if (relatedIncidentSettlementLineRef && !incidentExpenseRoute) {
        return NextResponse.json(
            { error: 'Pilih sumber biaya insiden: masuk uang jalan driver atau pengeluaran perusahaan.' },
            { status: 400 }
        );
    }
    if (incidentExpenseRoute === 'DRIVER_VOUCHER' && selectedAccountRef) {
        return NextResponse.json(
            { error: 'Biaya insiden yang masuk uang jalan driver tidak boleh memilih rekening / kas. Posting tanpa rekening agar masuk bon trip.' },
            { status: 409 }
        );
    }
    if (incidentExpenseRoute === 'COMPANY_EXPENSE' && !selectedAccountRef) {
        return NextResponse.json(
            { error: 'Pengeluaran perusahaan dari insiden wajib memilih rekening / kas pembayaran.' },
            { status: 400 }
        );
    }
    if (relatedIncidentSettlementLineRef && (relatedMaintenanceRef || boronganRef || (incidentExpenseRoute === 'COMPANY_EXPENSE' && voucherRef))) {
        return NextResponse.json(
            { error: 'Posting detail insiden hanya boleh diarahkan ke uang jalan driver atau pengeluaran perusahaan, tidak boleh dicampur dengan workflow lain.' },
            { status: 409 }
        );
    }
    const linkedWorkflowRefs = [relatedIncidentRef, relatedMaintenanceRef, boronganRef, voucherRef].filter(Boolean);
    const isIncidentVoucherExpense =
        incidentExpenseRoute === 'DRIVER_VOUCHER' &&
        Boolean(relatedIncidentSettlementLineRef && relatedIncidentRef && voucherRef) &&
        !relatedMaintenanceRef &&
        !boronganRef;
    if (linkedWorkflowRefs.length > 1 && !isIncidentVoucherExpense) {
        return NextResponse.json(
            { error: 'Pengeluaran hanya boleh dikaitkan ke satu workflow: insiden, maintenance, slip borongan, atau bon trip. Pengecualian hanya biaya insiden yang dipilih masuk uang jalan driver.' },
            { status: 409 }
        );
    }
    const isWorkflowLinkedExpense = linkedWorkflowRefs.length > 0 || Boolean(relatedIncidentSettlementLineRef);
    if (!isWorkflowLinkedExpense && relatedVehicleRef) {
        return NextResponse.json(
            { error: 'Pengeluaran kendaraan wajib dicatat dari maintenance, insiden, atau uang jalan trip agar tidak dobel di laporan.' },
            { status: 409 }
        );
    }
    if (!isWorkflowLinkedExpense && !isManualExpenseCategory(category)) {
        return NextResponse.json(
            { error: 'Kategori ini khusus workflow. Gunakan kategori Pengeluaran Umum untuk input manual.' },
            { status: 409 }
        );
    }

    let incidentSettlementLine:
        | {
            _id: string;
            _rev?: string;
            incidentRef: string;
            lineType?: string;
            status?: string;
            amount?: number;
            description?: string;
            note?: string;
            payeeName?: string;
            linkedExpenseRef?: string;
            linkedDriverVoucherItemRef?: string;
            linkedExpenseRoute?: IncidentExpenseRoute;
            category?: string;
            date?: string;
        }
        | null = null;
    if (relatedIncidentSettlementLineRef) {
        incidentSettlementLine = await getDocumentById<{
            _id: string;
            incidentRef: string;
            lineType?: string;
            status?: string;
            amount?: number;
            description?: string;
            note?: string;
            payeeName?: string;
            linkedExpenseRef?: string;
            linkedDriverVoucherItemRef?: string;
            linkedExpenseRoute?: IncidentExpenseRoute;
            category?: string;
            date?: string;
        }>(relatedIncidentSettlementLineRef, 'incidentSettlementLine');
        if (!incidentSettlementLine) {
            return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
        }
        if (!relatedIncidentSettlementLineRevision) {
            return NextResponse.json(
                { error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        if (incidentSettlementLine.lineType === 'RECOVERY') {
            return NextResponse.json(
                { error: 'Recovery tidak diposting sebagai pengeluaran. Gunakan tandai diterima pada detail insiden.' },
                { status: 409 }
            );
        }
        if (incidentSettlementLine.status !== 'APPROVED') {
            return NextResponse.json(
                { error: 'Hanya detail insiden berstatus disetujui yang boleh diposting ke pengeluaran' },
                { status: 409 }
            );
        }
        if (incidentSettlementLine.linkedExpenseRef) {
            return NextResponse.json(
                { error: 'Detail insiden ini sudah terhubung ke pengeluaran lain' },
                { status: 409 }
            );
        }
        if (amount !== Math.max(normalizeCurrencyNumber(incidentSettlementLine.amount ?? 0), 0)) {
            return NextResponse.json(
                { error: 'Nominal pengeluaran harus sama dengan nominal detail insiden yang diposting' },
                { status: 409 }
            );
        }
        if (relatedIncidentRef && relatedIncidentRef !== incidentSettlementLine.incidentRef) {
            return NextResponse.json(
                { error: 'Insiden pengeluaran tidak cocok dengan detail insiden yang dipilih' },
                { status: 409 }
            );
        }
        relatedIncidentRef = incidentSettlementLine.incidentRef;
    }

    let linkedIncident:
        | {
            _id: string;
            incidentNumber?: string;
            vehicleRef?: string;
            vehiclePlate?: string;
            relatedDeliveryOrderRef?: string;
            relatedDONumber?: string;
        }
        | null = null;
    let linkedMaintenance:
        | {
            _id: string;
            vehicleRef?: string;
            vehiclePlate?: string;
        }
        | null = null;
    if (relatedIncidentRef) {
        const incident = await getDocumentById<{
            _id: string;
            incidentNumber?: string;
            vehicleRef?: string;
            vehiclePlate?: string;
            relatedDeliveryOrderRef?: string;
            relatedDONumber?: string;
        }>(relatedIncidentRef, 'incident');
        if (!incident) {
            return NextResponse.json({ error: 'Insiden terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        linkedIncident = incident;
        if (incident.vehicleRef) {
            if (relatedVehicleRef && incident.vehicleRef !== relatedVehicleRef) {
                return NextResponse.json(
                    { error: 'Kendaraan pengeluaran tidak cocok dengan kendaraan pada insiden terkait' },
                    { status: 409 }
                );
            }
            relatedVehicleRef = incident.vehicleRef;
            relatedVehiclePlate = incident.vehiclePlate || relatedVehiclePlate;
        }
        if (incidentSettlementLine && incidentExpenseRoute === 'DRIVER_VOUCHER' && !voucherRef) {
            const incidentVoucher = await findVoucherForIncidentDeliveryOrder(incident);
            if (incidentVoucher) {
                voucherRef = incidentVoucher._id;
            }
        }
    }

    if (relatedMaintenanceRef) {
        const maintenance = await getDocumentById<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(relatedMaintenanceRef, 'maintenance');
        if (!maintenance) {
            return NextResponse.json({ error: 'Maintenance terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        linkedMaintenance = maintenance;
        if (maintenance.vehicleRef) {
            if (relatedVehicleRef && maintenance.vehicleRef !== relatedVehicleRef) {
                return NextResponse.json(
                    { error: 'Kendaraan pengeluaran tidak cocok dengan kendaraan pada maintenance terkait' },
                    { status: 409 }
                );
            }
            relatedVehicleRef = maintenance.vehicleRef;
            relatedVehiclePlate = maintenance.vehiclePlate || relatedVehiclePlate;
        }
    }

    let linkedBorongan:
        | {
            _id: string;
        }
        | null = null;
    if (boronganRef) {
        linkedBorongan = await getDocumentById<{ _id: string }>(boronganRef, 'driverBorongan');
        if (!linkedBorongan) {
            return NextResponse.json({ error: 'Slip borongan terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
    }

    let linkedVoucher:
        | {
            _id: string;
            deliveryOrderRef?: string;
            status?: string;
            vehicleRef?: string;
            vehiclePlate?: string;
            driverFeeAmount?: number;
            totalIssuedAmount?: number;
            cashGiven?: number;
        }
        | null = null;
    if (voucherRef) {
        const voucher = await getDocumentById<{
            _id: string;
            deliveryOrderRef?: string;
            status?: string;
            vehicleRef?: string;
            vehiclePlate?: string;
            driverFeeAmount?: number;
            totalIssuedAmount?: number;
            cashGiven?: number;
        }>(voucherRef, 'driverVoucher');
        if (!voucher) {
            return NextResponse.json({ error: 'Bon trip terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        if (incidentSettlementLine && voucher.status === 'SETTLED') {
            return NextResponse.json(
                { error: 'Bon trip yang sudah settle tidak bisa menerima biaya insiden baru.' },
                { status: 409 }
            );
        }
        if (
            incidentSettlementLine &&
            linkedIncident?.relatedDeliveryOrderRef &&
            voucher.deliveryOrderRef &&
            voucher.deliveryOrderRef !== linkedIncident.relatedDeliveryOrderRef
        ) {
            return NextResponse.json(
                { error: 'Bon trip tidak cocok dengan DO pada insiden terkait' },
                { status: 409 }
            );
        }
        linkedVoucher = voucher;
        if (voucher.vehicleRef) {
            if (relatedVehicleRef && voucher.vehicleRef !== relatedVehicleRef) {
                return NextResponse.json(
                    { error: 'Kendaraan pengeluaran tidak cocok dengan kendaraan pada bon trip terkait' },
                    { status: 409 }
                );
            }
            relatedVehicleRef = voucher.vehicleRef;
            relatedVehiclePlate = voucher.vehiclePlate || relatedVehiclePlate;
        }
    }

    let linkedVehicle:
        | {
            _id: string;
            plateNumber?: string;
        }
        | null = null;
    if (relatedVehicleRef) {
        linkedVehicle = await getDocumentById<{ _id: string; plateNumber?: string }>(relatedVehicleRef, 'vehicle');
        if (!linkedVehicle) {
            return NextResponse.json({ error: 'Kendaraan terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        relatedVehiclePlate = linkedVehicle.plateNumber || relatedVehiclePlate;
    }

    if (incidentSettlementLine && incidentExpenseRoute === 'DRIVER_VOUCHER') {
        if (!linkedIncident?.relatedDeliveryOrderRef) {
            return NextResponse.json(
                { error: 'Biaya insiden yang masuk uang jalan driver wajib terkait DO / trip.' },
                { status: 409 }
            );
        }
        if (!linkedVoucher) {
            const existingVouchers = await listDocumentsByFilter<DriverVoucher>('driverVoucher', {
                deliveryOrderRef: linkedIncident.relatedDeliveryOrderRef,
            });
            if (existingVouchers.some(voucher => voucher.status === 'SETTLED')) {
                return NextResponse.json(
                    { error: 'Bon trip untuk DO ini sudah settle. Biaya insiden baru tidak bisa dimasukkan ke uang jalan driver; gunakan pengeluaran perusahaan jika perusahaan yang membayar.' },
                    { status: 409 }
                );
            }
        }
    }

    const shouldDeferIncidentTripExpenseToVoucher =
        incidentExpenseRoute === 'DRIVER_VOUCHER' &&
        Boolean(incidentSettlementLine && linkedIncident?.relatedDeliveryOrderRef && !linkedVoucher);
    if (shouldDeferIncidentTripExpenseToVoucher && selectedAccountRef) {
        return NextResponse.json(
            {
                error: 'Bon trip belum terbit. Posting biaya insiden ke uang jalan driver harus tanpa rekening agar otomatis masuk biaya lain-lain saat bon diterbitkan.',
            },
            { status: 409 }
        );
    }

    const hasPrivacyLevel = Object.prototype.hasOwnProperty.call(data, 'privacyLevel');
    const rawPrivacyLevel = normalizeOptionalText(data.privacyLevel);
    if (hasPrivacyLevel && rawPrivacyLevel && rawPrivacyLevel !== 'ownerOnly' && rawPrivacyLevel !== 'internal') {
        return NextResponse.json({ error: 'Level privasi pengeluaran tidak valid' }, { status: 400 });
    }
    if (hasPrivacyLevel && !rawPrivacyLevel) {
        return NextResponse.json({ error: 'Level privasi pengeluaran tidak valid' }, { status: 400 });
    }
    const requestedPrivacyLevel =
        rawPrivacyLevel === 'ownerOnly'
            ? 'ownerOnly'
            : 'internal';
    if (requestedPrivacyLevel === 'ownerOnly' && !hasPermission(session, 'expenses', 'update')) {
        return NextResponse.json({ error: 'Hanya OWNER yang boleh membuat pengeluaran owner-only' }, { status: 403 });
    }
    const privacyLevel = requestedPrivacyLevel;

    let expenseNote = normalizeOptionalText(data.note);
    let expenseDescription = normalizeOptionalText(data.description);
    if (incidentSettlementLine) {
        expenseNote = expenseNote || incidentSettlementLine.note || incidentSettlementLine.payeeName;
        expenseDescription = expenseDescription || incidentSettlementLine.description;
    }
    const expenseDocBase: { _type: 'expense'; [key: string]: unknown } = {
        _type: 'expense',
        categoryRef,
        categoryName: category.name,
        categoryScope: inferExpenseCategoryScope(category),
        accountSystemKey: resolveExpenseCategoryAccountKey(category),
        date: expenseDate,
        amount,
        note: expenseNote,
        description: expenseDescription,
        receiptUrl: normalizeOptionalText(data.receiptUrl),
        privacyLevel,
        relatedVehicleRef,
        relatedVehiclePlate,
        relatedIncidentRef,
        relatedIncidentSettlementLineRef,
        incidentExpenseRoute: incidentExpenseRoute || undefined,
        relatedMaintenanceRef,
        relatedDeliveryOrderRef: linkedIncident?.relatedDeliveryOrderRef,
        relatedDeliveryOrderNumber: linkedIncident?.relatedDONumber,
        boronganRef,
        voucherRef,
    };
    const expenseAuditSummary = buildExpenseAuditSummary({
        amount,
        categoryName: category.name,
        bankName: undefined,
        note: expenseNote,
        description: expenseDescription,
    });

    if (!selectedAccountRef) {
        const expenseId = crypto.randomUUID();
        const now = new Date().toISOString();
        const expenseDoc = {
            _id: expenseId,
            ...expenseDocBase,
        };
        await createDocument(expenseDoc);
        await updateDocument(categoryRef, { updatedAt: now }, 'expenseCategory');
        if (linkedIncident) await updateDocument(linkedIncident._id, { updatedAt: now }, 'incident');
        if (linkedMaintenance) await updateDocument(linkedMaintenance._id, { updatedAt: now }, 'maintenance');
        if (linkedVoucher) await updateDocument(linkedVoucher._id, { updatedAt: now }, 'driverVoucher');
        if (linkedVehicle) await updateDocument(linkedVehicle._id, { updatedAt: now }, 'vehicle');
        if (linkedBorongan) await updateDocument(linkedBorongan._id, { updatedAt: now }, 'driverBorongan');
        if (incidentSettlementLine) {
            const lineRef = relatedIncidentSettlementLineRef as string;
            const linkedDriverVoucherItemRef = incidentExpenseRoute === 'DRIVER_VOUCHER' && linkedIncident && linkedVoucher
                ? await syncIncidentSettlementLineToDriverVoucherItem({
                    voucher: linkedVoucher as DriverVoucher,
                    incident: linkedIncident,
                    line: incidentSettlementLine,
                    expenseId,
                    expenseDate,
                })
                : undefined;
            await updateDocument(lineRef, sanitizePatchSet({
                status: 'POSTED',
                linkedExpenseRef: expenseId,
                linkedDriverVoucherItemRef,
                linkedExpenseDate: expenseDate,
                linkedExpenseAmount: amount,
                linkedExpenseCategoryRef: categoryRef,
                linkedExpenseCategoryName: category.name,
                linkedExpenseRoute: incidentExpenseRoute || undefined,
                postedAt: now,
                postedBy: session._id,
                postedByName: session.name,
                updatedAt: now,
                updatedBy: session._id,
                updatedByName: session.name,
            }), 'incidentSettlementLine');
            await createDocument({
                _id: crypto.randomUUID(),
                _type: 'incidentActionLog',
                incidentRef: incidentSettlementLine.incidentRef,
                timestamp: now,
                note: `Detail insiden diposting ke pengeluaran: ${expenseDescription || expenseNote || category.name || 'Pengeluaran insiden'}`,
                userRef: session._id,
                userName: session.name,
            });
            schedulePostedIncidentSettlementFollowUpReminder({
                line: incidentSettlementLine,
                incident: linkedIncident,
            });
        }
        if (!(incidentSettlementLine && incidentExpenseRoute === 'DRIVER_VOUCHER' && (linkedVoucher || shouldDeferIncidentTripExpenseToVoucher))) {
            await postExpenseJournal(session, expenseDoc as Expense, null);
        }
        await addAuditLog(session, 'CREATE', 'expenses', expenseId, expenseAuditSummary);
        if (incidentSettlementLine) {
            await addAuditLog(
                session,
                'UPDATE',
                'incident-settlement-lines',
                incidentSettlementLine._id,
                `Posted incident settlement line to expense ${expenseId}`
            );
        }
        return NextResponse.json({ data: expenseDoc, id: expenseId });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const bankAcc = await getLedgerAccount(selectedAccountRef);
        if (!bankAcc) {
            return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
        }
        let linkedBoronganForAttempt = linkedBorongan;
        if (boronganRef) {
            linkedBoronganForAttempt = await getDocumentById<{ _id: string }>(boronganRef, 'driverBorongan');
            if (!linkedBoronganForAttempt) {
                return NextResponse.json({ error: 'Slip borongan terkait pengeluaran tidak ditemukan' }, { status: 404 });
            }
        }

        const expenseId = crypto.randomUUID();
        const { startingBalance, nextBalance: newBalance } = computeLedgerDebitBalance(bankAcc.currentBalance, amount);
        if (newBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${bankAcc.bankName} tidak cukup untuk pengeluaran. Saldo tersedia ${formatAuditMoney(startingBalance)}` },
                { status: 409 }
            );
        }
        const expenseDoc = {
            _id: expenseId,
            ...expenseDocBase,
            bankAccountRef: selectedAccountRef,
            bankAccountName: bankAcc.bankName,
            bankAccountNumber: bankAcc.accountNumber,
        };
        const expenseAuditSummaryWithBank = buildExpenseAuditSummary({
            amount,
            categoryName: category.name,
            bankName: bankAcc.bankName,
            note: expenseNote,
            description: expenseDescription,
        });

        const now = new Date().toISOString();
        await createDocument(expenseDoc);
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'bankTransaction',
            bankAccountRef: selectedAccountRef,
            bankAccountName: bankAcc.bankName,
            bankAccountNumber: bankAcc.accountNumber,
            type: 'DEBIT',
            amount,
            date: expenseDate,
            description:
                (typeof data.description === 'string' && data.description) ||
                (typeof data.note === 'string' && data.note) ||
                'Pengeluaran',
            balanceAfter: newBalance,
            relatedExpenseRef: expenseId,
        });
        await updateDocument(categoryRef, { updatedAt: now }, 'expenseCategory');
        // Bank balance update via recompute to ensure consistency
        await recomputeBankLedgerBalancesForAccounts([selectedAccountRef]);
        if (linkedIncident) await updateDocument(linkedIncident._id, { updatedAt: now }, 'incident');
        if (linkedMaintenance) await updateDocument(linkedMaintenance._id, { updatedAt: now }, 'maintenance');
        if (linkedVoucher) await updateDocument(linkedVoucher._id, { updatedAt: now }, 'driverVoucher');
        if (linkedVehicle) await updateDocument(linkedVehicle._id, { updatedAt: now }, 'vehicle');
        if (linkedBoronganForAttempt) await updateDocument(linkedBoronganForAttempt._id, { updatedAt: now }, 'driverBorongan');
        if (incidentSettlementLine && typeof relatedIncidentSettlementLineRef === 'string') {
            const lineRef = relatedIncidentSettlementLineRef;
            const linkedDriverVoucherItemRef = incidentExpenseRoute === 'DRIVER_VOUCHER' && linkedIncident && linkedVoucher
                ? await syncIncidentSettlementLineToDriverVoucherItem({
                    voucher: linkedVoucher as DriverVoucher,
                    incident: linkedIncident,
                    line: incidentSettlementLine,
                    expenseId,
                    expenseDate,
                })
                : undefined;
            await updateDocument(lineRef, sanitizePatchSet({
                status: 'POSTED',
                linkedExpenseRef: expenseId,
                linkedDriverVoucherItemRef,
                linkedExpenseDate: expenseDate,
                linkedExpenseAmount: amount,
                linkedExpenseCategoryRef: categoryRef,
                linkedExpenseCategoryName: category.name,
                linkedExpenseRoute: incidentExpenseRoute || undefined,
                postedAt: now,
                postedBy: session._id,
                postedByName: session.name,
                updatedAt: now,
                updatedBy: session._id,
                updatedByName: session.name,
            }), 'incidentSettlementLine');
            await createDocument({
                _id: crypto.randomUUID(),
                _type: 'incidentActionLog',
                incidentRef: incidentSettlementLine.incidentRef,
                timestamp: now,
                note: `Detail insiden diposting ke pengeluaran: ${expenseDescription || expenseNote || category.name || 'Pengeluaran insiden'}`,
                userRef: session._id,
                userName: session.name,
            });
            schedulePostedIncidentSettlementFollowUpReminder({
                line: incidentSettlementLine,
                incident: linkedIncident,
            });
        }
        if (!(incidentSettlementLine && incidentExpenseRoute === 'DRIVER_VOUCHER' && linkedVoucher)) {
            await postExpenseJournal(session, expenseDoc as Expense, bankAcc);
        }
        await addAuditLog(session, 'CREATE', 'expenses', expenseId, expenseAuditSummaryWithBank);
        if (incidentSettlementLine) {
            await addAuditLog(
                session,
                'UPDATE',
                'incident-settlement-lines',
                incidentSettlementLine._id,
                `Posted incident settlement line to expense ${expenseId}`
            );
        }
        return NextResponse.json({ data: expenseDoc, id: expenseId });
    }
}

export async function handleFreightNotaCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    let billingMode = resolveFreightNotaBillingModeInput(data.billingMode, 'Basis billing invoice', {
        defaultMode: 'PER_KG',
        allowEmpty: !Object.prototype.hasOwnProperty.call(data, 'billingMode'),
    });
    let resolvedCustomerRef = normalizeOptionalText(data.customerRef);
    const customerName = normalizeText(data.customerName);

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    let rows: NormalizedFreightNotaRow[];
    try {
        rows = rawRows
            .filter(isPlainObject)
            .filter(row => !isFreightNotaRowEmpty(row))
            .map<NormalizedFreightNotaRow>(row => {
                const date = normalizeText(row.date);
                const doRef = normalizeOptionalText(row.doRef);
                const deliveryOrderItemRef = normalizeOptionalText(row.deliveryOrderItemRef);
                const deliveryOrderItemRefs = Array.isArray(row.deliveryOrderItemRefs)
                    ? [...new Set(
                        row.deliveryOrderItemRefs
                            .map(value => normalizeOptionalText(value))
                            .filter((value): value is string => Boolean(value))
                    )]
                    : [];
                const normalizedDeliveryOrderItemRefs = deliveryOrderItemRefs.length > 0
                    ? deliveryOrderItemRefs
                    : deliveryOrderItemRef
                        ? [deliveryOrderItemRef]
                        : [];
                const actualDropPointKey = normalizeOptionalText(row.actualDropPointKey);
                if (normalizedDeliveryOrderItemRefs.length > 0 && !doRef) {
                    throw new Error('Baris invoice dari DO wajib punya referensi DO');
                }
                const doNumber = normalizeOptionalText(row.doNumber);
                const noSJ = normalizeText(row.noSJ);
                const tujuan = normalizeText(row.tujuan);
                const dari = normalizeText(row.dari);
                const beratKg = normalizeNumber(row.beratKg);
                const volumeM3 = normalizeNumber(row.volumeM3 ?? 0, { maxFractionDigits: 3 });
                const tarip = normalizeCurrencyNumber(row.tarip);
                const taripSourceInput = normalizeOptionalText(row.taripSource);
                const taripSource = taripSourceInput === 'MASTER' || taripSourceInput === 'MANUAL'
                    ? taripSourceInput
                    : undefined;
                const customerBillingRateRef = normalizeOptionalText(row.customerBillingRateRef);
                const customerBillingRateName = normalizeOptionalText(row.customerBillingRateName);
                const customerBillingRateSnapshot = normalizeCurrencyNumber(row.customerBillingRateSnapshot);
                const collie = parseOptionalStrictNotaRowNumber(
                    row.collie,
                'Collie pada baris invoice tidak valid',
                    { maxFractionDigits: 2 }
                );

                if (date) {
            assertIsoDate(date, 'Tanggal baris invoice');
                }

                if ((!date || !noSJ || !tujuan) && !doRef) {
                throw new Error('Baris invoice wajib punya tanggal, nomor SJ, dan tujuan');
                }
                if ((!Number.isFinite(beratKg) || beratKg <= 0) && billingMode !== 'PER_VOLUME' && billingMode !== 'PER_TRIP' && !doRef) {
                throw new Error('Berat pada baris invoice harus lebih besar dari 0');
                }
                if ((!Number.isFinite(volumeM3) || volumeM3 <= 0) && billingMode === 'PER_VOLUME' && !doRef) {
                throw new Error('Volume pada baris invoice harus lebih besar dari 0');
                }
                if (!Number.isFinite(tarip) || tarip <= 0) {
                throw new Error('Tarif invoice pada baris harus lebih besar dari 0');
                }
                if (!Number.isFinite(collie) || collie < 0) {
                throw new Error('Collie pada baris invoice tidak valid');
                }

                return {
                    doRef,
                    deliveryOrderItemRef: normalizedDeliveryOrderItemRefs[0],
                    deliveryOrderItemRefs: normalizedDeliveryOrderItemRefs.length > 0 ? normalizedDeliveryOrderItemRefs : undefined,
                    actualDropPointKey,
                    customerRef: normalizeOptionalText(row.customerRef),
                    customerName: normalizeOptionalText(row.customerName),
                    doNumber,
                    vehiclePlate: normalizeOptionalText(row.vehiclePlate),
                    date,
                    noSJ,
                    dari,
                    tujuan,
                    barang: normalizeOptionalText(row.barang),
                    collie: collie > 0 ? collie : undefined,
                    beratKg,
                    volumeM3: volumeM3 > 0 ? volumeM3 : undefined,
                    tarip,
                    taripSource,
                    customerBillingRateRef: taripSource === 'MASTER' ? customerBillingRateRef : undefined,
                    customerBillingRateName: taripSource === 'MASTER' ? customerBillingRateName : undefined,
                    customerBillingRateSnapshot: taripSource === 'MASTER' && Number.isFinite(customerBillingRateSnapshot) && customerBillingRateSnapshot > 0
                        ? customerBillingRateSnapshot
                        : undefined,
                    uangRp: normalizeFreightNotaAmount(calculateFreightNotaRowAmount({ beratKg, volumeM3, tarip, billingMode })),
                    ket: normalizeOptionalText(row.ket),
                    ...normalizeFreightNotaLineMeta(row),
                };
            });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Baris invoice tidak valid' },
            { status: 400 }
        );
    }

    if (rows.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 baris invoice wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];

    const deliveryOrders = uniqueDoRefs.length > 0
        ? await listDocumentsByFilter<Array<{
            _id: string;
            _rev?: string;
            status?: string;
            orderRef?: unknown;
            doNumber?: string;
            customerDoNumber?: string;
            customerRef?: unknown;
            customerName?: string;
            vehiclePlate?: string;
            serviceRef?: string;
            vehicleServiceRef?: string;
            pickupAddress?: string;
            receiverAddress?: string;
            shipperReferences?: Array<{
                referenceNumber?: string;
                pickupAddress?: string;
                billingCustomerRef?: unknown;
                billingCustomerName?: string;
                receiverAddress?: string;
            }>;
            actualDropPoints?: Array<{
                shipperReferenceNumber?: string;
                locationName?: string;
                locationAddress?: string;
            }>;
            date?: string;
            freightNotaRef?: unknown;
        }>[number]>('deliveryOrder', { _id: uniqueDoRefs })
        : [];

    if (deliveryOrders.length !== uniqueDoRefs.length) {
        return NextResponse.json({ error: 'Sebagian DO invoice tidak ditemukan' }, { status: 404 });
    }

    const orderRefs = [...new Set(
        deliveryOrders
            .map(item => extractRefId(item.orderRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    const sourceOrders = orderRefs.length > 0
        ? await listDocumentsByFilter<FreightNotaOrderSource>('order', { _id: orderRefs })
        : [];
    const referencedDeliveryOrderItemRefs = [
        ...new Set(
            rows
                .flatMap(row => (
                    Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
                        ? row.deliveryOrderItemRefs
                        : row.deliveryOrderItemRef
                            ? [row.deliveryOrderItemRef]
                            : []
                ))
        ),
    ];
    const allDeliveryOrderItems = uniqueDoRefs.length > 0 || referencedDeliveryOrderItemRefs.length > 0
        ? await getAllDocuments<FreightNotaDeliveryOrderItemSource>('deliveryOrderItem')
        : [];
    const deliveryOrderItems = allDeliveryOrderItems.filter(item => {
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        const itemId = normalizeOptionalText(item._id);
        return (
            (deliveryOrderRef ? uniqueDoRefs.includes(deliveryOrderRef) : false) ||
            (itemId ? referencedDeliveryOrderItemRefs.includes(itemId) : false)
        );
    });

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const orderMap = new Map(sourceOrders.map(order => [order._id, order]));
    const doItemMap = new Map<string, FreightNotaDeliveryOrderItemSource[]>();
    const doItemById = new Map<string, FreightNotaDeliveryOrderItemSource>();
    for (const item of deliveryOrderItems) {
        const itemId = normalizeOptionalText(item._id);
        if (itemId) {
            doItemById.set(itemId, item);
        }
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = doItemMap.get(deliveryOrderRef) || [];
        current.push(item);
        doItemMap.set(deliveryOrderRef, current);
    }
    const builtNotaRowsByDoRef = new Map<string, ReturnType<typeof buildNotaRowsFromDeliveryOrder>>();
    for (const deliveryOrder of deliveryOrders) {
        const linkedOrderRef = extractRefId(deliveryOrder.orderRef);
        const linkedOrder = linkedOrderRef ? orderMap.get(linkedOrderRef) : undefined;
        builtNotaRowsByDoRef.set(
            deliveryOrder._id,
            buildNotaRowsFromDeliveryOrder({
                deliveryOrder: deliveryOrder as DeliveryOrder,
                orders: linkedOrder ? [linkedOrder as Order] : [],
                deliveryOrderItems: (doItemMap.get(deliveryOrder._id) || []) as DeliveryOrderItem[],
            })
        );
    }

    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!deliveryOrder) {
        return NextResponse.json({ error: 'DO invoice tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status === 'CANCELLED') {
            return NextResponse.json({ error: `DO ${deliveryOrder.doNumber || row.doRef} sudah dibatalkan` }, { status: 409 });
        }
        const orderRef = extractRefId(deliveryOrder.orderRef);
        const sourceOrder = orderRef ? orderMap.get(orderRef) : undefined;
        const rowItemRefs = Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
            ? row.deliveryOrderItemRefs
            : row.deliveryOrderItemRef
                ? [row.deliveryOrderItemRef]
                : [];
        const rowItemSources: FreightNotaDeliveryOrderItemSource[] = [];
        for (const itemRef of rowItemRefs) {
            const itemSource = doItemById.get(itemRef);
            if (!itemSource) {
                return NextResponse.json(
                    {
                            error: `Item DO ${itemRef} tidak ditemukan untuk pembuatan invoice`,
                    },
                    { status: 404 }
                );
            }
            const itemDeliveryOrderRef = normalizeOptionalText(itemSource.deliveryOrderRef);
            if (itemDeliveryOrderRef !== row.doRef) {
                return NextResponse.json(
                    {
                        error: `Item DO ${itemRef} bukan milik surat jalan ${deliveryOrder.doNumber || row.doRef}`,
                    },
                    { status: 409 }
                );
            }
            rowItemSources.push(itemSource);
        }
        const itemSummary = rowItemSources.length > 0
            ? summarizeDeliveryOrderItems(rowItemSources)
            : summarizeDeliveryOrderItems(doItemMap.get(row.doRef) || []);
        const resolvedNoSj =
            normalizeOptionalText(row.noSJ) ||
            normalizeOptionalText(deliveryOrder.customerDoNumber) ||
            '';
        const hasActualDropPoints = Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0;
        const destinationItemRef = rowItemRefs.length === 1 ? rowItemRefs[0] : undefined;
        const billableCargoSummary = getDeliveryOrderBillableCargoSummary(deliveryOrder, resolvedNoSj);
        const billableDestinationSummary = getDeliveryOrderActualDropDestinations(deliveryOrder, {
            shipperReferenceNumber: resolvedNoSj,
            billableOnly: true,
            deliveryOrderItemRef: destinationItemRef,
        }).join(', ');
        const matchedBuiltRow = findBuiltNotaRowMatch({
            row,
            deliveryOrder: deliveryOrder as DeliveryOrder,
            builtRows: builtNotaRowsByDoRef.get(row.doRef) || [],
        });

        if (deliveryOrder.status !== 'DELIVERED' && !hasActualDropPoints) {
            return NextResponse.json(
                {
                    error: `DO ${deliveryOrder.doNumber || row.doRef} belum delivered dan belum punya realisasi drop yang bisa ditagihkan`,
                },
                { status: 409 }
            );
        }
        if (hasActualDropPoints && !hasDeliveryOrderBillableCargo(deliveryOrder, resolvedNoSj)) {
            return NextResponse.json(
                {
                    error: `SJ ${resolvedNoSj || deliveryOrder.doNumber || row.doRef} belum punya realisasi drop yang bisa ditagihkan`,
                },
                { status: 409 }
            );
        }
        if (hasActualDropPoints && rowItemRefs.length > 0 && !matchedBuiltRow) {
            return NextResponse.json(
                {
                    error: `Item pada SJ ${resolvedNoSj || deliveryOrder.doNumber || row.doRef} belum punya realisasi drop yang bisa ditagihkan. Jangan tagihkan barang yang masih hold/return.`,
                },
                { status: 409 }
            );
        }

        row.doNumber = normalizeOptionalText(deliveryOrder.doNumber) || row.doNumber;
        row.noSJ = resolvedNoSj;
        const matchedShipperReference = (deliveryOrder.shipperReferences || []).find(reference =>
            normalizeOptionalText(reference.referenceNumber) === row.noSJ
        );
        row.customerRef =
            normalizeOptionalText(row.customerRef) ||
            normalizeOptionalText(matchedShipperReference?.billingCustomerRef) ||
            normalizeOptionalText(deliveryOrder.customerRef) ||
            normalizeOptionalText(sourceOrder?.customerRef);
        row.customerName =
            normalizeOptionalText(row.customerName) ||
            normalizeOptionalText(matchedShipperReference?.billingCustomerName) ||
            normalizeOptionalText(deliveryOrder.customerName) ||
            normalizeOptionalText(sourceOrder?.customerName);
        row.vehiclePlate = normalizeOptionalText(deliveryOrder.vehiclePlate) || row.vehiclePlate;
        row.date = normalizeOptionalText(deliveryOrder.date) || row.date || '';
        row.dari =
            normalizeOptionalText(deliveryOrder.pickupAddress) ||
            normalizeOptionalText(sourceOrder?.pickupAddress) ||
            row.dari ||
            '';
        row.tujuan =
            billableDestinationSummary ||
            normalizeOptionalText(matchedShipperReference?.receiverAddress) ||
            normalizeOptionalText(deliveryOrder.receiverAddress) ||
            normalizeOptionalText(sourceOrder?.receiverAddress) ||
            row.tujuan ||
            '';
        if (matchedBuiltRow) {
            row.customerRef = normalizeOptionalText(matchedBuiltRow.customerRef) || row.customerRef;
            row.customerName = normalizeOptionalText(matchedBuiltRow.customerName) || row.customerName;
            row.noSJ = normalizeOptionalText(matchedBuiltRow.noSJ) || row.noSJ;
            row.dari = normalizeOptionalText(matchedBuiltRow.dari) || row.dari;
            row.tujuan = normalizeOptionalText(matchedBuiltRow.tujuan) || row.tujuan;
            row.barang = normalizeOptionalText(matchedBuiltRow.barang) || row.barang || undefined;
            row.collie = matchedBuiltRow.collie > 0 ? matchedBuiltRow.collie : undefined;
            row.beratKg = matchedBuiltRow.beratKg > 0 ? matchedBuiltRow.beratKg : row.beratKg;
            row.volumeM3 = (matchedBuiltRow.volumeM3 || 0) > 0 ? matchedBuiltRow.volumeM3 : row.volumeM3;
        } else {
            row.barang = itemSummary.barang || row.barang || undefined;
            if (hasActualDropPoints ? billableCargoSummary.qtyKoli > 0 : itemSummary.collie > 0) {
                row.collie = hasActualDropPoints ? billableCargoSummary.qtyKoli : itemSummary.collie;
            } else if (!row.collie || row.collie <= 0) {
                row.collie = undefined;
            }
            if (hasActualDropPoints ? billableCargoSummary.weightKg > 0 : itemSummary.beratKg > 0) {
                row.beratKg = hasActualDropPoints ? billableCargoSummary.weightKg : itemSummary.beratKg;
            } else if (!Number.isFinite(row.beratKg) || row.beratKg <= 0) {
                row.beratKg = hasActualDropPoints ? billableCargoSummary.weightKg : itemSummary.beratKg;
            }
            if (hasActualDropPoints ? billableCargoSummary.volumeM3 > 0 : itemSummary.volumeM3 > 0) {
                row.volumeM3 = hasActualDropPoints ? billableCargoSummary.volumeM3 : itemSummary.volumeM3;
            } else if (!Number.isFinite(row.volumeM3 || 0) || (row.volumeM3 || 0) <= 0) {
                row.volumeM3 = hasActualDropPoints ? billableCargoSummary.volumeM3 : itemSummary.volumeM3;
            }
        }
        row.uangRp = normalizeFreightNotaAmount(
            calculateFreightNotaRowAmount({ beratKg: row.beratKg, volumeM3: row.volumeM3, tarip: row.tarip, billingMode })
        );
    }

    const billingRateCustomerRefs = [...new Set(
        rows
            .map(row => normalizeOptionalText(row.customerRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    const customerBillingRates = billingRateCustomerRefs.length > 0
        ? (await listDocumentsByFilter<{
            _id: string;
            customerRef?: string;
            serviceRef?: string;
            basis?: string;
            rate?: number;
            routeFrom?: string;
            routeTo?: string;
            active?: boolean;
        }>('customerBillingRate', { customerRef: billingRateCustomerRefs })).filter(rate => rate.active !== false)
        : [];
    for (const row of rows) {
        if (row.tarip > 0) continue;
        const deliveryOrder = row.doRef ? deliveryOrderMap.get(row.doRef) : undefined;
        const matchedRate = findMatchingCustomerBillingRate(customerBillingRates, {
            customerRef: row.customerRef,
            serviceRef: deliveryOrder?.vehicleServiceRef || deliveryOrder?.serviceRef,
            basis: billingMode,
            routeFrom: row.dari,
            routeTo: row.tujuan,
        });
        if (matchedRate?.rate && matchedRate.rate > 0) {
            row.tarip = matchedRate.rate;
            row.uangRp = normalizeFreightNotaAmount(
                calculateFreightNotaRowAmount({ beratKg: row.beratKg, volumeM3: row.volumeM3, tarip: row.tarip, billingMode })
            );
        }
    }

    const payloadCoverageByDoRef = new Map<string, { deliveryOrderItemRefs: Set<string>; rowKeys: Set<string> }>();
    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        const rowItemRefs = Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
            ? row.deliveryOrderItemRefs
            : row.deliveryOrderItemRef
                ? [row.deliveryOrderItemRef]
                : [];
        const actualDropPointKey = normalizeOptionalText(row.actualDropPointKey);
        const rowCoverageKeys = rowItemRefs.length > 0
            ? rowItemRefs.map(itemRef => buildFreightNotaPayloadItemCoverageKey({
                doRef: row.doRef,
                itemRef,
                tujuan: row.tujuan,
                actualDropPointKey,
            }))
            : deliveryOrder
                ? buildFreightNotaCoverageRowKeys({
                    deliveryOrder: deliveryOrder as DeliveryOrder,
                    noSJ: row.noSJ,
                    deliveryOrderItemRefs: rowItemRefs,
                })
                : [];
        const rowKeys = rowCoverageKeys.length > 0
            ? rowCoverageKeys
            : [`${row.doRef}::${normalizeOptionalText(row.noSJ) || '-'}`];
        const coverage = payloadCoverageByDoRef.get(row.doRef) || {
            deliveryOrderItemRefs: new Set<string>(),
            rowKeys: new Set<string>(),
        };
        if (rowKeys.some(rowKey => coverage.rowKeys.has(rowKey))) {
            return NextResponse.json(
                { error: `SJ ${row.noSJ || '-'} pada DO ${deliveryOrder?.doNumber || row.doRef} duplikat dalam payload invoice` },
                { status: 409 }
            );
        }
        for (const itemRef of rowItemRefs) {
            const itemDestinationKey = buildFreightNotaPayloadItemDestinationKey({
                itemRef,
                tujuan: row.tujuan,
                actualDropPointKey,
            });
            if (coverage.deliveryOrderItemRefs.has(itemDestinationKey)) {
                return NextResponse.json(
                    {
                        error: `Item DO ${itemRef} duplikat dalam payload invoice`,
                    },
                    { status: 400 }
                );
            }
        }
        rowKeys.forEach(rowKey => coverage.rowKeys.add(rowKey));
        rowItemRefs.forEach(itemRef => coverage.deliveryOrderItemRefs.add(buildFreightNotaPayloadItemDestinationKey({
            itemRef,
            tujuan: row.tujuan,
            actualDropPointKey,
        })));
        payloadCoverageByDoRef.set(row.doRef, coverage);
    }

    for (const row of rows) {
        if (!row.date || !row.noSJ || !row.tujuan) {
            return NextResponse.json(
                { error: `Baris invoice ${row.doNumber || row.noSJ || row.doRef || ''} masih kurang tanggal, nomor SJ, atau tujuan` },
                { status: 400 }
            );
        }
        if ((!Number.isFinite(row.beratKg) || row.beratKg <= 0) && billingMode !== 'PER_VOLUME' && billingMode !== 'PER_TRIP') {
            return NextResponse.json(
                { error: `Berat pada baris invoice ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        if ((!Number.isFinite(row.volumeM3 || 0) || (row.volumeM3 || 0) <= 0) && billingMode === 'PER_VOLUME') {
            return NextResponse.json(
                { error: `Volume pada baris invoice ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            return NextResponse.json(
                { error: `Tarif invoice pada baris ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        row.uangRp = normalizeFreightNotaAmount(
            calculateFreightNotaRowAmount({ beratKg: row.beratKg, volumeM3: row.volumeM3, tarip: row.tarip, billingMode })
        );
    }

    if (uniqueDoRefs.length > 0) {
        const existingNotaItems = await listDocumentsByFilter<Array<{
            doRef?: string;
            doNumber?: string;
            noSJ?: string;
            tujuan?: string;
            deliveryOrderItemRef?: string;
            deliveryOrderItemRefs?: string[];
            actualDropPointKey?: string;
            status?: string;
        }>[number]>('freightNotaItem', { doRef: uniqueDoRefs });
        const existingItemUsage = new Map<string, { doRef?: string; doNumber?: string; noSJ?: string }>();
        const existingRowKeys = new Set<string>();
        for (const item of existingNotaItems.filter(item => item.status !== 'VOID')) {
            const existingDoRef = normalizeOptionalText(item.doRef);
            const existingNoSJ = normalizeOptionalText(item.noSJ);
            const existingItemRefs = Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
                ? item.deliveryOrderItemRefs
                : item.deliveryOrderItemRef
                    ? [item.deliveryOrderItemRef]
                    : [];
            const existingActualDropPointKey = normalizeOptionalText(item.actualDropPointKey);
            if (existingDoRef && existingNoSJ) {
                const matchedDeliveryOrder = deliveryOrderMap.get(existingDoRef);
                if (matchedDeliveryOrder) {
                    const existingDestination = normalizeOptionalText(item.tujuan) || '-';
                    const rowKeys = existingItemRefs.length > 0
                        ? existingItemRefs.flatMap(itemRef => {
                            const keys = [buildFreightNotaPayloadItemCoverageKey({
                                doRef: existingDoRef,
                                itemRef,
                                tujuan: existingDestination,
                                actualDropPointKey: existingActualDropPointKey,
                            })];
                            if (!existingActualDropPointKey) {
                                keys.push(buildFreightNotaLegacyItemCoverageKey({
                                    doRef: existingDoRef,
                                    itemRef,
                                    tujuan: existingDestination,
                                }));
                            }
                            return keys;
                        })
                        : buildFreightNotaCoverageRowKeys({
                            deliveryOrder: matchedDeliveryOrder,
                            noSJ: existingNoSJ,
                            deliveryOrderItemRefs: existingItemRefs,
                        });
                    rowKeys.forEach(rowKey => existingRowKeys.add(rowKey));
                } else {
                    if (existingItemRefs.length > 0) {
                        existingItemRefs.forEach(itemRef => {
                            existingRowKeys.add(buildFreightNotaPayloadItemCoverageKey({
                                doRef: existingDoRef,
                                itemRef,
                                tujuan: item.tujuan,
                                actualDropPointKey: existingActualDropPointKey,
                            }));
                            if (!existingActualDropPointKey) {
                                existingRowKeys.add(buildFreightNotaLegacyItemCoverageKey({
                                    doRef: existingDoRef,
                                    itemRef,
                                    tujuan: item.tujuan,
                                }));
                            }
                        });
                    } else {
                        existingRowKeys.add(`${existingDoRef}::${existingNoSJ}`);
                    }
                }
            }
            for (const itemRef of existingItemRefs.map(value => normalizeOptionalText(value)).filter((value): value is string => Boolean(value))) {
                const exactUsageKey = buildFreightNotaPayloadItemDestinationKey({
                    itemRef,
                    tujuan: item.tujuan,
                    actualDropPointKey: existingActualDropPointKey,
                });
                existingItemUsage.set(exactUsageKey, {
                    doRef: existingDoRef,
                    doNumber: normalizeOptionalText(item.doNumber) || undefined,
                    noSJ: normalizeOptionalText(item.noSJ) || undefined,
                });
                if (!existingActualDropPointKey) {
                    existingItemUsage.set(buildFreightNotaLegacyItemDestinationKey({
                        itemRef,
                        tujuan: item.tujuan,
                    }), {
                        doRef: existingDoRef,
                        doNumber: normalizeOptionalText(item.doNumber) || undefined,
                        noSJ: normalizeOptionalText(item.noSJ) || undefined,
                    });
                }
            }
        }
        for (const row of rows) {
            if (!row.doRef) continue;
            const rowItemRefs = Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
                ? row.deliveryOrderItemRefs
                : row.deliveryOrderItemRef
                    ? [row.deliveryOrderItemRef]
                    : [];
            const rowDeliveryOrder = deliveryOrderMap.get(row.doRef);
            if (!rowDeliveryOrder) {
        return NextResponse.json({ error: 'DO invoice tidak ditemukan' }, { status: 404 });
            }
            const actualDropPointKey = normalizeOptionalText(row.actualDropPointKey);
            const rowKeys = rowItemRefs.length > 0
                ? rowItemRefs.flatMap(itemRef => {
                    const keys = [buildFreightNotaPayloadItemCoverageKey({
                        doRef: row.doRef,
                        itemRef,
                        tujuan: row.tujuan,
                        actualDropPointKey,
                    })];
                    if (actualDropPointKey) {
                        keys.push(buildFreightNotaLegacyItemCoverageKey({
                            doRef: row.doRef,
                            itemRef,
                            tujuan: row.tujuan,
                        }));
                    }
                    return keys;
                })
                : buildFreightNotaCoverageRowKeys({
                    deliveryOrder: rowDeliveryOrder,
                    noSJ: row.noSJ,
                    deliveryOrderItemRefs: rowItemRefs,
                });
            if (rowKeys.some(rowKey => existingRowKeys.has(rowKey))) {
                return NextResponse.json(
                    { error: `SJ ${row.noSJ || '-'} pada DO ${row.doNumber || row.doRef} sudah masuk invoice lain` },
                    { status: 409 }
                );
            }
            for (const itemRef of rowItemRefs) {
                const existingUsage = existingItemUsage.get(buildFreightNotaPayloadItemDestinationKey({
                    itemRef,
                    tujuan: row.tujuan,
                    actualDropPointKey,
                })) || (actualDropPointKey
                    ? existingItemUsage.get(buildFreightNotaLegacyItemDestinationKey({
                        itemRef,
                        tujuan: row.tujuan,
                    }))
                    : undefined);
                if (existingUsage) {
                    return NextResponse.json(
                    { error: `SJ ${existingUsage.noSJ || row.noSJ || '-'} pada DO ${existingUsage.doNumber || existingUsage.doRef || row.doRef} sudah masuk invoice lain` },
                        { status: 409 }
                    );
                }
            }
        }
    }

    const inferredCustomerRefs = [...new Set(
        rows
            .map(row => normalizeOptionalText(row.customerRef))
            .filter((ref): ref is string => Boolean(ref))
    )];

    if (inferredCustomerRefs.length > 1) {
        return NextResponse.json(
                    { error: 'DO yang dipilih berasal dari customer berbeda. Pisahkan per invoice.' },
            { status: 409 }
        );
    }

    const inferredCustomerRef = inferredCustomerRefs[0];
    if (resolvedCustomerRef && inferredCustomerRef && resolvedCustomerRef !== inferredCustomerRef) {
        return NextResponse.json(
                { error: 'Customer invoice tidak cocok dengan customer pada DO yang dipilih' },
            { status: 409 }
        );
    }
    if (!resolvedCustomerRef && inferredCustomerRef) {
        resolvedCustomerRef = inferredCustomerRef;
    }

    if (resolvedCustomerRef) {
        const mismatchedRow = rows.find(row => row.customerRef && row.customerRef !== resolvedCustomerRef);
        if (mismatchedRow) {
            return NextResponse.json(
                { error: `SJ ${mismatchedRow.noSJ || '-'} memakai customer invoice berbeda dari invoice ini` },
                { status: 409 }
            );
        }
    }

    const issueDate = normalizeText(data.issueDate) || getBusinessDateValue();
    const issueDateError = validateIsoDateOrResponse(issueDate, 'Tanggal invoice', 'Tanggal invoice tidak valid');
    if (issueDateError) {
        return issueDateError;
    }
    const customerDerivedFromDo = Boolean(inferredCustomerRef && inferredCustomerRef === resolvedCustomerRef && deliveryOrders.length > 0);
    let finalCustomerName = customerName || rows.find(row => normalizeOptionalText(row.customerName))?.customerName || '';
    let finalCustomerAddress = normalizeOptionalText(data.customerAddress);
    let finalCustomerContactPerson = normalizeOptionalText(data.customerContactPerson);
    let finalCustomerPhone = normalizeOptionalText(data.customerPhone);
    let customerTermDays: number | null = null;
    let linkedCustomer: {
        _id: string;
        _rev?: string;
        name?: string;
        address?: string;
        contactPerson?: string;
        phone?: string;
        defaultPaymentTerm?: number;
        defaultFreightNotaBillingMode?: string;
        defaultPph23Enabled?: boolean;
        defaultPph23RatePercent?: number;
        defaultPph23BaseMode?: string;
        active?: boolean;
    } | null = null;
    let customerPph23Defaults: {
        enabled: boolean;
        ratePercent: number;
        baseMode: Pph23BaseMode;
    } | null = null;
    if (resolvedCustomerRef) {
        const customerDoc = await getDocumentById<{
            _id: string;
            name?: string;
            address?: string;
            contactPerson?: string;
            phone?: string;
            defaultPaymentTerm?: number;
            defaultFreightNotaBillingMode?: string;
            defaultPph23Enabled?: boolean;
            defaultPph23RatePercent?: number;
            defaultPph23BaseMode?: string;
            active?: boolean;
        }>(resolvedCustomerRef, 'customer');
        if (!customerDoc) {
        return NextResponse.json({ error: 'Customer invoice tidak ditemukan' }, { status: 404 });
        }
        linkedCustomer = customerDoc;
        if (customerDoc.active === false && !customerDerivedFromDo) {
        return NextResponse.json({ error: 'Customer invoice tidak aktif untuk invoice manual' }, { status: 409 });
        }
        if (customerDoc?.name) {
            finalCustomerName = customerDoc.name;
        }
        finalCustomerAddress = normalizeOptionalText(customerDoc?.address) || finalCustomerAddress;
        finalCustomerContactPerson = normalizeOptionalText(customerDoc?.contactPerson) || finalCustomerContactPerson;
        finalCustomerPhone = normalizeOptionalText(customerDoc?.phone) || finalCustomerPhone;
        if (typeof customerDoc?.defaultPaymentTerm === 'number' && Number.isFinite(customerDoc.defaultPaymentTerm) && customerDoc.defaultPaymentTerm >= 0) {
            customerTermDays = customerDoc.defaultPaymentTerm;
        }
        customerPph23Defaults = {
            enabled: normalizePph23Enabled(customerDoc?.defaultPph23Enabled),
            ratePercent: normalizePph23RatePercent(customerDoc?.defaultPph23RatePercent, DEFAULT_PPH23_RATE_PERCENT),
            baseMode: normalizePph23BaseMode(customerDoc?.defaultPph23BaseMode, 'BEFORE_CLAIM'),
        };
        if (!Object.prototype.hasOwnProperty.call(data, 'billingMode')) {
            billingMode = normalizeFreightNotaBillingMode(customerDoc?.defaultFreightNotaBillingMode);
            for (const row of rows) {
                row.uangRp = normalizeFreightNotaAmount(
                    calculateFreightNotaRowAmount({ beratKg: row.beratKg, volumeM3: row.volumeM3, tarip: row.tarip, billingMode })
                );
            }
        }
    }
    if (!finalCustomerName) {
        return NextResponse.json({ error: 'Nama customer invoice wajib diisi' }, { status: 400 });
    }

    const totalAmount = normalizeFreightNotaAmount(rows.reduce((sum, row) => sum + row.uangRp, 0));
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    const totalVolumeM3 = rows.reduce((sum, row) => sum + (row.volumeM3 || 0), 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total invoice harus lebih besar dari 0' }, { status: 400 });
    }
    let pph23Settings: {
        pph23Enabled: boolean;
        pph23RatePercent: number;
        pph23BaseMode: Pph23BaseMode;
    };
    try {
        pph23Settings = normalizePph23SettingsInput(data, customerPph23Defaults ? {
            enabled: customerPph23Defaults.enabled,
            ratePercent: customerPph23Defaults.ratePercent,
            baseMode: customerPph23Defaults.baseMode,
        } : undefined);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Pengaturan PPh 23 tidak valid' },
            { status: 400 }
        );
    }
    const initialReceivablePatch = buildReceivablePatch(
        {
            grossAmount: totalAmount,
            pph23Enabled: pph23Settings.pph23Enabled,
            pph23RatePercent: pph23Settings.pph23RatePercent,
            pph23BaseMode: pph23Settings.pph23BaseMode,
        },
        0,
        0,
    );

    const notaId = crypto.randomUUID();
    const notaNumber = await getNextNumber('nota', issueDate);
    const {
        instructionAccounts,
        notaSeriesCode,
        footerNote,
        issuerCompanyName,
        issuerCompanyAddress,
        issuerCompanyPhone,
        issuerCompanyEmail,
        issuerCompanyLogoUrl,
        issuerCompanySignatureStampUrl,
        issuerCompanySignatureName,
        issuerCompanyNpwp,
    } = await loadFreightNotaDocumentSettings();
    const notaDisplayNumber = buildFreightNotaDisplayNumberFromParts(
        notaNumber,
        issueDate,
        notaSeriesCode,
    );
    let resolvedDueDate = normalizeOptionalText(data.dueDate);
    if (resolvedDueDate) {
        const dueDateError = validateIsoDateOrResponse(
            resolvedDueDate,
        'Tanggal jatuh tempo invoice',
        'Tanggal jatuh tempo invoice tidak valid'
        );
        if (dueDateError) {
            return dueDateError;
        }
    }
    if (!resolvedDueDate) {
        let termDays = customerTermDays;
        if (termDays === null) {
            const companyDoc = await getCompanyProfile<{
                invoiceSettings?: {
                    dueDateDays?: number;
                    defaultTermDays?: number;
                };
            }>();
            const companyTerm = companyDoc?.invoiceSettings?.dueDateDays ?? companyDoc?.invoiceSettings?.defaultTermDays;
            if (typeof companyTerm === 'number' && Number.isFinite(companyTerm) && companyTerm >= 0) {
                termDays = companyTerm;
            }
        }

        if (termDays !== null) {
            resolvedDueDate = addDaysToDateValue(issueDate, termDays);
        }
    }

    const notaDoc = {
        _id: notaId,
        _type: 'freightNota',
        issuerCompanyName,
        issuerCompanyAddress,
        issuerCompanyPhone,
        issuerCompanyEmail,
        issuerCompanyLogoUrl,
        issuerCompanySignatureStampUrl,
        issuerCompanySignatureName,
        issuerCompanyNpwp,
        customerRef: resolvedCustomerRef,
        customerName: finalCustomerName,
        customerAddress: finalCustomerAddress,
        customerContactPerson: finalCustomerContactPerson,
        customerPhone: finalCustomerPhone,
        issueDate,
        notaDisplayNumber,
        dueDate: resolvedDueDate,
        status: 'UNPAID',
        totalAmount,
        totalAdjustmentAmount: 0,
        pph23Enabled: pph23Settings.pph23Enabled,
        pph23RatePercent: pph23Settings.pph23RatePercent,
        pph23BaseMode: pph23Settings.pph23BaseMode,
        pph23BaseAmount: initialReceivablePatch.pph23BaseAmount,
        pph23Amount: initialReceivablePatch.pph23Amount,
        netAmount: initialReceivablePatch.netAmount,
        totalCollie,
        totalWeightKg,
        totalVolumeM3,
        billingMode,
        instructionAccounts: instructionAccounts.length > 0 ? instructionAccounts : undefined,
        footerNote,
        notes: normalizeOptionalText(data.notes),
        notaNumber,
    };

    await createDocument(notaDoc);
    if (linkedCustomer) {
        await updateDocument(linkedCustomer._id, { updatedAt: new Date().toISOString() }, 'customer');
    }
    await Promise.all(rows.map(row => createDocument({
            _id: crypto.randomUUID(),
            _type: 'freightNotaItem',
            notaRef: notaId,
            doRef: row.doRef,
            deliveryOrderItemRef: row.deliveryOrderItemRef,
            deliveryOrderItemRefs: row.deliveryOrderItemRefs,
            actualDropPointKey: row.actualDropPointKey,
            customerRef: row.customerRef,
            customerName: row.customerName,
            doNumber: row.doNumber,
            vehiclePlate: row.vehiclePlate,
            date: row.date,
            noSJ: row.noSJ,
            dari: row.dari,
            tujuan: row.tujuan,
            barang: row.barang,
            collie: row.collie,
            beratKg: row.beratKg,
            volumeM3: row.volumeM3,
            tarip: row.tarip,
            taripSource: row.taripSource,
            customerBillingRateRef: row.customerBillingRateRef,
            customerBillingRateName: row.customerBillingRateName,
            customerBillingRateSnapshot: row.customerBillingRateSnapshot,
            uangRp: row.uangRp,
            ket: row.ket,
            plt: row.plt,
            pc: row.pc,
            kbl: row.kbl,
            invoiceLineDate: row.invoiceLineDate,
            status: 'ACTIVE',
        })));
    await syncFreightNotaDeliveryOrderLinks({
        notaId,
        notaNumber,
        nextDeliveryOrderRefs: uniqueDoRefs,
    });
    await postFreightNotaIssueJournal(session, notaDoc as FreightNota);
    await addAuditLog(session, 'CREATE', 'freight-notas', notaId, `Created freight-notas: ${notaNumber}`);
    return NextResponse.json({ data: notaDoc, id: notaId });
}

export async function handleFreightNotaUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const notaId = typeof data.id === 'string' ? data.id : '';
    if (!notaId) {
        return NextResponse.json({ error: 'Invoice tidak valid' }, { status: 400 });
    }

    const snapshot = await loadReceivableSnapshot(notaId);
    if ('error' in snapshot) return snapshot.error;
    if (snapshot.doc._type !== 'freightNota') {
        return NextResponse.json({ error: 'Revisi hanya tersedia untuk invoice ongkos angkut' }, { status: 409 });
    }
    if (snapshot.paidBeforeRefund > 0 || snapshot.refundedOverpaymentAmount > 0 || snapshot.totalAdjustmentAmount > 0) {
        return NextResponse.json(
            { error: 'Invoice tidak bisa direvisi setelah ada pembayaran, refund, atau klaim/potongan aktif' },
            { status: 409 }
        );
    }

    let billingMode = resolveFreightNotaBillingModeInput(data.billingMode, 'Basis billing invoice', {
        defaultMode: normalizeFreightNotaBillingMode(snapshot.doc.billingMode),
        allowEmpty: !Object.prototype.hasOwnProperty.call(data, 'billingMode'),
    });
    let resolvedCustomerRef = normalizeOptionalText(data.customerRef) || snapshot.customerRef;
    const customerName = normalizeText(data.customerName) || snapshot.customerName;
    const normalizedNotes = normalizeOptionalText(data.notes);
    const issueDate = normalizeText(data.issueDate) || normalizeOptionalText(snapshot.doc.issueDate) || getBusinessDateValue();
    const issueDateError = validateIsoDateOrResponse(issueDate, 'Tanggal invoice', 'Tanggal invoice tidak valid');
    if (issueDateError) {
        return issueDateError;
    }

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    let rows: NormalizedFreightNotaRow[];
    try {
        rows = rawRows
            .filter(isPlainObject)
            .filter(row => !isFreightNotaRowEmpty(row))
            .map<NormalizedFreightNotaRow>(row => {
                const date = normalizeText(row.date);
                const doRef = normalizeOptionalText(row.doRef);
                const deliveryOrderItemRef = normalizeOptionalText(row.deliveryOrderItemRef);
                const deliveryOrderItemRefs = Array.isArray(row.deliveryOrderItemRefs)
                    ? [...new Set(
                        row.deliveryOrderItemRefs
                            .map(value => normalizeOptionalText(value))
                            .filter((value): value is string => Boolean(value))
                    )]
                    : [];
                const normalizedDeliveryOrderItemRefs = deliveryOrderItemRefs.length > 0
                    ? deliveryOrderItemRefs
                    : deliveryOrderItemRef
                        ? [deliveryOrderItemRef]
                        : [];
                const actualDropPointKey = normalizeOptionalText(row.actualDropPointKey);
                if (normalizedDeliveryOrderItemRefs.length > 0 && !doRef) {
                    throw new Error('Baris invoice dari DO wajib punya referensi DO');
                }
                const collie = parseOptionalStrictNotaRowNumber(
                    row.collie,
                'Collie pada baris invoice tidak valid',
                    { maxFractionDigits: 2 }
                );
                const beratKg = normalizeNumber(row.beratKg);
                const volumeM3 = normalizeNumber(row.volumeM3 ?? 0, { maxFractionDigits: 3 });
                const tarip = normalizeCurrencyNumber(row.tarip);
                const taripSourceInput = normalizeOptionalText(row.taripSource);
                const taripSource = taripSourceInput === 'MASTER' || taripSourceInput === 'MANUAL'
                    ? taripSourceInput
                    : undefined;
                const customerBillingRateRef = normalizeOptionalText(row.customerBillingRateRef);
                const customerBillingRateName = normalizeOptionalText(row.customerBillingRateName);
                const customerBillingRateSnapshot = normalizeCurrencyNumber(row.customerBillingRateSnapshot);

            assertIsoDate(date, 'Tanggal baris invoice');
                if (!normalizeText(row.noSJ) || !normalizeText(row.tujuan)) {
                throw new Error('Baris invoice wajib punya nomor SJ dan tujuan');
                }
                if ((!Number.isFinite(beratKg) || beratKg <= 0) && billingMode !== 'PER_VOLUME' && billingMode !== 'PER_TRIP') {
                throw new Error('Berat pada baris invoice harus lebih besar dari 0');
                }
                if ((!Number.isFinite(volumeM3) || volumeM3 <= 0) && billingMode === 'PER_VOLUME') {
                throw new Error('Volume pada baris invoice harus lebih besar dari 0');
                }
                if ((!Number.isFinite(tarip) || tarip <= 0) && !doRef) {
                throw new Error('Tarif invoice pada baris harus lebih besar dari 0');
                }
                if (!Number.isFinite(collie) || collie < 0) {
                throw new Error('Collie pada baris invoice tidak valid');
                }

                return {
                    doRef,
                    deliveryOrderItemRef: normalizedDeliveryOrderItemRefs[0],
                    deliveryOrderItemRefs: normalizedDeliveryOrderItemRefs.length > 0 ? normalizedDeliveryOrderItemRefs : undefined,
                    actualDropPointKey,
                    customerRef: normalizeOptionalText(row.customerRef),
                    customerName: normalizeOptionalText(row.customerName),
                    doNumber: normalizeOptionalText(row.doNumber),
                    vehiclePlate: normalizeOptionalText(row.vehiclePlate),
                    date,
                    noSJ: normalizeText(row.noSJ),
                    dari: normalizeText(row.dari),
                    tujuan: normalizeText(row.tujuan),
                    barang: normalizeOptionalText(row.barang),
                    collie: collie > 0 ? collie : undefined,
                    beratKg,
                    volumeM3: volumeM3 > 0 ? volumeM3 : undefined,
                    tarip: Number.isFinite(tarip) && tarip > 0 ? tarip : 0,
                    taripSource,
                    customerBillingRateRef: taripSource === 'MASTER' ? customerBillingRateRef : undefined,
                    customerBillingRateName: taripSource === 'MASTER' ? customerBillingRateName : undefined,
                    customerBillingRateSnapshot: taripSource === 'MASTER' && Number.isFinite(customerBillingRateSnapshot) && customerBillingRateSnapshot > 0
                        ? customerBillingRateSnapshot
                        : undefined,
                    uangRp: normalizeFreightNotaAmount(calculateFreightNotaRowAmount({ beratKg, volumeM3, tarip, billingMode })),
                    ket: normalizeOptionalText(row.ket),
                    ...normalizeFreightNotaLineMeta(row),
                };
            });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Baris invoice tidak valid' },
            { status: 400 }
        );
    }

    if (rows.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 baris invoice wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];
    const deliveryOrders = uniqueDoRefs.length > 0
        ? await listDocumentsByFilter<Array<{
            _id: string;
            status?: string;
            orderRef?: unknown;
            doNumber?: string;
            customerDoNumber?: string;
            customerRef?: unknown;
            customerName?: string;
            vehiclePlate?: string;
            serviceRef?: string;
            vehicleServiceRef?: string;
            pickupAddress?: string;
            receiverAddress?: string;
            shipperReferences?: Array<{
                referenceNumber?: string;
                pickupAddress?: string;
                billingCustomerRef?: unknown;
                billingCustomerName?: string;
                receiverAddress?: string;
            }>;
            actualDropPoints?: DeliveryOrder['actualDropPoints'];
            date?: string;
        }>[number]>('deliveryOrder', { _id: uniqueDoRefs })
        : [];
    if (deliveryOrders.length !== uniqueDoRefs.length) {
        return NextResponse.json({ error: 'Sebagian DO invoice tidak ditemukan' }, { status: 404 });
    }
    const orderRefs = [...new Set(
        deliveryOrders
            .map(item => extractRefId(item.orderRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    const sourceOrders = orderRefs.length > 0
        ? await listDocumentsByFilter<FreightNotaOrderSource>('order', { _id: orderRefs })
        : [];
    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const orderMap = new Map(sourceOrders.map(order => [order._id, order]));
    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!deliveryOrder) {
        return NextResponse.json({ error: 'DO invoice tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status === 'CANCELLED') {
            return NextResponse.json({ error: `DO ${deliveryOrder.doNumber || row.doRef} sudah dibatalkan` }, { status: 409 });
        }
        const matchedShipperReference = (deliveryOrder.shipperReferences || []).find(reference =>
            normalizeOptionalText(reference.referenceNumber) === normalizeOptionalText(row.noSJ)
        );
        row.customerRef =
            normalizeOptionalText(row.customerRef) ||
            normalizeOptionalText(matchedShipperReference?.billingCustomerRef) ||
            normalizeOptionalText(deliveryOrder.customerRef);
        row.customerName =
            normalizeOptionalText(row.customerName) ||
            normalizeOptionalText(matchedShipperReference?.billingCustomerName) ||
            normalizeOptionalText(deliveryOrder.customerName);
    }

    const referencedDeliveryOrderItemRefs = [
        ...new Set(
            rows.flatMap(row => (
                Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
                    ? row.deliveryOrderItemRefs
                    : row.deliveryOrderItemRef
                        ? [row.deliveryOrderItemRef]
                        : []
            ))
        ),
    ];
    const allDeliveryOrderItems = uniqueDoRefs.length > 0 || referencedDeliveryOrderItemRefs.length > 0
        ? await getAllDocuments<FreightNotaDeliveryOrderItemSource>('deliveryOrderItem')
        : [];
    const deliveryOrderItems = allDeliveryOrderItems.filter(item => {
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        const itemId = normalizeOptionalText(item._id);
        return (
            (deliveryOrderRef ? uniqueDoRefs.includes(deliveryOrderRef) : false) ||
            (itemId ? referencedDeliveryOrderItemRefs.includes(itemId) : false)
        );
    });
    const doItemById = new Map(
        deliveryOrderItems
            .map(item => [normalizeOptionalText(item._id), item] as const)
            .filter((entry): entry is [string, FreightNotaDeliveryOrderItemSource] => Boolean(entry[0]))
    );
    const doItemMap = new Map<string, FreightNotaDeliveryOrderItemSource[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = doItemMap.get(deliveryOrderRef) || [];
        current.push(item);
        doItemMap.set(deliveryOrderRef, current);
    }
    const builtNotaRowsByDoRef = new Map<string, ReturnType<typeof buildNotaRowsFromDeliveryOrder>>();
    for (const deliveryOrder of deliveryOrders) {
        const linkedOrderRef = extractRefId(deliveryOrder.orderRef);
        const linkedOrder = linkedOrderRef ? orderMap.get(linkedOrderRef) : undefined;
        builtNotaRowsByDoRef.set(
            deliveryOrder._id,
            buildNotaRowsFromDeliveryOrder({
                deliveryOrder: deliveryOrder as DeliveryOrder,
                orders: linkedOrder ? [linkedOrder as Order] : [],
                deliveryOrderItems: (doItemMap.get(deliveryOrder._id) || []) as DeliveryOrderItem[],
            })
        );
    }
    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'DO invoice tidak ditemukan' }, { status: 404 });
        }
        const rowItemRefs = Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
            ? row.deliveryOrderItemRefs
            : row.deliveryOrderItemRef
                ? [row.deliveryOrderItemRef]
                : [];
        for (const itemRef of rowItemRefs) {
            const itemSource = doItemById.get(itemRef);
            if (!itemSource) {
            return NextResponse.json({ error: `Item DO ${itemRef} tidak ditemukan untuk revisi invoice` }, { status: 404 });
            }
            if (normalizeOptionalText(itemSource.deliveryOrderRef) !== row.doRef) {
                return NextResponse.json(
                    { error: `Item DO ${itemRef} bukan milik surat jalan ${row.doNumber || row.doRef || '-'}` },
                    { status: 409 }
                );
            }
        }
        const resolvedNoSj =
            normalizeOptionalText(row.noSJ) ||
            normalizeOptionalText(deliveryOrder.customerDoNumber) ||
            '';
        const hasActualDropPoints = Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0;
        const matchedBuiltRow = findBuiltNotaRowMatch({
            row: {
                ...row,
                noSJ: resolvedNoSj || row.noSJ,
            },
            deliveryOrder: deliveryOrder as DeliveryOrder,
            builtRows: builtNotaRowsByDoRef.get(row.doRef) || [],
        });
        if (deliveryOrder.status !== 'DELIVERED' && !hasActualDropPoints) {
            return NextResponse.json(
                {
                    error: `DO ${deliveryOrder.doNumber || row.doRef} belum delivered dan belum punya realisasi drop yang bisa ditagihkan`,
                },
                { status: 409 }
            );
        }
        if (hasActualDropPoints && !hasDeliveryOrderBillableCargo(deliveryOrder as DeliveryOrder, resolvedNoSj)) {
            return NextResponse.json(
                {
                    error: `SJ ${resolvedNoSj || deliveryOrder.doNumber || row.doRef} belum punya realisasi drop yang bisa ditagihkan`,
                },
                { status: 409 }
            );
        }
        if (hasActualDropPoints && rowItemRefs.length > 0 && !matchedBuiltRow) {
            return NextResponse.json(
                {
                    error: `Item pada SJ ${resolvedNoSj || deliveryOrder.doNumber || row.doRef} belum punya realisasi drop yang bisa ditagihkan. Jangan tagihkan barang yang masih hold/return.`,
                },
                { status: 409 }
            );
        }
    }

    const payloadCoverageByDoRef = new Map<string, { deliveryOrderItemRefs: Set<string>; rowKeys: Set<string> }>();
    for (const row of rows) {
        if (!row.doRef) continue;
        const rowItemRefs = Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
            ? row.deliveryOrderItemRefs
            : row.deliveryOrderItemRef
                ? [row.deliveryOrderItemRef]
                : [];
        const actualDropPointKey = normalizeOptionalText(row.actualDropPointKey);
        const rowDeliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!rowDeliveryOrder) {
            return NextResponse.json({ error: 'DO invoice tidak ditemukan' }, { status: 404 });
        }
        const rowKeys = rowItemRefs.length > 0
            ? rowItemRefs.map(itemRef => buildFreightNotaPayloadItemCoverageKey({
                doRef: row.doRef,
                itemRef,
                tujuan: row.tujuan,
                actualDropPointKey,
            }))
            : buildFreightNotaCoverageRowKeys({
                deliveryOrder: rowDeliveryOrder,
                noSJ: row.noSJ,
                deliveryOrderItemRefs: rowItemRefs,
            });
        const coverage = payloadCoverageByDoRef.get(row.doRef) || {
            deliveryOrderItemRefs: new Set<string>(),
            rowKeys: new Set<string>(),
        };
        if (rowKeys.some(rowKey => coverage.rowKeys.has(rowKey))) {
            return NextResponse.json(
                    { error: `SJ ${row.noSJ || '-'} pada DO ${row.doNumber || row.doRef} duplikat untuk barang yang sama dalam payload invoice` },
                { status: 409 }
            );
        }
        for (const itemRef of rowItemRefs) {
            const itemDestinationKey = buildFreightNotaPayloadItemDestinationKey({
                itemRef,
                tujuan: row.tujuan,
                actualDropPointKey,
            });
            if (coverage.deliveryOrderItemRefs.has(itemDestinationKey)) {
            return NextResponse.json({ error: `Item DO ${itemRef} duplikat dalam payload invoice` }, { status: 400 });
            }
        }
        rowKeys.forEach(rowKey => coverage.rowKeys.add(rowKey));
        rowItemRefs.forEach(itemRef => coverage.deliveryOrderItemRefs.add(buildFreightNotaPayloadItemDestinationKey({
            itemRef,
            tujuan: row.tujuan,
            actualDropPointKey,
        })));
        payloadCoverageByDoRef.set(row.doRef, coverage);
    }

    if (uniqueDoRefs.length > 0) {
        const existingNotaItems = (await getAllDocuments<{
            doRef?: string;
            doNumber?: string;
            noSJ?: string;
            tujuan?: string;
            deliveryOrderItemRef?: string;
            deliveryOrderItemRefs?: string[];
            actualDropPointKey?: string;
            notaRef?: string;
            status?: string;
        }>('freightNotaItem')).filter(item => {
            const itemDoRef = normalizeOptionalText(item.doRef);
            const itemNotaRef = normalizeOptionalText(item.notaRef);
            return Boolean(item.status !== 'VOID' && itemDoRef && uniqueDoRefs.includes(itemDoRef) && itemNotaRef !== notaId);
        });
        const existingItemUsage = new Map<string, { doRef?: string; doNumber?: string; noSJ?: string }>();
        const existingRowKeys = new Set<string>();
        for (const item of existingNotaItems) {
            const existingDoRef = normalizeOptionalText(item.doRef);
            const existingNoSJ = normalizeOptionalText(item.noSJ);
            const existingItemRefs = Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
                ? item.deliveryOrderItemRefs
                : item.deliveryOrderItemRef
                    ? [item.deliveryOrderItemRef]
                    : [];
            const existingActualDropPointKey = normalizeOptionalText(item.actualDropPointKey);
            if (existingDoRef && existingNoSJ) {
                const matchedDeliveryOrder = deliveryOrderMap.get(existingDoRef);
                if (matchedDeliveryOrder) {
                    const existingDestination = normalizeOptionalText(item.tujuan) || '-';
                    const rowKeys = existingItemRefs.length > 0
                        ? existingItemRefs.flatMap(itemRef => {
                            const keys = [buildFreightNotaPayloadItemCoverageKey({
                                doRef: existingDoRef,
                                itemRef,
                                tujuan: existingDestination,
                                actualDropPointKey: existingActualDropPointKey,
                            })];
                            if (!existingActualDropPointKey) {
                                keys.push(buildFreightNotaLegacyItemCoverageKey({
                                    doRef: existingDoRef,
                                    itemRef,
                                    tujuan: existingDestination,
                                }));
                            }
                            return keys;
                        })
                        : buildFreightNotaCoverageRowKeys({
                            deliveryOrder: matchedDeliveryOrder,
                            noSJ: existingNoSJ,
                            deliveryOrderItemRefs: existingItemRefs,
                        });
                    rowKeys.forEach(rowKey => existingRowKeys.add(rowKey));
                } else {
                    if (existingItemRefs.length > 0) {
                        existingItemRefs.forEach(itemRef => {
                            existingRowKeys.add(buildFreightNotaPayloadItemCoverageKey({
                                doRef: existingDoRef,
                                itemRef,
                                tujuan: item.tujuan,
                                actualDropPointKey: existingActualDropPointKey,
                            }));
                            if (!existingActualDropPointKey) {
                                existingRowKeys.add(buildFreightNotaLegacyItemCoverageKey({
                                    doRef: existingDoRef,
                                    itemRef,
                                    tujuan: item.tujuan,
                                }));
                            }
                        });
                    } else {
                        existingRowKeys.add(`${existingDoRef}::${existingNoSJ}`);
                    }
                }
            }
            for (const itemRef of existingItemRefs.map(value => normalizeOptionalText(value)).filter((value): value is string => Boolean(value))) {
                const exactUsageKey = buildFreightNotaPayloadItemDestinationKey({
                    itemRef,
                    tujuan: item.tujuan,
                    actualDropPointKey: existingActualDropPointKey,
                });
                existingItemUsage.set(exactUsageKey, {
                    doRef: existingDoRef,
                    doNumber: normalizeOptionalText(item.doNumber) || undefined,
                    noSJ: existingNoSJ || undefined,
                });
                if (!existingActualDropPointKey) {
                    existingItemUsage.set(buildFreightNotaLegacyItemDestinationKey({
                        itemRef,
                        tujuan: item.tujuan,
                    }), {
                        doRef: existingDoRef,
                        doNumber: normalizeOptionalText(item.doNumber) || undefined,
                        noSJ: existingNoSJ || undefined,
                    });
                }
            }
        }
        for (const row of rows) {
            if (!row.doRef) continue;
            const rowItemRefs = Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
                ? row.deliveryOrderItemRefs
                : row.deliveryOrderItemRef
                    ? [row.deliveryOrderItemRef]
                    : [];
            const rowDeliveryOrder = deliveryOrderMap.get(row.doRef);
            if (!rowDeliveryOrder) {
                return NextResponse.json({ error: 'DO invoice tidak ditemukan' }, { status: 404 });
            }
            const actualDropPointKey = normalizeOptionalText(row.actualDropPointKey);
            const rowCoverageKeys = rowItemRefs.length > 0
                ? rowItemRefs.flatMap(itemRef => {
                    const keys = [buildFreightNotaPayloadItemCoverageKey({
                        doRef: row.doRef,
                        itemRef,
                        tujuan: row.tujuan,
                        actualDropPointKey,
                    })];
                    if (actualDropPointKey) {
                        keys.push(buildFreightNotaLegacyItemCoverageKey({
                            doRef: row.doRef,
                            itemRef,
                            tujuan: row.tujuan,
                        }));
                    }
                    return keys;
                })
                : buildFreightNotaCoverageRowKeys({
                    deliveryOrder: rowDeliveryOrder,
                    noSJ: row.noSJ,
                    deliveryOrderItemRefs: rowItemRefs,
                });
            if (rowCoverageKeys.some(rowKey => existingRowKeys.has(rowKey))) {
                return NextResponse.json(
                    { error: `SJ ${row.noSJ || '-'} pada DO ${row.doNumber || row.doRef} sudah masuk invoice lain` },
                    { status: 409 }
                );
            }
            for (const itemRef of rowItemRefs) {
                const existingUsage = existingItemUsage.get(buildFreightNotaPayloadItemDestinationKey({
                    itemRef,
                    tujuan: row.tujuan,
                    actualDropPointKey,
                })) || (actualDropPointKey
                    ? existingItemUsage.get(buildFreightNotaLegacyItemDestinationKey({
                        itemRef,
                        tujuan: row.tujuan,
                    }))
                    : undefined);
                if (existingUsage) {
                    return NextResponse.json(
                    { error: `SJ ${existingUsage.noSJ || row.noSJ || '-'} pada DO ${existingUsage.doNumber || existingUsage.doRef || row.doRef} sudah masuk invoice lain` },
                        { status: 409 }
                    );
                }
            }
        }
    }

    const inferredCustomerRefs = [...new Set(
        rows
            .map(row => normalizeOptionalText(row.customerRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    if (inferredCustomerRefs.length > 1) {
        return NextResponse.json({ error: 'DO yang dipilih berasal dari customer berbeda. Pisahkan per invoice.' }, { status: 409 });
    }
    const inferredCustomerRef = inferredCustomerRefs[0];
    const customerDerivedFromDo = Boolean(inferredCustomerRef && inferredCustomerRef === resolvedCustomerRef && rows.some(row => Boolean(row.doRef)));
    if (resolvedCustomerRef && inferredCustomerRef && resolvedCustomerRef !== inferredCustomerRef) {
        return NextResponse.json({ error: 'Customer invoice tidak cocok dengan customer pada DO yang dipilih' }, { status: 409 });
    }
    if (!resolvedCustomerRef && inferredCustomerRef) {
        resolvedCustomerRef = inferredCustomerRef;
    }
    if (resolvedCustomerRef) {
        const mismatchedRow = rows.find(row => row.customerRef && row.customerRef !== resolvedCustomerRef);
        if (mismatchedRow) {
            return NextResponse.json(
                { error: `SJ ${mismatchedRow.noSJ || '-'} memakai customer invoice berbeda dari invoice ini` },
                { status: 409 }
            );
        }
    }

    let finalCustomerName = customerName || rows.find(row => normalizeOptionalText(row.customerName))?.customerName || '';
    let finalCustomerAddress = normalizeOptionalText(data.customerAddress);
    let finalCustomerContactPerson = normalizeOptionalText(data.customerContactPerson);
    let finalCustomerPhone = normalizeOptionalText(data.customerPhone);
    let customerTermDays: number | null = null;
    let linkedCustomer: {
        _id: string;
        _rev?: string;
        name?: string;
        address?: string;
        contactPerson?: string;
        phone?: string;
        defaultPaymentTerm?: number;
        defaultFreightNotaBillingMode?: string;
        defaultPph23Enabled?: boolean;
        defaultPph23RatePercent?: number;
        defaultPph23BaseMode?: string;
        active?: boolean;
    } | null = null;
    let customerPph23Defaults: {
        enabled: boolean;
        ratePercent: number;
        baseMode: Pph23BaseMode;
    } | null = null;
    if (resolvedCustomerRef) {
        const customerDoc = await getDocumentById<{
            _id: string;
            name?: string;
            address?: string;
            contactPerson?: string;
            phone?: string;
            defaultPaymentTerm?: number;
            defaultFreightNotaBillingMode?: string;
            defaultPph23Enabled?: boolean;
            defaultPph23RatePercent?: number;
            defaultPph23BaseMode?: string;
            active?: boolean;
        }>(resolvedCustomerRef, 'customer');
        if (!customerDoc) {
        return NextResponse.json({ error: 'Customer invoice tidak ditemukan' }, { status: 404 });
        }
        linkedCustomer = customerDoc;
        if (customerDoc.active === false && !customerDerivedFromDo) {
        return NextResponse.json({ error: 'Customer invoice tidak aktif untuk invoice manual' }, { status: 409 });
        }
        if (customerDoc?.name) {
            finalCustomerName = customerDoc.name;
        }
        finalCustomerAddress = normalizeOptionalText(customerDoc?.address) || finalCustomerAddress;
        finalCustomerContactPerson = normalizeOptionalText(customerDoc?.contactPerson) || finalCustomerContactPerson;
        finalCustomerPhone = normalizeOptionalText(customerDoc?.phone) || finalCustomerPhone;
        if (typeof customerDoc?.defaultPaymentTerm === 'number' && Number.isFinite(customerDoc.defaultPaymentTerm) && customerDoc.defaultPaymentTerm >= 0) {
            customerTermDays = customerDoc.defaultPaymentTerm;
        }
        customerPph23Defaults = {
            enabled: normalizePph23Enabled(customerDoc?.defaultPph23Enabled),
            ratePercent: normalizePph23RatePercent(customerDoc?.defaultPph23RatePercent, DEFAULT_PPH23_RATE_PERCENT),
            baseMode: normalizePph23BaseMode(customerDoc?.defaultPph23BaseMode, 'BEFORE_CLAIM'),
        };
        if (!Object.prototype.hasOwnProperty.call(data, 'billingMode')) {
            billingMode = normalizeFreightNotaBillingMode(customerDoc?.defaultFreightNotaBillingMode);
            for (const row of rows) {
                row.uangRp = normalizeFreightNotaAmount(
                    calculateFreightNotaRowAmount({ beratKg: row.beratKg, volumeM3: row.volumeM3, tarip: row.tarip, billingMode })
                );
            }
        }
    }
    if (!finalCustomerName) {
        return NextResponse.json({ error: 'Nama customer invoice wajib diisi' }, { status: 400 });
    }

    let resolvedDueDate = normalizeOptionalText(data.dueDate);
    if (resolvedDueDate) {
    const dueDateError = validateIsoDateOrResponse(resolvedDueDate, 'Tanggal jatuh tempo invoice', 'Tanggal jatuh tempo invoice tidak valid');
        if (dueDateError) {
            return dueDateError;
        }
    }
    if (!resolvedDueDate) {
        let termDays = customerTermDays;
        if (termDays === null) {
            const companyDoc = await getCompanyProfile<{
                invoiceSettings?: { dueDateDays?: number; defaultTermDays?: number };
            }>();
            const companyTerm = companyDoc?.invoiceSettings?.dueDateDays ?? companyDoc?.invoiceSettings?.defaultTermDays;
            if (typeof companyTerm === 'number' && Number.isFinite(companyTerm) && companyTerm >= 0) {
                termDays = companyTerm;
            }
        }
        if (termDays !== null) {
            resolvedDueDate = addDaysToDateValue(issueDate, termDays);
        }
    }

    let pph23Settings: {
        pph23Enabled: boolean;
        pph23RatePercent: number;
        pph23BaseMode: Pph23BaseMode;
    };
    try {
        pph23Settings = normalizePph23SettingsInput(data, customerPph23Defaults ? {
            enabled: customerPph23Defaults.enabled,
            ratePercent: customerPph23Defaults.ratePercent,
            baseMode: customerPph23Defaults.baseMode,
        } : {
            enabled: snapshot.pph23Enabled,
            ratePercent: snapshot.pph23RatePercent,
            baseMode: snapshot.pph23BaseMode,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Pengaturan PPh 23 tidak valid' },
            { status: 400 }
        );
    }

    const totalAmount = normalizeFreightNotaAmount(rows.reduce((sum, row) => sum + row.uangRp, 0));
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    const totalVolumeM3 = rows.reduce((sum, row) => sum + (row.volumeM3 || 0), 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total invoice harus lebih besar dari 0' }, { status: 400 });
    }
    const receivablePatch = buildReceivablePatch(
        {
            grossAmount: totalAmount,
            pph23Enabled: pph23Settings.pph23Enabled,
            pph23RatePercent: pph23Settings.pph23RatePercent,
            pph23BaseMode: pph23Settings.pph23BaseMode,
        },
        0,
        0,
    );

    const {
        instructionAccounts,
        notaSeriesCode,
        footerNote,
        issuerCompanyName,
        issuerCompanyAddress,
        issuerCompanyPhone,
        issuerCompanyEmail,
        issuerCompanyLogoUrl,
        issuerCompanySignatureStampUrl,
        issuerCompanySignatureName,
        issuerCompanyNpwp,
    } = await loadFreightNotaDocumentSettings();
    const notaNumber = normalizeText(snapshot.doc.notaNumber) || notaId;
    const notaDisplayNumber = buildFreightNotaDisplayNumberFromParts(notaNumber, issueDate, notaSeriesCode);

    const existingNotaItems = await listDocumentsByFilter<Array<{ _id: string; status?: string }>[number]>(
        'freightNotaItem',
        { notaRef: notaId }
    );
    const nowIso = new Date().toISOString();

    if (linkedCustomer) {
        await updateDocument(linkedCustomer._id, { updatedAt: new Date().toISOString() }, 'customer');
    }
    await updateDocument(notaId, sanitizePatchSet({
        issuerCompanyName,
        issuerCompanyAddress,
        issuerCompanyPhone,
        issuerCompanyEmail,
        issuerCompanyLogoUrl,
        issuerCompanySignatureStampUrl,
        issuerCompanySignatureName,
        issuerCompanyNpwp,
        customerRef: resolvedCustomerRef,
        customerName: finalCustomerName,
        customerAddress: finalCustomerAddress,
        customerContactPerson: finalCustomerContactPerson,
        customerPhone: finalCustomerPhone,
        issueDate,
        dueDate: resolvedDueDate,
        notaDisplayNumber,
        totalAmount,
        totalAdjustmentAmount: 0,
        pph23Enabled: pph23Settings.pph23Enabled,
        pph23RatePercent: pph23Settings.pph23RatePercent,
        pph23BaseMode: pph23Settings.pph23BaseMode,
        pph23BaseAmount: receivablePatch.pph23BaseAmount,
        pph23Amount: receivablePatch.pph23Amount,
        netAmount: receivablePatch.netAmount,
        status: receivablePatch.status,
        totalCollie,
        totalWeightKg,
        totalVolumeM3,
        billingMode,
        instructionAccounts: instructionAccounts.length > 0 ? instructionAccounts : undefined,
        footerNote,
        notes: normalizedNotes,
    }), 'freightNota');
    await Promise.all(existingNotaItems
        .filter(item => item.status !== 'VOID')
        .map(item => updateDocument(item._id, {
            status: 'VOID',
            voidedAt: nowIso,
            voidedBy: session._id,
            voidedByName: session.name,
            voidReason: 'Revisi invoice',
            _updatedAt: nowIso,
        }, 'freightNotaItem')));
    await Promise.all(rows.map(row => createDocument({
            _id: crypto.randomUUID(),
            _type: 'freightNotaItem',
            notaRef: notaId,
            doRef: row.doRef,
            deliveryOrderItemRef: row.deliveryOrderItemRef,
            deliveryOrderItemRefs: row.deliveryOrderItemRefs,
            actualDropPointKey: row.actualDropPointKey,
            customerRef: row.customerRef,
            customerName: row.customerName,
            doNumber: row.doNumber,
            vehiclePlate: row.vehiclePlate,
            date: row.date,
            noSJ: row.noSJ,
            dari: row.dari,
            tujuan: row.tujuan,
            barang: row.barang,
            collie: row.collie,
            beratKg: row.beratKg,
            volumeM3: row.volumeM3,
            tarip: row.tarip,
            taripSource: row.taripSource,
            customerBillingRateRef: row.customerBillingRateRef,
            customerBillingRateName: row.customerBillingRateName,
            customerBillingRateSnapshot: row.customerBillingRateSnapshot,
            uangRp: row.uangRp,
            ket: row.ket,
            plt: row.plt,
            pc: row.pc,
            kbl: row.kbl,
            invoiceLineDate: row.invoiceLineDate,
            status: 'ACTIVE',
        })));
    await syncFreightNotaDeliveryOrderLinks({
        notaId,
        notaNumber,
        nextDeliveryOrderRefs: uniqueDoRefs,
    });
    await postFreightNotaIssueJournal(session, {
        ...snapshot.doc,
        customerRef: resolvedCustomerRef,
        customerName: finalCustomerName,
        customerAddress: finalCustomerAddress,
        customerContactPerson: finalCustomerContactPerson,
        customerPhone: finalCustomerPhone,
        issueDate,
        dueDate: resolvedDueDate,
        notaDisplayNumber,
        totalAmount,
        totalAdjustmentAmount: 0,
        pph23Enabled: pph23Settings.pph23Enabled,
        pph23RatePercent: pph23Settings.pph23RatePercent,
        pph23BaseMode: pph23Settings.pph23BaseMode,
        pph23BaseAmount: receivablePatch.pph23BaseAmount,
        pph23Amount: receivablePatch.pph23Amount,
        netAmount: receivablePatch.netAmount,
        status: receivablePatch.status,
        totalCollie,
        totalWeightKg,
        totalVolumeM3,
        billingMode,
        notes: normalizedNotes,
    } as FreightNota);

    await addAuditLog(session, 'UPDATE', 'freight-notas', notaId, `Revised freight-notas: ${notaNumber}`);
    return NextResponse.json({ success: true, id: notaId });
}

export async function handleFreightNotaPph23Update(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const notaId = typeof data.id === 'string' ? data.id : '';
    if (!notaId) {
        return NextResponse.json({ error: 'Invoice tidak valid' }, { status: 400 });
    }

    const snapshot = await loadReceivableSnapshot(notaId);
    if ('error' in snapshot) return snapshot.error;
    if (snapshot.doc._type !== 'freightNota') {
        return NextResponse.json({ error: 'Pengaturan PPh 23 hanya tersedia untuk invoice ongkos' }, { status: 409 });
    }
    if (snapshot.paidBeforeRefund > 0 || snapshot.refundedOverpaymentAmount > 0) {
        return NextResponse.json(
                { error: 'Pengaturan PPh 23 tidak bisa diubah setelah invoice memiliki pembayaran' },
            { status: 409 }
        );
    }

    let pph23Settings: {
        pph23Enabled: boolean;
        pph23RatePercent: number;
        pph23BaseMode: Pph23BaseMode;
    };
    try {
        pph23Settings = normalizePph23SettingsInput(data, {
            enabled: snapshot.pph23Enabled,
            ratePercent: snapshot.pph23RatePercent,
            baseMode: snapshot.pph23BaseMode,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Pengaturan PPh 23 tidak valid' },
            { status: 400 }
        );
    }

    const patch = buildReceivablePatch(snapshot, snapshot.totalPaid, snapshot.totalAdjustmentAmount, pph23Settings);

    await updateDocument(notaId, patch, 'freightNota');
    await postFreightNotaIssueJournal(session, {
        ...snapshot.doc,
        ...patch,
    } as FreightNota);

    await addAuditLog(
        session,
        'UPDATE',
        'freight-notas',
        notaId,
        `Pengaturan PPh 23 diperbarui untuk ${snapshot.label}`
    );

    return NextResponse.json({
        success: true,
        data: {
            _id: notaId,
            ...patch,
        },
    });
}

export async function handleFreightNotaTaxInvoiceUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const notaId = typeof data.id === 'string' ? data.id : '';
    if (!notaId) {
        return NextResponse.json({ error: 'Invoice tidak valid' }, { status: 400 });
    }

    const snapshot = await loadReceivableSnapshot(notaId);
    if ('error' in snapshot) return snapshot.error;
    if (snapshot.doc._type !== 'freightNota') {
        return NextResponse.json({ error: 'No faktur pajak hanya tersedia untuk invoice ongkos' }, { status: 409 });
    }
    if (snapshot.doc.status === 'VOID') {
        return NextResponse.json({ error: 'Invoice yang sudah dibatalkan tidak bisa diubah' }, { status: 409 });
    }

    const taxInvoiceNumber = normalizeOptionalText(data.taxInvoiceNumber);
    const previousTaxInvoiceNumber = normalizeOptionalText(snapshot.doc.taxInvoiceNumber);
    await updateDocument(notaId, {
        taxInvoiceNumber: taxInvoiceNumber || undefined,
    }, 'freightNota');

    await addAuditLog(
        session,
        'UPDATE',
        'freight-notas',
        notaId,
        `No faktur pajak ${snapshot.label}: ${previousTaxInvoiceNumber || '-'} -> ${taxInvoiceNumber || '-'}`
    );

    return NextResponse.json({
        success: true,
        data: {
            _id: notaId,
            taxInvoiceNumber: taxInvoiceNumber || undefined,
        },
    });
}

export async function handleFreightNotaDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Invoice tidak valid' }, { status: 400 });
    }

    const nota = await getDocumentById<{ _id: string; _updatedAt?: string; notaNumber?: string; status?: string }>(id, 'freightNota');
    if (!nota) {
        return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 });
    }
    if (nota.status === 'VOID') {
        return NextResponse.json({ success: true });
    }

    const existingPayments = await listDocumentsByFilter<Array<{ _id: string }>[number]>('payment', { invoiceRef: id });
    if (existingPayments.length > 0) {
        return NextResponse.json(
                    { error: 'Invoice yang sudah punya pembayaran, refund, atau klaim/potongan aktif tidak boleh dihapus' },
            { status: 409 }
        );
    }

    const existingRefunds = await listDocumentsByFilter<Array<{ _id: string }>[number]>(
        'customerOverpaymentRefund',
        { sourceType: 'INVOICE_OVERPAID', sourceInvoiceRef: id }
    );
    if (existingRefunds.length > 0) {
        return NextResponse.json(
                    { error: 'Invoice yang sudah punya pembayaran, refund, atau klaim/potongan aktif tidak boleh dihapus' },
            { status: 409 }
        );
    }

    const existingAdjustments = await listDocumentsByFilter<Array<{ _id: string }>[number]>(
        'invoiceAdjustment',
        { invoiceRef: id, status: 'APPROVED' }
    );
    if (existingAdjustments.length > 0) {
        return NextResponse.json(
                    { error: 'Invoice yang sudah punya pembayaran, refund, atau klaim/potongan aktif tidak boleh dihapus' },
            { status: 409 }
        );
    }

    const notaItems = await listDocumentsByFilter<Array<{ _id: string; _updatedAt?: string; status?: string }>[number]>(
        'freightNotaItem',
        { notaRef: id }
    );
    const relatedDeliveryOrders = await listDocumentsByFilter<Array<{ _id: string; _updatedAt?: string; freightNotaRef?: unknown }>[number]>(
        'deliveryOrder',
        { freightNotaRef: id }
    );
    const nowIso = new Date().toISOString();
    try {
        await Promise.all(notaItems
            .filter(item => item.status !== 'VOID')
            .map(item => updateDocument(item._id, {
                status: 'VOID',
                voidedAt: nowIso,
                voidedBy: session._id,
                voidedByName: session.name,
                voidReason: 'Invoice dibatalkan',
                _updatedAt: nowIso,
            }, 'freightNotaItem')));

        await Promise.all(relatedDeliveryOrders.map(deliveryOrder =>
            updateDocument(
                deliveryOrder._id,
                {
                    freightNotaRef: null,
                    freightNotaNumber: null,
                }
            , 'deliveryOrder')
        ));

        await updateDocument(id, {
            status: 'VOID',
            voidedAt: nowIso,
            voidedBy: session._id,
            voidedByName: session.name,
            voidReason: 'Invoice dibatalkan',
            _updatedAt: nowIso,
        }, 'freightNota');
        await voidJournalEntryForSource(session, 'FREIGHT_NOTA', id, 'ISSUE');
        await voidJournalEntryForSource(session, 'FREIGHT_NOTA', id, 'PPH23');
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/revision|conflict|document|not found/i.test(message)) {
            return NextResponse.json(
                { error: 'Invoice berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(session, 'DELETE', 'freight-notas', id, `Invoice ${nota.notaNumber || id} dibatalkan`);
    return NextResponse.json({ success: true });
}
