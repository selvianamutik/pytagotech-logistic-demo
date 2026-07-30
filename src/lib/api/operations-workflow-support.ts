import { getBusinessCalendarDateParts, getBusinessDateValue } from '@/lib/business-date';
import {
    isExpenseCategoryScope,
    resolveExpenseCategoryAccountKey,
} from '@/lib/expense-category-scope';
import { getDocumentById, listDocumentsByFilter } from '@/lib/repositories/document-store';
import {
    buildDefaultTireLayoutConfig,
    buildTirePlacementLabel,
    formatTireSlotLabel,
    isKnownInternalTireSlotCode,
    normalizeTireLayoutConfig,
    normalizeTireSlotCode,
} from '@/lib/tire-slots';
import { normalizeOptionalTireType } from '@/lib/tire-types';
import type { TireType } from '@/lib/types';

import {
    assertIsoDate,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

export type MaintenanceCreatePayload = {
    vehicleRef: string;
    vehiclePlate?: string;
    type: string;
    scheduleType: 'DATE' | 'ODOMETER';
    plannedDate?: string;
    plannedOdometer?: number;
    notes?: string;
    attachmentUrls: string[];
    materialUsages: unknown[];
};

export type NormalizedTireEventPayload = {
    tireCode: string;
    holderType: 'INTERNAL_VEHICLE' | 'EXTERNAL_VEHICLE' | 'WAREHOUSE';
    status: 'IN_USE' | 'SPARE' | 'IN_WAREHOUSE' | 'LOANED_OUT' | 'SCRAPPED';
    vehicleRef?: string;
    vehiclePlate?: string;
    posisi: string;
    positionKey: string;
    slotCode?: string;
    slotLabel?: string;
    externalPartyName?: string;
    externalPlateNumber?: string;
    tireType: TireType;
    tireBrand: string;
    tireSize: string;
    installDate: string;
    replaceDate?: string;
    purchaseCost?: number;
    originalCost?: number;
    totalUsedPercent?: number;
    remainingPercent?: number;
    remainingValue?: number;
    maintenanceCostPostedPercent?: number;
    maintenanceCostPostedAmount?: number;
    lastMaintenanceCostRef?: string;
    accumulatedKm?: number;
    notes?: string;
};

const SERVICE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/;
const VEHICLE_STATUS_VALUES = new Set(['ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SOLD']);
const VEHICLE_OWNERSHIP_TYPES = new Set(['COMPANY', 'PARTNER']);
const TIRE_HOLDER_TYPES = new Set(['INTERNAL_VEHICLE', 'EXTERNAL_VEHICLE', 'WAREHOUSE']);
const TIRE_EVENT_STATUSES = new Set(['IN_USE', 'SPARE', 'IN_WAREHOUSE', 'LOANED_OUT', 'SCRAPPED']);
const INCIDENT_SETTLEMENT_LINE_TYPES = new Set(['COST', 'COMPENSATION', 'RECOVERY']);
const INCIDENT_SETTLEMENT_LINE_STATUSES = new Set(['DRAFT', 'APPROVED', 'POSTED', 'VOID']);
const INCIDENT_SETTLEMENT_RECIPIENT_TYPES = new Set(['DRIVER', 'KERNET', 'THIRD_PARTY', 'FAMILY', 'VENDOR', 'INSURANCE', 'INTERNAL', 'OTHER']);
const INCIDENT_SETTLEMENT_CATEGORIES = new Set([
    'TOWING',
    'REPAIR',
    'SPAREPART',
    'TIRE',
    'MEDICAL',
    'THIRD_PARTY_DAMAGE',
    'ADMINISTRATION',
    'POLICE_ADMIN',
    'ACCOMMODATION',
    'CARGO_HANDLING',
    'COMPENSATION_DRIVER',
    'COMPENSATION_CREW',
    'COMPENSATION_THIRD_PARTY',
    'COMPENSATION_FAMILY',
    'INSURANCE_CLAIM',
    'THIRD_PARTY_RECOVERY',
    'VENDOR_RECOVERY',
    'INTERNAL_RECOVERY',
    'OTHER',
]);

function hasOwnKey(value: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function getCurrentBusinessYear() {
    return Number(getBusinessCalendarDateParts()?.year || new Date().getFullYear());
}

function normalizeOptionalNonNegativeNumber(value: unknown, label: string) {
    if (value === '' || value === null || value === undefined) {
        return undefined;
    }

    const normalized = normalizeNumber(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
        throw new Error(`${label} tidak valid`);
    }

    return normalized;
}

function parseCapacityRangeValue(value?: string) {
    if (!value) {
        return undefined;
    }

    const normalized = value.replace(',', '.').trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
        return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeOptionalWholeNumber(value: unknown, label: string) {
    if (value === '' || value === null || value === undefined) {
        return undefined;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
            throw new Error(`${label} harus berupa angka bulat`);
        }
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }

        const parts = trimmed.replace(/\s+/g, '').split(/[,.]/);
        if (parts.length > 1) {
            const tailGroups = parts
                .slice(1)
                .map(part => part.replace(/\D/g, ''))
                .filter(Boolean);
            const hasValidThousandsGrouping =
                tailGroups.length > 0 &&
                tailGroups.every(part => part.length === 3);

            if (!hasValidThousandsGrouping) {
                throw new Error(`${label} harus berupa angka bulat`);
            }
        }
    }

    const normalized = normalizeNumber(value, { allowDecimal: false, maxFractionDigits: 0 });
    if (!Number.isFinite(normalized) || normalized < 0) {
        throw new Error(`${label} tidak valid`);
    }

    return normalized;
}

function normalizeTirePositionKey(posisi: string) {
    return posisi.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeServiceCode(value: unknown) {
    return normalizeText(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function generateVehicleUnitCode(categoryCode: string, excludeId?: string) {
    const rows = (await listDocumentsByFilter<Array<{ _id: string; unitCode?: string }>[number]>('vehicle', {}))
        .filter(row => row._id !== excludeId && typeof row.unitCode === 'string' && row.unitCode.trim().length > 0);

    const prefix = `${categoryCode}-`;
    const highestNumber = rows.reduce((max, row) => {
        const code = normalizeText(row.unitCode).toUpperCase();
        if (!code.startsWith(prefix)) {
            return max;
        }
        const match = code.slice(prefix.length).match(/^(\d{1,6})$/);
        if (!match) {
            return max;
        }
        return Math.max(max, Number(match[1]));
    }, 0);

    return `${prefix}${String(highestNumber + 1).padStart(3, '0')}`;
}

async function findDuplicateLowerTextDoc(docType: string, fieldName: string, value: string, excludeId?: string) {
    if (!value) return null;
    const normalizedValue = value.toLowerCase();
    const exactMatches = await listDocumentsByFilter<Array<{ _id: string; [key: string]: unknown }>[number]>(docType, {
        [fieldName]: value,
    });
    const exactDuplicate = exactMatches.find(row => {
        if (excludeId && row._id === excludeId) {
            return false;
        }
        const fieldValue = row[fieldName];
        return typeof fieldValue === 'string' && fieldValue.toLowerCase() === normalizedValue;
    }) || null;
    if (exactDuplicate) {
        return exactDuplicate;
    }

    const rows = await listDocumentsByFilter<Array<{ _id: string; [key: string]: unknown }>[number]>(docType, {});
    return rows.find(row => {
        if (excludeId && row._id === excludeId) {
            return false;
        }
        const fieldValue = row[fieldName];
        return typeof fieldValue === 'string' && fieldValue.toLowerCase() === normalizedValue;
    }) || null;
}

export async function normalizeServicePayload(
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'code')) {
        const code = normalizeServiceCode(data.code);
        if (!code) {
            throw new Error('Kode kategori armada wajib diisi');
        }
        if (!SERVICE_CODE_RE.test(code)) {
            throw new Error('Kode kategori armada hanya boleh berisi huruf/angka singkat, misalnya CDD atau FUSO');
        }
        const duplicate = await findDuplicateLowerTextDoc('service', 'code', code, options?.excludeId);
        if (duplicate) {
            throw new Error('Kode kategori armada sudah digunakan');
        }
        if (options?.excludeId) {
            const currentService = await getDocumentById<{ _id: string; code?: string; name?: string }>(options.excludeId, 'service');
            if (currentService?.code && currentService.code !== code) {
                const relatedVehicleByRef =
                    (await listDocumentsByFilter<{ _id: string; serviceRef?: string; serviceName?: string }>('vehicle', {
                        serviceRef: options.excludeId,
                    }))[0] || null;
                const relatedVehicleByLegacyName =
                    !relatedVehicleByRef && currentService.name
                        ? (await listDocumentsByFilter<{ _id: string; serviceRef?: string; serviceName?: string }>('vehicle', {
                            serviceName: currentService.name,
                        })).find(vehicle => !vehicle.serviceRef) || null
                        : null;
                const relatedVehicle = relatedVehicleByRef || relatedVehicleByLegacyName;
                if (relatedVehicle) {
                    throw new Error('Kode kategori armada yang sudah dipakai kendaraan tidak boleh diubah');
                }
            }
        }
        next.code = code;
    }

    if (!partial || hasOwnKey(data, 'name')) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama kategori truk/armada wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('service', 'name', name, options?.excludeId);
        if (duplicate) {
            throw new Error('Nama kategori truk/armada sudah digunakan');
        }
        next.name = name;
    }

    if (!partial || hasOwnKey(data, 'description')) {
        next.description = normalizeText(data.description);
    }

    if (!partial || hasOwnKey(data, 'maxPayloadKg')) {
        const maxPayloadKg = normalizeOptionalNonNegativeNumber(data.maxPayloadKg, 'Batas muatan normal');
        next.maxPayloadKg = maxPayloadKg ?? 0;
    }

    if (!partial || hasOwnKey(data, 'oilMaintenanceKm')) {
        const oilMaintenanceKm = normalizeOptionalNonNegativeNumber(data.oilMaintenanceKm, 'Interval servis oli');
        next.oilMaintenanceKm = oilMaintenanceKm ?? 0;
    }

    if (!partial || hasOwnKey(data, 'tireLayoutConfig')) {
        next.tireLayoutConfig = normalizeTireLayoutConfig(
            (data.tireLayoutConfig as Record<string, unknown> | undefined) || undefined
        );
    }

    if (!partial || hasOwnKey(data, 'active')) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status kategori truk/armada tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeExpenseCategoryPayload(
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'name')) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama kategori biaya wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('expenseCategory', 'name', name, options?.excludeId);
        if (duplicate) {
            throw new Error('Nama kategori biaya sudah digunakan');
        }
        next.name = name;
    }

    if (!partial || hasOwnKey(data, 'active')) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status kategori biaya tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    if (!partial || hasOwnKey(data, 'scope')) {
        const rawScope = normalizeOptionalText(data.scope);
        const scope = rawScope || 'GENERAL';
        if (!isExpenseCategoryScope(scope)) {
            throw new Error('Jenis kategori biaya tidak valid');
        }
        next.scope = scope;
    }

    if (!partial || hasOwnKey(data, 'allowManual')) {
        if (data.allowManual !== undefined && typeof data.allowManual !== 'boolean') {
            throw new Error('Akses input manual kategori biaya tidak valid');
        }
        const scope = isExpenseCategoryScope(next.scope)
            ? next.scope
            : isExpenseCategoryScope(data.scope)
                ? data.scope
                : 'GENERAL';
        next.allowManual = typeof data.allowManual === 'boolean'
            ? data.allowManual
            : scope === 'GENERAL';
    }

    if (!partial || hasOwnKey(data, 'sortOrder')) {
        if (data.sortOrder !== undefined && data.sortOrder !== null && data.sortOrder !== '') {
            const sortOrder = normalizeNumber(data.sortOrder, { maxFractionDigits: 0 });
            if (!Number.isFinite(sortOrder) || sortOrder < 0) {
                throw new Error('Urutan kategori biaya tidak valid');
            }
            next.sortOrder = sortOrder;
        }
    }

    if (next.scope || next.name || !partial || hasOwnKey(data, 'accountSystemKey')) {
        const accountSystemKey = normalizeOptionalText(data.accountSystemKey);
        next.accountSystemKey = accountSystemKey || resolveExpenseCategoryAccountKey({
            name: String(next.name || data.name || ''),
            scope: isExpenseCategoryScope(next.scope) ? next.scope : undefined,
            accountSystemKey,
        });
    }

    return next;
}

