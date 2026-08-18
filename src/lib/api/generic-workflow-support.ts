import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    getWeightInputFractionDigits,
    isVolumeInputUnit,
    isWeightInputUnit,
    readVolumeInputUnit,
    readWeightInputUnit,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { normalizeFreightNotaBillingMode, resolveFreightNotaBillingModeInput } from '@/lib/freight-nota-billing';
import { DEFAULT_PPH23_RATE_PERCENT, normalizePph23BaseMode, normalizePph23Enabled, normalizePph23RatePercent } from '@/lib/pph23';
import { getDocumentById, listDocumentsByFilter } from '@/lib/repositories/document-store';

import {
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';
import {
    isInventoryUnit,
    isWarehouseItemTrackingMode,
    normalizeWarehouseItemTrackingMode,
    parseInventoryQuantity,
    parseWholeMoneyAmount,
} from '@/lib/inventory';
import { findMatchingTripRouteRate, stripTripRouteOvertonaseRateNote } from '@/lib/trip-route-rate-support';
import { normalizeOptionalTireType } from '@/lib/tire-types';
import type { Supplier, TripRouteRate, WarehouseItem } from '@/lib/types';

const CUSTOMER_DO_PREFIX_RE = /^[A-Z0-9][A-Z0-9-]{0,7}$/;
const CUSTOMER_PRODUCT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const SUPPLIER_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const WAREHOUSE_ITEM_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,29}$/;

function parseStrictNumericInput(
    value: unknown,
    label: string,
    options?: { allowDecimal?: boolean; maxFractionDigits?: number }
) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed || !/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            throw new Error(label);
        }
        if (options?.allowDecimal === false) {
            const groupedIntegerPattern = /^-?\d{1,3}(?:[.,]\d{3})*$/;
            const plainIntegerPattern = /^-?\d+$/;
            if (!groupedIntegerPattern.test(trimmed) && !plainIntegerPattern.test(trimmed)) {
                throw new Error(label);
            }
        }
    }

    const normalized = normalizeNumber(value, options);
    if (!Number.isFinite(normalized)) {
        throw new Error(label);
    }
    return normalized;
}

function normalizeKontanTermValue(value: unknown) {
    if (typeof value === 'string' && /^\s*kontan\s*$/i.test(value)) {
        return 0;
    }
    return value;
}

export function normalizeCustomerDoPrefix(value: unknown) {
    const prefix = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!prefix) {
        return 'SJ';
    }
    if (!CUSTOMER_DO_PREFIX_RE.test(prefix)) {
        throw new Error('Prefix surat jalan customer hanya boleh berisi huruf/angka singkat, misalnya SJ atau BK');
    }
    return prefix;
}

export function normalizeCustomerProductCode(value: unknown) {
    const code = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!code) {
        return undefined;
    }
    if (!CUSTOMER_PRODUCT_CODE_RE.test(code)) {
        throw new Error('Kode barang customer hanya boleh berisi huruf/angka singkat, misalnya BRG-001');
    }
    return code;
}

function normalizeSupplierCode(value: unknown) {
    const code = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!code) {
        throw new Error('Kode supplier wajib diisi');
    }
    if (!SUPPLIER_CODE_RE.test(code)) {
        throw new Error('Kode supplier hanya boleh berisi huruf/angka singkat, misalnya SUP-001');
    }
    return code;
}

function normalizeWarehouseItemCode(value: unknown) {
    const code = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!code) {
        throw new Error('Kode barang gudang wajib diisi');
    }
    if (!WAREHOUSE_ITEM_CODE_RE.test(code)) {
        throw new Error('Kode barang gudang hanya boleh berisi huruf/angka singkat, misalnya BRG-001');
    }
    return code;
}

