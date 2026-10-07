import { loadScriptEnv } from './_env';

loadScriptEnv();

import { summarizeCustomerCreditUsage } from '../src/lib/customer-credit-limit';
import { buildNotaRowsFromDeliveryOrder } from '../src/lib/invoice-create-page-support';
import type { DeliveryOrder, DeliveryOrderItem, Driver, FreightNota, FreightNotaItem, Order, Vehicle } from '../src/lib/types';
import type { SuratJalanDocument } from '../src/lib/trip-document-types';

type ApiResponse<T> = {
    data?: T;
    id?: string;
    error?: string;
};

type CustomerLike = {
    _id: string;
    name?: string;
    creditLimitAmount?: number;
    active?: boolean;
};

type ServiceLike = {
    _id: string;
    name?: string;
    active?: boolean;
};

type BankAccountLike = {
    _id: string;
    active?: boolean;
};

type CreatedState = {
    orderId?: string;
    deliveryOrderIds: string[];
    notaId?: string;
    auditDriverIds?: string[];
    auditVehicleIds?: string[];
};

type ProvisionedAuditResources = {
    drivers: Driver[];
    vehicles: Vehicle[];
};

const AUDIT_DATE = '2026-04-21';
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 45000);
const REQUIRED_AUDIT_TRIP_RESOURCES = 5;

function getBaseUrl() {
    return (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function auditStep(message: string) {
    console.log(`[audit:order-to-nota] ${message}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${label} timeout setelah ${timeoutMs} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function cleanEnv(value: string | undefined) {
    const trimmed = value?.trim().replace(/^['"]+|['"]+$/g, '');
    return trimmed || undefined;
}

function getSupabaseConfig() {
    const url = cleanEnv(
        process.env.SUPABASE_URL ||
        process.env.SUPABASE_PROJECT_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL
    );
    const key = cleanEnv(
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE
    );
    assert(url && key, 'Audit cleanup butuh SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.');
    return { url, key };
}

async function supabaseRest<T>(path: string, init: RequestInit = {}) {
    const config = getSupabaseConfig();
    const headers = new Headers(init.headers);
    headers.set('apikey', config.key);
    headers.set('Authorization', `Bearer ${config.key}`);
    headers.set('Content-Type', 'application/json');
    const response = await fetchWithTimeout(`${config.url}/rest/v1/${path}`, {
        ...init,
        headers,
    }, `Supabase ${init.method || 'GET'} ${path}`);
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Supabase ${init.method || 'GET'} ${path} -> ${response.status}: ${bodyText}`);
    }
    return bodyText ? JSON.parse(bodyText) as T : undefined as T;
}

async function listSourceIds(table: string, filter: string) {
    const rows = await supabaseRest<Array<{ source_document_id: string }>>(
        `${table}?select=source_document_id&${filter}`
    );
    return (rows || []).map(row => row.source_document_id).filter(Boolean);
}

async function deleteBySourceId(table: string, id: string) {
    if (!id) return;
    await supabaseRest(`${table}?source_document_id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
    }).catch(() => undefined);
}

async function upsertRows(table: string, rows: Array<Record<string, unknown>>) {
    if (rows.length === 0) return;
    await supabaseRest(`${table}?on_conflict=source_document_id`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
    });
}

async function deleteJournalEntriesBySource(sourceType: string, sourceRef: string) {
    if (!sourceType || !sourceRef) return;
    const journalIds = await listSourceIds(
        'journal_entries',
        `source_type=eq.${encodeURIComponent(sourceType)}&source_ref=eq.${encodeURIComponent(sourceRef)}`
    ).catch(() => []);
    for (const journalId of journalIds) {
        await supabaseRest(`journal_lines?journal_entry_ref=eq.${encodeURIComponent(journalId)}`, {
            method: 'DELETE',
            headers: { Prefer: 'return=minimal' },
        }).catch(() => undefined);
        await deleteBySourceId('journal_entries', journalId);
    }
}

async function loginAndGetCookieHeader() {
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/login`,
        },
        body: JSON.stringify({
            email: process.env.AUDIT_LOGIN_EMAIL || 'owner@company.local',
            password: process.env.AUDIT_LOGIN_PASSWORD || 'owner12345',
        }),
    }, 'Login admin');

    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Login admin gagal (${response.status}): ${bodyText}`);
    }

    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookieHeader = cookies
        .map(cookie => cookie.split(';')[0])
        .filter(Boolean)
        .join('; ');

    assert(cookieHeader, 'Login admin berhasil tetapi cookie session tidak diterima');
    return cookieHeader;
}

async function requestJson<T>(path: string, cookieHeader: string) {
    const response = await fetchWithTimeout(`${getBaseUrl()}${path}`, {
        headers: {
            Cookie: cookieHeader,
        },
    }, `GET ${path}`);
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`${path} -> ${response.status}: ${bodyText}`);
    }
    return JSON.parse(bodyText) as T;
}

async function postData<T>(
    cookieHeader: string,
    payload: Record<string, unknown>,
    options?: { expectStatus?: number }
) {
    const actionLabel = `${normalizeText(payload.entity) || 'entity'}:${normalizeText(payload.action) || 'action'}`;
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/orders`,
            Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
    }, `POST /api/data ${actionLabel}`);

    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as ApiResponse<T> : {};
    if (options?.expectStatus) {
        assert(
            response.status === options.expectStatus,
            `/api/data expected ${options.expectStatus}, got ${response.status}: ${bodyText}`
        );
        return parsed;
    }
    if (!response.ok) {
        throw new Error(`/api/data -> ${response.status}: ${bodyText}`);
    }
    return parsed;
}

