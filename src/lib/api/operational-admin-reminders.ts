import 'server-only';

import { addDaysToDateValue, formatBusinessDate, getBusinessDateValue } from '@/lib/business-date';
import { createDocument, listDocumentsByFilter } from '@/lib/repositories/document-store';
import type {
    AuditLog,
    CustomerOverpaymentRefund,
    FreightNota,
    InvoiceAdjustment,
    Maintenance,
    Payment,
    Purchase,
    Vehicle,
} from '@/lib/types';

import { computeReceivableSnapshot, type ReceivableDoc } from './finance-workflow-support';
import {
    notifyOperationalAdminWhatsApp,
    type OperationalAdminNotificationResult,
} from './operational-admin-notifications';

const DEFAULT_LOOKAHEAD_DAYS = 3;
const DEFAULT_MAINTENANCE_ODOMETER_LOOKAHEAD_KM = 1000;
const DEFAULT_MAX_ROWS_PER_SECTION = 3;
const REMINDER_ACTION = 'WHATSAPP_REMINDER_SENT';
const REMINDER_ENTITY_TYPE = 'whatsapp-reminder';

export type DueReminderSeverity = 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON';

export type InvoiceDueReminder = {
    kind: 'INVOICE';
    ref: string;
    number: string;
    customerName: string;
    dueDate: string;
    remainingAmount: number;
    severity: DueReminderSeverity;
    dayDelta: number;
};

export type PurchaseDueReminder = {
    kind: 'PURCHASE';
    ref: string;
    number: string;
    supplierName: string;
    dueDate: string;
    outstandingAmount: number;
    severity: DueReminderSeverity;
    dayDelta: number;
};

export type MaintenanceDueReminder = {
    kind: 'MAINTENANCE';
    ref: string;
    vehiclePlate: string;
    maintenanceType: string;
    scheduleType: 'DATE' | 'ODOMETER';
    plannedDate?: string;
    plannedOdometer?: number;
    currentOdometer?: number;
    severity: DueReminderSeverity;
    dayDelta?: number;
    remainingKm?: number;
};

export type OperationalDueReminderDigest = {
    today: string;
    lookaheadDays: number;
    odometerLookaheadKm: number;
    invoices: InvoiceDueReminder[];
    purchases: PurchaseDueReminder[];
    maintenances: MaintenanceDueReminder[];
};

export type OperationalDueReminderRunResult = {
    ok: boolean;
    skipped: boolean;
    reason?: string;
    eventKey: string;
    digest: OperationalDueReminderDigest;
    message: string;
    notification?: OperationalAdminNotificationResult;
};

function readIntegerEnv(name: string, fallback: number, options?: { min?: number; max?: number }) {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    const min = options?.min ?? Number.MIN_SAFE_INTEGER;
    const max = options?.max ?? Number.MAX_SAFE_INTEGER;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeMoney(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(Math.round(value), 0);
    }
    if (typeof value !== 'string') {
        return 0;
    }
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : 0;
}

function normalizeNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const parsed = Number(value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDateValueToUtc(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function getDayDelta(dueDate: string, today: string) {
    const dueUtc = parseDateValueToUtc(dueDate);
    const todayUtc = parseDateValueToUtc(today);
    if (dueUtc === null || todayUtc === null) {
        return 0;
    }
    return Math.round((dueUtc - todayUtc) / 86_400_000);
}

function getSeverityFromDelta(dayDelta: number): DueReminderSeverity {
    if (dayDelta < 0) return 'OVERDUE';
    if (dayDelta === 0) return 'DUE_TODAY';
    return 'DUE_SOON';
}

function formatCurrency(amount: number) {
    return `Rp ${Math.max(Math.round(amount), 0).toLocaleString('id-ID')}`;
}

function formatDateLabel(value?: string) {
    return value ? formatBusinessDate(value, 'id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
}

function formatSeverityLabel(severity: DueReminderSeverity, dayDelta?: number, remainingKm?: number) {
    if (severity === 'OVERDUE') {
        if (typeof dayDelta === 'number') return `terlambat ${Math.abs(dayDelta)} hari`;
        if (typeof remainingKm === 'number') return `lewat ${Math.abs(Math.round(remainingKm)).toLocaleString('id-ID')} km`;
        return 'terlambat';
    }
    if (severity === 'DUE_TODAY') return 'jatuh tempo hari ini';
    if (typeof dayDelta === 'number') return `H-${dayDelta}`;
    if (typeof remainingKm === 'number') return `sisa ${Math.round(remainingKm).toLocaleString('id-ID')} km`;
    return 'segera jatuh tempo';
}

function sortBySeverityAndDelta<T extends { severity: DueReminderSeverity; dayDelta?: number; remainingKm?: number }>(rows: T[]) {
    const severityRank: Record<DueReminderSeverity, number> = {
        OVERDUE: 0,
        DUE_TODAY: 1,
        DUE_SOON: 2,
    };
    return [...rows].sort((left, right) => {
        const rankDelta = severityRank[left.severity] - severityRank[right.severity];
        if (rankDelta !== 0) return rankDelta;
        const leftDelta = typeof left.dayDelta === 'number' ? left.dayDelta : left.remainingKm ?? 0;
        const rightDelta = typeof right.dayDelta === 'number' ? right.dayDelta : right.remainingKm ?? 0;
        return leftDelta - rightDelta;
    });
}

function sumAmounts<T>(rows: T[], getAmount: (row: T) => number) {
    return rows.reduce((sum, row) => sum + Math.max(getAmount(row), 0), 0);
}

async function collectInvoiceDueReminders(today: string, futureDate: string): Promise<InvoiceDueReminder[]> {
    const notas = await listDocumentsByFilter<FreightNota>('freightNota', {
        status: { neq: 'VOID' },
        dueDate: { lte: futureDate },
    });
    const candidateNotas = notas.filter(nota => nota.status !== 'PAID' && nota.dueDate);
    if (candidateNotas.length === 0) return [];

    const notaRefs = candidateNotas.map(nota => nota._id);
    const [payments, approvedAdjustments, refunds] = await Promise.all([
        listDocumentsByFilter<Payment>('payment', { invoiceRef: notaRefs }),
        listDocumentsByFilter<InvoiceAdjustment>('invoiceAdjustment', { invoiceRef: notaRefs, status: 'APPROVED' }),
        listDocumentsByFilter<CustomerOverpaymentRefund>('customerOverpaymentRefund', {
            sourceType: 'INVOICE_OVERPAID',
            sourceInvoiceRef: notaRefs,
        }),
    ]);

    const paymentsByNota = new Map<string, Payment[]>();
    for (const payment of payments) {
        if (!payment.invoiceRef) continue;
        paymentsByNota.set(payment.invoiceRef, [...(paymentsByNota.get(payment.invoiceRef) || []), payment]);
    }

    const adjustmentsByNota = new Map<string, InvoiceAdjustment[]>();
    for (const adjustment of approvedAdjustments) {
        if (!adjustment.invoiceRef) continue;
        adjustmentsByNota.set(adjustment.invoiceRef, [...(adjustmentsByNota.get(adjustment.invoiceRef) || []), adjustment]);
    }

    const refundAmountByNota = new Map<string, number>();
    for (const refund of refunds) {
        if (!refund.sourceInvoiceRef) continue;
        refundAmountByNota.set(
            refund.sourceInvoiceRef,
            (refundAmountByNota.get(refund.sourceInvoiceRef) || 0) + normalizeMoney(refund.amount)
        );
    }

    return sortBySeverityAndDelta(candidateNotas.flatMap((nota): InvoiceDueReminder[] => {
        const dueDate = nota.dueDate || '';
        const snapshot = computeReceivableSnapshot(
            nota as unknown as ReceivableDoc,
            paymentsByNota.get(nota._id) || [],
            adjustmentsByNota.get(nota._id) || [],
            refundAmountByNota.get(nota._id) || 0
        );
        if (snapshot.remainingAmount <= 0) return [];
        const dayDelta = getDayDelta(dueDate, today);
        return [{
            kind: 'INVOICE',
            ref: nota._id,
            number: nota.notaDisplayNumber || nota.notaNumber || nota._id,
            customerName: nota.customerName || '-',
            dueDate,
            remainingAmount: snapshot.remainingAmount,
            severity: getSeverityFromDelta(dayDelta),
            dayDelta,
        }];
    }));
}

async function collectPurchaseDueReminders(today: string, futureDate: string): Promise<PurchaseDueReminder[]> {
    const purchases = await listDocumentsByFilter<Purchase>('purchase', {
        status: { neq: 'CANCELLED' },
        dueDate: { lte: futureDate },
    });

    return sortBySeverityAndDelta(purchases.flatMap((purchase): PurchaseDueReminder[] => {
        if (!purchase.dueDate || purchase.status === 'PAID' || purchase.status === 'CANCELLED') return [];
        const outstandingAmount =
            normalizeMoney(purchase.outstandingAmount) ||
            Math.max(normalizeMoney(purchase.totalAmount) - normalizeMoney(purchase.paidAmount), 0);
        if (outstandingAmount <= 0) return [];
        const dayDelta = getDayDelta(purchase.dueDate, today);
        return [{
            kind: 'PURCHASE',
            ref: purchase._id,
            number: purchase.purchaseNumber || purchase._id,
            supplierName: purchase.supplierName || '-',
            dueDate: purchase.dueDate,
            outstandingAmount,
            severity: getSeverityFromDelta(dayDelta),
            dayDelta,
        }];
    }));
}

async function collectMaintenanceDueReminders(
    today: string,
    futureDate: string,
    odometerLookaheadKm: number
): Promise<MaintenanceDueReminder[]> {
    const maintenances = await listDocumentsByFilter<Maintenance>('maintenance', { status: 'SCHEDULED' });
    if (maintenances.length === 0) return [];

    const vehicleRefs = [...new Set(maintenances.map(item => item.vehicleRef).filter(Boolean))];
    const vehicles = vehicleRefs.length > 0
        ? await listDocumentsByFilter<Pick<Vehicle, '_id' | 'lastOdometer' | 'plateNumber'>>('vehicle', { _id: vehicleRefs })
        : [];
    const vehiclesById = new Map(vehicles.map(vehicle => [vehicle._id, vehicle]));

    return sortBySeverityAndDelta(maintenances.flatMap((maintenance): MaintenanceDueReminder[] => {
        if (maintenance.scheduleType === 'DATE') {
            const plannedDate = maintenance.plannedDate || '';
            if (!plannedDate || plannedDate > futureDate) return [];
            const dayDelta = getDayDelta(plannedDate, today);
            return [{
                kind: 'MAINTENANCE',
                ref: maintenance._id,
                vehiclePlate: maintenance.vehiclePlate || vehiclesById.get(maintenance.vehicleRef)?.plateNumber || '-',
                maintenanceType: maintenance.type || 'Maintenance',
                scheduleType: 'DATE',
                plannedDate,
                severity: getSeverityFromDelta(dayDelta),
                dayDelta,
            }];
        }

        const plannedOdometer = normalizeNumber(maintenance.plannedOdometer);
        if (plannedOdometer === undefined || plannedOdometer <= 0) return [];
        const vehicle = vehiclesById.get(maintenance.vehicleRef);
        const currentOdometer = normalizeNumber(vehicle?.lastOdometer) || 0;
        const remainingKm = plannedOdometer - currentOdometer;
        if (remainingKm > odometerLookaheadKm) return [];
        return [{
            kind: 'MAINTENANCE',
            ref: maintenance._id,
            vehiclePlate: maintenance.vehiclePlate || vehicle?.plateNumber || '-',
            maintenanceType: maintenance.type || 'Maintenance',
            scheduleType: 'ODOMETER',
            plannedOdometer,
            currentOdometer,
            severity: remainingKm <= 0 ? 'OVERDUE' : 'DUE_SOON',
            remainingKm,
        }];
    }));
}

export async function collectOperationalDueReminders(options?: {
    today?: string;
    lookaheadDays?: number;
    odometerLookaheadKm?: number;
}): Promise<OperationalDueReminderDigest> {
    const today = options?.today || getBusinessDateValue();
    const lookaheadDays = Math.min(Math.max(options?.lookaheadDays ?? readIntegerEnv(
        'OPERATIONAL_ADMIN_REMINDER_LOOKAHEAD_DAYS',
        DEFAULT_LOOKAHEAD_DAYS,
        { min: 0, max: 30 }
    ), 0), 30);
    const odometerLookaheadKm = Math.min(Math.max(options?.odometerLookaheadKm ?? readIntegerEnv(
        'OPERATIONAL_ADMIN_MAINTENANCE_ODOMETER_LOOKAHEAD_KM',
        DEFAULT_MAINTENANCE_ODOMETER_LOOKAHEAD_KM,
        { min: 0, max: 10000 }
    ), 0), 10000);
    const futureDate = addDaysToDateValue(today, lookaheadDays) || today;
    const [invoices, purchases, maintenances] = await Promise.all([
        collectInvoiceDueReminders(today, futureDate),
        collectPurchaseDueReminders(today, futureDate),
        collectMaintenanceDueReminders(today, futureDate, odometerLookaheadKm),
    ]);

    return {
        today,
        lookaheadDays,
        odometerLookaheadKm,
        invoices,
        purchases,
        maintenances,
    };
}

function hasAnyReminder(digest: OperationalDueReminderDigest) {
    return digest.invoices.length > 0 || digest.purchases.length > 0 || digest.maintenances.length > 0;
}

function formatInvoiceLine(item: InvoiceDueReminder) {
    return `${item.number} - ${item.customerName} - ${formatSeverityLabel(item.severity, item.dayDelta)} - ${formatCurrency(item.remainingAmount)}`;
}

function formatPurchaseLine(item: PurchaseDueReminder) {
    return `${item.number} - ${item.supplierName} - ${formatSeverityLabel(item.severity, item.dayDelta)} - ${formatCurrency(item.outstandingAmount)}`;
}

function formatMaintenanceLine(item: MaintenanceDueReminder) {
    if (item.scheduleType === 'DATE') {
        return `${item.vehiclePlate} - ${item.maintenanceType} - ${formatSeverityLabel(item.severity, item.dayDelta)} (${formatDateLabel(item.plannedDate)})`;
    }
    return `${item.vehiclePlate} - ${item.maintenanceType} - ${formatSeverityLabel(item.severity, undefined, item.remainingKm)} (${Math.round(item.currentOdometer || 0).toLocaleString('id-ID')}/${Math.round(item.plannedOdometer || 0).toLocaleString('id-ID')} km)`;
}

function appendSection<T>(params: {
    lines: string[];
    title: string;
    rows: T[];
    totalLabel?: string;
    maxRows: number;
    formatter: (row: T) => string;
}) {
    if (params.rows.length === 0) return;
    params.lines.push('');
    params.lines.push(params.totalLabel ? `${params.title}: ${params.rows.length} (${params.totalLabel})` : `${params.title}: ${params.rows.length}`);
    params.rows.slice(0, params.maxRows).forEach((row, index) => {
        params.lines.push(`${index + 1}. ${params.formatter(row)}`);
    });
    if (params.rows.length > params.maxRows) {
        params.lines.push(`+${params.rows.length - params.maxRows} lainnya. Buka dashboard untuk detail.`);
    }
}

export function buildOperationalDueReminderMessage(digest: OperationalDueReminderDigest, options?: { maxRowsPerSection?: number }) {
    if (!hasAnyReminder(digest)) return '';
    const maxRows = Math.min(Math.max(options?.maxRowsPerSection ?? readIntegerEnv(
        'OPERATIONAL_ADMIN_REMINDER_MAX_ROWS',
        DEFAULT_MAX_ROWS_PER_SECTION,
        { min: 1, max: 10 }
    ), 1), 10);
    const lines = [
        `[Logistik Demo] Reminder operasional ${formatDateLabel(digest.today)}.`,
        `Cakupan: overdue, hari ini, dan H-${digest.lookaheadDays}; maintenance odometer sisa <= ${digest.odometerLookaheadKm.toLocaleString('id-ID')} km.`,
    ];

    appendSection({
        lines,
        title: 'Invoice jatuh tempo',
        rows: digest.invoices,
        totalLabel: formatCurrency(sumAmounts(digest.invoices, item => item.remainingAmount)),
        maxRows,
        formatter: formatInvoiceLine,
    });
    appendSection({
        lines,
        title: 'Hutang supplier jatuh tempo',
        rows: digest.purchases,
        totalLabel: formatCurrency(sumAmounts(digest.purchases, item => item.outstandingAmount)),
        maxRows,
        formatter: formatPurchaseLine,
    });
    appendSection({
        lines,
        title: 'Maintenance waktunya',
        rows: digest.maintenances,
        maxRows,
        formatter: formatMaintenanceLine,
    });
    lines.push('');
    lines.push('Mohon review di admin panel.');
    return lines.join('\n');
}

export function buildOperationalDueReminderEventKey(today: string) {
    return `operational-due-reminders:${today}`;
}

async function hasReminderAuditLog(eventKey: string) {
    const rows = await listDocumentsByFilter<Pick<AuditLog, '_id'>>('auditLog', {
        action: REMINDER_ACTION,
        entityType: REMINDER_ENTITY_TYPE,
        entityRef: eventKey,
    });
    return rows.length > 0;
}

async function writeReminderAuditLog(eventKey: string, message: string) {
    await createDocument({
        _id: `audit-log-${crypto.randomUUID()}`,
        _type: 'auditLog',
        actorUserName: 'System Reminder',
        action: REMINDER_ACTION,
        entityType: REMINDER_ENTITY_TYPE,
        entityRef: eventKey,
        changesSummary: message,
        timestamp: new Date().toISOString(),
    }, { skipApiReadCacheClear: true, skipRelationalReadCacheClear: true });
}

export async function runOperationalDueReminder(options?: {
    dryRun?: boolean;
    force?: boolean;
    today?: string;
    lookaheadDays?: number;
    odometerLookaheadKm?: number;
}): Promise<OperationalDueReminderRunResult> {
    const digest = await collectOperationalDueReminders(options);
    const message = buildOperationalDueReminderMessage(digest);
    const eventKey = buildOperationalDueReminderEventKey(digest.today);

    if (!message) {
        return { ok: true, skipped: true, reason: 'NO_REMINDERS', eventKey, digest, message };
    }

    if (!options?.force && await hasReminderAuditLog(eventKey)) {
        return { ok: true, skipped: true, reason: 'ALREADY_SENT_TODAY', eventKey, digest, message };
    }

    if (options?.dryRun) {
        return { ok: true, skipped: true, reason: 'DRY_RUN', eventKey, digest, message };
    }

    const notification = await notifyOperationalAdminWhatsApp(message);
    if (notification.ok && !notification.skipped) {
        await writeReminderAuditLog(eventKey, message);
    }

    return {
        ok: notification.ok,
        skipped: notification.skipped,
        reason: notification.reason,
        eventKey,
        digest,
        message,
        notification,
    };
}