export async function normalizeSupplierPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const supplierCode =
        Object.prototype.hasOwnProperty.call(data, 'supplierCode') || !existing
            ? normalizeSupplierCode(data.supplierCode)
            : normalizeSupplierCode(existing?.supplierCode);
    const name =
        Object.prototype.hasOwnProperty.call(data, 'name') || !existing
            ? normalizeText(data.name)
            : normalizeOptionalText(existing?.name) || '';
    if (!name) {
        throw new Error('Nama supplier wajib diisi');
    }

    const duplicateCode = (await listDocumentsByFilter<{ _id: string; supplierCode?: string }>('supplier', {
        supplierCode,
    }))
        .find(item => item._id !== (existingId || ''))
        || null;
    if (duplicateCode) {
        throw new Error('Kode supplier sudah digunakan');
    }

    const defaultTermDays =
        Object.prototype.hasOwnProperty.call(data, 'defaultTermDays') || !existing
            ? parseStrictNumericInput(normalizeKontanTermValue(data.defaultTermDays) ?? 0, 'Termin default supplier tidak valid', {
                allowDecimal: false,
                maxFractionDigits: 0,
            })
            : normalizeNumber(existing?.defaultTermDays ?? 0, {
                allowDecimal: false,
                maxFractionDigits: 0,
            });
    if (!Number.isFinite(defaultTermDays) || defaultTermDays < 0) {
        throw new Error('Termin default supplier tidak valid');
    }

    next.supplierCode = supplierCode;
    next.name = name;
    next.contactPerson =
        Object.prototype.hasOwnProperty.call(data, 'contactPerson') || !existing
            ? normalizeOptionalText(data.contactPerson)
            : normalizeOptionalText(existing?.contactPerson);
    next.phone =
        Object.prototype.hasOwnProperty.call(data, 'phone') || !existing
            ? normalizeOptionalText(data.phone)
            : normalizeOptionalText(existing?.phone);
    next.address =
        Object.prototype.hasOwnProperty.call(data, 'address') || !existing
            ? normalizeOptionalText(data.address)
            : normalizeOptionalText(existing?.address);
    next.defaultTermDays = Math.round(defaultTermDays);
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status supplier tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeWarehouseItemPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const itemCode =
        Object.prototype.hasOwnProperty.call(data, 'itemCode') || !existing
            ? normalizeWarehouseItemCode(data.itemCode)
            : normalizeWarehouseItemCode(existing?.itemCode);
    const name =
        Object.prototype.hasOwnProperty.call(data, 'name') || !existing
            ? normalizeText(data.name)
            : normalizeOptionalText(existing?.name) || '';
    if (!name) {
        throw new Error('Nama barang gudang wajib diisi');
    }

    const duplicateCode = (await listDocumentsByFilter<{ _id: string; itemCode?: string }>('warehouseItem', {
        itemCode,
    }))
        .find(item => item._id !== (existingId || ''))
        || null;
    if (duplicateCode) {
        throw new Error('Kode barang gudang sudah digunakan');
    }

    const unit =
        Object.prototype.hasOwnProperty.call(data, 'unit') || !existing
            ? normalizeText(data.unit).toUpperCase()
            : normalizeText(existing?.unit).toUpperCase();
    if (!isInventoryUnit(unit)) {
        throw new Error('Satuan barang gudang tidak valid');
    }

    const minStockQty =
        Object.prototype.hasOwnProperty.call(data, 'minStockQty') || !existing
            ? parseInventoryQuantity(data.minStockQty ?? 0)
            : parseInventoryQuantity(existing?.minStockQty ?? 0);
    if (!Number.isFinite(minStockQty) || minStockQty < 0) {
        throw new Error('Stok minimum barang gudang tidak valid');
    }

    const defaultPurchasePrice =
        Object.prototype.hasOwnProperty.call(data, 'defaultPurchasePrice') || !existing
            ? parseWholeMoneyAmount(data.defaultPurchasePrice ?? 0)
            : parseWholeMoneyAmount(existing?.defaultPurchasePrice ?? 0);
    if (!Number.isFinite(defaultPurchasePrice) || defaultPurchasePrice < 0) {
        throw new Error('Harga beli default barang gudang tidak valid');
    }

    const supplierRef =
        Object.prototype.hasOwnProperty.call(data, 'defaultSupplierRef') || !existing
            ? normalizeOptionalText(data.defaultSupplierRef)
            : normalizeOptionalText(existing?.defaultSupplierRef);
    let supplierName =
        Object.prototype.hasOwnProperty.call(data, 'defaultSupplierName') || !existing
            ? normalizeOptionalText(data.defaultSupplierName)
            : normalizeOptionalText(existing?.defaultSupplierName);

    if (supplierRef) {
        const supplier = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(supplierRef, 'supplier');
        if (!supplier) {
            throw new Error('Supplier default barang gudang tidak ditemukan');
        }
        if (supplier.active === false) {
            throw new Error('Supplier default barang gudang tidak aktif');
        }
        supplierName = supplier.name || supplierName;
    } else {
        supplierName = undefined;
    }

    const trackingMode =
        Object.prototype.hasOwnProperty.call(data, 'trackingMode') || !existing
            ? normalizeWarehouseItemTrackingMode(data.trackingMode)
            : normalizeWarehouseItemTrackingMode(existing?.trackingMode);
    if (!isWarehouseItemTrackingMode(trackingMode)) {
        throw new Error('Mode tracking barang gudang tidak valid');
    }
    const tireTypeDefault =
        Object.prototype.hasOwnProperty.call(data, 'tireTypeDefault') || !existing
            ? normalizeOptionalTireType(data.tireTypeDefault)
            : normalizeOptionalTireType(existing?.tireTypeDefault);
    const tireBrandDefault =
        Object.prototype.hasOwnProperty.call(data, 'tireBrandDefault') || !existing
            ? normalizeOptionalText(data.tireBrandDefault)
            : normalizeOptionalText(existing?.tireBrandDefault);
    const tireSizeDefault =
        Object.prototype.hasOwnProperty.call(data, 'tireSizeDefault') || !existing
            ? normalizeOptionalText(data.tireSizeDefault)
            : normalizeOptionalText(existing?.tireSizeDefault);

    if (trackingMode === 'TIRE_ASSET') {
        if (unit !== 'PCS' && unit !== 'UNIT') {
            throw new Error('Barang gudang ban tertracking hanya boleh memakai satuan PCS atau UNIT');
        }
        if (!tireTypeDefault) {
            throw new Error('Jenis ban default barang gudang tidak valid');
        }
        if (!tireBrandDefault) {
            throw new Error('Merk ban default wajib diisi untuk barang gudang ban tertracking');
        }
        if (!tireSizeDefault) {
            throw new Error('Ukuran ban default wajib diisi untuk barang gudang ban tertracking');
        }
    }

    next.itemCode = itemCode;
    next.name = name;
    next.category =
        Object.prototype.hasOwnProperty.call(data, 'category') || !existing
            ? normalizeOptionalText(data.category)
            : normalizeOptionalText(existing?.category);
    next.unit = unit;
    next.trackingMode = trackingMode;
    next.minStockQty = minStockQty;
    next.defaultSupplierRef = supplierRef;
    next.defaultSupplierName = supplierName;
    next.defaultPurchasePrice = defaultPurchasePrice > 0 ? defaultPurchasePrice : undefined;
    next.tireTypeDefault = trackingMode === 'TIRE_ASSET' ? tireTypeDefault : undefined;
    next.tireBrandDefault = trackingMode === 'TIRE_ASSET' ? tireBrandDefault : undefined;
    next.tireSizeDefault = trackingMode === 'TIRE_ASSET' ? tireSizeDefault : undefined;
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status barang gudang tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }
    if (!existing) {
        next.currentStockQty = 0;
    } else if (Object.prototype.hasOwnProperty.call(existing, 'currentStockQty')) {
        next.currentStockQty = parseInventoryQuantity(existing.currentStockQty ?? 0);
    }

    return next;
}