async function cleanupCreatedState(state: CreatedState) {
    if (state.notaId) {
        const notaItemIds = await listSourceIds('freight_nota_items', `nota_ref=eq.${encodeURIComponent(state.notaId)}`).catch(() => []);
        for (const itemId of notaItemIds) {
            await deleteBySourceId('freight_nota_items', itemId);
        }
        await deleteJournalEntriesBySource('FREIGHT_NOTA', state.notaId);
        await deleteBySourceId('freight_notas', state.notaId);
    }

    for (const deliveryOrderId of state.deliveryOrderIds) {
        const notaItemIds = await listSourceIds('freight_nota_items', `do_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []);
        const notaIds = new Set<string>();
        for (const itemId of notaItemIds) {
            const rows = await supabaseRest<Array<{ nota_ref?: string }>>(
                `freight_nota_items?select=nota_ref&source_document_id=eq.${encodeURIComponent(itemId)}`
            ).catch(() => []);
            rows?.forEach(row => {
                if (row.nota_ref) notaIds.add(row.nota_ref);
            });
            await deleteBySourceId('freight_nota_items', itemId);
        }
        for (const notaId of notaIds) {
            await deleteJournalEntriesBySource('FREIGHT_NOTA', notaId);
            await deleteBySourceId('freight_notas', notaId);
        }

        const [deliveryOrderItemIds, trackingLogIds, driverVoucherIds, suratJalanIds, suratJalanItemIds] = await Promise.all([
            listSourceIds('delivery_order_items', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('tracking_logs', `ref_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('driver_vouchers', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('surat_jalan_documents', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('surat_jalan_items', `trip_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
        ]);
        for (const itemId of suratJalanItemIds) {
            await deleteBySourceId('surat_jalan_items', itemId);
        }
        for (const itemId of suratJalanIds) {
            await deleteBySourceId('surat_jalan_documents', itemId);
        }
        for (const itemId of deliveryOrderItemIds) {
            await deleteBySourceId('delivery_order_items', itemId);
        }
        for (const itemId of trackingLogIds) {
            await deleteBySourceId('tracking_logs', itemId);
        }
        for (const itemId of driverVoucherIds) {
            const disbursementIds = await listSourceIds(
                'driver_voucher_disbursements',
                `voucher_ref=eq.${encodeURIComponent(itemId)}`
            ).catch(() => []);
            for (const disbursementId of disbursementIds) {
                await deleteJournalEntriesBySource('DRIVER_VOUCHER_DISBURSEMENT', disbursementId);
                await deleteBySourceId('driver_voucher_disbursements', disbursementId);
            }
            await deleteJournalEntriesBySource('DRIVER_VOUCHER', itemId);
            await deleteBySourceId('driver_vouchers', itemId);
        }
        await deleteBySourceId('trips', deliveryOrderId);
        await deleteBySourceId('delivery_orders', deliveryOrderId);
    }

    if (state.orderId) {
        const orderItemIds = await listSourceIds('order_items', `order_ref=eq.${encodeURIComponent(state.orderId)}`).catch(() => []);
        for (const itemId of orderItemIds) {
            await deleteBySourceId('order_items', itemId);
        }
        await deleteBySourceId('orders', state.orderId);
    }

    for (const vehicleId of state.auditVehicleIds || []) {
        await deleteBySourceId('vehicles', vehicleId);
    }
    for (const driverId of state.auditDriverIds || []) {
        await deleteBySourceId('drivers', driverId);
    }
}

async function cleanupDeliveryOrderRelationalArtifacts(deliveryOrderId: string, tripRecordId = deliveryOrderId) {
    const [suratJalanIds, suratJalanItemIds] = await Promise.all([
        listSourceIds('surat_jalan_documents', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
        listSourceIds('surat_jalan_items', `trip_ref=eq.${encodeURIComponent(tripRecordId)}`).catch(() => []),
    ]);
    for (const itemId of suratJalanItemIds) {
        await deleteBySourceId('surat_jalan_items', itemId);
    }
    for (const itemId of suratJalanIds) {
        await deleteBySourceId('surat_jalan_documents', itemId);
    }
    await deleteBySourceId('trips', tripRecordId);
}

async function cleanupStaleAuditOrders() {
    const rows = await supabaseRest<Array<{ source_document_id: string }>>(
        'orders?select=source_document_id&notes=ilike.*Audit%20E2E*'
    ).catch(() => []);
    for (const row of rows || []) {
        const deliveryOrderIds = await listSourceIds('delivery_orders', `order_ref=eq.${encodeURIComponent(row.source_document_id)}`).catch(() => []);
        await cleanupCreatedState({
            orderId: row.source_document_id,
            deliveryOrderIds,
        });
    }

    const staleTripRows = await supabaseRest<Array<{
        source_document_id: string;
        delivery_order_ref?: string;
        trip_number?: string;
    }>>(
        `trips?select=source_document_id,delivery_order_ref,trip_number&trip_date=eq.${encodeURIComponent(AUDIT_DATE)}`
    ).catch(() => []);
    for (const row of staleTripRows || []) {
        const deliveryOrderId = row.delivery_order_ref || row.source_document_id;
        const isAuditNumber = typeof row.trip_number === 'string' && row.trip_number.startsWith('DO-21042026-');
        if (!deliveryOrderId || !isAuditNumber) {
            continue;
        }
        const deliveryOrderRows = await supabaseRest<Array<{ source_document_id: string }>>(
            `delivery_orders?select=source_document_id&source_document_id=eq.${encodeURIComponent(deliveryOrderId)}&limit=1`
        ).catch(() => []);
        if (deliveryOrderRows?.length) {
            continue;
        }
        await cleanupDeliveryOrderRelationalArtifacts(deliveryOrderId, row.source_document_id);
    }
}

function pickAuditResources(params: {
    customers: CustomerLike[];
    services: ServiceLike[];
    vehicles: Vehicle[];
    drivers: Driver[];
    bankAccounts: BankAccountLike[];
    orders: Order[];
    deliveryOrders: DeliveryOrder[];
    freightNotas: FreightNota[];
}) {
    const activeServices = params.services.filter(item => item.active !== false);
    // Driver/vehicle exclusivity is gone: any operational vehicle and any active
    // driver may be reused across multiple DOs at the same time.
    const availableVehicles = params.vehicles.filter(item =>
        item.status !== 'SOLD' &&
        item.status !== 'OUT_OF_SERVICE'
    );
    const availableDrivers = params.drivers.filter(item => item.active !== false);
    const customer = pickAvailableAuditCustomer(params.customers, params.freightNotas);

    for (const service of activeServices) {
        const matchingVehicles = availableVehicles.filter(vehicle => normalizeText(vehicle.serviceRef) === service._id);
        if (matchingVehicles.length >= REQUIRED_AUDIT_TRIP_RESOURCES && availableDrivers.length >= REQUIRED_AUDIT_TRIP_RESOURCES) {
            return {
                customer,
                service,
                vehicles: matchingVehicles.slice(0, REQUIRED_AUDIT_TRIP_RESOURCES),
                drivers: availableDrivers.slice(0, REQUIRED_AUDIT_TRIP_RESOURCES),
                bankAccount: params.bankAccounts.find(item => item.active !== false),
            };
        }
    }

    return {
        customer,
        service: undefined,
        vehicles: availableVehicles.slice(0, REQUIRED_AUDIT_TRIP_RESOURCES),
        drivers: availableDrivers.slice(0, REQUIRED_AUDIT_TRIP_RESOURCES),
        bankAccount: params.bankAccounts.find(item => item.active !== false),
    };
}

function pickAvailableAuditCustomer(customers: CustomerLike[], freightNotas: FreightNota[]) {
    const activeCustomers = customers.filter(item => item.active !== false);

    return activeCustomers.find(customer => {
        const customerNotas = freightNotas.filter(nota => normalizeText(nota.customerRef) === customer._id);
        return !summarizeCustomerCreditUsage(customer, customerNotas).isBlocked;
    }) || activeCustomers.find(customer => !customer.creditLimitAmount) || activeCustomers[0];
}

async function provisionAuditResources(service: ServiceLike, suffix: string): Promise<ProvisionedAuditResources> {
    const now = new Date().toISOString();
    const serviceName = normalizeText(service.name) || 'Audit Service';
    const indexes = Array.from({ length: REQUIRED_AUDIT_TRIP_RESOURCES }, (_, index) => index + 1);
    const drivers: Driver[] = indexes.map(index => ({
        _id: `drv-audit-e2e-${suffix}-${index}`,
        _type: 'driver',
        name: `Audit E2E Driver ${index}`,
        phone: `08129000${suffix.slice(-4)}${index}`,
        licenseNumber: `SIM-AUD-${suffix}-${index}`,
        ktpNumber: `KTP-AUD-${suffix}-${index}`,
        simExpiry: '2027-12-31',
        address: 'Audit temporary resource',
        active: true,
    }) as Driver);
    const vehicles: Vehicle[] = indexes.map(index => ({
        _id: `veh-audit-e2e-${suffix}-${index}`,
        _type: 'vehicle',
        unitCode: `AUD-${suffix}-${index}`,
        plateNumber: `AUD ${suffix.slice(-4)} E${index}`,
        vehicleType: serviceName,
        brandModel: 'Audit temporary unit',
        year: 2026,
        capacityKg: 4500,
        serviceRef: service._id,
        serviceName,
        status: 'ACTIVE',
    }) as Vehicle);

    await Promise.all([
        upsertRows('drivers', drivers.map(driver => ({
            source_document_id: driver._id,
            document_created_at: now,
            document_updated_at: now,
            name: driver.name,
            phone: driver.phone,
            license_number: driver.licenseNumber,
            ktp_number: driver.ktpNumber,
            sim_expiry: driver.simExpiry,
            address: driver.address,
            active: true,
            extra_data: { audit: 'order-to-nota-e2e' },
        }))),
        upsertRows('vehicles', vehicles.map(vehicle => ({
            source_document_id: vehicle._id,
            document_created_at: now,
            document_updated_at: now,
            unit_code: vehicle.unitCode,
            plate_number: vehicle.plateNumber,
            vehicle_type: vehicle.vehicleType,
            brand_model: vehicle.brandModel,
            year: vehicle.year,
            capacity_kg: vehicle.capacityKg,
            service_ref: vehicle.serviceRef,
            status: vehicle.status,
            extra_data: { audit: 'order-to-nota-e2e', serviceName },
        }))),
    ]);

    return { drivers, vehicles };
}

async function getDeliveryOrderItems(cookieHeader: string, deliveryOrderId: string) {
    const response = await requestJson<{ data: DeliveryOrderItem[] }>(
        `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderId }))}`,
        cookieHeader
    );
    return Array.isArray(response.data) ? response.data : [];
}

async function getSuratJalanDocuments(cookieHeader: string, deliveryOrderId: string) {
    const response = await requestJson<{ data: SuratJalanDocument[] }>(
        `/api/data?entity=surat-jalan&filter=${encodeURIComponent(JSON.stringify({ tripRef: deliveryOrderId }))}&pageSize=50`,
        cookieHeader
    );
    return Array.isArray(response.data) ? response.data : [];
}

async function advanceDeliveryOrderToDelivered(params: {
    cookieHeader: string;
    deliveryOrderId: string;
    actualItems: Array<Record<string, unknown>>;
    actualDropPoints: Array<Record<string, unknown>>;
}) {
    for (const status of ['ON_DELIVERY', 'ARRIVED']) {
        await postData(params.cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-status',
            data: {
                id: params.deliveryOrderId,
                status,
                note: `Audit ${status}`,
            },
        });
    }

    await postData(params.cookieHeader, {
        entity: 'delivery-orders',
        action: 'set-status',
        data: {
            id: params.deliveryOrderId,
            status: 'DELIVERED',
            note: 'Audit selesai',
            podReceiverName: 'Penerima Audit',
            podReceivedDate: AUDIT_DATE,
            podNote: 'Audit POD',
            actualItems: params.actualItems,
            actualDropPoints: params.actualDropPoints,
        },
    });
}

async function advanceDeliveryOrderToArrived(cookieHeader: string, deliveryOrderId: string) {
    for (const status of ['ON_DELIVERY', 'ARRIVED']) {
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-status',
            data: {
                id: deliveryOrderId,
                status,
                note: `Audit ${status}`,
            },
        });
    }
}

async function finishArrivedDeliveryOrder(params: {
    cookieHeader: string;
    deliveryOrderId: string;
    actualItems: Array<Record<string, unknown>>;
    actualDropPoints: Array<Record<string, unknown>>;
    expectStatus?: number;
}) {
    return await postData(params.cookieHeader, {
        entity: 'delivery-orders',
        action: 'set-status',
        data: {
            id: params.deliveryOrderId,
            status: 'DELIVERED',
            note: 'Audit selesai',
            podReceiverName: 'Penerima Audit',
            podReceivedDate: AUDIT_DATE,
            podNote: 'Audit POD',
            actualItems: params.actualItems,
            actualDropPoints: params.actualDropPoints,
        },
    }, params.expectStatus ? { expectStatus: params.expectStatus } : undefined);
}

async function main() {
    const cookieHeader = await loginAndGetCookieHeader();
    const createdState: CreatedState = { deliveryOrderIds: [], auditDriverIds: [], auditVehicleIds: [] };
    const suffix = Date.now().toString().slice(-6);
    const pickupOneKey = `audit-pickup-1-${suffix}`;
    const pickupTwoKey = `audit-pickup-2-${suffix}`;
    const tripOneKey = `audit-trip-1-${suffix}`;
    const tripTwoKey = `audit-trip-2-${suffix}`;
    const tripSplitKey = `audit-trip-split-${suffix}`;
    const tripOverKey = `audit-trip-over-${suffix}`;
    const tripCancelKey = `audit-trip-cancel-${suffix}`;
    const sjA = `AUD-${suffix}-A`;
    const sjB = `AUD-${suffix}-B`;
    const sjSplit = `AUD-${suffix}-SPLIT`;
    const sjOver = `AUD-${suffix}-OVER`;
    const sjAfterDelivered = `AUD-${suffix}-AFTER-DELIVERED`;
    const sjHold = `AUD-${suffix}-HOLD`;
    const sjCancel = `AUD-${suffix}-CANCEL`;

    try {
        auditStep('cleanup data audit lama');
        await cleanupStaleAuditOrders();
        auditStep('ambil master data dan DO aktif');
        const [customerResponse, serviceResponse, vehicleResponse, driverResponse, bankResponse, orderResponse, deliveryOrderResponse, freightNotaResponse] = await Promise.all([
            requestJson<{ data: CustomerLike[] }>('/api/data?entity=customers', cookieHeader),
            requestJson<{ data: ServiceLike[] }>('/api/data?entity=services', cookieHeader),
            requestJson<{ data: Vehicle[] }>('/api/data?entity=vehicles', cookieHeader),
            requestJson<{ data: Driver[] }>('/api/data?entity=drivers', cookieHeader),
            requestJson<{ data: BankAccountLike[] }>('/api/data?entity=bank-accounts', cookieHeader),
            requestJson<{ data: Order[] }>('/api/data?entity=orders&pageSize=1000', cookieHeader),
            requestJson<{ data: DeliveryOrder[] }>('/api/data?entity=delivery-orders&pageSize=1000', cookieHeader),
            requestJson<{ data: FreightNota[] }>('/api/data?entity=freight-notas&pageSize=1000', cookieHeader),
        ]);
        const fallbackService = (serviceResponse.data || []).find(item => item.active !== false);
        assert(fallbackService, 'Audit butuh minimal 1 kategori armada aktif untuk membuat resource sementara.');
        auditStep('provision resource audit sementara agar E2E tidak memakai driver/kendaraan produksi yang mungkin terkunci');
        const provisioned = await provisionAuditResources(fallbackService, suffix);
        createdState.auditDriverIds = provisioned.drivers.map(driver => driver._id);
        createdState.auditVehicleIds = provisioned.vehicles.map(vehicle => vehicle._id);

        let resources = pickAuditResources({
            customers: customerResponse.data || [],
            services: serviceResponse.data || [],
            vehicles: [...provisioned.vehicles, ...(vehicleResponse.data || [])],
            drivers: [...provisioned.drivers, ...(driverResponse.data || [])],
            bankAccounts: bankResponse.data || [],
            orders: orderResponse.data || [],
            deliveryOrders: deliveryOrderResponse.data || [],
            freightNotas: freightNotaResponse.data || [],
        });

        if (!resources.service || resources.vehicles.length < REQUIRED_AUDIT_TRIP_RESOURCES || resources.drivers.length < REQUIRED_AUDIT_TRIP_RESOURCES) {
            const secondaryFallbackService = resources.service || fallbackService;
            if (secondaryFallbackService) {
                auditStep('provision resource audit sementara karena driver/kendaraan aktif sedang penuh');
                const extraProvisioned = await provisionAuditResources(secondaryFallbackService, `${suffix}-extra`);
                createdState.auditDriverIds = [...(createdState.auditDriverIds || []), ...extraProvisioned.drivers.map(driver => driver._id)];
                createdState.auditVehicleIds = [...(createdState.auditVehicleIds || []), ...extraProvisioned.vehicles.map(vehicle => vehicle._id)];
                resources = pickAuditResources({
                    customers: customerResponse.data || [],
                    services: serviceResponse.data || [],
                    vehicles: [...extraProvisioned.vehicles, ...provisioned.vehicles, ...(vehicleResponse.data || [])],
                    drivers: [...extraProvisioned.drivers, ...provisioned.drivers, ...(driverResponse.data || [])],
                    bankAccounts: bankResponse.data || [],
                    orders: orderResponse.data || [],
                    deliveryOrders: deliveryOrderResponse.data || [],
                    freightNotas: freightNotaResponse.data || [],
                });
            }
        }

        assert(resources.customer, 'Audit butuh minimal 1 customer aktif.');
        assert(resources.service, 'Audit butuh minimal 1 kategori armada dengan kendaraan tersedia.');
        assert(resources.vehicles.length >= REQUIRED_AUDIT_TRIP_RESOURCES, `Audit butuh minimal ${REQUIRED_AUDIT_TRIP_RESOURCES} kendaraan tersedia pada kategori armada yang sama.`);
        assert(resources.drivers.length >= REQUIRED_AUDIT_TRIP_RESOURCES, `Audit butuh minimal ${REQUIRED_AUDIT_TRIP_RESOURCES} supir tersedia untuk skenario multi-trip.`);
        assert(resources.bankAccount, 'Audit butuh minimal 1 rekening/kas aktif.');

        auditStep('create lalu hapus order header booking tanpa DO');
        const deletableOrderCreate = await postData<Order>(cookieHeader, {
            entity: 'orders',
            action: 'create-with-items',
            data: {
                customerRef: resources.customer._id,
                serviceRef: resources.service._id,
                pickupAddress: 'Audit Delete Pickup',
                receiverName: 'Audit Delete Receiver',
                receiverAddress: 'Audit Delete Destination',
                pickupStops: [
                    {
                        _key: `audit-delete-pickup-${suffix}`,
                        sequence: 1,
                        pickupLabel: 'Audit Delete Pickup',
                        pickupAddress: 'Audit Delete Pickup Address',
                    },
                ],
                notes: `Audit E2E delete ${suffix}`,
                items: [],
                tripDrafts: [],
            },
        });
        const deletableOrderId = normalizeText(deletableOrderCreate.data?._id) || normalizeText(deletableOrderCreate.id);
        assert(deletableOrderId, 'Create order delete-test tidak mengembalikan ID.');
        await postData(cookieHeader, {
            entity: 'orders',
            action: 'delete',
            data: {
                id: deletableOrderId,
            },
        });

        auditStep('create order header booking dengan 2 pickup, 2 trip jalan, dan 1 trip batal');
        const orderCreate = await postData<Order>(cookieHeader, {
            entity: 'orders',
            action: 'create-with-items',
            data: {
                customerRef: resources.customer._id,
                serviceRef: resources.service._id,
                pickupAddress: 'Audit Pickup Utama',
                pickupStops: [
                    {
                        _key: pickupOneKey,
                        sequence: 1,
                        pickupLabel: 'Audit Pickup 1',
                        pickupAddress: 'Audit Pickup 1 Address',
                    },
                    {
                        _key: pickupTwoKey,
                        sequence: 2,
                        pickupLabel: 'Audit Pickup 2',
                        pickupAddress: 'Audit Pickup 2 Address',
                    },
                ],
                notes: `Audit E2E ${suffix}`,
                items: [],
                tripDrafts: [
                    {
                        _key: tripOneKey,
                        pickupStopKeys: [pickupOneKey],
                        vehicleRef: resources.vehicles[0]._id,
                        driverRef: resources.drivers[0]._id,
                        taripBorongan: 250000,
                        issueBankRef: resources.bankAccount._id,
                        cashGiven: 100000,
                        date: AUDIT_DATE,
                    },
                    {
                        _key: tripTwoKey,
                        pickupStopKeys: [pickupTwoKey],
                        vehicleRef: resources.vehicles[1]._id,
                        driverRef: resources.drivers[1]._id,
                        taripBorongan: 275000,
                        issueBankRef: resources.bankAccount._id,
                        cashGiven: 120000,
                        date: AUDIT_DATE,
                    },
                    {
                        _key: tripSplitKey,
                        pickupStopKeys: [pickupTwoKey],
                        vehicleRef: resources.vehicles[2]._id,
                        driverRef: resources.drivers[2]._id,
                        taripBorongan: 285000,
                        issueBankRef: resources.bankAccount._id,
                        cashGiven: 130000,
                        date: AUDIT_DATE,
                    },
                    {
                        _key: tripOverKey,
                        pickupStopKeys: [pickupTwoKey],
                        vehicleRef: resources.vehicles[3]._id,
                        driverRef: resources.drivers[3]._id,
                        taripBorongan: 295000,
                        issueBankRef: resources.bankAccount._id,
                        cashGiven: 140000,
                        date: AUDIT_DATE,
                    },
                    {
                        _key: tripCancelKey,
                        pickupStopKeys: [pickupTwoKey],
                        vehicleRef: resources.vehicles[4]._id,
                        driverRef: resources.drivers[4]._id,
                        taripBorongan: 125000,
                        issueBankRef: resources.bankAccount._id,
                        cashGiven: 50000,
                        date: AUDIT_DATE,
                    },
                ],
            },
        });
        createdState.orderId = normalizeText(orderCreate.data?._id) || normalizeText(orderCreate.id);
        assert(createdState.orderId, 'Create order tidak mengembalikan ID.');

        const createdOrder = await requestJson<{ data: Order }>(
            `/api/data?entity=orders&id=${encodeURIComponent(createdState.orderId)}`,
            cookieHeader
        );
        assert(createdOrder.data.cargoEntryMode === 'DELIVERY_ORDER', 'Order header booking harus memakai mode barang di Surat Jalan.');
        assert((createdOrder.data.tripPlans || []).length === 5, 'Order harus menyimpan 5 rencana trip termasuk split drop/hold, over aktual, dan 1 trip batal.');

        auditStep('create DO trip 1 dengan 2 nomor SJ; SJ A berisi 2 barang dan SJ B hold');
        const doOneCreate = await postData<DeliveryOrder>(cookieHeader, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: createdState.orderId,
                orderTripPlanKey: tripOneKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjA, pickupStopKey: pickupOneKey },
                    { referenceNumber: sjB, pickupStopKey: pickupOneKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit barang A1',
                        qtyKoli: 2,
                        weightInputValue: 200,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupOneKey,
                        shipperReferenceNumber: sjA,
                    },
                    {
                        description: 'Audit barang A2',
                        qtyKoli: 1,
                        weightInputValue: 125,
                        weightInputUnit: 'KG',
                        volumeInputValue: 0.5,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupOneKey,
                        shipperReferenceNumber: sjA,
                    },
                    {
                        description: 'Audit barang B',
                        qtyKoli: 3,
                        weightInputValue: 300,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1.5,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupOneKey,
                        shipperReferenceNumber: sjB,
                    },
                ],
            },
        });
        const doOneId = normalizeText(doOneCreate.data?._id) || normalizeText(doOneCreate.id);
        assert(doOneId, 'Create DO trip 1 tidak mengembalikan ID.');
        createdState.deliveryOrderIds.push(doOneId);

        let doOneItems = await getDeliveryOrderItems(cookieHeader, doOneId);
        assert(doOneItems.length === 3, 'DO trip 1 harus punya 3 barang karena SJ A berisi 2 barang dan SJ B berisi 1 barang.');
        assert(
            doOneItems.some(item => item.shipperReferenceNumber === sjA) &&
            doOneItems.some(item => item.shipperReferenceNumber === sjB),
            'Barang DO trip 1 harus tersambung ke masing-masing nomor SJ pengirim.'
        );
        assert(
            doOneItems.filter(item => item.shipperReferenceNumber === sjA).length === 2,
            'SJ A harus bisa memuat lebih dari 1 barang.'
        );
        assert(
            doOneItems.every(item => normalizeText(item.pickupStopKey)),
            'Barang DO trip 1 harus menyimpan pickupStopKey.'
        );

        doOneItems = await getDeliveryOrderItems(cookieHeader, doOneId);
        const actualItemsForDoOne = doOneItems.map(item => ({
            deliveryOrderItemRef: item._id,
            actualQtyKoli: normalizeNumber(item.orderItemQtyKoli),
            actualWeightInputValue: normalizeNumber(item.orderItemWeight),
            actualWeightInputUnit: 'KG',
            actualVolumeInputValue: normalizeNumber(item.orderItemVolumeInputValue ?? item.orderItemVolumeM3),
            actualVolumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
        }));
        const sjAItems = doOneItems.filter(item => item.shipperReferenceNumber === sjA);
        const sjBItems = doOneItems.filter(item => item.shipperReferenceNumber === sjB);
        assert(sjAItems.length === 2 && sjBItems.length === 1, 'Setup audit SJ A/SJ B tidak valid.');

        auditStep('uji finalisasi ambigu: 1 SJ punya drop dan hold tanpa mapping barang harus ditolak');
        await advanceDeliveryOrderToArrived(cookieHeader, doOneId);
        await finishArrivedDeliveryOrder({
            cookieHeader,
            deliveryOrderId: doOneId,
            actualItems: actualItemsForDoOne,
            actualDropPoints: [
                {
                    stopType: 'DROP',
                    shipperReferenceNumber: sjA,
                    locationName: 'Audit Drop A Ambigu',
                    locationAddress: 'Audit Drop A Ambigu Address',
                    qtyKoli: 2,
                    weightInputValue: 200,
                    weightInputUnit: 'KG',
                    volumeInputValue: 1,
                    volumeInputUnit: 'M3',
                },
                {
                    stopType: 'HOLD',
                    shipperReferenceNumber: sjA,
                    locationName: 'Audit Hold A Ambigu',
                    locationAddress: 'Audit Hold A Ambigu Address',
                    qtyKoli: 1,
                    weightInputValue: 125,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0.5,
                    volumeInputUnit: 'M3',
                },
            ],
            expectStatus: 400,
        });

        auditStep('finalisasi DO trip 1 dengan mapping barang spesifik: 2 barang SJ A billable, SJ B hold');
        await finishArrivedDeliveryOrder({
            cookieHeader,
            deliveryOrderId: doOneId,
            actualItems: actualItemsForDoOne,
            actualDropPoints: [
                {
                    stopType: 'DROP',
                    deliveryOrderItemRef: sjAItems[0]._id,
                    deliveryOrderItemRefs: [sjAItems[0]._id],
                    shipperReferenceNumber: sjA,
                    locationName: 'Audit Drop A',
                    locationAddress: 'Audit Drop A Address',
                    qtyKoli: normalizeNumber(sjAItems[0].orderItemQtyKoli),
                    weightInputValue: normalizeNumber(sjAItems[0].orderItemWeight),
                    weightInputUnit: 'KG',
                    volumeInputValue: normalizeNumber(sjAItems[0].orderItemVolumeInputValue ?? sjAItems[0].orderItemVolumeM3),
                    volumeInputUnit: sjAItems[0].orderItemVolumeInputUnit || 'M3',
                },
                {
                    stopType: 'DROP',
                    deliveryOrderItemRef: sjAItems[1]._id,
                    deliveryOrderItemRefs: [sjAItems[1]._id],
                    shipperReferenceNumber: sjA,
                    locationName: 'Audit Drop A',
                    locationAddress: 'Audit Drop A Address',
                    qtyKoli: normalizeNumber(sjAItems[1].orderItemQtyKoli),
                    weightInputValue: normalizeNumber(sjAItems[1].orderItemWeight),
                    weightInputUnit: 'KG',
                    volumeInputValue: normalizeNumber(sjAItems[1].orderItemVolumeInputValue ?? sjAItems[1].orderItemVolumeM3),
                    volumeInputUnit: sjAItems[1].orderItemVolumeInputUnit || 'M3',
                },
                {
                    stopType: 'HOLD',
                    deliveryOrderItemRef: sjBItems[0]._id,
                    deliveryOrderItemRefs: [sjBItems[0]._id],
                    shipperReferenceNumber: sjB,
                    locationName: 'Audit Gudang Hold B',
                    locationAddress: 'Audit Gudang Hold B Address',
                    qtyKoli: normalizeNumber(sjBItems[0].orderItemQtyKoli),
                    weightInputValue: normalizeNumber(sjBItems[0].orderItemWeight),
                    weightInputUnit: 'KG',
                    volumeInputValue: normalizeNumber(sjBItems[0].orderItemVolumeInputValue ?? sjBItems[0].orderItemVolumeM3),
                    volumeInputUnit: sjBItems[0].orderItemVolumeInputUnit || 'M3',
                },
            ],
        });

        const doOneDocsAfterDelivered = await getSuratJalanDocuments(cookieHeader, doOneId);
        const sjADocumentAfterDelivered = doOneDocsAfterDelivered.find(document => document.suratJalanNumber === sjA);
        assert(sjADocumentAfterDelivered?._id, 'Dokumen SJ A harus tersedia setelah finalisasi DO trip 1.');
        const sjAActualEditPayload = {
            id: doOneId,
            suratJalanRef: sjADocumentAfterDelivered._id,
            actualItems: sjAItems.map(item => ({
                deliveryOrderItemRef: item._id,
                actualQtyKoli: normalizeNumber(item.orderItemQtyKoli),
                actualWeightInputValue: normalizeNumber(item.orderItemWeight),
                actualWeightInputUnit: 'KG',
                actualVolumeInputValue: normalizeNumber(item.orderItemVolumeInputValue ?? item.orderItemVolumeM3),
                actualVolumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
            })),
        };

        auditStep('pastikan aktual SJ delivered masih boleh diedit sebelum masuk invoice');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-surat-jalan-actual-cargo',
            data: sjAActualEditPayload,
        });

        auditStep('pastikan order yang sudah punya DO tidak boleh dihapus');
        await postData(cookieHeader, {
            entity: 'orders',
            action: 'delete',
            data: {
                id: createdState.orderId,
            },
        }, { expectStatus: 409 });

        auditStep('create DO trip batal lalu batalkan lewat action cancel-trip saat aktif');
        const doCancelCreate = await postData<DeliveryOrder>(cookieHeader, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: createdState.orderId,
                orderTripPlanKey: tripCancelKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjCancel, pickupStopKey: pickupTwoKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit barang batal',
                        qtyKoli: 1,
                        weightInputValue: 75,
                        weightInputUnit: 'KG',
                        pickupStopKey: pickupTwoKey,
                        shipperReferenceNumber: sjCancel,
                    },
                ],
            },
        });
        const doCancelId = normalizeText(doCancelCreate.data?._id) || normalizeText(doCancelCreate.id);
        assert(doCancelId, 'Create DO batal tidak mengembalikan ID.');
        createdState.deliveryOrderIds.push(doCancelId);
        const doCancelItems = await getDeliveryOrderItems(cookieHeader, doCancelId);
        assert(doCancelItems.length === 1, 'DO batal harus punya 1 barang sebelum dibatalkan.');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-status',
            data: {
                id: doCancelId,
                status: 'ON_DELIVERY',
                note: 'Audit dalam pengiriman sebelum batal',
            },
        });
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'cancel-trip',
            data: {
                id: doCancelId,
                note: 'Audit batal trip',
            },
        });
        const cancelledDoState = await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(doCancelId)}`,
            cookieHeader
        );
        assert(cancelledDoState.data.status === 'CANCELLED', 'DO batal harus berstatus CANCELLED.');
        assert(cancelledDoState.data.trackingState === 'STOPPED', 'DO batal harus menghentikan tracking.');
        auditStep('pastikan edit aktual SJ ditolak untuk trip batal');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-surat-jalan-actual-cargo',
            data: {
                id: doCancelId,
                suratJalanRef: `${doCancelId}:cancelled-actual-edit-test`,
                actualItems: [],
            },
        }, { expectStatus: 409 });
        const cancelledOrderItemResponse = await requestJson<{ data: Array<{ _id: string; status?: string; assignedQtyKoli?: number; assignedWeight?: number }> }>(
            `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ sourceDeliveryOrderRef: doCancelId }))}`,
            cookieHeader
        );
        const cancelledOrderItem = cancelledOrderItemResponse.data?.[0];
        assert(cancelledOrderItem, 'Order item DO batal harus tetap ada sebagai pending untuk dibuat SJ ulang bila perlu.');
        assert(normalizeNumber(cancelledOrderItem.assignedQtyKoli) === 0, 'DO batal harus melepas assigned qty.');
        assert(normalizeNumber(cancelledOrderItem.assignedWeight) === 0, 'DO batal harus melepas assigned weight.');
        assert(cancelledOrderItem.status !== 'ON_DELIVERY', 'Item DO batal tidak boleh tetap berstatus ON_DELIVERY.');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'append-cargo-items',
            data: {
                id: doCancelId,
                cargoItems: [
                    {
                        description: 'Barang setelah batal',
                        qtyKoli: 1,
                        weightInputValue: 10,
                        weightInputUnit: 'KG',
                        shipperReferenceNumber: sjCancel,
                    },
                ],
            },
        }, { expectStatus: 409 });
        await postData(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                issueDate: AUDIT_DATE,
                dueDate: AUDIT_DATE,
                billingMode: 'PER_KG',
                items: [
                    {
                        doRef: doCancelId,
                        deliveryOrderItemRef: doCancelItems[0]._id,
                        noSJ: sjCancel,
                        tarip: 1000,
                    },
                ],
            },
        }, { expectStatus: 409 });

        auditStep('create DO trip 2 setelah trip 1 selesai untuk skenario hold');
        const doTwoCreate = await postData<DeliveryOrder>(cookieHeader, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: createdState.orderId,
                orderTripPlanKey: tripTwoKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjHold, pickupStopKey: pickupTwoKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit barang hold final',
                        qtyKoli: 4,
                        weightInputValue: 400,
                        weightInputUnit: 'KG',
                        pickupStopKey: pickupTwoKey,
                        shipperReferenceNumber: sjHold,
                    },
                ],
            },
        });
        const doTwoId = normalizeText(doTwoCreate.data?._id) || normalizeText(doTwoCreate.id);
        assert(doTwoId, 'Create DO trip 2 tidak mengembalikan ID.');
        createdState.deliveryOrderIds.push(doTwoId);

        auditStep('uji append barang DO trip 2');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'append-cargo-items',
            data: {
                id: doTwoId,
                cargoItems: [
                    {
                        description: 'Audit barang sementara',
                        qtyKoli: 1,
                        weightInputValue: 50,
                        weightInputUnit: 'KG',
                        shipperReferenceNumber: sjHold,
                    },
                ],
            },
        });
        let doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        const temporaryItem = doTwoItems.find(item => item.orderItemDescription === 'Audit barang sementara');
        assert(temporaryItem, 'Append barang ke DO trip 2 tidak tersimpan.');
        assert(temporaryItem.shipperReferenceNumber === sjHold, 'Append barang harus tetap tersambung ke SJ hold.');

        auditStep('uji edit barang DO trip 2');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-cargo-item',
            data: {
                id: doTwoId,
                deliveryOrderItemId: temporaryItem._id,
                cargoItem: {
                    description: 'Audit barang sementara revisi',
                    qtyKoli: 1,
                    weightInputValue: 60,
                    weightInputUnit: 'KG',
                    shipperReferenceNumber: sjHold,
                },
            },
        });
        doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        const revisedTemporaryItem = doTwoItems.find(item => item._id === temporaryItem._id);
        assert(revisedTemporaryItem?.orderItemDescription === 'Audit barang sementara revisi', 'Edit barang DO trip 2 tidak tersimpan.');
        assert(revisedTemporaryItem.shipperReferenceNumber === sjHold, 'Edit barang DO trip 2 tidak boleh melepas nomor SJ.');

        auditStep('uji hapus barang DO trip 2');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'remove-cargo-item',
            data: {
                id: doTwoId,
                deliveryOrderItemId: temporaryItem._id,
            },
        });
        doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        assert(!doTwoItems.some(item => item._id === temporaryItem._id), 'Hapus barang DO trip 2 tidak menghapus item.');
        assert(doTwoItems.length === 1, 'DO trip 2 harus tersisa 1 barang untuk realisasi hold.');
        assert(doTwoItems[0].shipperReferenceNumber === sjHold, 'Barang sisa DO trip 2 harus tetap tersambung ke SJ hold.');

        auditStep('uji hapus nomor SJ harus membersihkan dokumen surat jalan stale');
        const sjRemoved = `AUD-${suffix}-REMOVED`;
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-shipper-reference',
            data: {
                id: doTwoId,
                shipperReferences: [
                    { referenceNumber: sjHold, pickupStopKey: pickupTwoKey },
                    { referenceNumber: sjRemoved, pickupStopKey: pickupTwoKey },
                ],
            },
        });
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'append-cargo-items',
            data: {
                id: doTwoId,
                cargoItems: [
                    {
                        description: 'Audit barang SJ dihapus',
                        qtyKoli: 1,
                        weightInputValue: 25,
                        weightInputUnit: 'KG',
                        shipperReferenceNumber: sjRemoved,
                    },
                ],
            },
        });
        const docsAfterAddRemovedSj = await getSuratJalanDocuments(cookieHeader, doTwoId);
        assert(
            docsAfterAddRemovedSj.some(document => document.suratJalanNumber === sjRemoved),
            'Setup audit harus membuat dokumen SJ tambahan sebelum dihapus.'
        );
        doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        const removedSjItem = doTwoItems.find(item => item.shipperReferenceNumber === sjRemoved);
        assert(removedSjItem, 'Item untuk SJ yang akan dihapus harus ditemukan.');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'remove-cargo-item',
            data: {
                id: doTwoId,
                deliveryOrderItemId: removedSjItem._id,
            },
        });
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-shipper-reference',
            data: {
                id: doTwoId,
                shipperReferences: [
                    { referenceNumber: sjHold, pickupStopKey: pickupTwoKey },
                ],
            },
        });
        doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        const docsAfterDeleteRemovedSj = await getSuratJalanDocuments(cookieHeader, doTwoId);
        assert(
            !docsAfterDeleteRemovedSj.some(document => document.suratJalanNumber === sjRemoved),
            'SJ yang sudah dihapus tidak boleh tetap muncul di dokumen/status batch.'
        );
        assert(
            docsAfterDeleteRemovedSj.every(document => document.suratJalanNumber !== sjRemoved) &&
            doTwoItems.every(item => item.shipperReferenceNumber !== sjRemoved),
            'Hapus SJ harus membersihkan dokumen dan item yang terkait nomor SJ lama.'
        );

        auditStep('finalisasi DO trip 2 sebagai hold non-billable');
        await advanceDeliveryOrderToDelivered({
            cookieHeader,
            deliveryOrderId: doTwoId,
            actualItems: doTwoItems.map(item => ({
                deliveryOrderItemRef: item._id,
                actualQtyKoli: normalizeNumber(item.orderItemQtyKoli),
                actualWeightInputValue: normalizeNumber(item.orderItemWeight),
                actualWeightInputUnit: 'KG',
            })),
            actualDropPoints: [
                {
                    stopType: 'HOLD',
                    shipperReferenceNumber: sjHold,
                    locationName: 'Audit Gudang Hold',
                    locationAddress: 'Audit Gudang Hold Address',
                    qtyKoli: 4,
                    weightInputValue: 400,
                    weightInputUnit: 'KG',
                },
            ],
        });

        auditStep('create DO trip 3 untuk satu item yang split drop dan hold dalam SJ yang sama');
        const doSplitCreate = await postData<DeliveryOrder>(cookieHeader, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: createdState.orderId,
                orderTripPlanKey: tripSplitKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjSplit, pickupStopKey: pickupTwoKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit barang split drop hold',
                        qtyKoli: 3,
                        weightInputValue: 180,
                        weightInputUnit: 'KG',
                        volumeInputValue: 3,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupTwoKey,
                        shipperReferenceNumber: sjSplit,
                    },
                ],
            },
        });
        const doSplitId = normalizeText(doSplitCreate.data?._id) || normalizeText(doSplitCreate.id);
        assert(doSplitId, 'Create DO split drop/hold tidak mengembalikan ID.');
        createdState.deliveryOrderIds.push(doSplitId);
        const doSplitItems = await getDeliveryOrderItems(cookieHeader, doSplitId);
        const splitItem = doSplitItems[0];
        assert(doSplitItems.length === 1 && splitItem, 'DO split harus punya tepat 1 barang.');
        const splitDocsBeforeInitial = await getSuratJalanDocuments(cookieHeader, doSplitId);
        const splitDocBeforeInitial = splitDocsBeforeInitial.find(document => document.suratJalanNumber === sjSplit);
        const splitSuratJalanRef = splitDocBeforeInitial?._id || `${doSplitId}:${sjSplit}`;
        for (const status of ['ON_DELIVERY', 'ARRIVED']) {
            await postData(cookieHeader, {
                entity: 'delivery-orders',
                action: 'set-surat-jalan-status-batch',
                data: {
                    id: doSplitId,
                    status,
                    targetSuratJalanRefs: [splitSuratJalanRef],
                    note: `Audit batch split ${status}`,
                },
            });
        }
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-surat-jalan-status-batch',
            data: {
                id: doSplitId,
                status: 'DELIVERED',
                targetSuratJalanRefs: [splitSuratJalanRef],
                note: 'Audit batch split drop hold',
                podReceiverName: 'Penerima Audit Batch Split',
                podReceivedDate: AUDIT_DATE,
                podNote: 'Audit POD Batch Split',
                actualItems: [
                    {
                        deliveryOrderItemRef: splitItem._id,
                        actualQtyKoli: 1,
                        actualWeightInputValue: 70,
                        actualWeightInputUnit: 'KG',
                        actualVolumeInputValue: 1,
                        actualVolumeInputUnit: 'M3',
                    },
                ],
                actualDropPoints: [
                    {
                        stopType: 'DROP',
                        deliveryOrderItemRef: splitItem._id,
                        deliveryOrderItemRefs: [splitItem._id],
                        shipperReferenceNumber: sjSplit,
                        locationName: 'Audit Drop Split',
                        locationAddress: 'Audit Drop Split Address',
                        qtyKoli: 1,
                        weightInputValue: 70,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1,
                        volumeInputUnit: 'M3',
                    },
                    {
                        stopType: 'HOLD',
                        deliveryOrderItemRef: splitItem._id,
                        deliveryOrderItemRefs: [splitItem._id],
                        shipperReferenceNumber: sjSplit,
                        locationName: 'Audit Hold Split',
                        locationAddress: 'Audit Hold Split Address',
                        qtyKoli: 2,
                        weightInputValue: 120,
                        weightInputUnit: 'KG',
                        volumeInputValue: 2,
                        volumeInputUnit: 'M3',
                    },
                ],
            },
        });
        const finalizedSplitItems = await getDeliveryOrderItems(cookieHeader, doSplitId);
        assert(
            normalizeNumber(finalizedSplitItems[0]?.actualQtyKoli) === 1 &&
            normalizeNumber(finalizedSplitItems[0]?.actualWeightKg) === 70 &&
            normalizeNumber(finalizedSplitItems[0]?.heldQtyKoli) === 2 &&
            normalizeNumber(finalizedSplitItems[0]?.heldWeight) === 120,
            'Batch split drop/hold satu item harus menyimpan aktual terkirim 1 koli / 70 kg dan hold 2 koli / 120 kg secara terpisah.'
        );
        const splitOrderItemResponse = await requestJson<{ data: Array<{ _id: string; qtyKoli?: number; weight?: number; deliveredQtyKoli?: number; deliveredWeight?: number; heldQtyKoli?: number; heldWeight?: number }> }>(
            `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ sourceDeliveryOrderRef: doSplitId }))}`,
            cookieHeader
        );
        const splitOrderItem = splitOrderItemResponse.data?.[0];
        assert(
            normalizeNumber(splitOrderItem?.qtyKoli) === 3 &&
            normalizeNumber(splitOrderItem?.weight) === 190 &&
            normalizeNumber(splitOrderItem?.deliveredQtyKoli) === 1 &&
            normalizeNumber(splitOrderItem?.deliveredWeight) === 70 &&
            normalizeNumber(splitOrderItem?.heldQtyKoli) === 2 &&
            normalizeNumber(splitOrderItem?.heldWeight) === 120,
            'Order item split tidak boleh menghitung hold sebagai sisa berat aktual DROP; progress harus 1/70 terkirim + 2/120 hold dari total 3/190.'
        );
        const doSplitState = await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(doSplitId)}`,
            cookieHeader
        );
        const splitNotaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder: doSplitState.data,
            orders: [createdOrder.data],
            deliveryOrderItems: finalizedSplitItems,
        });
        assert(splitNotaRows.length === 1, `Split drop/hold harus menghasilkan 1 row nota billable, sekarang ${splitNotaRows.length}.`);
        assert(
            splitNotaRows[0].noSJ === sjSplit &&
            splitNotaRows[0].collie === 1 &&
            splitNotaRows[0].beratKg === 70 &&
            splitNotaRows[0].volumeM3 === 1,
            'Nota split drop/hold harus hanya memakai porsi DROP billable: 1 koli / 70 kg / 1 m3.'
        );
        const splitDocsAfterInitial = await getSuratJalanDocuments(cookieHeader, doSplitId);
        const splitDocAfterInitial = splitDocsAfterInitial.find(document => document.suratJalanNumber === sjSplit);
        assert(splitDocAfterInitial?.tripStatus === 'PARTIAL_HOLD', `SJ split harus PARTIAL_HOLD setelah 1 koli drop + 2 koli hold, sekarang ${splitDocAfterInitial?.tripStatus}.`);
        assert(
            normalizeNumber(splitDocAfterInitial.holdCargo?.qtyKoli) === 2 &&
            normalizeNumber(splitDocAfterInitial.holdCargo?.weightKg) === 120,
            'SJ split harus menyimpan sisa hold 2 koli / 120 kg.'
        );

        auditStep('finalisasi lanjutan sisa hold pada SJ split harus melepas hold dan menambah billable');
        for (const status of ['ON_DELIVERY', 'ARRIVED']) {
            await postData(cookieHeader, {
                entity: 'delivery-orders',
                action: 'set-surat-jalan-status-batch',
                data: {
                    id: doSplitId,
                    status,
                    targetSuratJalanRefs: [splitDocAfterInitial._id],
                    note: `Audit lanjut hold ${status}`,
                },
            });
        }
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-surat-jalan-status-batch',
            data: {
                id: doSplitId,
                status: 'DELIVERED',
                targetSuratJalanRefs: [splitDocAfterInitial._id],
                note: 'Audit lanjut kirim sisa hold',
                podReceiverName: 'Penerima Audit Lanjutan',
                podReceivedDate: AUDIT_DATE,
                podNote: 'Audit POD Lanjutan',
                actualItems: [
                    {
                        deliveryOrderItemRef: splitItem._id,
                        actualQtyKoli: 2,
                        actualWeightInputValue: 120,
                        actualWeightInputUnit: 'KG',
                        actualVolumeInputValue: 2,
                        actualVolumeInputUnit: 'M3',
                    },
                ],
                actualDropPoints: [
                    {
                        stopType: 'DROP',
                        deliveryOrderItemRef: splitItem._id,
                        deliveryOrderItemRefs: [splitItem._id],
                        shipperReferenceNumber: sjSplit,
                        locationName: 'Audit Drop Split Lanjutan',
                        locationAddress: 'Audit Drop Split Lanjutan Address',
                        qtyKoli: 2,
                        weightInputValue: 120,
                        weightInputUnit: 'KG',
                        volumeInputValue: 2,
                        volumeInputUnit: 'M3',
                    },
                ],
            },
        });
        const splitDocsAfterContinuation = await getSuratJalanDocuments(cookieHeader, doSplitId);
        const splitDocAfterContinuation = splitDocsAfterContinuation.find(document => document.suratJalanNumber === sjSplit);
        assert(splitDocAfterContinuation?.tripStatus === 'DELIVERED', `SJ split lanjutan harus DELIVERED, sekarang ${splitDocAfterContinuation?.tripStatus}.`);
        assert(
            normalizeNumber(splitDocAfterContinuation.billableCargo?.qtyKoli) === 3 &&
            normalizeNumber(splitDocAfterContinuation.billableCargo?.weightKg) === 190 &&
            normalizeNumber(splitDocAfterContinuation.holdCargo?.qtyKoli) === 0,
            'Lanjutan hold harus mengubah total billable jadi 3 koli / 190 kg dan hold menjadi 0.'
        );
        const splitItemsAfterContinuation = await getDeliveryOrderItems(cookieHeader, doSplitId);
        assert(
            normalizeNumber(splitItemsAfterContinuation[0]?.actualQtyKoli) === 3 &&
            normalizeNumber(splitItemsAfterContinuation[0]?.actualWeightKg) === 190,
            'Lanjutan hold harus tetap menyimpan aktual total item 3 koli / 190 kg.'
        );

        auditStep('create DO trip 4 untuk memastikan aktual lebih besar dari estimasi tidak dipotong');
        const doOverCreate = await postData<DeliveryOrder>(cookieHeader, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: createdState.orderId,
                orderTripPlanKey: tripOverKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjOver, pickupStopKey: pickupTwoKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit barang aktual lebih berat',
                        qtyKoli: 1,
                        weightInputValue: 15,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupTwoKey,
                        shipperReferenceNumber: sjOver,
                    },
                ],
            },
        });
        const doOverId = normalizeText(doOverCreate.data?._id) || normalizeText(doOverCreate.id);
        assert(doOverId, 'Create DO over aktual tidak mengembalikan ID.');
        createdState.deliveryOrderIds.push(doOverId);
        const doOverItems = await getDeliveryOrderItems(cookieHeader, doOverId);
        const overItem = doOverItems[0];
        assert(doOverItems.length === 1 && overItem, 'DO over aktual harus punya tepat 1 barang.');
        const overDocsBeforeInitial = await getSuratJalanDocuments(cookieHeader, doOverId);
        const overDocBeforeInitial = overDocsBeforeInitial.find(document => document.suratJalanNumber === sjOver);
        const overSuratJalanRef = overDocBeforeInitial?._id || `${doOverId}:${sjOver}`;
        for (const status of ['ON_DELIVERY', 'ARRIVED']) {
            await postData(cookieHeader, {
                entity: 'delivery-orders',
                action: 'set-surat-jalan-status-batch',
                data: {
                    id: doOverId,
                    status,
                    targetSuratJalanRefs: [overSuratJalanRef],
                    note: `Audit batch over ${status}`,
                },
            });
        }
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-surat-jalan-status-batch',
            data: {
                id: doOverId,
                status: 'DELIVERED',
                targetSuratJalanRefs: [overSuratJalanRef],
                note: 'Audit batch over aktual 15 ke 20 kg',
                podReceiverName: 'Penerima Audit Over',
                podReceivedDate: AUDIT_DATE,
                podNote: 'Audit POD Over: aktual lebih besar dari estimasi',
                actualItems: [
                    {
                        deliveryOrderItemRef: overItem._id,
                        actualQtyKoli: 1,
                        actualWeightInputValue: 20,
                        actualWeightInputUnit: 'KG',
                        actualVolumeInputValue: 1,
                        actualVolumeInputUnit: 'M3',
                    },
                ],
                actualDropPoints: [
                    {
                        stopType: 'DROP',
                        deliveryOrderItemRef: overItem._id,
                        deliveryOrderItemRefs: [overItem._id],
                        shipperReferenceNumber: sjOver,
                        locationName: 'Audit Drop Over',
                        locationAddress: 'Audit Drop Over Address',
                        qtyKoli: 1,
                        weightInputValue: 20,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1,
                        volumeInputUnit: 'M3',
                    },
                ],
            },
        });
        const finalizedOverItems = await getDeliveryOrderItems(cookieHeader, doOverId);
        assert(
            normalizeNumber(finalizedOverItems[0]?.actualQtyKoli) === 1 &&
            normalizeNumber(finalizedOverItems[0]?.actualWeightKg) === 20,
            'Batch aktual lebih besar dari estimasi harus menyimpan 1 koli / 20 kg, bukan dipotong ke rencana 15 kg.'
        );
        const doOverState = await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(doOverId)}`,
            cookieHeader
        );
        const overNotaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder: doOverState.data,
            orders: [createdOrder.data],
            deliveryOrderItems: finalizedOverItems,
        });
        assert(
            overNotaRows.length === 1 &&
            overNotaRows[0].noSJ === sjOver &&
            overNotaRows[0].collie === 1 &&
            overNotaRows[0].beratKg === 20,
            'Nota row over aktual harus memakai berat aktual drop 20 kg, bukan estimasi 15 kg.'
        );

        auditStep('tambah SJ baru setelah trip terkirim harus mulai dari CREATED');
        // Endpoint ini menulis ulang SELURUH array shipperReferences, dan penjaga SJ final
        // (order-workflows.ts) membandingkan tiap field dengan nilai tersimpan. SJ final yang
        // tidak diubah harus dikirim apa adanya (echo), karena `pickupStopKey` akan
        // dinormalisasi ulang dari pickupStops milik DO dan bisa jadi undefined kalau kita
        // mengirim key level order — itu membuat SJ yang tidak disentuh terlihat "berubah".
        const doSplitStateBeforeAdd = await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(doSplitId)}`,
            cookieHeader
        );
        const existingSplitReference = (doSplitStateBeforeAdd.data.shipperReferences || []).find(
            reference => normalizeText(reference.referenceNumber).toUpperCase() === sjSplit.toUpperCase()
        );
        assert(
            existingSplitReference,
            `Referensi SJ ${sjSplit} harus ditemukan sebelum menambah SJ baru.`
        );
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-shipper-reference',
            data: {
                id: doSplitId,
                shipperReferences: [
                    { ...existingSplitReference },
                    { referenceNumber: sjAfterDelivered, pickupStopKey: pickupTwoKey },
                ],
            },
        });
        const splitDocsAfterAddingDeliveredSj = await getSuratJalanDocuments(cookieHeader, doSplitId);
        const newDocAfterDelivered = splitDocsAfterAddingDeliveredSj.find(document => document.suratJalanNumber === sjAfterDelivered);
        assert(
            newDocAfterDelivered?.tripStatus === 'CREATED',
            `SJ baru pada trip terkirim harus mulai CREATED/dibuat, sekarang ${newDocAfterDelivered?.tripStatus}.`
        );
        auditStep('pastikan edit aktual SJ belum delivered ditolak');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-surat-jalan-actual-cargo',
            data: {
                id: doSplitId,
                suratJalanRef: newDocAfterDelivered?._id,
                actualItems: [],
            },
        }, { expectStatus: 409 });

        const deliveredOrder = await requestJson<{ data: Order }>(
            `/api/data?entity=orders&id=${encodeURIComponent(createdState.orderId)}`,
            cookieHeader
        );
        assert(deliveredOrder.data.status === 'PARTIAL', `Order harus PARTIAL setelah campuran drop/hold dan 1 trip hold-only, sekarang ${deliveredOrder.data.status}.`);

        auditStep('create nota dari SJ billable pada DO campuran dan verifikasi row per barang SJ');
        const doOneState = await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(doOneId)}`,
            cookieHeader
        );
        const suggestedNotaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder: doOneState.data,
            orders: [deliveredOrder.data],
            deliveryOrderItems: doOneItems,
        });
        const suggestedBillableRows = suggestedNotaRows.filter(row => row.noSJ === sjA);
        assert(suggestedBillableRows.length === 2, `Builder nota harus menghasilkan 2 row barang untuk SJ billable, sekarang ${suggestedBillableRows.length}.`);
        assert(
            suggestedBillableRows.some(row => normalizeText(row.barang) === 'Audit barang A1') &&
            suggestedBillableRows.some(row => normalizeText(row.barang) === 'Audit barang A2') &&
            suggestedBillableRows.every(row => !normalizeText(row.barang).includes('Audit barang B')),
            'Builder nota harus memisahkan barang per item SJ dan tidak mencampur barang hold.'
        );
        assert(
            suggestedNotaRows.every(row => row.noSJ !== sjB),
            'Builder nota tidak boleh menghasilkan row untuk SJ yang hanya hold.'
        );
        const notaRows = doOneItems
            .sort((left, right) => String(left.shipperReferenceNumber || '').localeCompare(String(right.shipperReferenceNumber || '')))
            .filter(item => item.shipperReferenceNumber === sjA)
            .map(item => ({
                doRef: doOneId,
                deliveryOrderItemRef: item._id,
                noSJ: item.shipperReferenceNumber,
                tarip: 1000,
            }));
        const notaCreate = await postData<FreightNota>(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                issueDate: AUDIT_DATE,
                dueDate: AUDIT_DATE,
                billingMode: 'PER_KG',
                items: notaRows,
            },
        });
        createdState.notaId = normalizeText(notaCreate.data?._id) || normalizeText(notaCreate.id);
        assert(createdState.notaId, 'Create nota dari DO billable tidak mengembalikan ID.');

        const notaItemsResponse = await requestJson<{ data: FreightNotaItem[] }>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: createdState.notaId }))}`,
            cookieHeader
        );
        const notaItems = Array.isArray(notaItemsResponse.data) ? notaItemsResponse.data : [];
        assert(notaItems.length === 2, `Nota harus punya 2 row barang untuk SJ billable, sekarang ${notaItems.length}.`);
        assert(
            notaItems.some(item => item.noSJ === sjA && normalizeText(item.barang) === 'Audit barang A1' && normalizeNumber(item.beratKg) === 200) &&
            notaItems.some(item => item.noSJ === sjA && normalizeText(item.barang) === 'Audit barang A2' && normalizeNumber(item.beratKg) === 125),
            'Row nota harus mengikuti berat billable per barang pada SJ A.'
        );
        assert(
            notaItems.every(item => normalizeText(item.tujuan).startsWith('Audit Drop')),
            'Tujuan nota harus berasal dari titik drop aktual per SJ.'
        );

        auditStep('pastikan aktual SJ yang sudah masuk invoice aktif tidak boleh diedit');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-surat-jalan-actual-cargo',
            data: sjAActualEditPayload,
        }, { expectStatus: 409 });

        auditStep('pastikan nomor SJ tidak boleh diubah setelah masuk nota');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-shipper-reference',
            data: {
                id: doOneId,
                customerDoNumber: `${sjA}-REV`,
                shipperReferences: [
                    { referenceNumber: `${sjA}-REV`, pickupStopKey: pickupOneKey },
                    { referenceNumber: sjB, pickupStopKey: pickupOneKey },
                ],
            },
        }, { expectStatus: 409 });

        auditStep('pastikan SJ hold pada DO campuran tidak bisa ditagihkan');
        const heldMixedItem = doOneItems.find(item => item.shipperReferenceNumber === sjB);
        assert(heldMixedItem, 'Item hold pada DO campuran harus ditemukan.');
        await postData(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                issueDate: AUDIT_DATE,
                dueDate: AUDIT_DATE,
                billingMode: 'PER_KG',
                items: [
                    {
                        doRef: doOneId,
                        deliveryOrderItemRef: heldMixedItem._id,
                        noSJ: sjB,
                        tarip: 1000,
                    },
                ],
            },
        }, { expectStatus: 409 });

        auditStep('pastikan DO hold-only ditolak untuk nota');
        await postData(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                issueDate: AUDIT_DATE,
                dueDate: AUDIT_DATE,
                billingMode: 'PER_KG',
                items: [
                    {
                        doRef: doTwoId,
                        deliveryOrderItemRef: doTwoItems[0]._id,
                        noSJ: sjHold,
                        tarip: 1000,
                    },
                ],
            },
        }, { expectStatus: 409 });

        auditStep('hapus nota dan verifikasi item nota tidak muncul sebagai tagihan aktif');
        await postData(cookieHeader, {
            entity: 'freight-notas',
            action: 'delete',
            data: {
                id: createdState.notaId,
            },
        });
        const deletedNotaItems = await requestJson<{ data: FreightNotaItem[] }>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: createdState.notaId }))}`,
            cookieHeader
        );
        assert((deletedNotaItems.data || []).length === 0, 'Delete nota harus menyembunyikan row freightNotaItem VOID dari tagihan aktif.');

        auditStep('pastikan edit aktual SJ kembali boleh setelah invoice dibatalkan');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-surat-jalan-actual-cargo',
            data: sjAActualEditPayload,
        });

        auditStep('pastikan invoice void tidak lagi menjadi alasan kunci nomor SJ final');
        const shipperReferenceAfterVoid = await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-shipper-reference',
            data: {
                id: doOneId,
                customerDoNumber: `${sjA}-VOID-REV`,
                shipperReferences: [
                    { referenceNumber: `${sjA}-VOID-REV`, pickupStopKey: pickupOneKey },
                    { referenceNumber: sjB, pickupStopKey: pickupOneKey },
                ],
            },
        }, { expectStatus: 409 });
        assert(
            !/invoice|nota/i.test(shipperReferenceAfterVoid.error || ''),
            `Setelah invoice void, ubah nomor SJ boleh tetap ditolak karena status final, tapi bukan karena invoice aktif. Got: ${shipperReferenceAfterVoid.error}`
        );

        auditStep('pastikan edit aktual SJ ditolak setelah trip ditutup admin');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-trip-closure',
            data: {
                id: doOneId,
                closed: true,
                newOdometer: 2000,
            },
        });
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-surat-jalan-actual-cargo',
            data: sjAActualEditPayload,
        }, { expectStatus: 409 });

        console.log('Order to nota E2E audit OK: create/delete order, cancel trip, multi-trip DO, multi-item SJ, ambiguous drop guard, mixed drop/hold SJ, split drop/hold same item, append/edit/delete cargo, hold-only completion, delivered actual edit before invoice, cancelled/not-delivered/closed trip actual edit guards, nota create/void, shipper reference void-invoice guard, and invoice-locked actual edit verified.');
    } finally {
        auditStep('cleanup data audit berjalan');
        await cleanupCreatedState(createdState);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
