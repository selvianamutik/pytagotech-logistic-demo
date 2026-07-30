/* ============================================================
   LOGISTIK - General Data API
   Centralized CRUD API - Supabase Backend
   ============================================================ */

import { getSession } from '@/lib/auth';
import {
    createDocument,
    getAllDocuments,
    getCompanyProfile,
    getDocumentById,
    listDocuments,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { clearRelationalReadCache } from '@/lib/supabase-relational';
import {
    ensureCashAccount,
    isMutationConflictError,
    isPlainObject,
    sanitizeCompanyProfileForRole,
    sanitizeUserForClient,
    type ApiSession as Session,
} from '@/lib/api/data-helpers';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import {
    handleAccountingPeriodClose,
    handleAccountingPeriodOpen,
    handleManualJournalCreate,
    handleManualJournalVoid,
} from '@/lib/api/accounting-workflows';
import { assertAccountingPeriodOpen } from '@/lib/api/accounting-period-lock';
import {
    sanitizeJournalEntriesForRole,
    sanitizeJournalLinesForRole,
} from '@/lib/api/accounting-privacy';
import {
    handleBoronganPayment,
    handleDriverVoucherCreate,
    handleDriverVoucherDisbursementDelete,
    handleDriverVoucherDisbursementUpdate,
    handleDriverVoucherIssueRepair,
    handleDriverVoucherItemCreate,
    handleDriverVoucherItemDelete,
    handleDriverVoucherItemUpdate,
    handleDriverVoucherSettlement,
    handleDriverVoucherTopUp,
} from '@/lib/api/driver-workflows';
import {
    handleBankTransfer,
    handleCustomerOverpaymentRefund,
    handleCustomerReceiptCreate,
    handleExpenseCreate,
    handleFreightNotaCreate,
    handleFreightNotaDelete,
    handleFreightNotaPph23Update,
    handleFreightNotaTaxInvoiceUpdate,
    handleFreightNotaUpdate,
    handleInvoiceAdjustmentCreate,
    handleInvoiceAdjustmentDelete,
    handleInvoiceAdjustmentUpdate,
    handleInvoiceAdjustmentVoid,
    handlePaymentCreate,
    handlePaymentUpdate,
} from '@/lib/api/finance-workflows';
import {
    handlePurchaseCreate,
    handlePurchasePaymentCreate,
    handlePurchaseReceive,
    handleStockMovementCreate,
} from '@/lib/api/inventory-workflows';
import {
    getMaintenanceMaterialOptions,
    handleMaintenanceComplete,
    handleTireTechnicianCostCreate,
} from '@/lib/api/maintenance-workflows';
import {
    handleGenericCreate,
    handleGenericDelete,
    handleGenericUpdate,
    handleSupplierItemPriceRevise,
    handleTireInstallToSlot,
} from '@/lib/api/generic-workflows';
import {
    handleIncidentCreate,
    handleIncidentMaintenanceHandlingCreate,
    handleIncidentSettlementLineCreate,
    handleIncidentSettlementLineDelete,
    handleIncidentSettlementLineMaintenanceFollowUpCreate,
    handleIncidentSettlementLineStatusUpdate,
    handleIncidentSettlementLineTireFollowUpCreate,
    handleIncidentSettlementLineUpdate,
    handleIncidentStatusUpdate,
} from '@/lib/api/operations-workflows';
import {
    handleDeliveryOrderAppendCargoItems,
    handleDeliveryOrderCargoItemUpdate,
    handleDeliveryOrderCargoItemRemove,
    handleDeliveryOrderManualOvertonaseUpdate,
    handleDeliveryOrderSuratJalanActualCargoUpdate,
    handleDeliveryOrderCancelTrip,
    handleDeliveryOrderContinueHeldCargo,
    handleDeliveryOrderCreate,
    handleDeliveryOrderBatchSuratJalanStatusUpdate,
    handleDeliveryOrderShipperReferenceUpdate,
    handleDeliveryOrderTripResourceAssign,
    handleDeliveryOrderDriverStatusRequestReject,
    handleDeliveryOrderStatusUpdate,
    handleDeliveryOrderTripClosureSet,
    handleOrderCancel,
    handleOrderDelete,
    handleOrderItemHoldRelease,
    handleOrderItemHoldSet,
    handleOrderCreate,
    handleOrderHeaderBookingUpdate,
    handleOrderTripPlanCancel,
    handleOrderTripPlanAppend,
    handleOrderTripPlanUpdate,
    handleOrderTargetRevision,
    handleOrderUpdateWithItems,
} from '@/lib/api/order-workflows';
import { handleDriverScoreEndEarly } from '@/lib/api/driver-score-workflows';
import { handleInvoiceCreate } from '@/lib/api/support-workflows';
import {
    filterExpensesByRole,
    hasPermission,
    normalizeUserRole,
    sanitizeVehicleForRole,
    type AppModule,
    type ModulePermissions,
} from '@/lib/rbac';
import {
    getAuditLogList,
    getAuditLogsSummary,
    getBankAccountsSummary,
    applyDerivedBankAccountBalances,
    getEmployeeAttendanceList,
    getEmployeeAttendanceSummary,
    getCustomerReceiptById,
    getCustomerReceiptList,
    getCustomerOverpaymentById,
    getCustomerOverpaymentList,
    getDriverBoronganById,
    getDriverBoronganList,
    getDriverBoronganDoRefsSummary,
    getDeliveryOrderTripCashLink,
    getDriverVoucherList,
    getCustomersSummary,
    getDashboardSummary,
    getExpenseList,
    getExpensesSummary,
    getFreightNotaById,
    getFreightNotaList,
    getDriverVoucherById,
    getUsersSummary,
    getVehiclesSummary,
    applyDerivedDriverBoronganTotals,
    applyDerivedDriverVoucherLedger,
    applyDerivedFreightNotaStatus,
} from '@/lib/api/data-query-support';
import {
    deriveDeliveryOrdersForResponse,
    deriveFreightNotaItemsForResponse,
    deriveOrdersForResponse,
} from '@/lib/api/response-derivations';
import { getProjectedDocumentRead } from '@/lib/api/projected-document-reads';
import { getCustomerOverpaymentRefundTotals } from '@/lib/customer-overpayments';
import { getBusinessDateValue } from '@/lib/business-date';
import { DOCUMENT_TYPE_MAP } from '@/lib/document-types';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { getDataServiceErrorInfo } from '@/lib/service-errors';
import type { BankAccount, BankTransaction, CompanyProfile, CustomerOverpaymentRefund, DeliveryOrder, DriverBorongan, DriverBoronganItem, DriverVoucher, DriverVoucherDisbursement, DriverVoucherItem, Expense, FreightNota, FreightNotaItem, JournalEntry, JournalLine, Order, OrderTripPlan, User, Vehicle } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Role-based entity gating is replaced by module permission system.
// All entities are gated via ENTITY_MODULE_MAP + forbidModuleAccess.
const LEGACY_READ_ONLY_ENTITIES = new Set(['invoices', 'invoice-items']);
const PROJECTED_READ_ENTITIES = new Set(['trips', 'surat-jalan', 'surat-jalan-items', 'trip-tracking', 'trip-detail', 'surat-jalan-detail', 'trip-detail-references']);
type ReceiptResponseShape = Record<string, unknown> & {
    _id: string;
    totalAmount?: number | string | null;
    allocatedAmount?: number | string | null;
    unappliedAmount?: number | string | null;
    allocationCount?: number | string | null;
};

const ENTITY_MODULE_MAP: Partial<Record<keyof typeof DOCUMENT_TYPE_MAP, AppModule>> = {
    employees: 'employees',
    'employee-attendance-records': 'attendance',
    suppliers: 'suppliers',
    'supplier-item-prices': 'suppliers',
    'warehouse-items': 'warehouseItems',
    purchases: 'purchases',
    'purchase-items': 'purchases',
    'purchase-payments': 'purchases',
    'stock-movements': 'warehouseItems',
    'chart-of-accounts': 'reports',
    'journal-entries': 'reports',
    'journal-lines': 'reports',
    'accounting-periods': 'reports',
    customers: 'customers',
    'customer-products': 'customers',
    'customer-billing-rates': 'customers',
    'customer-recipients': 'customers',
    'customer-pickups': 'customers',
    'trip-route-rates': 'tripRouteRates',
    services: 'services',
    'expense-categories': 'expenseCategories',
    drivers: 'drivers',
    orders: 'orders',
    'order-items': 'orders',
    'delivery-orders': 'deliveryOrders',
    'delivery-order-items': 'deliveryOrders',
    'trip-records': 'deliveryOrders',
    'surat-jalan-records': 'deliveryOrders',
    'surat-jalan-record-items': 'deliveryOrders',
    'tracking-logs': 'deliveryOrders',
    payments: 'invoices',
    'customer-receipts': 'invoices',
    'customer-overpayment-refunds': 'invoices',
    'invoice-adjustments': 'invoices',
    expenses: 'expenses',
    vehicles: 'vehicles',
    maintenances: 'maintenance',
    'tire-events': 'tires',
    'tire-history-logs': 'tires',
    incidents: 'incidents',
    'incident-action-logs': 'incidents',
    'incident-settlement-lines': 'incidents',
    'bank-accounts': 'bankAccounts',
    'bank-transactions': 'bankAccounts',
    'driver-vouchers': 'driverVouchers',
    'driver-voucher-disbursements': 'driverVouchers',
    'driver-voucher-items': 'driverVouchers',
    'freight-notas': 'invoices',
    'freight-nota-items': 'invoices',
    invoices: 'invoices',
    'invoice-items': 'invoices',
    'driver-borongans': 'driverBorongans',
    'driver-borongan-items': 'driverBorongans',
    'driver-scores': 'driverScores',
    users: 'userManagement',
    'audit-logs': 'auditLogs',
    company: 'companySettings',
    incomes: 'expenses',
};

function validateEntity(entity: string | null): entity is keyof typeof DOCUMENT_TYPE_MAP {
    return Boolean(entity && DOCUMENT_TYPE_MAP[entity]);
}

function getEntityModule(entity: string | null): AppModule | null {
    if (!entity) return null;
    return ENTITY_MODULE_MAP[entity as keyof typeof DOCUMENT_TYPE_MAP] || null;
}

function getMutationPermissionAction(action?: string): keyof ModulePermissions {
    if (action === 'delete') return 'delete';
    if (
        action === 'update' ||
        action === 'receive' ||
        action === 'record-payment' ||
        action === 'update-with-items' ||
        action === 'update-pph23' ||
        action === 'update-tax-invoice' ||
        action === 'update-header-booking' ||
        action === 'append-trip-plan' ||
        action === 'cancel-order' ||
        action === 'cancel-trip-plan' ||
        action === 'delete-trip-plan' ||
        action === 'update-trip-plan' ||
        action === 'revise-targets' ||
        action === 'revise-price' ||
        action === 'set-status' ||
        action === 'set-surat-jalan-status-batch' ||
        action === 'cancel-trip' ||
        action === 'assign-trip-resources' ||
        action === 'append-cargo-items' ||
        action === 'update-cargo-item' ||
        action === 'remove-cargo-item' ||
        action === 'update-shipper-reference' ||
        action === 'update-surat-jalan-actual-cargo' ||
        action === 'set-trip-closure' ||
        action === 'continue-held-cargo' ||
        action === 'reject-driver-status-request' ||
        action === 'set-hold-quantity' ||
        action === 'release-hold' ||
        action === 'settle' ||
        action === 'top-up' ||
        action === 'repair-issue-ledger' ||
        action === 'mark-paid' ||
        action === 'void' ||
        action === 'end-early' ||
        action === 'create-tire-follow-up' ||
        action === 'create-maintenance-follow-up' ||
        action === 'record-maintenance-handling' ||
        action === 'complete-with-materials'
        || action === 'install-to-slot' ||
        action === 'close-period' ||
        action === 'open-period'
    ) {
        return 'update';
    }
    return 'create';
}

function hasSpecialMutationPermission(session: Session, entity: string, action?: string): boolean | null {

    if (entity === 'delivery-orders' && action === 'assign-trip-resources') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'delivery-orders' && action === 'append-cargo-items') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'delivery-orders' && action === 'update-cargo-item') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'delivery-orders' && action === 'remove-cargo-item') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'delivery-orders' && action === 'update-shipper-reference') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'delivery-orders' && action === 'update-surat-jalan-actual-cargo') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'delivery-orders' && action === 'set-trip-closure') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'delivery-orders' && action === 'continue-held-cargo') {
        return hasPermission(session, 'deliveryOrders', 'update');
    }

    if (entity === 'driver-vouchers' && action === 'settle') {
        return hasPermission(session, 'driverVouchers', 'update');
    }

    if (entity === 'driver-vouchers' && action === 'top-up') {
        return hasPermission(session, 'driverVouchers', 'create');
    }

    if (entity === 'driver-vouchers' && action === 'repair-issue-ledger') {
        return hasPermission(session, 'driverVouchers', 'update');
    }

    if (entity === 'purchases' && action === 'receive') {
        return hasPermission(session, 'purchases', 'update');
    }

    if (entity === 'purchase-payments' && action === 'record-payment') {
        return hasPermission(session, 'purchases', 'create');
    }

    if (entity === 'stock-movements') {
        return hasPermission(session, 'purchases', 'create');
    }

    if (entity === 'journal-entries' && action === 'create-manual') {
        return hasPermission(session, 'reports', 'create');
    }

    if (entity === 'journal-entries' && action === 'void-manual') {
        return hasPermission(session, 'reports', 'update');
    }

    if (entity === 'accounting-periods' && (action === 'close-period' || action === 'open-period')) {
        return hasPermission(session, 'reports', 'update');
    }

    return null;
}