function normalizeIsoDateInput(value: unknown, label: string) {
    const text = normalizeOptionalText(value);
    if (!text) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error(`${label} tidak valid`);
    }
    return text;
}

export async function normalizeSupplierItemPricePayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const supplierRef =
        Object.prototype.hasOwnProperty.call(data, 'supplierRef') || !existing
            ? normalizeOptionalText(data.supplierRef)
            : normalizeOptionalText(existing?.supplierRef);
    const warehouseItemRef =
        Object.prototype.hasOwnProperty.call(data, 'warehouseItemRef') || !existing
            ? normalizeOptionalText(data.warehouseItemRef)
            : normalizeOptionalText(existing?.warehouseItemRef);

    if (!supplierRef) {
        throw new Error('Supplier harga barang wajib dipilih');
    }
    if (!warehouseItemRef) {
        throw new Error('Barang gudang harga supplier wajib dipilih');
    }

    const [supplier, item] = await Promise.all([
        getDocumentById<Supplier>(supplierRef, 'supplier'),
        getDocumentById<WarehouseItem>(warehouseItemRef, 'warehouseItem'),
    ]);
    if (!supplier || supplier._type !== 'supplier') {
        throw new Error('Supplier harga barang tidak ditemukan');
    }
    if (supplier.active === false) {
        throw new Error('Supplier harga barang tidak aktif');
    }
    if (!item || item._type !== 'warehouseItem') {
        throw new Error('Barang gudang harga supplier tidak ditemukan');
    }
    if (item.active === false) {
        throw new Error('Barang gudang harga supplier tidak aktif');
    }

    const defaultPurchasePrice =
        Object.prototype.hasOwnProperty.call(data, 'defaultPurchasePrice') || !existing
            ? parseWholeMoneyAmount(data.defaultPurchasePrice ?? 0)
            : parseWholeMoneyAmount(existing?.defaultPurchasePrice ?? 0);
    if (!Number.isFinite(defaultPurchasePrice) || defaultPurchasePrice <= 0) {
        throw new Error('Harga beli supplier wajib lebih besar dari 0');
    }

    const minOrderQty =
        Object.prototype.hasOwnProperty.call(data, 'minOrderQty') || !existing
            ? parseInventoryQuantity(data.minOrderQty ?? 0)
            : parseInventoryQuantity(existing?.minOrderQty ?? 0);
    if (!Number.isFinite(minOrderQty) || minOrderQty < 0) {
        throw new Error('Minimum order supplier tidak valid');
    }

    const leadTimeDays =
        Object.prototype.hasOwnProperty.call(data, 'leadTimeDays') || !existing
            ? parseStrictNumericInput(data.leadTimeDays ?? 0, 'Lead time supplier tidak valid', { allowDecimal: false, maxFractionDigits: 0 })
            : parseStrictNumericInput(existing?.leadTimeDays ?? 0, 'Lead time supplier tidak valid', { allowDecimal: false, maxFractionDigits: 0 });
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) {
        throw new Error('Lead time supplier tidak valid');
    }

    const effectiveFrom =
        Object.prototype.hasOwnProperty.call(data, 'effectiveFrom') || !existing
            ? normalizeIsoDateInput(data.effectiveFrom, 'Tanggal mulai harga supplier')
            : normalizeIsoDateInput(existing?.effectiveFrom, 'Tanggal mulai harga supplier');
    const effectiveTo =
        Object.prototype.hasOwnProperty.call(data, 'effectiveTo') || !existing
            ? normalizeIsoDateInput(data.effectiveTo, 'Tanggal akhir harga supplier')
            : normalizeIsoDateInput(existing?.effectiveTo, 'Tanggal akhir harga supplier');
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
        throw new Error('Tanggal akhir harga supplier tidak boleh lebih awal dari tanggal mulai');
    }

    const active =
        Object.prototype.hasOwnProperty.call(data, 'active') || !existing
            ? data.active !== false
            : existing?.active !== false;
    if (active) {
        const duplicate = (await listDocumentsByFilter<{ _id: string }>('supplierItemPrice', {
            supplierRef,
            warehouseItemRef,
            active: true,
        })).find(row => row._id !== (existingId || '')) || null;
        if (duplicate) {
            throw new Error('Harga aktif untuk kombinasi supplier dan barang ini sudah ada');
        }
    }

    next.supplierRef = supplier._id;
    next.supplierCode = supplier.supplierCode;
    next.supplierName = supplier.name;
    next.warehouseItemRef = item._id;
    next.itemCode = item.itemCode;
    next.itemName = item.name;
    next.itemUnit = item.unit;
    next.supplierSku =
        Object.prototype.hasOwnProperty.call(data, 'supplierSku') || !existing
            ? normalizeOptionalText(data.supplierSku)
            : normalizeOptionalText(existing?.supplierSku);
    next.supplierItemName =
        Object.prototype.hasOwnProperty.call(data, 'supplierItemName') || !existing
            ? normalizeOptionalText(data.supplierItemName)
            : normalizeOptionalText(existing?.supplierItemName);
    next.defaultPurchasePrice = defaultPurchasePrice;
    next.minOrderQty = minOrderQty > 0 ? minOrderQty : undefined;
    next.leadTimeDays = leadTimeDays > 0 ? Math.round(leadTimeDays) : undefined;
    next.effectiveFrom = effectiveFrom;
    next.effectiveTo = effectiveTo;
    next.active = active;
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    next.updatedAt = new Date().toISOString();
    if (!existing) {
        next.createdAt = next.updatedAt;
    }

    return next;
}