export async function normalizeIncidentSettlementLinePayload(
    data: Record<string, unknown>,
    options?: { partial?: boolean }
) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'lineType')) {
        const lineType = typeof data.lineType === 'string' && INCIDENT_SETTLEMENT_LINE_TYPES.has(data.lineType)
            ? data.lineType
            : '';
        if (!lineType) {
            throw new Error('Tipe detail insiden tidak valid');
        }
        next.lineType = lineType;
    }

    if (!partial || hasOwnKey(data, 'category')) {
        const normalizedCategory = typeof data.category === 'string' && data.category.trim().toUpperCase() === 'POLICE_ADMIN'
            ? 'ADMINISTRATION'
            : data.category;
        const category = typeof normalizedCategory === 'string' && INCIDENT_SETTLEMENT_CATEGORIES.has(normalizedCategory)
            ? normalizedCategory
            : '';
        if (!category) {
            throw new Error('Kategori detail insiden tidak valid');
        }
        next.category = category;
    }

    if (!partial || hasOwnKey(data, 'date')) {
        const date = normalizeText(data.date) || getBusinessDateValue();
        assertIsoDate(date, 'Tanggal detail insiden');
        next.date = date;
    }

    if (!partial || hasOwnKey(data, 'amount')) {
        const amount = normalizeCurrencyNumber(data.amount, { maxFractionDigits: 0 });
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Nominal detail insiden tidak valid');
        }
        next.amount = amount;
    }

    if (!partial || hasOwnKey(data, 'description')) {
        const description = normalizeText(data.description);
        if (!description) {
            throw new Error('Deskripsi detail insiden wajib diisi');
        }
        next.description = description;
    }

    if (!partial || hasOwnKey(data, 'payeeName')) {
        next.payeeName = normalizeOptionalText(data.payeeName);
    }

    if (!partial || hasOwnKey(data, 'recipientType')) {
        const recipientType = normalizeOptionalText(data.recipientType)?.toUpperCase();
        if (recipientType && !INCIDENT_SETTLEMENT_RECIPIENT_TYPES.has(recipientType)) {
            throw new Error('Pihak penerima / sumber tidak valid');
        }
        next.recipientType = recipientType;
    }

    if (!partial || hasOwnKey(data, 'note')) {
        next.note = normalizeOptionalText(data.note);
    }

    if (!partial || hasOwnKey(data, 'status')) {
        const status = typeof data.status === 'string' && INCIDENT_SETTLEMENT_LINE_STATUSES.has(data.status)
            ? data.status
            : undefined;
        if (!partial && !status) {
            next.status = 'DRAFT';
        } else if (status) {
            next.status = status;
        }
    }

    return next;
}

