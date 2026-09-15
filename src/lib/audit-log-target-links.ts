import type { AuditLog } from './types';

type AuditLogTargetInput = Pick<AuditLog, 'action' | 'entityType' | 'entityRef'>;

function cleanValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEntityType(value: unknown) {
    return cleanValue(value)
        .replace(/_/g, '-')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
}

function pathWithEncodedTarget(basePath: string, entityRef: string) {
    return `${basePath}/${encodeURIComponent(entityRef)}`;
}

function modulePath(path: string) {
    return path;
}

export function getAuditLogTargetHref(log: AuditLogTargetInput) {
    const entityRef = cleanValue(log.entityRef);
    const entityType = normalizeEntityType(log.entityType);

    if (!entityRef || log.action === 'DELETE') {
        return null;
    }

    switch (entityType) {
        case 'admin-web-auth':
        case 'driver-web-auth':
        case 'driver-mobile-auth':
            return modulePath('/settings/users');
        case 'driver-mobile-access':
            return modulePath('/fleet/drivers');
        case 'employees':
        case 'employee':
            return modulePath('/employees');
        case 'employee-attendance-records':
        case 'employee-attendance-record':
        case 'attendance':
            return modulePath('/attendance');
        case 'orders':
        case 'order':
            return pathWithEncodedTarget('/orders', entityRef);
        case 'order-items':
        case 'order-item':
            return modulePath('/orders');
        case 'delivery-orders':
        case 'delivery-order':
            return pathWithEncodedTarget('/delivery-orders', entityRef);
        case 'delivery-order-items':
        case 'delivery-order-item':
        case 'tracking-logs':
        case 'tracking-log':
            return modulePath('/delivery-orders');
        case 'trip-records':
        case 'trip-record':
        case 'trips':
        case 'trip':
            return pathWithEncodedTarget('/trips', entityRef);
        case 'surat-jalan-records':
        case 'surat-jalan-record':
        case 'surat-jalan':
            return pathWithEncodedTarget('/surat-jalan', entityRef);
        case 'surat-jalan-record-items':
        case 'surat-jalan-record-item':
        case 'surat-jalan-items':
        case 'surat-jalan-item':
            return modulePath('/surat-jalan');
        case 'driver-vouchers':
        case 'driver-voucher':
            return pathWithEncodedTarget('/driver-vouchers', entityRef);
        case 'driver-voucher-disbursements':
        case 'driver-voucher-disbursement':
        case 'driver-voucher-items':
        case 'driver-voucher-item':
            return modulePath('/driver-vouchers');
        case 'freight-notas':
        case 'freight-nota':
        case 'invoices':
        case 'invoice':
            return pathWithEncodedTarget('/invoices', entityRef);
        case 'freight-nota-items':
        case 'freight-nota-item':
        case 'invoice-items':
        case 'invoice-item':
        case 'payments':
        case 'payment':
        case 'customer-receipts':
        case 'customer-receipt':
        case 'customer-overpayment-refunds':
        case 'customer-overpayment-refund':
        case 'invoice-adjustments':
        case 'invoice-adjustment':
            return modulePath('/invoices');
        case 'customers':
        case 'customer':
            return pathWithEncodedTarget('/customers', entityRef);
        case 'customer-products':
        case 'customer-product':
        case 'customer-billing-rates':
        case 'customer-billing-rate':
        case 'customer-recipients':
        case 'customer-recipient':
        case 'customer-pickups':
        case 'customer-pickup':
            return modulePath('/customers');
        case 'suppliers':
        case 'supplier':
            return pathWithEncodedTarget('/suppliers', entityRef);
        case 'purchases':
        case 'purchase':
            return pathWithEncodedTarget('/inventory/purchases', entityRef);
        case 'purchase-items':
        case 'purchase-item':
        case 'purchase-payments':
        case 'purchase-payment':
            return modulePath('/inventory/purchases');
        case 'warehouse-items':
        case 'warehouse-item':
            return pathWithEncodedTarget('/inventory/items', entityRef);
        case 'stock-movements':
        case 'stock-movement':
            return modulePath('/inventory/stock-recap');
        case 'vehicles':
        case 'vehicle':
            return pathWithEncodedTarget('/fleet/vehicles', entityRef);
        case 'drivers':
        case 'driver':
            return pathWithEncodedTarget('/fleet/drivers', entityRef);
        case 'incidents':
        case 'incident':
            return pathWithEncodedTarget('/fleet/incidents', entityRef);
        case 'incident-action-logs':
        case 'incident-action-log':
        case 'incident-settlement-lines':
        case 'incident-settlement-line':
            return modulePath('/fleet/incidents');
        case 'maintenances':
        case 'maintenance':
            return pathWithEncodedTarget('/fleet/maintenance', entityRef);
        case 'tire-events':
        case 'tire-event':
        case 'tire-history-logs':
        case 'tire-history-log':
            return modulePath('/fleet/tires');
        case 'bank-accounts':
        case 'bank-account':
            return pathWithEncodedTarget('/bank-accounts', entityRef);
        case 'bank-transactions':
        case 'bank-transaction':
            return modulePath('/bank-accounts');
        case 'expenses':
        case 'expense':
            return pathWithEncodedTarget('/expenses', entityRef);
        case 'expense-categories':
        case 'expense-category':
            return modulePath('/expense-categories');
        case 'services':
        case 'service':
            return modulePath('/services');
        case 'trip-rates':
        case 'trip-rate':
        case 'trip-route-rates':
        case 'trip-route-rate':
            return modulePath('/trip-rates');
        case 'driver-borongans':
        case 'driver-borongan':
            return pathWithEncodedTarget('/borongan', entityRef);
        case 'driver-borongan-items':
        case 'driver-borongan-item':
        case 'driver-borogan-items':
        case 'driver-borogan-item':
            return modulePath('/borongan');
        case 'driver-scores':
        case 'driver-score':
            return modulePath('/fleet/drivers/skors');
        case 'journal-entries':
        case 'journal-entry':
            return modulePath('/accounting/journals');
        case 'journal-lines':
        case 'journal-line':
            return modulePath('/accounting/journals');
        case 'chart-of-accounts':
        case 'chart-of-account':
            return modulePath('/accounting/accounts');
        case 'accounting-periods':
        case 'accounting-period':
            return modulePath('/accounting/statements');
        case 'incomes':
        case 'income':
            return modulePath('/accounting/ledger');
        case 'company':
        case 'company-profile':
            return modulePath('/settings/company');
        case 'users':
        case 'user':
            return modulePath('/settings/users');
        case 'audit-logs':
        case 'audit-log':
            return modulePath('/settings/audit-logs');
        default:
            return null;
    }
}
