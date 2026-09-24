import { DOCUMENT_TYPE_MAP } from '@/lib/document-types';

type LabelPlan = { fields: string[]; sep?: string };

const LABEL_PLAN_BY_DOC_TYPE: Record<string, LabelPlan> = {
    user: { fields: ['name', 'email'] },
    employee: { fields: ['name', 'employeeCode'] },
    employeeAttendanceRecord: { fields: ['employeeName', 'date'] },
    companyProfile: { fields: ['name'] },
    supplier: { fields: ['name', 'supplierCode'] },
    supplierItemPrice: { fields: ['supplierName', 'itemCode', 'itemName'] },
    warehouseItem: { fields: ['itemCode', 'name'] },
    purchase: { fields: ['purchaseNumber'] },
    purchaseItem: { fields: ['itemCode', 'itemName'] },
    purchasePayment: { fields: ['purchaseNumber', 'supplierName', 'bankAccountName'] },
    stockMovement: { fields: ['itemCode', 'itemName'] },
    chartOfAccount: { fields: ['code', 'name'] },
    journalEntry: { fields: ['entryNumber', 'memo'] },
    journalLine: { fields: ['accountCode', 'accountName'] },
    accountingPeriod: { fields: ['period'] },
    customer: { fields: ['name'] },
    customerProduct: { fields: ['name', 'code'] },
    customerRecipient: { fields: ['label', 'receiverName'] },
    customerPickupLocation: { fields: ['label', 'pickupAddress'] },
    tripRouteRate: { fields: ['originArea', 'destinationArea'], sep: ' -> ' },
    service: { fields: ['name', 'code'] },
    expenseCategory: { fields: ['name'] },
    driver: { fields: ['name'] },
    order: { fields: ['masterResi', 'customerName'] },
    orderItem: { fields: ['customerProductName', 'customerProductCode', 'description'] },
    deliveryOrder: { fields: ['doNumber', 'masterResi', 'customerName'] },
    deliveryOrderItem: { fields: ['orderItemDescription', 'sourceDeliveryOrderNumber'] },
    trip: { fields: ['tripNumber', 'masterResi', 'driverName'] },
    suratJalan: { fields: ['suratJalanNumber', 'tripNumber', 'masterResi'] },
    suratJalanItem: { fields: ['suratJalanNumber', 'orderItemDescription'] },
    trackingLog: { fields: ['note', 'status', 'locationText'] },
    invoice: { fields: ['invoiceNumber', 'customerName'] },
    invoiceItem: { fields: ['description'] },
    payment: { fields: ['receiptNumber', 'invoiceNumber', 'bankAccountName', 'note'] },
    customerReceipt: { fields: ['receiptNumber', 'customerName'] },
    customerOverpaymentRefund: { fields: ['sourceReceiptNumber', 'sourceInvoiceNumber', 'note'] },
    invoiceAdjustment: { fields: ['customerName', 'kind', 'note'] },
    income: { fields: ['note', 'sourceType'] },
    expense: { fields: ['description', 'categoryName', 'note'] },
    vehicle: { fields: ['plateNumber'] },
    maintenance: { fields: ['vehiclePlate', 'type', 'relatedIncidentNumber'] },
    tireEvent: { fields: ['tireCode', 'posisi', 'vehiclePlate'] },
    tireHistoryLog: { fields: ['tireCode', 'actionType', 'note'] },
    incident: { fields: ['incidentNumber', 'description', 'vehiclePlate'] },
    incidentActionLog: { fields: ['note'] },
    incidentSettlementLine: { fields: ['incidentNumber', 'description', 'category'] },
    bankAccount: { fields: ['bankName', 'accountNumber'] },
    bankTransaction: { fields: ['bankAccountName', 'description'] },
    driverVoucher: { fields: ['bonNumber', 'doNumber', 'driverName'] },
    driverVoucherDisbursement: { fields: ['bankAccountName', 'note'] },
    driverVoucherItem: { fields: ['doNumber', 'description', 'category'] },
    freightNota: { fields: ['notaNumber', 'customerName'] },
    freightNotaItem: { fields: ['doNumber', 'noSJ', 'tujuan'] },
    driverBorongan: { fields: ['boronganNumber', 'driverName'] },
    driverBoronganItem: { fields: ['doNumber', 'noSJ', 'tujuan'] },
    driverScore: { fields: ['driverName', 'scoreType'] },
};

const AUTH_ENTITY_TYPES = new Set([
    'auth',
    'admin-web-auth',
    'driver-web-auth',
    'driver-mobile-auth',
    'driver-mobile-access',
]);

function kebabCase(value: string) {
    return value
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .toLowerCase();
}

const REVERSE_DOC_TYPE_INDEX = (() => {
    const index = new Map<string, string>();
    for (const [key, docType] of Object.entries(DOCUMENT_TYPE_MAP)) {
        index.set(kebabCase(docType), docType);
        index.set(`${kebabCase(docType)}s`, docType);
        const singularKey = kebabCase(key).replace(/s$/, '');
        index.set(singularKey, docType);
    }
    return index;
})();

export function resolveAuditEntityDocType(entityType: string | null | undefined): string | null {
    if (!entityType) {
        return null;
    }
    const norm = kebabCase(entityType);
    if (AUTH_ENTITY_TYPES.has(norm)) {
        return 'user';
    }
    const direct = DOCUMENT_TYPE_MAP[norm];
    if (direct) {
        return direct;
    }
    if (REVERSE_DOC_TYPE_INDEX.has(norm)) {
        return REVERSE_DOC_TYPE_INDEX.get(norm) ?? null;
    }
    const plural = DOCUMENT_TYPE_MAP[`${norm}s`];
    if (plural) {
        return plural;
    }
    return null;
}

