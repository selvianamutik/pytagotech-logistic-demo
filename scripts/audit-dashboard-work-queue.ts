import { loadScriptEnv } from './_env';

loadScriptEnv();

import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../src/lib/auth';
import {
    applyDerivedDriverBoronganTotals,
    applyDerivedDriverVoucherLedger,
    applyDerivedFreightNotaStatus,
    type DashboardSummary,
} from '../src/lib/api/data-query-support';
import {
    createDocument,
    deleteDocument,
    listDocumentFieldsByFilter,
    listDocuments,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import { getCustomerOverpaymentRefundTotals, getFreightNotaPaymentTotals } from '../src/lib/customer-overpayments';
import {
    buildDashboardAttention,
    type DashboardAttentionIncidentSource,
    type DashboardAttentionTripSource,
} from '../src/lib/dashboard-page-support';
import { hasPageAccess, hasPermission } from '../src/lib/rbac';
import { getDriverVoucherIssuedAmount, getReceivableNetAmount } from '../src/lib/utils';
import { parseFormattedNumberish } from '../src/components/FormattedNumberInput.helpers';
import type {
    CustomerOverpaymentRefund,
    DriverBorongan,
    DriverBoronganItem,
    DriverVoucher,
    DriverVoucherDisbursement,
    DriverVoucherItem,
    FreightNota,
    Maintenance,
    UserRole,
} from '../src/lib/types';

type InternalAuditRole = Extract<UserRole, 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA'>;

type AuditUser = {
    id: string;
    email: string;
    name: string;
    role: InternalAuditRole;
};

type Session = AuditUser & {
    cookie: string;
};

type ApiResult<T = unknown> = {
    status: number;
    body: {
        data?: T;
        error?: string;
        [key: string]: unknown;
    };
};

const BASE_URL = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 45000);
const CACHE_WAIT_MS = Number(process.env.AUDIT_DASHBOARD_CACHE_WAIT_MS || 11000);
const AUDIT_ID_PREFIX = 'audit-dashboard-work-queue-';
const AUDIT_PASSWORD = `AuditDashboard-${Date.now()}!`;
const ROLES: InternalAuditRole[] = ['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA'];

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function auditStep(message: string) {
    console.log(`[audit:dashboard-work-queue] ${message}`);
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseWholeMoneyLike(value: unknown) {
    return Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
}

function isActiveFreightNota(nota: { status?: string | null }) {
    return nota.status !== 'VOID';
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${label} timeout ${REQUEST_TIMEOUT_MS} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function readCookieHeader(response: Response) {
    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') || ''];
    return cookies
        .flatMap(cookie => cookie.split(/,(?=[^;]+=[^;]+)/g))
        .map(cookie => cookie.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}

async function cleanupStaleAuditUsers() {
    const users = await listDocumentsByFilter<{ _id: string }>('user', {});
    for (const user of users.filter(item => String(item._id || '').startsWith(AUDIT_ID_PREFIX))) {
        await deleteDocument(user._id, 'user').catch(() => undefined);
    }
}

async function createAuditUsers(passwordHash: string, suffix: string) {
    const users: AuditUser[] = [];
    for (const role of ROLES) {
        const id = `${AUDIT_ID_PREFIX}${role.toLowerCase()}-${suffix}`;
        const user: AuditUser = {
            id,
            email: `audit.dashboard.${role.toLowerCase()}.${suffix}@company.local`,
            name: `Audit Dashboard ${role}`,
            role,
        };
        await createDocument({
            _id: id,
            _type: 'user',
            name: user.name,
            email: user.email,
            role: user.role,
            active: true,
            passwordHash,
        });
        users.push(user);
    }
    return users;
}

async function login(user: AuditUser): Promise<Session> {
    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/login`,
        },
        body: JSON.stringify({ email: user.email, password: AUDIT_PASSWORD, scope: 'ADMIN' }),
    }, `login ${user.role}`);
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Login ${user.role} gagal (${response.status}): ${text}`);
    }
    const cookie = readCookieHeader(response);
    assert(cookie.includes('logistik-session='), `Login ${user.role} tidak mengembalikan cookie admin`);
    return { ...user, cookie };
}

async function apiGet<T>(session: Session, pathValue: string): Promise<ApiResult<T>> {
    const response = await fetchWithTimeout(`${BASE_URL}${pathValue}`, {
        method: 'GET',
        headers: { Cookie: session.cookie },
    }, `GET ${pathValue} as ${session.role}`);
    const text = await response.text();
    const body = text ? JSON.parse(text) as ApiResult<T>['body'] : {};
    return { status: response.status, body };
}

function countStatuses(rows: Array<{ status?: string }>) {
    return rows.reduce(
        (acc, row) => {
            acc.total += 1;
            if (row.status === 'OPEN') acc.open += 1;
            if (row.status === 'PARTIAL') acc.partial += 1;
            if (row.status === 'ON_HOLD') acc.onHold += 1;
            if (row.status === 'COMPLETE') acc.complete += 1;
            return acc;
        },
        { total: 0, open: 0, partial: 0, complete: 0, onHold: 0 }
    );
}

async function buildExpectedSummary(role: InternalAuditRole): Promise<DashboardSummary> {
    const canViewOrders = hasPageAccess(role, 'orders');
    const canViewDeliveryOrders = hasPermission(role, 'deliveryOrders', 'view');
    const canViewInvoices = hasPermission(role, 'invoices', 'view');
    const canViewTripCash = hasPermission(role, 'driverVouchers', 'view');
    const canViewFleet = hasPermission(role, 'incidents', 'view') || hasPermission(role, 'maintenance', 'view');
    const canViewIncidents = hasPermission(role, 'incidents', 'view');
    const canSeeBorongan = hasPermission(role, 'driverBorongans', 'view');
    const canSeeFinancialTotals = role === 'OWNER' || role === 'FINANCE';

    const [
        orderRows,
        deliveryOrderRows,
        freightNotas,
        borongans,
        vouchers,
        incidentRows,
        maintenanceRows,
        attentionIncidentRows,
        draftSettlementLines,
        recentOrderResult,
        recentNotaResult,
    ] = await Promise.all([
        canViewOrders
            ? listDocumentFieldsByFilter<{ status?: string }>('order', ['status'], {})
            : Promise.resolve([]),
        canViewDeliveryOrders
            ? listDocumentFieldsByFilter<DashboardAttentionTripSource>('deliveryOrder', [
                'status', 'tripClosedByAdminAt', 'doNumber', 'masterResi', 'driverName', 'vehiclePlate', 'date',
                'pendingDriverStatus', 'pendingDriverStatusRequestedAt', 'pendingDriverStatusRequestedByName',
                'pendingDriverRequests', 'tripEndOdometerKm', 'odometerConfirmedAt',
            ], {})
            : Promise.resolve([]),
        canViewInvoices
            ? listDocumentFieldsByFilter<Pick<FreightNota, '_id' | 'status' | 'totalAmount' | 'totalAdjustmentAmount' | 'pph23Enabled' | 'pph23RatePercent' | 'pph23BaseMode' | 'pph23Amount' | 'netAmount'>>(
                'freightNota',
                ['status', 'totalAmount', 'totalAdjustmentAmount', 'pph23Enabled', 'pph23RatePercent', 'pph23BaseMode', 'pph23Amount', 'netAmount'],
                { status: { neq: 'VOID' } },
            )
            : Promise.resolve([]),
        canSeeBorongan
            ? listDocumentFieldsByFilter<Pick<DriverBorongan, '_id' | 'status' | 'totalAmount' | 'totalCollie' | 'totalWeightKg' | 'paidDate' | 'paidMethod' | 'paidBankRef' | 'paidBankName' | 'paidBankNumber'>>(
                'driverBorongan',
                ['status', 'totalAmount', 'totalCollie', 'totalWeightKg', 'paidDate', 'paidMethod', 'paidBankRef', 'paidBankName', 'paidBankNumber'],
                {},
            )
            : Promise.resolve([]),
        canViewTripCash
            ? listDocumentFieldsByFilter<Pick<DriverVoucher, '_id' | 'status' | 'settledDate' | 'settledBy' | 'settlementBankRef' | 'settlementBankName' | 'cashGiven' | 'initialCashGiven' | 'topUpCount' | 'totalIssuedAmount' | 'totalSpent' | 'driverFeeAmount' | 'totalClaimAmount' | 'balance'>>(
                'driverVoucher',
                ['status', 'settledDate', 'settledBy', 'settlementBankRef', 'settlementBankName', 'cashGiven', 'initialCashGiven', 'topUpCount', 'totalIssuedAmount', 'totalSpent', 'driverFeeAmount', 'totalClaimAmount', 'balance'],
                {},
            )
            : Promise.resolve([]),
        canViewFleet
            ? listDocumentFieldsByFilter<{ status?: string }>('incident', ['status'], {})
            : Promise.resolve([]),
        canViewFleet
            ? listDocumentFieldsByFilter<Pick<Maintenance, 'status'>>('maintenance', ['status'], {})
            : Promise.resolve([]),
        canViewIncidents
            ? listDocumentFieldsByFilter<DashboardAttentionIncidentSource>('incident', [
                'incidentNumber', 'vehiclePlate', 'driverName', 'status', 'dateTime',
                'pendingDriverResolutionRequestedAt', 'pendingDriverResolutionRequestedByName',
            ], { status: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] })
            : Promise.resolve([]),
        canViewIncidents
            ? listDocumentFieldsByFilter<{ incidentRef?: string }>('incidentSettlementLine', ['incidentRef'], { status: 'DRAFT' })
            : Promise.resolve([]),
        canViewOrders
            ? listDocuments<DashboardSummary['recentOrders'][number]>('order', {
                page: 1,
                pageSize: 5,
                sortField: 'createdAt',
                sortDir: 'desc',
                countStrategy: 'none',
            })
            : Promise.resolve({ items: [], total: 0 }),
        canViewInvoices
            ? listDocuments<DashboardSummary['recentNotas'][number]>('freightNota', {
                page: 1,
                pageSize: 5,
                sortField: 'issueDate',
                sortDir: 'desc',
                countStrategy: 'none',
            })
            : Promise.resolve({ items: [], total: 0 }),
    ]);

    const activeUnpaidNotas = freightNotas.filter(isActiveFreightNota);
    const activeRecentNotas = recentNotaResult.items.filter(isActiveFreightNota);
    const invoiceIdsForDashboard = Array.from(
        new Set(
            [...activeUnpaidNotas, ...activeRecentNotas]
                .map(nota => nota._id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
    );
    const boronganIds = borongans
        .map(borongan => borongan._id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const voucherIds = vouchers
        .map(voucher => voucher._id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    const [
        notaPayments,
        notaRefunds,
        boronganItems,
        voucherDisbursements,
        voucherItems,
    ] = await Promise.all([
        canViewInvoices && invoiceIdsForDashboard.length > 0
            ? listDocumentsByFilter<Array<{ invoiceRef?: string; amount?: number }>[number]>('payment', {
                invoiceRef: invoiceIdsForDashboard,
            })
            : Promise.resolve([]),
        canViewInvoices && invoiceIdsForDashboard.length > 0
            ? listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceInvoiceRef' | 'amount'>>('customerOverpaymentRefund', {
                sourceType: 'INVOICE_OVERPAID',
                sourceInvoiceRef: invoiceIdsForDashboard,
            })
            : Promise.resolve([]),
        canSeeBorongan && boronganIds.length > 0
            ? listDocumentsByFilter<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>('driverBoronganItem', {
                boronganRef: boronganIds,
            })
            : Promise.resolve([]),
        canViewTripCash && voucherIds.length > 0
            ? listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>('driverVoucherDisbursement', {
                voucherRef: voucherIds,
            })
            : Promise.resolve([]),
        canViewTripCash && voucherIds.length > 0
            ? listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', {
                voucherRef: voucherIds,
            })
            : Promise.resolve([]),
    ]);

    const notaPaymentTotals = getFreightNotaPaymentTotals(notaPayments);
    const { invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(notaRefunds);
    const derivedUnpaidNotas = applyDerivedFreightNotaStatus(activeUnpaidNotas, notaPaymentTotals, invoiceRefundsByRef).filter(nota => nota.status !== 'PAID');
    const recentNotasWithDerivedStatus = applyDerivedFreightNotaStatus(activeRecentNotas, notaPaymentTotals, invoiceRefundsByRef);
    const unpaidBorongansWithDerivedTotals = applyDerivedDriverBoronganTotals(borongans, boronganItems)
        .filter(borongan => borongan.status !== 'PAID');
    const openVouchersWithDerivedFinancials = applyDerivedDriverVoucherLedger(vouchers, voucherDisbursements, voucherItems)
        .filter(voucher => voucher.status !== 'SETTLED');

    const notaOutstanding = derivedUnpaidNotas.reduce((sum, nota) => {
        const refundedAmount = invoiceRefundsByRef[nota._id] || 0;
        const effectivePaidAmount = Math.max((notaPaymentTotals[nota._id] || 0) - refundedAmount, 0);
        return sum + Math.max(getReceivableNetAmount(nota) - effectivePaidAmount, 0);
    }, 0);
    const boronganOutstanding = unpaidBorongansWithDerivedTotals.reduce(
        (sum, borongan) => sum + parseWholeMoneyLike(borongan.totalAmount),
        0
    );
    const voucherIssued = openVouchersWithDerivedFinancials.reduce(
        (sum, voucher) => sum + getDriverVoucherIssuedAmount(voucher),
        0
    );

    return {
        orderStats: canViewOrders ? countStatuses(orderRows) : { total: 0, open: 0, partial: 0, complete: 0, onHold: 0 },
        doStats: canViewDeliveryOrders
            ? {
                total: deliveryOrderRows.length,
                onDelivery: deliveryOrderRows.filter(row => row.status === 'ON_DELIVERY').length,
            }
            : { total: 0, onDelivery: 0 },
        notaStats: {
            unpaid: canViewInvoices ? derivedUnpaidNotas.length : 0,
            totalOutstanding: canViewInvoices && canSeeFinancialTotals ? notaOutstanding : 0,
        },
        boronganStats: {
            unpaid: canSeeBorongan ? unpaidBorongansWithDerivedTotals.length : 0,
            totalOutstanding: canSeeBorongan ? boronganOutstanding : 0,
        },
        voucherStats: {
            unsettled: canViewTripCash ? openVouchersWithDerivedFinancials.length : 0,
            totalIssued: canViewTripCash && canSeeFinancialTotals ? voucherIssued : 0,
        },
        fleetStats: canViewFleet
            ? {
                openIncidents: incidentRows.filter(row => row.status === 'OPEN' || row.status === 'IN_PROGRESS').length,
                maintenanceDue: maintenanceRows.filter(row => row.status === 'SCHEDULED').length,
            }
            : { openIncidents: 0, maintenanceDue: 0 },
        attention: buildDashboardAttention(
            canViewDeliveryOrders ? deliveryOrderRows : [],
            canViewIncidents ? attentionIncidentRows : [],
            canViewIncidents ? draftSettlementLines : [],
        ),
        recentOrders: canViewOrders ? recentOrderResult.items : [],
        recentNotas: canViewInvoices ? recentNotasWithDerivedStatus : [],
    };
}

function assertJsonEqual(actual: unknown, expected: unknown, label: string) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    assert(actualJson === expectedJson, `${label} mismatch. expected ${expectedJson}, got ${actualJson}`);
}

