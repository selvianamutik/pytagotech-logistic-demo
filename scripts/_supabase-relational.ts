type SeedDoc = {
    _id: string;
    _type: string;
    _createdAt?: string;
    _updatedAt?: string;
    [key: string]: unknown;
};

type SupabaseRequestFn = (path: string, init?: RequestInit) => Promise<Response>;

import { DEFAULT_CHART_OF_ACCOUNTS, buildDefaultChartOfAccountDocument } from '../src/lib/accounting';

const RELATIONAL_SEED_ORDER = [
    'company_profiles',
    'drivers',
    'customers',
    'services',
    'trip_route_rates',
    'vehicles',
    'app_users',
    'employees',
    'employee_attendance_records',
    'expense_categories',
    'bank_accounts',
    'bank_transactions',
    'chart_of_accounts',
    'accounting_periods',
    'journal_entries',
    'journal_lines',
    'suppliers',
    'warehouse_items',
    'supplier_item_prices',
    'purchases',
    'purchase_items',
    'purchase_payments',
    'stock_movements',
    'orders',
    'order_items',
    'delivery_orders',
    'delivery_order_items',
    'trips',
    'surat_jalan_documents',
    'surat_jalan_items',
    'tracking_logs',
    'tire_events',
    'tire_history_logs',
    'customer_products',
    'customer_billing_rates',
    'customer_recipients',
    'customer_pickup_locations',
    'driver_scores',
    'driver_vouchers',
    'driver_voucher_disbursements',
    'driver_voucher_items',
    'driver_borongans',
    'driver_borongan_items',
    'invoices',
    'invoice_items',
    'freight_notas',
    'freight_nota_items',
    'payments',
    'customer_receipts',
    'invoice_adjustments',
    'customer_overpayment_refunds',
    'incomes',
    'expenses',
    'maintenances',
    'incidents',
    'incident_settlement_lines',
    'incident_action_logs',
    'audit_logs',
] as const;

export const RELATIONAL_TABLES = [...RELATIONAL_SEED_ORDER];
export const RELATIONAL_RESET_TABLES = [...RELATIONAL_SEED_ORDER].reverse();
export const RELATIONAL_SUPPORTED_DOC_TYPES = [
    'companyProfile',
    'employee',
    'employeeAttendanceRecord',
    'expenseCategory',
    'driver',
    'driverVoucher',
    'driverVoucherDisbursement',
    'driverVoucherItem',
    'driverBorongan',
    'driverBoronganItem',
    'customer',
    'supplier',
    'warehouseItem',
    'supplierItemPrice',
    'tireEvent',
    'tireHistoryLog',
    'customerProduct',
    'customerBillingRate',
    'customerRecipient',
    'customerPickupLocation',
    'service',
    'tripRouteRate',
    'vehicle',
    'user',
    'bankAccount',
    'bankTransaction',
    'chartOfAccount',
    'accountingPeriod',
    'journalEntry',
    'journalLine',
    'expense',
    'purchase',
    'purchaseItem',
    'purchasePayment',
    'stockMovement',
    'order',
    'orderItem',
    'deliveryOrder',
    'deliveryOrderItem',
    'trip',
    'suratJalan',
    'suratJalanItem',
    'trackingLog',
    'driverScore',
    'invoice',
    'invoiceItem',
    'freightNota',
    'freightNotaItem',
    'payment',
    'customerReceipt',
    'invoiceAdjustment',
    'customerOverpaymentRefund',
    'income',
    'maintenance',
    'incident',
    'incidentSettlementLine',
    'incidentActionLog',
    'auditLog',
] as const;

export function isMissingSupabaseTableError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /Could not find the table/i.test(message) || /relation .* does not exist/i.test(message);
}

function toText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
}

function toTimestamp(value: unknown) {
    return typeof value === 'string' && value.trim() ? value : null;
}

function omitKeys(doc: SeedDoc, keys: string[]) {
    const omitted = new Set(keys);
    const next: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(doc)) {
        if (!omitted.has(key)) {
            next[key] = value;
        }
    }

    return next;
}

function mapCommon(doc: SeedDoc) {
    return {
        source_document_id: doc._id,
        document_created_at: toTimestamp(doc._createdAt),
        document_updated_at: toTimestamp(doc._updatedAt),
    };
}

function resolveSeedUserRef(docs: SeedDoc[], value: unknown) {
    const text = toText(value);
    if (!text) return null;

    const normalizedText = text.toLowerCase();
    const user = docs.find(doc => {
        if (doc._type !== 'user') return false;
        return (
            doc._id === text ||
            toText(doc.name)?.toLowerCase() === normalizedText ||
            toText(doc.email)?.toLowerCase() === normalizedText
        );
    });

    return user?._id || null;
}

function resolveExpenseCategoryRef(docs: SeedDoc[], refValue: unknown, nameValue?: unknown) {
    const ref = toText(refValue);
    const name = toText(nameValue);
    const categories = docs.filter(doc => doc._type === 'expenseCategory');

    if (ref && categories.some(category => category._id === ref)) {
        return ref;
    }

    if (name) {
        const normalizedName = name.toLowerCase();
        const category = categories.find(category => toText(category.name)?.toLowerCase() === normalizedName);
        if (category) {
            return category._id;
        }
    }

    return ref;
}

function mapCompanyProfiles(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'companyProfile')
        .map(doc => ({
            ...mapCommon(doc),
            name: toText(doc.name),
            address: toText(doc.address),
            phone: toText(doc.phone),
            email: toText(doc.email),
            npwp: toText(doc.npwp),
            bank_name: toText(doc.bankName),
            bank_account: toText(doc.bankAccount),
            bank_holder: toText(doc.bankHolder),
            theme_color: toText(doc.themeColor),
            numbering_settings: doc.numberingSettings ?? {},
            invoice_settings: doc.invoiceSettings ?? {},
            document_settings: doc.documentSettings ?? {},
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'name', 'address', 'phone', 'email', 'npwp',
                'bankName', 'bankAccount', 'bankHolder', 'themeColor',
                'numberingSettings', 'invoiceSettings', 'documentSettings',
            ]),
        }));
}

function mapEmployees(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'employee')
        .map(doc => ({
            ...mapCommon(doc),
            employee_code: toText(doc.employeeCode),
            name: toText(doc.name),
            phone: toText(doc.phone),
            position: toText(doc.position),
            division: toText(doc.division),
            join_date: toText(doc.joinDate),
            active: toBoolean(doc.active, true),
            user_ref: resolveSeedUserRef(docs, doc.userRef),
            user_name: toText(doc.userName),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'employeeCode', 'name', 'phone', 'position', 'division',
                'joinDate', 'active', 'userRef', 'userName', 'notes',
            ]),
        }));
}

function mapEmployeeAttendanceRecords(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'employeeAttendanceRecord')
        .map(doc => ({
            ...mapCommon(doc),
            employee_ref: toText(doc.employeeRef),
            employee_code: toText(doc.employeeCode),
            employee_name: toText(doc.employeeName),
            position: toText(doc.position),
            division: toText(doc.division),
            date: toText(doc.date),
            status: toText(doc.status),
            check_in_time: toText(doc.checkInTime),
            check_out_time: toText(doc.checkOutTime),
            note: toText(doc.note),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            updated_by: resolveSeedUserRef(docs, doc.updatedBy),
            updated_by_name: toText(doc.updatedByName),
            created_at_business: toTimestamp(doc.createdAt),
            updated_at_business: toTimestamp(doc.updatedAt),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'employeeRef', 'employeeCode', 'employeeName', 'position',
                'division', 'date', 'status', 'checkInTime', 'checkOutTime',
                'note', 'createdBy', 'createdByName', 'updatedBy', 'updatedByName',
                'createdAt', 'updatedAt',
            ]),
        }));
}

function mapDrivers(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'driver')
        .map(doc => ({
            ...mapCommon(doc),
            name: toText(doc.name),
            phone: toText(doc.phone),
            license_number: toText(doc.licenseNumber),
            ktp_number: toText(doc.ktpNumber),
            sim_expiry: toText(doc.simExpiry),
            address: toText(doc.address),
            active: toBoolean(doc.active, true),
            active_tracking_delivery_order_ref: toText(doc.activeTrackingDeliveryOrderRef),
            active_tracking_updated_at: toTimestamp(doc.activeTrackingUpdatedAt),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'name', 'phone', 'licenseNumber', 'ktpNumber', 'simExpiry',
                'address', 'active', 'activeTrackingDeliveryOrderRef', 'activeTrackingUpdatedAt',
            ]),
        }));
}

function mapSuppliers(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'supplier')
        .map(doc => ({
            ...mapCommon(doc),
            supplier_code: toText(doc.supplierCode),
            name: toText(doc.name),
            contact_person: toText(doc.contactPerson),
            phone: toText(doc.phone),
            address: toText(doc.address),
            default_term_days: toNumber(doc.defaultTermDays),
            active: toBoolean(doc.active, true),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'supplierCode', 'name', 'contactPerson', 'phone', 'address',
                'defaultTermDays', 'active', 'notes',
            ]),
        }));
}

function mapWarehouseItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'warehouseItem')
        .map(doc => ({
            ...mapCommon(doc),
            item_code: toText(doc.itemCode),
            name: toText(doc.name),
            category: toText(doc.category),
            unit: toText(doc.unit),
            tracking_mode: toText(doc.trackingMode),
            min_stock_qty: toNumber(doc.minStockQty),
            current_stock_qty: toNumber(doc.currentStockQty),
            default_supplier_ref: toText(doc.defaultSupplierRef),
            default_supplier_name: toText(doc.defaultSupplierName),
            default_purchase_price: toNumber(doc.defaultPurchasePrice),
            tire_type_default: toText(doc.tireTypeDefault),
            tire_brand_default: toText(doc.tireBrandDefault),
            tire_size_default: toText(doc.tireSizeDefault),
            active: toBoolean(doc.active, true),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'itemCode', 'name', 'category', 'unit', 'trackingMode',
                'minStockQty', 'currentStockQty', 'defaultSupplierRef', 'defaultSupplierName',
                'defaultPurchasePrice', 'tireTypeDefault', 'tireBrandDefault', 'tireSizeDefault',
                'active', 'notes',
            ]),
        }));
}

