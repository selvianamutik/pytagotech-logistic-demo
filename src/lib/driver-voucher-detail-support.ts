import { escapePrintHtml } from './print';
import type { DeliveryOrder, DriverVoucher, DriverVoucherDisbursement, DriverVoucherItem } from './types';
import { getBusinessDateValue } from './business-date';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { formatCurrency, formatDate, getDriverVoucherInitialCash, getDriverVoucherIssuedAmount, getDriverVoucherOperationalBalance, getDriverVoucherTopUpAmount } from './utils';
import { formatDriverVoucherRouteForDisplay } from './driver-voucher-route';

export const DRIVER_VOUCHER_STATUS_MAP: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'badge-gray' },
    ISSUED: { label: 'Diberikan', cls: 'badge-blue' },
    SETTLED: { label: 'Selesai', cls: 'badge-green' },
};

export const DRIVER_VOUCHER_EXPENSE_CATEGORIES = [
    'BBM / Solar',
    'Tol & Parkir',
    'Konsumsi Driver',
    'Menginap Driver',
    'Bongkar Muat',
    'Perbaikan Darurat Trip',
    'Towing / Evakuasi',
    'Lain-lain Trip',
];

export type DriverVoucherItemFormState = {
    expenseDate: string;
    category: string;
    description: string;
    amount: number;
};

export type DriverVoucherTopUpFormState = {
    date: string;
    bankAccountRef: string;
    amount: number;
    note: string;
};

export function createDefaultDriverVoucherItemForm(): DriverVoucherItemFormState {
    return {
        expenseDate: getBusinessDateValue(),
        category: 'BBM / Solar',
        description: '',
        amount: 0,
    };
}

export function createDefaultDriverVoucherTopUpForm(issueBankRef = ''): DriverVoucherTopUpFormState {
    return {
        date: getBusinessDateValue(),
        bankAccountRef: issueBankRef,
        amount: 0,
        note: '',
    };
}

function getDisbursementKindSortValue(kind: DriverVoucherDisbursement['kind']) {
    return kind === 'INITIAL' ? 0 : 1;
}

function getDisbursementCreatedAtValue(disbursement: DriverVoucherDisbursement) {
    return disbursement._createdAt || disbursement.createdAt || '';
}

export function isActiveDriverVoucherDisbursement(disbursement: Pick<DriverVoucherDisbursement, 'status'>) {
    return disbursement.status !== 'VOID';
}

export function sortDriverVoucherDisbursementsChronologically(disbursements: DriverVoucherDisbursement[]) {
    return disbursements.filter(isActiveDriverVoucherDisbursement).sort((a, b) => {
        const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
        if (dateCompare !== 0) return dateCompare;

        const kindCompare = getDisbursementKindSortValue(a.kind) - getDisbursementKindSortValue(b.kind);
        if (kindCompare !== 0) return kindCompare;

        const createdAtCompare = getDisbursementCreatedAtValue(a).localeCompare(getDisbursementCreatedAtValue(b));
        if (createdAtCompare !== 0) return createdAtCompare;

        return String(a._id || '').localeCompare(String(b._id || ''));
    });
}

export function sortDriverVoucherDisbursements(disbursements: DriverVoucherDisbursement[]) {
    return sortDriverVoucherDisbursementsChronologically(disbursements);
}

export function sortDriverVoucherItems(items: DriverVoucherItem[]) {
    return [...items].sort((a, b) => `${b.expenseDate || ''}-${b._id}`.localeCompare(`${a.expenseDate || ''}-${a._id}`));
}

export function formatDriverVoucherBonLabel(sequence: number) {
    if (sequence === 1) return 'Bon Pertama';
    if (sequence === 2) return 'Bon Kedua';
    if (sequence === 3) return 'Bon Ketiga';
    return `Bon Ke-${sequence}`;
}

