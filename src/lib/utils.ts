/* ============================================================
   LOGISTIK — Utility Functions
   ============================================================ */

import { format, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { formatBusinessDate, formatBusinessDateTime } from './business-date';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { calculatePph23Summary } from './pph23';

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

// ── Date formatting ──
export function formatDate(dateStr: string | undefined, fmt: string = 'dd/MM/yyyy'): string {
    if (!dateStr) return '-';
    try {
        if (fmt === 'dd/MM/yyyy') {
            return formatBusinessDate(dateStr, 'id-ID', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
            });
        }
        return format(parseISO(dateStr), fmt, { locale: localeId });
    } catch {
        return dateStr;
    }
}

export function formatDateTime(dateStr: string | undefined): string {
    if (!dateStr) return '-';
    try {
        return `${formatBusinessDateTime(dateStr, 'id-ID', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: undefined,
            hour12: false,
        }, JAKARTA_TIME_ZONE).replace(/\./g, ':')} WIB`;
    } catch {
        return dateStr;
    }
}

// ── Currency formatting ──
export function formatCurrency(amount: number | string | undefined | null): string {
    if (amount === undefined || amount === null) return '-';
    const numeric = parseFormattedNumberish(amount, { maxFractionDigits: 0 });
    if (!Number.isFinite(numeric)) return '-';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(numeric);
}

export function formatNumber(num: number | string | undefined | null): string {
    if (num === undefined || num === null) return '-';
    const numeric = parseFormattedNumberish(num);
    if (!Number.isFinite(numeric)) return '-';
    return new Intl.NumberFormat('id-ID').format(numeric);
}

export function formatQuantity(
    value: number | string | undefined | null,
    maxFractionDigits: number = 2
): string {
    if (value === undefined || value === null || value === '') return '-';
    const numeric = parseFormattedNumberish(value, { maxFractionDigits });
    if (!Number.isFinite(numeric)) return '-';
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxFractionDigits,
    }).format(numeric);
}

export function formatSupplierTerm(days: number | null | undefined): string {
    if (days === 0) return 'Kontan';
    return `${days ?? 0} hari`;
}

export function formatInternalDeliveryOrderNumber(value: {
    customerDoNumber?: string | null;
    doNumber?: string | null;
}) {
    return value.doNumber || '-';
}

type ShipperReferenceDisplayValue = {
    customerDoNumber?: string | null;
    shipperReferences?: Array<{
        referenceNumber?: string | null;
        receiverName?: string | null;
        receiverCompany?: string | null;
        receiverAddress?: string | null;
    }> | null;
};

export function getShipperReferenceNumbers(value: ShipperReferenceDisplayValue) {
    const uniqueNumbers = new Set<string>();
    for (const entry of value.shipperReferences || []) {
        const normalizedNumber = entry?.referenceNumber?.trim();
        if (normalizedNumber) {
            uniqueNumbers.add(normalizedNumber);
        }
    }

    const legacyNumber = value.customerDoNumber?.trim();
    if (uniqueNumbers.size === 0 && legacyNumber) {
        uniqueNumbers.add(legacyNumber);
    }

    return Array.from(uniqueNumbers);
}

export function getShipperReferenceCount(value: ShipperReferenceDisplayValue) {
    return getShipperReferenceNumbers(value).length;
}

export function formatShipperDeliveryOrderNumber(
    value: ShipperReferenceDisplayValue,
    options?: { mode?: 'summary' | 'full'; maxVisible?: number }
) {
    const references = getShipperReferenceNumbers(value);
    if (references.length === 0) {
        return '-';
    }

    if (options?.mode === 'full') {
        return references.join(', ');
    }

    const maxVisible = options?.maxVisible ?? 2;
    if (references.length <= maxVisible) {
        return references.join(', ');
    }

    return `${references.slice(0, maxVisible).join(', ')} (+${references.length - maxVisible})`;
}