export async function normalizeDriverPayload(
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'name')) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama supir wajib diisi');
        }
        next.name = name;
    }

    if (!partial || hasOwnKey(data, 'phone')) {
        const phone = normalizeText(data.phone);
        if (!phone) {
            throw new Error('No. HP supir wajib diisi');
        }
        next.phone = phone;
    }

    if (!partial || hasOwnKey(data, 'licenseNumber')) {
        const licenseNumber = normalizeText(data.licenseNumber).toUpperCase();
        if (licenseNumber) {
            const duplicate = await findDuplicateLowerTextDoc('driver', 'licenseNumber', licenseNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. SIM sudah digunakan supir lain');
            }
        }
        next.licenseNumber = licenseNumber;
    }

    if (!partial || hasOwnKey(data, 'ktpNumber')) {
        const ktpNumber = normalizeOptionalText(data.ktpNumber)?.toUpperCase();
        if (ktpNumber) {
            const duplicate = await findDuplicateLowerTextDoc('driver', 'ktpNumber', ktpNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. KTP sudah digunakan supir lain');
            }
        }
        next.ktpNumber = ktpNumber;
    }

    if (!partial || hasOwnKey(data, 'simExpiry')) {
        const simExpiry = normalizeOptionalText(data.simExpiry);
        if (simExpiry) {
            assertIsoDate(simExpiry, 'Tanggal masa berlaku SIM');
        }
        next.simExpiry = simExpiry;
    }

    if (!partial || hasOwnKey(data, 'address')) {
        // Use normalizeText instead of normalizeOptionalText to allow explicit clearing.
        // normalizeOptionalText("") returns undefined, which skips the field in PATCH.
        // We need to allow clearing: address: "" should become null in the database.
        const address = normalizeText(data.address);
        next.address = address || null;
    }

    if (!partial || hasOwnKey(data, 'active')) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status supir tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeVehiclePayload(
    session: ApiSession,
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};
    const existingVehicle = options?.excludeId
        ? await getDocumentById<{
            _id: string;
            lastOdometer?: number;
            serviceRef?: string;
            unitCode?: string;
            vehicleType?: string;
            capacityMin?: string;
            capacityMax?: string;
            ownershipType?: string;
            partnerOwnerName?: string;
            partnerOwnerPhone?: string;
            partnerNotes?: string;
        }>(options.excludeId, 'vehicle')
        : null;

    if (options?.excludeId && !existingVehicle) {
        throw new Error('Kendaraan tidak ditemukan');
    }

    if (!partial || hasOwnKey(data, 'plateNumber')) {
        const plateNumber = normalizeText(data.plateNumber).toUpperCase().replace(/\s+/g, ' ');
        if (!plateNumber) {
            throw new Error('Plat nomor kendaraan wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('vehicle', 'plateNumber', plateNumber, options?.excludeId);
        if (duplicate) {
            throw new Error('Plat nomor kendaraan sudah digunakan');
        }
        next.plateNumber = plateNumber;
    }

    if (!partial || hasOwnKey(data, 'vehicleType')) {
        const vehicleType = normalizeText(data.vehicleType);
        if (!vehicleType) {
            throw new Error('Tipe kendaraan wajib diisi');
        }
        next.vehicleType = vehicleType;
    }

    if (!partial || hasOwnKey(data, 'brandModel')) {
        const brandModel = normalizeText(data.brandModel);
        if (!brandModel) {
            throw new Error('Merk/model kendaraan wajib diisi');
        }
        next.brandModel = brandModel;
    }

    if (!partial || hasOwnKey(data, 'size')) {
        next.size = normalizeOptionalText(data.size);
    }

    if (!partial || hasOwnKey(data, 'dimension')) {
        next.dimension = normalizeOptionalText(data.dimension);
    }

    if (!partial || hasOwnKey(data, 'capacityMin')) {
        next.capacityMin = normalizeOptionalText(data.capacityMin);
    }

    if (!partial || hasOwnKey(data, 'capacityMax')) {
        next.capacityMax = normalizeOptionalText(data.capacityMax);
    }

    const resolvedCapacityMin = normalizeOptionalText(
        String(next.capacityMin ?? existingVehicle?.capacityMin ?? '')
    );
    const resolvedCapacityMax = normalizeOptionalText(
        String(next.capacityMax ?? existingVehicle?.capacityMax ?? '')
    );
    const parsedCapacityMin = parseCapacityRangeValue(resolvedCapacityMin);
    const parsedCapacityMax = parseCapacityRangeValue(resolvedCapacityMax);
    if (parsedCapacityMin !== undefined && parsedCapacityMax !== undefined && parsedCapacityMax < parsedCapacityMin) {
        throw new Error('Kapasitas maks tidak boleh lebih kecil dari kapasitas min');
    }

    if (!partial || hasOwnKey(data, 'year')) {
        const year = normalizeNumber(data.year);
        const maxYear = getCurrentBusinessYear() + 1;
        if (!Number.isInteger(year) || year < 1900 || year > maxYear) {
            throw new Error('Tahun kendaraan tidak valid');
        }
        next.year = year;
    }

    if (!partial || hasOwnKey(data, 'capacityKg')) {
        const capacityKg = normalizeOptionalNonNegativeNumber(data.capacityKg, 'Kapasitas kg');
        next.capacityKg = capacityKg ?? 0;
    }

    if (!partial || hasOwnKey(data, 'capacityVolume')) {
        const capacityVolume = normalizeOptionalNonNegativeNumber(data.capacityVolume, 'Kapasitas volume');
        next.capacityVolume = capacityVolume ?? 0;
    }

    let resolvedServiceCode = '';
    if (!partial || hasOwnKey(data, 'serviceRef') || hasOwnKey(data, 'unitCode')) {
        const serviceRef = !partial || hasOwnKey(data, 'serviceRef')
            ? normalizeOptionalText(data.serviceRef)
            : normalizeOptionalText(existingVehicle?.serviceRef);
        if (!serviceRef) {
            throw new Error('Kategori armada kendaraan wajib dipilih');
        }
        const service = await getDocumentById<{ _id: string; name?: string; code?: string; active?: boolean; tireLayoutConfig?: Record<string, unknown>; oilMaintenanceKm?: number }>(
            serviceRef,
            'service'
        );
        if (!service) {
            throw new Error('Kategori armada tidak ditemukan');
        }
        if (service.active === false) {
            throw new Error('Kategori armada tidak aktif');
        }
        const serviceCode = normalizeServiceCode(service.code);
        if (!serviceCode) {
            throw new Error('Kategori armada belum punya kode yang valid');
        }
        resolvedServiceCode = serviceCode;
        const resolvedVehicleType = normalizeText(String(next.vehicleType ?? existingVehicle?.vehicleType ?? ''));
        next.tireLayoutConfig = normalizeTireLayoutConfig(
            service.tireLayoutConfig,
            buildDefaultTireLayoutConfig(resolvedVehicleType, service.name || '')
        );
        if (!partial || hasOwnKey(data, 'serviceRef')) {
            next.serviceRef = serviceRef;
            next.serviceName = service.name || '';
            next.oilMaintenanceIntervalKm = typeof service.oilMaintenanceKm === 'number' ? service.oilMaintenanceKm : 0;
        }
    }

    if (!partial || hasOwnKey(data, 'unitCode') || hasOwnKey(data, 'serviceRef')) {
        const providedUnitCode = normalizeText(data.unitCode).toUpperCase().replace(/\s+/g, '-');
        let unitCode = providedUnitCode;
        if (!unitCode) {
            if (!resolvedServiceCode) {
                throw new Error('Kategori armada kendaraan wajib dipilih sebelum kode unit dibuat');
            }
            unitCode = await generateVehicleUnitCode(resolvedServiceCode, options?.excludeId);
        }
        if (resolvedServiceCode && !unitCode.startsWith(`${resolvedServiceCode}-`)) {
            throw new Error(`Kode unit harus diawali ${resolvedServiceCode}- sesuai kategori armada`);
        }
        const duplicate = await findDuplicateLowerTextDoc('vehicle', 'unitCode', unitCode, options?.excludeId);
        if (duplicate) {
            throw new Error('Kode unit kendaraan sudah digunakan');
        }
        next.unitCode = unitCode;
    }

    if (!partial || hasOwnKey(data, 'status')) {
        const rawStatus = normalizeText(data.status);
        const status = rawStatus || 'ACTIVE';
        if (hasOwnKey(data, 'status') && !rawStatus) {
            throw new Error('Status kendaraan tidak valid');
        }
        if (!VEHICLE_STATUS_VALUES.has(status)) {
            throw new Error('Status kendaraan tidak valid');
        }
        next.status = status;
    }

    if (!partial || hasOwnKey(data, 'base')) {
        next.base = normalizeOptionalText(data.base);
    }

    if (!partial || hasOwnKey(data, 'registeredDate')) {
        const registeredDate = normalizeOptionalText(data.registeredDate) || getBusinessDateValue();
        assertIsoDate(registeredDate, 'Tanggal masuk unit');
        next.registeredDate = registeredDate;
    }

    if (!partial || hasOwnKey(data, 'ownershipType')) {
        const ownershipType = normalizeText(data.ownershipType) || 'COMPANY';
        if (!VEHICLE_OWNERSHIP_TYPES.has(ownershipType)) {
            throw new Error('Kepemilikan kendaraan tidak valid');
        }
        next.ownershipType = ownershipType;
    }

    const resolvedOwnershipType = normalizeText(String(next.ownershipType ?? existingVehicle?.ownershipType ?? 'COMPANY'));
    if (
        !partial ||
        hasOwnKey(data, 'ownershipType') ||
        hasOwnKey(data, 'partnerOwnerName') ||
        hasOwnKey(data, 'partnerOwnerPhone') ||
        hasOwnKey(data, 'partnerNotes')
    ) {
        const partnerOwnerName = normalizeOptionalText(data.partnerOwnerName ?? existingVehicle?.partnerOwnerName);
        if (resolvedOwnershipType === 'PARTNER' && !partnerOwnerName) {
            throw new Error('Nama pemilik mitra wajib diisi');
        }
        next.partnerOwnerName = resolvedOwnershipType === 'PARTNER' ? partnerOwnerName : '';
        next.partnerOwnerPhone = resolvedOwnershipType === 'PARTNER' ? normalizeOptionalText(data.partnerOwnerPhone ?? existingVehicle?.partnerOwnerPhone) : '';
        next.partnerNotes = resolvedOwnershipType === 'PARTNER' ? normalizeOptionalText(data.partnerNotes ?? existingVehicle?.partnerNotes) : '';
    }

    if (!partial || hasOwnKey(data, 'notes')) {
        next.notes = normalizeOptionalText(data.notes);
    }

    if (!partial || hasOwnKey(data, 'lastOdometer')) {
        const lastOdometer = normalizeOptionalWholeNumber(data.lastOdometer, 'Odometer kendaraan') ?? 0;
        if (
            existingVehicle &&
            typeof existingVehicle.lastOdometer === 'number' &&
            lastOdometer < existingVehicle.lastOdometer
        ) {
            throw new Error('Odometer kendaraan tidak boleh mundur dari catatan terakhir');
        }
        next.lastOdometer = lastOdometer;
        if (lastOdometer > 0 && !hasOwnKey(data, 'lastOdometerAt')) {
            next.lastOdometerAt = getBusinessDateValue();
        }
    }

    if (!partial || hasOwnKey(data, 'lastOdometerAt')) {
        const lastOdometerAt = normalizeOptionalText(data.lastOdometerAt);
        if (lastOdometerAt) {
            assertIsoDate(lastOdometerAt, 'Tanggal update odometer');
        }
        next.lastOdometerAt = lastOdometerAt;
    }

    if (!partial || hasOwnKey(data, 'oilLastServiceOdometer')) {
        const value = normalizeOptionalWholeNumber(data.oilLastServiceOdometer, 'Odometer servis oli terakhir') ?? 0;
        next.oilLastServiceOdometer = value;
    }

    if (!partial || hasOwnKey(data, 'oilNextServiceOdometer')) {
        const value = normalizeOptionalWholeNumber(data.oilNextServiceOdometer, 'Odometer servis oli berikutnya') ?? 0;
        next.oilNextServiceOdometer = value;
    }

    if (!partial || hasOwnKey(data, 'oilServiceRemainingKm')) {
        const value = normalizeOptionalWholeNumber(data.oilServiceRemainingKm, 'Sisa km servis oli') ?? 0;
        next.oilServiceRemainingKm = value;
    }

    if (!partial || hasOwnKey(data, 'chassisNumber')) {
        const chassisNumber = normalizeOptionalText(data.chassisNumber)?.toUpperCase();
        if (chassisNumber) {
            const duplicate = await findDuplicateLowerTextDoc('vehicle', 'chassisNumber', chassisNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. rangka kendaraan sudah digunakan');
            }
        }
        next.chassisNumber = chassisNumber;
    }

    if (!partial || hasOwnKey(data, 'engineNumber')) {
        const engineNumber = normalizeOptionalText(data.engineNumber)?.toUpperCase();
        if (engineNumber) {
            const duplicate = await findDuplicateLowerTextDoc('vehicle', 'engineNumber', engineNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. mesin kendaraan sudah digunakan');
            }
        }
        next.engineNumber = engineNumber;
    }

    return next;
}

export async function normalizeMaintenanceCreatePayload(data: Record<string, unknown>): Promise<MaintenanceCreatePayload> {
    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    const type = typeof data.type === 'string' ? data.type.trim() : '';
    if (!vehicleRef || !type) {
        throw new Error('Kendaraan dan tipe maintenance wajib diisi');
    }

    const rawScheduleType = normalizeText(data.scheduleType).toUpperCase();
    if (rawScheduleType !== 'DATE' && rawScheduleType !== 'ODOMETER') {
        throw new Error('Tipe jadwal maintenance tidak valid');
    }
    const scheduleType = rawScheduleType as 'DATE' | 'ODOMETER';
    const notes = typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : undefined;
    const vehicle = await getDocumentById<{ _id: string; plateNumber?: string; status?: string }>(vehicleRef, 'vehicle');
    if (!vehicle) {
        throw new Error('Kendaraan maintenance tidak ditemukan');
    }
    if (vehicle.status === 'SOLD') {
        throw new Error('Kendaraan yang sudah dijual tidak bisa dijadwalkan maintenance');
    }
    const vehiclePlate = vehicle.plateNumber;

    if (scheduleType === 'DATE') {
        const plannedDate = typeof data.plannedDate === 'string' ? data.plannedDate : '';
        if (!plannedDate) {
            throw new Error('Tanggal maintenance wajib diisi');
        }
        assertIsoDate(plannedDate, 'Tanggal maintenance');

        return {
            vehicleRef,
            vehiclePlate,
            type,
            scheduleType,
            plannedDate,
            notes,
            attachmentUrls: [],
            materialUsages: [],
        };
    }

    const plannedOdometer = normalizeOptionalWholeNumber(data.plannedOdometer, 'Odometer maintenance');
    if (plannedOdometer === undefined || !Number.isFinite(plannedOdometer) || plannedOdometer <= 0) {
        throw new Error('Odometer maintenance wajib lebih besar dari 0');
    }

    return {
        vehicleRef,
        vehiclePlate,
        type,
        scheduleType,
        plannedOdometer,
        notes,
        attachmentUrls: [],
        materialUsages: [],
    };
}

export async function normalizeTireEventPayload(
    data: Record<string, unknown>,
    excludeId = ''
): Promise<NormalizedTireEventPayload> {
    const tireCode = normalizeText(data.tireCode).toUpperCase().replace(/\s+/g, '-');
    const holderType =
        typeof data.holderType === 'string' && TIRE_HOLDER_TYPES.has(data.holderType)
            ? data.holderType as NormalizedTireEventPayload['holderType']
            : undefined;
    const rawStatus = normalizeText(data.status).toUpperCase();
    const status = TIRE_EVENT_STATUSES.has(rawStatus)
        ? rawStatus as NormalizedTireEventPayload['status']
        : undefined;
    const vehicleRef = normalizeOptionalText(data.vehicleRef);
    const slotCode = normalizeOptionalText(data.slotCode) ? normalizeTireSlotCode(String(data.slotCode)) : '';
    const slotLabel = slotCode ? formatTireSlotLabel(slotCode) : '';
    const tireBrand = normalizeText(data.tireBrand);
    const tireSize = normalizeText(data.tireSize);
    const installDate = normalizeText(data.installDate);
    const replaceDate = normalizeOptionalText(data.replaceDate);
    const parsedPurchaseCost = normalizeCurrencyNumber(data.purchaseCost ?? data.originalCost ?? 0, { maxFractionDigits: 0 });
    const parsedOriginalCost = normalizeCurrencyNumber(data.originalCost ?? data.purchaseCost ?? 0, { maxFractionDigits: 0 });
    const purchaseCost = Number.isFinite(parsedPurchaseCost) ? Math.max(parsedPurchaseCost, 0) : 0;
    const originalCost = Number.isFinite(parsedOriginalCost) ? Math.max(parsedOriginalCost, 0) : purchaseCost;
    const parsedTotalUsedPercent = normalizeNumber(data.totalUsedPercent ?? 0, { maxFractionDigits: 2 });
    const totalUsedPercent = Math.max(0, Math.min(Number.isFinite(parsedTotalUsedPercent) ? parsedTotalUsedPercent : 0, 100));
    const remainingPercent = Math.max(100 - totalUsedPercent, 0);
    const remainingValue = Math.round(originalCost * remainingPercent) / 100;
    const parsedPostedPercent = normalizeNumber(data.maintenanceCostPostedPercent ?? 0, { maxFractionDigits: 2 });
    const maintenanceCostPostedPercent = Math.max(0, Math.min(Number.isFinite(parsedPostedPercent) ? parsedPostedPercent : 0, 100));
    const parsedPostedAmount = normalizeCurrencyNumber(data.maintenanceCostPostedAmount ?? 0, { maxFractionDigits: 0 });
    const maintenanceCostPostedAmount = Number.isFinite(parsedPostedAmount) ? Math.max(parsedPostedAmount, 0) : 0;
    const lastMaintenanceCostRef = normalizeOptionalText(data.lastMaintenanceCostRef);
    const parsedAccumulatedKm = normalizeNumber(data.accumulatedKm, { maxFractionDigits: 0 });
    const accumulatedKm = Number.isFinite(parsedAccumulatedKm) ? Math.max(parsedAccumulatedKm, 0) : 0;
    const notes = normalizeOptionalText(data.notes);
    const externalPartyName = normalizeOptionalText(data.externalPartyName);
    const externalPlateNumber = normalizeOptionalText(data.externalPlateNumber)?.toUpperCase();
    const tireType = normalizeOptionalTireType(data.tireType);

    if (!tireCode || !tireBrand || !tireSize || !installDate) {
        throw new Error('Kode ban, merk, ukuran, dan tanggal pencatatan wajib diisi');
    }
    if (!holderType) {
        throw new Error('Lokasi/holder ban tidak valid');
    }
    if (!status) {
        throw new Error('Status ban tidak valid');
    }
    if (!tireType) {
        throw new Error('Jenis ban tidak valid');
    }

    assertIsoDate(installDate, 'Tanggal pencatatan ban');
    if (replaceDate) {
        assertIsoDate(replaceDate, 'Tanggal penggantian ban');
    }
    if (replaceDate && replaceDate < installDate) {
        throw new Error('Tanggal penggantian ban tidak boleh sebelum tanggal pasang');
    }

    const duplicateTireCode = await findDuplicateLowerTextDoc('tireEvent', 'tireCode', tireCode, excludeId);
    if (duplicateTireCode) {
        throw new Error('Kode ban sudah digunakan');
    }

    let normalizedVehiclePlate: string | undefined;
    let existingTireEvent: { vehicleRef?: string; vehiclePlate?: string } | null = null;
    if (excludeId) {
        existingTireEvent = await getDocumentById<{ vehicleRef?: string; vehiclePlate?: string }>(excludeId, 'tireEvent');
    }

    if (holderType === 'INTERNAL_VEHICLE') {
        if (status !== 'IN_USE') {
            throw new Error('Ban internal hanya boleh berstatus terpasang');
        }
        if (!vehicleRef) {
            throw new Error('Kendaraan wajib dipilih untuk ban internal');
        }
        if (!slotCode) {
            throw new Error('Slot/kode posisi ban wajib diisi');
        }
        if (!isKnownInternalTireSlotCode(slotCode)) {
            throw new Error('Kode slot ban tidak valid');
        }
        const vehicle = await getDocumentById<{ _id: string; plateNumber?: string; status?: string }>(vehicleRef, 'vehicle');
        if (!vehicle) {
            throw new Error('Kendaraan ban tidak ditemukan');
        }
        const canUseSoldVehicle = existingTireEvent?.vehicleRef === vehicleRef;
        if (vehicle.status === 'SOLD' && !canUseSoldVehicle) {
            throw new Error('Kendaraan yang sudah dijual tidak bisa dicatat pada manajemen ban');
        }
        normalizedVehiclePlate = vehicle.plateNumber;

        const activeTires = await listDocumentsByFilter<Array<{
            _id: string;
            slotCode?: string;
            holderType?: string;
            status?: string;
            vehicleRef?: string;
        }>[number]>('tireEvent', {
            vehicleRef,
            holderType: 'INTERNAL_VEHICLE',
            status: 'IN_USE',
        });
        const activeDuplicate = activeTires.find(item => item._id !== excludeId && normalizeTireSlotCode(item.slotCode || '') === slotCode);
        if (activeDuplicate) {
            throw new Error('Slot ban ini masih dipakai ban lain pada kendaraan yang sama');
        }
    } else if (holderType === 'EXTERNAL_VEHICLE') {
        if (status !== 'LOANED_OUT') {
            throw new Error('Ban pinjam keluar wajib berstatus dipinjam keluar');
        }
        if (!externalPartyName && !externalPlateNumber) {
            throw new Error('Nama pihak luar atau plat luar wajib diisi untuk ban pinjam keluar');
        }
    } else {
        if (status !== 'IN_WAREHOUSE' && status !== 'SCRAPPED') {
            throw new Error('Ban di gudang hanya boleh berstatus gudang atau afkir');
        }
    }

    const posisi = buildTirePlacementLabel({
        holderType,
        status,
        vehiclePlate: normalizedVehiclePlate,
        slotCode,
        externalPartyName,
        externalPlateNumber,
    });
    const positionKey = normalizeTirePositionKey(slotCode || posisi);

    return {
        tireCode,
        holderType,
        status,
        vehicleRef: holderType === 'INTERNAL_VEHICLE' ? vehicleRef || undefined : undefined,
        vehiclePlate: holderType === 'INTERNAL_VEHICLE' ? normalizedVehiclePlate : undefined,
        posisi,
        positionKey,
        slotCode: holderType === 'INTERNAL_VEHICLE' ? slotCode || undefined : undefined,
        slotLabel: holderType === 'INTERNAL_VEHICLE' ? slotLabel || undefined : undefined,
        externalPartyName: holderType === 'EXTERNAL_VEHICLE' ? externalPartyName : undefined,
        externalPlateNumber: holderType === 'EXTERNAL_VEHICLE' ? externalPlateNumber : undefined,
        tireType,
        tireBrand,
        tireSize,
        installDate,
        replaceDate,
        purchaseCost,
        originalCost,
        totalUsedPercent,
        remainingPercent,
        remainingValue,
        maintenanceCostPostedPercent,
        maintenanceCostPostedAmount,
        lastMaintenanceCostRef,
        accumulatedKm,
        notes,
    };
}