export function getDriverVoucherDisbursementLabel(
    disbursement: DriverVoucherDisbursement,
    disbursements: DriverVoucherDisbursement[]
) {
    const ordered = sortDriverVoucherDisbursementsChronologically(disbursements);
    const index = ordered.findIndex(item => item._id === disbursement._id);
    return formatDriverVoucherBonLabel(index >= 0 ? index + 1 : 1);
}

export function inferDriverVoucherDisbursementCount(value: Partial<Pick<DriverVoucher, 'initialCashGiven' | 'cashGiven' | 'totalIssuedAmount' | 'topUpCount'>> & { topUpAmount?: number | string | null } | null | undefined) {
    if (!value) return 0;
    const initialCount = getDriverVoucherInitialCash(value) > 0 ? 1 : 0;
    const explicitTopUpCount = Math.max(parseFormattedNumberish(value.topUpCount || 0, { maxFractionDigits: 0 }), 0);
    const topUpAmount = value.topUpAmount !== undefined
        ? Math.max(parseFormattedNumberish(value.topUpAmount || 0, { maxFractionDigits: 0 }), 0)
        : getDriverVoucherTopUpAmount(value);
    const topUpCount = explicitTopUpCount > 0 ? explicitTopUpCount : topUpAmount > 0 ? 1 : 0;

    return initialCount + topUpCount;
}

function getPriorBonReferenceLabel(sequence: number) {
    if (sequence <= 2) return 'Bon Pertama';
    return 'Bon Pertama dan Bon Kedua';
}

function getFirstTwoBonAmount(input: {
    disbursements?: DriverVoucherDisbursement[];
    initialCashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    topUpAmount?: number | string | null;
}) {
    const ordered = input.disbursements
        ? sortDriverVoucherDisbursementsChronologically(input.disbursements)
        : [];
    if (ordered.length > 0) {
        return ordered
            .slice(0, 2)
            .reduce((sum, item) => sum + parseFormattedNumberish(item.amount || 0, { maxFractionDigits: 0 }), 0);
    }

    const initialCashGiven = Math.max(parseFormattedNumberish(input.initialCashGiven || 0, { maxFractionDigits: 0 }), 0);
    const topUpAmount = Math.max(parseFormattedNumberish(input.topUpAmount || 0, { maxFractionDigits: 0 }), 0);
    const totalIssuedAmount = Math.max(parseFormattedNumberish(input.totalIssuedAmount || 0, { maxFractionDigits: 0 }), 0);
    if (totalIssuedAmount > 0 && initialCashGiven + topUpAmount <= 0) return totalIssuedAmount;
    return initialCashGiven + topUpAmount;
}

