import { computeDeliveryOrderOvertonage } from '@/lib/delivery-order-overtonage';
import {
    getDeliveryOrderActualDropDestinations,
    getDeliveryOrderBillableCargoSummary,
    hasDeliveryOrderBillableCargo,
} from '@/lib/delivery-order-completion';
import { getTripRouteOvertonaseRatePerKg } from '@/lib/trip-route-rate-support';
import { registerApiReadCacheInvalidator } from '@/lib/api/read-cache';
import { listDocumentsByFilter } from '@/lib/repositories/document-store';
import type { DeliveryOrder, DeliveryOrderItem, FreightNotaItem, Order, TrackingLog, TripRouteRate } from '@/lib/types';

import { summarizeDeliveryOrderItems, type FreightNotaDeliveryOrderItemSource } from './finance-workflow-support';
import { extractRefId, normalizeCurrencyNumber, normalizeNumber, normalizeOptionalText } from './data-helpers';
import { deriveOrderStatusFromItems, type OrderItemStatusSummary } from './order-workflow-support';

type DeliveryOrderResponseSource = DeliveryOrder & {
    _updatedAt?: string;
};

type OrderResponseSource = Order & {
    _updatedAt?: string;
};

type DeliveryOrderTrackingLogSource = Pick<TrackingLog, 'refRef' | 'status' | 'timestamp' | 'userRef' | 'userName'> & {
    refType?: TrackingLog['refType'];
};

type DeliveryOrderServiceSource = {
    _id: string;
    maxPayloadKg?: number;
};

type DeliveryOrderVehicleSource = {
    _id: string;
    capacityKg?: number;
};

type DeliveryOrderResponseDerivationOptions = {
    deliveryOrderItems?: DeliveryOrderItem[];
    trackingLogs?: DeliveryOrderTrackingLogSource[];
    services?: DeliveryOrderServiceSource[];
    vehicles?: DeliveryOrderVehicleSource[];
    tripRouteRates?: Array<Pick<TripRouteRate, '_id' | 'overtonaseDriverRatePerTon' | 'notes'> & { overtonaseReferencePerTon?: number }>;
};

type FreightNotaDeliveryOrderSource = Pick<
    DeliveryOrder,
    | '_id'
    | 'orderRef'
    | 'doNumber'
    | 'customerDoNumber'
    | 'vehiclePlate'
    | 'date'
    | 'pickupAddress'
    | 'receiverAddress'
    | 'actualDropPoints'
    | 'shipperReferences'
>;

type FreightNotaDeliveryOrderItemResponseSource = FreightNotaDeliveryOrderItemSource & {
    _id?: string;
    shipperReferenceNumber?: string;
};

type FreightNotaOrderResponseSource = Pick<Order, '_id' | 'pickupAddress' | 'receiverAddress' | 'customerRef' | 'customerName'>;

type ActualCargoSummary = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

type OrderItemStatusSource = OrderItemStatusSummary & {
    _id?: string;
    orderRef?: string;
};

type ResponseDerivationCacheEntry = {
    expiresAt: number;
    value: unknown;
};

const RESPONSE_DERIVATION_CACHE_TTL_MS = Math.max(
    0,
    Number.parseInt(process.env.RESPONSE_DERIVATION_CACHE_TTL_MS || '10000', 10) || 10000
);
const RESPONSE_DERIVATION_CACHE_MAX_ENTRIES = 100;
const responseDerivationCache = new Map<string, ResponseDerivationCacheEntry>();

export function clearResponseDerivationCache() {
    responseDerivationCache.clear();
}

registerApiReadCacheInvalidator(clearResponseDerivationCache);

function cloneResponseDerivationValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getResponseDerivationCache<T>(key: string): T | null {
    if (!key || RESPONSE_DERIVATION_CACHE_TTL_MS <= 0) {
        return null;
    }

    const cached = responseDerivationCache.get(key);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        responseDerivationCache.delete(key);
        return null;
    }

    return cloneResponseDerivationValue(cached.value as T);
}

