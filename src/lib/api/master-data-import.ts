import 'server-only';

import { jsonNoStore } from '@/lib/api/request-security';
import {
  getMasterDataImportTargetConfig,
  type MasterDataImportMode,
  type MasterDataImportTarget,
} from '@/lib/master-data-import-config';
import {
  createDocument,
  getAllDocuments,
  updateDocument,
} from '@/lib/repositories/document-store';
import { hasPermission, type AppModule } from '@/lib/rbac';
import type { Customer, CustomerProduct, Service, Supplier, TripRouteRate, UserRole, WarehouseItem } from '@/lib/types';

import {
  normalizeCustomerProductPayload,
  normalizeCustomerPayload,
  normalizeSupplierPayload,
  normalizeTripRouteRatePayload,
  normalizeWarehouseItemPayload,
} from './generic-workflow-support';

const MAX_IMPORT_ROWS = 1000;
const WAREHOUSE_ITEM_STOCK_HEADERS = new Set([
  'stok',
  'stock',
  'stok awal',
  'stock awal',
  'stok qty',
  'stock qty',
  'jumlah stok',
  'current stock qty',
  'currentstockqty',
  'stok saat ini',
]);

type ApiSession = {
  _id: string;
  name: string;
  email?: string;
  role: UserRole;
};

type ImportAction = 'create' | 'update' | 'skip';
type ImportStatus = 'ready' | 'warning' | 'error' | 'imported';

type ImportRowInput = Record<string, unknown>;

export type MasterDataImportRowResult = {
  rowNumber: number;
  status: ImportStatus;
  action: ImportAction;
  keyValue: string;
  displayName: string;
  existingId?: string;
  errors: string[];
  warnings: string[];
  normalizedData?: Record<string, unknown>;
  importedId?: string;
};

export type MasterDataImportResult = {
  target: MasterDataImportTarget;
  mode: MasterDataImportMode;
  summary: {
    totalRows: number;
    ready: number;
    warnings: number;
    errors: number;
    create: number;
    update: number;
    skip: number;
    imported: number;
  };
  rows: MasterDataImportRowResult[];
  batchId?: string;
};

type ExistingDocument = (Customer | CustomerProduct | Supplier | WarehouseItem | TripRouteRate) & { _rev?: string };