function mapSupplierItemPrices(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'supplierItemPrice')
        .map(doc => ({
            ...mapCommon(doc),
            supplier_ref: toText(doc.supplierRef),
            supplier_code: toText(doc.supplierCode),
            supplier_name: toText(doc.supplierName),
            warehouse_item_ref: toText(doc.warehouseItemRef),
            item_code: toText(doc.itemCode),
            item_name: toText(doc.itemName),
            item_unit: toText(doc.itemUnit),
            supplier_sku: toText(doc.supplierSku),
            supplier_item_name: toText(doc.supplierItemName),
            default_purchase_price: toNumber(doc.defaultPurchasePrice) ?? 0,
            min_order_qty: toNumber(doc.minOrderQty),
            lead_time_days: toNumber(doc.leadTimeDays),
            effective_from: toText(doc.effectiveFrom),
            effective_to: toText(doc.effectiveTo),
            active: toBoolean(doc.active, true),
            notes: toText(doc.notes),
            created_at_business: toTimestamp(doc.createdAt),
            updated_at_business: toTimestamp(doc.updatedAt),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'supplierRef', 'supplierCode', 'supplierName', 'warehouseItemRef',
                'itemCode', 'itemName', 'itemUnit', 'supplierSku', 'supplierItemName',
                'defaultPurchasePrice', 'minOrderQty', 'leadTimeDays', 'effectiveFrom',
                'effectiveTo', 'active', 'notes', 'createdAt', 'updatedAt',
            ]),
        }));
}

function mapTireEvents(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'tireEvent')
        .map(doc => ({
            ...mapCommon(doc),
            tire_code: toText(doc.tireCode),
            holder_type: toText(doc.holderType),
            status: toText(doc.status),
            vehicle_ref: toText(doc.vehicleRef),
            vehicle_plate: toText(doc.vehiclePlate),
            posisi: toText(doc.posisi),
            position_key: toText(doc.positionKey),
            slot_code: toText(doc.slotCode),
            slot_label: toText(doc.slotLabel),
            external_party_name: toText(doc.externalPartyName),
            external_plate_number: toText(doc.externalPlateNumber),
            tire_type: toText(doc.tireType),
            tire_brand: toText(doc.tireBrand),
            tire_size: toText(doc.tireSize),
            linked_warehouse_item_ref: toText(doc.linkedWarehouseItemRef),
            linked_warehouse_item_code: toText(doc.linkedWarehouseItemCode),
            linked_warehouse_item_name: toText(doc.linkedWarehouseItemName),
            source_purchase_ref: toText(doc.sourcePurchaseRef),
            source_purchase_number: toText(doc.sourcePurchaseNumber),
            source_purchase_item_ref: toText(doc.sourcePurchaseItemRef),
            source_receive_date: toText(doc.sourceReceiveDate),
            install_date: toText(doc.installDate),
            replace_date: toText(doc.replaceDate),
            notes: toText(doc.notes),
            purchase_cost: toNumber(doc.purchaseCost),
            original_cost: toNumber(doc.originalCost),
            total_used_percent: toNumber(doc.totalUsedPercent),
            remaining_percent: toNumber(doc.remainingPercent),
            remaining_value: toNumber(doc.remainingValue),
            maintenance_cost_posted_percent: toNumber(doc.maintenanceCostPostedPercent),
            maintenance_cost_posted_amount: toNumber(doc.maintenanceCostPostedAmount),
            last_maintenance_cost_ref: toText(doc.lastMaintenanceCostRef),
            accumulated_km: toNumber(doc.accumulatedKm),
            last_odometer_km: toNumber(doc.lastOdometerKm),
            last_km_update_at: toTimestamp(doc.lastKmUpdateAt),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'tireCode', 'holderType', 'status', 'vehicleRef', 'vehiclePlate',
                'posisi', 'positionKey', 'slotCode', 'slotLabel', 'externalPartyName',
                'externalPlateNumber', 'tireType', 'tireBrand', 'tireSize',
                'linkedWarehouseItemRef', 'linkedWarehouseItemCode', 'linkedWarehouseItemName',
                'sourcePurchaseRef', 'sourcePurchaseNumber', 'sourcePurchaseItemRef',
                'sourceReceiveDate', 'installDate', 'replaceDate', 'notes',
                'purchaseCost', 'originalCost', 'totalUsedPercent', 'remainingPercent',
                'remainingValue', 'maintenanceCostPostedPercent', 'maintenanceCostPostedAmount',
                'lastMaintenanceCostRef', 'accumulatedKm', 'lastOdometerKm', 'lastKmUpdateAt',
            ]),
        }));
}

function mapTireHistoryLogs(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'tireHistoryLog')
        .map(doc => ({
            ...mapCommon(doc),
            tire_event_ref: toText(doc.tireEventRef),
            tire_code: toText(doc.tireCode),
            tire_brand: toText(doc.tireBrand),
            tire_size: toText(doc.tireSize),
            action_type: toText(doc.actionType),
            timestamp: toTimestamp(doc.timestamp),
            actor_user_ref: resolveSeedUserRef(docs, doc.actorUserRef),
            actor_user_name: toText(doc.actorUserName),
            note: toText(doc.note),
            from_holder_type: toText(doc.fromHolderType),
            from_status: toText(doc.fromStatus),
            from_vehicle_ref: toText(doc.fromVehicleRef),
            from_vehicle_plate: toText(doc.fromVehiclePlate),
            from_slot_code: toText(doc.fromSlotCode),
            from_placement_label: toText(doc.fromPlacementLabel),
            to_holder_type: toText(doc.toHolderType),
            to_status: toText(doc.toStatus),
            to_vehicle_ref: toText(doc.toVehicleRef),
            to_vehicle_plate: toText(doc.toVehiclePlate),
            to_slot_code: toText(doc.toSlotCode),
            to_placement_label: toText(doc.toPlacementLabel),
            odometer_before_km: toNumber(doc.odometerBeforeKm),
            odometer_after_km: toNumber(doc.odometerAfterKm),
            distance_km: toNumber(doc.distanceKm),
            usage_percent: toNumber(doc.usagePercent),
            usage_cost: toNumber(doc.usageCost),
            cost_allocation_type: toText(doc.costAllocationType),
            related_maintenance_ref: toText(doc.relatedMaintenanceRef),
            cost_source_vehicle_ref: toText(doc.costSourceVehicleRef),
            cost_source_vehicle_plate: toText(doc.costSourceVehiclePlate),
            remaining_percent_after: toNumber(doc.remainingPercentAfter),
            remaining_value_after: toNumber(doc.remainingValueAfter),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'tireEventRef', 'tireCode', 'tireBrand', 'tireSize', 'actionType',
                'timestamp', 'actorUserRef', 'actorUserName', 'note',
                'fromHolderType', 'fromStatus', 'fromVehicleRef', 'fromVehiclePlate',
                'fromSlotCode', 'fromPlacementLabel', 'toHolderType', 'toStatus',
                'toVehicleRef', 'toVehiclePlate', 'toSlotCode', 'toPlacementLabel',
                'odometerBeforeKm', 'odometerAfterKm', 'distanceKm', 'usagePercent',
                'usageCost', 'costAllocationType', 'relatedMaintenanceRef',
                'costSourceVehicleRef', 'costSourceVehiclePlate',
                'remainingPercentAfter', 'remainingValueAfter',
            ]),
        }));
}

function mapExpenseCategories(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'expenseCategory')
        .map(doc => ({
            ...mapCommon(doc),
            name: toText(doc.name),
            active: toBoolean(doc.active, true),
            extra_data: omitKeys(doc, ['_id', '_type', '_createdAt', '_updatedAt', 'name', 'active']),
        }));
}

function mapDriverVouchers(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'driverVoucher')
        .map(doc => ({
            ...mapCommon(doc),
            bon_number: toText(doc.bonNumber),
            issuer_company_name: toText(doc.issuerCompanyName),
            issuer_company_address: toText(doc.issuerCompanyAddress),
            issuer_company_phone: toText(doc.issuerCompanyPhone),
            issuer_company_email: toText(doc.issuerCompanyEmail),
            issuer_company_logo_url: toText(doc.issuerCompanyLogoUrl),
            driver_ref: toText(doc.driverRef),
            driver_name: toText(doc.driverName),
            delivery_order_ref: toText(doc.deliveryOrderRef),
            do_number: toText(doc.doNumber),
            vehicle_ref: toText(doc.vehicleRef),
            vehicle_plate: toText(doc.vehiclePlate),
            route: toText(doc.route),
            issued_date: toText(doc.issuedDate),
            cash_given: toNumber(doc.cashGiven) ?? 0,
            initial_cash_given: toNumber(doc.initialCashGiven),
            total_issued_amount: toNumber(doc.totalIssuedAmount),
            top_up_count: toNumber(doc.topUpCount),
            driver_fee_amount: toNumber(doc.driverFeeAmount),
            total_claim_amount: toNumber(doc.totalClaimAmount),
            issue_bank_ref: toText(doc.issueBankRef),
            issue_bank_name: toText(doc.issueBankName),
            total_spent: toNumber(doc.totalSpent) ?? 0,
            balance: toNumber(doc.balance) ?? 0,
            status: toText(doc.status),
            notes: toText(doc.notes),
            settled_date: toText(doc.settledDate),
            settled_by: resolveSeedUserRef(docs, doc.settledBy),
            settlement_bank_ref: toText(doc.settlementBankRef),
            settlement_bank_name: toText(doc.settlementBankName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'bonNumber', 'issuerCompanyName', 'issuerCompanyAddress', 'issuerCompanyPhone',
                'issuerCompanyEmail', 'issuerCompanyLogoUrl', 'driverRef', 'driverName',
                'deliveryOrderRef', 'doNumber', 'vehicleRef', 'vehiclePlate', 'route',
                'issuedDate', 'cashGiven', 'initialCashGiven', 'totalIssuedAmount', 'topUpCount',
                'driverFeeAmount', 'totalClaimAmount', 'issueBankRef', 'issueBankName',
                'totalSpent', 'balance', 'status', 'notes', 'settledDate', 'settledBy',
                'settlementBankRef', 'settlementBankName',
            ]),
        }));
}

function mapDriverVoucherDisbursements(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'driverVoucherDisbursement')
        .map(doc => ({
            ...mapCommon(doc),
            voucher_ref: toText(doc.voucherRef),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            kind: toText(doc.kind),
            bank_account_ref: toText(doc.bankAccountRef),
            bank_account_name: toText(doc.bankAccountName),
            bank_account_number: toText(doc.bankAccountNumber),
            bank_transaction_ref: toText(doc.bankTransactionRef),
            note: toText(doc.note),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'voucherRef', 'date', 'amount', 'kind', 'bankAccountRef',
                'bankAccountName', 'bankAccountNumber', 'bankTransactionRef',
                'note', 'createdBy', 'createdByName',
            ]),
        }));
}

function mapDriverVoucherItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'driverVoucherItem')
        .map(doc => ({
            ...mapCommon(doc),
            voucher_ref: toText(doc.voucherRef),
            expense_date: toText(doc.expenseDate),
            category: toText(doc.category),
            description: toText(doc.description),
            amount: toNumber(doc.amount) ?? 0,
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'voucherRef', 'expenseDate', 'category', 'description', 'amount',
            ]),
        }));
}

function mapDriverBorongans(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'driverBorongan')
        .map(doc => ({
            ...mapCommon(doc),
            borongan_number: toText(doc.boronganNumber),
            issuer_company_name: toText(doc.issuerCompanyName),
            issuer_company_address: toText(doc.issuerCompanyAddress),
            issuer_company_phone: toText(doc.issuerCompanyPhone),
            issuer_company_email: toText(doc.issuerCompanyEmail),
            issuer_company_logo_url: toText(doc.issuerCompanyLogoUrl),
            driver_ref: toText(doc.driverRef),
            driver_name: toText(doc.driverName),
            period_start: toText(doc.periodStart),
            period_end: toText(doc.periodEnd),
            status: toText(doc.status),
            total_amount: toNumber(doc.totalAmount) ?? 0,
            total_collie: toNumber(doc.totalCollie) ?? 0,
            total_weight_kg: toNumber(doc.totalWeightKg) ?? 0,
            notes: toText(doc.notes),
            paid_date: toText(doc.paidDate),
            paid_method: toText(doc.paidMethod),
            paid_bank_ref: toText(doc.paidBankRef),
            paid_bank_name: toText(doc.paidBankName),
            paid_bank_number: toText(doc.paidBankNumber),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'boronganNumber', 'issuerCompanyName', 'issuerCompanyAddress', 'issuerCompanyPhone',
                'issuerCompanyEmail', 'issuerCompanyLogoUrl', 'driverRef', 'driverName',
                'periodStart', 'periodEnd', 'status', 'totalAmount', 'totalCollie',
                'totalWeightKg', 'notes', 'paidDate', 'paidMethod', 'paidBankRef',
                'paidBankName', 'paidBankNumber',
            ]),
        }));
}

function mapDriverBoronganItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'driverBoronganItem')
        .map(doc => ({
            ...mapCommon(doc),
            borongan_ref: toText(doc.boronganRef),
            do_ref: toText(doc.doRef),
            do_number: toText(doc.doNumber),
            vehicle_plate: toText(doc.vehiclePlate),
            date: toText(doc.date),
            no_sj: toText(doc.noSJ),
            tujuan: toText(doc.tujuan),
            barang: toText(doc.barang),
            collie: toNumber(doc.collie),
            berat_kg: toNumber(doc.beratKg) ?? 0,
            tarip: toNumber(doc.tarip) ?? 0,
            uang_rp: toNumber(doc.uangRp) ?? 0,
            ket: toText(doc.ket),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'boronganRef', 'doRef', 'doNumber', 'vehiclePlate', 'date',
                'noSJ', 'tujuan', 'barang', 'collie', 'beratKg', 'tarip',
                'uangRp', 'ket',
            ]),
        }));
}

function mapCustomers(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'customer')
        .map(doc => ({
            ...mapCommon(doc),
            name: toText(doc.name),
            address: toText(doc.address),
            contact_person: toText(doc.contactPerson),
            phone: toText(doc.phone),
            email: toText(doc.email),
            default_payment_term: toNumber(doc.defaultPaymentTerm),
            npwp: toText(doc.npwp),
            active: toBoolean(doc.active, true),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'name', 'address', 'contactPerson', 'phone', 'email',
                'defaultPaymentTerm', 'npwp', 'active',
            ]),
        }));
}

function mapCustomerProducts(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'customerProduct')
        .map(doc => ({
            ...mapCommon(doc),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            code: toText(doc.code),
            name: toText(doc.name),
            description: toText(doc.description),
            default_qty_koli: toNumber(doc.defaultQtyKoli),
            default_weight_kg: toNumber(doc.defaultWeight),
            default_weight_input_value: toNumber(doc.defaultWeightInputValue),
            default_weight_input_unit: toText(doc.defaultWeightInputUnit),
            default_volume_m3: toNumber(doc.defaultVolume),
            default_volume_input_value: toNumber(doc.defaultVolumeInputValue),
            default_volume_input_unit: toText(doc.defaultVolumeInputUnit),
            notes: toText(doc.notes),
            active: toBoolean(doc.active, true),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'customerRef', 'customerName', 'code', 'name', 'description',
                'defaultQtyKoli', 'defaultWeight', 'defaultWeightInputValue', 'defaultWeightInputUnit',
                'defaultVolume', 'defaultVolumeInputValue', 'defaultVolumeInputUnit',
                'notes', 'active',
            ]),
        }));
}

function mapCustomerBillingRates(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'customerBillingRate')
        .map(doc => ({
            ...mapCommon(doc),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            service_ref: toText(doc.serviceRef),
            service_name: toText(doc.serviceName),
            basis: toText(doc.basis),
            rate: toNumber(doc.rate) ?? 0,
            route_from: toText(doc.routeFrom),
            route_to: toText(doc.routeTo),
            notes: toText(doc.notes),
            active: toBoolean(doc.active, true),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'customerRef', 'customerName', 'serviceRef', 'serviceName',
                'basis', 'rate', 'routeFrom', 'routeTo', 'notes', 'active',
            ]),
        }));
}

function mapCustomerRecipients(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'customerRecipient')
        .map(doc => ({
            ...mapCommon(doc),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            label: toText(doc.label),
            receiver_name: toText(doc.receiverName),
            receiver_phone: toText(doc.receiverPhone),
            receiver_address: toText(doc.receiverAddress),
            receiver_company: toText(doc.receiverCompany),
            notes: toText(doc.notes),
            active: toBoolean(doc.active, true),
            is_default: toBoolean(doc.isDefault, false),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'customerRef', 'customerName', 'label', 'receiverName', 'receiverPhone',
                'receiverAddress', 'receiverCompany', 'notes', 'active', 'isDefault',
            ]),
        }));
}

function mapCustomerPickupLocations(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'customerPickupLocation')
        .map(doc => ({
            ...mapCommon(doc),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            label: toText(doc.label),
            pickup_address: toText(doc.pickupAddress),
            notes: toText(doc.notes),
            active: toBoolean(doc.active, true),
            is_default: toBoolean(doc.isDefault, false),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'customerRef', 'customerName', 'label', 'pickupAddress',
                'notes', 'active', 'isDefault',
            ]),
        }));
}

function mapServices(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'service')
        .map(doc => ({
            ...mapCommon(doc),
            code: toText(doc.code),
            name: toText(doc.name),
            description: toText(doc.description),
            max_payload_kg: toNumber(doc.maxPayloadKg),
            oil_maintenance_km: toNumber(doc.oilMaintenanceKm),
            tire_layout_config: doc.tireLayoutConfig ?? null,
            active: toBoolean(doc.active, true),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'code', 'name', 'description', 'maxPayloadKg', 'oilMaintenanceKm', 'tireLayoutConfig',
                'overtonaseDriverRatePerKg', 'active',
            ]),
        }));
}

function mapTripRouteRates(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'tripRouteRate')
        .map(doc => ({
            ...mapCommon(doc),
            origin_area: toText(doc.originArea),
            destination_area: toText(doc.destinationArea),
            service_ref: toText(doc.serviceRef),
            service_name: toText(doc.serviceName),
            rate: toNumber(doc.rate),
            overtonase_driver_rate_per_ton: toNumber(doc.overtonaseDriverRatePerTon ?? doc.overtonaseReferencePerTon),
            notes: toText(doc.notes),
            active: toBoolean(doc.active, true),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'originArea', 'destinationArea', 'serviceRef', 'serviceName',
                'rate', 'overtonaseDriverRatePerTon', 'overtonaseReferencePerTon', 'notes', 'active',
            ]),
        }));
}

function mapVehicles(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'vehicle')
        .map(doc => ({
            ...mapCommon(doc),
            unit_code: toText(doc.unitCode),
            plate_number: toText(doc.plateNumber),
            vehicle_type: toText(doc.vehicleType),
            brand_model: toText(doc.brandModel),
            year: toNumber(doc.year),
            capacity_kg: toNumber(doc.capacityKg),
            capacity_volume_m3: toNumber(doc.capacityVolume),
            service_ref: toText(doc.serviceRef),
            service_name: toText(doc.serviceName),
            tire_layout_config: doc.tireLayoutConfig ?? null,
            status: toText(doc.status),
            last_odometer: toNumber(doc.lastOdometer),
            last_odometer_at: toText(doc.lastOdometerAt),
            oil_maintenance_interval_km: toNumber(doc.oilMaintenanceIntervalKm),
            oil_last_service_odometer: toNumber(doc.oilLastServiceOdometer),
            oil_next_service_odometer: toNumber(doc.oilNextServiceOdometer),
            oil_service_remaining_km: toNumber(doc.oilServiceRemainingKm),
            oil_maintenance_status: toText(doc.oilMaintenanceStatus),
            last_trip_odometer_delta_km: toNumber(doc.lastTripOdometerDeltaKm),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'unitCode', 'plateNumber', 'vehicleType', 'brandModel',
                'year', 'capacityKg', 'capacityVolume', 'serviceRef', 'serviceName',
                'tireLayoutConfig', 'status', 'lastOdometer', 'lastOdometerAt',
                'oilMaintenanceIntervalKm', 'oilLastServiceOdometer', 'oilNextServiceOdometer',
                'oilServiceRemainingKm', 'oilMaintenanceStatus', 'lastTripOdometerDeltaKm',
            ]),
        }));
}

function mapUsers(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'user')
        .map(doc => ({
            ...mapCommon(doc),
            name: toText(doc.name),
            email: toText(doc.email),
            role: toText(doc.role),
            driver_ref: toText(doc.driverRef),
            driver_name: toText(doc.driverName),
            password_hash: toText(doc.passwordHash),
            active: toBoolean(doc.active, true),
            created_at_business: toTimestamp(doc.createdAt),
            last_login_at: toTimestamp(doc.lastLoginAt),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'name', 'email', 'role', 'driverRef', 'driverName',
                'passwordHash', 'active', 'createdAt', 'lastLoginAt',
            ]),
        }));
}

