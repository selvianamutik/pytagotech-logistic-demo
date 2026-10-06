import {
    getSupabaseClient,
} from '@/lib/supabase';
import { getBusinessDateValue, parseBusinessDateValue } from '@/lib/business-date';
import {
    clearRelationalReadCache,
    relationalDeleteDocument,
    relationalFindDocumentByIdAcrossTypes,
    relationalGetAll,
    relationalGetByFilter,
    relationalGetFieldsByFilter,
    relationalGetById,
    relationalList,
    relationalMaxNumericSuffixByPrefix,
    relationalPatchDocument,
    relationalUpsertDocument,
    supportsRelationalDocType,
} from '@/lib/supabase-relational';
import { clearApiReadCaches } from '@/lib/api/read-cache';

type CompanyProfileNumberingRow = {
    source_document_id: string;
    numbering_settings?: Record<string, unknown> | null;
    synced_at?: string | null;
};

const NUMBERING_CONFIG = {
    resi: { prefixField: 'resiPrefix', counterField: 'resiCounter', periodField: 'resiPeriod', defaultPrefix: 'R-', docType: 'order', docField: 'masterResi' },
    do: { prefixField: 'doPrefix', counterField: 'doCounter', periodField: 'doPeriod', defaultPrefix: 'DO-', docType: 'deliveryOrder', docField: 'doNumber' },
    invoice: { prefixField: 'invoicePrefix', counterField: 'invoiceCounter', periodField: 'invoicePeriod', defaultPrefix: 'INV-', docType: 'invoice', docField: 'invoiceNumber' },
    nota: { prefixField: 'notaPrefix', counterField: 'notaCounter', periodField: 'notaPeriod', defaultPrefix: 'INV-', docType: 'freightNota', docField: 'notaNumber' },
    receipt: { prefixField: 'receiptPrefix', counterField: 'receiptCounter', periodField: 'receiptPeriod', defaultPrefix: 'RCV-', docType: 'customerReceipt', docField: 'receiptNumber' },
    borong: { prefixField: 'boronganPrefix', counterField: 'boronganCounter', periodField: 'boronganPeriod', defaultPrefix: 'BRG-', docType: 'driverBorongan', docField: 'boronganNumber' },
    bon: { prefixField: 'bonPrefix', counterField: 'bonCounter', periodField: 'bonPeriod', defaultPrefix: 'BON-', docType: 'driverVoucher', docField: 'bonNumber' },
    incident: { prefixField: 'incidentPrefix', counterField: 'incidentCounter', periodField: 'incidentPeriod', defaultPrefix: 'INC-', docType: 'incident', docField: 'incidentNumber' },
} as const;

const DOCUMENT_TYPE_HINT_LIMIT = 10000;
const documentTypeHints = new Map<string, string>();

type DocumentMutationOptions = {
    skipApiReadCacheClear?: boolean;
    skipRelationalReadCacheClear?: boolean;
};