export function normalizeCustomerPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(data, 'name') || !existing) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama customer wajib diisi');
        }
        next.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'address') || !existing) {
        next.address = normalizeOptionalText(data.address) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'contactPerson') || !existing) {
        next.contactPerson = normalizeOptionalText(data.contactPerson) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'phone') || !existing) {
        next.phone = normalizeOptionalText(data.phone) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'email') || !existing) {
        next.email = normalizeOptionalText(data.email) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'npwp') || !existing) {
        next.npwp = normalizeOptionalText(data.npwp);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'defaultPaymentTerm') || !existing) {
        const defaultPaymentTerm = parseStrictNumericInput(
            data.defaultPaymentTerm,
            'Termin pembayaran customer tidak valid',
            { allowDecimal: false, maxFractionDigits: 0 }
        );
        if (!Number.isFinite(defaultPaymentTerm) || defaultPaymentTerm < 0) {
            throw new Error('Termin pembayaran customer tidak valid');
        }
        next.defaultPaymentTerm = Math.round(defaultPaymentTerm);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'creditLimitAmount') || !existing) {
        const creditLimitAmount = parseStrictNumericInput(
            data.creditLimitAmount ?? 0,
            'Limit piutang customer tidak valid',
            { allowDecimal: false, maxFractionDigits: 0 }
        );
        if (!Number.isFinite(creditLimitAmount) || creditLimitAmount < 0) {
            throw new Error('Limit piutang customer tidak valid');
        }
        next.creditLimitAmount = Math.round(creditLimitAmount);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'deliveryOrderPrefix') || !existing) {
        next.deliveryOrderPrefix = normalizeCustomerDoPrefix(data.deliveryOrderPrefix);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'defaultFreightNotaBillingMode') || !existing) {
        next.defaultFreightNotaBillingMode = Object.prototype.hasOwnProperty.call(data, 'defaultFreightNotaBillingMode')
            ? resolveFreightNotaBillingModeInput(
                data.defaultFreightNotaBillingMode,
                'Default basis billing invoice customer',
                { allowEmpty: false }
            )
            : normalizeFreightNotaBillingMode(existing?.defaultFreightNotaBillingMode);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'defaultPph23Enabled') || !existing) {
        next.defaultPph23Enabled = Object.prototype.hasOwnProperty.call(data, 'defaultPph23Enabled')
            ? normalizePph23Enabled(data.defaultPph23Enabled)
            : normalizePph23Enabled(existing?.defaultPph23Enabled);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'defaultPph23RatePercent') || !existing) {
        const fallbackRate =
            existing && existing.defaultPph23RatePercent !== undefined
                ? normalizePph23RatePercent(existing.defaultPph23RatePercent)
                : DEFAULT_PPH23_RATE_PERCENT;
        const ratePercent = Object.prototype.hasOwnProperty.call(data, 'defaultPph23RatePercent')
            ? normalizePph23RatePercent(data.defaultPph23RatePercent, fallbackRate)
            : fallbackRate;
        if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
            throw new Error('Default tarif PPh 23 customer tidak valid');
        }
        next.defaultPph23RatePercent = ratePercent;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'defaultPph23BaseMode') || !existing) {
        next.defaultPph23BaseMode = Object.prototype.hasOwnProperty.call(data, 'defaultPph23BaseMode')
            ? normalizePph23BaseMode(data.defaultPph23BaseMode)
            : normalizePph23BaseMode(existing?.defaultPph23BaseMode);
    }
    if (normalizePph23Enabled(next.defaultPph23Enabled ?? existing?.defaultPph23Enabled) && normalizePph23RatePercent(next.defaultPph23RatePercent ?? existing?.defaultPph23RatePercent, DEFAULT_PPH23_RATE_PERCENT) <= 0) {
        throw new Error('Default tarif PPh 23 customer harus lebih dari 0%');
    }

    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status customer tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    if (existing) {
        next.deliveryOrderCounter =
            typeof existing.deliveryOrderCounter === 'number' && Number.isFinite(existing.deliveryOrderCounter)
                ? existing.deliveryOrderCounter
                : 0;
        next.deliveryOrderPeriod =
            typeof existing.deliveryOrderPeriod === 'string' ? existing.deliveryOrderPeriod : undefined;
    } else {
        next.deliveryOrderCounter = 0;
    }

    return next;
}