function mapBankAccounts(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'bankAccount')
        .map(doc => ({
            ...mapCommon(doc),
            bank_name: toText(doc.bankName),
            account_number: toText(doc.accountNumber),
            account_holder: toText(doc.accountHolder),
            account_type: toText(doc.accountType),
            system_key: toText(doc.systemKey),
            initial_balance: toNumber(doc.initialBalance) ?? 0,
            current_balance: toNumber(doc.currentBalance) ?? 0,
            active: toBoolean(doc.active, true),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'bankName', 'accountNumber', 'accountHolder', 'accountType',
                'systemKey', 'initialBalance', 'currentBalance', 'active', 'notes',
            ]),
        }));
}

function mapBankTransactions(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'bankTransaction')
        .map(doc => ({
            ...mapCommon(doc),
            bank_account_ref: toText(doc.bankAccountRef),
            bank_account_name: toText(doc.bankAccountName),
            bank_account_number: toText(doc.bankAccountNumber),
            type: toText(doc.type),
            amount: toNumber(doc.amount) ?? 0,
            date: toText(doc.date),
            description: toText(doc.description),
            balance_after: toNumber(doc.balanceAfter) ?? 0,
            related_payment_ref: toText(doc.relatedPaymentRef),
            related_receipt_ref: toText(doc.relatedReceiptRef),
            related_expense_ref: toText(doc.relatedExpenseRef),
            related_transfer_ref: toText(doc.relatedTransferRef),
            related_voucher_ref: toText(doc.relatedVoucherRef),
            related_overpayment_refund_ref: toText(doc.relatedOverpaymentRefundRef),
            related_purchase_payment_ref: toText(doc.relatedPurchasePaymentRef),
            related_purchase_ref: toText(doc.relatedPurchaseRef),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'bankAccountRef', 'bankAccountName', 'bankAccountNumber', 'type',
                'amount', 'date', 'description', 'balanceAfter', 'relatedPaymentRef',
                'relatedReceiptRef', 'relatedExpenseRef', 'relatedTransferRef',
                'relatedVoucherRef', 'relatedOverpaymentRefundRef', 'relatedPurchasePaymentRef',
                'relatedPurchaseRef',
            ]),
        }));
}

function mapExpenses(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'expense')
        .map(doc => ({
            ...mapCommon(doc),
            category_ref: resolveExpenseCategoryRef(docs, doc.categoryRef, doc.categoryName),
            category_name: toText(doc.categoryName),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            note: toText(doc.note),
            description: toText(doc.description),
            receipt_url: toText(doc.receiptUrl),
            privacy_level: toText(doc.privacyLevel) ?? 'internal',
            bank_account_ref: toText(doc.bankAccountRef),
            bank_account_name: toText(doc.bankAccountName),
            bank_account_number: toText(doc.bankAccountNumber),
            related_vehicle_ref: toText(doc.relatedVehicleRef),
            related_vehicle_plate: toText(doc.relatedVehiclePlate),
            related_incident_ref: toText(doc.relatedIncidentRef),
            related_incident_settlement_line_ref: toText(doc.relatedIncidentSettlementLineRef),
            related_maintenance_ref: toText(doc.relatedMaintenanceRef),
            borongan_ref: toText(doc.boronganRef),
            voucher_ref: toText(doc.voucherRef),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'categoryRef', 'categoryName', 'date', 'amount', 'note', 'description',
                'receiptUrl', 'privacyLevel', 'bankAccountRef', 'bankAccountName', 'bankAccountNumber',
                'relatedVehicleRef', 'relatedVehiclePlate', 'relatedIncidentRef',
                'relatedIncidentSettlementLineRef', 'relatedMaintenanceRef', 'boronganRef', 'voucherRef',
            ]),
        }));
}

function mapPurchases(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'purchase')
        .map(doc => ({
            ...mapCommon(doc),
            purchase_number: toText(doc.purchaseNumber),
            supplier_ref: toText(doc.supplierRef),
            supplier_name: toText(doc.supplierName),
            order_date: toText(doc.orderDate),
            due_date: toText(doc.dueDate),
            status: toText(doc.status),
            notes: toText(doc.notes),
            total_amount: toNumber(doc.totalAmount),
            total_ordered_qty: toNumber(doc.totalOrderedQty),
            total_received_qty: toNumber(doc.totalReceivedQty),
            paid_amount: toNumber(doc.paidAmount),
            outstanding_amount: toNumber(doc.outstandingAmount),
            line_count: toNumber(doc.lineCount),
            last_received_at: toTimestamp(doc.lastReceivedAt),
            last_paid_at: toTimestamp(doc.lastPaidAt),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            created_at_business: toTimestamp(doc.createdAt),
            updated_at_business: toTimestamp(doc.updatedAt),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'purchaseNumber', 'supplierRef', 'supplierName', 'orderDate', 'dueDate',
                'status', 'notes', 'totalAmount', 'totalOrderedQty', 'totalReceivedQty',
                'paidAmount', 'outstandingAmount', 'lineCount', 'lastReceivedAt',
                'lastPaidAt', 'createdBy', 'createdByName', 'createdAt', 'updatedAt',
            ]),
        }));
}

function mapPurchaseItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'purchaseItem')
        .map(doc => ({
            ...mapCommon(doc),
            purchase_ref: toText(doc.purchaseRef),
            warehouse_item_ref: toText(doc.warehouseItemRef),
            item_code: toText(doc.itemCode),
            item_name: toText(doc.itemName),
            item_unit: toText(doc.itemUnit),
            tracking_mode: toText(doc.trackingMode),
            tire_type_default: toText(doc.tireTypeDefault),
            tire_brand_default: toText(doc.tireBrandDefault),
            tire_size_default: toText(doc.tireSizeDefault),
            ordered_qty: toNumber(doc.orderedQty) ?? 0,
            received_qty: toNumber(doc.receivedQty),
            unit_price: toNumber(doc.unitPrice) ?? 0,
            subtotal: toNumber(doc.subtotal) ?? 0,
            supplier_item_price_ref: toText(doc.supplierItemPriceRef),
            price_source: toText(doc.priceSource),
            price_effective_date: toText(doc.priceEffectiveDate),
            original_unit_price: toNumber(doc.originalUnitPrice),
            price_overridden: toBoolean(doc.priceOverridden, false),
            price_override_reason: toText(doc.priceOverrideReason),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'purchaseRef', 'warehouseItemRef', 'itemCode', 'itemName', 'itemUnit',
                'trackingMode', 'tireTypeDefault', 'tireBrandDefault', 'tireSizeDefault',
                'orderedQty', 'receivedQty', 'unitPrice', 'subtotal', 'supplierItemPriceRef',
                'priceSource', 'priceEffectiveDate', 'originalUnitPrice', 'priceOverridden',
                'priceOverrideReason', 'notes',
            ]),
        }));
}

function mapPurchasePayments(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'purchasePayment')
        .map(doc => ({
            ...mapCommon(doc),
            purchase_ref: toText(doc.purchaseRef),
            purchase_number: toText(doc.purchaseNumber),
            supplier_ref: toText(doc.supplierRef),
            supplier_name: toText(doc.supplierName),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            bank_account_ref: toText(doc.bankAccountRef),
            bank_account_name: toText(doc.bankAccountName),
            bank_account_number: toText(doc.bankAccountNumber),
            bank_transaction_ref: toText(doc.bankTransactionRef),
            note: toText(doc.note),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'purchaseRef', 'purchaseNumber', 'supplierRef', 'supplierName', 'date',
                'amount', 'bankAccountRef', 'bankAccountName', 'bankAccountNumber',
                'bankTransactionRef', 'note', 'createdBy', 'createdByName',
            ]),
        }));
}

function mapStockMovements(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'stockMovement')
        .map(doc => ({
            ...mapCommon(doc),
            warehouse_item_ref: toText(doc.warehouseItemRef),
            item_code: toText(doc.itemCode),
            item_name: toText(doc.itemName),
            unit: toText(doc.unit),
            movement_date: toText(doc.movementDate),
            type: toText(doc.type),
            source_type: toText(doc.sourceType),
            source_ref: toText(doc.sourceRef),
            source_number: toText(doc.sourceNumber),
            quantity: toNumber(doc.quantity) ?? 0,
            balance_after: toNumber(doc.balanceAfter),
            unit_cost_snapshot: toNumber(doc.unitCostSnapshot),
            subtotal_cost: toNumber(doc.subtotalCost),
            cost_method: toText(doc.costMethod),
            note: toText(doc.note),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'warehouseItemRef', 'itemCode', 'itemName', 'unit', 'movementDate',
                'type', 'sourceType', 'sourceRef', 'sourceNumber', 'quantity',
                'balanceAfter', 'unitCostSnapshot', 'subtotalCost', 'costMethod',
                'note', 'createdBy', 'createdByName',
            ]),
        }));
}

function mapOrders(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'order')
        .map(doc => ({
            ...mapCommon(doc),
            master_resi: toText(doc.masterResi),
            cargo_entry_mode: toText(doc.cargoEntryMode),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            receiver_name: toText(doc.receiverName),
            receiver_phone: toText(doc.receiverPhone),
            receiver_address: toText(doc.receiverAddress),
            receiver_company: toText(doc.receiverCompany),
            pickup_address: toText(doc.pickupAddress),
            service_ref: toText(doc.serviceRef),
            service_name: toText(doc.serviceName),
            status: toText(doc.status),
            notes: toText(doc.notes),
            created_at_business: toTimestamp(doc.createdAt),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'masterResi', 'cargoEntryMode', 'customerRef', 'customerName',
                'receiverName', 'receiverPhone', 'receiverAddress', 'receiverCompany', 'pickupAddress',
                'serviceRef', 'serviceName', 'status', 'notes', 'createdAt', 'createdBy',
            ]),
        }));
}

function mapOrderItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'orderItem')
        .map(doc => ({
            ...mapCommon(doc),
            order_ref: toText(doc.orderRef),
            customer_product_ref: toText(doc.customerProductRef),
            description: toText(doc.description),
            qty_koli: toNumber(doc.qtyKoli),
            weight_kg: toNumber(doc.weight),
            volume_m3: toNumber(doc.volume),
            delivered_qty_koli: toNumber(doc.deliveredQtyKoli),
            delivered_weight_kg: toNumber(doc.deliveredWeight),
            status: toText(doc.status),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'orderRef', 'customerProductRef', 'description', 'qtyKoli',
                'weight', 'volume', 'deliveredQtyKoli', 'deliveredWeight', 'status',
            ]),
        }));
}