function forbidModuleAccess(session: Session, entity: string, action: keyof ModulePermissions) {
    const targetModule = getEntityModule(entity);
    if (!targetModule) return null;
    if (!hasPermission(session, targetModule, action)) {
        return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
}

function parseWholeMoneyLike(value: unknown) {
    return Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
}

const ACCOUNTING_LOCKED_ENTITIES = new Set([
    'bank-accounts',
    'bank-transactions',
    'customer-overpayment-refunds',
    'customer-receipts',
    'driver-voucher-disbursements',
    'driver-vouchers',
    'expenses',
    'freight-notas',
    'invoice-adjustments',
    'journal-entries',
    'maintenances',
    'payments',
    'purchase-payments',
    'purchases',
    'stock-movements',
]);

const ACCOUNTING_DATE_FIELDS = [
    'entryDate',
    'date',
    'issueDate',
    'receiptDate',
    'receiveDate',
    'paymentDate',
    'movementDate',
    'issuedDate',
    'settledDate',
    'serviceDate',
    'completedDate',
    'orderDate',
];

function normalizeApiDateValue(value: unknown) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : '';
}

function normalizeOptionalId(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getBusinessDateForApiGuard() {
    return getBusinessDateValue();
}

function extractAccountingDateCandidates(data: Record<string, unknown>) {
    return ACCOUNTING_DATE_FIELDS
        .map(field => normalizeApiDateValue(data[field]))
        .filter(Boolean);
}

function shouldLoadExistingAccountingDate(entity: string, action: string | undefined) {
    return Boolean(
        action === 'update' ||
        action === 'delete' ||
        action === 'void' ||
        action === 'void-manual' ||
        action === 'update-with-items' ||
        action === 'update-pph23' ||
        action === 'update-tax-invoice' ||
        (entity === 'payments' && action === 'update') ||
        (entity === 'driver-voucher-disbursements' && (action === 'update' || action === 'delete')) ||
        (entity === 'driver-voucher-items' && (action === 'update' || action === 'delete'))
    );
}

function shouldFallbackToBusinessDate(entity: string, action: string | undefined) {
    return Boolean(
        entity === 'bank-accounts' ||
        (entity === 'driver-vouchers' && (action === 'settle' || action === 'repair-issue-ledger')) ||
        (entity === 'stock-movements' && (!action || action === 'create')) ||
        (entity === 'expenses' && (!action || action === 'create'))
    );
}

async function assertMutationAccountingPeriodOpen(
    entity: string,
    docType: string,
    action: string | undefined,
    data: Record<string, unknown>,
) {
    if (entity === 'accounting-periods' || !ACCOUNTING_LOCKED_ENTITIES.has(entity)) {
        return;
    }

    const candidates = extractAccountingDateCandidates(data);
    const id = normalizeOptionalId(data.id) || normalizeOptionalId(data._id);
    if (candidates.length === 0 && id && shouldLoadExistingAccountingDate(entity, action)) {
        const existing = await getDocumentById<Record<string, unknown>>(id, docType);
        if (existing) {
            candidates.push(...extractAccountingDateCandidates(existing));
        }
    }

    if (candidates.length === 0 && shouldFallbackToBusinessDate(entity, action)) {
        candidates.push(getBusinessDateForApiGuard());
    }

    for (const dateValue of [...new Set(candidates)]) {
        await assertAccountingPeriodOpen(dateValue, 'Perubahan data');
    }
}

function normalizeAuditActorRole(value: unknown) {
    return value === 'OWNER' || value === 'OPERASIONAL' || value === 'FINANCE' || value === 'ARMADA' || value === 'DRIVER' || value === 'ADMIN'
        ? value
        : undefined;
}

function inferAuditActorRoleFromIdentity(actorUserRef: unknown, actorUserEmail: unknown, entityRef?: unknown) {
    const ref = typeof actorUserRef === 'string'
        ? actorUserRef.trim().toLowerCase()
        : typeof entityRef === 'string'
            ? entityRef.trim().toLowerCase()
            : '';
    const email = typeof actorUserEmail === 'string' ? actorUserEmail.trim().toLowerCase() : '';
    const identity = `${ref} ${email}`;

    if (identity.includes('user-owner-') || email.startsWith('owner@')) return 'OWNER';
    if (identity.includes('user-admin-') || email.startsWith('admin@')) return 'OPERASIONAL';
    if (identity.includes('user-finance-') || email.startsWith('finance@')) return 'FINANCE';
    if (identity.includes('user-armada-') || email.startsWith('armada@')) return 'ARMADA';
    if (identity.includes('user-driver-') || email.startsWith('driver.')) return 'DRIVER';
    return undefined;
}

function inferAuditActorEmailFromRef(actorUserRef: unknown, entityRef?: unknown) {
    const ref = typeof actorUserRef === 'string'
        ? actorUserRef.trim().toLowerCase()
        : typeof entityRef === 'string'
            ? entityRef.trim().toLowerCase()
            : '';

    if (ref.includes('user-owner-')) return 'owner@company.local';
    if (ref.includes('user-admin-')) return 'admin@company.local';
    if (ref.includes('user-finance-')) return 'finance@company.local';
    if (ref.includes('user-armada-')) return 'armada@company.local';
    return undefined;
}

function normalizeRouteText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

async function handleOrderTripPlanDeleteLocal(session: Session, data: Record<string, unknown>) {
    const id = normalizeRouteText(data.id);
    const tripPlanKey = normalizeRouteText(data.tripPlanKey);
    if (!id || !tripPlanKey) {
        return jsonNoStore({ error: 'Rencana trip tidak valid' }, { status: 400 });
    }

    const order = await getDocumentById<{
        _id: string;
        masterResi?: string;
        tripPlans?: OrderTripPlan[];
    }>(id, 'order');
    if (!order) {
        return jsonNoStore({ error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const currentTripPlans = Array.isArray(order.tripPlans) ? order.tripPlans : [];
    const tripPlan = currentTripPlans.find(plan => normalizeRouteText(plan._key) === tripPlanKey) || null;
    if (!tripPlan) {
        return jsonNoStore({ error: 'Rencana trip tidak ditemukan. Refresh lalu coba lagi.' }, { status: 404 });
    }
    if (tripPlan.linkedDeliveryOrderRef) {
        return jsonNoStore(
            { error: 'Rencana trip yang sudah punya SJ tidak bisa dihapus dari detail order.' },
            { status: 409 }
        );
    }

    const nextTripPlans = currentTripPlans
        .filter(plan => normalizeRouteText(plan._key) !== tripPlanKey)
        .map((plan, index) => ({
            ...plan,
            sequence: index + 1,
        }));

    let updatedOrder: unknown;
    try {
        updatedOrder = await updateDocument(id, {
            tripPlans: nextTripPlans.length > 0 ? nextTripPlans : undefined,
        }, 'order');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return jsonNoStore(
                { error: 'Rencana trip order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Hapus rencana trip ${tripPlan.sequence} pada ${order.masterResi || id}`
    );
    return jsonNoStore({ data: updatedOrder, id, deletedTripPlanKey: tripPlanKey });
}

function enforceExpensePrivacyFilter(
    session: Session,
    filterObj?: Record<string, unknown>
) {
    if (normalizeUserRole(session.role) === 'OWNER') {
        return filterObj;
    }

    return {
        ...(filterObj || {}),
        privacyLevel: 'internal',
    };
}

function applyDerivedCustomerReceiptAllocationsLocal<
    T extends {
        _id: string;
        totalAmount?: number | string | null;
        allocatedAmount?: number | string | null;
        unappliedAmount?: number | string | null;
        allocationCount?: number | string | null;
    }
>(
    receipts: T[],
    allocationRows: Array<{ receiptRef?: string; amount?: unknown }>
) {
    const totalsByReceipt = allocationRows.reduce<Record<string, { allocatedAmount: number; allocationCount: number }>>(
        (acc, row) => {
            if (!row.receiptRef) return acc;
            const current = acc[row.receiptRef] || { allocatedAmount: 0, allocationCount: 0 };
            current.allocatedAmount += parseWholeMoneyLike(row.amount);
            current.allocationCount += 1;
            acc[row.receiptRef] = current;
            return acc;
        },
        {}
    );

    return receipts.map(receipt => {
        const totalAmount = parseWholeMoneyLike(receipt.totalAmount);
        const derived = totalsByReceipt[receipt._id] || { allocatedAmount: 0, allocationCount: 0 };
        return {
            ...receipt,
            totalAmount,
            allocatedAmount: derived.allocatedAmount,
            unappliedAmount: Math.max(totalAmount - derived.allocatedAmount, 0),
            allocationCount: derived.allocationCount,
        };
    });
}

async function deriveCustomerReceiptsForResponse<T extends ReceiptResponseShape>(receipts: T[]) {
    if (receipts.length === 0) return receipts;
    const ids = receipts.map(receipt => receipt._id).filter(Boolean);
    const allocationRows = await listDocumentsByFilter<{ receiptRef?: string; amount?: unknown }>('payment', {
        receiptRef: ids,
    });
    return applyDerivedCustomerReceiptAllocationsLocal(receipts, allocationRows);
}

async function addAuditLog(
    session: Pick<Session, '_id' | 'name'> & Partial<Pick<Session, 'email' | 'role'>>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await createDocument({
            _type: 'auditLog',
            actorUserRef: session._id,
            actorUserName: session.name,
            actorUserEmail: session.email,
            actorUserRole: session.role,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed');
    }
}

function parseCommaSeparatedParam(value: string | null) {
    return value
        ? value.split(',').map(item => item.trim()).filter(Boolean)
        : [];
}

export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'DRIVER') {
        return jsonNoStore({ error: 'Driver tidak diizinkan mengakses API admin' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const entity = searchParams.get('entity');
    const id = searchParams.get('id');
    const filter = searchParams.get('filter');
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const searchQuery = searchParams.get('q')?.trim() || '';
    const searchFieldsParam = searchParams.get('searchFields');
    const countOnly = searchParams.get('countOnly') === '1';
    const sortField = searchParams.get('sortField')?.trim() || undefined;
    const sortDirParam = searchParams.get('sortDir');
    const sortDir = sortDirParam === 'asc' ? 'asc' : sortDirParam === 'desc' ? 'desc' : undefined;
    const sortPreset = searchParams.get('sortPreset');
    const orFiltersParam = searchParams.get('orFilters');
    const definedFieldsParam = searchParams.get('definedFields');
    const periodParam = searchParams.get('period');
    const auditEntityRef = searchParams.get('entityRef');
    const auditEntityRefs = parseCommaSeparatedParam(searchParams.get('entityRefs'));
    const auditEntityType = searchParams.get('entityType');
    const auditEntityTypes = parseCommaSeparatedParam(searchParams.get('entityTypes'));

    if (entity === 'dashboard-summary') {
        if (!hasPermission(session, 'dashboard', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getDashboardSummary(session);
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Dashboard Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'customers-summary') {
        if (!hasPermission(session, 'customers', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const idsParam = searchParams.get('ids');
            const ids = idsParam
                ? idsParam.split(',').map(value => value.trim()).filter(Boolean)
                : [];
            const summary = await getCustomersSummary(ids);
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Customer Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'vehicles-summary') {
        if (!hasPermission(session, 'vehicles', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const idsParam = searchParams.get('ids');
            const ids = idsParam
                ? idsParam.split(',').map(value => value.trim()).filter(Boolean)
                : [];
            const summary = await getVehiclesSummary(ids);
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Vehicle Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'expenses-summary') {
        if (!hasPermission(session, 'expenses', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        let expenseFilterObj: Record<string, unknown> | undefined;
        if (filter) {
            try {
                expenseFilterObj = JSON.parse(filter) as Record<string, unknown>;
            } catch {
                return jsonNoStore({ error: 'Filter query tidak valid' }, { status: 400 });
            }
        }
        try {
            expenseFilterObj = enforceExpensePrivacyFilter(session, expenseFilterObj);
            const searchFields = searchFieldsParam
                ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                : [];
            const summary = await getExpensesSummary(session, {
                search: searchQuery || undefined,
                searchFields,
                filterObj: expenseFilterObj,
                dateFrom: searchParams.get('dateFrom'),
                dateTo: searchParams.get('dateTo'),
            });
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Expense Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'bank-accounts-summary') {
        if (!hasPermission(session, 'bankAccounts', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getBankAccountsSummary();
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Bank Account Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'bank-transactions-summary') {
        if (!hasPermission(session, 'bankAccounts', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }

        const bankAccountRef = searchParams.get('bankAccountRef')?.trim();
        if (!bankAccountRef) {
            return jsonNoStore({ error: 'Rekening / kas wajib dipilih' }, { status: 400 });
        }

        try {
            const dateFrom = searchParams.get('dateFrom')?.trim().slice(0, 10);
            const dateTo = searchParams.get('dateTo')?.trim().slice(0, 10);
            const txFilter: Record<string, unknown> = { bankAccountRef };
            const dateFilter: Record<string, string> = {};
            if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
                dateFilter.gte = dateFrom;
            }
            if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
                dateFilter.lte = dateTo;
            }
            if (Object.keys(dateFilter).length > 0) {
                txFilter.date = dateFilter;
            }
            const txRows = await listDocumentsByFilter<Pick<BankTransaction, 'type' | 'amount'>>('bankTransaction', txFilter);
            const summary = txRows.reduce(
                (acc, tx) => {
                    const amount = parseFormattedNumberish(tx.amount ?? 0, { maxFractionDigits: 0 });
                    if (tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN') {
                        acc.totalIn += amount;
                    } else if (tx.type === 'DEBIT' || tx.type === 'TRANSFER_OUT') {
                        acc.totalOut += amount;
                    }
                    acc.totalTransactions += 1;
                    return acc;
                },
                { totalIn: 0, totalOut: 0, totalTransactions: 0 }
            );
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Bank Transaction Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'audit-logs-summary') {
        if (!hasPermission(session, 'auditLogs', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const searchFields = searchFieldsParam
                ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                : [];
            const summary = await getAuditLogsSummary({
                search: searchQuery || undefined,
                searchFields,
                period: periodParam,
                entityRef: auditEntityRef,
                entityRefs: auditEntityRefs,
                entityType: auditEntityType,
                entityTypes: auditEntityTypes,
            });
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Audit Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'users-summary') {
        if (!hasPermission(session, 'userManagement', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getUsersSummary();
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Users Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'employee-attendance-summary') {
        if (!hasPermission(session, 'attendance', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const searchFields = searchFieldsParam
                ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                : [];
            const summary = await getEmployeeAttendanceSummary({
                search: searchQuery || undefined,
                searchFields,
                period: periodParam,
                date: searchParams.get('date'),
                status: searchParams.get('status'),
                employeeRef: searchParams.get('employeeRef'),
            });
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Employee Attendance Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'employee-attendance-records' && !id) {
        if (!hasPermission(session, 'attendance', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
            const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
            const searchFields = searchFieldsParam
                ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                : [];
            const result = await getEmployeeAttendanceList({
                search: searchQuery || undefined,
                searchFields,
                page: countOnly ? undefined : page,
                pageSize: countOnly ? undefined : pageSize,
                sortField,
                sortDir,
                period: periodParam,
                date: searchParams.get('date'),
                status: searchParams.get('status'),
                employeeRef: searchParams.get('employeeRef'),
                countOnly,
            });
            return jsonNoStore({
                data: countOnly ? [] : result.items,
                meta: {
                    page,
                    pageSize,
                    total: result.total,
                },
            });
        } catch (err) {
            console.error('API GET Employee Attendance Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'driver-borongan-do-refs') {
        if (!hasPermission(session, 'driverVouchers', 'create')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getDriverBoronganDoRefsSummary();
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Driver Borongan DO Ref Summary Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'delivery-order-trip-cash-link') {
        if (!hasPermission(session, 'deliveryOrders', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        const deliveryOrderRef = searchParams.get('deliveryOrderRef')?.trim();
        if (!deliveryOrderRef) {
            return jsonNoStore({ error: 'Delivery order ref wajib diisi' }, { status: 400 });
        }
        try {
            const summary = await getDeliveryOrderTripCashLink(deliveryOrderRef);
            return jsonNoStore({ data: summary });
        } catch (err) {
            console.error('API GET Delivery Order Trip Cash Link Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'customer-overpayments') {
        if (!hasPermission(session, 'invoices', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            let customerOverpaymentFilterObj: Record<string, unknown> | undefined;
            let customerOverpaymentOrFilters: Array<{ fields: string[]; value: string | number | boolean }> = [];
            let customerOverpaymentDefinedFields: string[] = [];

            if (filter) {
                try {
                    customerOverpaymentFilterObj = JSON.parse(filter) as Record<string, unknown>;
                } catch (error) {
                    return jsonNoStore(
                        { error: error instanceof Error ? error.message : 'Filter query tidak valid' },
                        { status: 400 }
                    );
                }
            }

            if (orFiltersParam) {
                try {
                    const parsed = JSON.parse(orFiltersParam) as unknown;
                    if (!Array.isArray(parsed)) {
                        throw new Error('Or filter query tidak valid');
                    }
                    customerOverpaymentOrFilters = parsed
                        .filter((item): item is { fields: string[]; value: string | number | boolean } => (
                            typeof item === 'object' &&
                            item !== null &&
                            Array.isArray((item as { fields?: unknown }).fields) &&
                            ((item as { value?: unknown }).value === undefined
                                || ['string', 'number', 'boolean'].includes(typeof (item as { value?: unknown }).value))
                        ))
                        .map(item => ({
                            fields: item.fields.map(field => String(field).trim()).filter(Boolean),
                            value: item.value as string | number | boolean,
                        }))
                        .filter(item => item.fields.length > 0);
                } catch (error) {
                    return jsonNoStore(
                        { error: error instanceof Error ? error.message : 'Or filter query tidak valid' },
                        { status: 400 }
                    );
                }
            }

            if (definedFieldsParam) {
                customerOverpaymentDefinedFields = definedFieldsParam
                    .split(',')
                    .map(field => field.trim())
                    .filter(Boolean);
            }

            if (id) {
                const item = await getCustomerOverpaymentById(id);
                if (!item) {
                    return jsonNoStore({ error: 'Not found' }, { status: 404 });
                }
                return jsonNoStore({ data: item });
            }

            const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
            const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
            const searchFields = searchFieldsParam
                ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                : [];
            const result = await getCustomerOverpaymentList({
                filterObj: customerOverpaymentFilterObj,
                orFilters: customerOverpaymentOrFilters,
                definedFields: customerOverpaymentDefinedFields,
                search: searchQuery || undefined,
                searchFields,
                page: pageParam || pageSizeParam ? page : undefined,
                pageSize: pageParam || pageSizeParam ? pageSize : undefined,
                sortField,
                sortDir,
                sortPreset,
                countOnly,
            });
            if (countOnly) {
                return jsonNoStore({
                    data: [],
                    meta: {
                        page,
                        pageSize,
                        total: result.total,
                    },
                });
            }
            return jsonNoStore({
                data: result.items,
                meta: {
                    page,
                    pageSize,
                    total: result.total,
                },
            });
        } catch (err) {
            console.error('API GET Customer Overpayment Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'maintenance-material-options') {
        if (!hasPermission(session, 'maintenance', 'update')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const options = await getMaintenanceMaterialOptions();
            return jsonNoStore({ data: options });
        } catch (err) {
            console.error('API GET Maintenance Material Options Error:', err);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (PROJECTED_READ_ENTITIES.has(entity || '')) {
        if (!hasPermission(session, 'deliveryOrders', 'view')) {
            return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
        }

        try {
            const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
            const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
            const searchFields = searchFieldsParam
                ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                : [];
            const projectedPermissions = {
                canViewCustomerDetails: hasPermission(session, 'customers', 'view'),
                canManageTripFee: hasPermission(session, 'deliveryOrders', 'update'),
                canEditShipperReference: hasPermission(session, 'deliveryOrders', 'update'),
                canEditDeliveryCargo: hasPermission(session, 'deliveryOrders', 'update'),
                canEditDeliveryTarget: hasPermission(session, 'deliveryOrders', 'update'),
            };
            const result = await getProjectedDocumentRead({
                entity: entity as 'trips' | 'surat-jalan' | 'surat-jalan-items' | 'trip-tracking' | 'trip-detail' | 'surat-jalan-detail' | 'trip-detail-references',
                id,
                filter,
                searchQuery,
                searchFields,
                sortField,
                sortDir,
                page,
                pageSize,
                countOnly,
                permissions: projectedPermissions,
            });
            if (id) {
                if (!result.data) {
                    return jsonNoStore({ error: 'Not found' }, { status: 404 });
                }
                return jsonNoStore({ data: result.data });
            }
            return jsonNoStore({
                data: result.data,
                meta: result.meta,
            });
        } catch (error) {
            console.error('API GET Projected Read Error:', error);
            return jsonNoStore({ error: 'Server error' }, { status: 500 });
        }
    }

    if (!validateEntity(entity)) {
        return jsonNoStore({ error: 'Invalid entity type' }, { status: 400 });
    }

    // Module-based read gate for ALL entities including users and company.
    // Privacy filtering (e.g. sanitizeCompanyProfileForRole) is applied later.
    if (entity !== 'users') {
        const forbiddenModuleRead = forbidModuleAccess(session, entity, 'view');
        if (forbiddenModuleRead) {
            return forbiddenModuleRead;
        }
    }

    if (entity === 'users' && id !== session._id) {
        const forbiddenModuleRead = forbidModuleAccess(session, entity, 'view');
        if (forbiddenModuleRead) {
            return forbiddenModuleRead;
        }
    }

    const docType = DOCUMENT_TYPE_MAP[entity];

    try {
        if (entity === 'company') {
            const profile = await getCompanyProfile<CompanyProfile>();
            return jsonNoStore({
                data: profile
                    ? sanitizeCompanyProfileForRole(profile, session.role)
                    : null,
            });
        }

        if (entity === 'bank-accounts') {
            await ensureCashAccount();
        }

        if (id) {
            if (entity === 'delivery-orders') {
                clearRelationalReadCache();
            }
            let item =
                entity === 'freight-notas'
                    ? await getFreightNotaById(id)
                    : entity === 'customer-receipts'
                        ? await getCustomerReceiptById(id)
                    : entity === 'driver-borongans'
                        ? await getDriverBoronganById(id)
                    : entity === 'driver-vouchers'
                        ? await getDriverVoucherById(id)
                    : await getDocumentById(id, docType);
            if (!item) return jsonNoStore({ error: 'Not found' }, { status: 404 });
            if ((item as { _type?: string })._type !== docType) {
                return jsonNoStore({ error: 'Not found' }, { status: 404 });
            }

            if (entity === 'expenses') {
                const visibleExpense = filterExpensesByRole([item as unknown as Expense], session.role)[0];
                if (!visibleExpense) {
                    return jsonNoStore({ error: 'Not found' }, { status: 404 });
                }
                item = visibleExpense as unknown as Record<string, unknown>;
            }

            if (entity === 'journal-entries') {
                item = (await sanitizeJournalEntriesForRole([item as unknown as JournalEntry], session.role))[0] as unknown as Record<string, unknown>;
            }

            if (entity === 'journal-lines') {
                item = (await sanitizeJournalLinesForRole([item as unknown as JournalLine], session.role))[0] as unknown as Record<string, unknown>;
            }

            if (entity === 'users') {
                item = sanitizeUserForClient(item as unknown as User) as unknown as Record<string, unknown>;
            }

            if (entity === 'customer-receipts') {
                item = (await deriveCustomerReceiptsForResponse([item as ReceiptResponseShape]))[0] as Record<string, unknown>;
            }

            if (entity === 'bank-accounts') {
                const txRows = await listDocumentsByFilter<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>('bankTransaction', {
                    bankAccountRef: id,
                });
                item = applyDerivedBankAccountBalances([item as unknown as BankAccount], txRows)[0] as unknown as Record<string, unknown>;
            }

            if (entity === 'delivery-orders') {
                item = (await deriveDeliveryOrdersForResponse([item as unknown as DeliveryOrder]))[0] as unknown as Record<string, unknown>;
            }

            if (entity === 'orders') {
                item = (await deriveOrdersForResponse([item as unknown as Order]))[0] as unknown as Record<string, unknown>;
            }

            if (entity === 'freight-nota-items') {
                item = (await deriveFreightNotaItemsForResponse([item as unknown as FreightNotaItem]))[0] as unknown as Record<string, unknown>;
            }

            if (entity === 'vehicles' && session.role !== 'OWNER') {
                item = sanitizeVehicleForRole(item as unknown as Vehicle, session.role) as unknown as Record<string, unknown>;
            }
            return jsonNoStore({ data: item });
        }

        let items: Record<string, unknown>[] = [];
        let totalItems = 0;
        let filterObj: Record<string, unknown> | undefined;
        let orFilters: Array<{ fields: string[]; value: string | number | boolean }> | undefined;
        let definedFields: string[] | undefined;

        if (filter) {
            try {
                filterObj = JSON.parse(filter) as Record<string, unknown>;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Filter query tidak valid' },
                    { status: 400 }
                );
            }
        }

        if (entity === 'expenses') {
            filterObj = enforceExpensePrivacyFilter(session, filterObj);
        }

        if (orFiltersParam) {
            try {
                const parsed = JSON.parse(orFiltersParam) as unknown;
                if (!Array.isArray(parsed)) {
                    throw new Error('Or filter query tidak valid');
                }
                orFilters = parsed
                    .filter((item): item is { fields: string[]; value: string | number | boolean } => (
                        typeof item === 'object' &&
                        item !== null &&
                        Array.isArray((item as { fields?: unknown }).fields) &&
                        ((item as { value?: unknown }).value !== undefined)
                    ))
                    .map(item => ({
                        fields: item.fields,
                        value: item.value,
                    }));
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Or filter query tidak valid' },
                    { status: 400 }
                );
            }
        }

        if (definedFieldsParam) {
            definedFields = definedFieldsParam
                .split(',')
                .map(field => field.trim())
                .filter(Boolean);
        }

        const needsPaginatedList =
            countOnly ||
            pageParam !== null ||
            pageSizeParam !== null ||
            Boolean(searchQuery) ||
            Boolean(searchFieldsParam) ||
            Boolean(sortField) ||
            Boolean(sortDir);

        if (entity === 'expenses') {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await getExpenseList(session, {
                    filterObj,
                    search: searchQuery || undefined,
                    searchFields,
                    page: needsPaginatedList && !countOnly ? page : undefined,
                    pageSize: needsPaginatedList && !countOnly ? pageSize : undefined,
                    sortField,
                    sortDir,
                    dateFrom: searchParams.get('dateFrom'),
                    dateTo: searchParams.get('dateTo'),
                    countOnly,
                });
                items = result.items as unknown as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Query pengeluaran tidak valid' },
                    { status: 400 }
                );
            }
        } else if (entity === 'audit-logs') {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await getAuditLogList({
                    search: searchQuery || undefined,
                    searchFields,
                    page: needsPaginatedList && !countOnly ? page : undefined,
                    pageSize: needsPaginatedList && !countOnly ? pageSize : undefined,
                    sortField,
                    sortDir,
                    period: periodParam,
                    entityRef: auditEntityRef,
                    entityRefs: auditEntityRefs,
                    entityType: auditEntityType,
                    entityTypes: auditEntityTypes,
                    countOnly,
                });
                items = result.items as unknown as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Query audit log tidak valid' },
                    { status: 400 }
                );
            }
        } else if (entity === 'freight-notas') {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await getFreightNotaList({
                    filterObj,
                    orFilters,
                    definedFields,
                    search: searchQuery || undefined,
                    searchFields,
                    page: needsPaginatedList && !countOnly ? page : undefined,
                    pageSize: needsPaginatedList && !countOnly ? pageSize : undefined,
                    sortField,
                    sortDir,
                    sortPreset,
                    countOnly,
                });
                items = result.items as unknown as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Query invoice tidak valid' },
                    { status: 400 }
                );
            }
        } else if (entity === 'customer-receipts') {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await getCustomerReceiptList({
                    filterObj,
                    orFilters,
                    definedFields,
                    search: searchQuery || undefined,
                    searchFields,
                    page: needsPaginatedList && !countOnly ? page : undefined,
                    pageSize: needsPaginatedList && !countOnly ? pageSize : undefined,
                    sortField,
                    sortDir,
                    countOnly,
                });
                items = await deriveCustomerReceiptsForResponse(result.items as unknown as ReceiptResponseShape[]) as unknown as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Query penerimaan customer tidak valid' },
                    { status: 400 }
                );
            }
        } else if (entity === 'driver-borongans') {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await getDriverBoronganList({
                    filterObj,
                    orFilters,
                    definedFields,
                    search: searchQuery || undefined,
                    searchFields,
                    page: needsPaginatedList && !countOnly ? page : undefined,
                    pageSize: needsPaginatedList && !countOnly ? pageSize : undefined,
                    sortField,
                    sortDir,
                    countOnly,
                });
                items = result.items as unknown as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Query borongan tidak valid' },
                    { status: 400 }
                );
            }
        } else if (entity === 'driver-vouchers') {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await getDriverVoucherList({
                    filterObj,
                    orFilters,
                    definedFields,
                    search: searchQuery || undefined,
                    searchFields,
                    page: needsPaginatedList && !countOnly ? page : undefined,
                    pageSize: needsPaginatedList && !countOnly ? pageSize : undefined,
                    sortField,
                    sortDir,
                    sortPreset,
                    countOnly,
                });
                items = result.items as unknown as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Query bon trip tidak valid' },
                    { status: 400 }
                );
            }
        } else if (needsPaginatedList) {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await listDocuments(docType, {
                    filterObj,
                    orFilters,
                    definedFields,
                    search: searchQuery || undefined,
                    searchFields,
                    page,
                    pageSize,
                    sortField,
                    sortDir,
                    sortPreset,
                    countStrategy: countOnly ? 'exact' : 'estimated',
                });
                items = result.items as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return jsonNoStore(
                    { error: error instanceof Error ? error.message : 'Pagination query tidak valid' },
                    { status: 400 }
                );
            }
        } else if (filterObj) {
            items = await listDocumentsByFilter(docType, filterObj);
            totalItems = items.length;
        } else {
            items = await getAllDocuments(docType);
            totalItems = items.length;
        }

        if (entity === 'users') {
            items = items.map(item => sanitizeUserForClient(item as unknown as User) as unknown as Record<string, unknown>);
        }

        if (entity === 'freight-notas' && items.length > 0) {
            const ids = items
                .map(item => (typeof item._id === 'string' ? item._id : ''))
                .filter(Boolean);
            const [paymentRows, refundRows] = await Promise.all([
                listDocumentsByFilter<{ invoiceRef?: string; amount?: unknown }>('payment', {
                    invoiceRef: ids,
                }),
                listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceInvoiceRef' | 'amount'>>('customerOverpaymentRefund', {
                    sourceType: 'INVOICE_OVERPAID',
                    sourceInvoiceRef: ids,
                }),
            ]);
            const paymentTotalsByInvoice = paymentRows.reduce<Record<string, number>>((acc, payment) => {
                if (!payment.invoiceRef) return acc;
                acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + parseWholeMoneyLike(payment.amount);
                return acc;
            }, {});
            const { invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
            items = applyDerivedFreightNotaStatus(
                items as unknown as FreightNota[],
                paymentTotalsByInvoice,
                invoiceRefundsByRef
            ) as unknown as Record<string, unknown>[];
        }

        if (entity === 'customer-receipts' && items.length > 0) {
            items = await deriveCustomerReceiptsForResponse(items as ReceiptResponseShape[]) as unknown as Record<string, unknown>[];
        }

        if (entity === 'bank-accounts' && items.length > 0) {
            const ids = items
                .map(item => (typeof item._id === 'string' ? item._id : ''))
                .filter(Boolean);
            const txRows = await listDocumentsByFilter<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>('bankTransaction', {
                bankAccountRef: ids,
            });
            items = applyDerivedBankAccountBalances(items as unknown as BankAccount[], txRows) as unknown as Record<string, unknown>[];
        }

        if (entity === 'driver-voucher-disbursements' && items.length > 0) {
            items = items.filter(item => item.status !== 'VOID');
        }

        if (entity === 'freight-nota-items' && items.length > 0) {
            items = items.filter(item => item.status !== 'VOID');
            totalItems = items.length;
        }

        if (entity === 'driver-borongans' && items.length > 0) {
            const ids = items
                .map(item => (typeof item._id === 'string' ? item._id : ''))
                .filter(Boolean);
            const boronganItems = await listDocumentsByFilter<{
                boronganRef?: string;
                collie?: unknown;
                beratKg?: unknown;
                uangRp?: unknown;
            }>('driverBoronganItem', { boronganRef: ids });
            items = applyDerivedDriverBoronganTotals(
                items as unknown as DriverBorongan[],
                boronganItems.filter(
                    (item): item is { boronganRef: string; collie?: unknown; beratKg?: unknown; uangRp?: unknown } =>
                        typeof item.boronganRef === 'string' && item.boronganRef.length > 0
                ) as Array<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>
            ) as unknown as Record<string, unknown>[];
        }

        if (entity === 'driver-vouchers' && !needsPaginatedList && items.length > 0) {
            const ids = items
                .map(item => (typeof item._id === 'string' ? item._id : ''))
                .filter(Boolean);
            const [disbursementRows, itemRows] = await Promise.all([
                listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>('driverVoucherDisbursement', {
                    voucherRef: ids,
                }),
                listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', {
                    voucherRef: ids,
                }),
            ]);
            items = applyDerivedDriverVoucherLedger(items as unknown as DriverVoucher[], disbursementRows, itemRows) as unknown as Record<string, unknown>[];
        }

        if (entity === 'delivery-orders' && items.length > 0) {
            items = await deriveDeliveryOrdersForResponse(items as unknown as DeliveryOrder[]) as unknown as Record<string, unknown>[];
        }

        if (entity === 'orders' && items.length > 0) {
            items = await deriveOrdersForResponse(items as unknown as Order[]) as unknown as Record<string, unknown>[];
        }

        if (entity === 'freight-nota-items' && items.length > 0) {
            items = await deriveFreightNotaItemsForResponse(items as unknown as FreightNotaItem[]) as unknown as Record<string, unknown>[];
        }

        if (entity === 'expenses') {
            items = filterExpensesByRole(items as unknown as Expense[], session.role) as unknown as Record<string, unknown>[];
        }

        if (entity === 'journal-entries') {
            items = await sanitizeJournalEntriesForRole(items as unknown as JournalEntry[], session.role) as unknown as Record<string, unknown>[];
        }

        if (entity === 'journal-lines') {
            items = await sanitizeJournalLinesForRole(items as unknown as JournalLine[], session.role) as unknown as Record<string, unknown>[];
        }

        if (entity === 'vehicles' && session.role !== 'OWNER') {
            items = (items as unknown as Vehicle[]).map(item => sanitizeVehicleForRole(item, session.role)) as unknown as Record<string, unknown>[];
        }

        if (entity === 'audit-logs') {
            items = items.map(item => {
                const actorUserEmail =
                    (typeof item.actorUserEmail === 'string' && item.actorUserEmail.trim())
                    || inferAuditActorEmailFromRef(item.actorUserRef, item.entityRef);
                const actorUserRole =
                    normalizeAuditActorRole(item.actorUserRole)
                    || inferAuditActorRoleFromIdentity(item.actorUserRef, actorUserEmail, item.entityRef);
                return {
                    ...item,
                    actorUserEmail,
                    actorUserRole,
                };
            });
        }

        if (countOnly) {
            return jsonNoStore({
                data: [],
                meta: {
                    page: pageParam ? Number.parseInt(pageParam, 10) || 1 : 1,
                    pageSize: pageSizeParam ? Number.parseInt(pageSizeParam, 10) || 10 : 10,
                    total: totalItems,
                },
            });
        }

        if (needsPaginatedList) {
            return jsonNoStore({
                data: items,
                meta: {
                    page: pageParam ? Number.parseInt(pageParam, 10) || 1 : 1,
                    pageSize: pageSizeParam ? Number.parseInt(pageSizeParam, 10) || 10 : 10,
                    total: totalItems,
                },
            });
        }

        return jsonNoStore({ data: items });
    } catch (err) {
        const serviceError = getDataServiceErrorInfo(err);
        if (serviceError) {
            console.error('API GET Service Error:', err);
            return jsonNoStore({ error: serviceError.message }, { status: serviceError.status });
        }
        console.error('API GET Error:', err);
        return jsonNoStore({ error: 'Server error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    const session = await getSession();
    if (!session) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'DRIVER') {
        return jsonNoStore({ error: 'Driver tidak diizinkan mengakses API admin' }, { status: 403 });
    }

    try {
        const parsedBody = await parseJsonBody<{
            entity?: unknown;
            action?: unknown;
            data?: unknown;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const body = parsedBody.data;
        const rawData = isPlainObject(body.data) ? body.data as Record<string, unknown> : {};
        const entity = typeof body.entity === 'string' ? body.entity : null;
        const action =
            typeof body.action === 'string'
                ? body.action
                : typeof rawData.action === 'string'
                    ? rawData.action
                    : undefined;
        const data = rawData;

        if (!validateEntity(entity)) {
            return jsonNoStore({ error: 'Invalid entity type' }, { status: 400 });
        }

        if (entity === 'users') {
            if (action === 'delete') {
                return jsonNoStore({ error: 'User tidak boleh dihapus permanen' }, { status: 409 });
            }

            // Self-update always allowed for name/password changes.
            // Other user management actions require userManagement module permission.
            const targetId = typeof data.id === 'string' ? data.id : undefined;
            if (action !== 'update' || targetId !== session._id) {
                const mutationAction = getMutationPermissionAction(action);
                const forbidden = forbidModuleAccess(session, entity, mutationAction);
                if (forbidden) return forbidden;
            }
        } else {
            const specialMutationPermission = hasSpecialMutationPermission(session, entity, action);
            if (specialMutationPermission === false) {
                return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
            }
            if (specialMutationPermission === null) {
                const forbiddenModuleMutation = forbidModuleAccess(session, entity, getMutationPermissionAction(action));
                if (forbiddenModuleMutation) {
                    return forbiddenModuleMutation;
            }
        }
    }

        if (LEGACY_READ_ONLY_ENTITIES.has(entity)) {
            return jsonNoStore(
            { error: 'Arsip invoice lama sudah dibekukan. Gunakan Invoice Ongkos untuk workflow invoice aktif.' },
                { status: 409 }
            );
        }

        const docType = DOCUMENT_TYPE_MAP[entity];
        const isCreateAction = !action || action === 'create';
        await assertMutationAccountingPeriodOpen(entity, docType, action, data);

        if (entity === 'driver-borongans' && action === 'mark-paid') {
            return await handleBoronganPayment(session, data, addAuditLog);
        }

        if (entity === 'accounting-periods' && action === 'close-period') {
            return await handleAccountingPeriodClose(session, data, addAuditLog);
        }

        if (entity === 'accounting-periods' && action === 'open-period') {
            return await handleAccountingPeriodOpen(session, data, addAuditLog);
        }

        if (entity === 'journal-entries' && action === 'create-manual') {
            return await handleManualJournalCreate(session, data, addAuditLog);
        }

        if (entity === 'journal-entries' && action === 'void-manual') {
            return await handleManualJournalVoid(session, data, addAuditLog);
        }

        if (entity === 'incidents' && action === 'set-status') {
            return await handleIncidentStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'incidents' && action === 'record-maintenance-handling') {
            return await handleIncidentMaintenanceHandlingCreate(session, data, addAuditLog);
        }

        if (entity === 'incident-settlement-lines' && action === 'update') {
            return await handleIncidentSettlementLineUpdate(session, data, addAuditLog);
        }

        if (entity === 'incident-settlement-lines' && action === 'delete') {
            return await handleIncidentSettlementLineDelete(session, data, addAuditLog);
        }

        if (entity === 'incident-settlement-lines' && action === 'set-status') {
            return await handleIncidentSettlementLineStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'incident-settlement-lines' && action === 'create-tire-follow-up') {
            return await handleIncidentSettlementLineTireFollowUpCreate(session, data, addAuditLog);
        }

        if (entity === 'incident-settlement-lines' && action === 'create-maintenance-follow-up') {
            return await handleIncidentSettlementLineMaintenanceFollowUpCreate(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'create-with-items') {
            return await handleOrderCreate(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'update-with-items') {
            return await handleOrderUpdateWithItems(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'update-header-booking') {
            return await handleOrderHeaderBookingUpdate(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'append-trip-plan') {
            return await handleOrderTripPlanAppend(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'update-trip-plan') {
            return await handleOrderTripPlanUpdate(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'delete-trip-plan') {
            return await handleOrderTripPlanDeleteLocal(session, data);
        }

        if (entity === 'orders' && action === 'cancel-trip-plan') {
            return await handleOrderTripPlanCancel(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'cancel-order') {
            return await handleOrderCancel(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'revise-targets') {
            return await handleOrderTargetRevision(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'delete') {
            return await handleOrderDelete(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'create-with-items') {
            return await handleDeliveryOrderCreate(session, data, addAuditLog);
        }

        if (entity === 'purchases' && (action === 'create-with-items' || !action)) {
            return await handlePurchaseCreate(session, data, addAuditLog);
        }

        if (entity === 'purchases' && action === 'receive') {
            return await handlePurchaseReceive(session, data, addAuditLog);
        }

        if (entity === 'order-items' && action === 'set-hold-quantity') {
            return await handleOrderItemHoldSet(session, data, addAuditLog);
        }

        if (entity === 'order-items' && action === 'release-hold') {
            return await handleOrderItemHoldRelease(session, data, addAuditLog);
        }

        if (entity === 'freight-notas' && action === 'create-with-items') {
            return await handleFreightNotaCreate(session, data, addAuditLog);
        }

        if (entity === 'freight-notas' && action === 'delete') {
            return await handleFreightNotaDelete(session, data, addAuditLog);
        }

        if (entity === 'freight-notas' && action === 'update-pph23') {
            return await handleFreightNotaPph23Update(session, data, addAuditLog);
        }

        if (entity === 'freight-notas' && action === 'update-tax-invoice') {
            return await handleFreightNotaTaxInvoiceUpdate(session, data, addAuditLog);
        }

        if (entity === 'freight-notas' && action === 'update-with-items') {
            return await handleFreightNotaUpdate(session, data, addAuditLog);
        }

        if (entity === 'invoices' && action === 'create-with-items') {
            return await handleInvoiceCreate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'set-status') {
            return await handleDeliveryOrderStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'set-surat-jalan-status-batch') {
            return await handleDeliveryOrderBatchSuratJalanStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'cancel-trip') {
            return await handleDeliveryOrderCancelTrip(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'assign-trip-resources') {
            return await handleDeliveryOrderTripResourceAssign(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'append-cargo-items') {
            return await handleDeliveryOrderAppendCargoItems(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'update-cargo-item') {
            return await handleDeliveryOrderCargoItemUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'update-surat-jalan-actual-cargo') {
            return await handleDeliveryOrderSuratJalanActualCargoUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'update-manual-overtonase') {
            return await handleDeliveryOrderManualOvertonaseUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'remove-cargo-item') {
            return await handleDeliveryOrderCargoItemRemove(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'update-shipper-reference') {
            return await handleDeliveryOrderShipperReferenceUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'set-trip-closure') {
            return await handleDeliveryOrderTripClosureSet(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'continue-held-cargo') {
            return await handleDeliveryOrderContinueHeldCargo(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'reject-driver-status-request') {
            return await handleDeliveryOrderDriverStatusRequestReject(session, data, addAuditLog);
        }

        if (entity === 'maintenances' && action === 'complete-with-materials') {
            return await handleMaintenanceComplete(session, data, addAuditLog);
        }

        if (entity === 'maintenances' && action === 'record-tire-technician-cost') {
            return await handleTireTechnicianCostCreate(session, data, addAuditLog);
        }

        if (entity === 'supplier-item-prices' && action === 'revise-price') {
            return await handleSupplierItemPriceRevise(session, data, addAuditLog);
        }

        if (entity === 'tire-events' && action === 'install-to-slot') {
            return await handleTireInstallToSlot(session, data, addAuditLog);
        }

        if (entity === 'driver-borongans' && action === 'create-with-items') {
            return jsonNoStore(
                { error: 'Slip borongan baru sudah dinonaktifkan. Gunakan Uang Jalan Trip per DO/trip untuk settlement aktif.' },
                { status: 409 }
            );
        }

        if (entity === 'driver-vouchers' && action === 'settle') {
            return await handleDriverVoucherSettlement(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers' && action === 'top-up') {
            return await handleDriverVoucherTopUp(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers' && action === 'repair-issue-ledger') {
            return await handleDriverVoucherIssueRepair(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-disbursements' && action === 'update') {
            return await handleDriverVoucherDisbursementUpdate(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-disbursements' && action === 'delete') {
            return await handleDriverVoucherDisbursementDelete(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-items' && action === 'update') {
            return await handleDriverVoucherItemUpdate(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-items' && action === 'delete') {
            return await handleDriverVoucherItemDelete(session, data, addAuditLog);
        }

        if (entity === 'bank-transactions' && action === 'transfer') {
            return await handleBankTransfer(session, data, addAuditLog);
        }

        if (entity === 'payments' && action === 'update') {
            return await handlePaymentUpdate(session, data, addAuditLog);
        }

        if (entity === 'payments' && isCreateAction) {
            return await handlePaymentCreate(session, data, addAuditLog);
        }

        if (entity === 'customer-receipts' && isCreateAction) {
            return await handleCustomerReceiptCreate(session, data, addAuditLog);
        }

        if (entity === 'customer-overpayment-refunds' && isCreateAction) {
            return await handleCustomerOverpaymentRefund(session, data, addAuditLog);
        }

        if (entity === 'purchase-payments' && (action === 'record-payment' || !action)) {
            return await handlePurchasePaymentCreate(session, data, addAuditLog);
        }

        if (entity === 'stock-movements' && isCreateAction) {
            return await handleStockMovementCreate(session, data, addAuditLog);
        }

        if (entity === 'invoice-adjustments' && action === 'update') {
            return await handleInvoiceAdjustmentUpdate(session, data, addAuditLog);
        }

        if (entity === 'invoice-adjustments' && action === 'delete') {
            return await handleInvoiceAdjustmentDelete(session, data, addAuditLog);
        }

        if (entity === 'invoice-adjustments' && action === 'void') {
            return await handleInvoiceAdjustmentVoid(session, data, addAuditLog);
        }

        if (entity === 'invoice-adjustments') {
            return await handleInvoiceAdjustmentCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-scores' && action === 'end-early') {
            return await handleDriverScoreEndEarly(session, data, addAuditLog);
        }

        if (action === 'update') {
            return await handleGenericUpdate(session, entity, data, addAuditLog);
        }

        if (action === 'delete') {
            return await handleGenericDelete(session, entity, data, addAuditLog);
        }

        if (action && action !== 'create') {
            return jsonNoStore({ error: 'Aksi tidak dikenal atau tidak didukung untuk entity ini' }, { status: 400 });
        }

        if (entity === 'expenses') {
            return await handleExpenseCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers') {
            return await handleDriverVoucherCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-items') {
            return await handleDriverVoucherItemCreate(session, data, addAuditLog);
        }

        if (entity === 'incidents') {
            return await handleIncidentCreate(session, data, addAuditLog);
        }

        if (entity === 'incident-settlement-lines') {
            return await handleIncidentSettlementLineCreate(session, data, addAuditLog);
        }

        return await handleGenericCreate(session, entity, docType, data, addAuditLog);
    } catch (err) {
        const serviceError = getDataServiceErrorInfo(err);
        if (serviceError) {
            console.error('API POST Service Error:', err);
            return jsonNoStore({ error: serviceError.message }, { status: serviceError.status });
        }
        const message = err instanceof Error ? err.message : 'Server error';
        const status =
            message === 'Forbidden'
                ? 403
                : isMutationConflictError(err)
                    ? 409
                    : 400;
        console.error('API POST Error:', err);
        return jsonNoStore({ error: message }, { status });
    }
}