type TargetRuntimeConfig = {
  target: MasterDataImportTarget;
  entity: string;
  docType: 'customer' | 'customerProduct' | 'supplier' | 'warehouseItem' | 'tripRouteRate';
  module: AppModule;
  keyField: string;
  nameField: string;
  keyFromExisting: (doc: ExistingDocument) => string;
  buildPayload: (
    raw: Record<string, string>,
    params: {
      action: ImportAction;
      existing?: ExistingDocument;
      customerProductCustomer?: Customer;
      supplierLookup?: SupplierLookup;
      tripRouteRateService?: Service;
      errors: string[];
      warnings: string[];
    }
  ) => Record<string, unknown>;
  normalizePayload: (
    data: Record<string, unknown>,
    existing?: ExistingDocument
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
};

type SupplierLookup = {
  byCode: Map<string, Supplier[]>;
  byName: Map<string, Supplier[]>;
};

type CustomerLookup = {
  byName: Map<string, Customer[]>;
};

type ServiceLookup = {
  byCode: Map<string, Service[]>;
  byName: Map<string, Service[]>;
};

const TARGETS: Record<MasterDataImportTarget, TargetRuntimeConfig> = {
  customers: {
    target: 'customers',
    entity: 'customers',
    docType: 'customer',
    module: 'customers',
    keyField: 'name',
    nameField: 'name',
    keyFromExisting: (doc) => normalizeNameKey((doc as Customer).name),
    buildPayload: buildCustomerPayload,
    normalizePayload: (data, existing) => normalizeCustomerPayload(data, existing as Record<string, unknown> | undefined),
  },
  'customer-products': {
    target: 'customer-products',
    entity: 'customer-products',
    docType: 'customerProduct',
    module: 'customers',
    keyField: 'code',
    nameField: 'name',
    keyFromExisting: (doc) => buildCustomerProductImportKey((doc as CustomerProduct).customerRef, (doc as CustomerProduct).code),
    buildPayload: buildCustomerProductPayload,
    normalizePayload: (data, existing) => normalizeCustomerProductPayload(data, existing as Record<string, unknown> | undefined),
  },
  suppliers: {
    target: 'suppliers',
    entity: 'suppliers',
    docType: 'supplier',
    module: 'suppliers',
    keyField: 'supplierCode',
    nameField: 'name',
    keyFromExisting: (doc) => normalizeCodeKey((doc as Supplier).supplierCode),
    buildPayload: buildSupplierPayload,
    normalizePayload: (data, existing) => normalizeSupplierPayload(data, existing as Record<string, unknown> | undefined),
  },
  'warehouse-items': {
    target: 'warehouse-items',
    entity: 'warehouse-items',
    docType: 'warehouseItem',
    module: 'warehouseItems',
    keyField: 'itemCode',
    nameField: 'name',
    keyFromExisting: (doc) => normalizeCodeKey((doc as WarehouseItem).itemCode),
    buildPayload: buildWarehouseItemPayload,
    normalizePayload: (data, existing) => normalizeWarehouseItemPayload(data, existing as Record<string, unknown> | undefined),
  },
  'trip-route-rates': {
    target: 'trip-route-rates',
    entity: 'trip-route-rates',
    docType: 'tripRouteRate',
    module: 'tripRouteRates',
    keyField: 'originArea',
    nameField: 'destinationArea',
    keyFromExisting: (doc) => buildTripRouteRateImportKey(
      (doc as TripRouteRate).originArea,
      (doc as TripRouteRate).destinationArea,
      (doc as TripRouteRate).serviceRef,
    ),
    buildPayload: buildTripRouteRatePayload,
    normalizePayload: (data, existing) => normalizeTripRouteRatePayload(data, existing as Record<string, unknown> | undefined),
  },
};

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeTextInput(value: unknown) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

function normalizeCodeKey(value: unknown) {
  return normalizeTextInput(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCustomerProductImportKey(customerRef: unknown, code: unknown) {
  const normalizedCustomerRef = normalizeTextInput(customerRef);
  const codeKey = normalizeCodeKey(code);
  return normalizedCustomerRef && codeKey ? `${normalizedCustomerRef}::${codeKey}` : '';
}

function buildTripRouteRateImportKey(originArea: unknown, destinationArea: unknown, serviceRef?: unknown) {
  const originKey = normalizeNameKey(originArea);
  const destinationKey = normalizeNameKey(destinationArea);
  const serviceKey = normalizeTextInput(serviceRef) || '__SEMUA_ARMADA__';
  return originKey && destinationKey ? `${originKey}->${destinationKey}::${serviceKey}` : '';
}

function normalizeNameKey(value: unknown) {
  return normalizeTextInput(value).toLowerCase().replace(/\s+/g, ' ');
}

function parseActiveValue(value: string, label: string) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['aktif', 'active', 'ya', 'yes', 'y', 'true', '1'].includes(normalized)) return true;
  if (['nonaktif', 'non aktif', 'inactive', 'tidak', 'no', 'n', 'false', '0'].includes(normalized)) return false;
  throw new Error(`${label} harus Aktif atau Nonaktif`);
}

function setIfPresent(target: Record<string, unknown>, key: string, value: string | undefined) {
  if (value !== undefined && value !== '') {
    target[key] = value;
  }
}

function setBooleanIfPresent(target: Record<string, unknown>, key: string, value: string | undefined, label: string, errors: string[]) {
  if (value === undefined) return;
  if (value === '') return;
  try {
    target[key] = parseActiveValue(value, label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `${label} tidak valid`);
  }
}

function buildCustomerPayload(
  raw: Record<string, string>,
  params: { action: ImportAction; errors: string[] }
) {
  const payload: Record<string, unknown> = {};
  setIfPresent(payload, 'name', raw.name);
  setIfPresent(payload, 'address', raw.address);
  setIfPresent(payload, 'contactPerson', raw.contactPerson);
  setIfPresent(payload, 'phone', raw.phone);
  setIfPresent(payload, 'email', raw.email);
  setIfPresent(payload, 'npwp', raw.npwp);
  setIfPresent(payload, 'defaultPaymentTerm', raw.defaultPaymentTerm);
  setIfPresent(payload, 'creditLimitAmount', raw.creditLimitAmount);
  setIfPresent(payload, 'deliveryOrderPrefix', raw.deliveryOrderPrefix);
  setBooleanIfPresent(payload, 'active', raw.active, 'Status customer', params.errors);

  if (params.action === 'create') {
    payload.defaultPaymentTerm = payload.defaultPaymentTerm ?? 14;
    payload.creditLimitAmount = payload.creditLimitAmount ?? 0;
    payload.deliveryOrderPrefix = payload.deliveryOrderPrefix ?? 'SJ';
    payload.active = payload.active ?? true;
  }

  return payload;
}

function buildSupplierPayload(
  raw: Record<string, string>,
  params: { action: ImportAction; errors: string[] }
) {
  const payload: Record<string, unknown> = {};
  setIfPresent(payload, 'supplierCode', raw.supplierCode);
  setIfPresent(payload, 'name', raw.name);
  setIfPresent(payload, 'contactPerson', raw.contactPerson);
  setIfPresent(payload, 'phone', raw.phone);
  setIfPresent(payload, 'address', raw.address);
  setIfPresent(payload, 'defaultTermDays', raw.defaultTermDays);
  setIfPresent(payload, 'notes', raw.notes);
  setBooleanIfPresent(payload, 'active', raw.active, 'Status supplier', params.errors);

  if (params.action === 'create') {
    payload.defaultTermDays = payload.defaultTermDays ?? 14;
    payload.active = payload.active ?? true;
  }

  return payload;
}

function resolveCustomerReference(
  raw: Record<string, string>,
  customerLookup: CustomerLookup | undefined,
  errors: string[]
) {
  const nameKey = normalizeNameKey(raw.customerName);
  if (!nameKey) {
    errors.push('Nama customer wajib diisi');
    return null;
  }
  if (!customerLookup) {
    errors.push('Lookup customer tidak tersedia');
    return null;
  }

  const matches = customerLookup.byName.get(nameKey) || [];
  if (matches.length === 0) {
    errors.push(`Customer ${raw.customerName} tidak ditemukan`);
    return null;
  }
  if (matches.length > 1) {
    errors.push(`Nama customer ${raw.customerName} duplikat. Rapikan master customer dulu sebelum import barang customer.`);
    return null;
  }
  return matches[0];
}

function buildCustomerProductPayload(
  raw: Record<string, string>,
  params: {
    action: ImportAction;
    customerProductCustomer?: Customer;
    errors: string[];
  }
) {
  const payload: Record<string, unknown> = {};
  if (!params.customerProductCustomer) {
    params.errors.push('Customer barang tidak ditemukan');
    return payload;
  }

  payload.customerRef = params.customerProductCustomer._id;
  setIfPresent(payload, 'code', raw.code);
  setIfPresent(payload, 'name', raw.name);
  setIfPresent(payload, 'description', raw.description);
  setIfPresent(payload, 'defaultQtyKoli', raw.defaultQtyKoli);
  setIfPresent(payload, 'defaultWeightInputValue', raw.defaultWeightInputValue);
  setIfPresent(payload, 'defaultWeightInputUnit', raw.defaultWeightInputUnit);
  setIfPresent(payload, 'defaultVolumeInputValue', raw.defaultVolumeInputValue);
  setIfPresent(payload, 'defaultVolumeInputUnit', raw.defaultVolumeInputUnit);
  setIfPresent(payload, 'notes', raw.notes);
  setBooleanIfPresent(payload, 'active', raw.active, 'Status barang customer', params.errors);

  if (params.action === 'create') {
    payload.defaultQtyKoli = payload.defaultQtyKoli ?? 1;
    payload.defaultWeightInputUnit = payload.defaultWeightInputUnit ?? 'KG';
    payload.defaultVolumeInputUnit = payload.defaultVolumeInputUnit ?? 'M3';
    payload.active = payload.active ?? true;
  }

  return payload;
}

function resolveSupplierReference(
  raw: Record<string, string>,
  supplierLookup: SupplierLookup | undefined,
  errors: string[],
  warnings: string[]
) {
  const code = normalizeCodeKey(raw.defaultSupplierCode);
  const nameKey = normalizeNameKey(raw.defaultSupplierName);
  if (!code && !nameKey) return null;
  if (!supplierLookup) {
    errors.push('Lookup supplier tidak tersedia');
    return null;
  }

  const matches = code
    ? supplierLookup.byCode.get(code) || []
    : supplierLookup.byName.get(nameKey) || [];
  if (matches.length === 0) {
    errors.push(code ? `Supplier default ${code} tidak ditemukan` : `Supplier default ${raw.defaultSupplierName} tidak ditemukan`);
    return null;
  }
  if (matches.length > 1) {
    errors.push(code ? `Supplier default ${code} duplikat` : `Nama supplier default ${raw.defaultSupplierName} duplikat. Isi Kode Supplier Default.`);
    return null;
  }
  const supplier = matches[0];
  if (supplier.active === false) {
    errors.push(`Supplier default ${supplier.supplierCode || supplier.name} tidak aktif`);
    return null;
  }
  if (!code && nameKey) {
    warnings.push('Supplier default dicocokkan dari nama. Lebih aman isi Kode Supplier Default.');
  }
  return supplier;
}

function buildWarehouseItemPayload(
  raw: Record<string, string>,
  params: {
    action: ImportAction;
    supplierLookup?: SupplierLookup;
    errors: string[];
    warnings: string[];
  }
) {
  const payload: Record<string, unknown> = {};
  setIfPresent(payload, 'itemCode', raw.itemCode);
  setIfPresent(payload, 'name', raw.name);
  setIfPresent(payload, 'category', raw.category);
  setIfPresent(payload, 'unit', raw.unit);
  setIfPresent(payload, 'trackingMode', raw.trackingMode);
  setIfPresent(payload, 'minStockQty', raw.minStockQty);
  setIfPresent(payload, 'defaultPurchasePrice', raw.defaultPurchasePrice);
  setIfPresent(payload, 'tireTypeDefault', raw.tireTypeDefault);
  setIfPresent(payload, 'tireBrandDefault', raw.tireBrandDefault);
  setIfPresent(payload, 'tireSizeDefault', raw.tireSizeDefault);
  setIfPresent(payload, 'notes', raw.notes);
  setBooleanIfPresent(payload, 'active', raw.active, 'Status barang gudang', params.errors);

  const supplier = resolveSupplierReference(raw, params.supplierLookup, params.errors, params.warnings);
  if (supplier) {
    payload.defaultSupplierRef = supplier._id;
    payload.defaultSupplierName = supplier.name;
  }

  if (params.action === 'create') {
    payload.unit = payload.unit ?? 'PCS';
    payload.trackingMode = payload.trackingMode ?? 'STANDARD';
    payload.minStockQty = payload.minStockQty ?? 0;
    payload.defaultPurchasePrice = payload.defaultPurchasePrice ?? 0;
    payload.active = payload.active ?? true;
  }

  return payload;
}

function resolveTripRouteRateServiceReference(
  raw: Record<string, string>,
  serviceLookup: ServiceLookup | undefined,
  errors: string[],
  warnings: string[]
) {
  const code = normalizeCodeKey(raw.serviceCode);
  const nameKey = normalizeNameKey(raw.serviceName);
  if (!code && !nameKey) return null;
  if (!serviceLookup) {
    errors.push('Lookup kategori armada tarif trip tidak tersedia');
    return null;
  }

  const matches = code
    ? serviceLookup.byCode.get(code) || []
    : serviceLookup.byName.get(nameKey) || [];
  if (matches.length === 0) {
    errors.push(code ? `Kategori armada tarif trip ${code} tidak ditemukan` : `Kategori armada tarif trip ${raw.serviceName} tidak ditemukan`);
    return null;
  }
  if (matches.length > 1) {
    errors.push(code ? `Kategori armada tarif trip ${code} duplikat` : `Nama kategori armada tarif trip ${raw.serviceName} duplikat. Isi Kode Jenis Armada.`);
    return null;
  }

  const service = matches[0];
  if (service.active === false) {
    errors.push(`Kategori armada tarif trip ${service.code || service.name} tidak aktif`);
    return null;
  }
  if (!code && nameKey) {
    warnings.push('Kategori armada tarif trip dicocokkan dari nama. Lebih aman isi Kode Jenis Armada.');
  }
  if (code && nameKey && normalizeNameKey(service.name) !== nameKey) {
    warnings.push(`Jenis armada "${raw.serviceName}" tidak sama persis dengan kode ${service.code}. Import memakai kode jenis armada.`);
  }
  return service;
}

function buildTripRouteRatePayload(
  raw: Record<string, string>,
  params: {
    action: ImportAction;
    tripRouteRateService?: Service;
    errors: string[];
  }
) {
  const payload: Record<string, unknown> = {};
  setIfPresent(payload, 'originArea', raw.originArea);
  setIfPresent(payload, 'destinationArea', raw.destinationArea);
  setIfPresent(payload, 'rate', raw.rate);
  setIfPresent(payload, 'overtonaseDriverRatePerTon', raw.overtonaseDriverRatePerTon);
  setIfPresent(payload, 'notes', raw.notes);
  setBooleanIfPresent(payload, 'active', raw.active, 'Status tarif trip', params.errors);

  if (params.tripRouteRateService) {
    payload.serviceRef = params.tripRouteRateService._id;
  }

  if (params.action === 'create') {
    payload.overtonaseDriverRatePerTon = payload.overtonaseDriverRatePerTon ?? 0;
    payload.active = payload.active ?? true;
  }

  return payload;
}

function buildFieldAliasMap(target: MasterDataImportTarget) {
  const config = getMasterDataImportTargetConfig(target);
  const map = new Map<string, string>();
  for (const field of config?.fields || []) {
    map.set(normalizeHeader(field.key), field.key);
    map.set(normalizeHeader(field.label), field.key);
    for (const alias of field.aliases || []) {
      map.set(normalizeHeader(alias), field.key);
    }
  }
  return map;
}

function isIgnoredWarehouseStockHeader(header: string) {
  return WAREHOUSE_ITEM_STOCK_HEADERS.has(normalizeHeader(header));
}

function mapInputRow(target: MasterDataImportTarget, row: ImportRowInput) {
  const aliasMap = buildFieldAliasMap(target);
  const mapped: Record<string, string> = {};
  const unknownColumns: string[] = [];
  const duplicateColumns: string[] = [];
  const mappedHeaders = new Map<string, string>();

  for (const [header, value] of Object.entries(row)) {
    const normalizedHeader = normalizeHeader(header);
    const fieldKey = aliasMap.get(normalizedHeader);
    const textValue = normalizeTextInput(value);
    if (!fieldKey) {
      if (textValue) unknownColumns.push(header);
      continue;
    }
    const firstHeader = mappedHeaders.get(fieldKey);
    if (firstHeader) {
      duplicateColumns.push(`Kolom "${header}" duplikat dengan "${firstHeader}" untuk field ${fieldKey}`);
      continue;
    }
    mappedHeaders.set(fieldKey, header);
    mapped[fieldKey] = textValue;
  }

  return { mapped, unknownColumns, duplicateColumns };
}

function resolveAction(value: unknown): 'preview' | 'commit' | null {
  return value === 'preview' || value === 'commit' ? value : null;
}

function resolveMode(value: unknown): MasterDataImportMode | null {
  return value === 'createOnly' || value === 'updateOnly' || value === 'upsert' ? value : null;
}

function resolveTarget(value: unknown): MasterDataImportTarget | null {
  return value === 'customers' || value === 'customer-products' || value === 'suppliers' || value === 'warehouse-items' || value === 'trip-route-rates' ? value : null;
}

function resolveRequiredPermission(mode: MasterDataImportMode) {
  if (mode === 'createOnly') return ['create'] as const;
  if (mode === 'updateOnly') return ['update'] as const;
  return ['create', 'update'] as const;
}

function hasImportPermission(session: ApiSession, module: AppModule, mode: MasterDataImportMode) {
  return resolveRequiredPermission(mode).every((permission) => hasPermission(session, module, permission));
}

async function addAuditLog(
  session: ApiSession,
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

async function loadExistingIndex(runtime: TargetRuntimeConfig) {
  const rows = await getAllDocuments<ExistingDocument>(runtime.docType);
  const index = new Map<string, ExistingDocument[]>();
  for (const row of rows) {
    const key = runtime.keyFromExisting(row);
    if (!key) continue;
    const current = index.get(key) || [];
    current.push(row);
    index.set(key, current);
  }
  return index;
}

async function loadSupplierLookup(): Promise<SupplierLookup> {
  const suppliers = await getAllDocuments<Supplier>('supplier');
  const byCode = new Map<string, Supplier[]>();
  const byName = new Map<string, Supplier[]>();
  for (const supplier of suppliers) {
    const codeKey = normalizeCodeKey(supplier.supplierCode);
    const nameKey = normalizeNameKey(supplier.name);
    if (codeKey) byCode.set(codeKey, [...(byCode.get(codeKey) || []), supplier]);
    if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) || []), supplier]);
  }
  return { byCode, byName };
}