function mapDeliveryOrders(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'deliveryOrder')
        .map(doc => ({
            ...mapCommon(doc),
            do_number: toText(doc.doNumber),
            order_ref: toText(doc.orderRef),
            master_resi: toText(doc.masterResi),
            customer_ref: toText(doc.customerRef),
            customer_do_prefix: toText(doc.customerDoPrefix),
            customer_do_sequence: toNumber(doc.customerDoSequence),
            customer_do_period: toText(doc.customerDoPeriod),
            customer_do_number: toText(doc.customerDoNumber),
            vehicle_ref: toText(doc.vehicleRef),
            vehicle_plate: toText(doc.vehiclePlate),
            driver_ref: toText(doc.driverRef),
            driver_name: toText(doc.driverName),
            date: toText(doc.date),
            status: toText(doc.status),
            tracking_state: toText(doc.trackingState),
            tracking_started_at: toTimestamp(doc.trackingStartedAt),
            tracking_stopped_at: toTimestamp(doc.trackingStoppedAt),
            tracking_last_seen_at: toTimestamp(doc.trackingLastSeenAt),
            tracking_last_lat: toNumber(doc.trackingLastLat),
            tracking_last_lng: toNumber(doc.trackingLastLng),
            trip_closed_by_admin_at: toTimestamp(doc.tripClosedByAdminAt),
            trip_closed_by_admin_ref: resolveSeedUserRef(docs, doc.tripClosedByAdminRef),
            trip_closed_by_admin_name: toText(doc.tripClosedByAdminName),
            trip_start_odometer_km: toNumber(doc.tripStartOdometerKm),
            trip_end_odometer_km: toNumber(doc.tripEndOdometerKm),
            trip_distance_km: toNumber(doc.tripDistanceKm),
            odometer_confirmed_at: toTimestamp(doc.odometerConfirmedAt),
            odometer_confirmed_by_ref: resolveSeedUserRef(docs, doc.odometerConfirmedByRef),
            odometer_confirmed_by_name: toText(doc.odometerConfirmedByName),
            customer_name: toText(doc.customerName),
            receiver_name: toText(doc.receiverName),
            receiver_phone: toText(doc.receiverPhone),
            receiver_address: toText(doc.receiverAddress),
            receiver_company: toText(doc.receiverCompany),
            pickup_address: toText(doc.pickupAddress),
            service_ref: toText(doc.serviceRef),
            service_name: toText(doc.serviceName),
            vehicle_service_ref: toText(doc.vehicleServiceRef),
            vehicle_service_name: toText(doc.vehicleServiceName),
            vehicle_category_override_reason: toText(doc.vehicleCategoryOverrideReason),
            trip_route_rate_ref: toText(doc.tripRouteRateRef),
            trip_origin_area: toText(doc.tripOriginArea),
            trip_destination_area: toText(doc.tripDestinationArea),
            base_tarip_borongan: toNumber(doc.baseTaripBorongan),
            tarip_borongan: toNumber(doc.taripBorongan),
            keterangan_borongan: toText(doc.keteranganBorongan),
            freight_nota_ref: toText(doc.freightNotaRef),
            freight_nota_number: toText(doc.freightNotaNumber),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'doNumber', 'orderRef', 'masterResi', 'customerRef',
                'customerDoPrefix', 'customerDoSequence', 'customerDoPeriod', 'customerDoNumber',
                'vehicleRef',
                'vehiclePlate', 'driverRef', 'driverName', 'date', 'status',
                'trackingState', 'trackingStartedAt', 'trackingStoppedAt', 'trackingLastSeenAt',
                'trackingLastLat', 'trackingLastLng', 'tripClosedByAdminAt', 'tripClosedByAdminRef',
                'tripClosedByAdminName', 'tripStartOdometerKm', 'tripEndOdometerKm',
                'tripDistanceKm', 'odometerConfirmedAt', 'odometerConfirmedByRef',
                'odometerConfirmedByName', 'customerName', 'receiverName',
                'receiverPhone', 'receiverAddress', 'receiverCompany', 'pickupAddress',
                'serviceRef', 'serviceName', 'vehicleServiceRef', 'vehicleServiceName',
                'vehicleCategoryOverrideReason', 'tripRouteRateRef', 'tripOriginArea',
                'tripDestinationArea', 'baseTaripBorongan', 'taripBorongan',
                'keteranganBorongan', 'freightNotaRef', 'freightNotaNumber', 'notes',
            ]),
        }));
}

function mapDeliveryOrderItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'deliveryOrderItem')
        .map(doc => ({
            ...mapCommon(doc),
            delivery_order_ref: toText(doc.deliveryOrderRef),
            order_item_ref: toText(doc.orderItemRef),
            pickup_stop_key: toText(doc.pickupStopKey),
            pickup_address: toText(doc.pickupAddress),
            shipper_reference_key: toText(doc.shipperReferenceKey),
            shipper_reference_number: toText(doc.shipperReferenceNumber),
            order_item_description: toText(doc.orderItemDescription),
            order_item_qty_koli: toNumber(doc.orderItemQtyKoli),
            order_item_weight_kg: toNumber(doc.orderItemWeight),
            order_item_volume_m3: toNumber(doc.orderItemVolumeM3),
            order_item_weight_input_value: toNumber(doc.orderItemWeightInputValue),
            order_item_weight_input_unit: toText(doc.orderItemWeightInputUnit),
            order_item_volume_input_value: toNumber(doc.orderItemVolumeInputValue),
            order_item_volume_input_unit: toText(doc.orderItemVolumeInputUnit),
            held_qty_koli: toNumber(doc.heldQtyKoli),
            held_weight_kg: toNumber(doc.heldWeight),
            held_volume_m3: toNumber(doc.heldVolume),
            shipped_qty_koli: toNumber(doc.shippedQtyKoli),
            shipped_weight_kg: toNumber(doc.shippedWeight),
            shipped_volume_m3: toNumber(doc.shippedVolume),
            actual_qty_koli: toNumber(doc.actualQtyKoli),
            actual_weight_kg: toNumber(doc.actualWeightKg),
            actual_volume_m3: toNumber(doc.actualVolumeM3),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'deliveryOrderRef', 'orderItemRef', 'pickupStopKey', 'pickupAddress',
                'shipperReferenceKey', 'shipperReferenceNumber', 'orderItemDescription',
                'orderItemQtyKoli', 'orderItemWeight', 'orderItemVolumeM3',
                'orderItemWeightInputValue', 'orderItemWeightInputUnit',
                'orderItemVolumeInputValue', 'orderItemVolumeInputUnit',
                'heldQtyKoli', 'heldWeight', 'heldVolume', 'shippedQtyKoli',
                'shippedWeight', 'shippedVolume', 'actualQtyKoli', 'actualWeightKg',
                'actualVolumeM3',
            ]),
        }));
}

function mapTrips(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'trip')
        .map(doc => ({
            ...mapCommon(doc),
            delivery_order_ref: toText(doc.deliveryOrderRef),
            order_ref: toText(doc.orderRef),
            trip_number: toText(doc.tripNumber),
            master_resi: toText(doc.masterResi),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            vehicle_ref: toText(doc.vehicleRef),
            vehicle_plate: toText(doc.vehiclePlate),
            driver_ref: toText(doc.driverRef),
            driver_name: toText(doc.driverName),
            trip_date: toText(doc.tripDate),
            status: toText(doc.status),
            pickup_address: toText(doc.pickupAddress),
            receiver_name: toText(doc.receiverName),
            receiver_phone: toText(doc.receiverPhone),
            receiver_address: toText(doc.receiverAddress),
            receiver_company: toText(doc.receiverCompany),
            service_ref: toText(doc.serviceRef),
            service_name: toText(doc.serviceName),
            vehicle_service_ref: toText(doc.vehicleServiceRef),
            vehicle_service_name: toText(doc.vehicleServiceName),
            vehicle_category_override_reason: toText(doc.vehicleCategoryOverrideReason),
            trip_route_rate_ref: toText(doc.tripRouteRateRef),
            trip_origin_area: toText(doc.tripOriginArea),
            trip_destination_area: toText(doc.tripDestinationArea),
            tracking_state: toText(doc.trackingState),
            tracking_started_at: toTimestamp(doc.trackingStartedAt),
            tracking_stopped_at: toTimestamp(doc.trackingStoppedAt),
            tracking_last_seen_at: toTimestamp(doc.trackingLastSeenAt),
            pending_driver_status: toText(doc.pendingDriverStatus),
            trip_closed_by_admin_at: toTimestamp(doc.tripClosedByAdminAt),
            trip_closed_by_admin_ref: resolveSeedUserRef(docs, doc.tripClosedByAdminRef),
            trip_closed_by_admin_name: toText(doc.tripClosedByAdminName),
            trip_start_odometer_km: toNumber(doc.tripStartOdometerKm),
            trip_end_odometer_km: toNumber(doc.tripEndOdometerKm),
            trip_distance_km: toNumber(doc.tripDistanceKm),
            odometer_confirmed_at: toTimestamp(doc.odometerConfirmedAt),
            odometer_confirmed_by_ref: resolveSeedUserRef(docs, doc.odometerConfirmedByRef),
            odometer_confirmed_by_name: toText(doc.odometerConfirmedByName),
            cargo_finalized_at: toTimestamp(doc.cargoFinalizedAt),
            tarip_borongan: toNumber(doc.taripBorongan),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'deliveryOrderRef', 'orderRef', 'tripNumber', 'masterResi',
                'customerRef', 'customerName', 'vehicleRef', 'vehiclePlate',
                'driverRef', 'driverName', 'tripDate', 'status',
                'pickupAddress', 'receiverName', 'receiverPhone', 'receiverAddress',
                'receiverCompany', 'serviceRef', 'serviceName', 'vehicleServiceRef',
                'vehicleServiceName', 'vehicleCategoryOverrideReason', 'tripRouteRateRef',
                'tripOriginArea', 'tripDestinationArea', 'trackingState',
                'trackingStartedAt', 'trackingStoppedAt', 'trackingLastSeenAt',
                'pendingDriverStatus', 'tripClosedByAdminAt', 'tripClosedByAdminRef',
                'tripClosedByAdminName', 'tripStartOdometerKm', 'tripEndOdometerKm',
                'tripDistanceKm', 'odometerConfirmedAt', 'odometerConfirmedByRef',
                'odometerConfirmedByName', 'cargoFinalizedAt', 'taripBorongan', 'notes',
            ]),
        }));
}