function setResponseDerivationCache<T>(key: string, value: T) {
    if (key && RESPONSE_DERIVATION_CACHE_TTL_MS > 0) {
        responseDerivationCache.set(key, {
            expiresAt: Date.now() + RESPONSE_DERIVATION_CACHE_TTL_MS,
            value: cloneResponseDerivationValue(value),
        });

        while (responseDerivationCache.size > RESPONSE_DERIVATION_CACHE_MAX_ENTRIES) {
            const oldestKey = responseDerivationCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            responseDerivationCache.delete(oldestKey);
        }
    }

    return value;
}

function buildDocumentSignature<T extends { _id?: string; _updatedAt?: string; status?: string }>(
    documents: T[],
    extra?: Record<string, unknown>,
) {
    return JSON.stringify({
        documents: documents.map(item => ({
            _id: normalizeOptionalText(item._id),
            _updatedAt: normalizeOptionalText(item._updatedAt),
            status: normalizeOptionalText(item.status),
        })),
        extra: extra || {},
    });
}

function hasDeliveryOrderDerivationOptions(options: DeliveryOrderResponseDerivationOptions) {
    return Boolean(
        options.deliveryOrderItems ||
        options.trackingLogs ||
        options.services ||
        options.vehicles ||
        options.tripRouteRates
    );
}

function roundQuantity(value: number, maxFractionDigits = 3) {
    if (!Number.isFinite(value)) return 0;
    const multiplier = 10 ** maxFractionDigits;
    return Math.round(value * multiplier) / multiplier;
}

function buildActualCargoSummary(items: Array<Pick<DeliveryOrderItem, 'actualQtyKoli' | 'actualWeightKg' | 'actualVolumeM3'>>) {
    return items.reduce<ActualCargoSummary>(
        (sum, item) => ({
            qtyKoli: roundQuantity(sum.qtyKoli + normalizeNumber(item.actualQtyKoli ?? 0), 2),
            weightKg: roundQuantity(sum.weightKg + normalizeNumber(item.actualWeightKg ?? 0), 2),
            volumeM3: roundQuantity(sum.volumeM3 + normalizeNumber(item.actualVolumeM3 ?? 0), 3),
        }),
        { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
    );
}

export async function deriveOrdersForResponse(orders: OrderResponseSource[]) {
    if (orders.length === 0) {
        return orders;
    }

    const orderIds = orders.map(item => item._id).filter(Boolean);
    const orderItems = orderIds.length > 0
        ? await listDocumentsByFilter<OrderItemStatusSource>('orderItem', { orderRef: orderIds })
        : [];
    const cacheKey = `orders:${buildDocumentSignature(orders)}:${buildDocumentSignature(orderItems)}`;
    const cached = getResponseDerivationCache<OrderResponseSource[]>(cacheKey);
    if (cached) {
        return cached;
    }

    const itemsByOrderRef = new Map<string, OrderItemStatusSource[]>();
    for (const item of orderItems) {
        const orderRef = normalizeOptionalText(item.orderRef);
        if (!orderRef) continue;
        const current = itemsByOrderRef.get(orderRef) || [];
        current.push(item);
        itemsByOrderRef.set(orderRef, current);
    }

    const derivedOrders = orders.map(order => {
        if (order.status === 'CANCELLED') {
            return order;
        }

        const linkedItems = itemsByOrderRef.get(order._id) || [];

        const derivedStatus = deriveOrderStatusFromItems(linkedItems);
        if (!derivedStatus || derivedStatus === order.status) {
            return order;
        }

        return {
            ...order,
            status: derivedStatus,
        };
    });

    return setResponseDerivationCache(cacheKey, derivedOrders);
}

function buildFallbackActualDropPoint(deliveryOrder: DeliveryOrderResponseSource, totals: ActualCargoSummary) {
    if (
        totals.qtyKoli <= 0 &&
        totals.weightKg <= 0 &&
        totals.volumeM3 <= 0 &&
        !normalizeOptionalText(deliveryOrder.receiverAddress) &&
        !normalizeOptionalText(deliveryOrder.receiverName) &&
        !normalizeOptionalText(deliveryOrder.receiverCompany)
    ) {
        return undefined;
    }

    return {
        _key: `derived-drop-${deliveryOrder._id}`,
        sequence: 1,
        stopType: 'DROP' as const,
        locationName:
            normalizeOptionalText(deliveryOrder.receiverCompany)
            || normalizeOptionalText(deliveryOrder.receiverName)
            || 'Tujuan Invoice',
        locationAddress: normalizeOptionalText(deliveryOrder.receiverAddress),
        qtyKoli: totals.qtyKoli > 0 ? totals.qtyKoli : undefined,
        weightKg: totals.weightKg > 0 ? totals.weightKg : undefined,
        volumeM3: totals.volumeM3 > 0 ? totals.volumeM3 : undefined,
    };
}

function resolveDeliveredTimestamp(
    deliveryOrder: DeliveryOrderResponseSource,
    trackingLogs: DeliveryOrderTrackingLogSource[]
) {
    if (normalizeOptionalText(deliveryOrder.cargoFinalizedAt)) {
        return deliveryOrder.cargoFinalizedAt;
    }

    if (deliveryOrder.status !== 'DELIVERED') {
        return deliveryOrder.cargoFinalizedAt;
    }

    const deliveredLog = [...trackingLogs]
        .filter(item => item.status === 'DELIVERED' && normalizeOptionalText(item.timestamp))
        .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))[0];

    return (
        normalizeOptionalText(deliveredLog?.timestamp)
        || normalizeOptionalText(deliveryOrder.trackingStoppedAt)
        || normalizeOptionalText(deliveryOrder.trackingLastSeenAt)
        || normalizeOptionalText(deliveryOrder._updatedAt)
        || (normalizeOptionalText(deliveryOrder.podReceivedDate) ? `${deliveryOrder.podReceivedDate}T00:00:00.000Z` : undefined)
    );
}

