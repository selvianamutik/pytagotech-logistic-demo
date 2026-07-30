import { randomUUID } from 'node:crypto';

import { getSupabaseClient } from './supabase';

type SupportedDocType =
    | 'companyProfile'
    | 'employee'
    | 'employeeAttendanceRecord'
    | 'expenseCategory'
    | 'user'
    | 'driver'
    | 'driverVoucher'
    | 'driverVoucherDisbursement'
    | 'driverVoucherItem'
    | 'driverBorongan'
    | 'driverBoronganItem'
    | 'driverScore'
    | 'auditLog'
    | 'customer'
    | 'supplier'
    | 'supplierItemPrice'
    | 'warehouseItem'
    | 'tireEvent'
    | 'tireHistoryLog'
    | 'customerProduct'
    | 'customerBillingRate'
    | 'customerRecipient'
    | 'customerPickupLocation'
    | 'service'
    | 'tripRouteRate'
    | 'vehicle'
    | 'bankAccount'
    | 'bankTransaction'
    | 'expense'
    | 'chartOfAccount'
    | 'journalEntry'
    | 'journalLine'
    | 'accountingPeriod'
    | 'purchase'
    | 'purchaseItem'
    | 'purchasePayment'
    | 'stockMovement'
    | 'order'
    | 'orderItem'
    | 'deliveryOrder'
    | 'deliveryOrderItem'
    | 'trip'
    | 'suratJalan'
    | 'suratJalanItem'
    | 'trackingLog'
    | 'invoice'
    | 'invoiceItem'
    | 'freightNota'
    | 'freightNotaItem'
    | 'payment'
    | 'customerReceipt'
    | 'invoiceAdjustment'
    | 'customerOverpaymentRefund'
    | 'income'
    | 'maintenance'
    | 'incident'
    | 'incidentSettlementLine'
    | 'incidentActionLog';

type RelationalListOptions = {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortPreset?: string | null;
    countStrategy?: 'exact' | 'planned' | 'estimated' | 'none';
};

type RelationalListResult<T> = {
    items: T[];
    total: number;
};

type RelationalMutationOptions = {
    skipReadCacheClear?: boolean;
};

function clearRelationalReadCacheUnlessSkipped(options?: RelationalMutationOptions) {
    if (!options?.skipReadCacheClear) {
        clearRelationalReadCache();
    }
}

type RelationalConfig = {
    table: string;
    fieldMap: Record<string, string>;
};

type RelationalRow = Record<string, unknown> & {
    source_document_id: string;
    extra_data?: Record<string, unknown> | null;
    document_created_at?: string | null;
    document_updated_at?: string | null;
};

type FetchRowsResult = {
    rows: RelationalRow[];
    total: number | null;
};

const META_FIELDS = new Set(['_id', '_type', '_createdAt', '_updatedAt', '_rev']);
const FETCH_BATCH_SIZE = 1000;
const RELATIONAL_READ_CACHE_TTL_MS = Math.max(
    0,
    Number.parseInt(process.env.RELATIONAL_READ_CACHE_TTL_MS || '10000', 10) || 10000
);
const RELATIONAL_READ_CACHE_MAX_ENTRIES = 300;

type RelationalReadCacheEntry = FetchRowsResult & {
    expiresAt: number;
};

const relationalReadCache = new Map<string, RelationalReadCacheEntry>();
const relationalInFlightReads = new Map<string, Promise<FetchRowsResult>>();
let relationalReadCacheVersion = 0;