function mapSuratJalanDocuments(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'suratJalan')
        .map(doc => ({
            ...mapCommon(doc),
            trip_ref: toText(doc.tripRef),
            delivery_order_ref: toText(doc.deliveryOrderRef),
            order_ref: toText(doc.orderRef),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            reference_key: toText(doc.referenceKey),
            surat_jalan_number: toText(doc.suratJalanNumber),
            pickup_address: toText(doc.pickupAddress),
            receiver_name: toText(doc.receiverName),
            receiver_company: toText(doc.receiverCompany),
            receiver_address: toText(doc.receiverAddress),
            trip_date: toText(doc.tripDate),
            trip_status: toText(doc.tripStatus),
            vehicle_plate: toText(doc.vehiclePlate),
            driver_name: toText(doc.driverName),
            item_count: toNumber(doc.itemCount),
            cargo_summary: doc.cargoSummary ?? {},
            billable_cargo: doc.billableCargo ?? {},
            hold_cargo: doc.holdCargo ?? {},
            return_cargo: doc.returnCargo ?? {},
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'tripRef', 'deliveryOrderRef', 'orderRef', 'customerRef',
                'customerName', 'referenceKey', 'suratJalanNumber', 'pickupAddress',
                'receiverName', 'receiverCompany', 'receiverAddress', 'tripDate',
                'tripStatus', 'vehiclePlate', 'driverName', 'itemCount',
                'cargoSummary', 'billableCargo', 'holdCargo', 'returnCargo',
            ]),
        }));
}

function mapSuratJalanItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'suratJalanItem')
        .map(doc => ({
            ...mapCommon(doc),
            surat_jalan_ref: toText(doc.suratJalanRef),
            trip_ref: toText(doc.tripRef),
            delivery_order_item_ref: toText(doc.deliveryOrderItemRef),
            reference_key: toText(doc.referenceKey),
            surat_jalan_number: toText(doc.suratJalanNumber),
            order_item_description: toText(doc.orderItemDescription),
            planned_cargo: doc.plannedCargo ?? {},
            actual_cargo: doc.actualCargo ?? {},
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'suratJalanRef', 'tripRef', 'deliveryOrderItemRef', 'referenceKey',
                'suratJalanNumber', 'orderItemDescription', 'plannedCargo', 'actualCargo',
            ]),
        }));
}

function mapTrackingLogs(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'trackingLog')
        .map(doc => ({
            ...mapCommon(doc),
            ref_type: toText(doc.refType),
            ref_ref: toText(doc.refRef),
            status: toText(doc.status),
            note: toText(doc.note),
            location_text: toText(doc.locationText),
            timestamp: toTimestamp(doc.timestamp),
            user_ref: resolveSeedUserRef(docs, doc.userRef),
            user_name: toText(doc.userName),
            latitude: toNumber(doc.latitude),
            longitude: toNumber(doc.longitude),
            accuracy_m: toNumber(doc.accuracyM),
            speed_kph: toNumber(doc.speedKph),
            source: toText(doc.source),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'refType', 'refRef', 'status', 'note', 'locationText',
                'timestamp', 'userRef', 'userName', 'latitude', 'longitude',
                'accuracyM', 'speedKph', 'source',
            ]),
        }));
}

function mapDriverScores(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'driverScore')
        .map(doc => ({
            ...mapCommon(doc),
            driver_ref: toText(doc.driverRef),
            driver_name: toText(doc.driverName),
            score_type: toText(doc.scoreType),
            effective_date: toText(doc.effectiveDate),
            duration_days: toNumber(doc.durationDays),
            due_date: toText(doc.dueDate),
            notes: toText(doc.notes),
            warning_acknowledged_at: toTimestamp(doc.warningAcknowledgedAt),
            warning_acknowledged_by_driver_ref: toText(doc.warningAcknowledgedByDriverRef),
            created_at_business: toTimestamp(doc.createdAt),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'driverRef', 'driverName', 'scoreType', 'effectiveDate',
                'durationDays', 'dueDate', 'notes', 'warningAcknowledgedAt',
                'warningAcknowledgedByDriverRef', 'createdAt',
            ]),
        }));
}

function mapInvoices(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'invoice')
        .map(doc => ({
            ...mapCommon(doc),
            invoice_number: toText(doc.invoiceNumber),
            mode: toText(doc.mode),
            order_ref: toText(doc.orderRef),
            do_ref: toText(doc.doRef),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            master_resi: toText(doc.masterResi),
            issue_date: toText(doc.issueDate),
            due_date: toText(doc.dueDate),
            status: toText(doc.status),
            total_amount: toNumber(doc.totalAmount) ?? 0,
            total_adjustment_amount: toNumber(doc.totalAdjustmentAmount),
            pph23_enabled: typeof doc.pph23Enabled === 'boolean' ? doc.pph23Enabled : null,
            pph23_rate_percent: toNumber(doc.pph23RatePercent),
            pph23_base_mode: toText(doc.pph23BaseMode),
            pph23_base_amount: toNumber(doc.pph23BaseAmount),
            pph23_amount: toNumber(doc.pph23Amount),
            net_amount: toNumber(doc.netAmount),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt', 'invoiceNumber', 'mode',
                'orderRef', 'doRef', 'customerRef', 'customerName', 'masterResi',
                'issueDate', 'dueDate', 'status', 'totalAmount', 'totalAdjustmentAmount',
                'pph23Enabled', 'pph23RatePercent', 'pph23BaseMode', 'pph23BaseAmount',
                'pph23Amount', 'netAmount', 'notes',
            ]),
        }));
}

function mapInvoiceItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'invoiceItem')
        .map(doc => ({
            ...mapCommon(doc),
            invoice_ref: toText(doc.invoiceRef),
            description: toText(doc.description),
            qty: toNumber(doc.qty),
            price: toNumber(doc.price) ?? 0,
            subtotal: toNumber(doc.subtotal) ?? 0,
            extra_data: omitKeys(doc, ['_id', '_type', '_createdAt', '_updatedAt', 'invoiceRef', 'description', 'qty', 'price', 'subtotal']),
        }));
}

function mapFreightNotas(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'freightNota')
        .map(doc => ({
            ...mapCommon(doc),
            nota_number: toText(doc.notaNumber),
            nota_display_number: toText(doc.notaDisplayNumber),
            issuer_company_name: toText(doc.issuerCompanyName),
            issuer_company_address: toText(doc.issuerCompanyAddress),
            issuer_company_phone: toText(doc.issuerCompanyPhone),
            issuer_company_email: toText(doc.issuerCompanyEmail),
            issuer_company_logo_url: toText(doc.issuerCompanyLogoUrl),
            issuer_company_signature_stamp_url: toText(doc.issuerCompanySignatureStampUrl),
            issuer_company_signature_name: toText(doc.issuerCompanySignatureName),
            issuer_company_npwp: toText(doc.issuerCompanyNpwp),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            customer_address: toText(doc.customerAddress),
            customer_contact_person: toText(doc.customerContactPerson),
            customer_phone: toText(doc.customerPhone),
            issue_date: toText(doc.issueDate),
            due_date: toText(doc.dueDate),
            status: toText(doc.status),
            total_amount: toNumber(doc.totalAmount) ?? 0,
            total_adjustment_amount: toNumber(doc.totalAdjustmentAmount),
            pph23_enabled: typeof doc.pph23Enabled === 'boolean' ? doc.pph23Enabled : null,
            pph23_rate_percent: toNumber(doc.pph23RatePercent),
            pph23_base_mode: toText(doc.pph23BaseMode),
            pph23_base_amount: toNumber(doc.pph23BaseAmount),
            pph23_amount: toNumber(doc.pph23Amount),
            net_amount: toNumber(doc.netAmount),
            total_paid_effective: toNumber(doc.totalPaidEffective),
            refunded_overpayment_amount: toNumber(doc.refundedOverpaymentAmount),
            open_overpayment_amount: toNumber(doc.openOverpaymentAmount),
            total_collie: toNumber(doc.totalCollie) ?? 0,
            total_weight_kg: toNumber(doc.totalWeightKg) ?? 0,
            total_volume_m3: toNumber(doc.totalVolumeM3),
            billing_mode: toText(doc.billingMode),
            bank_account_ref: toText(doc.bankAccountRef),
            instruction_accounts: doc.instructionAccounts ?? [],
            footer_note: toText(doc.footerNote),
            notes: toText(doc.notes),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt', 'notaNumber', 'notaDisplayNumber',
                'issuerCompanyName', 'issuerCompanyAddress', 'issuerCompanyPhone', 'issuerCompanyEmail',
                'issuerCompanyLogoUrl', 'issuerCompanySignatureStampUrl', 'issuerCompanySignatureName', 'issuerCompanyNpwp',
                'customerRef', 'customerName', 'customerAddress', 'customerContactPerson', 'customerPhone',
                'issueDate', 'dueDate', 'status', 'totalAmount', 'totalAdjustmentAmount', 'pph23Enabled',
                'pph23RatePercent', 'pph23BaseMode', 'pph23BaseAmount', 'pph23Amount', 'netAmount',
                'totalPaidEffective', 'refundedOverpaymentAmount', 'openOverpaymentAmount', 'totalCollie',
                'totalWeightKg', 'totalVolumeM3', 'billingMode', 'bankAccountRef', 'instructionAccounts', 'footerNote', 'notes',
            ]),
        }));
}

