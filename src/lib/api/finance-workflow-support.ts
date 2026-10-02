import type { InvoiceAdjustmentKind, Payment } from '@/lib/types';
import { calculatePph23Summary, normalizePph23BaseMode, normalizePph23Enabled, normalizePph23RatePercent } from '@/lib/pph23';

import {
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';

export type NormalizedFreightNotaRow = {
    doRef?: string;
    deliveryOrderItemRef?: string;
    deliveryOrderItemRefs?: string[];
    actualDropPointKey?: string;
    customerRef?: string;
    customerName?: string;
    doNumber?: string;
    vehiclePlate?: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang?: string;
    collie?: number;
    beratKg: number;
    volumeM3?: number;
    tarip: number;
    taripSource?: 'MASTER' | 'MANUAL';
    customerBillingRateRef?: string;
    customerBillingRateName?: string;
    customerBillingRateSnapshot?: number;
    uangRp: number;
    ket?: string;
    plt?: string;
    pc?: string;
    k?: string;
    kbl?: string;
    invoiceLineDate?: string;
};

export type FreightNotaOrderSource = {
    _id: string;
    customerRef?: unknown;
    customerName?: string;
    pickupAddress?: string;
    receiverAddress?: string;
};

export type FreightNotaDeliveryOrderItemSource = {
    _id?: string;
    deliveryOrderRef?: string;
    shipperReferenceKey?: string;
    shipperReferenceNumber?: string;
    orderItemDescription?: string;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
    actualQtyKoli?: number;
    actualWeightKg?: number;
    orderItemVolumeM3?: number;
    actualVolumeM3?: number;
};

export type ReceivableDoc = Record<string, unknown> & {
    _id: string;
    _rev?: string;
    _type: 'freightNota' | 'invoice';
    totalAmount?: number;
    totalAdjustmentAmount?: number;
    pph23Enabled?: boolean;
    pph23RatePercent?: number;
    pph23BaseMode?: string;
    pph23BaseAmount?: number;
    pph23Amount?: number;
    netAmount?: number;
    customerRef?: unknown;
    customerName?: string;
    notaNumber?: string;
    invoiceNumber?: string;
    status?: string;
};

export type InvoiceAdjustmentDoc = {
    _id: string;
    _rev?: string;
    invoiceRef?: string;
    amount?: number;
    status?: string;
};

export type ReceivableSnapshot = {
    doc: ReceivableDoc;
    grossAmount: number;
    totalAdjustmentAmount: number;
    pph23Enabled: boolean;
    pph23RatePercent: number;
    pph23BaseMode: 'BEFORE_CLAIM' | 'AFTER_CLAIM';
    pph23BaseAmount: number;
    pph23Amount: number;
    netAmount: number;
    paidBeforeRefund: number;
    totalPaid: number;
    refundedOverpaymentAmount: number;
    remainingAmount: number;
    creditAmount: number;
    customerRef?: string;
    customerName: string;
    label: string;
};

export type CustomerReceiptAllocationInput = {
    invoiceRef: string;
    amount: number;
    note?: string;
};

export const INVOICE_ADJUSTMENT_KIND_SET = new Set<InvoiceAdjustmentKind>([
    'DAMAGE_CLAIM',
    'SHORTAGE_CLAIM',
    'DISCOUNT',
    'PENALTY',
    'OTHER',
]);

function roundCurrencyAmount(value: unknown) {
    const normalized = normalizeNumber(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return 0;
    }
    return Math.round(normalized);
}

export function summarizeDeliveryOrderItems(items: FreightNotaDeliveryOrderItemSource[]) {
    const descriptions = [
        ...new Set(
            items
                .map(item => normalizeOptionalText(item.orderItemDescription))
                .filter((value): value is string => Boolean(value))
        ),
    ];
    const collie = items.reduce(
        (sum, item) => sum + normalizeNumber(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0),
        0
    );
    const beratKg = items.reduce(
        (sum, item) => sum + normalizeNumber(item.actualWeightKg ?? item.orderItemWeight ?? 0),
        0
    );
    const volumeM3 = items.reduce(
        (sum, item) => sum + normalizeNumber(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }),
        0
    );

    return {
        barang: descriptions.join(', '),
        collie,
        beratKg,
        volumeM3,
    };
}

export function isFreightNotaRowEmpty(row: Record<string, unknown>) {
    return (
        !normalizeOptionalText(row.doRef) &&
        !normalizeText(row.noSJ) &&
        !normalizeText(row.tujuan) &&
        !normalizeText(row.barang) &&
        normalizeNumber(row.collie || 0) === 0 &&
        normalizeNumber(row.beratKg || 0) === 0 &&
        normalizeNumber(row.volumeM3 || 0) === 0 &&
        normalizeNumber(row.tarip || 0) === 0
    );
}