function recentIds(rows: Array<{ _id: string }>) {
    return rows.map(row => row._id);
}

function assertDashboardSummary(role: InternalAuditRole, actual: DashboardSummary, expected: DashboardSummary) {
    const canSeeFinancialTotals = role === 'OWNER' || role === 'FINANCE';
    const canViewInvoices = hasPermission(role, 'invoices', 'view');
    const canViewTripCash = hasPermission(role, 'driverVouchers', 'view');
    const canViewOrders = hasPageAccess(role, 'orders');
    const canViewDeliveryOrders = hasPermission(role, 'deliveryOrders', 'view');
    const canViewIncidents = hasPermission(role, 'incidents', 'view');

    assertJsonEqual(actual.orderStats, expected.orderStats, `${role} orderStats`);
    assertJsonEqual(actual.doStats, expected.doStats, `${role} doStats`);
    assertJsonEqual(actual.notaStats, expected.notaStats, `${role} notaStats`);
    assertJsonEqual(actual.boronganStats, expected.boronganStats, `${role} boronganStats`);
    assertJsonEqual(actual.voucherStats, expected.voucherStats, `${role} voucherStats`);
    assertJsonEqual(actual.fleetStats, expected.fleetStats, `${role} fleetStats`);
    assertJsonEqual(actual.attention, expected.attention, `${role} attention`);
    assertJsonEqual(recentIds(actual.recentOrders), recentIds(expected.recentOrders), `${role} recent order ids`);
    assertJsonEqual(
        actual.recentNotas.map(nota => ({ id: nota._id, status: nota.status })),
        expected.recentNotas.map(nota => ({ id: nota._id, status: nota.status })),
        `${role} recent nota ids/status`
    );

    assert(actual.orderStats.partial >= 0 && actual.orderStats.onHold >= 0, `${role} partial/on-hold tidak boleh negatif`);
    assert(actual.recentNotas.every(nota => nota.status !== 'VOID'), `${role} recent invoice tidak boleh menampilkan VOID`);
    if (!canSeeFinancialTotals) {
        assert(actual.notaStats.totalOutstanding === 0, `${role} tidak boleh melihat total piutang dashboard`);
        assert(actual.voucherStats.totalIssued === 0, `${role} tidak boleh melihat total uang jalan dashboard`);
    }
    if (!canViewOrders) {
        assert(actual.orderStats.total === 0, `${role} tidak boleh melihat total order dashboard`);
        assert(actual.recentOrders.length === 0, `${role} tidak boleh melihat order terbaru dashboard`);
    }
    if (!canViewInvoices) {
        assert(actual.notaStats.unpaid === 0, `${role} tidak boleh melihat jumlah invoice dashboard`);
        assert(actual.recentNotas.length === 0, `${role} tidak boleh melihat invoice terbaru dashboard`);
    }
    if (!canViewTripCash) {
        assert(actual.voucherStats.unsettled === 0, `${role} tidak boleh melihat uang jalan dashboard`);
    }
    if (!canViewDeliveryOrders) {
        assert(actual.attention.trips.total === 0, `${role} tidak boleh melihat trip perhatian dashboard`);
        assert(actual.attention.tripApprovals.total === 0, `${role} tidak boleh melihat approval trip dashboard`);
    }
    if (!canViewIncidents) {
        assert(actual.attention.incidentApprovals.total === 0, `${role} tidak boleh melihat approval insiden dashboard`);
    }
}

