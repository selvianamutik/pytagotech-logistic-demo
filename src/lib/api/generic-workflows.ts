import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { createSession, setSessionCookie } from '@/lib/auth';
import { isSupabaseBackendEnabled } from '@/lib/data-backend';
import { DOCUMENT_TYPE_MAP } from '@/lib/document-types';
import {
    createDocument,
    deleteDocument,
    getCompanyProfile,
    getDocumentById,
    getNextNumber,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import {
    buildTirePlacementLabel,
    buildDefaultTireLayoutConfig,
    formatTireSlotLabel,
    isKnownInternalTireSlotCode,
    normalizeTireLayoutConfig,
    normalizeTireSlotCode,
} from '@/lib/tire-slots';
import {
    buildTireHistoryLogDoc,
    buildTireHistorySnapshot,
} from '@/lib/tire-history';
import {
    buildTrackedTireStockMovementDoc,
    buildTrackedTireWarehouseNote,
    countsTowardTrackedTireWarehouseStock,
    resolveTrackedTirePlacementLabel,
} from '@/lib/tire-inventory';
import { isTireTrackedWarehouseItem } from '@/lib/inventory';
import { getTripRouteOvertonaseRatePerKg } from '@/lib/trip-route-rate-support';
import type { BankTransaction, CompanyProfile, Maintenance, SupplierItemPrice, TireHistoryLog, User, WarehouseItem } from '@/lib/types';

import {
    assertIsoDate,
    CASH_ACCOUNT_SYSTEM_KEY,
    extractRefId,
    isMutationConflictError,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    readLedgerBalance,
    sanitizeUserForClient,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import { applyDerivedBankAccountBalances } from './data-query-support';
import {
    normalizeBankAccountPayload,
    normalizeCustomerPayload,
    normalizeCustomerBillingRatePayload,
    normalizeCustomerPickupPayload,
    normalizeCustomerProductPayload,
    normalizeCustomerRecipientPayload,
    normalizeSupplierItemPricePayload,
    normalizeSupplierPayload,
    normalizeTripRouteRatePayload,
    normalizeWarehouseItemPayload,
    resolveTripRouteRateSelection,
} from './generic-workflow-support';
import {
    handleDriverBoronganDelete,
    handleDriverVoucherDisbursementDelete,
    handleDriverVoucherItemDelete,
} from './driver-workflows';
import {
    createMaintenanceLaborExpense,
    prepareMaintenanceLaborExpensePosting,
} from './maintenance-workflows';
import {
    handleDriverScoreCreate,
    handleDriverScoreUpdate,
} from './driver-score-workflows';
import {
    buildEmployeeAttendanceSummary,
    buildEmployeeSummary,
    normalizeEmployeeAttendanceCreatePayload,
    normalizeEmployeeAttendanceUpdates,
    normalizeEmployeePayload,
} from './employee-workflows';
import { handleFreightNotaDelete } from './finance-workflows';
import { postBankAccountOpeningBalanceJournal } from './accounting-posting';
import {
    handleDriverUpdate,
    handleDriverDelete,
    handleExpenseCategoryDelete,
    handleServiceDelete,
    handleVehicleDelete,
    normalizeDriverPayload,
    normalizeExpenseCategoryPayload,
    normalizeMaintenanceCreatePayload,
    normalizeServicePayload,
    normalizeTireEventPayload,
    normalizeVehiclePayload,
} from './operations-workflows';
import { handleOrderDelete, syncOrderStatusFromItems } from './order-workflows';
import {
    handleCustomerDelete,
    normalizeUserCreatePayload,
    normalizeUserUpdates,
} from './support-workflows';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

const COMPANY_ASSET_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i;
const COMPANY_ASSET_MAX_LENGTH = 1_500_000;

function buildUserUpdateAuditSummary(
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
    updates: Record<string, unknown>,
    fallbackId: string
) {
    const previousName = normalizeOptionalText(previous.name) || fallbackId;
    const nextName = normalizeOptionalText(next.name) || previousName;
    const changes: string[] = [];

    if (Object.prototype.hasOwnProperty.call(updates, 'name') && previousName !== nextName) {
        changes.push(`nama ${previousName} -> ${nextName}`);
    }

    const previousEmail = normalizeOptionalText(previous.email);
    const nextEmail = normalizeOptionalText(next.email);
    if (Object.prototype.hasOwnProperty.call(updates, 'email') && previousEmail !== nextEmail) {
        changes.push(`email ${previousEmail || '-'} -> ${nextEmail || '-'}`);
    }

    const previousRole = normalizeOptionalText(previous.role);
    const nextRole = normalizeOptionalText(next.role);
    if (Object.prototype.hasOwnProperty.call(updates, 'role') && previousRole !== nextRole) {
        changes.push(`role ${previousRole || '-'} -> ${nextRole || '-'}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'active') && previous.active !== next.active) {
        changes.push(`status ${next.active === false ? 'nonaktif' : 'aktif'}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'driverRef')) {
        const nextDriverName = normalizeOptionalText(next.driverName);
        changes.push(nextDriverName ? `tautan supir ${nextDriverName}` : 'tautan supir dilepas');
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'passwordHash')) {
        changes.push('password diubah');
    }

    return `Perbarui akun ${nextName}: ${changes.length > 0 ? changes.join(', ') : 'data akun diperbarui'}`;
}

function sanitizeCompanyAssetUrl(value: unknown, label: string) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return undefined;
    }

    if (normalized.length > COMPANY_ASSET_MAX_LENGTH) {
        throw new Error(`${label} terlalu besar`);
    }

    if (normalized.startsWith('/')) {
        return normalized;
    }

    if (COMPANY_ASSET_DATA_URL_RE.test(normalized)) {
        return normalized;
    }

    try {
        const url = new URL(normalized);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            return normalized;
        }
    } catch {
        // Ignore parse error and fall through to the validation error below.
    }

    throw new Error(`${label} harus berupa URL gambar http(s), path internal, atau data URL image base64 yang valid`);
}

function sanitizeCompanyCounter(value: unknown, fallback = 0) {
    const normalized = normalizeNumber(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
        return fallback;
    }
    return Math.floor(normalized);
}

function parseCompanyWholeNumberInput(value: unknown) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
            return null;
        }
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed || !/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            return null;
        }

        const groupedIntegerPattern = /^-?\d{1,3}(?:[.,]\d{3})*$/;
        const plainIntegerPattern = /^-?\d+$/;
        if (!groupedIntegerPattern.test(trimmed) && !plainIntegerPattern.test(trimmed)) {
            return null;
        }
    }

    const normalized = normalizeNumber(value, { allowDecimal: false, maxFractionDigits: 0 });
    if (!Number.isFinite(normalized) || normalized < 0 || !Number.isInteger(normalized)) {
        return null;
    }
    return Math.floor(normalized);
}

function normalizeCompanyDateFormatInput(value: unknown) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return undefined;
    }
    return normalized === 'DD/MM/YYYY' || normalized === 'dd/MM/yyyy' ? normalized : null;
}

function sanitizeCompanyThemeColor(value: unknown, fallback?: string) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return fallback;
    }
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