function mapFreightNotaItems(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'freightNotaItem')
        .map(doc => ({
            ...mapCommon(doc),
            nota_ref: toText(doc.notaRef),
            do_ref: toText(doc.doRef),
            delivery_order_item_ref: toText(doc.deliveryOrderItemRef),
            delivery_order_item_refs: Array.isArray(doc.deliveryOrderItemRefs) ? doc.deliveryOrderItemRefs : [],
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            do_number: toText(doc.doNumber),
            vehicle_plate: toText(doc.vehiclePlate),
            date: toText(doc.date),
            no_sj: toText(doc.noSJ),
            dari: toText(doc.dari),
            tujuan: toText(doc.tujuan),
            barang: toText(doc.barang),
            collie: toNumber(doc.collie),
            berat_kg: toNumber(doc.beratKg) ?? 0,
            volume_m3: toNumber(doc.volumeM3),
            tarip: toNumber(doc.tarip) ?? 0,
            uang_rp: toNumber(doc.uangRp) ?? 0,
            ket: toText(doc.ket),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt', 'notaRef', 'doRef', 'deliveryOrderItemRef',
                'deliveryOrderItemRefs', 'customerRef', 'customerName',
                'doNumber', 'vehiclePlate', 'date', 'noSJ', 'dari', 'tujuan', 'barang', 'collie',
                'beratKg', 'volumeM3', 'tarip', 'uangRp', 'ket',
            ]),
        }));
}

function mapPayments(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'payment')
        .map(doc => ({
            ...mapCommon(doc),
            invoice_ref: toText(doc.invoiceRef),
            receipt_ref: toText(doc.receiptRef),
            receipt_number: toText(doc.receiptNumber),
            bank_account_ref: toText(doc.bankAccountRef),
            bank_account_name: toText(doc.bankAccountName),
            bank_account_number: toText(doc.bankAccountNumber),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            method: toText(doc.method),
            note: toText(doc.note),
            attachment_url: toText(doc.attachmentUrl),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt', 'invoiceRef', 'receiptRef',
                'receiptNumber', 'bankAccountRef', 'bankAccountName', 'bankAccountNumber',
                'date', 'amount', 'method', 'note', 'attachmentUrl',
            ]),
        }));
}

function mapCustomerReceipts(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'customerReceipt')
        .map(doc => ({
            ...mapCommon(doc),
            receipt_number: toText(doc.receiptNumber),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            date: toText(doc.date),
            total_amount: toNumber(doc.totalAmount) ?? 0,
            allocated_amount: toNumber(doc.allocatedAmount),
            unapplied_amount: toNumber(doc.unappliedAmount),
            refunded_overpayment_amount: toNumber(doc.refundedOverpaymentAmount),
            open_overpayment_amount: toNumber(doc.openOverpaymentAmount),
            overpayment_status: toText(doc.overpaymentStatus),
            allocation_count: toNumber(doc.allocationCount) ?? 0,
            method: toText(doc.method),
            bank_account_ref: toText(doc.bankAccountRef),
            bank_account_name: toText(doc.bankAccountName),
            bank_account_number: toText(doc.bankAccountNumber),
            note: toText(doc.note),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt', 'receiptNumber', 'customerRef',
                'customerName', 'date', 'totalAmount', 'allocatedAmount', 'unappliedAmount',
                'refundedOverpaymentAmount', 'openOverpaymentAmount', 'overpaymentStatus',
                'allocationCount', 'method', 'bankAccountRef', 'bankAccountName', 'bankAccountNumber', 'note',
            ]),
        }));
}

function mapInvoiceAdjustments(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'invoiceAdjustment')
        .map(doc => ({
            ...mapCommon(doc),
            invoice_ref: toText(doc.invoiceRef),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            kind: toText(doc.kind),
            status: toText(doc.status),
            note: toText(doc.note),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            edited_at: toTimestamp(doc.editedAt),
            edited_by: toText(doc.editedBy),
            edited_by_name: toText(doc.editedByName),
            voided_at: toTimestamp(doc.voidedAt),
            voided_by: resolveSeedUserRef(docs, doc.voidedBy),
            voided_by_name: toText(doc.voidedByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt', 'invoiceRef', 'customerRef',
                'customerName', 'date', 'amount', 'kind', 'status', 'note', 'createdBy',
                'createdByName', 'editedAt', 'editedBy', 'editedByName', 'voidedAt',
                'voidedBy', 'voidedByName',
            ]),
        }));
}

function mapCustomerOverpaymentRefunds(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'customerOverpaymentRefund')
        .map(doc => ({
            ...mapCommon(doc),
            source_type: toText(doc.sourceType),
            source_receipt_ref: toText(doc.sourceReceiptRef),
            source_receipt_number: toText(doc.sourceReceiptNumber),
            source_invoice_ref: toText(doc.sourceInvoiceRef),
            source_invoice_number: toText(doc.sourceInvoiceNumber),
            customer_ref: toText(doc.customerRef),
            customer_name: toText(doc.customerName),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            bank_account_ref: toText(doc.bankAccountRef),
            bank_account_name: toText(doc.bankAccountName),
            bank_account_number: toText(doc.bankAccountNumber),
            bank_transaction_ref: toText(doc.bankTransactionRef),
            note: toText(doc.note),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt', 'sourceType', 'sourceReceiptRef',
                'sourceReceiptNumber', 'sourceInvoiceRef', 'sourceInvoiceNumber', 'customerRef',
                'customerName', 'date', 'amount', 'bankAccountRef', 'bankAccountName',
                'bankAccountNumber', 'bankTransactionRef', 'note', 'createdBy', 'createdByName',
            ]),
        }));
}

function mapIncomes(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'income')
        .map(doc => ({
            ...mapCommon(doc),
            source_type: toText(doc.sourceType),
            payment_ref: toText(doc.paymentRef),
            receipt_ref: toText(doc.receiptRef),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            note: toText(doc.note),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'sourceType', 'paymentRef', 'receiptRef', 'date', 'amount', 'note',
            ]),
        }));
}

function mapMaintenances(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'maintenance')
        .map(doc => ({
            ...mapCommon(doc),
            vehicle_ref: toText(doc.vehicleRef),
            vehicle_plate: toText(doc.vehiclePlate),
            type: toText(doc.type),
            schedule_type: toText(doc.scheduleType),
            planned_date: toText(doc.plannedDate),
            planned_odometer: toNumber(doc.plannedOdometer),
            status: toText(doc.status),
            completed_date: toText(doc.completedDate),
            odometer_at_service: toNumber(doc.odometerAtService),
            vendor: toText(doc.vendor),
            notes: toText(doc.notes),
            completion_notes: toText(doc.completionNotes),
            attachment_urls: doc.attachmentUrls ?? [],
            material_usages: doc.materialUsages ?? [],
            material_usage_count: toNumber(doc.materialUsageCount),
            material_cost_total: toNumber(doc.materialCostTotal),
            total_cost: toNumber(doc.totalCost),
            related_expense_ref: toText(doc.relatedExpenseRef),
            cost: toNumber(doc.cost),
            source: toText(doc.source),
            related_delivery_order_ref: toText(doc.relatedDeliveryOrderRef),
            trigger_odometer: toNumber(doc.triggerOdometer),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'vehicleRef', 'vehiclePlate', 'type', 'scheduleType', 'plannedDate',
                'plannedOdometer', 'status', 'completedDate', 'odometerAtService', 'vendor',
                'notes', 'completionNotes', 'attachmentUrls', 'materialUsages', 'materialUsageCount',
                'materialCostTotal', 'totalCost', 'relatedExpenseRef', 'cost',
                'source', 'relatedDeliveryOrderRef', 'triggerOdometer',
            ]),
        }));
}

function mapIncidents(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'incident')
        .map(doc => ({
            ...mapCommon(doc),
            incident_number: toText(doc.incidentNumber),
            issuer_company_name: toText(doc.issuerCompanyName),
            issuer_company_address: toText(doc.issuerCompanyAddress),
            issuer_company_phone: toText(doc.issuerCompanyPhone),
            issuer_company_email: toText(doc.issuerCompanyEmail),
            issuer_company_logo_url: toText(doc.issuerCompanyLogoUrl),
            date_time: toTimestamp(doc.dateTime),
            vehicle_ref: toText(doc.vehicleRef),
            vehicle_plate: toText(doc.vehiclePlate),
            driver_ref: toText(doc.driverRef),
            driver_name: toText(doc.driverName),
            related_delivery_order_ref: toText(doc.relatedDeliveryOrderRef),
            related_do_number: toText(doc.relatedDONumber),
            incident_type: toText(doc.incidentType),
            urgency: toText(doc.urgency),
            location_text: toText(doc.locationText),
            odometer: toNumber(doc.odometer) ?? 0,
            description: toText(doc.description),
            status: toText(doc.status),
            attachment_urls: doc.attachmentUrls ?? [],
            assigned_to_user_ref: resolveSeedUserRef(docs, doc.assignedToUserRef),
            assigned_to_user_name: toText(doc.assignedToUserName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'incidentNumber', 'issuerCompanyName', 'issuerCompanyAddress', 'issuerCompanyPhone',
                'issuerCompanyEmail', 'issuerCompanyLogoUrl', 'dateTime', 'vehicleRef', 'vehiclePlate',
                'driverRef', 'driverName', 'relatedDeliveryOrderRef', 'relatedDONumber', 'incidentType',
                'urgency', 'locationText', 'odometer', 'description', 'status', 'attachmentUrls',
                'assignedToUserRef', 'assignedToUserName',
            ]),
        }));
}

function mapIncidentActionLogs(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'incidentActionLog')
        .map(doc => ({
            ...mapCommon(doc),
            incident_ref: toText(doc.incidentRef),
            timestamp: toTimestamp(doc.timestamp),
            note: toText(doc.note),
            user_ref: resolveSeedUserRef(docs, doc.userRef),
            user_name: toText(doc.userName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'incidentRef', 'timestamp', 'note', 'userRef', 'userName',
            ]),
        }));
}