export function buildDriverVoucherSettlementDisplay(input: {
    balance: number;
    disbursements?: DriverVoucherDisbursement[];
    fallbackDisbursementCount?: number;
    initialCashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    topUpAmount?: number | string | null;
    totalClaimAmount?: number | string | null;
}) {
    const balance = parseFormattedNumberish(input.balance || 0, { maxFractionDigits: 0 });
    const activeDisbursementCount = input.disbursements
        ? sortDriverVoucherDisbursementsChronologically(input.disbursements).length
        : 0;
    const disbursementCount = Math.max(activeDisbursementCount, input.fallbackDisbursementCount || 0);
    const closingSequence = Math.max(2, Math.min(disbursementCount + 1, 3));
    const closingBonLabel = `${formatDriverVoucherBonLabel(closingSequence)} Penutupan`;
    const settlementAmount = Math.abs(balance);
    const totalClaimAmount = Math.max(parseFormattedNumberish(input.totalClaimAmount || 0, { maxFractionDigits: 0 }), 0);
    const firstTwoBonAmount = getFirstTwoBonAmount(input);
    const closingBonAmount = balance < 0 && totalClaimAmount > 0 && firstTwoBonAmount > 0
        ? Math.max(totalClaimAmount - firstTwoBonAmount, settlementAmount)
        : settlementAmount;
    const alreadyDisbursedClosingAmount = Math.max(closingBonAmount - settlementAmount, 0);

    if (balance < 0) {
        const priorBonLabel = getPriorBonReferenceLabel(closingSequence);
        const settlementNote = alreadyDisbursedClosingAmount > 0
            ? ` Sudah tercatat di bon penutup ${formatCurrency(alreadyDisbursedClosingAmount)}, sisa dicairkan saat penutupan ${formatCurrency(settlementAmount)}.`
            : ' Dicairkan saat penutupan trip.';
        return {
            label: closingBonLabel,
            description: `${closingBonLabel}: total biaya dikurangi ${priorBonLabel}.${settlementNote}`,
            primaryActionLabel: 'Selesaikan & Catat Bon Penutupan',
            bankFieldLabel: `Rekening / Kas ${closingBonLabel}`,
            amount: closingBonAmount,
            settlementAmount,
            alreadyDisbursedClosingAmount,
        };
    }

    if (balance > 0) {
        return {
            label: 'Pengembalian Sisa Bon',
            description: 'Total uang diberikan lebih besar dari total biaya trip; driver mengembalikan selisih ke rekening atau kas perusahaan',
            primaryActionLabel: 'Selesaikan & Catat Pengembalian Sisa Bon',
            bankFieldLabel: 'Rekening / Kas Pengembalian Sisa Bon',
            amount: settlementAmount,
            settlementAmount,
            alreadyDisbursedClosingAmount: 0,
        };
    }

    return {
        label: 'Penyelesaian Uang Jalan',
        description: 'Tidak ada selisih uang jalan yang perlu dibayar atau dikembalikan',
        primaryActionLabel: 'Selesaikan Trip',
        bankFieldLabel: 'Rekening / Kas Penyelesaian',
        amount: 0,
        settlementAmount: 0,
        alreadyDisbursedClosingAmount: 0,
    };
}

export function buildDriverVoucherCashBreakdown(
    disbursements: DriverVoucherDisbursement[],
    summary: Pick<ReturnType<typeof buildDriverVoucherDetailSummary>, 'initialCashGiven' | 'topUpAmount'>
) {
    const ordered = sortDriverVoucherDisbursementsChronologically(disbursements);
    if (ordered.length > 0) {
        return ordered
            .map((item, index) => `${formatDriverVoucherBonLabel(index + 1)} ${formatCurrency(item.amount)}`)
            .join(' | ');
    }

    return `Bon Pertama ${formatCurrency(summary.initialCashGiven)}${summary.topUpAmount > 0 ? ` | Bon Kedua ${formatCurrency(summary.topUpAmount)}` : ''}`;
}

export function buildDriverVoucherDetailSummary(voucher: DriverVoucher | null, items: DriverVoucherItem[]) {
    const operationalSpent = items.reduce(
        (sum, item) => sum + parseFormattedNumberish(item.amount || 0, { maxFractionDigits: 0 }),
        0
    );
    const driverFeeAmount = parseFormattedNumberish(voucher?.driverFeeAmount || 0, { maxFractionDigits: 0 });
    const totalClaimAmount = operationalSpent + driverFeeAmount;
    const initialCashGiven = getDriverVoucherInitialCash(voucher || {});
    const totalIssuedAmount = getDriverVoucherIssuedAmount(voucher || {});
    const topUpAmount = getDriverVoucherTopUpAmount(voucher || {});
    const operationalBalance = getDriverVoucherOperationalBalance({
        ...(voucher || {}),
        totalSpent: operationalSpent,
    });
    const balance = totalIssuedAmount - totalClaimAmount;
    const isSettled = voucher?.status === 'SETTLED';
    const statusConfig = DRIVER_VOUCHER_STATUS_MAP[voucher?.status || ''] || { label: voucher?.status || '-', cls: 'badge-gray' };
    const settlementDisplay = buildDriverVoucherSettlementDisplay({
        balance,
        fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
            ...(voucher || {}),
            topUpAmount,
        }),
        initialCashGiven,
        topUpAmount,
        totalIssuedAmount,
        totalClaimAmount,
    });
    const settlementLabel = settlementDisplay.description;
    const settlementPrimaryLabel = settlementDisplay.primaryActionLabel;

    return {
        operationalSpent,
        operationalBalance,
        driverFeeAmount,
        totalClaimAmount,
        initialCashGiven,
        totalIssuedAmount,
        topUpAmount,
        balance,
        isSettled,
        statusConfig,
        settlementLabel,
        settlementPrimaryLabel,
    };
}