export async function normalizeBankAccountPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;

    if (Object.prototype.hasOwnProperty.call(data, 'bankName') || !existing) {
        const bankName = normalizeText(data.bankName);
        if (!bankName) {
            throw new Error('Nama rekening / kas wajib diisi');
        }
        next.bankName = bankName;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'accountNumber') || !existing) {
        const accountNumber = normalizeText(data.accountNumber);
        if (!accountNumber) {
            throw new Error('Nomor rekening / kode kas wajib diisi');
        }
        next.accountNumber = accountNumber;
    }

    const effectiveAccountNumber =
        typeof next.accountNumber === 'string'
            ? next.accountNumber
            : normalizeOptionalText(existing?.accountNumber);
    if (effectiveAccountNumber) {
        const duplicateAccountNumber = (await listDocumentsByFilter<{ _id: string; accountNumber?: string }>('bankAccount', {
            accountNumber: effectiveAccountNumber,
        }))
            .find(item => item._id !== (existingId || ''))
            || null;
        if (duplicateAccountNumber) {
            throw new Error('Nomor rekening / kode kas sudah digunakan');
        }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'accountHolder') || !existing) {
        const accountHolder = normalizeText(data.accountHolder);
        if (!accountHolder) {
            throw new Error('Atas nama rekening / kas wajib diisi');
        }
        next.accountHolder = accountHolder;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'initialBalance') || !existing) {
        const initialBalance = parseStrictNumericInput(
            data.initialBalance,
            'Saldo awal rekening / kas tidak valid',
            { allowDecimal: false, maxFractionDigits: 0 }
        );
        if (!Number.isFinite(initialBalance) || initialBalance < 0) {
            throw new Error('Saldo awal rekening / kas tidak valid');
        }
        next.initialBalance = initialBalance;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'notes') || !existing) {
        next.notes = normalizeOptionalText(data.notes);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status rekening / kas tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeCustomerProductPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const customerRef =
        Object.prototype.hasOwnProperty.call(data, 'customerRef') || !existing
            ? normalizeText(data.customerRef)
            : normalizeOptionalText(existing?.customerRef) || '';
    if (!customerRef) {
        throw new Error('Customer barang wajib dipilih');
    }

    const customer = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(customerRef, 'customer');
    if (!customer) {
        throw new Error('Customer barang tidak ditemukan');
    }
    if (customer.active === false && (!existing || customerRef !== normalizeOptionalText(existing.customerRef))) {
        throw new Error('Customer tidak aktif dan tidak bisa dipakai untuk master barang baru');
    }

    const name =
        Object.prototype.hasOwnProperty.call(data, 'name') || !existing
            ? normalizeText(data.name)
            : normalizeOptionalText(existing?.name) || '';
    if (!name) {
        throw new Error('Nama barang customer wajib diisi');
    }

    const code =
        Object.prototype.hasOwnProperty.call(data, 'code') || !existing
            ? normalizeCustomerProductCode(data.code)
            : normalizeCustomerProductCode(existing?.code);
    if (code) {
        const duplicateCode = (await listDocumentsByFilter<{ _id: string; code?: string }>('customerProduct', {
            customerRef,
            code,
        }))
            .find(item => item._id !== (existingId || ''))
            || null;
        if (duplicateCode) {
            throw new Error('Kode barang customer sudah digunakan');
        }
    }

    const description =
        Object.prototype.hasOwnProperty.call(data, 'description') || !existing
            ? normalizeOptionalText(data.description)
            : normalizeOptionalText(existing?.description);
    const hasDefaultQtyKoli = Object.prototype.hasOwnProperty.call(data, 'defaultQtyKoli');
    const defaultQtyRaw =
        hasDefaultQtyKoli || !existing
            ? hasDefaultQtyKoli
                ? parseStrictNumericInput(data.defaultQtyKoli ?? 1, 'Default koli barang customer tidak valid', {
                    allowDecimal: false,
                    maxFractionDigits: 0,
                })
                : normalizeNumber(data.defaultQtyKoli ?? 1)
            : normalizeNumber(existing?.defaultQtyKoli ?? 1);
    if (!Number.isFinite(defaultQtyRaw) || defaultQtyRaw < 0) {
        throw new Error('Default koli barang customer tidak valid');
    }

    const hasDefaultWeightInputUnit = Object.prototype.hasOwnProperty.call(data, 'defaultWeightInputUnit');
    const requestedWeightInputUnit = normalizeText(
        hasDefaultWeightInputUnit
            ? data.defaultWeightInputUnit
            : ''
    ).toUpperCase();
    if (hasDefaultWeightInputUnit && !requestedWeightInputUnit) {
        throw new Error('Satuan default berat barang customer tidak valid');
    }
    if (requestedWeightInputUnit && !isWeightInputUnit(requestedWeightInputUnit)) {
        throw new Error('Satuan default berat barang customer tidak valid');
    }
    const weightInputUnit: WeightInputUnit =
        hasDefaultWeightInputUnit
            ? requestedWeightInputUnit as WeightInputUnit
            : readWeightInputUnit(existing?.defaultWeightInputUnit, 'KG');
    const hasDefaultWeightValue =
        Object.prototype.hasOwnProperty.call(data, 'defaultWeightInputValue')
        || Object.prototype.hasOwnProperty.call(data, 'defaultWeight');
    const defaultWeightInputValue =
        hasDefaultWeightValue || !existing
            ? hasDefaultWeightValue
                ? parseStrictNumericInput(
                    data.defaultWeightInputValue ?? data.defaultWeight ?? 0,
                    'Default berat barang customer tidak valid',
                    { maxFractionDigits: getWeightInputFractionDigits(weightInputUnit) }
                )
                : normalizeNumber(data.defaultWeightInputValue ?? data.defaultWeight ?? 0, {
                    maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
                })
            : normalizeNumber(
                existing?.defaultWeightInputValue ??
                convertKgToWeightInputValue(normalizeNumber(existing?.defaultWeight ?? 0), weightInputUnit),
                {
                    maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
                }
            );
    if (!Number.isFinite(defaultWeightInputValue) || defaultWeightInputValue < 0) {
        throw new Error('Default berat barang customer tidak valid');
    }
    const defaultWeight = defaultWeightInputValue > 0 ? convertWeightToKg(defaultWeightInputValue, weightInputUnit) : undefined;

    const hasDefaultVolumeInputUnit = Object.prototype.hasOwnProperty.call(data, 'defaultVolumeInputUnit');
    const requestedVolumeInputUnit = normalizeText(
        hasDefaultVolumeInputUnit
            ? data.defaultVolumeInputUnit
            : ''
    ).toUpperCase();
    if (hasDefaultVolumeInputUnit && !requestedVolumeInputUnit) {
        throw new Error('Satuan default volume barang customer tidak valid');
    }
    if (requestedVolumeInputUnit && !isVolumeInputUnit(requestedVolumeInputUnit)) {
        throw new Error('Satuan default volume barang customer tidak valid');
    }
    const volumeInputUnit: VolumeInputUnit =
        hasDefaultVolumeInputUnit
            ? requestedVolumeInputUnit as VolumeInputUnit
            : readVolumeInputUnit(existing?.defaultVolumeInputUnit, 'M3');
    const hasDefaultVolumeValue =
        Object.prototype.hasOwnProperty.call(data, 'defaultVolumeInputValue')
        || Object.prototype.hasOwnProperty.call(data, 'defaultVolume');
    const defaultVolumeInputValue =
        hasDefaultVolumeValue || !existing
            ? hasDefaultVolumeValue
                ? parseStrictNumericInput(
                    data.defaultVolumeInputValue ?? data.defaultVolume ?? 0,
                    'Default volume barang customer tidak valid',
                    {
                        allowDecimal: volumeInputUnit !== 'LITER',
                        maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
                    }
                )
                : normalizeNumber(data.defaultVolumeInputValue ?? data.defaultVolume ?? 0, {
                    maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
                })
            : normalizeNumber(
                existing?.defaultVolumeInputValue ??
                convertM3ToVolumeInputValue(normalizeNumber(existing?.defaultVolume ?? 0), volumeInputUnit),
                {
                    maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
                }
            );
    if (!Number.isFinite(defaultVolumeInputValue) || defaultVolumeInputValue < 0) {
        throw new Error('Default volume barang customer tidak valid');
    }
    const defaultVolume = defaultVolumeInputValue > 0 ? convertVolumeToM3(defaultVolumeInputValue, volumeInputUnit) : undefined;

    next.customerRef = customerRef;
    next.customerName = customer.name || '';
    next.code = code;
    next.name = name;
    next.description = description || name;
    next.defaultQtyKoli = defaultQtyRaw > 0 ? Math.round(defaultQtyRaw) : undefined;
    next.defaultWeight = defaultWeight;
    next.defaultWeightInputValue = defaultWeightInputValue > 0 ? defaultWeightInputValue : undefined;
    next.defaultWeightInputUnit = defaultWeightInputValue > 0 ? weightInputUnit : undefined;
    next.defaultVolume = defaultVolume;
    next.defaultVolumeInputValue = defaultVolumeInputValue > 0 ? defaultVolumeInputValue : undefined;
    next.defaultVolumeInputUnit = defaultVolumeInputValue > 0 ? volumeInputUnit : undefined;
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status barang customer tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeCustomerBillingRatePayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const customerRef =
        Object.prototype.hasOwnProperty.call(data, 'customerRef') || !existing
            ? normalizeText(data.customerRef)
            : normalizeOptionalText(existing?.customerRef) || '';
    if (!customerRef) {
        throw new Error('Customer tarif wajib dipilih');
    }

    const customer = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(customerRef, 'customer');
    if (!customer) {
        throw new Error('Customer tarif tidak ditemukan');
    }
    if (customer.active === false && (!existing || customerRef !== normalizeOptionalText(existing.customerRef))) {
        throw new Error('Customer tidak aktif dan tidak bisa dipakai untuk tarif baru');
    }

    const serviceRef =
        Object.prototype.hasOwnProperty.call(data, 'serviceRef') || !existing
            ? normalizeOptionalText(data.serviceRef)
            : normalizeOptionalText(existing?.serviceRef);
    let serviceName: string | undefined;
    if (serviceRef) {
        const service = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(serviceRef, 'service');
        if (!service) {
            throw new Error('Jenis armada tarif customer tidak ditemukan');
        }
        if (service.active === false) {
            throw new Error('Jenis armada tarif customer tidak aktif');
        }
        serviceName = service.name || '';
    }

    const basis =
        Object.prototype.hasOwnProperty.call(data, 'basis') || !existing
            ? resolveFreightNotaBillingModeInput(data.basis, 'Basis tarif customer')
            : normalizeFreightNotaBillingMode(existing?.basis);
    const rate =
        Object.prototype.hasOwnProperty.call(data, 'rate') || !existing
            ? normalizeCurrencyNumber(data.rate)
            : normalizeCurrencyNumber(existing?.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Tarif customer harus lebih besar dari 0');
    }

    const routeFrom =
        Object.prototype.hasOwnProperty.call(data, 'routeFrom') || !existing
            ? normalizeOptionalText(data.routeFrom)
            : normalizeOptionalText(existing?.routeFrom);
    const routeTo =
        Object.prototype.hasOwnProperty.call(data, 'routeTo') || !existing
            ? normalizeOptionalText(data.routeTo)
            : normalizeOptionalText(existing?.routeTo);

    const duplicateRate = (await listDocumentsByFilter<{
        _id: string;
        customerRef?: string;
        serviceRef?: string;
        basis?: string;
        routeFrom?: string;
        routeTo?: string;
    }>('customerBillingRate', { customerRef }))
        .find(item =>
            item._id !== (existingId || '') &&
            normalizeOptionalText(item.serviceRef) === (serviceRef || undefined) &&
            normalizeFreightNotaBillingMode(item.basis) === basis &&
            normalizeOptionalText(item.routeFrom)?.toLowerCase() === routeFrom?.toLowerCase() &&
            normalizeOptionalText(item.routeTo)?.toLowerCase() === routeTo?.toLowerCase()
        )
        || null;
    if (duplicateRate) {
        throw new Error('Tarif customer untuk kombinasi armada, basis, dan rute ini sudah ada');
    }

    next.customerRef = customerRef;
    next.customerName = customer.name || '';
    next.serviceRef = serviceRef;
    next.serviceName = serviceName;
    next.basis = basis;
    next.rate = rate;
    next.routeFrom = routeFrom;
    next.routeTo = routeTo;
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status tarif customer tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeCustomerRecipientPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const customerRef =
        Object.prototype.hasOwnProperty.call(data, 'customerRef') || !existing
            ? normalizeText(data.customerRef)
            : normalizeOptionalText(existing?.customerRef) || '';
    if (!customerRef) {
        throw new Error('Customer penerima wajib dipilih');
    }

    const customer = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(customerRef, 'customer');
    if (!customer) {
        throw new Error('Customer penerima tidak ditemukan');
    }
    if (customer.active === false && (!existing || customerRef !== normalizeOptionalText(existing.customerRef))) {
        throw new Error('Customer tidak aktif dan tidak bisa dipakai untuk master penerima baru');
    }

    const label =
        Object.prototype.hasOwnProperty.call(data, 'label') || !existing
            ? normalizeText(data.label)
            : normalizeOptionalText(existing?.label) || '';
    if (!label) {
        throw new Error('Label master penerima wajib diisi');
    }

    const duplicateLabel = (await listDocumentsByFilter<{ _id: string; label?: string }>('customerRecipient', { customerRef }))
        .find(item => normalizeText(item.label) === label && item._id !== (existingId || ''))
        || null;
    if (duplicateLabel) {
        throw new Error('Label master penerima sudah digunakan untuk customer ini');
    }

    const receiverName =
        Object.prototype.hasOwnProperty.call(data, 'receiverName') || !existing
            ? normalizeText(data.receiverName)
            : normalizeOptionalText(existing?.receiverName) || '';
    if (!receiverName) {
        throw new Error('Nama penerima wajib diisi');
    }

    const receiverAddress =
        Object.prototype.hasOwnProperty.call(data, 'receiverAddress') || !existing
            ? normalizeText(data.receiverAddress)
            : normalizeOptionalText(existing?.receiverAddress) || '';
    if (!receiverAddress) {
        throw new Error('Alamat penerima wajib diisi');
    }

    const nextActive =
        Object.prototype.hasOwnProperty.call(data, 'active') || !existing
            ? (() => {
                if (data.active !== undefined && typeof data.active !== 'boolean') {
                    throw new Error('Status master penerima tidak valid');
                }
                return typeof data.active === 'boolean' ? data.active : true;
            })()
            : Boolean(existing?.active !== false);
    const nextDefault =
        nextActive === false
            ? false
            : Object.prototype.hasOwnProperty.call(data, 'isDefault') || !existing
                ? (() => {
                    if (data.isDefault !== undefined && typeof data.isDefault !== 'boolean') {
                        throw new Error('Status default master penerima tidak valid');
                    }
                    return typeof data.isDefault === 'boolean' ? data.isDefault : false;
                })()
                : Boolean(existing?.isDefault);

    next.customerRef = customerRef;
    next.customerName = customer.name || '';
    next.label = label;
    next.receiverName = receiverName;
    next.receiverPhone =
        Object.prototype.hasOwnProperty.call(data, 'receiverPhone') || !existing
            ? normalizeOptionalText(data.receiverPhone)
            : normalizeOptionalText(existing?.receiverPhone);
    next.receiverAddress = receiverAddress;
    next.receiverCompany =
        Object.prototype.hasOwnProperty.call(data, 'receiverCompany') || !existing
            ? normalizeOptionalText(data.receiverCompany)
            : normalizeOptionalText(existing?.receiverCompany);
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    next.active = nextActive;
    next.isDefault = nextDefault;

    return next;
}