const RELATIONAL_CONFIG: Record<SupportedDocType, RelationalConfig> = {
    companyProfile: {
        table: 'company_profiles',
        fieldMap: {
            name: 'name',
            address: 'address',
            phone: 'phone',
            email: 'email',
            npwp: 'npwp',
            bankName: 'bank_name',
            bankAccount: 'bank_account',
            bankHolder: 'bank_holder',
            themeColor: 'theme_color',
            numberingSettings: 'numbering_settings',
            invoiceSettings: 'invoice_settings',
            documentSettings: 'document_settings',
        },
    },
    employee: {
        table: 'employees',
        fieldMap: {
            employeeCode: 'employee_code',
            name: 'name',
            phone: 'phone',
            position: 'position',
            division: 'division',
            joinDate: 'join_date',
            active: 'active',
            userRef: 'user_ref',
            userName: 'user_name',
            notes: 'notes',
        },
    },
    employeeAttendanceRecord: {
        table: 'employee_attendance_records',
        fieldMap: {
            employeeRef: 'employee_ref',
            employeeCode: 'employee_code',
            employeeName: 'employee_name',
            position: 'position',
            division: 'division',
            date: 'date',
            status: 'status',
            checkInTime: 'check_in_time',
            checkOutTime: 'check_out_time',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            updatedBy: 'updated_by',
            updatedByName: 'updated_by_name',
            createdAt: 'created_at_business',
            updatedAt: 'updated_at_business',
        },
    },
    expenseCategory: {
        table: 'expense_categories',
        fieldMap: {
            name: 'name',
            active: 'active',
        },
    },
    driverVoucher: {
        table: 'driver_vouchers',
        fieldMap: {
            bonNumber: 'bon_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            deliveryOrderRef: 'delivery_order_ref',
            doNumber: 'do_number',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            route: 'route',
            issuedDate: 'issued_date',
            cashGiven: 'cash_given',
            initialCashGiven: 'initial_cash_given',
            totalIssuedAmount: 'total_issued_amount',
            topUpCount: 'top_up_count',
            driverFeeAmount: 'driver_fee_amount',
            totalClaimAmount: 'total_claim_amount',
            issueBankRef: 'issue_bank_ref',
            issueBankName: 'issue_bank_name',
            totalSpent: 'total_spent',
            balance: 'balance',
            status: 'status',
            notes: 'notes',
            settledDate: 'settled_date',
            settledBy: 'settled_by',
            settlementBankRef: 'settlement_bank_ref',
            settlementBankName: 'settlement_bank_name',
        },
    },
    driverVoucherDisbursement: {
        table: 'driver_voucher_disbursements',
        fieldMap: {
            voucherRef: 'voucher_ref',
            date: 'date',
            amount: 'amount',
            kind: 'kind',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            bankTransactionRef: 'bank_transaction_ref',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    driverVoucherItem: {
        table: 'driver_voucher_items',
        fieldMap: {
            voucherRef: 'voucher_ref',
            expenseDate: 'expense_date',
            category: 'category',
            description: 'description',
            amount: 'amount',
        },
    },
    driverBorongan: {
        table: 'driver_borongans',
        fieldMap: {
            boronganNumber: 'borongan_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            periodStart: 'period_start',
            periodEnd: 'period_end',
            status: 'status',
            totalAmount: 'total_amount',
            totalCollie: 'total_collie',
            totalWeightKg: 'total_weight_kg',
            notes: 'notes',
            paidDate: 'paid_date',
            paidMethod: 'paid_method',
            paidBankRef: 'paid_bank_ref',
            paidBankName: 'paid_bank_name',
            paidBankNumber: 'paid_bank_number',
        },
    },
    driverBoronganItem: {
        table: 'driver_borongan_items',
        fieldMap: {
            boronganRef: 'borongan_ref',
            doRef: 'do_ref',
            doNumber: 'do_number',
            vehiclePlate: 'vehicle_plate',
            date: 'date',
            noSJ: 'no_sj',
            tujuan: 'tujuan',
            barang: 'barang',
            collie: 'collie',
            beratKg: 'berat_kg',
            tarip: 'tarip',
            uangRp: 'uang_rp',
            ket: 'ket',
        },
    },
    supplier: {
        table: 'suppliers',
        fieldMap: {
            supplierCode: 'supplier_code',
            name: 'name',
            contactPerson: 'contact_person',
            phone: 'phone',
            address: 'address',
            defaultTermDays: 'default_term_days',
            active: 'active',
            notes: 'notes',
        },
    },
    supplierItemPrice: {
        table: 'supplier_item_prices',
        fieldMap: {
            supplierRef: 'supplier_ref',
            supplierCode: 'supplier_code',
            supplierName: 'supplier_name',
            warehouseItemRef: 'warehouse_item_ref',
            itemCode: 'item_code',
            itemName: 'item_name',
            itemUnit: 'item_unit',
            supplierSku: 'supplier_sku',
            supplierItemName: 'supplier_item_name',
            defaultPurchasePrice: 'default_purchase_price',
            minOrderQty: 'min_order_qty',
            leadTimeDays: 'lead_time_days',
            effectiveFrom: 'effective_from',
            effectiveTo: 'effective_to',
            active: 'active',
            notes: 'notes',
            createdAt: 'created_at_business',
            updatedAt: 'updated_at_business',
        },
    },
    warehouseItem: {
        table: 'warehouse_items',
        fieldMap: {
            itemCode: 'item_code',
            name: 'name',
            category: 'category',
            unit: 'unit',
            trackingMode: 'tracking_mode',
            minStockQty: 'min_stock_qty',
            currentStockQty: 'current_stock_qty',
            defaultSupplierRef: 'default_supplier_ref',
            defaultSupplierName: 'default_supplier_name',
            defaultPurchasePrice: 'default_purchase_price',
            tireTypeDefault: 'tire_type_default',
            tireBrandDefault: 'tire_brand_default',
            tireSizeDefault: 'tire_size_default',
            active: 'active',
            notes: 'notes',
        },
    },
    tireEvent: {
        table: 'tire_events',
        fieldMap: {
            tireCode: 'tire_code',
            holderType: 'holder_type',
            status: 'status',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            posisi: 'posisi',
            positionKey: 'position_key',
            slotCode: 'slot_code',
            slotLabel: 'slot_label',
            externalPartyName: 'external_party_name',
            externalPlateNumber: 'external_plate_number',
            tireType: 'tire_type',
            tireBrand: 'tire_brand',
            tireSize: 'tire_size',
            linkedWarehouseItemRef: 'linked_warehouse_item_ref',
            linkedWarehouseItemCode: 'linked_warehouse_item_code',
            linkedWarehouseItemName: 'linked_warehouse_item_name',
            compatibleServiceRef: 'compatible_service_ref',
            compatibleServiceName: 'compatible_service_name',
            sourcePurchaseRef: 'source_purchase_ref',
            sourcePurchaseNumber: 'source_purchase_number',
            sourcePurchaseItemRef: 'source_purchase_item_ref',
            sourceReceiveDate: 'source_receive_date',
            installDate: 'install_date',
            replaceDate: 'replace_date',
            notes: 'notes',
            purchaseCost: 'purchase_cost',
            originalCost: 'original_cost',
            totalUsedPercent: 'total_used_percent',
            remainingPercent: 'remaining_percent',
            remainingValue: 'remaining_value',
            maintenanceCostPostedPercent: 'maintenance_cost_posted_percent',
            maintenanceCostPostedAmount: 'maintenance_cost_posted_amount',
            lastMaintenanceCostRef: 'last_maintenance_cost_ref',
            accumulatedKm: 'accumulated_km',
            lastOdometerKm: 'last_odometer_km',
            lastKmUpdateAt: 'last_km_update_at',
        },
    },
    tireHistoryLog: {
        table: 'tire_history_logs',
        fieldMap: {
            tireEventRef: 'tire_event_ref',
            tireCode: 'tire_code',
            tireBrand: 'tire_brand',
            tireSize: 'tire_size',
            actionType: 'action_type',
            timestamp: 'timestamp',
            actorUserRef: 'actor_user_ref',
            actorUserName: 'actor_user_name',
            note: 'note',
            fromHolderType: 'from_holder_type',
            fromStatus: 'from_status',
            fromVehicleRef: 'from_vehicle_ref',
            fromVehiclePlate: 'from_vehicle_plate',
            fromSlotCode: 'from_slot_code',
            fromPlacementLabel: 'from_placement_label',
            toHolderType: 'to_holder_type',
            toStatus: 'to_status',
            toVehicleRef: 'to_vehicle_ref',
            toVehiclePlate: 'to_vehicle_plate',
            toSlotCode: 'to_slot_code',
            toPlacementLabel: 'to_placement_label',
            odometerBeforeKm: 'odometer_before_km',
            odometerAfterKm: 'odometer_after_km',
            distanceKm: 'distance_km',
            usagePercent: 'usage_percent',
            usageCost: 'usage_cost',
            costAllocationType: 'cost_allocation_type',
            relatedMaintenanceRef: 'related_maintenance_ref',
            costSourceVehicleRef: 'cost_source_vehicle_ref',
            costSourceVehiclePlate: 'cost_source_vehicle_plate',
            remainingPercentAfter: 'remaining_percent_after',
            remainingValueAfter: 'remaining_value_after',
        },
    },
    user: {
        table: 'app_users',
        fieldMap: {
            name: 'name',
            email: 'email',
            role: 'role',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            passwordHash: 'password_hash',
            active: 'active',
            createdAt: 'created_at_business',
            lastLoginAt: 'last_login_at',
        },
    },
    driver: {
        table: 'drivers',
        fieldMap: {
            name: 'name',
            phone: 'phone',
            licenseNumber: 'license_number',
            ktpNumber: 'ktp_number',
            simExpiry: 'sim_expiry',
            address: 'address',
            active: 'active',
            activeTrackingDeliveryOrderRef: 'active_tracking_delivery_order_ref',
            activeTrackingUpdatedAt: 'active_tracking_updated_at',
        },
    },
    driverScore: {
        table: 'driver_scores',
        fieldMap: {
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            scoreType: 'score_type',
            effectiveDate: 'effective_date',
            durationDays: 'duration_days',
            dueDate: 'due_date',
            notes: 'notes',
            warningAcknowledgedAt: 'warning_acknowledged_at',
            warningAcknowledgedByDriverRef: 'warning_acknowledged_by_driver_ref',
            createdAt: 'created_at_business',
        },
    },
    auditLog: {
        table: 'audit_logs',
        fieldMap: {
            actorUserRef: 'actor_user_ref',
            actorUserName: 'actor_user_name',
            actorUserEmail: 'actor_user_email',
            actorUserRole: 'actor_user_role',
            action: 'action',
            entityType: 'entity_type',
            entityRef: 'entity_ref',
            changesSummary: 'changes_summary',
            timestamp: 'timestamp',
        },
    },
    customer: {
        table: 'customers',
        fieldMap: {
            name: 'name',
            address: 'address',
            contactPerson: 'contact_person',
            phone: 'phone',
            email: 'email',
            defaultPaymentTerm: 'default_payment_term',
            npwp: 'npwp',
            active: 'active',
        },
    },
    customerProduct: {
        table: 'customer_products',
        fieldMap: {
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            code: 'code',
            name: 'name',
            description: 'description',
            defaultQtyKoli: 'default_qty_koli',
            defaultWeight: 'default_weight_kg',
            defaultWeightInputValue: 'default_weight_input_value',
            defaultWeightInputUnit: 'default_weight_input_unit',
            defaultVolume: 'default_volume_m3',
            defaultVolumeInputValue: 'default_volume_input_value',
            defaultVolumeInputUnit: 'default_volume_input_unit',
            notes: 'notes',
            active: 'active',
        },
    },
    customerBillingRate: {
        table: 'customer_billing_rates',
        fieldMap: {
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            basis: 'basis',
            rate: 'rate',
            routeFrom: 'route_from',
            routeTo: 'route_to',
            notes: 'notes',
            active: 'active',
        },
    },
    customerRecipient: {
        table: 'customer_recipients',
        fieldMap: {
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            label: 'label',
            receiverName: 'receiver_name',
            receiverPhone: 'receiver_phone',
            receiverAddress: 'receiver_address',
            receiverCompany: 'receiver_company',
            notes: 'notes',
            active: 'active',
            isDefault: 'is_default',
        },
    },
    customerPickupLocation: {
        table: 'customer_pickup_locations',
        fieldMap: {
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            label: 'label',
            pickupAddress: 'pickup_address',
            notes: 'notes',
            active: 'active',
            isDefault: 'is_default',
        },
    },
    service: {
        table: 'services',
        fieldMap: {
            code: 'code',
            name: 'name',
            description: 'description',
            maxPayloadKg: 'max_payload_kg',
            oilMaintenanceKm: 'oil_maintenance_km',
            tireLayoutConfig: 'tire_layout_config',
            active: 'active',
        },
    },
    tripRouteRate: {
        table: 'trip_route_rates',
        fieldMap: {
            originArea: 'origin_area',
            destinationArea: 'destination_area',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            rate: 'rate',
            overtonaseDriverRatePerTon: 'overtonase_driver_rate_per_ton',
            notes: 'notes',
            active: 'active',
        },
    },
    vehicle: {
        table: 'vehicles',
        fieldMap: {
            unitCode: 'unit_code',
            plateNumber: 'plate_number',
            vehicleType: 'vehicle_type',
            brandModel: 'brand_model',
            year: 'year',
            capacityKg: 'capacity_kg',
            capacityVolume: 'capacity_volume_m3',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            tireLayoutConfig: 'tire_layout_config',
            status: 'status',
            lastOdometer: 'last_odometer',
            lastOdometerAt: 'last_odometer_at',
            oilMaintenanceIntervalKm: 'oil_maintenance_interval_km',
            oilLastServiceOdometer: 'oil_last_service_odometer',
            oilNextServiceOdometer: 'oil_next_service_odometer',
            oilServiceRemainingKm: 'oil_service_remaining_km',
            oilMaintenanceStatus: 'oil_maintenance_status',
            lastTripOdometerDeltaKm: 'last_trip_odometer_delta_km',
        },
    },
    bankAccount: {
        table: 'bank_accounts',
        fieldMap: {
            bankName: 'bank_name',
            accountNumber: 'account_number',
            accountHolder: 'account_holder',
            accountType: 'account_type',
            systemKey: 'system_key',
            initialBalance: 'initial_balance',
            currentBalance: 'current_balance',
            active: 'active',
            notes: 'notes',
        },
    },
    bankTransaction: {
        table: 'bank_transactions',
        fieldMap: {
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            type: 'type',
            amount: 'amount',
            date: 'date',
            description: 'description',
            balanceAfter: 'balance_after',
            relatedPaymentRef: 'related_payment_ref',
            relatedReceiptRef: 'related_receipt_ref',
            relatedExpenseRef: 'related_expense_ref',
            relatedTransferRef: 'related_transfer_ref',
            relatedVoucherRef: 'related_voucher_ref',
            relatedOverpaymentRefundRef: 'related_overpayment_refund_ref',
            relatedPurchasePaymentRef: 'related_purchase_payment_ref',
            relatedPurchaseRef: 'related_purchase_ref',
        },
    },
    expense: {
        table: 'expenses',
        fieldMap: {
            categoryRef: 'category_ref',
            categoryName: 'category_name',
            date: 'date',
            amount: 'amount',
            note: 'note',
            description: 'description',
            receiptUrl: 'receipt_url',
            privacyLevel: 'privacy_level',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            relatedVehicleRef: 'related_vehicle_ref',
            relatedVehiclePlate: 'related_vehicle_plate',
            relatedIncidentRef: 'related_incident_ref',
            relatedIncidentSettlementLineRef: 'related_incident_settlement_line_ref',
            relatedMaintenanceRef: 'related_maintenance_ref',
            boronganRef: 'borongan_ref',
            voucherRef: 'voucher_ref',
        },
    },
    chartOfAccount: {
        table: 'chart_of_accounts',
        fieldMap: {
            code: 'code',
            name: 'name',
            accountType: 'account_type',
            normalBalance: 'normal_balance',
            systemKey: 'system_key',
            parentRef: 'parent_ref',
            active: 'active',
            description: 'description',
        },
    },
    journalEntry: {
        table: 'journal_entries',
        fieldMap: {
            entryNumber: 'entry_number',
            entryDate: 'entry_date',
            memo: 'memo',
            sourceType: 'source_type',
            sourceRef: 'source_ref',
            sourceEvent: 'source_event',
            sourceNumber: 'source_number',
            sourceLabel: 'source_label',
            status: 'status',
            totalDebit: 'total_debit',
            totalCredit: 'total_credit',
            postedAt: 'posted_at',
            postedBy: 'posted_by',
            postedByName: 'posted_by_name',
            voidedAt: 'voided_at',
            voidedBy: 'voided_by',
            voidedByName: 'voided_by_name',
        },
    },
    journalLine: {
        table: 'journal_lines',
        fieldMap: {
            journalEntryRef: 'journal_entry_ref',
            lineNumber: 'line_number',
            accountRef: 'account_ref',
            accountCode: 'account_code',
            accountName: 'account_name',
            accountType: 'account_type',
            debit: 'debit',
            credit: 'credit',
            memo: 'memo',
            entityRef: 'entity_ref',
            entityType: 'entity_type',
        },
    },
    accountingPeriod: {
        table: 'accounting_periods',
        fieldMap: {
            period: 'period',
            startDate: 'start_date',
            endDate: 'end_date',
            status: 'status',
            closedAt: 'closed_at',
            closedBy: 'closed_by',
            closedByName: 'closed_by_name',
        },
    },
    purchase: {
        table: 'purchases',
        fieldMap: {
            purchaseNumber: 'purchase_number',
            supplierRef: 'supplier_ref',
            supplierName: 'supplier_name',
            orderDate: 'order_date',
            dueDate: 'due_date',
            status: 'status',
            notes: 'notes',
            totalAmount: 'total_amount',
            totalOrderedQty: 'total_ordered_qty',
            totalReceivedQty: 'total_received_qty',
            paidAmount: 'paid_amount',
            outstandingAmount: 'outstanding_amount',
            lineCount: 'line_count',
            lastReceivedAt: 'last_received_at',
            lastPaidAt: 'last_paid_at',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            createdAt: 'created_at_business',
            updatedAt: 'updated_at_business',
        },
    },
    purchaseItem: {
        table: 'purchase_items',
        fieldMap: {
            purchaseRef: 'purchase_ref',
            warehouseItemRef: 'warehouse_item_ref',
            supplierItemPriceRef: 'supplier_item_price_ref',
            itemCode: 'item_code',
            itemName: 'item_name',
            itemUnit: 'item_unit',
            trackingMode: 'tracking_mode',
            tireTypeDefault: 'tire_type_default',
            tireBrandDefault: 'tire_brand_default',
            tireSizeDefault: 'tire_size_default',
            orderedQty: 'ordered_qty',
            receivedQty: 'received_qty',
            unitPrice: 'unit_price',
            subtotal: 'subtotal',
            priceSource: 'price_source',
            priceEffectiveDate: 'price_effective_date',
            originalUnitPrice: 'original_unit_price',
            priceOverridden: 'price_overridden',
            priceOverrideReason: 'price_override_reason',
            notes: 'notes',
        },
    },
    purchasePayment: {
        table: 'purchase_payments',
        fieldMap: {
            purchaseRef: 'purchase_ref',
            purchaseNumber: 'purchase_number',
            supplierRef: 'supplier_ref',
            supplierName: 'supplier_name',
            date: 'date',
            amount: 'amount',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            bankTransactionRef: 'bank_transaction_ref',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    stockMovement: {
        table: 'stock_movements',
        fieldMap: {
            warehouseItemRef: 'warehouse_item_ref',
            itemCode: 'item_code',
            itemName: 'item_name',
            unit: 'unit',
            movementDate: 'movement_date',
            type: 'type',
            sourceType: 'source_type',
            sourceRef: 'source_ref',
            sourceNumber: 'source_number',
            quantity: 'quantity',
            balanceAfter: 'balance_after',
            unitCostSnapshot: 'unit_cost_snapshot',
            subtotalCost: 'subtotal_cost',
            costMethod: 'cost_method',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    order: {
        table: 'orders',
        fieldMap: {
            masterResi: 'master_resi',
            cargoEntryMode: 'cargo_entry_mode',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            receiverName: 'receiver_name',
            receiverPhone: 'receiver_phone',
            receiverAddress: 'receiver_address',
            receiverCompany: 'receiver_company',
            pickupAddress: 'pickup_address',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            status: 'status',
            notes: 'notes',
            createdAt: 'created_at_business',
            createdBy: 'created_by',
        },
    },
    orderItem: {
        table: 'order_items',
        fieldMap: {
            orderRef: 'order_ref',
            customerProductRef: 'customer_product_ref',
            description: 'description',
            qtyKoli: 'qty_koli',
            weight: 'weight_kg',
            volume: 'volume_m3',
            deliveredQtyKoli: 'delivered_qty_koli',
            deliveredWeight: 'delivered_weight_kg',
            status: 'status',
        },
    },
    deliveryOrder: {
        table: 'delivery_orders',
        fieldMap: {
            doNumber: 'do_number',
            orderRef: 'order_ref',
            masterResi: 'master_resi',
            customerRef: 'customer_ref',
            customerDoPrefix: 'customer_do_prefix',
            customerDoSequence: 'customer_do_sequence',
            customerDoPeriod: 'customer_do_period',
            customerDoNumber: 'customer_do_number',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            date: 'date',
            status: 'status',
            trackingState: 'tracking_state',
            trackingStartedAt: 'tracking_started_at',
            trackingStoppedAt: 'tracking_stopped_at',
            trackingLastSeenAt: 'tracking_last_seen_at',
            trackingLastLat: 'tracking_last_lat',
            trackingLastLng: 'tracking_last_lng',
            tripClosedByAdminAt: 'trip_closed_by_admin_at',
            tripClosedByAdminRef: 'trip_closed_by_admin_ref',
            tripClosedByAdminName: 'trip_closed_by_admin_name',
            tripStartOdometerKm: 'trip_start_odometer_km',
            tripEndOdometerKm: 'trip_end_odometer_km',
            tripDistanceKm: 'trip_distance_km',
            odometerConfirmedAt: 'odometer_confirmed_at',
            odometerConfirmedByRef: 'odometer_confirmed_by_ref',
            odometerConfirmedByName: 'odometer_confirmed_by_name',
            customerName: 'customer_name',
            receiverName: 'receiver_name',
            receiverPhone: 'receiver_phone',
            receiverAddress: 'receiver_address',
            receiverCompany: 'receiver_company',
            pickupAddress: 'pickup_address',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            vehicleServiceRef: 'vehicle_service_ref',
            vehicleServiceName: 'vehicle_service_name',
            vehicleCategoryOverrideReason: 'vehicle_category_override_reason',
            tripRouteRateRef: 'trip_route_rate_ref',
            tripOriginArea: 'trip_origin_area',
            tripDestinationArea: 'trip_destination_area',
            baseTaripBorongan: 'base_tarip_borongan',
            taripBorongan: 'tarip_borongan',
            keteranganBorongan: 'keterangan_borongan',
            freightNotaRef: 'freight_nota_ref',
            freightNotaNumber: 'freight_nota_number',
            notes: 'notes',
        },
    },
    deliveryOrderItem: {
        table: 'delivery_order_items',
        fieldMap: {
            deliveryOrderRef: 'delivery_order_ref',
            orderItemRef: 'order_item_ref',
            pickupStopKey: 'pickup_stop_key',
            pickupAddress: 'pickup_address',
            shipperReferenceKey: 'shipper_reference_key',
            shipperReferenceNumber: 'shipper_reference_number',
            orderItemDescription: 'order_item_description',
            orderItemQtyKoli: 'order_item_qty_koli',
            orderItemWeight: 'order_item_weight_kg',
            orderItemVolumeM3: 'order_item_volume_m3',
            orderItemWeightInputValue: 'order_item_weight_input_value',
            orderItemWeightInputUnit: 'order_item_weight_input_unit',
            orderItemVolumeInputValue: 'order_item_volume_input_value',
            orderItemVolumeInputUnit: 'order_item_volume_input_unit',
            heldQtyKoli: 'held_qty_koli',
            heldWeight: 'held_weight_kg',
            heldVolume: 'held_volume_m3',
            shippedQtyKoli: 'shipped_qty_koli',
            shippedWeight: 'shipped_weight_kg',
            shippedVolume: 'shipped_volume_m3',
            actualQtyKoli: 'actual_qty_koli',
            actualWeightKg: 'actual_weight_kg',
            actualVolumeM3: 'actual_volume_m3',
        },
    },
    trip: {
        table: 'trips',
        fieldMap: {
            deliveryOrderRef: 'delivery_order_ref',
            orderRef: 'order_ref',
            tripNumber: 'trip_number',
            masterResi: 'master_resi',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            tripDate: 'trip_date',
            status: 'status',
            pickupAddress: 'pickup_address',
            receiverName: 'receiver_name',
            receiverPhone: 'receiver_phone',
            receiverAddress: 'receiver_address',
            receiverCompany: 'receiver_company',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            vehicleServiceRef: 'vehicle_service_ref',
            vehicleServiceName: 'vehicle_service_name',
            vehicleCategoryOverrideReason: 'vehicle_category_override_reason',
            tripRouteRateRef: 'trip_route_rate_ref',
            tripOriginArea: 'trip_origin_area',
            tripDestinationArea: 'trip_destination_area',
            trackingState: 'tracking_state',
            trackingStartedAt: 'tracking_started_at',
            trackingStoppedAt: 'tracking_stopped_at',
            trackingLastSeenAt: 'tracking_last_seen_at',
            pendingDriverStatus: 'pending_driver_status',
            tripClosedByAdminAt: 'trip_closed_by_admin_at',
            tripClosedByAdminRef: 'trip_closed_by_admin_ref',
            tripClosedByAdminName: 'trip_closed_by_admin_name',
            tripStartOdometerKm: 'trip_start_odometer_km',
            tripEndOdometerKm: 'trip_end_odometer_km',
            tripDistanceKm: 'trip_distance_km',
            odometerConfirmedAt: 'odometer_confirmed_at',
            odometerConfirmedByRef: 'odometer_confirmed_by_ref',
            odometerConfirmedByName: 'odometer_confirmed_by_name',
            cargoFinalizedAt: 'cargo_finalized_at',
            taripBorongan: 'tarip_borongan',
            notes: 'notes',
        },
    },
    suratJalan: {
        table: 'surat_jalan_documents',
        fieldMap: {
            tripRef: 'trip_ref',
            deliveryOrderRef: 'delivery_order_ref',
            orderRef: 'order_ref',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            referenceKey: 'reference_key',
            suratJalanNumber: 'surat_jalan_number',
            pickupAddress: 'pickup_address',
            receiverName: 'receiver_name',
            receiverCompany: 'receiver_company',
            receiverAddress: 'receiver_address',
            tripDate: 'trip_date',
            tripStatus: 'trip_status',
            vehiclePlate: 'vehicle_plate',
            driverName: 'driver_name',
            itemCount: 'item_count',
            cargoSummary: 'cargo_summary',
            billableCargo: 'billable_cargo',
            holdCargo: 'hold_cargo',
            returnCargo: 'return_cargo',
        },
    },
    suratJalanItem: {
        table: 'surat_jalan_items',
        fieldMap: {
            suratJalanRef: 'surat_jalan_ref',
            tripRef: 'trip_ref',
            deliveryOrderItemRef: 'delivery_order_item_ref',
            referenceKey: 'reference_key',
            suratJalanNumber: 'surat_jalan_number',
            orderItemDescription: 'order_item_description',
            plannedCargo: 'planned_cargo',
            actualCargo: 'actual_cargo',
        },
    },
    trackingLog: {
        table: 'tracking_logs',
        fieldMap: {
            refType: 'ref_type',
            refRef: 'ref_ref',
            status: 'status',
            note: 'note',
            locationText: 'location_text',
            timestamp: 'timestamp',
            userRef: 'user_ref',
            userName: 'user_name',
            latitude: 'latitude',
            longitude: 'longitude',
            accuracyM: 'accuracy_m',
            speedKph: 'speed_kph',
            source: 'source',
        },
    },
    invoice: {
        table: 'invoices',
        fieldMap: {
            invoiceNumber: 'invoice_number',
            mode: 'mode',
            orderRef: 'order_ref',
            doRef: 'do_ref',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            masterResi: 'master_resi',
            issueDate: 'issue_date',
            dueDate: 'due_date',
            status: 'status',
            totalAmount: 'total_amount',
            totalAdjustmentAmount: 'total_adjustment_amount',
            pph23Enabled: 'pph23_enabled',
            pph23RatePercent: 'pph23_rate_percent',
            pph23BaseMode: 'pph23_base_mode',
            pph23BaseAmount: 'pph23_base_amount',
            pph23Amount: 'pph23_amount',
            netAmount: 'net_amount',
            notes: 'notes',
        },
    },
    invoiceItem: {
        table: 'invoice_items',
        fieldMap: {
            invoiceRef: 'invoice_ref',
            description: 'description',
            qty: 'qty',
            price: 'price',
            subtotal: 'subtotal',
        },
    },
    freightNota: {
        table: 'freight_notas',
        fieldMap: {
            notaNumber: 'nota_number',
            notaDisplayNumber: 'nota_display_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            issuerCompanySignatureStampUrl: 'issuer_company_signature_stamp_url',
            issuerCompanySignatureName: 'issuer_company_signature_name',
            issuerCompanyNpwp: 'issuer_company_npwp',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            customerAddress: 'customer_address',
            customerContactPerson: 'customer_contact_person',
            customerPhone: 'customer_phone',
            issueDate: 'issue_date',
            dueDate: 'due_date',
            status: 'status',
            totalAmount: 'total_amount',
            totalAdjustmentAmount: 'total_adjustment_amount',
            pph23Enabled: 'pph23_enabled',
            pph23RatePercent: 'pph23_rate_percent',
            pph23BaseMode: 'pph23_base_mode',
            pph23BaseAmount: 'pph23_base_amount',
            pph23Amount: 'pph23_amount',
            netAmount: 'net_amount',
            totalPaidEffective: 'total_paid_effective',
            refundedOverpaymentAmount: 'refunded_overpayment_amount',
            openOverpaymentAmount: 'open_overpayment_amount',
            totalCollie: 'total_collie',
            totalWeightKg: 'total_weight_kg',
            totalVolumeM3: 'total_volume_m3',
            billingMode: 'billing_mode',
            bankAccountRef: 'bank_account_ref',
            instructionAccounts: 'instruction_accounts',
            footerNote: 'footer_note',
            notes: 'notes',
        },
    },
    freightNotaItem: {
        table: 'freight_nota_items',
        fieldMap: {
            notaRef: 'nota_ref',
            doRef: 'do_ref',
            deliveryOrderItemRef: 'delivery_order_item_ref',
            deliveryOrderItemRefs: 'delivery_order_item_refs',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            doNumber: 'do_number',
            vehiclePlate: 'vehicle_plate',
            date: 'date',
            noSJ: 'no_sj',
            dari: 'dari',
            tujuan: 'tujuan',
            barang: 'barang',
            collie: 'collie',
            beratKg: 'berat_kg',
            volumeM3: 'volume_m3',
            tarip: 'tarip',
            uangRp: 'uang_rp',
            ket: 'ket',
        },
    },
    payment: {
        table: 'payments',
        fieldMap: {
            invoiceRef: 'invoice_ref',
            receiptRef: 'receipt_ref',
            receiptNumber: 'receipt_number',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            date: 'date',
            amount: 'amount',
            method: 'method',
            note: 'note',
            attachmentUrl: 'attachment_url',
        },
    },
    customerReceipt: {
        table: 'customer_receipts',
        fieldMap: {
            receiptNumber: 'receipt_number',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            date: 'date',
            totalAmount: 'total_amount',
            allocatedAmount: 'allocated_amount',
            unappliedAmount: 'unapplied_amount',
            refundedOverpaymentAmount: 'refunded_overpayment_amount',
            openOverpaymentAmount: 'open_overpayment_amount',
            overpaymentStatus: 'overpayment_status',
            allocationCount: 'allocation_count',
            method: 'method',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            note: 'note',
        },
    },
    invoiceAdjustment: {
        table: 'invoice_adjustments',
        fieldMap: {
            invoiceRef: 'invoice_ref',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            date: 'date',
            amount: 'amount',
            kind: 'kind',
            status: 'status',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            editedAt: 'edited_at',
            editedBy: 'edited_by',
            editedByName: 'edited_by_name',
            voidedAt: 'voided_at',
            voidedBy: 'voided_by',
            voidedByName: 'voided_by_name',
        },
    },
    customerOverpaymentRefund: {
        table: 'customer_overpayment_refunds',
        fieldMap: {
            sourceType: 'source_type',
            sourceReceiptRef: 'source_receipt_ref',
            sourceReceiptNumber: 'source_receipt_number',
            sourceInvoiceRef: 'source_invoice_ref',
            sourceInvoiceNumber: 'source_invoice_number',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            date: 'date',
            amount: 'amount',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            bankTransactionRef: 'bank_transaction_ref',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    income: {
        table: 'incomes',
        fieldMap: {
            sourceType: 'source_type',
            paymentRef: 'payment_ref',
            receiptRef: 'receipt_ref',
            date: 'date',
            amount: 'amount',
            note: 'note',
        },
    },
    maintenance: {
        table: 'maintenances',
        fieldMap: {
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            type: 'type',
            scheduleType: 'schedule_type',
            plannedDate: 'planned_date',
            plannedOdometer: 'planned_odometer',
            status: 'status',
            completedDate: 'completed_date',
            odometerAtService: 'odometer_at_service',
            vendor: 'vendor',
            notes: 'notes',
            completionNotes: 'completion_notes',
            attachmentUrls: 'attachment_urls',
            materialUsages: 'material_usages',
            materialUsageCount: 'material_usage_count',
            materialCostTotal: 'material_cost_total',
            totalCost: 'total_cost',
            relatedExpenseRef: 'related_expense_ref',
            cost: 'cost',
            source: 'source',
            relatedDeliveryOrderRef: 'related_delivery_order_ref',
            triggerOdometer: 'trigger_odometer',
        },
    },
    incident: {
        table: 'incidents',
        fieldMap: {
            incidentNumber: 'incident_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            dateTime: 'date_time',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            relatedDeliveryOrderRef: 'related_delivery_order_ref',
            relatedDONumber: 'related_do_number',
            incidentType: 'incident_type',
            urgency: 'urgency',
            locationText: 'location_text',
            odometer: 'odometer',
            description: 'description',
            status: 'status',
            attachmentUrls: 'attachment_urls',
            assignedToUserRef: 'assigned_to_user_ref',
            assignedToUserName: 'assigned_to_user_name',
        },
    },
    incidentSettlementLine: {
        table: 'incident_settlement_lines',
        fieldMap: {
            incidentRef: 'incident_ref',
            incidentNumber: 'incident_number',
            lineType: 'line_type',
            category: 'category',
            date: 'date',
            amount: 'amount',
            description: 'description',
            payeeName: 'payee_name',
            recipientType: 'recipient_type',
            note: 'note',
            status: 'status',
            linkedExpenseRef: 'linked_expense_ref',
            linkedExpenseDate: 'linked_expense_date',
            linkedExpenseAmount: 'linked_expense_amount',
            linkedExpenseCategoryRef: 'linked_expense_category_ref',
            linkedExpenseCategoryName: 'linked_expense_category_name',
            postedAt: 'posted_at',
            postedBy: 'posted_by',
            postedByName: 'posted_by_name',
            createdAt: 'created_at_business',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            updatedAt: 'updated_at_business',
            updatedBy: 'updated_by',
            updatedByName: 'updated_by_name',
            voidedAt: 'voided_at',
            voidedBy: 'voided_by',
            voidedByName: 'voided_by_name',
        },
    },
    incidentActionLog: {
        table: 'incident_action_logs',
        fieldMap: {
            incidentRef: 'incident_ref',
            timestamp: 'timestamp',
            note: 'note',
            userRef: 'user_ref',
            userName: 'user_name',
        },
    },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizePositiveInteger(value: unknown, fallback: number, max?: number) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    if (typeof max === 'number' && parsed > max) {
        return max;
    }
    return parsed;
}

function getConfig(docType: string) {
    return RELATIONAL_CONFIG[docType as SupportedDocType] || null;
}

function toDocTypeList() {
    return Object.keys(RELATIONAL_CONFIG) as SupportedDocType[];
}

function getColumnName(config: RelationalConfig, field: string) {
    if (field === '_id') return 'source_document_id';
    if (field === '_createdAt') return 'document_created_at';
    if (field === '_updatedAt') return 'document_updated_at';
    if (field === '_rev' || field === '_type' || field.includes('.')) return null;
    return config.fieldMap[field] || null;
}

function isServerFilterScalar(value: unknown): value is string | number | boolean {
    return isScalar(value);
}

function isServerClauseStringSafe(value: string) {
    return !/[(),]/.test(value);
}

function isServerSearchStringSafe(value: string) {
    return !/[%_*(),]/.test(value);
}

function formatServerFilterValue(value: string | number | boolean) {
    return typeof value === 'string' ? value : String(value);
}

function formatServerInValue(value: string | number | boolean) {
    if (typeof value === 'string') {
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return String(value);
}

function parseContentRangeTotal(value: string | null) {
    if (!value) return null;
    const match = /\/(\d+|\*)$/.exec(value);
    if (!match || match[1] === '*') {
        return null;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function cloneRelationalRows(rows: RelationalRow[]) {
    return rows.map(row => ({ ...row }));
}

function cloneFetchRowsResult(result: FetchRowsResult): FetchRowsResult {
    return {
        rows: cloneRelationalRows(result.rows),
        total: result.total,
    };
}

function getReadCacheKey(path: string, init: RequestInit) {
    const method = typeof init.method === 'string' ? init.method.toUpperCase() : 'GET';
    if (method !== 'GET' || RELATIONAL_READ_CACHE_TTL_MS <= 0) {
        return null;
    }

    let preferHeader = '';
    if (init.headers) {
        try {
            preferHeader = new Headers(init.headers).get('Prefer') || '';
        } catch {
            preferHeader = '';
        }
    }

    return `${preferHeader}::${path}`;
}

function pruneRelationalReadCache(now = Date.now()) {
    for (const [key, entry] of relationalReadCache) {
        if (entry.expiresAt <= now) {
            relationalReadCache.delete(key);
        }
    }

    while (relationalReadCache.size > RELATIONAL_READ_CACHE_MAX_ENTRIES) {
        const oldestKey = relationalReadCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        relationalReadCache.delete(oldestKey);
    }
}

export function clearRelationalReadCache() {
    relationalReadCacheVersion += 1;
    relationalReadCache.clear();
    relationalInFlightReads.clear();
}

function buildFilterParams(
    config: RelationalConfig,
    filterObj: Record<string, unknown>,
) {
    const params = new URLSearchParams();

    for (const [field, expected] of Object.entries(filterObj)) {
        if (expected === '' || expected === null || expected === undefined) {
            continue;
        }

        const column = getColumnName(config, field);
        if (!column) {
            return null;
        }

        if (Array.isArray(expected)) {
            if (expected.length === 0) {
                continue;
            }

            if (!expected.every(isServerFilterScalar)) {
                return null;
            }

            params.set(column, `in.(${expected.map(formatServerInValue).join(',')})`);
            continue;
        }

        if (isRecord(expected)) {
            for (const [operator, operatorValue] of Object.entries(expected)) {
                if (operatorValue === '' || operatorValue === null || operatorValue === undefined) {
                    continue;
                }
                if (
                    operator !== 'eq' &&
                    operator !== 'neq' &&
                    operator !== 'gt' &&
                    operator !== 'gte' &&
                    operator !== 'lt' &&
                    operator !== 'lte'
                ) {
                    return null;
                }
                if (!isServerFilterScalar(operatorValue)) {
                    return null;
                }
                params.append(column, `${operator}.${formatServerFilterValue(operatorValue)}`);
            }
            continue;
        }

        if (!isServerFilterScalar(expected)) {
            return null;
        }

        params.set(column, `eq.${formatServerFilterValue(expected)}`);
    }

    return params;
}

function buildOrFilterClause(
    config: RelationalConfig,
    orFilters: Array<{ fields: string[]; value: string | number | boolean }>,
) {
    if (orFilters.length === 0) return '';

    const clauses: string[] = [];
    for (const orFilter of orFilters) {
        if (!isServerFilterScalar(orFilter.value)) {
            return null;
        }

        if (typeof orFilter.value === 'string' && !isServerClauseStringSafe(orFilter.value)) {
            return null;
        }

        const formattedValue = formatServerFilterValue(orFilter.value);
        for (const field of orFilter.fields) {
            const column = getColumnName(config, field);
            if (!column) {
                return null;
            }
            clauses.push(`${column}.eq.${formattedValue}`);
        }
    }

    return clauses.length > 0 ? clauses.join(',') : '';
}

function buildSearchClause(
    config: RelationalConfig,
    search: string,
    searchFields: string[],
) {
    const trimmed = search.trim();
    if (!trimmed || searchFields.length === 0) return '';
    if (!isServerSearchStringSafe(trimmed)) {
        return null;
    }

    const clauses: string[] = [];
    for (const field of searchFields) {
        const column = getColumnName(config, field);
        if (!column) {
            return null;
        }
        clauses.push(`${column}.ilike.*${trimmed}*`);
    }

    return clauses.length > 0 ? clauses.join(',') : '';
}

function readField(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (!isRecord(current)) {
            return undefined;
        }
        return current[segment];
    }, source);
}

function compareValues(left: unknown, right: unknown) {
    const normalizedLeft = left ?? '';
    const normalizedRight = right ?? '';

    if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
        return normalizedLeft - normalizedRight;
    }

    return String(normalizedLeft).localeCompare(String(normalizedRight));
}

function matchesFilterValue(actual: unknown, expected: unknown) {
    if (expected === '' || expected === null || expected === undefined) {
        return true;
    }

    if (isRecord(expected)) {
        for (const [operator, operatorValue] of Object.entries(expected)) {
            if (operatorValue === '' || operatorValue === null || operatorValue === undefined) {
                continue;
            }
            const comparison = compareValues(actual, operatorValue);
            if (operator === 'eq' && comparison !== 0) return false;
            if (operator === 'neq' && comparison === 0) return false;
            if (operator === 'gt' && comparison <= 0) return false;
            if (operator === 'gte' && comparison < 0) return false;
            if (operator === 'lt' && comparison >= 0) return false;
            if (operator === 'lte' && comparison > 0) return false;
            if (
                operator !== 'eq' &&
                operator !== 'neq' &&
                operator !== 'gt' &&
                operator !== 'gte' &&
                operator !== 'lt' &&
                operator !== 'lte'
            ) {
                return false;
            }
        }
        return true;
    }

    if (Array.isArray(expected)) {
        if (expected.length === 0) return true;
        if (Array.isArray(actual)) {
            return actual.some(item => expected.includes(item));
        }
        return expected.includes(actual as never);
    }

    if (Array.isArray(actual)) {
        return actual.includes(expected as never);
    }

    return actual === expected;
}

function matchesFilter(doc: Record<string, unknown>, filterObj: Record<string, unknown>) {
    for (const [field, expected] of Object.entries(filterObj)) {
        if (!matchesFilterValue(readField(doc, field), expected)) {
            return false;
        }
    }
    return true;
}

function matchesDefinedFields(doc: Record<string, unknown>, fields: string[]) {
    return fields.every(field => {
        const value = readField(doc, field);
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        return value !== undefined && value !== null && value !== '';
    });
}

function matchesOrFilters(
    doc: Record<string, unknown>,
    orFilters: Array<{ fields: string[]; value: string | number | boolean }>
) {
    if (orFilters.length === 0) return true;
    return orFilters.some(orFilter =>
        orFilter.fields.some(field => readField(doc, field) === orFilter.value)
    );
}

function matchesSearch(doc: Record<string, unknown>, search: string, searchFields: string[]) {
    if (!search.trim() || searchFields.length === 0) return true;
    const needle = search.trim().toLowerCase();
    return searchFields.some(field => {
        const value = readField(doc, field);
        return typeof value === 'string' && value.toLowerCase().includes(needle);
    });
}

function sortDocuments(
    docs: Array<Record<string, unknown>>,
    sortField?: string,
    sortDir: 'asc' | 'desc' = 'desc'
) {
    const targetField = sortField?.trim() || '_updatedAt';
    const multiplier = sortDir === 'asc' ? 1 : -1;

    return [...docs].sort((left, right) =>
        compareValues(readField(left, targetField), readField(right, targetField)) * multiplier
    );
}

function mapRowToDocument(docType: SupportedDocType, row: RelationalRow) {
    const config = RELATIONAL_CONFIG[docType];
    const extraData = isRecord(row.extra_data) ? row.extra_data : {};
    const doc: Record<string, unknown> = {
        ...extraData,
        _id: row.source_document_id,
        _type: docType,
        _createdAt: row.document_created_at || undefined,
        _updatedAt: row.document_updated_at || undefined,
        _rev: row.document_updated_at || undefined,
    };

    for (const [field, column] of Object.entries(config.fieldMap)) {
        const value = row[column];
        if (value !== null && value !== undefined) {
            doc[field] = value;
        }
    }

    return doc;
}

function mapDocumentToRow(docType: SupportedDocType, doc: { _id?: string; _type?: string; [key: string]: unknown }) {
    const config = RELATIONAL_CONFIG[docType];
    const usedKeys = new Set<string>([...META_FIELDS, ...Object.keys(config.fieldMap)]);
    const extraData: Record<string, unknown> = {};
    const nowIso = new Date().toISOString();
    const createdAt = typeof doc._createdAt === 'string' && doc._createdAt.trim()
        ? doc._createdAt
        : nowIso;
    const updatedAt = typeof doc._updatedAt === 'string' && doc._updatedAt.trim()
        ? doc._updatedAt
        : createdAt;

    for (const [key, value] of Object.entries(doc)) {
        if (!usedKeys.has(key)) {
            extraData[key] = value;
        }
    }

    const row: Record<string, unknown> = {
        source_document_id: typeof doc._id === 'string' && doc._id.trim() ? doc._id.trim() : randomUUID(),
        document_created_at: createdAt,
        document_updated_at: updatedAt,
        extra_data: extraData,
    };

    for (const [field, column] of Object.entries(config.fieldMap)) {
        row[column] = Object.prototype.hasOwnProperty.call(doc, field) ? doc[field] : null;
    }

    return row;
}

function compareByText(left: unknown, right: unknown, direction: 'asc' | 'desc' = 'asc') {
    const result = compareValues(left, right);
    return direction === 'asc' ? result : -result;
}

function rankValue(value: unknown, ranks: Record<string, number>) {
    return ranks[String(value ?? '')] ?? 99;
}

function hasMeaningfulValue(value: unknown) {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== '';
}

function compareWithFallback(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    field: string,
    direction: 'asc' | 'desc' = 'asc',
    fallback: unknown = '',
) {
    return compareByText(readField(left, field) ?? fallback, readField(right, field) ?? fallback, direction);
}

function getSortPresetComparator(
    docType: SupportedDocType,
    sortPreset?: string | null,
): ((left: Record<string, unknown>, right: Record<string, unknown>) => number) | null {
    if (sortPreset !== 'work-queue') return null;

    if (docType === 'order') {
        const ranks = { OPEN: 0, PARTIAL: 1, ON_HOLD: 1, COMPLETE: 2, CANCELLED: 3 };
        return (left, right) =>
            rankValue(left.status, ranks) - rankValue(right.status, ranks)
            || compareWithFallback(left, right, 'createdAt', 'desc');
    }

    if (docType === 'deliveryOrder') {
        const ranks = { CREATED: 0, ON_DELIVERY: 1, ARRIVED: 2, PARTIAL_HOLD: 3, DELIVERED: 4, CANCELLED: 5 };
        return (left, right) => {
            const leftPendingRank = hasMeaningfulValue(left.pendingDriverStatus) ? 0 : 1;
            const rightPendingRank = hasMeaningfulValue(right.pendingDriverStatus) ? 0 : 1;
            return leftPendingRank - rightPendingRank
                || rankValue(left.status, ranks) - rankValue(right.status, ranks)
                || compareWithFallback(left, right, 'date', 'desc');
        };
    }

    if (docType === 'driverVoucher') {
        const ranks = { ISSUED: 0, DRAFT: 1, SETTLED: 2 };
        return (left, right) =>
            rankValue(left.status, ranks) - rankValue(right.status, ranks)
            || compareWithFallback(left, right, 'issuedDate', 'desc');
    }

    if (docType === 'freightNota') {
        const ranks = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
        return (left, right) =>
            rankValue(left.status, ranks) - rankValue(right.status, ranks)
            || compareWithFallback(left, right, 'issueDate', 'asc')
            || compareWithFallback(left, right, '_createdAt', 'desc');
    }

    if (docType === 'maintenance') {
        const ranks = { SCHEDULED: 0, DONE: 1, SKIPPED: 2 };
        return (left, right) =>
            rankValue(left.status, ranks) - rankValue(right.status, ranks)
            || compareWithFallback(left, right, 'plannedDate', 'asc', '9999-12-31')
            || compareWithFallback(left, right, 'plannedOdometer', 'asc')
            || compareWithFallback(left, right, '_createdAt', 'desc');
    }

    if (docType === 'incident') {
        const ranks = { OPEN: 0, IN_PROGRESS: 1, RESOLVED: 2, CLOSED: 3 };
        return (left, right) =>
            rankValue(left.status, ranks) - rankValue(right.status, ranks)
            || compareWithFallback(left, right, 'dateTime', 'desc');
    }

    return null;
}

function buildQueryPath(table: string, params: URLSearchParams) {
    const query = params.toString();
    return query ? `${table}?${query}` : table;
}

function buildSelectColumns(config: RelationalConfig, fields: string[]) {
    const columns = new Set<string>(['source_document_id']);
    for (const field of fields) {
        const column = getColumnName(config, field);
        if (!column) {
            return null;
        }
        columns.add(column);
    }
    return Array.from(columns).join(',');
}

async function fetchRows(path: string, init: RequestInit = {}): Promise<FetchRowsResult> {
    const cacheKey = getReadCacheKey(path, init);
    const requestCacheVersion = relationalReadCacheVersion;
    if (cacheKey) {
        const now = Date.now();
        const cached = relationalReadCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return cloneFetchRowsResult(cached);
        }
        if (cached) {
            relationalReadCache.delete(cacheKey);
        }

        const inFlight = relationalInFlightReads.get(cacheKey);
        if (inFlight) {
            return cloneFetchRowsResult(await inFlight);
        }
    }

    const request = (async () => {
        const response = await getSupabaseClient().fetch(path, init);
        const rows = await response.json() as RelationalRow[];
        return {
            rows,
            total: parseContentRangeTotal(response.headers.get('content-range')),
        };
    })();

    if (cacheKey) {
        relationalInFlightReads.set(cacheKey, request);
    }

    let result: FetchRowsResult;
    try {
        result = await request;
    } finally {
        if (cacheKey) {
            relationalInFlightReads.delete(cacheKey);
        }
    }

    if (cacheKey && requestCacheVersion === relationalReadCacheVersion) {
        relationalReadCache.set(cacheKey, {
            ...cloneFetchRowsResult(result),
            expiresAt: Date.now() + RELATIONAL_READ_CACHE_TTL_MS,
        });
        pruneRelationalReadCache();
    }

    return result;
}

async function fetchAllRows(
    table: string,
    params: URLSearchParams = new URLSearchParams(),
    init: RequestInit = {},
): Promise<FetchRowsResult> {
    const rows: RelationalRow[] = [];
    let total: number | null = null;
    let offset = 0;

    while (true) {
        const batchParams = new URLSearchParams(params);
        batchParams.set('limit', String(FETCH_BATCH_SIZE));
        batchParams.set('offset', String(offset));

        const batch = await fetchRows(buildQueryPath(table, batchParams), init);
        if (total === null && batch.total !== null) {
            total = batch.total;
        }

        if (batch.rows.length === 0) {
            break;
        }

        rows.push(...batch.rows);
        offset += batch.rows.length;

        if (batch.rows.length < FETCH_BATCH_SIZE) {
            break;
        }

        if (total !== null && offset >= total) {
            break;
        }
    }

    return {
        rows,
        total: total ?? rows.length,
    };
}

function buildServerListParams(
    config: RelationalConfig,
    options: RelationalListOptions,
    paramsOptions: { includeOrder?: boolean } = {},
) {
    if ((options.definedFields?.length || 0) > 0) {
        return null;
    }

    const params = new URLSearchParams();
    params.set('select', '*');

    const filterParams = buildFilterParams(config, options.filterObj ?? {});
    if (!filterParams) {
        return null;
    }
    for (const [key, value] of filterParams.entries()) {
        params.append(key, value);
    }

    const searchClause = buildSearchClause(config, options.search ?? '', options.searchFields ?? []);
    if (searchClause === null) {
        return null;
    }

    const orClause = buildOrFilterClause(config, options.orFilters ?? []);
    if (orClause === null) {
        return null;
    }

    if (searchClause && orClause) {
        return null;
    }

    if (searchClause) {
        params.set('or', `(${searchClause})`);
    } else if (orClause) {
        params.set('or', `(${orClause})`);
    }

    if (paramsOptions.includeOrder !== false) {
        const targetSortField = options.sortField?.trim() || '_updatedAt';
        const sortColumn = getColumnName(config, targetSortField);
        if (!sortColumn) {
            return null;
        }

        params.set('order', `${sortColumn}.${options.sortDir === 'asc' ? 'asc' : 'desc'}`);
    }
    return params;
}

function isMissingRelationalTableError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /Could not find the table/i.test(message) || /relation .* does not exist/i.test(message);
}

export function supportsRelationalDocType(docType: string): docType is SupportedDocType {
    return Boolean(getConfig(docType));
}

export async function relationalGetById<T = Record<string, unknown>>(docType: SupportedDocType, id: string): Promise<T | null> {
    const config = RELATIONAL_CONFIG[docType];

    try {
        const params = new URLSearchParams();
        params.set('select', '*');
        params.set('source_document_id', `eq.${id}`);
        params.set('limit', '1');
        const { rows } = await fetchRows(
            buildQueryPath(config.table, params)
        );
        return rows[0] ? mapRowToDocument(docType, rows[0]) as T : null;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return null;
        }
        throw error;
    }
}

export async function relationalGetAll<T = Record<string, unknown>>(docType: SupportedDocType): Promise<T[]> {
    const config = RELATIONAL_CONFIG[docType];

    try {
        const params = new URLSearchParams();
        params.set('select', '*');
        const { rows } = await fetchAllRows(config.table, params);
        return rows.map(row => mapRowToDocument(docType, row) as T);
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return [];
        }
        throw error;
    }
}

export async function relationalGetByFilter<T = Record<string, unknown>>(
    docType: SupportedDocType,
    filterObj: Record<string, unknown>
): Promise<T[]> {
    const config = RELATIONAL_CONFIG[docType];
    const filterParams = buildFilterParams(config, filterObj);

    if (filterParams) {
        try {
            filterParams.set('select', '*');
            const { rows } = await fetchAllRows(config.table, filterParams);
            return rows.map(row => mapRowToDocument(docType, row) as T);
        } catch (error) {
            if (isMissingRelationalTableError(error)) {
                return [];
            }
            throw error;
        }
    }

    const docs = await relationalGetAll<Record<string, unknown>>(docType);
    return docs.filter(doc => matchesFilter(doc, filterObj)) as T[];
}

export async function relationalGetFieldsByFilter<T = Record<string, unknown>>(
    docType: SupportedDocType,
    fields: string[],
    filterObj: Record<string, unknown>
): Promise<T[]> {
    const config = RELATIONAL_CONFIG[docType];
    const filterParams = buildFilterParams(config, filterObj);
    const selectedColumns = buildSelectColumns(config, fields);

    if (!filterParams || !selectedColumns) {
        return relationalGetByFilter<T>(docType, filterObj);
    }

    try {
        filterParams.set('select', selectedColumns);
        const { rows } = await fetchAllRows(config.table, filterParams);
        return rows.map(row => mapRowToDocument(docType, row) as T);
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return [];
        }
        throw error;
    }
}

export async function relationalList<T = Record<string, unknown>>(
    docType: SupportedDocType,
    options: RelationalListOptions = {}
): Promise<RelationalListResult<T>> {
    const page = normalizePositiveInteger(options.page, 1);
    const pageSize = normalizePositiveInteger(options.pageSize, 10, 500);

    const config = RELATIONAL_CONFIG[docType];
    const presetComparator = getSortPresetComparator(docType, options.sortPreset);
    const serverParams = buildServerListParams(config, options, { includeOrder: !presetComparator });
    if (serverParams && !presetComparator) {
        const pagedParams = new URLSearchParams(serverParams);
        pagedParams.set('limit', String(pageSize));
        pagedParams.set('offset', String((page - 1) * pageSize));

        try {
            const countStrategy = options.countStrategy || 'exact';
            const result = await fetchRows(
                buildQueryPath(config.table, pagedParams),
                countStrategy === 'none'
                    ? undefined
                    : { headers: { Prefer: `count=${countStrategy}` } },
            );
            if (countStrategy === 'none') {
                return {
                    items: result.rows.map(row => mapRowToDocument(docType, row) as T),
                    total: result.rows.length,
                };
            }
            if (result.total !== null) {
                return {
                    items: result.rows.map(row => mapRowToDocument(docType, row) as T),
                    total: result.total,
                };
            }
        } catch (error) {
            if (isMissingRelationalTableError(error)) {
                return { items: [], total: 0 };
            }
            throw error;
        }
    }

    let docs: Array<Record<string, unknown>>;
    if (serverParams) {
        try {
            const result = await fetchAllRows(config.table, serverParams);
            docs = result.rows.map(row => mapRowToDocument(docType, row));
        } catch (error) {
            if (isMissingRelationalTableError(error)) {
                return { items: [], total: 0 };
            }
            throw error;
        }
    } else {
        docs = await relationalGetAll<Record<string, unknown>>(docType);
    }
    const filtered = docs
        .filter(doc => matchesFilter(doc, options.filterObj ?? {}))
        .filter(doc => matchesDefinedFields(doc, options.definedFields ?? []))
        .filter(doc => matchesOrFilters(doc, options.orFilters ?? []))
        .filter(doc => matchesSearch(doc, options.search ?? '', options.searchFields ?? []));
    const sorted = presetComparator
        ? [...filtered].sort(presetComparator)
        : sortDocuments(filtered, options.sortField, options.sortDir);
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize) as T[];

    return {
        items,
        total: filtered.length,
    };
}

export async function relationalCountByPrefix(
    docType: SupportedDocType,
    field: string,
    prefix: string,
): Promise<number | null> {
    const config = RELATIONAL_CONFIG[docType];
    const column = getColumnName(config, field);
    if (!column || !prefix) {
        return null;
    }

    try {
        const params = new URLSearchParams();
        params.set('select', 'source_document_id');
        params.set(column, `like.${prefix}*`);
        params.set('limit', '1');
        const result = await fetchRows(
            buildQueryPath(config.table, params),
            { headers: { Prefer: 'count=exact' } },
        );
        return result.total;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return null;
        }
        throw error;
    }
}

export async function relationalMaxNumericSuffixByPrefix(
    docType: SupportedDocType,
    field: string,
    prefix: string,
): Promise<number | null> {
    const config = RELATIONAL_CONFIG[docType];
    const column = getColumnName(config, field);
    if (!column || !prefix) {
        return null;
    }

    try {
        const params = new URLSearchParams();
        params.set('select', column);
        params.set(column, `like.${prefix}*`);
        const { rows } = await fetchAllRows(config.table, params);

        return rows.reduce((max, row) => {
            const value = row[column];
            if (typeof value !== 'string' || !value.startsWith(prefix)) return max;
            const suffix = value.slice(prefix.length);
            if (!/^\d+$/.test(suffix)) return max;
            const sequence = Number.parseInt(suffix, 10);
            return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
        }, 0);
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return null;
        }
        throw error;
    }
}