export function deriveBillingStatus(netAmount: number, totalPaid: number) {
    if (totalPaid >= netAmount) return 'PAID';
    if (totalPaid > 0) return 'PARTIAL';
    return 'UNPAID';
}

export function buildReceivablePatch(
    snapshot: Pick<ReceivableSnapshot, 'grossAmount'> & Partial<Pick<ReceivableSnapshot, 'pph23Enabled' | 'pph23RatePercent' | 'pph23BaseMode'>>,
    totalPaid: number,
    totalAdjustmentAmount: number,
    pph23Override?: Partial<Pick<ReceivableSnapshot, 'pph23Enabled' | 'pph23RatePercent' | 'pph23BaseMode'>>
) {
    const nextAdjustment = roundCurrencyAmount(totalAdjustmentAmount);
    const pph23Summary = calculatePph23Summary({
        grossAmount: snapshot.grossAmount,
        claimAmount: nextAdjustment,
        enabled: pph23Override?.pph23Enabled ?? ('pph23Enabled' in snapshot ? snapshot.pph23Enabled : false),
        ratePercent: pph23Override?.pph23RatePercent ?? ('pph23RatePercent' in snapshot ? snapshot.pph23RatePercent : 2),
        baseMode: pph23Override?.pph23BaseMode ?? ('pph23BaseMode' in snapshot ? snapshot.pph23BaseMode : 'BEFORE_CLAIM'),
    });
    const nextNetAmount = pph23Summary.netAmount;
    return {
        status: deriveBillingStatus(nextNetAmount, totalPaid),
        totalAdjustmentAmount: nextAdjustment,
        pph23Enabled: pph23Summary.enabled,
        pph23RatePercent: pph23Summary.ratePercent,
        pph23BaseMode: pph23Summary.baseMode,
        pph23BaseAmount: pph23Summary.baseAmount,
        pph23Amount: pph23Summary.amount,
        netAmount: nextNetAmount,
    };
}

export function computeReceivableSnapshot(
    doc: ReceivableDoc,
    allPayments: Payment[],
    approvedAdjustments: InvoiceAdjustmentDoc[],
    refundedOverpaymentAmount: number = 0
): ReceivableSnapshot {
    const grossAmount = roundCurrencyAmount(doc.totalAmount || 0);
    const paidBeforeRefund = roundCurrencyAmount(
        allPayments.reduce((sum, item) => sum + normalizeNumber(item.amount || 0), 0)
    );
    const totalAdjustmentAmount = roundCurrencyAmount(
        approvedAdjustments.reduce((sum, item) => sum + normalizeNumber(item.amount || 0), 0)
    );
    const pph23Summary = calculatePph23Summary({
        grossAmount,
        claimAmount: totalAdjustmentAmount,
        enabled: normalizePph23Enabled(doc.pph23Enabled),
        ratePercent: normalizePph23RatePercent(doc.pph23RatePercent),
        baseMode: normalizePph23BaseMode(doc.pph23BaseMode),
    });
    const netAmount = pph23Summary.netAmount;
    const totalPaid = roundCurrencyAmount(Math.max(paidBeforeRefund - roundCurrencyAmount(refundedOverpaymentAmount), 0));
    const customerRef =
        typeof doc.customerRef === 'string'
            ? doc.customerRef
            : doc.customerRef && typeof doc.customerRef === 'object' && '_ref' in doc.customerRef
                ? normalizeOptionalText((doc.customerRef as { _ref?: unknown })._ref) || undefined
                : undefined;
    const customerName = normalizeText(doc.customerName) || '-';
    const label =
        normalizeText(doc.notaNumber) ||
        normalizeText(doc.invoiceNumber) ||
        doc._id;

    return {
        doc,
        grossAmount,
        totalAdjustmentAmount,
        pph23Enabled: pph23Summary.enabled,
        pph23RatePercent: pph23Summary.ratePercent,
        pph23BaseMode: pph23Summary.baseMode,
        pph23BaseAmount: pph23Summary.baseAmount,
        pph23Amount: pph23Summary.amount,
        netAmount,
        paidBeforeRefund,
        totalPaid,
        refundedOverpaymentAmount: roundCurrencyAmount(refundedOverpaymentAmount),
        remainingAmount: roundCurrencyAmount(Math.max(netAmount - totalPaid, 0)),
        creditAmount: roundCurrencyAmount(Math.max(totalPaid - netAmount, 0)),
        customerRef,
        customerName,
        label,
    };
}