async function loadCustomerLookup(): Promise<CustomerLookup> {
  const customers = await getAllDocuments<Customer>('customer');
  const byName = new Map<string, Customer[]>();
  for (const customer of customers) {
    const nameKey = normalizeNameKey(customer.name);
    if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) || []), customer]);
  }
  return { byName };
}

async function loadServiceLookup(): Promise<ServiceLookup> {
  const services = await getAllDocuments<Service>('service');
  const byCode = new Map<string, Service[]>();
  const byName = new Map<string, Service[]>();
  for (const service of services) {
    const codeKey = normalizeCodeKey(service.code);
    const nameKey = normalizeNameKey(service.name);
    if (codeKey) byCode.set(codeKey, [...(byCode.get(codeKey) || []), service]);
    if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) || []), service]);
  }
  return { byCode, byName };
}

function resolveRowAction(mode: MasterDataImportMode, existing?: ExistingDocument): ImportAction {
  if (mode === 'createOnly') return existing ? 'skip' : 'create';
  if (mode === 'updateOnly') return existing ? 'update' : 'skip';
  return existing ? 'update' : 'create';
}

function summarizeRows(rows: MasterDataImportRowResult[], totalRows: number) {
  return {
    totalRows,
    ready: rows.filter((row) => row.status === 'ready').length,
    warnings: rows.filter((row) => row.status === 'warning').length,
    errors: rows.filter((row) => row.status === 'error').length,
    create: rows.filter((row) => row.action === 'create' && row.status !== 'error').length,
    update: rows.filter((row) => row.action === 'update' && row.status !== 'error').length,
    skip: rows.filter((row) => row.action === 'skip' && row.status !== 'error').length,
    imported: rows.filter((row) => row.status === 'imported').length,
  };
}