export function buildDriverVoucherPrintHtml(params: {
    voucher: DriverVoucher;
    deliveryOrder?: DeliveryOrder | null;
    items: DriverVoucherItem[];
    disbursements: DriverVoucherDisbursement[];
    summary: ReturnType<typeof buildDriverVoucherDetailSummary>;
}) {
    const { voucher, deliveryOrder, items, disbursements, summary } = params;
    const {
        operationalSpent,
        driverFeeAmount,
        totalClaimAmount,
        initialCashGiven,
        totalIssuedAmount,
        topUpAmount,
        balance,
    } = summary;
    const routeLabel = formatDriverVoucherRouteForDisplay(voucher.route) || voucher.route || '-';
    const printedDisbursements = sortDriverVoucherDisbursementsChronologically(disbursements);
    const settlementDisplay = buildDriverVoucherSettlementDisplay({
        balance,
        disbursements: printedDisbursements,
        fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
            ...voucher,
            topUpAmount,
        }),
        initialCashGiven,
        topUpAmount,
        totalIssuedAmount,
        totalClaimAmount,
    });
    const settlementColor = balance < 0 ? '#dc2626' : balance > 0 ? '#16a34a' : '#1e293b';
    const statusLabel = DRIVER_VOUCHER_STATUS_MAP[voucher.status || '']?.label || voucher.status || '-';
    const deliveryOrderBaseTripFee =
        deliveryOrder?.baseTaripBorongan
        ?? deliveryOrder?.taripBorongan
        ?? 0;
    const deliveryOrderOvertonaseAmount = deliveryOrder?.overtonaseDriverAmount || 0;
    const deliveryOrderWageDeductionAmount = deliveryOrder?.manualTripFeeDeductionAmount || 0;
    const deliveryOrderShowsWageDeduction = deliveryOrderWageDeductionAmount > 0;
    const deliveryOrderHasFinalActualWeight = (deliveryOrder?.actualTotalWeightKg || 0) > 0;
    const deliveryOrderFinalTripFee = deliveryOrder?.taripBorongan || driverFeeAmount;

    const disbursementSection = printedDisbursements.length > 0 ? `
        <div style="margin-top:16px">
            <div class="section-title">Riwayat Bon / Uang Jalan</div>
            <table>
                <thead>
                    <tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Sumber Dana</th><th>Catatan</th><th class="r">Jumlah</th></tr>
                </thead>
                <tbody>
                    ${printedDisbursements.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escapePrintHtml(formatDate(item.date))}</td>
                            <td>${escapePrintHtml(formatDriverVoucherBonLabel(index + 1))}</td>
                            <td>${escapePrintHtml(item.bankAccountName || '-')}</td>
                            <td>${escapePrintHtml(item.note || '-')}</td>
                            <td class="r">${escapePrintHtml(formatCurrency(item.amount))}</td>
                        </tr>
                    `).join('')}
                    <tr style="border-top:2px solid #1e293b">
                        <td colspan="5" class="r b">Total Uang Jalan Diberikan</td>
                        <td class="r b">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    ` : totalIssuedAmount > 0 ? `
        <div style="margin-top:16px">
            <div class="section-title">Riwayat Bon / Uang Jalan</div>
            <table>
                <thead>
                    <tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Sumber Dana</th><th>Catatan</th><th class="r">Jumlah</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td>1</td>
                        <td>${escapePrintHtml(formatDate(voucher.issuedDate || ''))}</td>
                        <td>Bon Pertama</td>
                        <td>${escapePrintHtml(voucher.issueBankName || '-')}</td>
                        <td>Riwayat detail belum tersedia</td>
                        <td class="r">${escapePrintHtml(formatCurrency(initialCashGiven || totalIssuedAmount))}</td>
                    </tr>
                    ${topUpAmount > 0 ? `
                        <tr>
                            <td>2</td>
                            <td>${escapePrintHtml(formatDate(voucher.issuedDate || ''))}</td>
                            <td>Bon Kedua</td>
                            <td>${escapePrintHtml(voucher.issueBankName || '-')}</td>
                            <td>Riwayat detail belum tersedia</td>
                            <td class="r">${escapePrintHtml(formatCurrency(topUpAmount))}</td>
                        </tr>
                    ` : ''}
                    <tr style="border-top:2px solid #1e293b">
                        <td colspan="5" class="r b">Total Uang Jalan Diberikan</td>
                        <td class="r b">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    ` : `
        <div style="margin-top:16px">
            <div class="section-title">Riwayat Bon / Uang Jalan</div>
            <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:10px 12px;color:#64748b">
                Belum ada riwayat pencairan uang jalan.
            </div>
        </div>
    `;

    const expenseSection = items.length > 0 ? `
        <div style="margin-top:16px">
            <div class="section-title">Biaya Lain-lain Aktual</div>
            <table>
                <thead><tr><th>No</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
                <tbody>
                    ${items.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escapePrintHtml(item.expenseDate ? formatDate(item.expenseDate) : '-')}</td>
                            <td class="b">${escapePrintHtml(item.category)}</td>
                            <td>${escapePrintHtml(item.description || '-')}</td>
                            <td class="r">${escapePrintHtml(formatCurrency(item.amount))}</td>
                        </tr>
                    `).join('')}
                    <tr style="border-top:2px solid #1e293b">
                        <td colspan="4" class="r b">Total Biaya Lain-lain</td>
                        <td class="r b">${escapePrintHtml(formatCurrency(operationalSpent))}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    ` : `
        <div style="margin-top:16px">
            <div class="section-title">Biaya Lain-lain Aktual</div>
            <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:10px 12px;color:#64748b">
                Belum ada biaya lain-lain aktual yang dicatat.
            </div>
        </div>
    `;

    return `
        <div class="stats-row" style="margin-bottom:16px">
            <div class="stat-box">
                <div class="stat-label">Total Bon Diberikan</div>
                <div class="stat-value">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Biaya Lain-lain</div>
                <div class="stat-value d">${escapePrintHtml(formatCurrency(operationalSpent))}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Total Biaya</div>
                <div class="stat-value">${escapePrintHtml(formatCurrency(totalClaimAmount))}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">${escapePrintHtml(settlementDisplay.label)}</div>
                <div class="stat-value" style="color:${settlementColor}">${escapePrintHtml(formatCurrency(settlementDisplay.amount))}</div>
            </div>
        </div>

        <div class="section-title">Informasi Trip</div>
        <div style="margin-bottom:12px">
            <table style="width:100%;border:none;margin-top:0">
                <tbody>
                    <tr><td style="border:none;padding:2px 8px;width:130px;font-weight:600">No. Bon</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.bonNumber)}</td><td style="border:none;padding:2px 8px;width:130px;font-weight:600">Tanggal</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatDate(voucher.issuedDate || ''))}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Supir</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.driverName || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.vehiclePlate || '-')}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">No. DO Internal</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.doNumber || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Rute</td><td style="border:none;padding:2px 8px">${escapePrintHtml(routeLabel)}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Status</td><td style="border:none;padding:2px 8px">${escapePrintHtml(statusLabel)}</td><td style="border:none;padding:2px 8px;font-weight:600">Rekening Sumber</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.issueBankName || '-')}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Rekening Penyelesaian</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.settlementBankName || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Catatan</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.notes || '-')}</td></tr>
                </tbody>
            </table>
        </div>
        ${deliveryOrder ? `
            <div style="margin-top:16px">
                <div class="section-title">Referensi Upah Trip DO</div>
                <table>
                    <thead>
                        <tr><th>Keterangan</th><th class="r">Nilai</th></tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Upah Dasar DO</td>
                            <td class="r">${escapePrintHtml(formatCurrency(deliveryOrderBaseTripFee))}</td>
                        </tr>
                        <tr>
                            <td>Tambahan Overtonase</td>
                            <td class="r">${deliveryOrderHasFinalActualWeight ? escapePrintHtml(formatCurrency(deliveryOrderOvertonaseAmount)) : 'Menunggu aktual final'}</td>
                        </tr>
                        ${deliveryOrderShowsWageDeduction ? `
                        <tr>
                            <td>Pengurangan Upah</td>
                            <td class="r">${deliveryOrderHasFinalActualWeight ? escapePrintHtml(`-${formatCurrency(deliveryOrderWageDeductionAmount)}`) : 'Menunggu aktual final'}</td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td>Upah Borongan Final DO</td>
                            <td class="r">${deliveryOrderHasFinalActualWeight ? escapePrintHtml(formatCurrency(deliveryOrderFinalTripFee)) : 'Menunggu aktual final'}</td>
                        </tr>
                        ${deliveryOrderHasFinalActualWeight ? `
                            <tr>
                                <td>Berat Aktual Final</td>
                                <td class="r">${escapePrintHtml(`${deliveryOrder.actualTotalWeightKg || 0} kg`)}</td>
                            </tr>
                            <tr>
                                <td>Berat Overtonase</td>
                                <td class="r">${escapePrintHtml(deliveryOrder.overtonaseWeightKg ? `${deliveryOrder.overtonaseWeightKg} kg` : '-') }</td>
                            </tr>
                        ` : ''}
                    </tbody>
                </table>
            </div>
        ` : ''}
        ${disbursementSection}
        ${expenseSection}
        <div style="margin-top:16px">
            <div class="section-title">Ringkasan Penyelesaian Uang Jalan</div>
            <table>
            <thead>
                <tr><th class="c" style="width:64px">Simbol</th><th>Keterangan</th><th class="r">Jumlah</th></tr>
            </thead>
            <tbody>
                <tr>
                    <td class="c b">=</td>
                    <td class="b">Total Biaya</td>
                    <td class="r b">${escapePrintHtml(formatCurrency(totalClaimAmount))}</td>
                </tr>
                <tr>
                    <td class="c b">-</td>
                    <td>Total Uang Jalan Diberikan</td>
                    <td class="r b">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td>
                </tr>
                <tr>
                    <td class="c b">&nbsp;</td>
                    <td>Biaya Lain-lain Aktual</td>
                    <td class="r">${escapePrintHtml(formatCurrency(operationalSpent))}</td>
                </tr>
                <tr>
                    <td class="c b">+</td>
                    <td>Upah Borongan</td>
                    <td class="r">${escapePrintHtml(formatCurrency(driverFeeAmount))}</td>
                </tr>
                <tr style="border-top:2px solid #1e293b">
                    <td class="c b">=</td>
                    <td class="b">${escapePrintHtml(settlementDisplay.label)}</td>
                    <td class="r b" style="color:${settlementColor}">${escapePrintHtml(formatCurrency(settlementDisplay.amount))}</td>
                </tr>
                ${settlementDisplay.amount !== settlementDisplay.settlementAmount ? `
                    <tr>
                        <td class="c b">&nbsp;</td>
                        <td>Sisa dicairkan saat penutupan</td>
                        <td class="r">${escapePrintHtml(formatCurrency(settlementDisplay.settlementAmount))}</td>
                    </tr>
                ` : ''}
            </tbody>
            </table>
        </div>
    `;
}