async function sanitizeCompanyInvoiceSettings(
    input: Record<string, unknown>,
    existingCompany?: CompanyProfile | null,
): Promise<Record<string, unknown>> {
    const existingNumbering = isPlainObject(existingCompany?.numberingSettings)
        ? existingCompany.numberingSettings as Record<string, unknown>
        : {};
    const numberingInput = isPlainObject(input.numberingSettings) ? input.numberingSettings as Record<string, unknown> : {};
    const existingInvoiceSettings = isPlainObject(existingCompany?.invoiceSettings)
        ? existingCompany.invoiceSettings as Record<string, unknown>
        : {};
    const invoiceSettings = isPlainObject(input.invoiceSettings) ? input.invoiceSettings as Record<string, unknown> : {};
    const existingDocumentSettings = isPlainObject(existingCompany?.documentSettings)
        ? existingCompany.documentSettings as Record<string, unknown>
        : {};
    const documentSettingsInput = isPlainObject(input.documentSettings)
        ? input.documentSettings as Record<string, unknown>
        : {};
    const hasInvoiceBankAccountRefs = Object.prototype.hasOwnProperty.call(invoiceSettings, 'invoiceBankAccountRefs');
    if (hasInvoiceBankAccountRefs && !Array.isArray(invoiceSettings.invoiceBankAccountRefs)) {
        throw new Error('Daftar rekening instruksi invoice tidak valid');
    }
    const rawSelectedRefs = hasInvoiceBankAccountRefs
        ? Array.isArray(invoiceSettings.invoiceBankAccountRefs)
            ? invoiceSettings.invoiceBankAccountRefs
            : []
        : Array.isArray(existingInvoiceSettings.invoiceBankAccountRefs)
            ? existingInvoiceSettings.invoiceBankAccountRefs
            : [];
    const selectedRefs = rawSelectedRefs.filter(
        (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
    );
    const uniqueRefs = Array.from(new Set(selectedRefs));
    const validRows = uniqueRefs.length > 0
        ? (await Promise.all(uniqueRefs.map(ref => getDocumentById<BankAccountSummary>(ref, 'bankAccount'))))
            .filter((row): row is BankAccountSummary => row !== null && row.active !== false && row.accountType !== 'CASH')
            .map(row => ({ _id: row._id }))
        : [];
    const validRefSet = new Set(validRows.map(row => row._id));
    const invoiceBankAccountRefs = uniqueRefs.filter(ref => validRefSet.has(ref));
    const hasDefaultInvoiceBankAccountRef = Object.prototype.hasOwnProperty.call(invoiceSettings, 'defaultInvoiceBankAccountRef');
    if (
        hasDefaultInvoiceBankAccountRef
        && invoiceSettings.defaultInvoiceBankAccountRef !== undefined
        && typeof invoiceSettings.defaultInvoiceBankAccountRef !== 'string'
    ) {
        throw new Error('Rekening default instruksi invoice tidak valid');
    }
    const requestedDefaultRef =
        typeof invoiceSettings.defaultInvoiceBankAccountRef === 'string'
            ? invoiceSettings.defaultInvoiceBankAccountRef
            : !hasDefaultInvoiceBankAccountRef && typeof existingInvoiceSettings.defaultInvoiceBankAccountRef === 'string'
                ? existingInvoiceSettings.defaultInvoiceBankAccountRef
            : undefined;
    const defaultInvoiceBankAccountRef =
        requestedDefaultRef && invoiceBankAccountRefs.includes(requestedDefaultRef)
            ? requestedDefaultRef
            : invoiceBankAccountRefs[0];
    const hasInvoiceMode = Object.prototype.hasOwnProperty.call(invoiceSettings, 'invoiceMode');
    const rawInvoiceMode = normalizeOptionalText(invoiceSettings.invoiceMode)?.toUpperCase();
    if (hasInvoiceMode && (!rawInvoiceMode || (rawInvoiceMode !== 'DO' && rawInvoiceMode !== 'ORDER'))) {
        throw new Error('Mode invoice perusahaan tidak valid');
    }
    const hasDefaultTermDays = Object.prototype.hasOwnProperty.call(invoiceSettings, 'defaultTermDays');
    const rawDefaultTermDays = parseCompanyWholeNumberInput(invoiceSettings.defaultTermDays);
    if (hasDefaultTermDays && rawDefaultTermDays === null) {
        throw new Error('Termin default invoice tidak valid');
    }
    const hasDueDateDays = Object.prototype.hasOwnProperty.call(invoiceSettings, 'dueDateDays');
    const rawDueDateDays = parseCompanyWholeNumberInput(invoiceSettings.dueDateDays);
    if (hasDueDateDays && rawDueDateDays === null) {
        throw new Error('Jatuh tempo default invoice tidak valid');
    }
    const nextDefaultTermDays = hasDefaultTermDays
        ? rawDefaultTermDays ?? 0
        : sanitizeCompanyCounter(existingInvoiceSettings.defaultTermDays, 30);
    const nextDueDateDays = hasDueDateDays
        ? rawDueDateDays ?? 0
        : sanitizeCompanyCounter(existingInvoiceSettings.dueDateDays, 14);
    const counterConfigs = [
        ['resiCounter', 'Counter nomor resi tidak valid'],
        ['doCounter', 'Counter nomor surat jalan tidak valid'],
        ['invoiceCounter', 'Counter nomor invoice tidak valid'],
        ['notaCounter', 'Counter nomor invoice tidak valid'],
        ['receiptCounter', 'Counter nomor receipt tidak valid'],
        ['boronganCounter', 'Counter nomor borongan tidak valid'],
        ['bonCounter', 'Counter nomor bon tidak valid'],
        ['incidentCounter', 'Counter nomor insiden tidak valid'],
    ] as const;
    for (const [field, errorMessage] of counterConfigs) {
        if (Object.prototype.hasOwnProperty.call(numberingInput, field) && parseCompanyWholeNumberInput(numberingInput[field]) === null) {
            throw new Error(errorMessage);
        }
    }
    if (
        Object.prototype.hasOwnProperty.call(documentSettingsInput, 'showContact')
        && typeof documentSettingsInput.showContact !== 'boolean'
    ) {
        throw new Error('Pengaturan tampilkan kontak dokumen tidak valid');
    }
    if (
        Object.prototype.hasOwnProperty.call(documentSettingsInput, 'dateFormat')
        && normalizeCompanyDateFormatInput(documentSettingsInput.dateFormat) === null
    ) {
        throw new Error('Format tanggal dokumen tidak valid');
    }

    return {
        name: normalizeOptionalText(input.name) || normalizeOptionalText(existingCompany?.name) || 'PT Gading Mas Surya',
        address: normalizeOptionalText(input.address) || normalizeOptionalText(existingCompany?.address) || '-',
        phone: normalizeOptionalText(input.phone) || normalizeOptionalText(existingCompany?.phone) || '-',
        email: normalizeOptionalText(input.email) || normalizeOptionalText(existingCompany?.email) || '-',
        npwp: normalizeOptionalText(input.npwp) || normalizeOptionalText(existingCompany?.npwp),
        bankName: normalizeOptionalText(input.bankName) || normalizeOptionalText(existingCompany?.bankName),
        bankAccount: normalizeOptionalText(input.bankAccount) || normalizeOptionalText(existingCompany?.bankAccount),
        bankHolder: normalizeOptionalText(input.bankHolder) || normalizeOptionalText(existingCompany?.bankHolder),
        themeColor: sanitizeCompanyThemeColor(input.themeColor, sanitizeCompanyThemeColor(existingCompany?.themeColor)),
        secondaryThemeColor: sanitizeCompanyThemeColor(input.secondaryThemeColor, sanitizeCompanyThemeColor(existingCompany?.secondaryThemeColor)),
        logoUrl: sanitizeCompanyAssetUrl(input.logoUrl, 'Logo perusahaan') ?? sanitizeCompanyAssetUrl(existingCompany?.logoUrl, 'Logo perusahaan'),
        headerStampUrl:
            sanitizeCompanyAssetUrl(input.headerStampUrl, 'Header stamp perusahaan')
            ?? sanitizeCompanyAssetUrl(existingCompany?.headerStampUrl, 'Header stamp perusahaan'),
        signatureStampUrl:
            sanitizeCompanyAssetUrl(input.signatureStampUrl, 'Stempel tanda tangan perusahaan')
            ?? sanitizeCompanyAssetUrl(existingCompany?.signatureStampUrl, 'Stempel tanda tangan perusahaan'),
        numberingSettings: {
            resiPrefix: normalizeOptionalText(numberingInput.resiPrefix) || normalizeOptionalText(existingNumbering.resiPrefix) || 'R-',
            resiCounter: sanitizeCompanyCounter(numberingInput.resiCounter, sanitizeCompanyCounter(existingNumbering.resiCounter)),
            resiPeriod: normalizeOptionalText(numberingInput.resiPeriod) || normalizeOptionalText(existingNumbering.resiPeriod),
            doPrefix: normalizeOptionalText(numberingInput.doPrefix) || normalizeOptionalText(existingNumbering.doPrefix) || 'DO-',
            doCounter: sanitizeCompanyCounter(numberingInput.doCounter, sanitizeCompanyCounter(existingNumbering.doCounter)),
            doPeriod: normalizeOptionalText(numberingInput.doPeriod) || normalizeOptionalText(existingNumbering.doPeriod),
            invoicePrefix: normalizeOptionalText(numberingInput.invoicePrefix) || normalizeOptionalText(existingNumbering.invoicePrefix) || 'INV-',
            invoiceCounter: sanitizeCompanyCounter(numberingInput.invoiceCounter, sanitizeCompanyCounter(existingNumbering.invoiceCounter)),
            invoicePeriod: normalizeOptionalText(numberingInput.invoicePeriod) || normalizeOptionalText(existingNumbering.invoicePeriod),
            notaPrefix: normalizeOptionalText(numberingInput.notaPrefix) || normalizeOptionalText(existingNumbering.notaPrefix) || 'INV-',
            notaCounter: sanitizeCompanyCounter(numberingInput.notaCounter, sanitizeCompanyCounter(existingNumbering.notaCounter)),
            notaPeriod: normalizeOptionalText(numberingInput.notaPeriod) || normalizeOptionalText(existingNumbering.notaPeriod),
            notaSeriesCode: normalizeOptionalText(numberingInput.notaSeriesCode) || normalizeOptionalText(existingNumbering.notaSeriesCode) || '3',
            receiptPrefix: normalizeOptionalText(numberingInput.receiptPrefix) || normalizeOptionalText(existingNumbering.receiptPrefix) || 'RCV-',
            receiptCounter: sanitizeCompanyCounter(numberingInput.receiptCounter, sanitizeCompanyCounter(existingNumbering.receiptCounter)),
            receiptPeriod: normalizeOptionalText(numberingInput.receiptPeriod) || normalizeOptionalText(existingNumbering.receiptPeriod),
            boronganPrefix: normalizeOptionalText(numberingInput.boronganPrefix) || normalizeOptionalText(existingNumbering.boronganPrefix) || 'BRG-',
            boronganCounter: sanitizeCompanyCounter(numberingInput.boronganCounter, sanitizeCompanyCounter(existingNumbering.boronganCounter)),
            boronganPeriod: normalizeOptionalText(numberingInput.boronganPeriod) || normalizeOptionalText(existingNumbering.boronganPeriod),
            bonPrefix: normalizeOptionalText(numberingInput.bonPrefix) || normalizeOptionalText(existingNumbering.bonPrefix) || 'BON-',
            bonCounter: sanitizeCompanyCounter(numberingInput.bonCounter, sanitizeCompanyCounter(existingNumbering.bonCounter)),
            bonPeriod: normalizeOptionalText(numberingInput.bonPeriod) || normalizeOptionalText(existingNumbering.bonPeriod),
            incidentPrefix: normalizeOptionalText(numberingInput.incidentPrefix) || normalizeOptionalText(existingNumbering.incidentPrefix) || 'INC-',
            incidentCounter: sanitizeCompanyCounter(numberingInput.incidentCounter, sanitizeCompanyCounter(existingNumbering.incidentCounter)),
            incidentPeriod: normalizeOptionalText(numberingInput.incidentPeriod) || normalizeOptionalText(existingNumbering.incidentPeriod),
        },
        invoiceSettings: {
            defaultTermDays: Math.floor(nextDefaultTermDays),
            dueDateDays: Math.floor(nextDueDateDays),
            footerNote: normalizeOptionalText(invoiceSettings.footerNote) || normalizeOptionalText(existingInvoiceSettings.footerNote) || '',
            invoiceMode:
                rawInvoiceMode === 'DO' || rawInvoiceMode === 'ORDER'
                    ? rawInvoiceMode
                    : existingInvoiceSettings.invoiceMode === 'DO'
                        ? 'DO'
                        : 'ORDER',
            invoiceBankAccountRefs,
            defaultInvoiceBankAccountRef,
        },
        documentSettings: {
            showContact:
                typeof documentSettingsInput.showContact === 'boolean'
                    ? documentSettingsInput.showContact
                    : typeof existingDocumentSettings.showContact === 'boolean'
                        ? existingDocumentSettings.showContact
                        : true,
            dateFormat:
                normalizeCompanyDateFormatInput(documentSettingsInput.dateFormat)
                || normalizeCompanyDateFormatInput(existingDocumentSettings.dateFormat)
                || 'DD/MM/YYYY',
        },
    };
}

async function buildInvoiceInstructionAccountRemoval(accountId: string) {
    const company = await getCompanyProfile<CompanyProfile & { _id?: string; _rev?: string }>();
    if (!company?._id) {
        return null;
    }

    const selectedRefs: string[] = Array.isArray(company.invoiceSettings?.invoiceBankAccountRefs)
        ? company.invoiceSettings.invoiceBankAccountRefs.filter(
            (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
        )
        : [];
    const hasSelectedRef = selectedRefs.includes(accountId);
    const isDefaultRef = company.invoiceSettings?.defaultInvoiceBankAccountRef === accountId;

    if (!hasSelectedRef && !isDefaultRef) {
        return null;
    }

    if (!company._rev && !isSupabaseBackendEnabled()) {
        throw new Error('Revisi profil perusahaan tidak tersedia. Refresh lalu coba lagi.');
    }

    const nextRefs = selectedRefs.filter((ref: string) => ref !== accountId);
    const nextDefaultRef =
        nextRefs.includes(company.invoiceSettings?.defaultInvoiceBankAccountRef || '')
            ? company.invoiceSettings?.defaultInvoiceBankAccountRef
            : nextRefs[0];

    return {
        companyId: company._id,
        companyRev: company._rev,
        invoiceSettings: {
            ...company.invoiceSettings,
            invoiceBankAccountRefs: nextRefs,
            defaultInvoiceBankAccountRef: nextDefaultRef,
        },
    };
}

async function clearOtherCustomerScopedDefaults(docType: 'customerRecipient' | 'customerPickupLocation', customerRef: string, keepId: string) {
    const scopedDocs = await listDocumentsByFilter<{ _id: string; isDefault?: boolean; customerRef?: string }>(docType, { customerRef });
    const keepDoc = scopedDocs.find(doc => doc._id === keepId);
    if (!keepDoc) {
        return;
    }

    const docsToUnset = scopedDocs.filter(doc => doc._id !== keepId && doc.isDefault === true);
    if (keepDoc.isDefault === true && docsToUnset.length === 0) {
        return;
    }

    await updateDocument(keepId, { isDefault: true }, docType);
    for (const doc of docsToUnset) {
        await updateDocument(doc._id, { isDefault: false }, docType);
    }
}

function isProtectedLedgerEntity(entity: string) {
    return (
        entity === 'payments' ||
        entity === 'customer-receipts' ||
        entity === 'customer-overpayment-refunds' ||
        entity === 'invoice-adjustments' ||
        entity === 'incomes' ||
        entity === 'expenses' ||
        entity === 'bank-transactions' ||
        entity === 'purchase-payments' ||
        entity === 'chart-of-accounts' ||
        entity === 'journal-entries' ||
        entity === 'journal-lines' ||
        entity === 'accounting-periods'
    );
}

function isWorkflowManagedCreateEntity(entity: string) {
    return (
        entity === 'orders' ||
        entity === 'order-items' ||
        entity === 'delivery-orders' ||
        entity === 'delivery-order-items' ||
        entity === 'tracking-logs' ||
        entity === 'invoices' ||
        entity === 'invoice-items' ||
        entity === 'freight-notas' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borongans' ||
        entity === 'driver-borogan-items' ||
        entity === 'driver-borongan-items' ||
        entity === 'payments' ||
        entity === 'customer-receipts' ||
        entity === 'customer-overpayment-refunds' ||
        entity === 'purchases' ||
        entity === 'purchase-items' ||
        entity === 'purchase-payments' ||
        entity === 'stock-movements' ||
        entity === 'invoice-adjustments' ||
        entity === 'incomes' ||
        entity === 'expenses' ||
        entity === 'bank-transactions' ||
        entity === 'chart-of-accounts' ||
        entity === 'journal-entries' ||
        entity === 'journal-lines' ||
        entity === 'accounting-periods' ||
        entity === 'driver-vouchers' ||
        entity === 'driver-voucher-items' ||
        entity === 'driver-voucher-disbursements' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
        entity === 'incident-settlement-lines' ||
        entity === 'tire-history-logs' ||
        entity === 'audit-logs'
    );
}

function isWorkflowManagedUpdateEntity(entity: string) {
    return (
        entity === 'orders' ||
        entity === 'order-items' ||
        entity === 'delivery-order-items' ||
        entity === 'tracking-logs' ||
        entity === 'customer-overpayment-refunds' ||
        entity === 'purchases' ||
        entity === 'purchase-items' ||
        entity === 'purchase-payments' ||
        entity === 'stock-movements' ||
        entity === 'driver-vouchers' ||
        entity === 'freight-notas' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borongans' ||
        entity === 'driver-borogan-items' ||
        entity === 'driver-borongan-items' ||
        entity === 'driver-voucher-items' ||
        entity === 'driver-voucher-disbursements' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
        entity === 'incident-settlement-lines' ||
        entity === 'tire-history-logs' ||
        entity === 'audit-logs'
    );
}

function isWorkflowManagedDeleteEntity(entity: string) {
    return (
        entity === 'driver-vouchers' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
        entity === 'incident-settlement-lines' ||
        entity === 'tire-history-logs' ||
        entity === 'delivery-orders' ||
        entity === 'delivery-order-items' ||
        entity === 'order-items' ||
        entity === 'invoice-items' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borogan-items' ||
        entity === 'driver-borongan-items' ||
        entity === 'tracking-logs'
        || entity === 'customer-overpayment-refunds'
        || entity === 'purchases'
        || entity === 'purchase-items'
        || entity === 'purchase-payments'
        || entity === 'stock-movements'
    );
}

function buildCreateSummary(newDoc: Record<string, unknown>, fallbackId: string) {
    if (newDoc._type === 'employee') {
        return buildEmployeeSummary(newDoc, fallbackId);
    }
    if (newDoc._type === 'employeeAttendanceRecord') {
        return buildEmployeeAttendanceSummary(newDoc, fallbackId);
    }
    return (
        (newDoc.originArea && newDoc.destinationArea
            ? `${newDoc.originArea} -> ${newDoc.destinationArea}${newDoc.serviceName ? ` (${newDoc.serviceName})` : ''}`
            : undefined) ||
        newDoc.masterResi ||
        newDoc.doNumber ||
        newDoc.purchaseNumber ||
        newDoc.invoiceNumber ||
        newDoc.notaNumber ||
        newDoc.boronganNumber ||
        newDoc.incidentNumber ||
        newDoc.itemCode ||
        newDoc.supplierCode ||
        newDoc.label ||
        newDoc.name ||
        fallbackId
    );
}

function buildCreateAuditSummary(entity: string, newDoc: Record<string, unknown>, fallbackId: string) {
    if (entity === 'employees') {
        return `Tambah karyawan ${buildEmployeeSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'employee-attendance-records') {
        return `Catat absensi ${buildEmployeeAttendanceSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'suppliers') {
        return `Tambah supplier ${buildCreateSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'supplier-item-prices') {
        return `Tambah harga barang supplier ${buildCreateSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'warehouse-items') {
        return `Tambah barang gudang ${buildCreateSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'tire-events') {
        return `Tambah ban ${(newDoc as Record<string, unknown>).tireCode}: ${(newDoc as Record<string, unknown>).posisi} (${(newDoc as Record<string, unknown>).status})`;
    }
    return `Created ${entity}: ${buildCreateSummary(newDoc, fallbackId)}`;
}

async function resolveTrackedTireWarehouseItem(itemRef: string) {
    const item = await getDocumentById<WarehouseItem & { _rev?: string }>(itemRef, 'warehouseItem');
    if (!item || item._type !== 'warehouseItem') {
        throw new Error('Master barang gudang ban tidak ditemukan');
    }
    if (!isTireTrackedWarehouseItem(item)) {
        throw new Error('Master barang gudang terkait ban harus bertipe ban tertracking');
    }
    return item;
}

async function appendTrackedTireWarehouseSync(params: {
    previousDoc: Record<string, unknown> | null;
    nextDoc: Record<string, unknown>;
    session: Pick<ApiSession, '_id' | 'name'>;
}) {
    const previousItemRef = normalizeOptionalText(params.previousDoc?.linkedWarehouseItemRef);
    const nextItemRef = normalizeOptionalText(params.nextDoc.linkedWarehouseItemRef);
    if (previousItemRef && nextItemRef && previousItemRef !== nextItemRef) {
        throw new Error('Master barang gudang ban yang sudah terhubung tidak boleh diganti');
    }
    const itemRef = nextItemRef || previousItemRef;
    if (!itemRef) {
        return;
    }

    const warehouseItem = await resolveTrackedTireWarehouseItem(itemRef);
    if (!warehouseItem._rev && !isSupabaseBackendEnabled()) {
        throw new Error('Revisi master barang gudang ban tidak tersedia. Refresh lalu coba lagi.');
    }
    const countedBefore = countsTowardTrackedTireWarehouseStock(params.previousDoc || {});
    const countedAfter = countsTowardTrackedTireWarehouseStock(params.nextDoc);
    if (countedBefore === countedAfter) {
        return;
    }

    const currentStockQty = Math.max(normalizeNumber(warehouseItem.currentStockQty ?? 0), 0);
    const nextStockQty = countedAfter ? currentStockQty + 1 : currentStockQty - 1;
    if (nextStockQty < 0) {
        throw new Error('Stok gudang ban terkait tidak cukup untuk perpindahan ini');
    }

    const previousPlacement = params.previousDoc ? resolveTrackedTirePlacementLabel(params.previousDoc) : undefined;
    const nextPlacement = resolveTrackedTirePlacementLabel(params.nextDoc);
    const tireCode = normalizeOptionalText(params.nextDoc.tireCode) || normalizeOptionalText(params.previousDoc?.tireCode) || itemRef;

    await updateDocument(warehouseItem._id, { currentStockQty: nextStockQty }, 'warehouseItem');
    await createDocument(buildTrackedTireStockMovementDoc({
        warehouseItem,
        quantity: 1,
        balanceAfter: nextStockQty,
        movementDate: getBusinessDateValue(),
        type: countedAfter ? 'IN' : 'OUT',
        sourceType: countedAfter ? 'TIRE_RETURN' : 'TIRE_DEPLOYMENT',
        sourceRef: typeof params.nextDoc._id === 'string' ? params.nextDoc._id : undefined,
        sourceNumber: tireCode,
        note: buildTrackedTireWarehouseNote({
            tireCode,
            fromPlacement: previousPlacement,
            toPlacement: nextPlacement,
        }),
        createdBy: params.session._id,
        createdByName: params.session.name,
    }));
}

function buildTireEventResponseError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    const status =
        message.includes('tidak ditemukan')
            ? 404
            : message.includes('tidak aktif') || message.includes('tidak cukup') || message.includes('tidak tersedia')
                ? 409
                : 400;
    return NextResponse.json({ error: message }, { status });
}

function roundTireMoney(value: number) {
    return Math.round(value);
}

function roundTirePercent(value: number) {
    return Math.round(value * 100) / 100;
}

function normalizeTireOriginalCost(input: Record<string, unknown>) {
    const parsed = normalizeCurrencyNumber(input.originalCost ?? input.purchaseCost ?? 0);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function normalizeTireMaintenancePostedPercent(input: Record<string, unknown>) {
    const parsed = normalizeNumber(input.maintenanceCostPostedPercent ?? 0, { maxFractionDigits: 2 });
    return Math.max(0, Math.min(Number.isFinite(parsed) ? parsed : 0, 100));
}

function isInternalVehicleExit(previous: Record<string, unknown>, next: Record<string, unknown>) {
    const previousHolderType = normalizeOptionalText(previous.holderType);
    const previousVehicleRef = normalizeOptionalText(previous.vehicleRef);
    if (previousHolderType !== 'INTERNAL_VEHICLE' || !previousVehicleRef) {
        return false;
    }
    const nextHolderType = normalizeOptionalText(next.holderType);
    const nextVehicleRef = normalizeOptionalText(next.vehicleRef);
    return nextHolderType !== 'INTERNAL_VEHICLE' || nextVehicleRef !== previousVehicleRef;
}

function buildTireUsageAllocation(params: {
    previous: Record<string, unknown>;
    next: Record<string, unknown>;
    updates: Record<string, unknown>;
}) {
    const isVehicleExit = isInternalVehicleExit(params.previous, params.next);
    const previousTotalUsedPercent = Math.max(normalizeNumber(params.previous.totalUsedPercent ?? 0, { maxFractionDigits: 2 }), 0);
    const requestedTotalUsedPercent = Math.max(normalizeNumber(params.next.totalUsedPercent ?? params.previous.totalUsedPercent ?? 0, { maxFractionDigits: 2 }), 0);
    const currentTotalUsedPercent = isVehicleExit ? previousTotalUsedPercent : requestedTotalUsedPercent;
    if (!isVehicleExit) {
        return {
            tireUpdates: {
                totalUsedPercent: roundTirePercent(Math.min(currentTotalUsedPercent, 100)),
                remainingPercent: roundTirePercent(Math.max(100 - Math.min(currentTotalUsedPercent, 100), 0)),
                remainingValue: roundTireMoney(
                    normalizeTireOriginalCost(params.next)
                    * Math.max(100 - Math.min(currentTotalUsedPercent, 100), 0)
                    / 100
                ),
            },
            historyFields: {},
        };
    }

    const hasUsageInput = Object.prototype.hasOwnProperty.call(params.updates, 'usagePercentOnExit');
    const usagePercent = hasUsageInput
        ? normalizeNumber(params.updates.usagePercentOnExit, { maxFractionDigits: 2 })
        : Number.NaN;
    if (!Number.isFinite(usagePercent)) {
        throw new Error('Persentase pemakaian ban wajib diisi saat ban keluar dari kendaraan');
    }

    const remainingBefore = roundTirePercent(Math.max(100 - currentTotalUsedPercent, 0));
    if (usagePercent < 0) {
        throw new Error('Persentase pemakaian ban tidak boleh negatif');
    }
    if (usagePercent > remainingBefore) {
        throw new Error(`Persentase pemakaian ban melebihi sisa ${remainingBefore}%`);
    }

    const originalCost = normalizeTireOriginalCost(params.next);
    const nextTotalUsedPercent = roundTirePercent(Math.min(currentTotalUsedPercent + usagePercent, 100));
    const remainingPercentAfter = roundTirePercent(Math.max(100 - nextTotalUsedPercent, 0));
    const remainingValueAfter = roundTireMoney(originalCost * remainingPercentAfter / 100);
    const usageCost = roundTireMoney(originalCost * usagePercent / 100);

    return {
        tireUpdates: {
            totalUsedPercent: nextTotalUsedPercent,
            remainingPercent: remainingPercentAfter,
            remainingValue: remainingValueAfter,
        },
        historyFields: {
            usagePercent,
            usageCost,
            costAllocationType: 'USAGE_ON_EXIT',
            costSourceVehicleRef: normalizeOptionalText(params.previous.vehicleRef),
            costSourceVehiclePlate: normalizeOptionalText(params.previous.vehiclePlate),
            remainingPercentAfter,
            remainingValueAfter,
        } satisfies Partial<TireHistoryLog>,
    };
}

function buildWarehouseTirePlacement(status: string) {
    return buildTirePlacementLabel({
        holderType: 'WAREHOUSE',
        status,
    });
}

export async function handleTireInstallToSlot(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const installingTireRef = normalizeOptionalText(data.tireEventRef || data.installingTireRef || data.id);
    const vehicleRef = normalizeOptionalText(data.vehicleRef);
    const slotCode = normalizeTireSlotCode(normalizeOptionalText(data.slotCode) || '');
    const maintenanceDate = normalizeOptionalText(data.maintenanceDate) || getBusinessDateValue();
    const oldTireDestination = normalizeOptionalText(data.oldTireDestination) === 'SCRAPPED' ? 'SCRAPPED' : 'WAREHOUSE';
    const oldUsagePercent = Object.prototype.hasOwnProperty.call(data, 'oldTireUsagePercent')
        ? normalizeNumber(data.oldTireUsagePercent, { maxFractionDigits: 2 })
        : Number.NaN;
    const sourceUsagePercent = Object.prototype.hasOwnProperty.call(data, 'sourceTireUsagePercent')
        ? normalizeNumber(data.sourceTireUsagePercent, { maxFractionDigits: 2 })
        : Number.NaN;
    const existingMaintenanceRef = normalizeOptionalText(data.maintenanceRef);
    const rawLaborCost = data.laborCost ?? data.technicianCost;
    const laborCost = rawLaborCost === undefined || rawLaborCost === null || rawLaborCost === ''
        ? 0
        : normalizeCurrencyNumber(rawLaborCost);
    const laborBankAccountRef = normalizeOptionalText(data.laborBankAccountRef);
    const vendor = normalizeOptionalText(data.vendor);
    const note = normalizeOptionalText(data.note);

    if (!installingTireRef || !vehicleRef || !slotCode) {
        return NextResponse.json({ error: 'Ban, kendaraan, dan slot wajib dipilih' }, { status: 400 });
    }
    if (!isKnownInternalTireSlotCode(slotCode)) {
        return NextResponse.json({ error: 'Kode slot ban tidak valid' }, { status: 400 });
    }
    assertIsoDate(maintenanceDate, 'Tanggal pasang ban');
    if (!Number.isFinite(laborCost) || laborCost < 0) {
        return NextResponse.json({ error: 'Biaya teknisi tidak valid' }, { status: 400 });
    }

    const [vehicle, installingTire, activeTires, existingMaintenance] = await Promise.all([
        getDocumentById<Record<string, unknown>>(vehicleRef, 'vehicle'),
        getDocumentById<Record<string, unknown>>(installingTireRef, 'tireEvent'),
        listDocumentsByFilter<Record<string, unknown>>('tireEvent', {
            vehicleRef,
            holderType: 'INTERNAL_VEHICLE',
            status: 'IN_USE',
        }),
        existingMaintenanceRef ? getDocumentById<Maintenance>(existingMaintenanceRef, 'maintenance') : Promise.resolve(null),
    ]);

    if (!vehicle) {
        return NextResponse.json({ error: 'Kendaraan tidak ditemukan' }, { status: 404 });
    }
    if (normalizeOptionalText(vehicle.status) === 'SOLD') {
        return NextResponse.json({ error: 'Kendaraan yang sudah dijual tidak bisa dipasang ban' }, { status: 409 });
    }
    if (existingMaintenanceRef) {
        if (!existingMaintenance) {
            return NextResponse.json({ error: 'Maintenance ban tidak ditemukan' }, { status: 404 });
        }
        if (existingMaintenance.vehicleRef !== vehicleRef) {
            return NextResponse.json({ error: 'Maintenance ban tidak sesuai kendaraan yang dipilih' }, { status: 409 });
        }
        if (existingMaintenance.status !== 'SCHEDULED') {
            return NextResponse.json({ error: 'Maintenance ban sudah selesai atau dilewati' }, { status: 409 });
        }
    }
    if (!installingTire) {
        return NextResponse.json({ error: 'Ban pengganti tidak ditemukan' }, { status: 404 });
    }
    const installingSourceVehicleRef = normalizeOptionalText(installingTire.vehicleRef);
    if (installingSourceVehicleRef === vehicleRef) {
        return NextResponse.json({ error: 'Ban sumber sudah berada pada unit tujuan. Pilih ban dari gudang atau unit lain.' }, { status: 409 });
    }
    const installingComesFromInternalUnit =
        normalizeOptionalText(installingTire.holderType) === 'INTERNAL_VEHICLE' &&
        normalizeOptionalText(installingTire.status) === 'IN_USE' &&
        Boolean(installingSourceVehicleRef);
    if (installingComesFromInternalUnit && !Number.isFinite(sourceUsagePercent)) {
        return NextResponse.json({ error: 'Persentase pemakaian ban di unit sumber wajib diisi' }, { status: 400 });
    }
    if (
        normalizeOptionalText(installingTire.holderType) === 'INTERNAL_VEHICLE' &&
        normalizeOptionalText(installingTire.status) === 'IN_USE' &&
        !installingSourceVehicleRef
    ) {
        return NextResponse.json({ error: 'Lokasi unit sumber ban tidak lengkap. Perbarui data ban sebelum dipasang.' }, { status: 409 });
    }
    const oldTire = activeTires.find(item =>
        normalizeOptionalText(item._id) !== installingTireRef &&
        normalizeTireSlotCode(normalizeOptionalText(item.slotCode) || '') === slotCode
    ) || null;
    if (oldTire && !Number.isFinite(oldUsagePercent)) {
        return NextResponse.json({ error: 'Persentase pemakaian ban lama wajib diisi saat slot terisi' }, { status: 400 });
    }

    const vehiclePlate = normalizeOptionalText(vehicle.plateNumber);
    const slotLabel = formatTireSlotLabel(slotCode);
    const installOriginalCost = normalizeTireOriginalCost(installingTire);
    if (installOriginalCost <= 0) {
        return NextResponse.json({ error: 'Harga/original cost ban pengganti wajib lebih dari 0' }, { status: 400 });
    }
    const installPostedBefore = normalizeTireMaintenancePostedPercent(installingTire);
    const installPostedPercent = roundTirePercent(Math.max(100 - installPostedBefore, 0));
    const installCost = roundTireMoney(installOriginalCost * installPostedPercent / 100);

    let sourceUsageAllocation: ReturnType<typeof buildTireUsageAllocation> | null = null;
    let oldUsageAllocation: ReturnType<typeof buildTireUsageAllocation> | null = null;
    let oldNextDoc: Record<string, unknown> | null = null;
    if (oldTire) {
        oldNextDoc = {
            ...oldTire,
            holderType: 'WAREHOUSE',
            status: oldTireDestination === 'SCRAPPED' ? 'SCRAPPED' : 'IN_WAREHOUSE',
            vehicleRef: undefined,
            vehiclePlate: undefined,
            slotCode: undefined,
            slotLabel: undefined,
            posisi: buildWarehouseTirePlacement(oldTireDestination === 'SCRAPPED' ? 'SCRAPPED' : 'IN_WAREHOUSE'),
            positionKey: 'gudang ban',
            replaceDate: maintenanceDate,
        };
        try {
            oldUsageAllocation = buildTireUsageAllocation({
                previous: oldTire,
                next: oldNextDoc,
                updates: { usagePercentOnExit: oldUsagePercent },
            });
            Object.assign(oldNextDoc, oldUsageAllocation.tireUpdates);
        } catch (error) {
            return buildTireEventResponseError(error, 'Pemakaian ban lama tidak valid');
        }
    }

    const oldUsageCost = roundTireMoney(Number(oldUsageAllocation?.historyFields?.usageCost || 0));
    const shouldPostOldUsageMaintenance = Boolean(oldTire && roundTirePercent(oldUsagePercent) > 1 && oldUsageCost > 0);
    const postedOldUsageCost = shouldPostOldUsageMaintenance ? oldUsageCost : 0;
    const totalTireMaintenanceCost = postedOldUsageCost + installCost;
    const totalMaintenanceCost = totalTireMaintenanceCost + laborCost;
    const maintenanceRef = existingMaintenance?._id;
    const oldLine = oldTire
        ? `Ban lama ${normalizeOptionalText(oldTire.tireCode) || oldTire._id}: ${oldUsagePercent}% = Rp${oldUsageCost.toLocaleString('id-ID')}`
        : 'Slot kosong';
    const newLine = `Ban baru ${normalizeOptionalText(installingTire.tireCode) || installingTireRef}: ${installPostedPercent}% = Rp${installCost.toLocaleString('id-ID')}`;
    const materialUsages = [
        ...(shouldPostOldUsageMaintenance && oldTire ? [{
            warehouseItemRef: `tire:${normalizeOptionalText(oldTire._id) || ''}`,
            itemCode: normalizeOptionalText(oldTire.tireCode),
            itemName: `Pemakaian ban lama ${normalizeOptionalText(oldTire.tireCode) || ''}`.trim(),
            category: 'Ban',
            unit: 'PCS' as const,
            quantity: 1,
            unitCostSnapshot: oldUsageCost,
            subtotalCost: oldUsageCost,
            note: `${roundTirePercent(oldUsagePercent)}% pemakaian di ${vehiclePlate || vehicleRef}`,
        }] : []),
        ...(installCost > 0 ? [{
            warehouseItemRef: `tire:${installingTireRef}`,
            itemCode: normalizeOptionalText(installingTire.tireCode),
            itemName: `Pasang ban pengganti ${normalizeOptionalText(installingTire.tireCode) || ''}`.trim(),
            category: 'Ban',
            unit: 'PCS' as const,
            quantity: 1,
            unitCostSnapshot: installCost,
            subtotalCost: installCost,
            note: `${roundTirePercent(installPostedPercent)}% biaya ban diposting saat pasang`,
        }] : []),
    ];
    const maintenanceDoc: Maintenance | null = existingMaintenance ? {
        ...existingMaintenance,
        vehicleRef,
        vehiclePlate,
        type: existingMaintenance.type || 'Ganti / Pasang Ban',
        status: 'DONE',
        completedDate: maintenanceDate,
        vendor: vendor || existingMaintenance.vendor,
        notes: note || existingMaintenance.notes,
        completionNotes: [oldLine, newLine, note || existingMaintenance.completionNotes].filter(Boolean).join('\n'),
        materialUsages,
        materialUsageCount: materialUsages.length,
        materialCostTotal: totalTireMaintenanceCost,
        laborCost,
        totalCost: totalMaintenanceCost,
        cost: totalMaintenanceCost,
        source: 'TIRE_REPLACEMENT',
    } : null;

    const installingNextDoc: Record<string, unknown> = {
        ...installingTire,
        holderType: 'INTERNAL_VEHICLE',
        status: 'IN_USE',
        vehicleRef,
        vehiclePlate,
        slotCode,
        slotLabel,
        posisi: buildTirePlacementLabel({
            holderType: 'INTERNAL_VEHICLE',
            status: 'IN_USE',
            vehiclePlate,
            slotCode,
        }),
        positionKey: slotCode.toLowerCase(),
        installDate: maintenanceDate,
        maintenanceCostPostedPercent: roundTirePercent(Math.min(100, installPostedBefore + installPostedPercent)),
        maintenanceCostPostedAmount: roundTireMoney(normalizeCurrencyNumber(installingTire.maintenanceCostPostedAmount ?? 0) + installCost),
        lastMaintenanceCostRef: maintenanceRef || undefined,
        externalPartyName: undefined,
        externalPlateNumber: undefined,
    };
    if (installingComesFromInternalUnit) {
        try {
            sourceUsageAllocation = buildTireUsageAllocation({
                previous: installingTire,
                next: installingNextDoc,
                updates: { usagePercentOnExit: sourceUsagePercent },
            });
            Object.assign(installingNextDoc, sourceUsageAllocation.tireUpdates);
        } catch (error) {
            return buildTireEventResponseError(error, 'Pemakaian ban di unit sumber tidak valid');
        }
    }

    const oldHistory = oldTire && oldNextDoc
        ? buildTireHistoryLogDoc({
            tireEventRef: normalizeOptionalText(oldTire._id) || '',
            tireCode: normalizeOptionalText(oldTire.tireCode) || normalizeOptionalText(oldTire._id) || '',
            tireBrand: normalizeOptionalText(oldTire.tireBrand),
            tireSize: normalizeOptionalText(oldTire.tireSize),
            previous: buildTireHistorySnapshot(oldTire),
            next: buildTireHistorySnapshot(oldNextDoc),
            session,
            note: `Diganti dari ${vehiclePlate || '-'} slot ${slotCode}`,
        })
        : null;
    if (oldHistory && oldUsageAllocation) {
        Object.assign(oldHistory, oldUsageAllocation.historyFields);
        if (maintenanceRef) {
            Object.assign(oldHistory, { relatedMaintenanceRef: maintenanceRef });
        }
    }

    const installHistory = buildTireHistoryLogDoc({
        tireEventRef: installingTireRef,
        tireCode: normalizeOptionalText(installingTire.tireCode) || installingTireRef,
        tireBrand: normalizeOptionalText(installingTire.tireBrand),
        tireSize: normalizeOptionalText(installingTire.tireSize),
        previous: buildTireHistorySnapshot(installingTire),
        next: buildTireHistorySnapshot(installingNextDoc),
        session,
        note: `Pasang ban ke ${vehiclePlate || '-'} slot ${slotCode}`,
    });
    Object.assign(installHistory, {
        usagePercent: installPostedPercent,
        usageCost: installCost,
        costAllocationType: 'INSTALL_FULL',
        costSourceVehicleRef: vehicleRef,
        costSourceVehiclePlate: vehiclePlate,
        remainingPercentAfter: normalizeNumber(installingNextDoc.remainingPercent ?? Math.max(100 - Number(installingNextDoc.totalUsedPercent || 0), 0), { maxFractionDigits: 2 }),
        remainingValueAfter: normalizeCurrencyNumber(installingNextDoc.remainingValue ?? 0),
    } satisfies Partial<TireHistoryLog>);
    if (maintenanceRef) {
        Object.assign(installHistory, { relatedMaintenanceRef: maintenanceRef });
    }
    const sourceUsageHistory = installingComesFromInternalUnit && sourceUsageAllocation
        ? buildTireHistoryLogDoc({
            tireEventRef: installingTireRef,
            tireCode: normalizeOptionalText(installingTire.tireCode) || installingTireRef,
            tireBrand: normalizeOptionalText(installingTire.tireBrand),
            tireSize: normalizeOptionalText(installingTire.tireSize),
            previous: buildTireHistorySnapshot(installingTire),
            next: buildTireHistorySnapshot(installingNextDoc),
            session,
            note: `Pemakaian ban dicatat saat pindah dari ${normalizeOptionalText(installingTire.vehiclePlate) || '-'} ke ${vehiclePlate || '-'} slot ${slotCode}`,
        })
        : null;
    if (sourceUsageHistory && sourceUsageAllocation) {
        Object.assign(sourceUsageHistory, sourceUsageAllocation.historyFields);
        if (maintenanceRef) {
            Object.assign(sourceUsageHistory, { relatedMaintenanceRef: maintenanceRef });
        }
    }

    try {
        if (!existingMaintenance && laborCost > 0) {
            return NextResponse.json({ error: 'Biaya teknisi hanya bisa dicatat dari penyelesaian maintenance ban' }, { status: 400 });
        }
        const laborPosting = await prepareMaintenanceLaborExpensePosting(laborCost, laborBankAccountRef);
        const laborExpenseRef = laborPosting
            ? await createMaintenanceLaborExpense({
                session,
                maintenance: maintenanceDoc as Maintenance,
                category: laborPosting.category,
                bankAccount: laborPosting.bankAccount,
                nextBankBalance: laborPosting.nextBankBalance,
                completedDate: maintenanceDate,
                laborCost,
                vendor,
                completionNotes: note,
            })
            : undefined;
        if (existingMaintenance && maintenanceDoc && maintenanceRef) {
            await updateDocument(maintenanceRef, {
                status: 'DONE',
                completedDate: maintenanceDate,
                vendor: vendor || null,
                notes: maintenanceDoc.notes,
                completionNotes: maintenanceDoc.completionNotes,
                materialUsages,
                materialUsageCount: materialUsages.length,
                materialCostTotal: totalTireMaintenanceCost,
                laborCost: laborCost > 0 ? laborCost : null,
                laborExpenseRef: laborExpenseRef || null,
                relatedExpenseRef: laborExpenseRef || null,
                laborBankAccountRef: laborPosting?.bankAccount?._id || null,
                laborBankAccountName: laborPosting?.bankAccount?.bankName || null,
                laborBankAccountNumber: laborPosting?.bankAccount?.accountNumber || null,
                totalCost: totalMaintenanceCost,
                cost: totalMaintenanceCost,
                source: 'TIRE_REPLACEMENT',
            }, 'maintenance');
        }
        if (oldTire && oldNextDoc) {
            await updateDocument(normalizeOptionalText(oldTire._id) || '', {
                holderType: oldNextDoc.holderType,
                status: oldNextDoc.status,
                vehicleRef: null,
                vehiclePlate: null,
                slotCode: null,
                slotLabel: null,
                posisi: oldNextDoc.posisi,
                positionKey: oldNextDoc.positionKey,
                replaceDate: oldNextDoc.replaceDate,
                ...oldUsageAllocation?.tireUpdates,
            }, 'tireEvent');
            if (oldHistory) {
                await createDocument(oldHistory);
            }
            await appendTrackedTireWarehouseSync({
                previousDoc: oldTire,
                nextDoc: { ...oldNextDoc, _id: oldTire._id },
                session,
            });
        }
        await updateDocument(installingTireRef, {
            holderType: installingNextDoc.holderType,
            status: installingNextDoc.status,
            vehicleRef,
            vehiclePlate,
            slotCode,
            slotLabel,
            posisi: installingNextDoc.posisi,
            positionKey: installingNextDoc.positionKey,
            installDate: installingNextDoc.installDate,
            maintenanceCostPostedPercent: installingNextDoc.maintenanceCostPostedPercent,
            maintenanceCostPostedAmount: installingNextDoc.maintenanceCostPostedAmount,
            ...(maintenanceRef ? { lastMaintenanceCostRef: maintenanceRef } : {}),
            ...sourceUsageAllocation?.tireUpdates,
            externalPartyName: null,
            externalPlateNumber: null,
        }, 'tireEvent');
        if (sourceUsageHistory) {
            await createDocument(sourceUsageHistory);
        }
        await createDocument(installHistory);
        await appendTrackedTireWarehouseSync({
            previousDoc: installingTire,
            nextDoc: { ...installingNextDoc, _id: installingTireRef },
            session,
        });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data ban berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        return buildTireEventResponseError(error, 'Gagal memasang ban');
    }

    await addAuditLog(
        session,
        'UPDATE',
        'tire-events',
        installingTireRef,
        `Pasang ban ${normalizeOptionalText(installingTire.tireCode) || installingTireRef} ke ${vehiclePlate || vehicleRef} slot ${slotCode}`
    );

    const updatedTire = await getDocumentById<Record<string, unknown>>(installingTireRef, 'tireEvent');
    return NextResponse.json({
        data: updatedTire,
        maintenance: maintenanceDoc,
        summary: {
            oldTireUsageCost: oldUsageCost,
            sourceTireUsageCost: roundTireMoney(Number(sourceUsageAllocation?.historyFields?.usageCost || 0)),
            installCost,
            technicianCost: laborCost,
            totalMaintenanceCost,
            maintenanceRef,
        },
    });
}

function isDocumentAlreadyExistsError(error: unknown, documentId?: string) {
    const statusCode =
        isPlainObject(error) && typeof error.statusCode === 'number'
            ? error.statusCode
            : isPlainObject(error) && typeof error.status === 'number'
                ? error.status
                : undefined;
    const message =
        error instanceof Error
            ? error.message
            : isPlainObject(error) && typeof error.message === 'string'
                ? error.message
                : '';

    if (statusCode !== 409 && !/already exists/i.test(message)) {
        return false;
    }
    if (!documentId) {
        return /already exists/i.test(message);
    }
    return message.includes(documentId) && /already exists/i.test(message);
}

function normalizeDateOnlyValue(value: unknown) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
        ? value.slice(0, 10)
        : '';
}

function dateBefore(dateValue: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return '';
    const date = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return '';
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function valuesDiffer(left: unknown, right: unknown) {
    const leftNumber = typeof left === 'number' ? left : Number(left);
    const rightNumber = typeof right === 'number' ? right : Number(right);
    if (Number.isFinite(leftNumber) || Number.isFinite(rightNumber)) {
        return Math.round(Number.isFinite(leftNumber) ? leftNumber : 0) !== Math.round(Number.isFinite(rightNumber) ? rightNumber : 0);
    }
    return String(left || '') !== String(right || '');
}

function supplierPriceHistoricalFieldsChanged(existing: Record<string, unknown>, updates: Record<string, unknown>) {
    const protectedFields = ['supplierRef', 'warehouseItemRef', 'defaultPurchasePrice', 'effectiveFrom', 'effectiveTo'];
    return protectedFields.some((field) => {
        if (!Object.prototype.hasOwnProperty.call(updates, field)) return false;
        if (field === 'effectiveFrom' || field === 'effectiveTo') {
            return normalizeDateOnlyValue(existing[field]) !== normalizeDateOnlyValue(updates[field]);
        }
        return valuesDiffer(existing[field], updates[field]);
    });
}

function supplierPriceRevisionFieldsChanged(existing: SupplierItemPrice, next: Record<string, unknown>) {
    return (
        valuesDiffer(existing.defaultPurchasePrice, next.defaultPurchasePrice) ||
        normalizeDateOnlyValue(existing.effectiveFrom) !== normalizeDateOnlyValue(next.effectiveFrom) ||
        normalizeDateOnlyValue(existing.effectiveTo) !== normalizeDateOnlyValue(next.effectiveTo)
    );
}

export async function handleSupplierItemPriceRevise(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const updatesInput = isPlainObject(data.updates) ? data.updates : null;
    if (!id || !updatesInput) {
        return NextResponse.json({ error: 'Data revisi harga barang supplier tidak valid' }, { status: 400 });
    }

    const existing = await getDocumentById<(SupplierItemPrice & { _rev?: string })>(id, 'supplierItemPrice');
    if (!existing) {
        return NextResponse.json({ error: 'Harga barang supplier tidak ditemukan' }, { status: 404 });
    }
    if (!existing._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi harga barang supplier tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    let sanitized: Record<string, unknown>;
    try {
        sanitized = await normalizeSupplierItemPricePayload(updatesInput, existing as unknown as Record<string, unknown>);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Data harga barang supplier tidak valid' },
            { status: 400 }
        );
    }

    const relatedPurchaseItem = await listDocumentsByFilter<{ _id: string }>('purchaseItem', { supplierItemPriceRef: id })
        .then(rows => rows[0] || null);
    const shouldCreateRevision =
        existing.active !== false &&
        sanitized.active !== false &&
        Boolean(relatedPurchaseItem) &&
        supplierPriceRevisionFieldsChanged(existing, sanitized);
    const touchesHistoricalFields = supplierPriceHistoricalFieldsChanged(
        existing as unknown as Record<string, unknown>,
        sanitized
    );

    if (!shouldCreateRevision) {
        if (relatedPurchaseItem && touchesHistoricalFields) {
            return NextResponse.json(
                { error: 'Harga supplier historis yang sudah dipakai pembelian tidak boleh ditimpa. Gunakan revisi harga dari versi aktif agar histori tetap utuh.' },
                { status: 409 }
            );
        }
        try {
            const updated = await updateDocument(id, sanitized, 'supplierItemPrice');
            await addAuditLog(
                session,
                'UPDATE',
                'supplier-item-prices',
                id,
                `Perbarui harga barang supplier ${buildCreateSummary(updated as Record<string, unknown>, id)}`
            );
            return NextResponse.json({ success: true, data: updated, id });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Harga barang supplier berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    const now = new Date().toISOString();
    const nextEffectiveFrom = normalizeDateOnlyValue(sanitized.effectiveFrom) || getBusinessDateValue();
    const previousDate = dateBefore(nextEffectiveFrom);
    const existingEffectiveFrom = normalizeDateOnlyValue(existing.effectiveFrom);
    if (existingEffectiveFrom && nextEffectiveFrom < existingEffectiveFrom) {
        return NextResponse.json(
            { error: 'Tanggal efektif revisi harga tidak boleh lebih awal dari tanggal efektif harga lama.' },
            { status: 400 }
        );
    }
    const closeEffectiveTo =
        existingEffectiveFrom && previousDate && previousDate < existingEffectiveFrom
            ? existingEffectiveFrom
            : previousDate || nextEffectiveFrom;
    const previousEffectiveTo = existing.effectiveTo;
    const previousActive = existing.active !== false;
    const newId = `supplier-item-price-${crypto.randomUUID()}`;
    const newDoc = {
        ...sanitized,
        _id: newId,
        _type: 'supplierItemPrice',
        active: true,
        effectiveFrom: nextEffectiveFrom,
        createdAt: now,
        updatedAt: now,
    };

    try {
        await updateDocument(id, {
            active: false,
            effectiveTo: closeEffectiveTo,
            updatedAt: now,
        }, 'supplierItemPrice');
        const created = await createDocument(newDoc as { _type: string; [key: string]: unknown });
        await addAuditLog(
            session,
            'UPDATE',
            'supplier-item-prices',
            id,
            `Revisi harga barang supplier ${existing.supplierName || ''} ${existing.itemCode || id}: ${Number(existing.defaultPurchasePrice || 0).toLocaleString('id-ID')} -> ${Number(sanitized.defaultPurchasePrice || 0).toLocaleString('id-ID')}`
        );
        return NextResponse.json({ success: true, data: created, id: newId, previousId: id });
    } catch (error) {
        try {
            await updateDocument(id, {
                active: previousActive,
                effectiveTo: previousEffectiveTo || null,
                updatedAt: existing.updatedAt || now,
            }, 'supplierItemPrice');
        } catch {
            // Best-effort rollback only; the caller still receives the original mutation error.
        }
        if (isMutationConflictError(error) || isDocumentAlreadyExistsError(error, newId)) {
            return NextResponse.json(
                { error: 'Harga barang supplier berubah atau sudah punya revisi aktif lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
}

export async function handleGenericUpdate(
    session: ApiSession,
    entity: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const docType = DOCUMENT_TYPE_MAP[entity];
    const id = typeof data.id === 'string' ? data.id : '';
    const updatesInput = isPlainObject(data.updates) ? data.updates : null;
    if (!id || !updatesInput) {
        return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
    }
    const updates: Record<string, unknown> = { ...updatesInput };
    let sanitizedEntityUpdates: Record<string, unknown> | null = null;
    let selectedTripRouteRateRevision: { _id: string; _rev?: string } | null = null;

    if (isProtectedLedgerEntity(entity)) {
        return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh diubah lewat API umum' }, { status: 409 });
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json({ error: 'Riwayat ban dibuat otomatis oleh sistem dan tidak boleh diubah manual' }, { status: 409 });
    }

    if (isWorkflowManagedUpdateEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen workflow ini tidak boleh diubah lewat API umum' }, { status: 409 });
    }

    if (entity === 'incidents' && typeof updates.status === 'string') {
        return NextResponse.json({ error: 'Status insiden harus lewat workflow server' }, { status: 400 });
    }

    if (entity === 'delivery-orders' && typeof updates.status === 'string') {
        return NextResponse.json({ error: 'Status surat jalan harus lewat workflow server' }, { status: 400 });
    }

    if (entity === 'delivery-orders') {
        const allowedDeliveryOrderFields = new Set([
            'podReceiverName',
            'podReceivedDate',
            'podNote',
            'tripRouteRateRef',
            'tripOriginArea',
            'tripDestinationArea',
            'taripBorongan',
            'keteranganBorongan',
        ]);
        const updateKeys = Object.keys(updates);
        if (updateKeys.some(key => !allowedDeliveryOrderFields.has(key))) {
            return NextResponse.json({ error: 'Field surat jalan ini tidak boleh diubah lewat API umum' }, { status: 400 });
        }

        const existingDeliveryOrder = await getDocumentById<{
            status?: string;
            podReceiverName?: string;
            podReceivedDate?: string;
            serviceRef?: string;
            baseTaripBorongan?: number;
            overtonaseDriverAmount?: number;
        }>(id, 'deliveryOrder');
        if (!existingDeliveryOrder) {
            return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }

        const updatesPod = updateKeys.some(key => key === 'podReceiverName' || key === 'podReceivedDate' || key === 'podNote');
        const updatesBoronganTariff = updateKeys.some(key => key === 'taripBorongan' || key === 'keteranganBorongan');
        const updatesTripRouteSelection = updateKeys.some(key => key === 'tripRouteRateRef' || key === 'tripOriginArea' || key === 'tripDestinationArea');

        if (updatesPod) {
            if (existingDeliveryOrder.status !== 'DELIVERED') {
                return NextResponse.json({ error: 'POD hanya boleh disimpan untuk surat jalan yang sudah delivered' }, { status: 409 });
            }
            if (existingDeliveryOrder.podReceiverName || existingDeliveryOrder.podReceivedDate) {
                return NextResponse.json({ error: 'POD yang sudah tersimpan tidak boleh diubah lewat API umum' }, { status: 409 });
            }

            const podReceiverName = normalizeOptionalText(updates.podReceiverName);
            const podReceivedDate = normalizeOptionalText(updates.podReceivedDate);
            if (!podReceiverName || !podReceivedDate) {
                return NextResponse.json({ error: 'Nama penerima dan tanggal terima POD wajib diisi' }, { status: 400 });
            }
            try {
                assertIsoDate(podReceivedDate, 'Tanggal terima POD');
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Tanggal terima POD tidak valid' },
                    { status: 400 }
                );
            }

            updates.podReceiverName = podReceiverName;
            updates.podReceivedDate = podReceivedDate;
            updates.podNote = normalizeOptionalText(updates.podNote);
        }

        if (updatesBoronganTariff || updatesTripRouteSelection) {
            if (existingDeliveryOrder.status === 'CANCELLED') {
                return NextResponse.json({ error: 'Tarip borongan tidak bisa diubah untuk surat jalan yang dibatalkan' }, { status: 409 });
            }

            const relatedBoronganItem =
                (await listDocumentsByFilter<{ _id: string }>('driverBoronganItem', { doRef: id }))[0] || null;
            if (relatedBoronganItem) {
                return NextResponse.json({ error: 'Tarip borongan DO yang sudah masuk slip borongan tidak boleh diubah' }, { status: 409 });
            }

            const relatedVoucher =
                (await listDocumentsByFilter<{ _id: string; bonNumber?: string }>('driverVoucher', { deliveryOrderRef: id }))[0] || null;
            if (relatedVoucher) {
                return NextResponse.json(
                    {
                        error: `Upah trip DO yang sudah punya uang jalan trip ${relatedVoucher.bonNumber || ''} tidak boleh diubah`,
                    },
                    { status: 409 }
                );
            }

            if (updatesTripRouteSelection) {
                try {
                    const tripRouteSelection = await resolveTripRouteRateSelection(updates, {
                        serviceRef: normalizeOptionalText(existingDeliveryOrder.serviceRef),
                    });
                    const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection.matchedTripRouteRate?.rate ?? 0);
                    if (
                        Object.prototype.hasOwnProperty.call(updates, 'taripBorongan') &&
                        matchedTripRouteRateFee > 0
                    ) {
                        const requestedTaripBorongan = normalizeCurrencyNumber(updates.taripBorongan);
                        if (
                            Number.isFinite(requestedTaripBorongan) &&
                            requestedTaripBorongan > 0 &&
                            Math.abs(requestedTaripBorongan - matchedTripRouteRateFee) > 0.01
                        ) {
                            return NextResponse.json(
                                { error: 'Upah trip mengikuti master biaya rute trip yang dipilih. Ubah area trip jika ingin memakai master yang berbeda.' },
                                { status: 409 }
                            );
                        }
                    }
                    updates.tripRouteRateRef = tripRouteSelection.tripRouteRateRef;
                    updates.tripOriginArea = tripRouteSelection.tripOriginArea;
                    updates.tripDestinationArea = tripRouteSelection.tripDestinationArea;
                    updates.overtonaseDriverRatePerKg = getTripRouteOvertonaseRatePerKg(tripRouteSelection.matchedTripRouteRate) || undefined;
                    if (tripRouteSelection.matchedTripRouteRate?._id) {
                        if (!tripRouteSelection.matchedTripRouteRate._rev && !isSupabaseBackendEnabled()) {
                            return NextResponse.json(
                                { error: 'Revisi master biaya rute trip tidak tersedia. Refresh lalu coba lagi.' },
                                { status: 409 }
                            );
                        }
                        selectedTripRouteRateRevision = {
                            _id: tripRouteSelection.matchedTripRouteRate._id,
                            _rev: tripRouteSelection.matchedTripRouteRate._rev,
                        };
                    } else {
                        selectedTripRouteRateRevision = null;
                    }
                    if (matchedTripRouteRateFee > 0) {
                        updates.taripBorongan = matchedTripRouteRateFee;
                    }
                } catch (error) {
                    return NextResponse.json(
                        { error: error instanceof Error ? error.message : 'Master biaya rute trip tidak valid' },
                        { status: 400 }
                    );
                }
            }

            if (Object.prototype.hasOwnProperty.call(updates, 'taripBorongan')) {
                const taripBorongan = normalizeCurrencyNumber(updates.taripBorongan);
                if (!Number.isFinite(taripBorongan) || taripBorongan <= 0) {
                    return NextResponse.json({ error: 'Tarip borongan harus lebih besar dari 0' }, { status: 400 });
                }
                const currentOvertonaseAmount = normalizeCurrencyNumber(existingDeliveryOrder.overtonaseDriverAmount ?? 0);
                updates.baseTaripBorongan = taripBorongan;
                updates.taripBorongan = taripBorongan + currentOvertonaseAmount;
            }
            if (Object.prototype.hasOwnProperty.call(updates, 'keteranganBorongan')) {
                updates.keteranganBorongan = normalizeOptionalText(updates.keteranganBorongan);
            }
        }
    }

    if (entity === 'orders') {
        const structuralOrderFields = new Set([
            'customerRef',
            'customerName',
            'customerRecipientRef',
            'customerPickupRef',
            'receiverName',
            'receiverPhone',
            'receiverAddress',
            'receiverCompany',
            'pickupAddress',
            'serviceRef',
            'serviceName',
        ]);
        const touchesStructuralFields = Object.keys(updates).some(key => structuralOrderFields.has(key));
        if (touchesStructuralFields) {
            const relatedDeliveryOrder =
                (await listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id }))[0] || null;
            if (relatedDeliveryOrder) {
                return NextResponse.json(
                    { error: 'Order yang sudah punya surat jalan hanya boleh mengubah catatan. Field utama seperti pengirim, kategori armada, dan penerima dikunci agar dokumen turunan tetap konsisten.' },
                    { status: 409 }
                );
            }
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'customerRef')) {
            const customerRef = normalizeOptionalText(updates.customerRef);
            if (!customerRef) {
                return NextResponse.json({ error: 'Customer order wajib dipilih' }, { status: 400 });
            }
            const customer = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(customerRef, 'customer');
            if (!customer) {
                return NextResponse.json({ error: 'Customer order tidak ditemukan' }, { status: 404 });
            }
            if (customer.active === false) {
                return NextResponse.json({ error: 'Customer order tidak aktif' }, { status: 409 });
            }
            updates.customerRef = customerRef;
            updates.customerName = customer.name || '';
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'serviceRef')) {
            const serviceRef = normalizeOptionalText(updates.serviceRef);
            if (!serviceRef) {
                updates.serviceRef = '';
                updates.serviceName = undefined;
            } else {
                const service = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(serviceRef, 'service');
                if (!service) {
                    return NextResponse.json({ error: 'Kategori armada order tidak ditemukan' }, { status: 404 });
                }
                if (service.active === false) {
                    return NextResponse.json({ error: 'Kategori armada order tidak aktif' }, { status: 409 });
                }
                updates.serviceRef = serviceRef;
                updates.serviceName = service.name || '';
            }
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'notes')) {
            updates.notes = normalizeOptionalText(updates.notes);
        }
    }

    if (entity === 'employees') {
        const existingEmployee = await getDocumentById<Record<string, unknown>>(id, 'employee');
        if (!existingEmployee) {
            return NextResponse.json({ error: 'Karyawan tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeEmployeePayload(updates, {
                partial: true,
                excludeId: id,
            });
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'employee-attendance-records') {
        const existingAttendance = await getDocumentById<Record<string, unknown>>(id, 'employeeAttendanceRecord');
        if (!existingAttendance) {
            return NextResponse.json({ error: 'Absensi karyawan tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeEmployeeAttendanceUpdates(session, updates, id, existingAttendance);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data absensi karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customers') {
        const existingCustomer = await getDocumentById<Record<string, unknown>>(id, 'customer');
        if (!existingCustomer) {
            return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = normalizeCustomerPayload(updates, existingCustomer);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'suppliers') {
        const existingSupplier = await getDocumentById<Record<string, unknown>>(id, 'supplier');
        if (!existingSupplier) {
            return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeSupplierPayload(updates, existingSupplier);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data supplier tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'supplier-item-prices') {
        const existingSupplierItemPrice = await getDocumentById<Record<string, unknown>>(id, 'supplierItemPrice');
        if (!existingSupplierItemPrice) {
            return NextResponse.json({ error: 'Harga barang supplier tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeSupplierItemPricePayload(updates, existingSupplierItemPrice);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data harga barang supplier tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'warehouse-items') {
        const existingWarehouseItem = await getDocumentById<Record<string, unknown>>(id, 'warehouseItem');
        if (!existingWarehouseItem) {
            return NextResponse.json({ error: 'Barang gudang tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeWarehouseItemPayload(updates, existingWarehouseItem);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang gudang tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-products') {
        const existingCustomerProduct = await getDocumentById<Record<string, unknown>>(id, 'customerProduct');
        if (!existingCustomerProduct) {
            return NextResponse.json({ error: 'Barang customer tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeCustomerProductPayload(updates, existingCustomerProduct);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-billing-rates') {
        const existingCustomerBillingRate = await getDocumentById<Record<string, unknown>>(id, 'customerBillingRate');
        if (!existingCustomerBillingRate) {
            return NextResponse.json({ error: 'Tarif customer tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeCustomerBillingRatePayload(updates, existingCustomerBillingRate);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data tarif customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-recipients') {
        const existingCustomerRecipient = await getDocumentById<Record<string, unknown>>(id, 'customerRecipient');
        if (!existingCustomerRecipient) {
            return NextResponse.json({ error: 'Master penerima tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeCustomerRecipientPayload(updates, existingCustomerRecipient);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master penerima tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-pickups') {
        const existingCustomerPickup = await getDocumentById<Record<string, unknown>>(id, 'customerPickupLocation');
        if (!existingCustomerPickup) {
            return NextResponse.json({ error: 'Master pickup tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeCustomerPickupPayload(updates, existingCustomerPickup);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master pickup tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'trip-route-rates') {
        const existingTripRouteRate = await getDocumentById<Record<string, unknown>>(id, 'tripRouteRate');
        if (!existingTripRouteRate) {
            return NextResponse.json({ error: 'Master biaya rute trip tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeTripRouteRatePayload(updates, existingTripRouteRate);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data biaya rute trip tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'order-items') {
        return NextResponse.json(
            { error: 'Item order harus diubah lewat workflow order/revisi resmi agar progres DO, hold, dan resi tetap sinkron' },
            { status: 409 }
        );
    }

    if (entity === 'maintenances' && typeof updates.status === 'string') {
        const allowedMaintenanceFields = new Set(['status', 'completedDate']);
        const updateKeys = Object.keys(updates);
        if (updateKeys.some(key => !allowedMaintenanceFields.has(key))) {
            return NextResponse.json({ error: 'Field maintenance ini tidak boleh diubah lewat API umum' }, { status: 400 });
        }

        const existingMaintenance = await getDocumentById<{ status?: string }>(id, 'maintenance');
        if (!existingMaintenance) {
            return NextResponse.json({ error: 'Maintenance tidak ditemukan' }, { status: 404 });
        }

        if (existingMaintenance.status !== 'SCHEDULED') {
            return NextResponse.json({ error: 'Maintenance yang sudah diproses tidak bisa diubah lagi' }, { status: 409 });
        }

        if (!['DONE', 'SKIPPED'].includes(updates.status)) {
            return NextResponse.json({ error: 'Status maintenance tidak valid' }, { status: 400 });
        }

        if (updates.status === 'DONE') {
            return NextResponse.json(
                { error: 'Maintenance selesai harus diproses lewat workflow resmi agar material gudang dan biaya unit tetap sinkron' },
                { status: 409 }
            );
        }

        if (typeof updates.completedDate !== 'string' || !updates.completedDate) {
            updates.completedDate = getBusinessDateValue();
        }

        sanitizedEntityUpdates = {
            status: updates.status,
            completedDate: updates.completedDate,
        };
    }

    if (entity === 'maintenances' && typeof updates.status !== 'string') {
        return NextResponse.json({ error: 'Maintenance hanya boleh diubah lewat update status resmi' }, { status: 409 });
    }

    if (entity === 'tire-events') {
        const existingTire = await getDocumentById<Record<string, unknown> & { _rev?: string }>(id, 'tireEvent');
        if (!existingTire) {
            return NextResponse.json({ error: 'Catatan ban tidak ditemukan' }, { status: 404 });
        }
        if (!existingTire._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi catatan ban tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        let normalizedTireUpdates: Record<string, unknown>;
        try {
            normalizedTireUpdates = await normalizeTireEventPayload({ ...existingTire, ...updates }, id);
        } catch (error) {
            return buildTireEventResponseError(error, 'Data ban tidak valid');
        }
        const nextTireDoc: Record<string, unknown> = { ...existingTire, ...normalizedTireUpdates };
        if (Object.prototype.hasOwnProperty.call(updates, 'linkedWarehouseItemRef')) {
            nextTireDoc.linkedWarehouseItemRef = normalizeOptionalText(updates.linkedWarehouseItemRef);
        }
        if (!normalizeOptionalText(nextTireDoc.linkedWarehouseItemRef)) {
            return NextResponse.json({ error: 'Master barang gudang ban tertracking wajib dipilih' }, { status: 400 });
        }
        if (nextTireDoc.linkedWarehouseItemRef) {
            try {
                const linkedItem = await resolveTrackedTireWarehouseItem(String(nextTireDoc.linkedWarehouseItemRef));
                nextTireDoc.linkedWarehouseItemCode = linkedItem.itemCode;
                nextTireDoc.linkedWarehouseItemName = linkedItem.name;
            } catch (error) {
                return buildTireEventResponseError(error, 'Master barang gudang ban tidak valid');
            }
        } else {
            nextTireDoc.linkedWarehouseItemCode = undefined;
            nextTireDoc.linkedWarehouseItemName = undefined;
        }
        const usageAllocation = buildTireUsageAllocation({
            previous: existingTire,
            next: nextTireDoc,
            updates,
        });
        Object.assign(nextTireDoc, usageAllocation.tireUpdates);
        const tirePatchPayload = {
            ...normalizedTireUpdates,
            linkedWarehouseItemRef: nextTireDoc.linkedWarehouseItemRef,
            linkedWarehouseItemCode: nextTireDoc.linkedWarehouseItemCode,
            linkedWarehouseItemName: nextTireDoc.linkedWarehouseItemName,
            ...usageAllocation.tireUpdates,
        };
        const tireSetPayload = Object.fromEntries(
            Object.entries(tirePatchPayload).filter(([, value]) => value !== undefined)
        );
        const tireUnsetFields = Object.entries(tirePatchPayload)
            .filter(([field, value]) => value === undefined && Object.prototype.hasOwnProperty.call(existingTire, field))
            .map(([field]) => field);
        const historyLogDoc = buildTireHistoryLogDoc({
            tireEventRef: id,
            tireCode: normalizeOptionalText(nextTireDoc.tireCode) || id,
            tireBrand: normalizeOptionalText(nextTireDoc.tireBrand),
            tireSize: normalizeOptionalText(nextTireDoc.tireSize),
            previous: buildTireHistorySnapshot(existingTire),
            next: buildTireHistorySnapshot(nextTireDoc),
            session,
            note: normalizeOptionalText(normalizedTireUpdates.notes),
        });
        Object.assign(historyLogDoc, usageAllocation.historyFields);
        const currentTireCode = normalizeOptionalText(existingTire.tireCode)?.toUpperCase();
        const nextTireCode = normalizeOptionalText(nextTireDoc.tireCode)?.toUpperCase();
        try {
            await updateDocument(id, {
                ...tireSetPayload,
                ...Object.fromEntries(tireUnsetFields.map(field => [field, null])),
            }, 'tireEvent');
            await createDocument(historyLogDoc);
            await appendTrackedTireWarehouseSync({
                previousDoc: existingTire,
                nextDoc: { ...nextTireDoc, _id: id },
                session,
            });
        } catch (error) {
            if (nextTireCode && nextTireCode !== currentTireCode && isDocumentAlreadyExistsError(error)) {
                return NextResponse.json({ error: 'Kode ban sudah digunakan' }, { status: 409 });
            }
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Catatan ban atau stok gudang ban berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            return buildTireEventResponseError(error, 'Data ban tidak valid');
        }
        const updated = await getDocumentById<Record<string, unknown>>(id, 'tireEvent');
        await addAuditLog(
            session,
            'UPDATE',
            entity,
            id,
            `Perbarui ban ${normalizedTireUpdates.tireCode}: ${normalizedTireUpdates.posisi} (${normalizedTireUpdates.status})`
        );
        return NextResponse.json({ data: updated });
    }

    if (entity === 'drivers') {
        return handleDriverUpdate(session, id, updates, addAuditLog);
    }

    if (entity === 'driver-scores') {
        return handleDriverScoreUpdate(session, id, updates, addAuditLog);
    }

    if (entity === 'bank-accounts') {
        if ('currentBalance' in updates || 'initialBalance' in updates) {
            return NextResponse.json({ error: 'Saldo rekening tidak boleh diubah manual lewat API umum' }, { status: 409 });
        }
        if ('active' in updates) {
            return NextResponse.json({ error: 'Status rekening hanya boleh diubah lewat aksi nonaktifkan resmi' }, { status: 409 });
        }
        if ('accountType' in updates || 'systemKey' in updates) {
            return NextResponse.json({ error: 'Tipe dan kunci sistem rekening tidak boleh diubah manual' }, { status: 409 });
        }

        const existingAccount = await getDocumentById<BankAccountSummary>(id, 'bankAccount');
        if (!existingAccount) {
            return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
        }
        if (existingAccount.systemKey === CASH_ACCOUNT_SYSTEM_KEY) {
            if ('bankName' in updates || 'accountNumber' in updates || 'accountHolder' in updates || 'accountType' in updates || 'systemKey' in updates) {
                return NextResponse.json({ error: 'Identitas akun Kas Tunai sistem tidak boleh diubah manual' }, { status: 409 });
            }
        }

        try {
            sanitizedEntityUpdates = await normalizeBankAccountPayload(updates, existingAccount as unknown as Record<string, unknown>);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data rekening / kas tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'company') {
        const existingCompany = await getCompanyProfile<CompanyProfile & { _id?: string; _rev?: string }>();
        if (!existingCompany?._id || existingCompany._id !== id) {
            return NextResponse.json({ error: 'Profil perusahaan tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await sanitizeCompanyInvoiceSettings(updates, existingCompany);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data perusahaan tidak valid' },
                { status: 400 }
            );
        }
    }

    // For user updates, normalizeUserUpdates returns { updates, extra_data }.
    // Destructure it early so normalizedUpdates is always Record<string, unknown>.
    let normalizedUpdates: Record<string, unknown>;
    let userExtraData: Record<string, unknown> | undefined;
    if (entity === 'users') {
        const result = await normalizeUserUpdates(session, id, updates, data.currentPassword);
        normalizedUpdates = result.updates;
        userExtraData = result.extra_data;
    } else if (entity === 'services') {
        normalizedUpdates = await normalizeServicePayload(updates, { partial: true, excludeId: id });
    } else if (entity === 'expense-categories') {
        normalizedUpdates = await normalizeExpenseCategoryPayload(updates, { partial: true, excludeId: id });
    } else if (entity === 'vehicles') {
        normalizedUpdates = await normalizeVehiclePayload(session, updates, { partial: true, excludeId: id });
    } else {
        normalizedUpdates = sanitizedEntityUpdates ?? updates;
    }
    const userDriverRevision =
        entity === 'users' &&
        typeof normalizedUpdates.driverRef === 'string' &&
        typeof normalizedUpdates.driverRevision === 'string'
            ? {
                _id: normalizedUpdates.driverRef,
                _rev: normalizedUpdates.driverRevision,
            }
            : null;
    const persistedNormalizedUpdates =
        entity === 'users'
            ? Object.fromEntries(
                Object.entries(normalizedUpdates).filter(([key]) => key !== 'driverRevision')
            )
            : normalizedUpdates;

    const currentDoc = await getDocumentById<Record<string, unknown> & { _id: string; _rev?: string }>(id, docType);
    if (!currentDoc) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!currentDoc._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi dokumen tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (
        entity === 'supplier-item-prices' &&
        supplierPriceHistoricalFieldsChanged(currentDoc, persistedNormalizedUpdates)
    ) {
        const relatedPurchaseItem = await listDocumentsByFilter<{ _id: string }>('purchaseItem', { supplierItemPriceRef: id })
            .then(rows => rows[0] || null);
        if (relatedPurchaseItem) {
            return NextResponse.json(
                { error: 'Harga supplier yang sudah dipakai pembelian tidak boleh ditimpa. Gunakan revisi harga agar histori tetap utuh.' },
                { status: 409 }
            );
        }
    }

    let updated: unknown;
    try {
        if (entity === 'services') {
            const currentServiceName = normalizeOptionalText(currentDoc.name) || '';
            const nextServiceName =
                typeof normalizedUpdates.name === 'string'
                    ? normalizeOptionalText(normalizedUpdates.name) || ''
                    : currentServiceName;
            const nextServiceTireLayoutConfig =
                Object.prototype.hasOwnProperty.call(normalizedUpdates, 'tireLayoutConfig')
                    ? (normalizedUpdates.tireLayoutConfig as Record<string, unknown> | undefined)
                    : (isPlainObject(currentDoc.tireLayoutConfig) ? currentDoc.tireLayoutConfig as Record<string, unknown> : undefined);
            const relatedVehicles = await listDocumentsByFilter<{ _id: string; vehicleType?: string }>('vehicle', { serviceRef: id });
            updated = await updateDocument(id, normalizedUpdates, 'service');
            for (const vehicle of relatedVehicles) {
                await updateDocument(vehicle._id, {
                    serviceName: nextServiceName,
                    tireLayoutConfig: normalizeTireLayoutConfig(
                        nextServiceTireLayoutConfig,
                        buildDefaultTireLayoutConfig(vehicle.vehicleType || '', nextServiceName)
                    ),
                }, 'vehicle');
            }
            updated = await getDocumentById(id, 'service');
        } else if (entity === 'delivery-orders' && selectedTripRouteRateRevision) {
            await updateDocument(selectedTripRouteRateRevision._id, { updatedAt: new Date().toISOString() }, 'tripRouteRate');
            await updateDocument(id, normalizedUpdates, 'deliveryOrder');
            updated = await getDocumentById(id, 'deliveryOrder');
        } else if (entity === 'users') {
            const mutationTimestamp = new Date().toISOString();
            const userUnsetFields = Object.entries(persistedNormalizedUpdates)
                .filter(([, value]) => value === undefined)
                .map(([key]) => key);
            const userSetUpdates = Object.fromEntries(
                Object.entries(persistedNormalizedUpdates).filter(([, value]) => value !== undefined)
            );
            if (userDriverRevision) {
                await updateDocument(userDriverRevision._id, { updatedAt: mutationTimestamp }, 'driver');
            }
            updated = await updateDocument(id, {
                ...userSetUpdates,
                ...Object.fromEntries(userUnsetFields.map(field => [field, null])),
            }, 'user');
        } else {
            updated = await updateDocument(id, persistedNormalizedUpdates, docType);
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Dokumen berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    if (!updated) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (entity === 'customer-recipients' && normalizedUpdates.isDefault === true) {
        const updatedRecipient = updated as { customerRef?: string; _id?: string };
        if (typeof updatedRecipient.customerRef === 'string' && typeof updatedRecipient._id === 'string') {
            try {
                await clearOtherCustomerScopedDefaults('customerRecipient', updatedRecipient.customerRef, updatedRecipient._id);
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Default penerima berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    if (entity === 'customer-pickups' && normalizedUpdates.isDefault === true) {
        const updatedPickup = updated as { customerRef?: string; _id?: string };
        if (typeof updatedPickup.customerRef === 'string' && typeof updatedPickup._id === 'string') {
            try {
                await clearOtherCustomerScopedDefaults('customerPickupLocation', updatedPickup.customerRef, updatedPickup._id);
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Default pickup berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    if (entity === 'users' && id === session._id) {
        // Apply fresh extra_data to the returned document so createSession picks up
        // the updated modulePermissions. Both the top-level field and extra_data must
        // be updated since createSession reads user.modulePermissions directly.
        if (userExtraData) {
            const doc = updated as Record<string, unknown>;
            doc.extra_data = userExtraData;
            doc.modulePermissions = userExtraData.modulePermissions;
        }
        const nextSessionToken = await createSession(updated as unknown as User);
        await setSessionCookie(nextSessionToken);
    }

    const updateSummary =
        entity === 'employees'
            ? `Perbarui karyawan ${buildEmployeeSummary(updated as Record<string, unknown>, id)}`
            : entity === 'employee-attendance-records'
                ? `Perbarui absensi ${buildEmployeeAttendanceSummary(updated as Record<string, unknown>, id)}`
                : entity === 'suppliers'
                    ? `Perbarui supplier ${buildCreateSummary(updated as Record<string, unknown>, id)}`
                    : entity === 'supplier-item-prices'
                        ? `Perbarui harga barang supplier ${buildCreateSummary(updated as Record<string, unknown>, id)}`
                        : entity === 'warehouse-items'
                            ? `Perbarui barang gudang ${buildCreateSummary(updated as Record<string, unknown>, id)}`
                            : entity === 'users'
                            ? buildUserUpdateAuditSummary(
                                currentDoc,
                                updated as Record<string, unknown>,
                                persistedNormalizedUpdates,
                                id
                            )
                            : `Updated ${entity}: ${JSON.stringify(persistedNormalizedUpdates).slice(0, 200)}`;
    await addAuditLog(session, 'UPDATE', entity, id, updateSummary);

    if (entity === 'order-items' && typeof normalizedUpdates.status === 'string') {
        const orderItem = updated as { orderRef?: unknown };
        const orderRef = extractRefId(orderItem.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
    }

    if (entity === 'delivery-orders' && typeof normalizedUpdates.status === 'string') {
        const doDoc = updated as { orderRef?: unknown };
        const orderRef = extractRefId(doDoc.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
    }

    return NextResponse.json({
        data: entity === 'users'
            ? sanitizeUserForClient(updated as unknown as User)
            : updated,
    });
}

export async function handleGenericDelete(
    session: ApiSession,
    entity: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const docType = DOCUMENT_TYPE_MAP[entity];
    if (entity === 'driver-voucher-disbursements') {
        return handleDriverVoucherDisbursementDelete(session, data, addAuditLog);
    }

    if (entity === 'driver-voucher-items') {
        return handleDriverVoucherItemDelete(session, data, addAuditLog);
    }

    if (isProtectedLedgerEntity(entity)) {
        return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh dihapus lewat API umum' }, { status: 409 });
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json({ error: 'Riwayat ban tidak boleh dihapus langsung karena histori aset harus tetap utuh' }, { status: 409 });
    }

    if (isWorkflowManagedDeleteEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen turunan workflow tidak boleh dihapus langsung lewat API umum' }, { status: 409 });
    }

    if (entity === 'orders') {
        return handleOrderDelete(session, data, addAuditLog);
    }

    if (entity === 'customers') {
        return handleCustomerDelete(session, data, addAuditLog);
    }

    if (entity === 'customer-products') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Barang customer tidak valid' }, { status: 400 });
        }

        const customerProduct = await getDocumentById<{ _id: string; _rev?: string; code?: string; name?: string }>(id, 'customerProduct');
        if (!customerProduct) {
            return NextResponse.json({ error: 'Barang customer tidak ditemukan' }, { status: 404 });
        }
        if (!customerProduct._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi barang customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedOrderItem = (await listDocumentsByFilter<{ _id: string }>('orderItem', { customerProductRef: id }))[0] || null;
        if (relatedOrderItem) {
            return NextResponse.json({ error: 'Barang customer yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await deleteDocument(id, 'customerProduct');
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted customer product ${customerProduct.code || customerProduct.name || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Barang customer berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'suppliers') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Supplier tidak valid' }, { status: 400 });
        }

        const supplier = await getDocumentById<{ _id: string; _rev?: string; name?: string }>(id, 'supplier');
        if (!supplier) {
            return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 404 });
        }
        if (!supplier._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi supplier tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const [relatedPurchase, defaultWarehouseItem, relatedSupplierItemPrice] = await Promise.all([
            listDocumentsByFilter<{ _id: string }>('purchase', { supplierRef: id }).then(rows => rows[0] || null),
            listDocumentsByFilter<{ _id: string }>('warehouseItem', { defaultSupplierRef: id }).then(rows => rows[0] || null),
            listDocumentsByFilter<{ _id: string }>('supplierItemPrice', { supplierRef: id }).then(rows => rows[0] || null),
        ]);
        if (relatedPurchase || defaultWarehouseItem || relatedSupplierItemPrice) {
            return NextResponse.json({ error: 'Supplier yang sudah dipakai pembelian, default barang, atau harga barang supplier tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await deleteDocument(id, 'supplier');
            await addAuditLog(session, 'DELETE', entity, id, `Deleted supplier ${supplier.name || id}`);
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Supplier berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'supplier-item-prices') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Harga barang supplier tidak valid' }, { status: 400 });
        }

        const supplierItemPrice = await getDocumentById<{ _id: string; _rev?: string; itemCode?: string; supplierName?: string }>(id, 'supplierItemPrice');
        if (!supplierItemPrice) {
            return NextResponse.json({ error: 'Harga barang supplier tidak ditemukan' }, { status: 404 });
        }
        if (!supplierItemPrice._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi harga barang supplier tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedPurchaseItem = await listDocumentsByFilter<{ _id: string }>('purchaseItem', { supplierItemPriceRef: id }).then(rows => rows[0] || null);
        if (relatedPurchaseItem) {
            return NextResponse.json({ error: 'Harga barang supplier yang sudah dipakai pembelian tidak boleh dihapus. Nonaktifkan saja agar histori tetap utuh.' }, { status: 409 });
        }

        try {
            await deleteDocument(id, 'supplierItemPrice');
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted supplier item price ${supplierItemPrice.supplierName || ''} ${supplierItemPrice.itemCode || id}`.trim()
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Harga barang supplier berubah atau baru dipakai transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'warehouse-items') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Barang gudang tidak valid' }, { status: 400 });
        }

        const warehouseItem = await getDocumentById<{ _id: string; _rev?: string; itemCode?: string; name?: string }>(id, 'warehouseItem');
        if (!warehouseItem) {
            return NextResponse.json({ error: 'Barang gudang tidak ditemukan' }, { status: 404 });
        }
        if (!warehouseItem._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi barang gudang tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const [relatedPurchaseItem, relatedMovement, relatedSupplierItemPrice] = await Promise.all([
            listDocumentsByFilter<{ _id: string }>('purchaseItem', { warehouseItemRef: id }).then(rows => rows[0] || null),
            listDocumentsByFilter<{ _id: string }>('stockMovement', { warehouseItemRef: id }).then(rows => rows[0] || null),
            listDocumentsByFilter<{ _id: string }>('supplierItemPrice', { warehouseItemRef: id }).then(rows => rows[0] || null),
        ]);
        if (relatedPurchaseItem || relatedMovement || relatedSupplierItemPrice) {
            return NextResponse.json({ error: 'Barang gudang yang sudah punya histori pembelian, stok, atau harga supplier tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await deleteDocument(id, 'warehouseItem');
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted warehouse item ${warehouseItem.itemCode || warehouseItem.name || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Barang gudang berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'customer-recipients') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master penerima tidak valid' }, { status: 400 });
        }

        const recipient = await getDocumentById<{ _id: string; _rev?: string; label?: string; receiverName?: string }>(id, 'customerRecipient');
        if (!recipient) {
            return NextResponse.json({ error: 'Master penerima tidak ditemukan' }, { status: 404 });
        }
        if (!recipient._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedOrder = (await listDocumentsByFilter<{ _id: string }>('order', { customerRecipientRef: id }))[0] || null;
        if (relatedOrder) {
            return NextResponse.json({ error: 'Master penerima yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await deleteDocument(id, 'customerRecipient');
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted customer recipient ${recipient.label || recipient.receiverName || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Master penerima berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'customer-pickups') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master pickup tidak valid' }, { status: 400 });
        }

        const pickup = await getDocumentById<{ _id: string; _rev?: string; label?: string; pickupAddress?: string }>(id, 'customerPickupLocation');
        if (!pickup) {
            return NextResponse.json({ error: 'Master pickup tidak ditemukan' }, { status: 404 });
        }
        if (!pickup._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi master pickup tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedOrder = (await listDocumentsByFilter<{ _id: string }>('order', { customerPickupRef: id }))[0] || null;
        if (relatedOrder) {
            return NextResponse.json({ error: 'Master pickup yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await deleteDocument(id, 'customerPickupLocation');
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted customer pickup ${pickup.label || pickup.pickupAddress || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Master pickup berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'trip-route-rates') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master biaya rute trip tidak valid' }, { status: 400 });
        }

        const tripRouteRate = await getDocumentById<{ _id: string; _rev?: string; originArea?: string; destinationArea?: string }>(id, 'tripRouteRate');
        if (!tripRouteRate) {
            return NextResponse.json({ error: 'Master biaya rute trip tidak ditemukan' }, { status: 404 });
        }
        if (!tripRouteRate._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi master biaya rute trip tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedDeliveryOrder = (await listDocumentsByFilter<{ _id: string }>('deliveryOrder', { tripRouteRateRef: id }))[0] || null;
        if (relatedDeliveryOrder) {
            return NextResponse.json({ error: 'Master biaya rute trip yang sudah dipakai surat jalan tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await deleteDocument(id, 'tripRouteRate');
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted trip route rate ${tripRouteRate.originArea || '-'} -> ${tripRouteRate.destinationArea || '-'}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Master biaya rute trip berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'maintenances') {
        return NextResponse.json(
            {
                error: 'Maintenance tidak boleh dihapus langsung karena histori servis harus tetap utuh. Ubah status maintenance bila jadwal tidak jadi dijalankan.',
            },
            { status: 409 }
        );
    }

    if (entity === 'tire-events') {
        return NextResponse.json(
            {
                error: 'Ban tidak boleh dihapus langsung karena histori aset harus tetap utuh. Edit lokasi atau status ban untuk memindahkan ke slot lain, gudang, pinjam keluar, atau afkir.',
            },
            { status: 409 }
        );
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json(
            {
                error: 'Riwayat ban tidak boleh dihapus langsung karena histori aset harus tetap utuh.',
            },
            { status: 409 }
        );
    }

    if (entity === 'services') {
        return handleServiceDelete(session, data, addAuditLog);
    }

    if (entity === 'expense-categories') {
        return handleExpenseCategoryDelete(session, data, addAuditLog);
    }

    if (entity === 'drivers') {
        return handleDriverDelete(session, data, addAuditLog);
    }

    if (entity === 'vehicles') {
        return handleVehicleDelete(session, data, addAuditLog);
    }

    if (entity === 'freight-notas') {
        return handleFreightNotaDelete(session, data, addAuditLog);
    }

    if (entity === 'driver-borongans') {
        return handleDriverBoronganDelete(session, data, addAuditLog);
    }

    if (entity === 'employees') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Karyawan tidak valid' }, { status: 400 });
        }

        const linkedAttendance = (await listDocumentsByFilter<{ _id: string }>('employeeAttendanceRecord', { employeeRef: id }))[0] || null;
        if (linkedAttendance) {
            return NextResponse.json(
                { error: 'Karyawan yang sudah punya riwayat absensi tidak boleh dihapus. Nonaktifkan saja bila sudah tidak bekerja.' },
                { status: 409 }
            );
        }
    }

    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Invalid delete payload' }, { status: 400 });
    }

    if (entity === 'bank-accounts') {
        const existingAccount = await getDocumentById<BankAccountSummary & { active?: boolean }>(id, 'bankAccount');
        if (!existingAccount) {
            return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
        }

        if (existingAccount.active === false) {
            return NextResponse.json({ success: true });
        }

        const transactionRows = await listDocumentsByFilter<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>('bankTransaction', {
            bankAccountRef: id,
        });
        const [derivedAccount] = applyDerivedBankAccountBalances([existingAccount], transactionRows);
        const currentBalance = readLedgerBalance(derivedAccount?.currentBalance);
        if (currentBalance !== 0) {
            return NextResponse.json(
                { error: 'Rekening dengan saldo berjalan tidak boleh dinonaktifkan. Kosongkan atau transfer dulu saldonya.' },
                { status: 409 }
            );
        }

        if (existingAccount.systemKey === CASH_ACCOUNT_SYSTEM_KEY) {
            return NextResponse.json({ error: 'Akun Kas Tunai sistem tidak boleh dinonaktifkan' }, { status: 409 });
        }

        const companyInvoiceCleanup = await buildInvoiceInstructionAccountRemoval(id);
        if (!existingAccount._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        try {
            await updateDocument(id, { active: false }, 'bankAccount');
            if (companyInvoiceCleanup) {
                await updateDocument(companyInvoiceCleanup.companyId, {
                    invoiceSettings: companyInvoiceCleanup.invoiceSettings,
                }, 'companyProfile');
            }
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Rekening atau profil perusahaan berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
        await addAuditLog(
            session,
            'DELETE',
            entity,
            id,
            `Nonaktifkan rekening ${existingAccount.bankName || id}`
        );
        return NextResponse.json({ success: true });
    }

    const existing = await getDocumentById<{ _id: string; _rev?: string }>(id, docType);
    if (!existing) {
        return NextResponse.json({ error: 'Dokumen tidak ditemukan' }, { status: 404 });
    }
    if (!existing._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi dokumen tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    try {
        await deleteDocument(id, docType);
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Dokumen berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(session, 'DELETE', entity, id, `Deleted ${entity} ${id}`);
    return NextResponse.json({ success: true });
}

export async function handleGenericCreate(
    session: ApiSession,
    entity: string,
    docType: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (entity === 'company') {
        const existing = await getCompanyProfile<CompanyProfile & { _id?: string; _rev?: string }>();
        let sanitizedCompanyData: Record<string, unknown>;
        try {
            sanitizedCompanyData = await sanitizeCompanyInvoiceSettings(data, existing);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data perusahaan tidak valid' },
                { status: 400 }
            );
        }
        if (existing?._id) {
            if (!existing._rev && !isSupabaseBackendEnabled()) {
                return NextResponse.json(
                    { error: 'Revisi profil perusahaan tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            let updated: unknown;
            try {
                updated = await updateDocument(existing._id, sanitizedCompanyData, 'companyProfile');
            } catch (error) {
                if (isMutationConflictError(error)) {
                    return NextResponse.json(
                        { error: 'Profil perusahaan berubah karena ada update lain. Refresh lalu coba lagi.' },
                        { status: 409 }
                    );
                }
                throw error;
            }
            await addAuditLog(session, 'UPDATE', 'companyProfile', existing._id, 'Company profile updated');
            return NextResponse.json({ data: updated });
        }

        const created = await createDocument({ _type: 'companyProfile', ...sanitizedCompanyData });
        const createdId = (created as Record<string, unknown>)._id as string;
        await addAuditLog(session, 'CREATE', 'companyProfile', createdId, 'Company profile created');
        return NextResponse.json({ data: created });
    }

    if (isWorkflowManagedCreateEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen ini harus dibuat lewat workflow server yang sesuai' }, { status: 409 });
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json({ error: 'Riwayat ban dibuat otomatis oleh sistem dan tidak boleh dibuat manual' }, { status: 409 });
    }

    const newDoc: { _type: string; [key: string]: unknown } = { _type: docType };
    let userDriverRevision: string | undefined;
    let shouldMergeRawCreatePayload = true;

    if (entity === 'delivery-order-items') {
        const deliveryOrderRef = typeof data.deliveryOrderRef === 'string' ? data.deliveryOrderRef : '';
        const orderItemRef = typeof data.orderItemRef === 'string' ? data.orderItemRef : '';
        if (!deliveryOrderRef || !orderItemRef) {
            return NextResponse.json({ error: 'Relasi DO item tidak valid' }, { status: 400 });
        }

        const deliveryOrder = await getDocumentById<{ _id: string; status?: string }>(deliveryOrderRef, 'deliveryOrder');
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status === 'CANCELLED') {
            return NextResponse.json({ error: 'Tidak bisa menambah item ke surat jalan yang dibatalkan' }, { status: 409 });
        }

        const orderItem = await getDocumentById<{ _id: string }>(orderItemRef, 'orderItem');
        if (!orderItem) {
            return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
        }

        let activeAssignment: { _id: string } | null = null;
        if (isSupabaseBackendEnabled()) {
            const assignments = await listDocumentsByFilter<{ _id: string; deliveryOrderRef?: string; orderItemRef?: string }>('deliveryOrderItem', {
                orderItemRef,
            });
            for (const assignment of assignments) {
                if (assignment.deliveryOrderRef === deliveryOrderRef) {
                    continue;
                }
                const linkedDeliveryOrder = assignment.deliveryOrderRef
                    ? await getDocumentById<{ _id: string; status?: string }>(assignment.deliveryOrderRef, 'deliveryOrder')
                    : null;
                if (linkedDeliveryOrder && linkedDeliveryOrder.status !== 'CANCELLED') {
                    activeAssignment = { _id: assignment._id };
                    break;
                }
            }
        } else {
            const assignments = await listDocumentsByFilter<{ _id: string; deliveryOrderRef?: string }>('deliveryOrderItem', { orderItemRef });
            for (const assignment of assignments) {
                if (!assignment.deliveryOrderRef || assignment.deliveryOrderRef === deliveryOrderRef) {
                    continue;
                }
                const linkedDeliveryOrder = await getDocumentById<{ _id: string; status?: string }>(assignment.deliveryOrderRef, 'deliveryOrder');
                if (linkedDeliveryOrder && linkedDeliveryOrder.status !== 'CANCELLED') {
                    activeAssignment = { _id: assignment._id };
                    break;
                }
            }
        }
        if (activeAssignment) {
            return NextResponse.json({ error: 'Item order sudah terikat ke surat jalan aktif lain' }, { status: 409 });
        }
    }

    if (entity === 'orders') {
        shouldMergeRawCreatePayload = false;
        newDoc.masterResi = await getNextNumber('resi');
        newDoc.status = 'OPEN';
        newDoc.createdAt = new Date().toISOString();
        newDoc.createdBy = session._id;
    }

    if (entity === 'delivery-orders') {
        shouldMergeRawCreatePayload = false;
        newDoc.doNumber = await getNextNumber('do');
        newDoc.status = 'CREATED';
    }

    if (entity === 'invoices') {
        shouldMergeRawCreatePayload = false;
        newDoc.invoiceNumber = await getNextNumber('invoice');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'freight-notas') {
        shouldMergeRawCreatePayload = false;
        newDoc.notaNumber = await getNextNumber('nota');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'driver-borongans') {
        shouldMergeRawCreatePayload = false;
        newDoc.boronganNumber = await getNextNumber('borong');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'maintenances') {
        shouldMergeRawCreatePayload = false;
        const normalizedMaintenance = await normalizeMaintenanceCreatePayload(data);
        Object.assign(newDoc, normalizedMaintenance);
        newDoc.status = 'SCHEDULED';
    }

    if (entity === 'services') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeServicePayload(data));
    }

    if (entity === 'customers') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, normalizeCustomerPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'suppliers') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeSupplierPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data supplier tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'supplier-item-prices') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeSupplierItemPricePayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data harga barang supplier tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'warehouse-items') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeWarehouseItemPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang gudang tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-products') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeCustomerProductPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-billing-rates') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeCustomerBillingRatePayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data tarif customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-recipients') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeCustomerRecipientPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master penerima tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-pickups') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeCustomerPickupPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master pickup tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'trip-route-rates') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeTripRouteRatePayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data biaya rute trip tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'expense-categories') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeExpenseCategoryPayload(data));
    }

    if (entity === 'drivers') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeDriverPayload(data));
    }

    if (entity === 'driver-scores') {
        return handleDriverScoreCreate(session, data, addAuditLog);
    }

    if (entity === 'vehicles') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeVehiclePayload(session, data));
    }

    if (entity === 'users') {
        shouldMergeRawCreatePayload = false;
        const normalizedUser = await normalizeUserCreatePayload(data);
        newDoc.name = normalizedUser.name;
        newDoc.email = normalizedUser.email;
        newDoc.role = normalizedUser.role;
        newDoc.driverRef = normalizedUser.driverRef;
        newDoc.driverName = normalizedUser.driverName;
        newDoc.passwordHash = normalizedUser.passwordHash;
        newDoc.active = normalizedUser.active;
        newDoc.createdAt = normalizedUser.createdAt;
        userDriverRevision = typeof normalizedUser.driverRevision === 'string' ? normalizedUser.driverRevision : undefined;
        delete newDoc.password;
        // Forward modulePermissions from form so it gets stored in extra_data
        if (typeof data.modulePermissions === 'object' && data.modulePermissions !== null && !Array.isArray(data.modulePermissions)) {
            newDoc.modulePermissions = data.modulePermissions;
        }
    }

    if (entity === 'employees') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeEmployeePayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'employee-attendance-records') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeEmployeeAttendanceCreatePayload(session, data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data absensi karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'tire-events') {
        shouldMergeRawCreatePayload = false;
        let normalizedTireEvent: Record<string, unknown>;
        try {
            normalizedTireEvent = { ...(await normalizeTireEventPayload(data)) };
        } catch (error) {
            return buildTireEventResponseError(error, 'Data ban tidak valid');
        }
        const linkedWarehouseItemRef = typeof data.linkedWarehouseItemRef === 'string'
            ? data.linkedWarehouseItemRef.trim()
            : '';
        if (!linkedWarehouseItemRef) {
            return NextResponse.json({ error: 'Master barang gudang ban tertracking wajib dipilih' }, { status: 400 });
        }
        try {
            const linkedItem = await resolveTrackedTireWarehouseItem(linkedWarehouseItemRef);
            normalizedTireEvent.linkedWarehouseItemRef = linkedItem._id;
            normalizedTireEvent.linkedWarehouseItemCode = linkedItem.itemCode;
            normalizedTireEvent.linkedWarehouseItemName = linkedItem.name;
        } catch (error) {
            return buildTireEventResponseError(error, 'Master barang gudang ban tidak valid');
        }
        Object.assign(newDoc, normalizedTireEvent);
    }

    if (entity === 'bank-accounts') {
        shouldMergeRawCreatePayload = false;
        if (data.accountType === 'CASH' || typeof data.systemKey === 'string') {
            return NextResponse.json({ error: 'Akun sistem tidak boleh dibuat manual' }, { status: 409 });
        }
        try {
            Object.assign(newDoc, normalizeBankAccountPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data rekening / kas tidak valid' },
                { status: 400 }
            );
        }
        newDoc.accountType = 'BANK';
        const initialBalance =
            typeof newDoc.initialBalance === 'number' && Number.isFinite(newDoc.initialBalance)
                ? newDoc.initialBalance
                : normalizeCurrencyNumber(data.initialBalance || 0);
        newDoc.currentBalance = Number.isFinite(initialBalance) ? initialBalance : 0;
    }

    if (shouldMergeRawCreatePayload) {
        Object.assign(newDoc, data);
    }

    if (entity === 'tire-events') {
        const newId = crypto.randomUUID();
        const createdTireDoc: { _id: string; _type: string; [key: string]: unknown } = { _id: newId, ...newDoc };
        const historyLogDoc = buildTireHistoryLogDoc({
            tireEventRef: newId,
            tireCode: normalizeOptionalText(createdTireDoc.tireCode) || newId,
            tireBrand: normalizeOptionalText(createdTireDoc.tireBrand),
            tireSize: normalizeOptionalText(createdTireDoc.tireSize),
            previous: null,
            next: buildTireHistorySnapshot(createdTireDoc),
            session,
            note: normalizeOptionalText(createdTireDoc.notes),
        });
        try {
            await createDocument(createdTireDoc);
            await createDocument(historyLogDoc);
            await appendTrackedTireWarehouseSync({
                previousDoc: null,
                nextDoc: createdTireDoc,
                session,
            });
        } catch (error) {
            if (isDocumentAlreadyExistsError(error)) {
                return NextResponse.json({ error: 'Kode ban sudah digunakan' }, { status: 409 });
            }
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Catatan ban atau stok gudang ban berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            return buildTireEventResponseError(error, 'Data ban tidak valid');
        }

        await addAuditLog(
            session,
            'CREATE',
            entity,
            newId,
            `Tambah ban ${(newDoc as Record<string, unknown>).tireCode}: ${(newDoc as Record<string, unknown>).posisi} (${(newDoc as Record<string, unknown>).status})`
        );

        return NextResponse.json({
            data: createdTireDoc,
            id: newId,
        });
    }

    const newId = crypto.randomUUID();
    newDoc._id = newId;
    let created: Record<string, unknown> | null;
    if (entity === 'users' && typeof newDoc.driverRef === 'string') {
        if (!userDriverRevision && !isSupabaseBackendEnabled()) {
            return NextResponse.json(
                { error: 'Revisi supir untuk akun mobile tidak tersedia. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        try {
            created = await createDocument<Record<string, unknown> & { _id: string }>(newDoc);
            await updateDocument(newDoc.driverRef, { updatedAt: new Date().toISOString() }, 'driver');
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'User atau supir untuk akun mobile berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    } else {
        created = await createDocument<Record<string, unknown> & { _id: string }>(newDoc);
    }
    if (!created) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (entity === 'customer-recipients' && newDoc.isDefault === true && typeof newDoc.customerRef === 'string') {
        try {
            await clearOtherCustomerScopedDefaults('customerRecipient', newDoc.customerRef, newId);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Default penerima berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
    }

    if (entity === 'customer-pickups' && newDoc.isDefault === true && typeof newDoc.customerRef === 'string') {
        try {
            await clearOtherCustomerScopedDefaults('customerPickupLocation', newDoc.customerRef, newId);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Default pickup berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
    }

    if (entity === 'bank-accounts') {
        await postBankAccountOpeningBalanceJournal(
            session,
            created as unknown as {
                _id: string;
                bankName: string;
                accountNumber: string;
                accountType?: 'BANK' | 'CASH';
                systemKey?: string;
                initialBalance: number;
            },
            getBusinessDateValue(),
        );
    }

    await addAuditLog(
        session,
        'CREATE',
        entity,
        newId,
        buildCreateAuditSummary(entity, newDoc, newId)
    );

    return NextResponse.json({
        data: entity === 'users'
            ? sanitizeUserForClient(created as unknown as User)
            : created,
        id: newId,
    });
}
