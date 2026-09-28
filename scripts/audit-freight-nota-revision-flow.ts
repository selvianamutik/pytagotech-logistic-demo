import { loadScriptEnv } from './_env';
import { buildNotaRowsFromDeliveryOrder, type NotaItemRow } from '../src/lib/invoice-create-page-support';
import type {
    DeliveryOrder,
    DeliveryOrderItem,
    Driver,
    FreightNotaItem,
    Order,
    Vehicle,
} from '../src/lib/types';

loadScriptEnv();

type FreightNotaMutationResponse = {
    data?: {
        _id?: string;
    };
    id?: string;
    success?: boolean;
    error?: string;
};

type ApiResponse<T> = {
    data?: T;
    id?: string;
    error?: string;
};

type CustomerLike = {
    _id: string;
    name?: string;
    active?: boolean;
};

type ServiceLike = {
    _id: string;
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
};

const AUDIT_DATE = '2026-04-21';
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 45000);

function getBaseUrl() {
    return (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeIdArray(values: unknown) {
    return Array.isArray(values)
        ? [...new Set(values.map(value => normalizeText(value)).filter(Boolean))]
        : [];
}

function getRowDeliveryOrderItemRefs(row: {
    deliveryOrderItemRef?: string;
    deliveryOrderItemRefs?: string[];
}) {
    const normalizedRefs = normalizeIdArray(row.deliveryOrderItemRefs);
    if (normalizedRefs.length > 0) {
        return normalizedRefs;
    }
    const singleRef = normalizeText(row.deliveryOrderItemRef);
    return singleRef ? [singleRef] : [];
}

function hasMultipleItemRowsForSameShipper(rows: Array<{
    doRef?: string;
    noSJ?: string;
    deliveryOrderItemRef?: string;
    deliveryOrderItemRefs?: string[];
}>) {
    const rowCountByShipper = new Map<string, number>();
    for (const row of rows) {
        const itemRefs = getRowDeliveryOrderItemRefs(row);
        if (itemRefs.length === 0) continue;
        const key = `${normalizeText(row.doRef)}::${normalizeText(row.noSJ)}`;
        rowCountByShipper.set(key, (rowCountByShipper.get(key) || 0) + 1);
    }
    return [...rowCountByShipper.values()].some(count => count > 1);
}

function assertFreightNotaRowsKeepItemRefs(params: {
    label: string;
    expectedRows: NotaItemRow[];
    actualRows: FreightNotaItem[];
}) {
    for (const expectedRow of params.expectedRows) {
        const expectedItemRefs = getRowDeliveryOrderItemRefs(expectedRow);
        if (expectedItemRefs.length === 0) {
            continue;
        }
        const matchedRow = params.actualRows.find(row => {
            if (
                normalizeText(row.doRef) !== normalizeText(expectedRow.doRef) ||
                normalizeText(row.noSJ) !== normalizeText(expectedRow.noSJ)
            ) {
                return false;
            }
            const actualItemRefs = getRowDeliveryOrderItemRefs(row);
            return actualItemRefs.length === expectedItemRefs.length &&
                expectedItemRefs.every(itemRef => actualItemRefs.includes(itemRef));
        });
        assert(
            matchedRow,
            `${params.label}: row ${expectedRow.noSJ || expectedRow.doRef || '-'} tidak ditemukan`
        );
        const actualItemRefs = getRowDeliveryOrderItemRefs(matchedRow);
        assert(
            actualItemRefs.length === expectedItemRefs.length,
            `${params.label}: row ${expectedRow.noSJ || expectedRow.doRef || '-'} harus menyimpan ${expectedItemRefs.length} item ref, sekarang ${actualItemRefs.length}`
        );
        assert(
            expectedItemRefs.every(itemRef => actualItemRefs.includes(itemRef)),
            `${params.label}: row ${expectedRow.noSJ || expectedRow.doRef || '-'} kehilangan item ref saat disimpan`
        );
    }
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function auditStep(message: string) {
    console.log(`[audit:freight-nota-revision] ${message}`);
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
        for (const itemId of notaItemIds) {
            await deleteBySourceId('freight_nota_items', itemId);
        }
        const [deliveryOrderItemIds, trackingLogIds, driverVoucherIds] = await Promise.all([
            listSourceIds('delivery_order_items', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('tracking_logs', `ref_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('driver_vouchers', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
        ]);
        for (const itemId of deliveryOrderItemIds) {
            await deleteBySourceId('delivery_order_items', itemId);
        }
        for (const itemId of trackingLogIds) {
            await deleteBySourceId('tracking_logs', itemId);
        }
        for (const itemId of driverVoucherIds) {
            await deleteJournalEntriesBySource('DRIVER_VOUCHER', itemId);
            await deleteBySourceId('driver_vouchers', itemId);
        }
        await deleteBySourceId('delivery_orders', deliveryOrderId);
    }

    if (state.orderId) {
        const orderItemIds = await listSourceIds('order_items', `order_ref=eq.${encodeURIComponent(state.orderId)}`).catch(() => []);
        for (const itemId of orderItemIds) {
            await deleteBySourceId('order_items', itemId);
        }
        await deleteBySourceId('orders', state.orderId);
    }
}

async function cleanupStaleAuditOrders() {
    const rows = await supabaseRest<Array<{ source_document_id: string }>>(
        'orders?select=source_document_id&notes=ilike.*Audit%20Nota%20Revision*'
    ).catch(() => []);
    for (const row of rows || []) {
        const deliveryOrderIds = await listSourceIds('delivery_orders', `order_ref=eq.${encodeURIComponent(row.source_document_id)}`).catch(() => []);
        await cleanupCreatedState({
            orderId: row.source_document_id,
            deliveryOrderIds,
        });
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

async function postData<T>(cookieHeader: string, payload: Record<string, unknown>) {
    const actionLabel = `${normalizeText(payload.entity) || 'entity'}:${normalizeText(payload.action) || 'action'}`;
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/invoices/new`,
            Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
    }, `POST /api/data ${actionLabel}`);

    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as T : {} as T;
    if (!response.ok) {
        throw new Error(`/api/data -> ${response.status}: ${bodyText}`);
    }
    return parsed;
}

function pickFixtureResources(params: {
    customers: CustomerLike[];
    services: ServiceLike[];
    vehicles: Vehicle[];
    drivers: Driver[];
    bankAccounts: BankAccountLike[];
    orders: Order[];
    deliveryOrders: DeliveryOrder[];
}) {
    const activeServices = params.services.filter(item => item.active !== false);
    // Driver/vehicle exclusivity is gone: any operational vehicle and any active
    // driver may be reused across multiple DOs at the same time.
    const availableVehicles = params.vehicles.filter(item =>
        item.status !== 'SOLD' &&
        item.status !== 'OUT_OF_SERVICE'
    );
    const availableDrivers = params.drivers.filter(item => item.active !== false);

    for (const service of activeServices) {
        const vehicle = availableVehicles.find(item => normalizeText(item.serviceRef) === service._id);
        const driver = availableDrivers[0];
        if (vehicle && driver) {
            return {
                customer: params.customers.find(item => item.active !== false),
                service,
                vehicle,
                driver,
                bankAccount: params.bankAccounts.find(item => item.active !== false),
            };
        }
    }

    return {
        customer: params.customers.find(item => item.active !== false),
        service: undefined,
        vehicle: availableVehicles[0],
        driver: availableDrivers[0],
        bankAccount: params.bankAccounts.find(item => item.active !== false),
    };
}

async function getDeliveryOrderItems(cookieHeader: string, deliveryOrderId: string) {
    const response = await requestJson<{ data: DeliveryOrderItem[] }>(
        `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderId }))}`,
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

function buildCandidateRows(params: {
    deliveryOrder: DeliveryOrder;
    orders: Order[];
    deliveryOrderItems: DeliveryOrderItem[];
}) {
    const rows = buildNotaRowsFromDeliveryOrder(params)
        .map(row => ({
            ...row,
            tarip: 1000,
            uangRp: Math.round((row.beratKg || 0) * 1000),
        }))
        .filter(row => !Number.isNaN(row.uangRp));
    const rowCustomerRefs = [...new Set(rows.map(row => normalizeText(row.customerRef)).filter(Boolean))];

    const valid = rows.length > 0 && rows.every(row =>
        normalizeText(row.doRef) === normalizeText(params.deliveryOrder._id) &&
        normalizeText(row.noSJ) &&
        normalizeText(row.tujuan) &&
        Number.isFinite(row.beratKg) &&
        row.beratKg > 0 &&
        Number.isFinite(row.tarip) &&
        row.tarip > 0 &&
        row.uangRp > 0
    ) && rowCustomerRefs.length <= 1;

    return {
        rows,
        valid,
        customerRef: rowCustomerRefs[0] || normalizeText(params.deliveryOrder.customerRef),
        customerName: normalizeText(rows[0]?.customerName) || normalizeText(params.deliveryOrder.customerName),
    };
}

async function createFixtureIfNeeded(cookieHeader: string, createdState: CreatedState) {
    auditStep('tidak ada kandidat existing, buat fixture DO billable sementara');
    const suffix = Date.now().toString().slice(-6);
    const pickupKey = `audit-revision-pickup-${suffix}`;
    const tripKey = `audit-revision-trip-${suffix}`;
    const sjNumber = `AUD-REV-${suffix}`;

    const [customerResponse, serviceResponse, vehicleResponse, driverResponse, bankResponse, orderResponse, deliveryOrderResponse] = await Promise.all([
        requestJson<{ data: CustomerLike[] }>('/api/data?entity=customers', cookieHeader),
        requestJson<{ data: ServiceLike[] }>('/api/data?entity=services', cookieHeader),
        requestJson<{ data: Vehicle[] }>('/api/data?entity=vehicles', cookieHeader),
        requestJson<{ data: Driver[] }>('/api/data?entity=drivers', cookieHeader),
        requestJson<{ data: BankAccountLike[] }>('/api/data?entity=bank-accounts', cookieHeader),
        requestJson<{ data: Order[] }>('/api/data?entity=orders', cookieHeader),
        requestJson<{ data: DeliveryOrder[] }>('/api/data?entity=delivery-orders', cookieHeader),
    ]);

    const resources = pickFixtureResources({
        customers: customerResponse.data || [],
        services: serviceResponse.data || [],
        vehicles: vehicleResponse.data || [],
        drivers: driverResponse.data || [],
        bankAccounts: bankResponse.data || [],
        orders: orderResponse.data || [],
        deliveryOrders: deliveryOrderResponse.data || [],
    });

    assert(resources.customer, 'Audit revision butuh minimal 1 customer aktif.');
    assert(resources.service, 'Audit revision butuh minimal 1 kategori armada aktif.');
    assert(resources.vehicle, 'Audit revision butuh minimal 1 kendaraan tersedia.');
    assert(resources.driver, 'Audit revision butuh minimal 1 supir tersedia.');
    assert(resources.bankAccount, 'Audit revision butuh minimal 1 rekening aktif.');

    const orderCreate = await postData<ApiResponse<Order>>(cookieHeader, {
        entity: 'orders',
        action: 'create-with-items',
        data: {
            customerRef: resources.customer._id,
            serviceRef: resources.service._id,
            pickupAddress: 'Audit Revision Pickup',
            pickupStops: [
                {
                    _key: pickupKey,
                    sequence: 1,
                    pickupLabel: 'Audit Revision Pickup',
                    pickupAddress: 'Audit Revision Pickup Address',
                },
            ],
            notes: `Audit Nota Revision ${suffix}`,
            items: [],
            tripDrafts: [
                {
                    _key: tripKey,
                    pickupStopKeys: [pickupKey],
                    vehicleRef: resources.vehicle._id,
                    driverRef: resources.driver._id,
                    taripBorongan: 250000,
                    issueBankRef: resources.bankAccount._id,
                    cashGiven: 100000,
                    date: AUDIT_DATE,
                },
            ],
        },
    });
    createdState.orderId = normalizeText(orderCreate.data?._id) || normalizeText(orderCreate.id);
    assert(createdState.orderId, 'Fixture create order tidak mengembalikan ID.');

    const doCreate = await postData<ApiResponse<DeliveryOrder>>(cookieHeader, {
        entity: 'delivery-orders',
        action: 'create-with-items',
        data: {
            orderRef: createdState.orderId,
            orderTripPlanKey: tripKey,
            date: AUDIT_DATE,
            shipperReferences: [
                { referenceNumber: sjNumber, pickupStopKey: pickupKey },
            ],
            cargoItems: [
                {
                    description: 'Barang Audit Revision A',
                    qtyKoli: 2,
                    weightInputValue: 200,
                    weightInputUnit: 'KG',
                    volumeInputValue: 1,
                    volumeInputUnit: 'M3',
                    pickupStopKey: pickupKey,
                    shipperReferenceNumber: sjNumber,
                },
                {
                    description: 'Barang Audit Revision B',
                    qtyKoli: 1,
                    weightInputValue: 150,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0.75,
                    volumeInputUnit: 'M3',
                    pickupStopKey: pickupKey,
                    shipperReferenceNumber: sjNumber,
                },
            ],
        },
    });
    const deliveryOrderId = normalizeText(doCreate.data?._id) || normalizeText(doCreate.id);
    assert(deliveryOrderId, 'Fixture create DO tidak mengembalikan ID.');
    createdState.deliveryOrderIds.push(deliveryOrderId);

    const doItems = await getDeliveryOrderItems(cookieHeader, deliveryOrderId);
    assert(doItems.length === 2, 'Fixture DO harus punya 2 barang dalam 1 SJ.');

    await advanceDeliveryOrderToDelivered({
        cookieHeader,
        deliveryOrderId,
        actualItems: doItems.map(item => ({
            deliveryOrderItemRef: item._id,
            actualQtyKoli: normalizeNumber(item.orderItemQtyKoli),
            actualWeightInputValue: normalizeNumber(item.orderItemWeight),
            actualWeightInputUnit: 'KG',
            actualVolumeInputValue: normalizeNumber(item.orderItemVolumeInputValue ?? item.orderItemVolumeM3),
            actualVolumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
        })),
        actualDropPoints: [
            {
                stopType: 'DROP',
                shipperReferenceNumber: sjNumber,
                locationName: 'Audit Revision Drop',
                locationAddress: 'Audit Revision Drop Address',
                qtyKoli: 3,
                weightInputValue: 350,
                weightInputUnit: 'KG',
                volumeInputValue: 1.75,
                volumeInputUnit: 'M3',
            },
        ],
    });

    const [deliveryOrderRecord, orderRecord] = await Promise.all([
        requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(deliveryOrderId)}`,
            cookieHeader,
        ),
        requestJson<{ data: Order }>(
            `/api/data?entity=orders&id=${encodeURIComponent(createdState.orderId)}`,
            cookieHeader,
        ),
    ]);
    const deliveryOrderItems = await getDeliveryOrderItems(cookieHeader, deliveryOrderId);

    return {
        deliveryOrder: deliveryOrderRecord.data,
        orders: [orderRecord.data],
        deliveryOrderItems,
    };
}

async function main() {
    const cookieHeader = await loginAndGetCookieHeader();
    const createdState: CreatedState = { deliveryOrderIds: [] };
    let notaId = '';

    try {
        auditStep('cleanup fixture audit lama');
        await cleanupStaleAuditOrders();

        auditStep('ambil kandidat DO billable existing');
        const [deliveryOrderResponse, orderResponse, deliveryOrderItemResponse, freightNotaItemResponse] = await Promise.all([
            requestJson<{ data: DeliveryOrder[] }>('/api/data?entity=delivery-orders', cookieHeader),
            requestJson<{ data: Order[] }>('/api/data?entity=orders', cookieHeader),
            requestJson<{ data: DeliveryOrderItem[] }>('/api/data?entity=delivery-order-items', cookieHeader),
            requestJson<{ data: FreightNotaItem[] }>('/api/data?entity=freight-nota-items', cookieHeader),
        ]);

        let deliveryOrders = Array.isArray(deliveryOrderResponse.data) ? deliveryOrderResponse.data : [];
        let orders = Array.isArray(orderResponse.data) ? orderResponse.data : [];
        let deliveryOrderItems = Array.isArray(deliveryOrderItemResponse.data) ? deliveryOrderItemResponse.data : [];
        const freightNotaItems = Array.isArray(freightNotaItemResponse.data) ? freightNotaItemResponse.data : [];

        const billedDoRefs = new Set(
            freightNotaItems
                .map(item => normalizeText(item.doRef))
                .filter(Boolean)
        );

        let prepared = deliveryOrders
            .filter(deliveryOrder => deliveryOrder.status === 'DELIVERED' && !billedDoRefs.has(normalizeText(deliveryOrder._id)))
            .map(deliveryOrder => ({
                deliveryOrder,
                ...buildCandidateRows({ deliveryOrder, orders, deliveryOrderItems }),
            }))
            .filter(candidate => candidate.valid && candidate.customerRef && candidate.customerName);

        let firstCandidate = prepared.find(candidate => hasMultipleItemRowsForSameShipper(candidate.rows));
        if (!firstCandidate) {
            const fixtureData = await createFixtureIfNeeded(cookieHeader, createdState);
            deliveryOrders = [fixtureData.deliveryOrder];
            orders = fixtureData.orders;
            deliveryOrderItems = fixtureData.deliveryOrderItems;
            prepared = deliveryOrders
                .map(deliveryOrder => ({
                    deliveryOrder,
                    ...buildCandidateRows({ deliveryOrder, orders, deliveryOrderItems }),
                }))
                .filter(candidate => candidate.valid && candidate.customerRef && candidate.customerName);
            firstCandidate = prepared.find(candidate => hasMultipleItemRowsForSameShipper(candidate.rows));
        }

        assert(firstCandidate, 'Audit revision tidak berhasil menyiapkan kandidat DO billable.');
        assert(
            hasMultipleItemRowsForSameShipper(firstCandidate.rows),
            'Audit revision harus memakai minimal 1 SJ yang menghasilkan beberapa row barang.'
        );

        const manualAuditRows: NotaItemRow[] = [{
            id: `manual-audit-${Date.now().toString(36)}`,
            doRef: '',
            customerRef: firstCandidate.customerRef,
            customerName: firstCandidate.customerName,
            doNumber: '',
            vehiclePlate: 'B 1234 AUDIT',
            date: AUDIT_DATE,
            noSJ: `MANUAL-AUDIT-${Date.now().toString().slice(-4)}`,
            dari: 'Gudang Audit Internal',
            tujuan: 'Tujuan Audit Sementara',
            barang: 'Barang Audit',
            collie: 1,
            beratKg: 10,
            tarip: 1000,
            uangRp: 10000,
            ket: 'Audit revisi nota untuk unlink/relink DO',
            plt: '',
            pc: '',
            kbl: '',
            invoiceLineDate: '',
        }];

        auditStep('create nota dari kandidat DO');
        const createPayload = await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                customerRef: firstCandidate.customerRef,
                customerName: firstCandidate.customerName,
                issueDate: AUDIT_DATE,
                dueDate: '2026-04-28',
                billingMode: 'PER_KG',
                items: firstCandidate.rows,
            },
        });
        notaId = normalizeText(createPayload.data?._id) || normalizeText(createPayload.id);
        createdState.notaId = notaId;
        assert(notaId, 'Create nota berhasil tetapi ID nota tidak dikembalikan.');

        const createdRowsResponse = await requestJson<{ data: FreightNotaItem[] }>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`,
            cookieHeader,
        );
        const createdRows = Array.isArray(createdRowsResponse.data) ? createdRowsResponse.data : [];
        assert(
            createdRows.length === firstCandidate.rows.length,
            `Jumlah row nota awal harus ${firstCandidate.rows.length}, sekarang ${createdRows.length}`
        );
        assertFreightNotaRowsKeepItemRefs({
            label: 'create nota awal',
            expectedRows: firstCandidate.rows,
            actualRows: createdRows,
        });

        auditStep('revisi nota ke row manual dan pastikan row DO lama tidak muncul sebagai row aktif');
        await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'update-with-items',
            data: {
                id: notaId,
                customerRef: firstCandidate.customerRef,
                customerName: firstCandidate.customerName,
                issueDate: AUDIT_DATE,
                dueDate: '2026-04-28',
                billingMode: 'PER_KG',
                items: manualAuditRows,
            },
        });

        const [manualRowsResponse, oldDoRowsAfterManualResponse] = await Promise.all([
            requestJson<{ data: FreightNotaItem[] }>(
                `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`,
                cookieHeader,
            ),
            requestJson<{ data: FreightNotaItem[] }>(
                `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: firstCandidate.deliveryOrder._id }))}`,
                cookieHeader,
            ),
        ]);

        const revisedRows = Array.isArray(manualRowsResponse.data) ? manualRowsResponse.data : [];
        const oldDoRowsAfterManual = Array.isArray(oldDoRowsAfterManualResponse.data) ? oldDoRowsAfterManualResponse.data : [];
        assert(
            revisedRows.length === manualAuditRows.length,
            `Jumlah row nota manual harus ${manualAuditRows.length}, sekarang ${revisedRows.length}`
        );
        assert(
            revisedRows.every(row => !normalizeText(row.doRef) && normalizeText(row.noSJ) === normalizeText(manualAuditRows[0]?.noSJ)),
            'Row nota manual belum menggantikan row DO lama secara penuh.'
        );
        assert(
            oldDoRowsAfterManual.every(row => normalizeText(row.notaRef) !== notaId),
            'Row DO lama masih melekat ke invoice setelah nota direvisi ke row manual.'
        );

        auditStep('revisi lagi ke row DO dan pastikan row DO dibuat ulang');
        await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'update-with-items',
            data: {
                id: notaId,
                customerRef: firstCandidate.customerRef,
                customerName: firstCandidate.customerName,
                issueDate: AUDIT_DATE,
                dueDate: '2026-04-28',
                billingMode: 'PER_KG',
                items: firstCandidate.rows,
            },
        });

        const [relinkedRowsResponse] = await Promise.all([
            requestJson<{ data: FreightNotaItem[] }>(
                `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`,
                cookieHeader,
            ),
        ]);
        const relinkedRows = Array.isArray(relinkedRowsResponse.data) ? relinkedRowsResponse.data : [];
        assert(
            relinkedRows.length === firstCandidate.rows.length,
            `Jumlah row nota setelah relink harus ${firstCandidate.rows.length}, sekarang ${relinkedRows.length}`
        );
        assert(
            relinkedRows.every(row => normalizeText(row.doRef) === normalizeText(firstCandidate.deliveryOrder._id)),
            'Masih ada row manual tertinggal setelah nota direvisi kembali ke DO.'
        );
        assertFreightNotaRowsKeepItemRefs({
            label: 'relink nota ke DO',
            expectedRows: firstCandidate.rows,
            actualRows: relinkedRows,
        });

        auditStep('void nota temporary dan pastikan row invoice tidak muncul sebagai row aktif');
        const deletedNotaId = notaId;
        await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'delete',
            data: { id: notaId },
        });
        notaId = '';

        const releasedRowsResponse = await requestJson<{ data: FreightNotaItem[] }>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: deletedNotaId }))}`,
            cookieHeader,
        );
        const releasedRows = Array.isArray(releasedRowsResponse.data) ? releasedRowsResponse.data : [];
        assert(
            releasedRows.length === 0,
            'Row invoice temporary masih muncul sebagai row aktif setelah nota di-void.'
        );

        console.log(
            `Freight nota revision audit OK: create, revise ke manual, relink row DO, replace active rows, dan cleanup/void berhasil pada ${firstCandidate.deliveryOrder.doNumber}.`
        );
    } finally {
        await cleanupCreatedState(createdState);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