export function getShipperReceiverTargets(value: ShipperReferenceDisplayValue) {
    const uniqueTargets = new Set<string>();
    for (const entry of value.shipperReferences || []) {
        const normalizedTarget =
            entry?.receiverAddress?.trim()
            || entry?.receiverCompany?.trim()
            || entry?.receiverName?.trim();
        if (normalizedTarget) {
            uniqueTargets.add(normalizedTarget);
        }
    }

    return Array.from(uniqueTargets);
}

export function formatShipperReceiverSummary(
    value: ShipperReferenceDisplayValue,
    options?: { mode?: 'summary' | 'full'; maxVisible?: number; fallback?: string }
) {
    const targets = getShipperReceiverTargets(value);
    if (targets.length === 0) {
        return options?.fallback || '-';
    }

    if (options?.mode === 'full') {
        return targets.join(', ');
    }

    const maxVisible = options?.maxVisible ?? 2;
    if (targets.length <= maxVisible) {
        return targets.join(', ');
    }

    return `${targets.slice(0, maxVisible).join(', ')} (+${targets.length - maxVisible})`;
}

export function getReceivableNetAmount(value: {
    totalAmount?: number | string | null;
    totalAdjustmentAmount?: number | string | null;
    pph23Enabled?: boolean | string | null;
    pph23RatePercent?: number | string | null;
    pph23BaseMode?: string | null;
    pph23Amount?: number | string | null;
    netAmount?: number | string | null;
}) {
    const hasGrossAmount = value.totalAmount !== undefined && value.totalAmount !== null && value.totalAmount !== '';
    const grossAmount =
        hasGrossAmount
            ? Math.max(parseFormattedNumberish(value.totalAmount), 0)
            : 0;
    const adjustmentAmount =
        value.totalAdjustmentAmount !== undefined && value.totalAdjustmentAmount !== null
            ? Math.max(parseFormattedNumberish(value.totalAdjustmentAmount), 0)
            : 0;
    const storedNetAmount =
        value.netAmount !== undefined && value.netAmount !== null
            ? Math.max(parseFormattedNumberish(value.netAmount), 0)
            : undefined;
    const storedPph23Amount =
        value.pph23Amount !== undefined && value.pph23Amount !== null
            ? Math.max(parseFormattedNumberish(value.pph23Amount), 0)
            : undefined;
    const hasPph23Metadata =
        value.pph23Enabled !== undefined
        || value.pph23RatePercent !== undefined
        || value.pph23BaseMode !== undefined;
    const computedPph23Amount = calculatePph23Summary({
        grossAmount,
        claimAmount: adjustmentAmount,
        enabled: value.pph23Enabled,
        ratePercent: value.pph23RatePercent,
        baseMode: value.pph23BaseMode,
    }).amount;

    const computedNetAmount = Math.max(grossAmount - adjustmentAmount - computedPph23Amount, 0);
    if (hasGrossAmount) {
        if (!hasPph23Metadata) {
            if (storedNetAmount !== undefined) {
                return storedNetAmount;
            }
            if (storedPph23Amount !== undefined) {
                return Math.max(grossAmount - adjustmentAmount - storedPph23Amount, 0);
            }
        }
        return computedNetAmount;
    }

    return Math.max(storedNetAmount ?? computedNetAmount, 0);
}

export function deriveReceivableStatus(
    value: {
        totalAmount?: number | string | null;
        totalAdjustmentAmount?: number | string | null;
        pph23Enabled?: boolean | string | null;
        pph23RatePercent?: number | string | null;
        pph23BaseMode?: string | null;
        pph23Amount?: number | string | null;
        netAmount?: number | string | null;
    },
    totalPaid?: number | string | null
): 'UNPAID' | 'PARTIAL' | 'PAID' {
    const paidAmount =
        totalPaid !== undefined && totalPaid !== null
            ? Math.max(parseFormattedNumberish(totalPaid, { maxFractionDigits: 0 }), 0)
            : 0;
    const netAmount = getReceivableNetAmount(value);

    if (paidAmount >= netAmount) return 'PAID';
    if (paidAmount > 0) return 'PARTIAL';
    return 'UNPAID';
}