export async function normalizeCustomerPickupPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const customerRef =
        Object.prototype.hasOwnProperty.call(data, 'customerRef') || !existing
            ? normalizeText(data.customerRef)
            : normalizeOptionalText(existing?.customerRef) || '';
    if (!customerRef) {
        throw new Error('Customer pickup wajib dipilih');
    }

    const customer = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(customerRef, 'customer');
    if (!customer) {
        throw new Error('Customer pickup tidak ditemukan');
    }
    if (customer.active === false && (!existing || customerRef !== normalizeOptionalText(existing.customerRef))) {
        throw new Error('Customer tidak aktif dan tidak bisa dipakai untuk master pickup baru');
    }

    const label =
        Object.prototype.hasOwnProperty.call(data, 'label') || !existing
            ? normalizeText(data.label)
            : normalizeOptionalText(existing?.label) || '';
    if (!label) {
        throw new Error('Label master pickup wajib diisi');
    }

    const duplicateLabel = (await listDocumentsByFilter<{ _id: string; label?: string }>('customerPickupLocation', { customerRef }))
        .find(item => normalizeText(item.label) === label && item._id !== (existingId || ''))
        || null;
    if (duplicateLabel) {
        throw new Error('Label master pickup sudah digunakan untuk customer ini');
    }

    const pickupAddress =
        Object.prototype.hasOwnProperty.call(data, 'pickupAddress') || !existing
            ? normalizeText(data.pickupAddress)
            : normalizeOptionalText(existing?.pickupAddress) || '';
    if (!pickupAddress) {
        throw new Error('Alamat pickup wajib diisi');
    }

    const nextActive =
        Object.prototype.hasOwnProperty.call(data, 'active') || !existing
            ? (() => {
                if (data.active !== undefined && typeof data.active !== 'boolean') {
                    throw new Error('Status master pickup tidak valid');
                }
                return typeof data.active === 'boolean' ? data.active : true;
            })()
            : Boolean(existing?.active !== false);
    const nextDefault =
        nextActive === false
            ? false
            : Object.prototype.hasOwnProperty.call(data, 'isDefault') || !existing
                ? (() => {
                    if (data.isDefault !== undefined && typeof data.isDefault !== 'boolean') {
                        throw new Error('Status default master pickup tidak valid');
                    }
                    return typeof data.isDefault === 'boolean' ? data.isDefault : false;
                })()
                : Boolean(existing?.isDefault);

    next.customerRef = customerRef;
    next.customerName = customer.name || '';
    next.label = label;
    next.pickupAddress = pickupAddress;
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    next.active = nextActive;
    next.isDefault = nextDefault;

    return next;
}

export async function normalizeTripRouteRatePayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const originArea =
        Object.prototype.hasOwnProperty.call(data, 'originArea') || !existing
            ? normalizeText(data.originArea)
            : normalizeOptionalText(existing?.originArea) || '';
    if (!originArea) {
        throw new Error('Asal area trip wajib diisi');
    }

    const destinationArea =
        Object.prototype.hasOwnProperty.call(data, 'destinationArea') || !existing
            ? normalizeText(data.destinationArea)
            : normalizeOptionalText(existing?.destinationArea) || '';
    if (!destinationArea) {
        throw new Error('Tujuan area trip wajib diisi');
    }

    const rate =
        Object.prototype.hasOwnProperty.call(data, 'rate') || !existing
            ? normalizeCurrencyNumber(data.rate)
            : normalizeCurrencyNumber(existing?.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Tarif trip harus lebih besar dari 0');
    }

    const overtonaseDriverRatePerTon =
        Object.prototype.hasOwnProperty.call(data, 'overtonaseDriverRatePerTon') || !existing
            ? normalizeCurrencyNumber(data.overtonaseDriverRatePerTon ?? 0)
            : normalizeCurrencyNumber(existing?.overtonaseDriverRatePerTon ?? 0);
    if (!Number.isFinite(overtonaseDriverRatePerTon) || overtonaseDriverRatePerTon < 0) {
        throw new Error('Referensi overtonase per ton tidak valid');
    }

    const serviceRef =
        Object.prototype.hasOwnProperty.call(data, 'serviceRef') || !existing
            ? normalizeOptionalText(data.serviceRef)
            : normalizeOptionalText(existing?.serviceRef);

    let serviceName: string | undefined;
    if (serviceRef) {
        const service = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(serviceRef, 'service');
        if (!service) {
            throw new Error('Kategori armada tarif trip tidak ditemukan');
        }
        if (service.active === false) {
            throw new Error('Kategori armada tarif trip tidak aktif');
        }
        serviceName = service.name || '';
    }

    const duplicateRate = (await listDocumentsByFilter<{ _id: string; originArea?: string; destinationArea?: string; serviceRef?: string }>('tripRouteRate', {
        originArea,
        destinationArea,
        ...(serviceRef ? { serviceRef } : {}),
    }))
        .find(item =>
            normalizeOptionalText(item.serviceRef) === (serviceRef || undefined)
            && item._id !== (existingId || '')
        )
        || null;
    if (duplicateRate) {
        throw new Error('Master biaya rute trip untuk kombinasi area dan kategori ini sudah ada');
    }

    next.originArea = originArea;
    next.destinationArea = destinationArea;
    next.serviceRef = serviceRef;
    next.serviceName = serviceName;
    next.rate = rate;
    next.overtonaseDriverRatePerTon = overtonaseDriverRatePerTon;
    next.notes = stripTripRouteOvertonaseRateNote(
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes)
    );
    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status tarif trip tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function resolveTripRouteRateSelection(
    data: Record<string, unknown>,
    options?: { serviceRef?: string | null }
) {
    const requestedTripRouteRateRef = normalizeOptionalText(data.tripRouteRateRef);
    const requestedTripOriginArea = normalizeOptionalText(data.tripOriginArea);
    const requestedTripDestinationArea = normalizeOptionalText(data.tripDestinationArea);
    const serviceRef = normalizeOptionalText(options?.serviceRef);

    if (!requestedTripRouteRateRef && !requestedTripOriginArea && !requestedTripDestinationArea) {
        return {
            tripRouteRateRef: undefined,
            tripOriginArea: undefined,
            tripDestinationArea: undefined,
            matchedTripRouteRate: null as (TripRouteRate & { _rev?: string }) | null,
        };
    }

    if ((requestedTripOriginArea && !requestedTripDestinationArea) || (!requestedTripOriginArea && requestedTripDestinationArea)) {
        throw new Error('Asal dan tujuan area trip harus diisi berpasangan');
    }

    let matchedTripRouteRate: (TripRouteRate & { _rev?: string }) | null = null;

    if (requestedTripRouteRateRef) {
        matchedTripRouteRate = await getDocumentById<TripRouteRate & { _rev?: string }>(requestedTripRouteRateRef, 'tripRouteRate');
        if (!matchedTripRouteRate || matchedTripRouteRate._type !== 'tripRouteRate') {
            throw new Error('Master biaya rute trip tidak ditemukan');
        }
        if (matchedTripRouteRate.active === false) {
            throw new Error('Master biaya rute trip sudah nonaktif');
        }
        if (serviceRef && matchedTripRouteRate.serviceRef && matchedTripRouteRate.serviceRef !== serviceRef) {
            throw new Error('Master biaya rute trip tidak cocok dengan kategori armada surat jalan');
        }
    } else if (requestedTripOriginArea && requestedTripDestinationArea) {
        const candidateRates = (await listDocumentsByFilter<Array<TripRouteRate & { _rev?: string }>[number]>('tripRouteRate', {
            originArea: requestedTripOriginArea,
            destinationArea: requestedTripDestinationArea,
            ...(serviceRef ? { serviceRef } : {}),
        }))
            .filter(item =>
                item.active !== false
                && (!serviceRef || normalizeOptionalText(item.serviceRef) === serviceRef)
            );
        matchedTripRouteRate = findMatchingTripRouteRate(candidateRates, {
            originArea: requestedTripOriginArea,
            destinationArea: requestedTripDestinationArea,
            serviceRef,
        });
    }

    return {
        tripRouteRateRef: matchedTripRouteRate?._id,
        tripOriginArea: matchedTripRouteRate?.originArea || requestedTripOriginArea,
        tripDestinationArea: matchedTripRouteRate?.destinationArea || requestedTripDestinationArea,
        matchedTripRouteRate,
    };
}