async function evaluateImportRows(params: {
  session: ApiSession;
  target: MasterDataImportTarget;
  mode: MasterDataImportMode;
  rows: ImportRowInput[];
}): Promise<MasterDataImportResult> {
  const runtime = TARGETS[params.target];
  const existingIndex = await loadExistingIndex(runtime);
  const supplierLookup = params.target === 'warehouse-items' ? await loadSupplierLookup() : undefined;
  const customerLookup = params.target === 'customer-products' ? await loadCustomerLookup() : undefined;
  const serviceLookup = params.target === 'trip-route-rates' ? await loadServiceLookup() : undefined;
  const seenKeys = new Map<string, number>();
  const results: MasterDataImportRowResult[] = [];

  for (let index = 0; index < params.rows.length; index += 1) {
    const rowNumber = index + 2;
    const { mapped, unknownColumns, duplicateColumns } = mapInputRow(params.target, params.rows[index]);
    const errors: string[] = [];
    const warnings: string[] = [];
    let customerProductCustomer: Customer | undefined;
    let tripRouteRateService: Service | undefined;
    let keyValue = '';
    let displayName = '';

    if (params.target === 'customer-products') {
      const resolvedCustomer = resolveCustomerReference(mapped, customerLookup, errors);
      customerProductCustomer = resolvedCustomer || undefined;
      const codeKey = normalizeCodeKey(mapped.code);
      if (!codeKey) {
        errors.push('Kode barang customer wajib diisi untuk import');
      }
      keyValue = resolvedCustomer ? buildCustomerProductImportKey(resolvedCustomer._id, mapped.code) : '';
      displayName = [
        resolvedCustomer?.name || normalizeTextInput(mapped.customerName),
        normalizeTextInput(mapped.code),
        normalizeTextInput(mapped.name),
      ].filter(Boolean).join(' / ');
    } else if (params.target === 'trip-route-rates') {
      const originKey = normalizeNameKey(mapped.originArea);
      const destinationKey = normalizeNameKey(mapped.destinationArea);
      if (!originKey) {
        errors.push('Asal area trip wajib diisi');
      }
      if (!destinationKey) {
        errors.push('Tujuan area trip wajib diisi');
      }

      const serviceInput = normalizeCodeKey(mapped.serviceCode) || normalizeNameKey(mapped.serviceName);
      const resolvedService = resolveTripRouteRateServiceReference(mapped, serviceLookup, errors, warnings);
      tripRouteRateService = resolvedService || undefined;
      if (originKey && destinationKey && (!serviceInput || resolvedService)) {
        keyValue = buildTripRouteRateImportKey(mapped.originArea, mapped.destinationArea, resolvedService?._id);
      }
      displayName = [
        `${normalizeTextInput(mapped.originArea) || '-'} -> ${normalizeTextInput(mapped.destinationArea) || '-'}`,
        resolvedService?.name || (serviceInput ? 'Jenis armada tidak valid' : 'Semua armada'),
      ].filter(Boolean).join(' / ');
    } else {
      keyValue = runtime.target === 'customers'
        ? normalizeNameKey(mapped[runtime.keyField])
        : normalizeCodeKey(mapped[runtime.keyField]);
      displayName = normalizeTextInput(mapped[runtime.nameField] || mapped[runtime.keyField]) || keyValue || '-';
      if (params.target === 'suppliers') {
        const termRaw = normalizeTextInput(mapped.defaultTermDays);
        const isKontan = /^\s*kontan\s*$/i.test(termRaw) || termRaw === '0';
        const termDisplay = isKontan ? 'Kontan' : termRaw ? `${termRaw} hari` : '';
        if (termDisplay) {
          displayName = `${displayName} (${termDisplay})`;
        }
      }
    }

    if (!keyValue && params.target !== 'customer-products' && params.target !== 'trip-route-rates') {
      errors.push(`${runtime.keyField === 'name' ? 'Nama customer' : runtime.keyField === 'supplierCode' ? 'Kode supplier' : 'Kode barang'} wajib diisi`);
    }

    if (keyValue) {
      const firstRow = seenKeys.get(keyValue);
      if (firstRow) {
        errors.push(`Duplikat dengan baris ${firstRow} dalam file import`);
      } else {
        seenKeys.set(keyValue, rowNumber);
      }
    }

    for (const column of unknownColumns) {
      if (params.target === 'warehouse-items' && isIgnoredWarehouseStockHeader(column)) {
        continue;
      }
      errors.push(`Kolom "${column}" tidak dikenali untuk import ${runtime.entity}. Pakai template Excel terbaru atau hapus kolom tersebut.`);
    }
    for (const column of duplicateColumns) {
      errors.push(column);
    }
    if (params.target === 'warehouse-items') {
      const lowerHeaders = Object.keys(params.rows[index]).map(normalizeHeader);
      if (lowerHeaders.some((header) => WAREHOUSE_ITEM_STOCK_HEADERS.has(header))) {
        warnings.push('Kolom stok diabaikan. Stok awal harus lewat pembelian atau mutasi stok.');
      }
    }

    const matches = keyValue ? existingIndex.get(keyValue) || [] : [];
    if (matches.length > 1) {
      errors.push(params.target === 'customer-products'
        ? 'Kode barang customer sudah ada lebih dari satu untuk customer ini. Perbaiki data master dulu sebelum import.'
        : params.target === 'trip-route-rates'
          ? 'Biaya rute trip sudah ada lebih dari satu untuk kombinasi asal, tujuan, dan jenis armada ini. Perbaiki data master dulu sebelum import.'
          : `${runtime.keyField === 'name' ? 'Nama customer' : 'Kode'} sudah ada lebih dari satu di database. Perbaiki data master dulu sebelum import.`);
    }
    const existing = matches.length === 1 ? matches[0] : undefined;
    const action = resolveRowAction(params.mode, existing);
    if (params.target === 'customer-products' && customerProductCustomer?.active === false && action === 'create') {
      errors.push(`Customer ${customerProductCustomer.name} tidak aktif dan tidak bisa dipakai untuk master barang baru`);
    }
    if (action === 'skip') {
      warnings.push(existing ? 'Data sudah ada, dilewati oleh mode Tambah baru saja' : 'Data belum ada, dilewati oleh mode Update data yang sudah ada');
    }

    let normalizedData: Record<string, unknown> | undefined;
    if (errors.length === 0 && action !== 'skip') {
      const payload = runtime.buildPayload(mapped, {
        action,
        existing,
        customerProductCustomer,
        supplierLookup,
        tripRouteRateService,
        errors,
        warnings,
      });
      try {
        normalizedData = await runtime.normalizePayload(payload, existing);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Data tidak valid');
      }
    }

    const status: ImportStatus = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ready';
    results.push({
      rowNumber,
      status,
      action,
      keyValue,
      displayName: displayName || keyValue || '-',
      existingId: existing?._id,
      errors,
      warnings,
      normalizedData,
    });
  }

  return {
    target: params.target,
    mode: params.mode,
    summary: summarizeRows(results, params.rows.length),
    rows: results,
  };
}