export function getAuditLabelFields(docType: string): string[] {
    const plan = LABEL_PLAN_BY_DOC_TYPE[docType];
    return plan ? plan.fields : [];
}

function fieldValue(doc: Record<string, unknown>, field: string): string {
    const value = doc[field];
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}

export function buildAuditEntityLabel(doc: Record<string, unknown> | undefined | null, docType: string): string {
    if (!doc) {
        return '';
    }
    const plan = LABEL_PLAN_BY_DOC_TYPE[docType];
    if (!plan || plan.fields.length === 0) {
        return '';
    }
    const parts = plan.fields.map(field => fieldValue(doc, field)).filter(Boolean);
    if (parts.length === 0) {
        return '';
    }
    return parts.join(plan.sep ?? ' - ');
}

const AUDIT_ENTITY_LABELS: Record<string, string> = {
    auth: 'Masuk / Keluar Aplikasi',
    'admin-web-auth': 'Masuk / Keluar Aplikasi',
    'driver-web-auth': 'Masuk / Keluar Aplikasi',
    'driver-mobile-auth': 'Masuk / Keluar Aplikasi',
    'driver-mobile-access': 'Masuk / Keluar Aplikasi',
    users: 'Pengguna',
    employees: 'Karyawan',
    'employee-attendance-records': 'Absensi Karyawan',
    'companyProfile': 'Profil Perusahaan',
    company: 'Profil Perusahaan',
    suppliers: 'Supplier',
    'supplier-item-prices': 'Harga Barang Supplier',
    'warehouse-items': 'Barang Gudang',
    purchases: 'Pembelian',
    'purchase-items': 'Item Pembelian',
    'purchase-payments': 'Pembayaran Pembelian',
    'stock-movements': 'Mutasi Stok',
    orders: 'Order / Resi',
    'order-items': 'Item Order / Resi',
    'delivery-orders': 'Surat Jalan',
    'delivery-order-items': 'Item Surat Jalan',
    trips: 'Trip',
    'surat-jalan-records': 'Surat Jalan',
    'tracking-logs': 'Log Tracking',
    invoices: 'Invoice',
    'invoice-items': 'Item Invoice',
    'invoice-adjustments': 'Penyesuaian Invoice',
    payments: 'Pembayaran',
    'customer-receipts': 'Kwitansi Customer',
    'customer-overpayment-refunds': 'Refund Kelebihan Bayar',
    incomes: 'Pemasukan Lainnya',
    expenses: 'Pengeluaran',
    'expense-categories': 'Kategori Biaya',
    'bank-accounts': 'Rekening & Kas',
    'bank-transactions': 'Transaksi Bank',
    'chart-of-accounts': 'Akun Perkiraan',
    'journal-entries': 'Jurnal',
    'journal-lines': 'Baris Jurnal',
    'accounting-periods': 'Periode Akuntansi',
    customers: 'Customer',
    'customer-products': 'Produk Customer',
    'customer-recipients': 'Penerima Customer',
    'customer-pickup-locations': 'Lokasi Pickup Customer',
    'trip-route-rates': 'Biaya Rute Trip',
    services: 'Jenis Armada',
    drivers: 'Supir',
    'driver-scores': 'Skor Supir',
    vehicles: 'Kenderaan',
    maintenances: 'Maintenance',
    incidents: 'Insiden',
    'incident-action-logs': 'Aksi Insiden',
    'incident-settlement-lines': 'Penyelesaian Insiden',
    'tire-events': 'Event Ban',
    'tire-history-logs': 'Riwayat Ban',
    'driver-vouchers': 'Uang Jalan Trip',
    'driver-voucher-items': 'Item Uang Jalan',
    'driver-voucher-disbursements': 'Pencairan Uang Jalan',
    'freight-notas': 'Nota Ongkir',
    'freight-nota-items': 'Item Nota Ongkir',
    'driver-borongans': 'Borongan Supir',
    'driver-borongan-items': 'Item Borongan Supir',
    'driver-borogan-items': 'Item Borongan Supir',
    'audit-logs': 'Audit Aktivitas',
    'data-imports': 'Import Data',
};

export function getAuditEntityLabel(entityType: string | null | undefined): string | null {
    if (!entityType) {
        return null;
    }
    const direct = AUDIT_ENTITY_LABELS[entityType];
    if (direct) {
        return direct;
    }
    const docType = resolveAuditEntityDocType(entityType);
    if (docType) {
        return AUDIT_ENTITY_LABELS[docType] ?? null;
    }
    return null;
}

export type AuditEntityFilterOption = { value: string; label: string };

export const AUDIT_ENTITY_FILTER_OPTIONS: AuditEntityFilterOption[] = (() => {
    const options = new Map<string, string>();
    const setLabel = (value: string, label: string | null) => {
        if (label && label !== value) {
            options.set(value, label);
        }
    };
    for (const [key, docType] of Object.entries(DOCUMENT_TYPE_MAP)) {
        setLabel(key, AUDIT_ENTITY_LABELS[key] ?? AUDIT_ENTITY_LABELS[docType] ?? null);
    }
    for (const [key, label] of Object.entries(AUDIT_ENTITY_LABELS)) {
        setLabel(key, label);
    }
    return Array.from(options.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'id'));
})();