export async function relationalUpsertDocument<T = Record<string, unknown>>(
    doc: { _id?: string; _type: string; [key: string]: unknown },
    options?: RelationalMutationOptions,
): Promise<T | null> {
    if (!supportsRelationalDocType(doc._type)) {
        return null;
    }

    const config = RELATIONAL_CONFIG[doc._type];

    try {
        const response = await getSupabaseClient().fetch(config.table, {
            method: 'POST',
            headers: {
                Prefer: 'resolution=merge-duplicates,return=representation',
            },
            body: JSON.stringify(mapDocumentToRow(doc._type, doc)),
        });
        const rows = await response.json() as RelationalRow[];
        clearRelationalReadCacheUnlessSkipped(options);
        return rows[0] ? mapRowToDocument(doc._type, rows[0]) as T : null;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return null;
        }
        throw error;
    }
}

export async function relationalPatchDocument<T = Record<string, unknown>>(
    docType: SupportedDocType,
    id: string,
    updates: Record<string, unknown>,
    options?: RelationalMutationOptions,
): Promise<T | null> {
    const config = RELATIONAL_CONFIG[docType];
    const patch: Record<string, unknown> = {};
    const extraUpdates: Record<string, unknown> = {};
    let hasExtraUpdates = false;

    for (const [field, value] of Object.entries(updates)) {
        if (field === '_id' || field === '_type' || field === '_rev') {
            continue;
        }

        if (field === '_createdAt') {
            if (value !== undefined) {
                patch.document_created_at = value;
            }
            continue;
        }

        if (field === '_updatedAt') {
            if (value !== undefined) {
                patch.document_updated_at = value;
            }
            continue;
        }

        const column = config.fieldMap[field];
        if (column) {
            if (value !== undefined) {
                patch[column] = value;
            }
            continue;
        }

        extraUpdates[field] = value;
        hasExtraUpdates = true;
    }

    try {
        if (hasExtraUpdates) {
            const params = new URLSearchParams();
            params.set('select', 'source_document_id,extra_data');
            params.set('source_document_id', `eq.${id}`);
            params.set('limit', '1');

            const { rows } = await fetchRows(buildQueryPath(config.table, params));
            const existingRow = rows[0];
            if (!existingRow) {
                return null;
            }

            const nextExtraData = isRecord(existingRow.extra_data)
                ? { ...existingRow.extra_data }
                : {};
            for (const [field, value] of Object.entries(extraUpdates)) {
                if (value === undefined || value === null) {
                    delete nextExtraData[field];
                } else {
                    nextExtraData[field] = value;
                }
            }
            // Remove any keys that have null values (explicit deletion)
            for (const field of Object.keys(nextExtraData)) {
                if (nextExtraData[field] === null) {
                    delete nextExtraData[field];
                }
            }
            patch.extra_data = nextExtraData;
        }

        if (Object.keys(patch).length === 0) {
            return relationalGetById<T>(docType, id);
        }

        const response = await getSupabaseClient().fetch(
            `${config.table}?source_document_id=eq.${encodeURIComponent(id)}`,
            {
                method: 'PATCH',
                headers: {
                    Prefer: 'return=representation',
                },
                body: JSON.stringify(patch),
            }
        );
        const rows = await response.json() as RelationalRow[];
        clearRelationalReadCacheUnlessSkipped(options);
        return rows[0] ? mapRowToDocument(docType, rows[0]) as T : null;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return null;
        }
        throw error;
    }
}

export async function relationalDeleteDocument(docType: SupportedDocType, id: string) {
    const config = RELATIONAL_CONFIG[docType];

    try {
        await getSupabaseClient().fetch(
            `${config.table}?source_document_id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
        );
        clearRelationalReadCache();
        return true;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return false;
        }
        throw error;
    }
}

export async function relationalFindDocumentByIdAcrossTypes<T = Record<string, unknown>>(id: string): Promise<T | null> {
    for (const docType of toDocTypeList()) {
        const found = await relationalGetById<T>(docType, id);
        if (found) {
            return found;
        }
    }
    return null;
}