function importAuditSummary(runtime: TargetRuntimeConfig, row: MasterDataImportRowResult, batchId: string) {
  const verb = row.action === 'create' ? 'Import tambah' : 'Import update';
  return `${verb} ${runtime.entity}: ${row.displayName || row.keyValue} | batch ${batchId}`;
}

async function commitImportRows(params: {
  session: ApiSession;
  target: MasterDataImportTarget;
  mode: MasterDataImportMode;
  rows: ImportRowInput[];
}) {
  const evaluated = await evaluateImportRows(params);
  if (evaluated.summary.errors > 0) {
    return evaluated;
  }

  const runtime = TARGETS[params.target];
  const batchId = crypto.randomUUID();
  const committedRows: MasterDataImportRowResult[] = [];

  for (const row of evaluated.rows) {
    if (row.action === 'skip' || !row.normalizedData) {
      committedRows.push(row);
      continue;
    }

    try {
      if (row.action === 'create') {
        const id = crypto.randomUUID();
        const created = await createDocument<ExistingDocument>({
          _id: id,
          _type: runtime.docType,
          ...row.normalizedData,
        });
        await addAuditLog(params.session, 'CREATE', runtime.entity, created._id, importAuditSummary(runtime, row, batchId));
        committedRows.push({ ...row, status: 'imported', importedId: created._id });
      } else if (row.action === 'update' && row.existingId) {
        const updated = await updateDocument<ExistingDocument>(row.existingId, row.normalizedData, runtime.docType);
        await addAuditLog(params.session, 'UPDATE', runtime.entity, row.existingId, importAuditSummary(runtime, row, batchId));
        committedRows.push({ ...row, status: 'imported', importedId: updated?._id || row.existingId });
      } else {
        committedRows.push({ ...row, status: 'error', errors: [...row.errors, 'Aksi import tidak valid'] });
      }
    } catch (error) {
      committedRows.push({
        ...row,
        status: 'error',
        errors: [...row.errors, error instanceof Error ? error.message : 'Gagal menyimpan baris import'],
      });
    }
  }

  return {
    ...evaluated,
    batchId,
    rows: committedRows,
    summary: summarizeRows(committedRows, params.rows.length),
  };
}