export function getReceivableRemainingAmount(
    value: {
        totalAmount?: number | string | null;
        totalAdjustmentAmount?: number | string | null;
        pph23Enabled?: boolean | string | null;
        pph23RatePercent?: number | string | null;
        pph23BaseMode?: string | null;
        pph23Amount?: number | string | null;
        netAmount?: number | string | null;
    },
    totalPaid?: number | string | null
) {
    const paidAmount =
        totalPaid !== undefined && totalPaid !== null
            ? Math.max(parseFormattedNumberish(totalPaid), 0)
            : 0;

    return Math.max(getReceivableNetAmount(value) - paidAmount, 0);
}

export function getDriverVoucherInitialCash(value: {
    initialCashGiven?: number | string | null;
    cashGiven?: number | string | null;
}) {
    const initialCash = parseFormattedNumberish(value.initialCashGiven ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(initialCash) && initialCash > 0) return initialCash;
    const cashGiven = parseFormattedNumberish(value.cashGiven ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(cashGiven) && cashGiven > 0) return cashGiven;
    return 0;
}

export function getDriverVoucherIssuedAmount(value: {
    totalIssuedAmount?: number | string | null;
    cashGiven?: number | string | null;
}) {
    const totalIssuedAmount = parseFormattedNumberish(value.totalIssuedAmount ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(totalIssuedAmount) && totalIssuedAmount > 0) return totalIssuedAmount;
    const cashGiven = parseFormattedNumberish(value.cashGiven ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(cashGiven) && cashGiven > 0) return cashGiven;
    return 0;
}

export function getDriverVoucherFinancialSummary(value: {
    initialCashGiven?: number | string | null;
    cashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    totalSpent?: number | string | null;
    driverFeeAmount?: number | string | null;
}) {
    const initialCashGiven = getDriverVoucherInitialCash(value);
    const totalIssuedAmount = getDriverVoucherIssuedAmount(value);
    const totalSpent = Math.max(parseFormattedNumberish(value.totalSpent ?? 0, { maxFractionDigits: 0 }), 0);
    const driverFeeAmount = Math.max(parseFormattedNumberish(value.driverFeeAmount ?? 0, { maxFractionDigits: 0 }), 0);
    const topUpAmount = Math.max(totalIssuedAmount - initialCashGiven, 0);
    const operationalBalance = totalIssuedAmount - totalSpent;
    const totalClaimAmount = totalSpent + driverFeeAmount;
    const balance = totalIssuedAmount - totalClaimAmount;

    return {
        initialCashGiven,
        totalIssuedAmount,
        totalSpent,
        driverFeeAmount,
        topUpAmount,
        operationalBalance,
        totalClaimAmount,
        balance,
    };
}

export function getDriverVoucherTopUpAmount(value: {
    initialCashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    cashGiven?: number | string | null;
}) {
    return getDriverVoucherFinancialSummary(value).topUpAmount;
}

export function getDriverVoucherOperationalBalance(value: {
    initialCashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    cashGiven?: number | string | null;
    totalSpent?: number | string | null;
}) {
    return getDriverVoucherFinancialSummary(value).operationalBalance;
}

// ── Status labels & colors ──
export const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Belum Terkirim', color: 'info' },
    PARTIAL: { label: 'Sebagian Terkirim', color: 'warning' },
    COMPLETE: { label: 'Selesai', color: 'success' },
    ON_HOLD: { label: 'Sebagian Terkirim', color: 'warning' },
    CANCELLED: { label: 'Dibatalkan', color: 'danger' },
};

export const ITEM_STATUS_MAP: Record<string, { label: string; color: string }> = {
    PENDING: { label: 'Pending', color: 'gray' },
    ASSIGNED: { label: 'Dalam DO Aktif', color: 'primary' },
    ON_DELIVERY: { label: 'Dalam Pengiriman', color: 'info' },
    PARTIAL: { label: 'Sebagian Terkirim', color: 'warning' },
    DELIVERED: { label: 'Terkirim', color: 'success' },
    HOLD: { label: 'Ditahan', color: 'warning' },
    RETURNED: { label: 'Retur', color: 'danger' },
};