function clearApiReadCachesUnlessSkipped(options?: DocumentMutationOptions) {
    if (!options?.skipApiReadCacheClear) {
        clearApiReadCaches();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rememberDocumentType(value: unknown) {
    if (!isRecord(value)) return;
    const id = typeof value._id === 'string' ? value._id : '';
    const type = typeof value._type === 'string' ? value._type : '';
    if (!id || !type || !supportsRelationalDocType(type)) return;

    if (!documentTypeHints.has(id) && documentTypeHints.size >= DOCUMENT_TYPE_HINT_LIMIT) {
        const oldestKey = documentTypeHints.keys().next().value;
        if (oldestKey) documentTypeHints.delete(oldestKey);
    }
    documentTypeHints.set(id, type);
}

function rememberDocumentTypes(values: unknown[]) {
    for (const value of values) {
        rememberDocumentType(value);
    }
}

function forgetDocumentType(id: string) {
    documentTypeHints.delete(id);
}

function normalizePrefix(prefix: unknown, fallback: string) {
    const value = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : fallback;
    return value.endsWith('-') ? value : `${value}-`;
}

function numberFromUnknown(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildNumberingPeriod(key: keyof typeof NUMBERING_CONFIG, dateValue?: string) {
    const parts =
        (typeof dateValue === 'string' ? parseBusinessDateValue(dateValue) : null)
        || parseBusinessDateValue(getBusinessDateValue());

    if (!parts) {
        return key === 'do' ? '01012000' : '200001';
    }

    if (key === 'do') {
        return `${parts.day}${parts.month}${parts.year}`;
    }

    return `${parts.year}${parts.month}`;
}

async function getRelationalCompanyProfileRow() {
    const response = await getSupabaseClient().fetch('company_profiles?select=source_document_id,numbering_settings,synced_at&limit=1');
    const rows = await response.json() as CompanyProfileNumberingRow[];
    return rows[0] || null;
}

async function getRelationalNextNumber(prefix: string, dateValue?: string) {
    const config = NUMBERING_CONFIG[prefix as keyof typeof NUMBERING_CONFIG];
    if (!config) {
        return `${prefix}-${Date.now()}`;
    }

    const numberingKey = prefix as keyof typeof NUMBERING_CONFIG;
    const period = buildNumberingPeriod(numberingKey, dateValue);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const company = await getRelationalCompanyProfileRow();
        if (!company?.source_document_id) {
            break;
        }

        const settings = isRecord(company.numbering_settings) ? company.numbering_settings : {};
        const normalizedPrefix = normalizePrefix(settings[config.prefixField], config.defaultPrefix);
        const currentPeriod =
            typeof settings[config.periodField] === 'string' ? settings[config.periodField] : '';
        const currentCounter = currentPeriod === period ? numberFromUnknown(settings[config.counterField]) : 0;

        const prefixWithPeriod = `${normalizedPrefix}${period}-`;
        const maxExistingSuffix =
            await relationalMaxNumericSuffixByPrefix(config.docType, config.docField, prefixWithPeriod)
            ?? 0;

        const nextCounter = Math.max(currentCounter, maxExistingSuffix) + 1;
        const nextNumber = `${normalizedPrefix}${period}-${String(nextCounter).padStart(4, '0')}`;
        const nextSyncedAt = new Date().toISOString();
        const syncedAtFilter = company.synced_at
            ? `eq.${encodeURIComponent(company.synced_at)}`
            : 'is.null';

        const response = await getSupabaseClient().fetch(
            `company_profiles?source_document_id=eq.${encodeURIComponent(company.source_document_id)}&synced_at=${syncedAtFilter}`,
            {
                method: 'PATCH',
                headers: {
                    Prefer: 'return=representation',
                },
                body: JSON.stringify({
                    numbering_settings: {
                        ...settings,
                        [config.prefixField]: normalizedPrefix,
                        [config.counterField]: nextCounter,
                        [config.periodField]: period,
                    },
                    synced_at: nextSyncedAt,
                }),
            }
        );
        const rows = await response.json() as CompanyProfileNumberingRow[];
        if (rows.length > 0) {
            clearRelationalReadCache();
            clearApiReadCaches();
            return nextNumber;
        }
    }

    return `${normalizePrefix(undefined, config.defaultPrefix)}${period}-${String(Date.now()).slice(-4)}`;
}

export async function getDocumentById<T = Record<string, unknown>>(id: string, docType?: string) {
    if (docType && supportsRelationalDocType(docType)) {
        const document = await relationalGetById<T>(docType, id);
        rememberDocumentType(document);
        return document;
    }

    const hintedDocType = documentTypeHints.get(id);
    if (hintedDocType && supportsRelationalDocType(hintedDocType)) {
        const hintedDocument = await relationalGetById<T>(hintedDocType, id);
        if (hintedDocument) {
            rememberDocumentType(hintedDocument);
            return hintedDocument;
        }
        forgetDocumentType(id);
    }

    const relationalDoc = await relationalFindDocumentByIdAcrossTypes<T>(id);
    if (relationalDoc) {
        rememberDocumentType(relationalDoc);
        return relationalDoc;
    }

    return null;
}

export async function listDocumentsByFilter<T = Record<string, unknown>>(
    docType: string,
    filterObj: Record<string, unknown>
) {
    if (supportsRelationalDocType(docType)) {
        const documents = await relationalGetByFilter<T>(docType, filterObj);
        rememberDocumentTypes(documents);
        return documents;
    }
    return [];
}

export async function listDocumentFieldsByFilter<T = Record<string, unknown>>(
    docType: string,
    fields: string[],
    filterObj: Record<string, unknown>
) {
    if (supportsRelationalDocType(docType)) {
        const documents = await relationalGetFieldsByFilter<T>(docType, fields, filterObj);
        rememberDocumentTypes(documents);
        return documents;
    }
    return [];
}

export async function getAllDocuments<T = Record<string, unknown>>(docType: string) {
    if (supportsRelationalDocType(docType)) {
        const documents = await relationalGetAll<T>(docType);
        rememberDocumentTypes(documents);
        return documents;
    }
    return [];
}

type DocumentListOptions = {
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

export async function listDocuments<T = Record<string, unknown>>(
    docType: string,
    options: DocumentListOptions = {}
) {
    if (supportsRelationalDocType(docType)) {
        const result = await relationalList<T>(docType, options);
        rememberDocumentTypes(result.items);
        return result;
    }
    return { items: [], total: 0 };
}

export async function createDocument<T = Record<string, unknown>>(
    doc: { _type: string; [key: string]: unknown },
    options?: DocumentMutationOptions,
) {
    if (supportsRelationalDocType(doc._type)) {
        const created = await relationalUpsertDocument<T>(doc, {
            skipReadCacheClear: options?.skipRelationalReadCacheClear,
        });
        if (!created) {
            throw new Error(`Failed to create relational document for type: ${doc._type}`);
        }
        rememberDocumentType(created);
        clearApiReadCachesUnlessSkipped(options);
        return created;
    }
    throw new Error(`Unsupported relational document type: ${doc._type}`);
}

export async function updateDocument<T = Record<string, unknown>>(
    id: string,
    updates: Record<string, unknown>,
    docType?: string,
    options?: DocumentMutationOptions,
) {
    if (docType && supportsRelationalDocType(docType)) {
        const updated = await relationalPatchDocument<T>(docType, id, updates, {
            skipReadCacheClear: options?.skipRelationalReadCacheClear,
        });
        if (!updated) {
            throw new Error(`Document not found: ${id}`);
        }
        rememberDocumentType(updated);
        clearApiReadCachesUnlessSkipped(options);
        return updated;
    }

    const hintedDocType = documentTypeHints.get(id);
    if (hintedDocType && supportsRelationalDocType(hintedDocType)) {
        const updated = await relationalPatchDocument<T>(hintedDocType, id, updates, {
            skipReadCacheClear: options?.skipRelationalReadCacheClear,
        });
        if (updated) {
            rememberDocumentType(updated);
            clearApiReadCachesUnlessSkipped(options);
            return updated;
        }
        forgetDocumentType(id);
    }

    const existing = await getDocumentById<Record<string, unknown> & { _type?: string }>(id, docType);
    if (!existing?._type) {
        throw new Error(`Document not found: ${id}`);
    }

    if (supportsRelationalDocType(existing._type)) {
        const updated = await relationalPatchDocument<T>(existing._type, id, updates, {
            skipReadCacheClear: options?.skipRelationalReadCacheClear,
        });
        if (!updated) {
            throw new Error(`Failed to update relational document for type: ${existing._type}`);
        }
        rememberDocumentType(updated);
        clearApiReadCachesUnlessSkipped(options);
        return updated;
    }

    throw new Error(`Unsupported relational document type for update: ${existing._type}`);
}

export async function deleteDocument(id: string, docType?: string) {
    if (docType && supportsRelationalDocType(docType)) {
        await relationalDeleteDocument(docType, id);
        forgetDocumentType(id);
        clearApiReadCaches();
        return true;
    }

    const hintedDocType = documentTypeHints.get(id);
    if (hintedDocType && supportsRelationalDocType(hintedDocType)) {
        const hintedDocument = await relationalGetById(hintedDocType, id);
        if (hintedDocument) {
            await relationalDeleteDocument(hintedDocType, id);
            forgetDocumentType(id);
            clearApiReadCaches();
            return true;
        }
        forgetDocumentType(id);
    }

    const existing = await getDocumentById<{ _type?: string }>(id, docType);
    if (!existing?._type) {
        return true;
    }

    if (existing?._type && supportsRelationalDocType(existing._type)) {
        await relationalDeleteDocument(existing._type, id);
        forgetDocumentType(id);
        clearApiReadCaches();
        return true;
    }

    return true;
}

export async function getCompanyProfile<T = Record<string, unknown>>() {
    const relationalCompany = await relationalGetAll<T>('companyProfile');
    return relationalCompany[0] || null;
}

export async function getNextNumber(prefix: string, dateValue?: string) {
    return getRelationalNextNumber(prefix, dateValue);
}

/**
 * Read-only preview of the next number for a prefix.
 *
 * Mirrors getRelationalNextNumber but never claims the counter, so showing a
 * preview (e.g. the auto-filled No. Invoice on the create form) cannot burn a number.
 */
export async function peekNextNumber(prefix: string, dateValue?: string) {
    const config = NUMBERING_CONFIG[prefix as keyof typeof NUMBERING_CONFIG];
    if (!config) {
        return `${prefix}-${Date.now()}`;
    }

    const period = buildNumberingPeriod(prefix as keyof typeof NUMBERING_CONFIG, dateValue);
    const company = await getRelationalCompanyProfileRow();
    const settings = isRecord(company?.numbering_settings) ? company.numbering_settings : {};
    const normalizedPrefix = normalizePrefix(settings[config.prefixField], config.defaultPrefix);
    const currentPeriod =
        typeof settings[config.periodField] === 'string' ? settings[config.periodField] : '';
    const currentCounter = currentPeriod === period ? numberFromUnknown(settings[config.counterField]) : 0;
    const maxExistingSuffix =
        await relationalMaxNumericSuffixByPrefix(config.docType, config.docField, `${normalizedPrefix}${period}-`)
        ?? 0;

    return `${normalizedPrefix}${period}-${String(Math.max(currentCounter, maxExistingSuffix) + 1).padStart(4, '0')}`;
}