async function auditDashboardApi(sessions: Session[]) {
    auditStep('bandingkan dashboard API dengan hitung ulang sumber data per role');
    for (const session of sessions) {
        const result = await apiGet<DashboardSummary>(session, '/api/data?entity=dashboard-summary');
        assert(result.status === 200, `${session.role} dashboard-summary harus 200, got ${result.status}: ${result.body.error || '-'}`);
        assert(result.body.data, `${session.role} dashboard-summary tidak mengembalikan data`);
        const expected = await buildExpectedSummary(session.role);
        assertDashboardSummary(session.role, result.body.data, expected);
    }
}

function assertSourceContains(source: string, needle: string, label: string) {
    assert(source.includes(needle), `${label} tidak ditemukan di source dashboard`);
}

function auditDashboardSourceGuards() {
    auditStep('cek static guard link, role, dan masking finansial dashboard');
    const root = process.cwd();
    const pageSource = fs.readFileSync(path.join(root, 'src/app/(admin)/dashboard/page.tsx'), 'utf8');
    const dataSource = fs.readFileSync(path.join(root, 'src/lib/api/data-query-support.ts'), 'utf8');

    for (const [needle, label] of [
        ["hasPageAccess(user, 'orders')", 'guard halaman order'],
        ["hasPermission(user, 'trips', 'view')", 'guard DO'],
        ["hasPermission(user, 'invoices', 'view')", 'guard invoice'],
        ["hasPermission(user, 'driverVouchers', 'view')", 'guard uang jalan'],
        ['canSeeFinancialTotals &&', 'masking nominal finansial'],
        ['href="/orders"', 'link order'],
        ['href="/trips"', 'link DO'],
        ['href="/invoices"', 'link invoice'],
        ['href="/fleet/incidents"', 'link insiden'],
        ['href="/fleet/maintenance"', 'link maintenance'],
        ['href="/driver-vouchers"', 'link uang jalan'],
        ['data.orderStats.onHold > 0', 'reminder order tertahan'],
        ['Trip Perlu Perhatian', 'seksi perhatian trip'],
        ['/trips?condition=driver-approval', 'link approval trip'],
        ['attention.incidentApprovals.total', 'badge approval insiden'],
    ] as const) {
        assertSourceContains(pageSource, needle, label);
    }

    assertSourceContains(dataSource, "const canViewDeliveryOrders = hasPermission(session, 'deliveryOrders', 'view')", 'backend guard DO');
    assertSourceContains(dataSource, 'canViewDeliveryOrders', 'backend DO stats harus permission-aware');
    assertSourceContains(dataSource, "if (row.status === 'ON_HOLD') acc.onHold += 1;", 'backend order on-hold terpisah dari partial');
}

async function main() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const passwordHash = await hashPassword(AUDIT_PASSWORD);
    let users: AuditUser[] = [];
    try {
        auditStep('bersihkan user audit dashboard lama');
        await cleanupStaleAuditUsers();
        users = await createAuditUsers(passwordHash, suffix);

        if (CACHE_WAIT_MS > 0) {
            auditStep(`tunggu ${CACHE_WAIT_MS} ms agar cache dashboard server kedaluwarsa`);
            await sleep(CACHE_WAIT_MS);
        }

        const sessions = await Promise.all(users.map(user => login(user)));
        await auditDashboardApi(sessions);
        auditDashboardSourceGuards();
        console.log('[audit:dashboard-work-queue] PASS dashboard angka, link kerja, role guard, dan masking finansial konsisten');
    } finally {
        for (const user of users) {
            await deleteDocument(user.id, 'user').catch(() => undefined);
        }
        await cleanupStaleAuditUsers();
    }
}

main().catch(error => {
    console.error('[audit:dashboard-work-queue] FAIL');
    console.error(error);
    process.exit(1);
});