export async function handleMasterDataImport(
  session: ApiSession,
  body: Record<string, unknown>
) {
  const action = resolveAction(body.action);
  const target = resolveTarget(body.target);
  const mode = resolveMode(body.mode);
  const rawRows = body.rows;

  if (!action) {
    return jsonNoStore({ error: 'Aksi import tidak valid' }, { status: 400 });
  }
  if (!target) {
    return jsonNoStore({ error: 'Target import tidak valid' }, { status: 400 });
  }
  if (!mode) {
    return jsonNoStore({ error: 'Mode import tidak valid' }, { status: 400 });
  }
  if (!Array.isArray(rawRows)) {
    return jsonNoStore({ error: 'Rows import tidak valid' }, { status: 400 });
  }
  const invalidRowIndex = rawRows.findIndex((row) => !row || typeof row !== 'object' || Array.isArray(row));
  if (invalidRowIndex >= 0) {
    return jsonNoStore({ error: `Baris import ${invalidRowIndex + 2} harus berupa objek data` }, { status: 400 });
  }
  const rows = rawRows as ImportRowInput[];
  if (rows.length === 0) {
    return jsonNoStore({ error: 'File import tidak memiliki baris data' }, { status: 400 });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return jsonNoStore({ error: `Import maksimal ${MAX_IMPORT_ROWS} baris per batch` }, { status: 400 });
  }

  const runtime = TARGETS[target];
  if (!hasImportPermission(session, runtime.module, mode)) {
    return jsonNoStore({ error: 'Tidak punya akses import untuk target dan mode ini' }, { status: 403 });
  }

  const result = action === 'commit'
    ? await commitImportRows({ session, target, mode, rows })
    : await evaluateImportRows({ session, target, mode, rows });

  return jsonNoStore({ data: result });
}