export const DO_STATUS_MAP: Record<string, { label: string; color: string }> = {
    CREATED: { label: 'Dibuat', color: 'gray' },
    ON_DELIVERY: { label: 'Dalam Pengiriman', color: 'info' },
    ARRIVED: { label: 'Tiba di Tujuan', color: 'primary' },
    PARTIAL_HOLD: { label: 'Terkirim Sebagian / Hold', color: 'warning' },
    DELIVERED: { label: 'Terkirim', color: 'success' },
    CANCELLED: { label: 'Dibatalkan', color: 'danger' },
    DRIVER_REQUESTED_DELIVERED: { label: 'Driver Ajukan Finalisasi', color: 'warning' },
    DRIVER_REQUEST_REJECTED: { label: 'Permintaan Driver Ditolak', color: 'danger' },
};

export const DO_ACTUAL_DROP_TYPE_MAP: Record<string, { label: string; color: string }> = {
    DROP: { label: 'Drop', color: 'success' },
    HOLD: { label: 'Hold / Inap', color: 'warning' },
    TRANSIT: { label: 'Transit', color: 'info' },
    EXTRA_DROP: { label: 'Extra Drop', color: 'primary' },
    RETURN: { label: 'Retur / Kembali', color: 'danger' },
};

export const INVOICE_STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Bayar', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
};

export const INCIDENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Open', color: 'danger' },
    IN_PROGRESS: { label: 'Dalam Proses', color: 'warning' },
    RESOLVED: { label: 'Selesai', color: 'success' },
    CLOSED: { label: 'Ditutup', color: 'gray' },
};

export const INCIDENT_SETTLEMENT_LINE_TYPE_MAP: Record<string, { label: string; color: string }> = {
    COST: { label: 'Biaya', color: 'danger' },
    COMPENSATION: { label: 'Santunan', color: 'warning' },
    RECOVERY: { label: 'Recovery', color: 'success' },
};

export const INCIDENT_SETTLEMENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
    DRAFT: { label: 'Draft', color: 'gray' },
    APPROVED: { label: 'Disetujui', color: 'info' },
    POSTED: { label: 'Tercatat', color: 'success' },
    VOID: { label: 'Ditolak', color: 'danger' },
};

export const INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP: Record<string, string> = {
    DRIVER: 'Driver',
    KERNET: 'Kernet',
    THIRD_PARTY: 'Pihak Ketiga',
    FAMILY: 'Keluarga',
    VENDOR: 'Vendor',
    INSURANCE: 'Asuransi',
    INTERNAL: 'Internal',
    OTHER: 'Lainnya',
};

export const MAINTENANCE_STATUS_MAP: Record<string, { label: string; color: string }> = {
    SCHEDULED: { label: 'Dijadwalkan', color: 'info' },
    DONE: { label: 'Selesai', color: 'success' },
    SKIPPED: { label: 'Dilewati', color: 'gray' },
};

export const VEHICLE_STATUS_MAP: Record<string, { label: string; color: string }> = {
    ACTIVE: { label: 'Aktif', color: 'success' },
    IN_SERVICE: { label: 'Servis', color: 'warning' },
    OUT_OF_SERVICE: { label: 'Non-Aktif', color: 'danger' },
    SOLD: { label: 'Terjual', color: 'gray' },
};

export const URGENCY_MAP: Record<string, { label: string; color: string }> = {
    LOW: { label: 'Rendah', color: 'info' },
    MEDIUM: { label: 'Sedang', color: 'warning' },
    HIGH: { label: 'Tinggi', color: 'danger' },
};

export const INCIDENT_TYPE_MAP: Record<string, string> = {
    BLOWOUT_TIRE: 'Ban Meletus',
    ENGINE_TROUBLE: 'Masalah Mesin',
    ACCIDENT_MINOR: 'Kecelakaan Ringan',
    ACCIDENT_MAJOR: 'Kecelakaan Berat',
    OTHER: 'Lainnya',
};