function resolveDeliveredTrackingLog(trackingLogs: DeliveryOrderTrackingLogSource[]) {
    return [...trackingLogs]
        .filter(item => item.status === 'DELIVERED' && normalizeOptionalText(item.timestamp))
        .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))[0];
}

function resolveFreightNotaNoSj(
    item: FreightNotaItem,
    deliveryOrder: FreightNotaDeliveryOrderSource | undefined,
    linkedItems: FreightNotaDeliveryOrderItemResponseSource[],
) {
    const currentNoSj = normalizeOptionalText(item.noSJ);
    const doNumber = normalizeOptionalText(deliveryOrder?.doNumber);
    if (currentNoSj && currentNoSj !== doNumber) {
        return currentNoSj;
    }

    const uniqueItemReferences = [
        ...new Set(
            linkedItems
                .map(linkedItem => normalizeOptionalText(linkedItem.shipperReferenceNumber))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    if (uniqueItemReferences.length === 1) {
        return uniqueItemReferences[0];
    }

    return (
        normalizeOptionalText(deliveryOrder?.customerDoNumber)
        || normalizeOptionalText(deliveryOrder?.shipperReferences?.[0]?.referenceNumber)
        || currentNoSj
        || doNumber
        || ''
    );
}

export async function deriveDeliveryOrdersForResponse(
    deliveryOrders: DeliveryOrderResponseSource[],
    options: DeliveryOrderResponseDerivationOptions = {},
) {
    if (deliveryOrders.length === 0) {
        return deliveryOrders;
    }

    const canUseCache = !hasDeliveryOrderDerivationOptions(options);
    const cacheKey = canUseCache
        ? `delivery-orders:${buildDocumentSignature(deliveryOrders, { count: deliveryOrders.length })}`
        : '';
    const cached = canUseCache
        ? getResponseDerivationCache<DeliveryOrderResponseSource[]>(cacheKey)
        : null;
    if (cached) {
        return cached;
    }

    const deliveryOrderIds = deliveryOrders.map(item => item._id).filter(Boolean);
    const serviceRefs = [
        ...new Set(
            deliveryOrders
                .map(item => extractRefId(item.serviceRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const vehicleRefs = [
        ...new Set(
            deliveryOrders
                .map(item => extractRefId(item.vehicleRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const tripRouteRateRefs = [
        ...new Set(
            deliveryOrders
                .map(item => extractRefId(item.tripRouteRateRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];

    const deliveryOrderIdSet = new Set(deliveryOrderIds);
    const serviceRefSet = new Set(serviceRefs);
    const vehicleRefSet = new Set(vehicleRefs);
    const tripRouteRateRefSet = new Set(tripRouteRateRefs);

    const [
        rawDeliveryOrderItems,
        rawTrackingLogs,
        rawServices,
        rawVehicles,
        rawTripRouteRates,
    ] = await Promise.all([
        options.deliveryOrderItems
            ? Promise.resolve(options.deliveryOrderItems)
            : listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', { deliveryOrderRef: deliveryOrderIds }),
        options.trackingLogs
            ? Promise.resolve(options.trackingLogs)
            : listDocumentsByFilter<DeliveryOrderTrackingLogSource>('trackingLog', { refType: 'DO', refRef: deliveryOrderIds }),
        options.services
            ? Promise.resolve(options.services)
            : serviceRefs.length > 0
            ? listDocumentsByFilter<DeliveryOrderServiceSource>('service', { _id: serviceRefs })
            : Promise.resolve([]),
        options.vehicles
            ? Promise.resolve(options.vehicles)
            : vehicleRefs.length > 0
            ? listDocumentsByFilter<DeliveryOrderVehicleSource>('vehicle', { _id: vehicleRefs })
            : Promise.resolve([]),
        options.tripRouteRates
            ? Promise.resolve(options.tripRouteRates)
            : tripRouteRateRefs.length > 0
            ? listDocumentsByFilter<Pick<TripRouteRate, '_id' | 'overtonaseDriverRatePerTon' | 'notes'> & { overtonaseReferencePerTon?: number }>('tripRouteRate', { _id: tripRouteRateRefs })
            : Promise.resolve([]),
    ]);
    const deliveryOrderItems = rawDeliveryOrderItems.filter(item =>
        deliveryOrderIdSet.has(normalizeOptionalText(item.deliveryOrderRef) || '')
    );
    const trackingLogs = rawTrackingLogs.filter(log =>
        (!log.refType || log.refType === 'DO') && deliveryOrderIdSet.has(normalizeOptionalText(log.refRef) || '')
    );
    const services = rawServices.filter(service => serviceRefSet.size === 0 || serviceRefSet.has(service._id));
    const vehicles = rawVehicles.filter(vehicle => vehicleRefSet.size === 0 || vehicleRefSet.has(vehicle._id));
    const tripRouteRates = rawTripRouteRates.filter(rate => tripRouteRateRefSet.size === 0 || tripRouteRateRefSet.has(rate._id));

    const itemsByDeliveryOrderRef = new Map<string, DeliveryOrderItem[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = itemsByDeliveryOrderRef.get(deliveryOrderRef) || [];
        current.push(item);
        itemsByDeliveryOrderRef.set(deliveryOrderRef, current);
    }

    const trackingLogsByDeliveryOrderRef = new Map<string, DeliveryOrderTrackingLogSource[]>();
    for (const log of trackingLogs) {
        const deliveryOrderRef = normalizeOptionalText(log.refRef);
        if (!deliveryOrderRef) continue;
        const current = trackingLogsByDeliveryOrderRef.get(deliveryOrderRef) || [];
        current.push(log);
        trackingLogsByDeliveryOrderRef.set(deliveryOrderRef, current);
    }

    const serviceMap = new Map(services.map(item => [item._id, item]));
    const vehicleMap = new Map(vehicles.map(item => [item._id, item]));
    const tripRouteRateMap = new Map(tripRouteRates.map(item => [item._id, item]));

    const derivedDeliveryOrders = deliveryOrders.map(deliveryOrder => {
        const linkedItems = itemsByDeliveryOrderRef.get(deliveryOrder._id) || [];
        const linkedTrackingLogs = trackingLogsByDeliveryOrderRef.get(deliveryOrder._id) || [];
        const deliveredTrackingLog = resolveDeliveredTrackingLog(linkedTrackingLogs);
        const actualTotals = buildActualCargoSummary(linkedItems);
        const actualTotalWeightKg =
            normalizeNumber(deliveryOrder.actualTotalWeightKg, { maxFractionDigits: 2 }) > 0
                ? normalizeNumber(deliveryOrder.actualTotalWeightKg, { maxFractionDigits: 2 })
                : actualTotals.weightKg > 0
                    ? actualTotals.weightKg
                    : undefined;
        const fallbackDropPoint = buildFallbackActualDropPoint(deliveryOrder, actualTotals);
        const actualDropPoints =
            Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0
                ? deliveryOrder.actualDropPoints
                : fallbackDropPoint && deliveryOrder.status === 'DELIVERED'
                    ? [fallbackDropPoint]
                    : deliveryOrder.actualDropPoints;

        const service = extractRefId(deliveryOrder.serviceRef)
            ? serviceMap.get(extractRefId(deliveryOrder.serviceRef) as string)
            : undefined;
        const vehicle = extractRefId(deliveryOrder.vehicleRef)
            ? vehicleMap.get(extractRefId(deliveryOrder.vehicleRef) as string)
            : undefined;
        const tripRouteRate = extractRefId(deliveryOrder.tripRouteRateRef)
            ? tripRouteRateMap.get(extractRefId(deliveryOrder.tripRouteRateRef) as string)
            : undefined;
        const routeOvertonaseRatePerKg = getTripRouteOvertonaseRatePerKg(tripRouteRate);
        const deliveryOrderOvertonaseRatePerKg = normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? 0);
        const effectiveOvertonaseRatePerKg =
            deliveryOrderOvertonaseRatePerKg > 0
                ? deliveryOrderOvertonaseRatePerKg
                : routeOvertonaseRatePerKg;
        const deliveryOrderUnderloadRatePerKg = normalizeCurrencyNumber(deliveryOrder.underloadDriverRatePerKg ?? 0);
        const effectiveUnderloadRatePerKg =
            deliveryOrderUnderloadRatePerKg > 0
                ? deliveryOrderUnderloadRatePerKg
                : routeOvertonaseRatePerKg;
        const underloadRateMode: DeliveryOrder['underloadRateMode'] =
            deliveryOrder.underloadRateMode === 'custom' ? 'custom' : undefined;
        const serviceMaxPayloadKg =
            normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 }) > 0
                ? normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 })
                : normalizeNumber(service?.maxPayloadKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(service?.maxPayloadKg, { maxFractionDigits: 2 })
                    : undefined;
        const vehicleCapacityKg =
            normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 }) > 0
                ? normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 })
                : normalizeNumber(vehicle?.capacityKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(vehicle?.capacityKg, { maxFractionDigits: 2 })
                    : undefined;
        const derivedOvertonage =
            actualTotalWeightKg && actualTotalWeightKg > 0
                ? computeDeliveryOrderOvertonage({
                    actualTotalWeightKg,
                    serviceMaxPayloadKg,
                    vehicleCapacityKg,
                    baseTripFee: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0),
                    overtonaseDriverRatePerKg: effectiveOvertonaseRatePerKg,
                    manualOvertonaseWeightKg: deliveryOrder.manualOvertonaseWeightKg,
                    underloadDriverRatePerKg: effectiveUnderloadRatePerKg,
                    manualUnderloadWeightKg: deliveryOrder.manualUnderloadWeightKg,
                })
                : null;

        return {
            ...deliveryOrder,
            taripBorongan: derivedOvertonage?.effectiveTripFee ?? deliveryOrder.taripBorongan,
            actualTotalWeightKg,
            actualDropPoints,
            cargoFinalizedAt: resolveDeliveredTimestamp(deliveryOrder, linkedTrackingLogs),
            cargoFinalizedBy:
                normalizeOptionalText(deliveryOrder.cargoFinalizedBy)
                || normalizeOptionalText(deliveredTrackingLog?.userRef),
            cargoFinalizedByName:
                normalizeOptionalText(deliveryOrder.cargoFinalizedByName)
                || normalizeOptionalText(deliveredTrackingLog?.userName),
            serviceMaxPayloadKg:
                normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 })
                    : derivedOvertonage?.serviceMaxPayloadKg,
            vehicleCapacityKg:
                normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 })
                    : derivedOvertonage?.vehicleCapacityKg,
            overtonaseWeightKg:
                derivedOvertonage?.overtonaseWeightKg,
            manualOvertonaseWeightKg:
                derivedOvertonage?.manualOvertonaseWeightKg ?? deliveryOrder.manualOvertonaseWeightKg,
            overtonaseDriverRatePerKg:
                deliveryOrderOvertonaseRatePerKg > 0
                    ? deliveryOrderOvertonaseRatePerKg
                    : derivedOvertonage?.overtonaseDriverRatePerKg,
            overtonaseDriverAmount:
                derivedOvertonage?.overtonaseDriverAmount,
            vehicleCapacityExceededKg:
                derivedOvertonage?.vehicleCapacityExceededKg,
            underloadWeightKg:
                derivedOvertonage?.underloadWeightKg,
            manualUnderloadWeightKg:
                derivedOvertonage?.manualUnderloadWeightKg ?? deliveryOrder.manualUnderloadWeightKg,
            underloadRateMode,
            underloadDriverRatePerKg:
                deliveryOrderUnderloadRatePerKg > 0
                    ? deliveryOrderUnderloadRatePerKg
                    : derivedOvertonage?.underloadDriverRatePerKg,
            underloadDeductionAmount:
                derivedOvertonage?.underloadDeductionAmount,
        };
    });

    return canUseCache
        ? setResponseDerivationCache(cacheKey, derivedDeliveryOrders)
        : derivedDeliveryOrders;
}

export async function deriveFreightNotaItemsForResponse(items: FreightNotaItem[]) {
    if (items.length === 0) {
        return items;
    }

    const doRefs = [
        ...new Set(
            items
                .map(item => normalizeOptionalText(item.doRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const deliveryOrderItemRefs = [
        ...new Set(
            items.flatMap(item => {
                const refs = Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
                    ? item.deliveryOrderItemRefs
                    : item.deliveryOrderItemRef
                        ? [item.deliveryOrderItemRef]
                        : [];
                return refs
                    .map(value => normalizeOptionalText(value))
                    .filter((value): value is string => Boolean(value));
            }),
        ),
    ];

    const [deliveryOrders, deliveryOrderItemsById, deliveryOrderItemsByDoRef] = await Promise.all([
        doRefs.length > 0
            ? listDocumentsByFilter<FreightNotaDeliveryOrderSource>('deliveryOrder', { _id: doRefs })
            : Promise.resolve([]),
        deliveryOrderItemRefs.length > 0
            ? listDocumentsByFilter<FreightNotaDeliveryOrderItemResponseSource>('deliveryOrderItem', { _id: deliveryOrderItemRefs })
            : Promise.resolve([]),
        doRefs.length > 0
            ? listDocumentsByFilter<FreightNotaDeliveryOrderItemResponseSource>('deliveryOrderItem', { deliveryOrderRef: doRefs })
            : Promise.resolve([]),
    ]);

    const relevantDeliveryOrderItems = [
        ...new Map(
            [...deliveryOrderItemsById, ...deliveryOrderItemsByDoRef]
                .map(item => [normalizeOptionalText(item._id) || `${normalizeOptionalText(item.deliveryOrderRef)}::${normalizeOptionalText(item.shipperReferenceNumber)}`, item])
        ).values(),
    ];

    const orderRefs = [
        ...new Set(
            deliveryOrders
                .map(item => extractRefId(item.orderRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const orders = orderRefs.length > 0
        ? await listDocumentsByFilter<FreightNotaOrderResponseSource>('order', { _id: orderRefs })
        : [];

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const orderMap = new Map(orders.map(item => [item._id, item]));
    const deliveryOrderItemsByRef = new Map<string, FreightNotaDeliveryOrderItemResponseSource[]>();
    const deliveryOrderItemById = new Map<string, FreightNotaDeliveryOrderItemResponseSource>();
    for (const item of relevantDeliveryOrderItems) {
        const itemId = normalizeOptionalText(item._id);
        if (itemId) {
            deliveryOrderItemById.set(itemId, item);
        }
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = deliveryOrderItemsByRef.get(deliveryOrderRef) || [];
        current.push(item);
        deliveryOrderItemsByRef.set(deliveryOrderRef, current);
    }

    return items.map(item => {
        const deliveryOrder = normalizeOptionalText(item.doRef)
            ? deliveryOrderMap.get(item.doRef as string)
            : undefined;
        if (!deliveryOrder) {
            return item;
        }

        const linkedOrder = extractRefId(deliveryOrder.orderRef)
            ? orderMap.get(extractRefId(deliveryOrder.orderRef) as string)
            : undefined;
        const rowItemRefs =
            Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
                ? item.deliveryOrderItemRefs
                : item.deliveryOrderItemRef
                    ? [item.deliveryOrderItemRef]
                    : [];
        const linkedItems = rowItemRefs
            .map(ref => deliveryOrderItemById.get(ref))
            .filter((value): value is FreightNotaDeliveryOrderItemResponseSource => Boolean(value));
        const itemSummary = linkedItems.length > 0
            ? summarizeDeliveryOrderItems(linkedItems)
            : summarizeDeliveryOrderItems(deliveryOrderItemsByRef.get(deliveryOrder._id) || []);
        const resolvedNoSj = resolveFreightNotaNoSj(item, deliveryOrder, linkedItems);
        const hasActualDropPoints = Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0;
        const billableCargoSummary = getDeliveryOrderBillableCargoSummary(deliveryOrder, resolvedNoSj);
        const billableDestinationSummary = getDeliveryOrderActualDropDestinations(deliveryOrder, {
            shipperReferenceNumber: resolvedNoSj,
            billableOnly: true,
        }).join(', ');
        const shouldUseBillableCargoSummary =
            hasActualDropPoints && hasDeliveryOrderBillableCargo(deliveryOrder, resolvedNoSj);
        const matchedShipperReference = (deliveryOrder.shipperReferences || []).find(reference =>
            normalizeOptionalText(reference.referenceNumber) === resolvedNoSj
        );

        return {
            ...item,
            doNumber: normalizeOptionalText(item.doNumber) || normalizeOptionalText(deliveryOrder.doNumber) || item.doNumber,
            noSJ: resolvedNoSj || item.noSJ,
            customerRef: normalizeOptionalText(item.customerRef) || normalizeOptionalText(linkedOrder?.customerRef) || item.customerRef,
            customerName: normalizeOptionalText(item.customerName) || normalizeOptionalText(linkedOrder?.customerName) || item.customerName,
            vehiclePlate: normalizeOptionalText(item.vehiclePlate) || normalizeOptionalText(deliveryOrder.vehiclePlate) || item.vehiclePlate,
            date: normalizeOptionalText(item.date) || normalizeOptionalText(deliveryOrder.date) || item.date,
            dari:
                normalizeOptionalText(item.dari)
                || normalizeOptionalText(deliveryOrder.pickupAddress)
                || normalizeOptionalText(linkedOrder?.pickupAddress)
                || item.dari,
            tujuan:
                (normalizeOptionalText(item.noSJ) === normalizeOptionalText(deliveryOrder.doNumber) || !normalizeOptionalText(item.tujuan))
                    ? (
                        normalizeOptionalText(matchedShipperReference?.receiverAddress)
                        || billableDestinationSummary
                        || normalizeOptionalText(item.tujuan)
                        || normalizeOptionalText(deliveryOrder.receiverAddress)
                        || normalizeOptionalText(linkedOrder?.receiverAddress)
                        || item.tujuan
                    )
                    : item.tujuan,
            barang: normalizeOptionalText(item.barang) || itemSummary.barang || item.barang,
            collie:
                normalizeNumber(item.collie ?? 0) > 0
                    ? normalizeNumber(item.collie ?? 0)
                    : shouldUseBillableCargoSummary && billableCargoSummary.qtyKoli > 0
                        ? billableCargoSummary.qtyKoli
                        : itemSummary.collie > 0
                            ? itemSummary.collie
                            : item.collie,
            beratKg:
                normalizeNumber(item.beratKg ?? 0) > 0
                    ? normalizeNumber(item.beratKg ?? 0)
                    : shouldUseBillableCargoSummary && billableCargoSummary.weightKg > 0
                        ? billableCargoSummary.weightKg
                        : itemSummary.beratKg > 0
                            ? itemSummary.beratKg
                            : item.beratKg,
        };
    });
}