function mapIncidentSettlementLines(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'incidentSettlementLine')
        .map(doc => ({
            ...mapCommon(doc),
            incident_ref: toText(doc.incidentRef),
            incident_number: toText(doc.incidentNumber),
            line_type: toText(doc.lineType),
            category: toText(doc.category),
            date: toText(doc.date),
            amount: toNumber(doc.amount) ?? 0,
            description: toText(doc.description),
            payee_name: toText(doc.payeeName),
            recipient_type: toText(doc.recipientType),
            note: toText(doc.note),
            status: toText(doc.status),
            linked_expense_ref: toText(doc.linkedExpenseRef),
            linked_expense_date: toText(doc.linkedExpenseDate),
            linked_expense_amount: toNumber(doc.linkedExpenseAmount),
            linked_expense_category_ref: toText(doc.linkedExpenseCategoryRef),
            linked_expense_category_name: toText(doc.linkedExpenseCategoryName),
            posted_at: toTimestamp(doc.postedAt),
            posted_by: resolveSeedUserRef(docs, doc.postedBy),
            posted_by_name: toText(doc.postedByName),
            created_at_business: toTimestamp(doc.createdAt),
            created_by: resolveSeedUserRef(docs, doc.createdBy),
            created_by_name: toText(doc.createdByName),
            updated_at_business: toTimestamp(doc.updatedAt),
            updated_by: resolveSeedUserRef(docs, doc.updatedBy),
            updated_by_name: toText(doc.updatedByName),
            voided_at: toTimestamp(doc.voidedAt),
            voided_by: resolveSeedUserRef(docs, doc.voidedBy),
            voided_by_name: toText(doc.voidedByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'incidentRef', 'incidentNumber', 'lineType', 'category', 'date', 'amount',
                'description', 'payeeName', 'recipientType', 'note', 'status',
                'linkedExpenseRef', 'linkedExpenseDate', 'linkedExpenseAmount',
                'linkedExpenseCategoryRef', 'linkedExpenseCategoryName',
                'postedAt', 'postedBy', 'postedByName',
                'createdAt', 'createdBy', 'createdByName',
                'updatedAt', 'updatedBy', 'updatedByName',
                'voidedAt', 'voidedBy', 'voidedByName',
            ]),
        }));
}

function mapChartOfAccounts(docs: SeedDoc[]) {
    const defaults = DEFAULT_CHART_OF_ACCOUNTS.map(definition =>
        buildDefaultChartOfAccountDocument(definition) as unknown as SeedDoc
    );
    const explicitDocs = docs.filter(doc => doc._type === 'chartOfAccount');
    const merged = new Map<string, SeedDoc>();
    [...defaults, ...explicitDocs].forEach(doc => merged.set(doc._id, doc));

    return [...merged.values()].map(doc => ({
        ...mapCommon(doc),
        code: toText(doc.code),
        name: toText(doc.name),
        account_type: toText(doc.accountType),
        normal_balance: toText(doc.normalBalance),
        system_key: toText(doc.systemKey),
        parent_ref: toText(doc.parentRef),
        active: toBoolean(doc.active, true),
        description: toText(doc.description),
        extra_data: omitKeys(doc, [
            '_id', '_type', '_createdAt', '_updatedAt',
            'code', 'name', 'accountType', 'normalBalance', 'systemKey',
            'parentRef', 'active', 'description',
        ]),
    }));
}

function mapAccountingPeriods(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'accountingPeriod')
        .map(doc => ({
            ...mapCommon(doc),
            period: toText(doc.period),
            start_date: toText(doc.startDate),
            end_date: toText(doc.endDate),
            status: toText(doc.status) || 'OPEN',
            closed_at: toTimestamp(doc.closedAt),
            closed_by: resolveSeedUserRef(docs, doc.closedBy),
            closed_by_name: toText(doc.closedByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'period', 'startDate', 'endDate', 'status', 'closedAt',
                'closedBy', 'closedByName',
            ]),
        }));
}

function mapJournalEntries(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'journalEntry')
        .map(doc => ({
            ...mapCommon(doc),
            entry_number: toText(doc.entryNumber),
            entry_date: toText(doc.entryDate),
            memo: toText(doc.memo),
            source_type: toText(doc.sourceType),
            source_ref: toText(doc.sourceRef),
            source_event: toText(doc.sourceEvent),
            source_number: toText(doc.sourceNumber),
            source_label: toText(doc.sourceLabel),
            status: toText(doc.status) || 'POSTED',
            total_debit: toNumber(doc.totalDebit) ?? 0,
            total_credit: toNumber(doc.totalCredit) ?? 0,
            posted_at: toTimestamp(doc.postedAt),
            posted_by: resolveSeedUserRef(docs, doc.postedBy),
            posted_by_name: toText(doc.postedByName),
            voided_at: toTimestamp(doc.voidedAt),
            voided_by: resolveSeedUserRef(docs, doc.voidedBy),
            voided_by_name: toText(doc.voidedByName),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'entryNumber', 'entryDate', 'memo', 'sourceType', 'sourceRef',
                'sourceEvent', 'sourceNumber', 'sourceLabel', 'status',
                'totalDebit', 'totalCredit', 'postedAt', 'postedBy', 'postedByName',
                'voidedAt', 'voidedBy', 'voidedByName',
            ]),
        }));
}

function mapJournalLines(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'journalLine')
        .map(doc => ({
            ...mapCommon(doc),
            journal_entry_ref: toText(doc.journalEntryRef),
            line_number: toNumber(doc.lineNumber) ?? 0,
            account_ref: toText(doc.accountRef),
            account_code: toText(doc.accountCode),
            account_name: toText(doc.accountName),
            account_type: toText(doc.accountType),
            debit: toNumber(doc.debit) ?? 0,
            credit: toNumber(doc.credit) ?? 0,
            memo: toText(doc.memo),
            entity_ref: toText(doc.entityRef),
            entity_type: toText(doc.entityType),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'journalEntryRef', 'lineNumber', 'accountRef', 'accountCode',
                'accountName', 'accountType', 'debit', 'credit', 'memo',
                'entityRef', 'entityType',
            ]),
        }));
}

function mapAuditLogs(docs: SeedDoc[]) {
    return docs
        .filter(doc => doc._type === 'auditLog')
        .map(doc => ({
            ...mapCommon(doc),
            actor_user_ref: resolveSeedUserRef(docs, doc.actorUserRef),
            actor_user_name: toText(doc.actorUserName),
            actor_user_email: toText(doc.actorUserEmail),
            actor_user_role: toText(doc.actorUserRole),
            action: toText(doc.action),
            entity_type: toText(doc.entityType),
            entity_ref: toText(doc.entityRef),
            changes_summary: toText(doc.changesSummary),
            timestamp: toTimestamp(doc.timestamp),
            extra_data: omitKeys(doc, [
                '_id', '_type', '_createdAt', '_updatedAt',
                'actorUserRef', 'actorUserName', 'actorUserEmail', 'actorUserRole',
                'action', 'entityType', 'entityRef', 'changesSummary', 'timestamp',
            ]),
        }));
}

function buildRelationalPayloads(docs: SeedDoc[]) {
    return {
        company_profiles: mapCompanyProfiles(docs),
        employees: mapEmployees(docs),
        employee_attendance_records: mapEmployeeAttendanceRecords(docs),
        expense_categories: mapExpenseCategories(docs),
        drivers: mapDrivers(docs),
        driver_vouchers: mapDriverVouchers(docs),
        driver_voucher_disbursements: mapDriverVoucherDisbursements(docs),
        driver_voucher_items: mapDriverVoucherItems(docs),
        driver_borongans: mapDriverBorongans(docs),
        driver_borongan_items: mapDriverBoronganItems(docs),
        customers: mapCustomers(docs),
        suppliers: mapSuppliers(docs),
        warehouse_items: mapWarehouseItems(docs),
        supplier_item_prices: mapSupplierItemPrices(docs),
        tire_events: mapTireEvents(docs),
        tire_history_logs: mapTireHistoryLogs(docs),
        customer_products: mapCustomerProducts(docs),
        customer_billing_rates: mapCustomerBillingRates(docs),
        customer_recipients: mapCustomerRecipients(docs),
        customer_pickup_locations: mapCustomerPickupLocations(docs),
        services: mapServices(docs),
        trip_route_rates: mapTripRouteRates(docs),
        vehicles: mapVehicles(docs),
        app_users: mapUsers(docs),
        bank_accounts: mapBankAccounts(docs),
        bank_transactions: mapBankTransactions(docs),
        chart_of_accounts: mapChartOfAccounts(docs),
        accounting_periods: mapAccountingPeriods(docs),
        journal_entries: mapJournalEntries(docs),
        journal_lines: mapJournalLines(docs),
        expenses: mapExpenses(docs),
        purchases: mapPurchases(docs),
        purchase_items: mapPurchaseItems(docs),
        purchase_payments: mapPurchasePayments(docs),
        stock_movements: mapStockMovements(docs),
        orders: mapOrders(docs),
        order_items: mapOrderItems(docs),
        delivery_orders: mapDeliveryOrders(docs),
        delivery_order_items: mapDeliveryOrderItems(docs),
        trips: mapTrips(docs),
        surat_jalan_documents: mapSuratJalanDocuments(docs),
        surat_jalan_items: mapSuratJalanItems(docs),
        tracking_logs: mapTrackingLogs(docs),
        driver_scores: mapDriverScores(docs),
        invoices: mapInvoices(docs),
        invoice_items: mapInvoiceItems(docs),
        freight_notas: mapFreightNotas(docs),
        freight_nota_items: mapFreightNotaItems(docs),
        payments: mapPayments(docs),
        customer_receipts: mapCustomerReceipts(docs),
        invoice_adjustments: mapInvoiceAdjustments(docs),
        customer_overpayment_refunds: mapCustomerOverpaymentRefunds(docs),
        incomes: mapIncomes(docs),
        maintenances: mapMaintenances(docs),
        incidents: mapIncidents(docs),
        incident_settlement_lines: mapIncidentSettlementLines(docs),
        incident_action_logs: mapIncidentActionLogs(docs),
        audit_logs: mapAuditLogs(docs),
    };
}

export async function seedRelationalTables(supabaseRequest: SupabaseRequestFn, docs: SeedDoc[]) {
    const payloads = buildRelationalPayloads(docs);
    const batchSize = 250;

    for (const table of RELATIONAL_SEED_ORDER) {
        const rows = payloads[table];
        if (!rows || rows.length === 0) {
            continue;
        }

        for (let index = 0; index < rows.length; index += batchSize) {
            const batch = rows.slice(index, index + batchSize);
            try {
                await supabaseRequest(`${table}?on_conflict=source_document_id`, {
                    method: 'POST',
                    headers: {
                        Prefer: 'resolution=merge-duplicates,return=minimal',
                    },
                    body: JSON.stringify(batch),
                });
            } catch (error) {
                if (isMissingSupabaseTableError(error)) {
                    console.warn(`Skipping relational seed for ${table}: table not found`);
                    break;
                }
                throw error;
            }
        }
    }
}

export function summarizeUnsupportedSeedDocTypes(docs: SeedDoc[]) {
    const supported = new Set<string>(RELATIONAL_SUPPORTED_DOC_TYPES);
    const counts = new Map<string, number>();

    for (const doc of docs) {
        if (supported.has(doc._type)) continue;
        counts.set(doc._type, (counts.get(doc._type) || 0) + 1);
    }

    return [...counts.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([type, count]) => ({ type, count }));
}