export const INCIDENT_SETTLEMENT_CATEGORY_MAP: Record<string, string> = {
    TOWING: 'Derek / Evakuasi',
    REPAIR: 'Perbaikan Bengkel',
    SPAREPART: 'Sparepart',
    TIRE: 'Ban Darurat / Ban Pengganti',
    MEDICAL: 'Biaya Medis',
    THIRD_PARTY_DAMAGE: 'Ganti Rugi Pihak Ketiga',
    ADMINISTRATION: 'Administrasi',
    POLICE_ADMIN: 'Administrasi',
    ACCOMMODATION: 'Akomodasi Darurat',
    CARGO_HANDLING: 'Cargo Handling / Bongkar Ulang',
    COMPENSATION_DRIVER: 'Santunan Driver',
    COMPENSATION_CREW: 'Santunan Kernet',
    COMPENSATION_THIRD_PARTY: 'Santunan Pihak Ketiga',
    COMPENSATION_FAMILY: 'Santunan Keluarga',
    INSURANCE_CLAIM: 'Klaim Asuransi',
    THIRD_PARTY_RECOVERY: 'Recovery Pihak Ketiga',
    VENDOR_RECOVERY: 'Recovery Vendor',
    INTERNAL_RECOVERY: 'Recovery Internal',
    OTHER: 'Lainnya',
};

export const TIRE_POSITION_MAP: Record<string, string> = {
    FRONT_LEFT: 'Depan Kiri',
    FRONT_RIGHT: 'Depan Kanan',
    REAR_LEFT: 'Belakang Kiri',
    REAR_RIGHT: 'Belakang Kanan',
    SPARE: 'Cadangan',
};

export const TIRE_ASSET_STATUS_MAP: Record<string, { label: string; color: string }> = {
    IN_USE: { label: 'Terpasang', color: 'success' },
    SPARE: { label: 'Serep', color: 'info' },
    IN_WAREHOUSE: { label: 'Di Gudang', color: 'gray' },
    LOANED_OUT: { label: 'Dipinjam Keluar', color: 'warning' },
    SCRAPPED: { label: 'Afkir', color: 'danger' },
};

export const TIRE_ACTION_MAP: Record<string, string> = {
    PATCH: 'Tambal',
    REPLACE_NEW: 'Ganti Baru',
    ROTATE: 'Rotasi',
    VULCANIZE: 'Vulkanisir',
};

export const PAYMENT_METHOD_MAP: Record<string, string> = {
    TRANSFER: 'Transfer',
    CASH: 'Tunai',
    OTHER: 'Lainnya',
};

export const INVOICE_ADJUSTMENT_KIND_MAP: Record<string, string> = {
    DAMAGE_CLAIM: 'Klaim Barang Rusak',
    SHORTAGE_CLAIM: 'Klaim Barang Kurang',
    DISCOUNT: 'Diskon',
    PENALTY: 'Penalty',
    OTHER: 'Potongan Lainnya',
};

// ── Terbilang (number to Indonesian words) ──
export function terbilang(angka: number): string {
    const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

    if (angka < 12) return satuan[angka];
    if (angka < 20) return terbilang(angka - 10) + ' belas';
    if (angka < 100) return terbilang(Math.floor(angka / 10)) + ' puluh ' + terbilang(angka % 10);
    if (angka < 200) return 'seratus ' + terbilang(angka - 100);
    if (angka < 1000) return terbilang(Math.floor(angka / 100)) + ' ratus ' + terbilang(angka % 100);
    if (angka < 2000) return 'seribu ' + terbilang(angka - 1000);
    if (angka < 1000000) return terbilang(Math.floor(angka / 1000)) + ' ribu ' + terbilang(angka % 1000);
    if (angka < 1000000000) return terbilang(Math.floor(angka / 1000000)) + ' juta ' + terbilang(angka % 1000000);
    if (angka < 1000000000000) return terbilang(Math.floor(angka / 1000000000)) + ' miliar ' + terbilang(angka % 1000000000);
    return terbilang(Math.floor(angka / 1000000000000)) + ' triliun ' + terbilang(angka % 1000000000000);
}

// ── Truncate text ──
export function truncateText(text: string, maxLength: number = 50): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
}

// ── Generate simple ID ──
export function simpleId(): string {
    return Math.random().toString(36).substring(2, 11);
}
