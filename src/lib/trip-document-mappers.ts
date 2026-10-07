import {
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderHoldCargoSummary,
    getDeliveryOrderReturnCargoSummary,
} from './delivery-order-completion';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { convertVolumeToM3, convertWeightToKg, getWeightInputFractionDigits, readVolumeInputUnit, readWeightInputUnit } from '@/lib/measurement';
import type { DeliveryActualDropPoint, DeliveryOrder, DeliveryOrderItem, DeliveryOrderShipperReference, TrackingLog } from './types';
import type { CargoSummary, SuratJalanDocument, SuratJalanDocumentItem, SuratJalanItemRecord, SuratJalanRecord, Trip, TripRecord, TripShipperReferenceSummary, TripTrackingEvent } from './trip-document-types';
import {
    formatInternalDeliveryOrderNumber,
    formatShipperDeliveryOrderNumber,
    getShipperReferenceCount,
} from './utils';
import type { DOStatus } from './types';
import { findLatestActualDropPoint, isHoldContinuationStopType } from '@/lib/actual-drop-point-utils';

function createCargoSummary(): CargoSummary {
    return {
        qtyKoli: 0,
        weightKg: 0,
        volumeM3: 0,
    };
}

function summarizeDeliveryOrderItems(items: DeliveryOrderItem[]): CargoSummary {
    return items.reduce<CargoSummary>((sum, item) => ({
        qtyKoli: sum.qtyKoli + (item.orderItemQtyKoli || item.shippedQtyKoli || 0),
        weightKg: sum.weightKg + (item.orderItemWeight || item.shippedWeight || 0),
        volumeM3: sum.volumeM3 + (item.orderItemVolumeM3 || 0),
    }), createCargoSummary());
}

function summarizeActualDeliveryOrderItems(items: DeliveryOrderItem[]): CargoSummary {
    return items.reduce<CargoSummary>((sum, item) => ({
        qtyKoli: sum.qtyKoli + (item.actualQtyKoli || 0),
        weightKg: sum.weightKg + (item.actualWeightKg || 0),
        volumeM3: sum.volumeM3 + (item.actualVolumeM3 || 0),
    }), createCargoSummary());
}

function summarizeCargoSummaries(items: CargoSummary[]): CargoSummary {
    return items.reduce<CargoSummary>((sum, item) => ({
        qtyKoli: sum.qtyKoli + (item.qtyKoli || 0),
        weightKg: sum.weightKg + (item.weightKg || 0),
        volumeM3: sum.volumeM3 + (item.volumeM3 || 0),
    }), createCargoSummary());
}

export function getReferenceIdentity(reference: DeliveryOrderShipperReference, fallbackIndex: number) {
    return reference._key || reference.referenceNumber || `reference-${fallbackIndex + 1}`;
}

function getPrimarySuratJalanNumber(deliveryOrder: DeliveryOrder) {
    return formatShipperDeliveryOrderNumber(deliveryOrder, { mode: 'full' });
}

function hasCargo(summary: CargoSummary) {
    return summary.qtyKoli > 0 || summary.weightKg > 0 || summary.volumeM3 > 0;
}

function getActualDropPointCargo(point: NonNullable<DeliveryOrder['actualDropPoints']>[number]): CargoSummary {
    const weightUnit = readWeightInputUnit(point.weightInputUnit, 'KG');
    const volumeUnit = readVolumeInputUnit(point.volumeInputUnit, 'M3');
    const canonicalWeightKg = parseFormattedNumberish(point.weightKg || 0, {
        maxFractionDigits: 2,
    });
    const canonicalVolumeM3 = parseFormattedNumberish(point.volumeM3 || 0, {
        maxFractionDigits: 3,
    });
    return {
        qtyKoli: parseFormattedNumberish(point.qtyKoli || 0),
        weightKg:
            canonicalWeightKg > 0
                ? canonicalWeightKg
                : convertWeightToKg(
                      parseFormattedNumberish(point.weightInputValue || 0, {
                          maxFractionDigits: getWeightInputFractionDigits(weightUnit),
                      }),
                      weightUnit
                  ),
        volumeM3:
            canonicalVolumeM3 > 0
                ? canonicalVolumeM3
                : convertVolumeToM3(
                      parseFormattedNumberish(point.volumeInputValue || 0, {
                          maxFractionDigits: volumeUnit === 'LITER' ? 0 : 3,
                      }),
                      volumeUnit
                  ),
    };
}

function summarizeActualDropCargoByItems(
    deliveryOrder: DeliveryOrder,
    deliveryOrderItemRefs: Set<string>,
    allowedTypes: Set<string>
): CargoSummary {
    return (Array.isArray(deliveryOrder.actualDropPoints) ? deliveryOrder.actualDropPoints : [])
        .filter(point => allowedTypes.has((point.stopType || '').trim().toUpperCase()))
        .filter(point => {
            const pointItemRefs = [
                point.deliveryOrderItemRef,
                ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
            ].filter((value): value is string => Boolean(value));
            return pointItemRefs.length > 0 && pointItemRefs.some(itemRef => deliveryOrderItemRefs.has(itemRef));
        })
        .reduce<CargoSummary>((sum, point) => ({
            qtyKoli: sum.qtyKoli + getActualDropPointCargo(point).qtyKoli,
            weightKg: sum.weightKg + getActualDropPointCargo(point).weightKg,
            volumeM3: sum.volumeM3 + getActualDropPointCargo(point).volumeM3,
        }), createCargoSummary());
}

function findHoldPickupAddressForItems(
    deliveryOrder: DeliveryOrder,
    deliveryOrderItemRefs: Set<string>,
    referenceKey?: string,
    suratJalanNumber?: string
) {
    const normalizedReferenceKey = (referenceKey || '').trim();
    const normalizedSuratJalanNumber = (suratJalanNumber || '').trim().toUpperCase();
    const holdPoint = findLatestActualDropPoint(
        Array.isArray(deliveryOrder.actualDropPoints) ? deliveryOrder.actualDropPoints : [],
        point => {
            if (!isHoldContinuationStopType((point.stopType || '').trim().toUpperCase())) {
                return false;
            }
            if (!hasCargo(getActualDropPointCargo(point))) {
                return false;
            }
            const pointItemRefs = [
                point.deliveryOrderItemRef,
                ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
            ].filter((value): value is string => Boolean(value));
            if (pointItemRefs.length > 0 && pointItemRefs.some(itemRef => deliveryOrderItemRefs.has(itemRef))) {
                return true;
            }
            const pointReferenceKey = (point.shipperReferenceKey || '').trim();
            const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
            return Boolean(
                (normalizedReferenceKey && pointReferenceKey === normalizedReferenceKey) ||
                (normalizedSuratJalanNumber && pointReferenceNumber === normalizedSuratJalanNumber)
            );
        }
    );

    return holdPoint
        ? (holdPoint.locationName || holdPoint.locationAddress || '').trim()
        : '';
}

export function deriveTripOperationalStatusFromSuratJalanStatuses(
    baseStatus: DOStatus,
    statuses: DOStatus[]
): DOStatus {
    if (baseStatus === 'CANCELLED') {
        return 'CANCELLED';
    }
    if (statuses.length === 0) {
        return baseStatus;
    }
    if (statuses.every(status => status === 'CANCELLED')) {
        return 'CANCELLED';
    }

    const nonCancelledStatuses = statuses.filter(
        (status): status is Exclude<DOStatus, 'CANCELLED'> => status !== 'CANCELLED'
    );
    if (nonCancelledStatuses.length === 0) {
        return 'CANCELLED';
    }
    const uniqueStatuses = Array.from(new Set(nonCancelledStatuses));
    if (uniqueStatuses.length === 1) {
        return uniqueStatuses[0];
    }

    if (uniqueStatuses.includes('PARTIAL_HOLD')) {
        return 'PARTIAL_HOLD';
    }
    if (uniqueStatuses.includes('ARRIVED')) {
        return 'ARRIVED';
    }
    if (uniqueStatuses.includes('ON_DELIVERY')) {
        return 'ON_DELIVERY';
    }
    if (uniqueStatuses.every(status => status === 'DELIVERED')) {
        return 'DELIVERED';
    }
    return 'CREATED';
}

export function aggregateTripStatusFromSuratJalanStatuses(
    baseStatus: DOStatus,
    statuses: DOStatus[]
): DOStatus {
    return deriveTripOperationalStatusFromSuratJalanStatuses(baseStatus, statuses);
}

export function deriveSuratJalanDocumentStatus(
    baseStatus: DOStatus,
    document: Pick<SuratJalanDocument, 'billableCargo' | 'holdCargo' | 'returnCargo'>
): DOStatus {
    if (baseStatus === 'CANCELLED') {
        return 'CANCELLED';
    }

    const hasBillable = hasCargo(document.billableCargo);
    const hasHold = hasCargo(document.holdCargo);
    const hasReturn = hasCargo(document.returnCargo);
    const hasAnyOutcome = hasBillable || hasHold || hasReturn;

    if (!hasAnyOutcome) {
        return baseStatus;
    }
    if (hasHold) {
        return ['CREATED', 'ON_DELIVERY', 'ARRIVED'].includes(baseStatus)
            ? baseStatus
            : 'PARTIAL_HOLD';
    }
    return 'DELIVERED';
}

export function deriveTripStatusFromDocuments(
    baseStatus: DOStatus,
    documents: Array<Pick<SuratJalanDocument, 'billableCargo' | 'holdCargo' | 'returnCargo'>>
): DOStatus {
    const explicitStatuses = documents
        .map(document => ('tripStatus' in document ? (document as SuratJalanDocument).tripStatus : undefined))
        .filter((status): status is DOStatus => Boolean(status));
    if (explicitStatuses.length > 0) {
        return deriveTripOperationalStatusFromSuratJalanStatuses(baseStatus, explicitStatuses);
    }

    if (baseStatus === 'CANCELLED') {
        return 'CANCELLED';
    }
    if (documents.length === 0) {
        return baseStatus;
    }

    const statuses = documents.map(document => deriveSuratJalanDocumentStatus(baseStatus, document));
    return deriveTripOperationalStatusFromSuratJalanStatuses(baseStatus, statuses);
}

export function mapDeliveryOrderToTrip(deliveryOrder: DeliveryOrder, deliveryOrderItems: DeliveryOrderItem[] = []): Trip {
    const documents = mapDeliveryOrderToSuratJalanDocuments(deliveryOrder, deliveryOrderItems);
    const shipperReferenceLinks: TripShipperReferenceSummary[] = documents
        .filter(document => document.suratJalanNumber && document.suratJalanNumber !== '-')
        .map(document => ({
            id: document._id,
            label: document.suratJalanNumber,
            itemCount: document.itemCount,
            cargoSummary: document.cargoSummary,
            billableCargo: document.billableCargo,
            holdCargo: document.holdCargo,
            returnCargo: document.returnCargo,
        }));
    return {
        _id: deliveryOrder._id,
        _type: 'trip',
        sourceDeliveryOrderRef: deliveryOrder._id,
        tripNumber: formatInternalDeliveryOrderNumber(deliveryOrder),
        orderRef: deliveryOrder.orderRef,
        masterResi: deliveryOrder.masterResi,
        customerRef: deliveryOrder.customerRef,
        customerName: deliveryOrder.customerName,
        vehicleRef: deliveryOrder.vehicleRef,
        vehiclePlate: deliveryOrder.vehiclePlate,
        driverRef: deliveryOrder.driverRef,
        driverName: deliveryOrder.driverName,
        date: deliveryOrder.date,
        status: deriveTripStatusFromDocuments(deliveryOrder.status, documents),
        pickupAddress: deliveryOrder.pickupAddress,
        receiverName: deliveryOrder.receiverName,
        receiverPhone: deliveryOrder.receiverPhone,
        receiverAddress: deliveryOrder.receiverAddress,
        receiverCompany: deliveryOrder.receiverCompany,
        serviceRef: deliveryOrder.serviceRef,
        serviceName: deliveryOrder.serviceName,
        vehicleServiceRef: deliveryOrder.vehicleServiceRef,
        vehicleServiceName: deliveryOrder.vehicleServiceName,
        vehicleCategoryOverrideReason: deliveryOrder.vehicleCategoryOverrideReason,
        tripRouteRateRef: deliveryOrder.tripRouteRateRef,
        tripOriginArea: deliveryOrder.tripOriginArea,
        tripDestinationArea: deliveryOrder.tripDestinationArea,
        trackingState: deliveryOrder.trackingState,
        trackingStartedAt: deliveryOrder.trackingStartedAt,
        trackingStoppedAt: deliveryOrder.trackingStoppedAt,
        trackingLastSeenAt: deliveryOrder.trackingLastSeenAt,
        pendingDriverStatus: deliveryOrder.pendingDriverStatus,
        tripClosedByAdminAt: deliveryOrder.tripClosedByAdminAt,
        tripClosedByAdminRef: deliveryOrder.tripClosedByAdminRef,
        tripClosedByAdminName: deliveryOrder.tripClosedByAdminName,
        cargoFinalizedAt: deliveryOrder.cargoFinalizedAt,
        taripBorongan: deliveryOrder.taripBorongan,
        notes: deliveryOrder.notes,
        shipperReferenceCount: getShipperReferenceCount(deliveryOrder),
        shipperReferenceLinks,
        cargoSummary: summarizeDeliveryOrderItems(deliveryOrderItems),
        actualCargo: summarizeActualDeliveryOrderItems(deliveryOrderItems),
        billableCargo: summarizeCargoSummaries(documents.map(document => document.billableCargo)),
        holdCargo: summarizeCargoSummaries(documents.map(document => document.holdCargo)),
        returnCargo: summarizeCargoSummaries(documents.map(document => document.returnCargo)),
    };
}

export function mapTripRecordToTrip(tripRecord: TripRecord): Trip {
    return {
        _id: tripRecord._id,
        _type: 'trip',
        sourceDeliveryOrderRef: tripRecord.deliveryOrderRef || tripRecord._id,
        tripNumber: tripRecord.tripNumber,
        orderRef: tripRecord.orderRef || '',
        masterResi: tripRecord.masterResi,
        customerRef: tripRecord.customerRef,
        customerName: tripRecord.customerName,
        vehicleRef: tripRecord.vehicleRef,
        vehiclePlate: tripRecord.vehiclePlate,
        driverRef: tripRecord.driverRef,
        driverName: tripRecord.driverName,
        date: tripRecord.tripDate,
        status: tripRecord.status,
        pickupAddress: tripRecord.pickupAddress,
        receiverName: tripRecord.receiverName,
        receiverPhone: tripRecord.receiverPhone,
        receiverAddress: tripRecord.receiverAddress,
        receiverCompany: tripRecord.receiverCompany,
        serviceRef: tripRecord.serviceRef,
        serviceName: tripRecord.serviceName,
        vehicleServiceRef: tripRecord.vehicleServiceRef,
        vehicleServiceName: tripRecord.vehicleServiceName,
        vehicleCategoryOverrideReason: tripRecord.vehicleCategoryOverrideReason,
        tripRouteRateRef: tripRecord.tripRouteRateRef,
        tripOriginArea: tripRecord.tripOriginArea,
        tripDestinationArea: tripRecord.tripDestinationArea,
        trackingState: tripRecord.trackingState,
        trackingStartedAt: tripRecord.trackingStartedAt,
        trackingStoppedAt: tripRecord.trackingStoppedAt,
        trackingLastSeenAt: tripRecord.trackingLastSeenAt,
        pendingDriverStatus: tripRecord.pendingDriverStatus,
        tripClosedByAdminAt: tripRecord.tripClosedByAdminAt,
        tripClosedByAdminRef: tripRecord.tripClosedByAdminRef,
        tripClosedByAdminName: tripRecord.tripClosedByAdminName,
        cargoFinalizedAt: tripRecord.cargoFinalizedAt,
        taripBorongan: tripRecord.taripBorongan,
        notes: tripRecord.notes,
        shipperReferenceCount: 0,
        shipperReferenceLinks: [],
        cargoSummary: createCargoSummary(),
        actualCargo: createCargoSummary(),
        billableCargo: createCargoSummary(),
        holdCargo: createCargoSummary(),
        returnCargo: createCargoSummary(),
    };
}

export function mapDeliveryOrderToTripRecord(deliveryOrder: DeliveryOrder): TripRecord {
    const trip = mapDeliveryOrderToTrip(deliveryOrder);
    return {
        _id: trip._id,
        _type: 'trip',
        deliveryOrderRef: deliveryOrder._id,
        orderRef: trip.orderRef,
        tripNumber: trip.tripNumber,
        masterResi: trip.masterResi,
        customerRef: trip.customerRef,
        customerName: trip.customerName,
        vehicleRef: trip.vehicleRef,
        vehiclePlate: trip.vehiclePlate,
        driverRef: trip.driverRef,
        driverName: trip.driverName,
        tripDate: trip.date,
        status: trip.status,
        pickupAddress: trip.pickupAddress,
        receiverName: trip.receiverName,
        receiverPhone: trip.receiverPhone,
        receiverAddress: trip.receiverAddress,
        receiverCompany: trip.receiverCompany,
        serviceRef: trip.serviceRef,
        serviceName: trip.serviceName,
        vehicleServiceRef: trip.vehicleServiceRef,
        vehicleServiceName: trip.vehicleServiceName,
        vehicleCategoryOverrideReason: trip.vehicleCategoryOverrideReason,
        tripRouteRateRef: trip.tripRouteRateRef,
        tripOriginArea: trip.tripOriginArea,
        tripDestinationArea: trip.tripDestinationArea,
        trackingState: trip.trackingState,
        trackingStartedAt: trip.trackingStartedAt,
        trackingStoppedAt: trip.trackingStoppedAt,
        trackingLastSeenAt: trip.trackingLastSeenAt,
        pendingDriverStatus: trip.pendingDriverStatus,
        tripClosedByAdminAt: trip.tripClosedByAdminAt,
        tripClosedByAdminRef: trip.tripClosedByAdminRef,
        tripClosedByAdminName: trip.tripClosedByAdminName,
        cargoFinalizedAt: trip.cargoFinalizedAt,
        taripBorongan: trip.taripBorongan,
        notes: trip.notes,
    };
}

function mapDeliveryOrderReferenceToSuratJalanDocument(
    deliveryOrder: DeliveryOrder,
    deliveryOrderItems: DeliveryOrderItem[],
    reference: DeliveryOrderShipperReference | null,
    index: number,
    allActualDropPoints: DeliveryActualDropPoint[] = []
): SuratJalanDocument {
    const suratJalanNumber = reference?.referenceNumber || getPrimarySuratJalanNumber(deliveryOrder);
    const referenceKey = reference ? getReferenceIdentity(reference, index) : undefined;
    const matchedItems = reference
        ? deliveryOrderItems.filter(item =>
            item.shipperReferenceKey === reference._key ||
            item.shipperReferenceNumber === reference.referenceNumber
        )
        : deliveryOrderItems.filter(item => !item.shipperReferenceKey && !item.shipperReferenceNumber);
    const matchedItemRefs = new Set(matchedItems.map(item => item._id));
    const billableCargo = summarizeActualDropCargoByItems(deliveryOrder, matchedItemRefs, new Set(['DROP', 'EXTRA_DROP']));
    const holdCargo = summarizeActualDropCargoByItems(deliveryOrder, matchedItemRefs, new Set(['HOLD', 'TRANSIT']));
    const returnCargo = summarizeActualDropCargoByItems(deliveryOrder, matchedItemRefs, new Set(['RETURN']));
    const fallbackBillableCargo = getDeliveryOrderBillableCargoSummary(deliveryOrder, suratJalanNumber);
    const fallbackHoldCargo = getDeliveryOrderHoldCargoSummary(deliveryOrder, suratJalanNumber);
    const fallbackReturnCargo = getDeliveryOrderReturnCargoSummary(deliveryOrder, suratJalanNumber);
    const resolvedBillableCargo = hasCargo(billableCargo) ? billableCargo : fallbackBillableCargo;
    const resolvedHoldCargo = hasCargo(holdCargo) ? holdCargo : fallbackHoldCargo;
    const resolvedReturnCargo = hasCargo(returnCargo) ? returnCargo : fallbackReturnCargo;
    const holdPickupAddress = findHoldPickupAddressForItems(deliveryOrder, matchedItemRefs, referenceKey, suratJalanNumber);
    const suratJalanDate = reference?.date || deliveryOrder.date;
    const sjActualDropPoints = allActualDropPoints.filter(drop => {
        if (!referenceKey) {
            return !drop.shipperReferenceKey && !drop.shipperReferenceNumber;
        }
        return drop.shipperReferenceKey === referenceKey || drop.shipperReferenceNumber === suratJalanNumber;
    });

    return {
        _id: `${deliveryOrder._id}:${referenceKey || 'primary'}`,
        _type: 'suratJalan',
        sourceDeliveryOrderRef: deliveryOrder._id,
        tripRef: deliveryOrder._id,
        tripNumber: formatInternalDeliveryOrderNumber(deliveryOrder),
        orderRef: deliveryOrder.orderRef,
        masterResi: deliveryOrder.masterResi,
        customerRef: deliveryOrder.customerRef,
        customerName: deliveryOrder.customerName,
        referenceKey,
        suratJalanNumber,
        pickupAddress: holdPickupAddress || reference?.pickupAddress || deliveryOrder.pickupAddress,
        receiverName: reference?.receiverName || deliveryOrder.receiverName,
        receiverCompany: reference?.receiverCompany || deliveryOrder.receiverCompany,
        receiverAddress: reference?.receiverAddress || deliveryOrder.receiverAddress,
        tripOriginArea: deliveryOrder.tripOriginArea,
        tripDestinationArea: deliveryOrder.tripDestinationArea,
        tripDate: suratJalanDate,
        tripStatus: deriveSuratJalanDocumentStatus(deliveryOrder.status, {
            billableCargo: resolvedBillableCargo,
            holdCargo: resolvedHoldCargo,
            returnCargo: resolvedReturnCargo,
        }),
        vehiclePlate: deliveryOrder.vehiclePlate,
        driverName: deliveryOrder.driverName,
        itemCount: matchedItems.length,
        cargoSummary: summarizeDeliveryOrderItems(matchedItems),
        billableCargo: resolvedBillableCargo,
        holdCargo: resolvedHoldCargo,
        returnCargo: resolvedReturnCargo,
        actualDropPoints: sjActualDropPoints.length > 0 ? sjActualDropPoints : undefined,
    };
}

export function mapDeliveryOrderToSuratJalanDocuments(
    deliveryOrder: DeliveryOrder,
    deliveryOrderItems: DeliveryOrderItem[] = []
) {
    const references = deliveryOrder.shipperReferences || [];
    if (references.length === 0) {
        return [mapDeliveryOrderReferenceToSuratJalanDocument(deliveryOrder, deliveryOrderItems, null, 0, deliveryOrder.actualDropPoints || [])];
    }
    return references.map((reference, index) =>
        mapDeliveryOrderReferenceToSuratJalanDocument(deliveryOrder, deliveryOrderItems, reference, index, deliveryOrder.actualDropPoints || [])
    );
}

export function mapDeliveryOrderToSuratJalanRecords(
    deliveryOrder: DeliveryOrder,
    deliveryOrderItems: DeliveryOrderItem[] = []
): SuratJalanRecord[] {
    return mapDeliveryOrderToSuratJalanDocuments(deliveryOrder, deliveryOrderItems).map(document => ({
        _id: document._id,
        _type: 'suratJalan',
        tripRef: document.tripRef,
        deliveryOrderRef: deliveryOrder._id,
        orderRef: document.orderRef,
        customerRef: document.customerRef,
        customerName: document.customerName,
        referenceKey: document.referenceKey,
        suratJalanNumber: document.suratJalanNumber,
        pickupAddress: document.pickupAddress,
        receiverName: document.receiverName,
        receiverCompany: document.receiverCompany,
        receiverAddress: document.receiverAddress,
        tripDate: document.tripDate,
        tripStatus: document.tripStatus,
        vehiclePlate: document.vehiclePlate,
        driverName: document.driverName,
        itemCount: document.itemCount,
        cargoSummary: document.cargoSummary,
        billableCargo: document.billableCargo,
        holdCargo: document.holdCargo,
        returnCargo: document.returnCargo,
    }));
}

export function mapSuratJalanRecordToDocument(
    suratJalanRecord: SuratJalanRecord,
    trip?: Trip | null
): SuratJalanDocument {
    const derivedTripStatus = deriveSuratJalanDocumentStatus(
        suratJalanRecord.tripStatus || trip?.status || 'CREATED',
        {
            billableCargo: suratJalanRecord.billableCargo,
            holdCargo: suratJalanRecord.holdCargo,
            returnCargo: suratJalanRecord.returnCargo,
        }
    );
    return {
        _id: suratJalanRecord._id,
        _type: 'suratJalan',
        sourceDeliveryOrderRef: suratJalanRecord.deliveryOrderRef || trip?.sourceDeliveryOrderRef || suratJalanRecord.tripRef,
        tripRef: suratJalanRecord.tripRef,
        tripNumber: trip?.tripNumber || suratJalanRecord.tripRef,
        orderRef: suratJalanRecord.orderRef,
        masterResi: trip?.masterResi,
        customerRef: suratJalanRecord.customerRef,
        customerName: suratJalanRecord.customerName,
        referenceKey: suratJalanRecord.referenceKey,
        suratJalanNumber: suratJalanRecord.suratJalanNumber,
        pickupAddress: suratJalanRecord.pickupAddress,
        receiverName: suratJalanRecord.receiverName,
        receiverCompany: suratJalanRecord.receiverCompany,
        receiverAddress: suratJalanRecord.receiverAddress,
        tripOriginArea: trip?.tripOriginArea,
        tripDestinationArea: trip?.tripDestinationArea,
        tripDate: suratJalanRecord.tripDate,
        tripStatus: derivedTripStatus,
        vehiclePlate: suratJalanRecord.vehiclePlate || trip?.vehiclePlate,
        driverName: suratJalanRecord.driverName || trip?.driverName,
        itemCount: suratJalanRecord.itemCount,
        cargoSummary: suratJalanRecord.cargoSummary,
        billableCargo: suratJalanRecord.billableCargo,
        holdCargo: suratJalanRecord.holdCargo,
        returnCargo: suratJalanRecord.returnCargo,
    };
}

export function mapDeliveryOrdersToTrips(deliveryOrders: DeliveryOrder[]) {
    return deliveryOrders.map(deliveryOrder => mapDeliveryOrderToTrip(deliveryOrder));
}

export function mapDeliveryOrdersToSuratJalanDocuments(
    deliveryOrders: DeliveryOrder[],
    deliveryOrderItems: DeliveryOrderItem[]
) {
    const itemsByDeliveryOrderRef = deliveryOrderItems.reduce<Map<string, DeliveryOrderItem[]>>((acc, item) => {
        const rows = acc.get(item.deliveryOrderRef) || [];
        rows.push(item);
        acc.set(item.deliveryOrderRef, rows);
        return acc;
    }, new Map());

    return deliveryOrders.flatMap(deliveryOrder =>
        mapDeliveryOrderToSuratJalanDocuments(
            deliveryOrder,
            itemsByDeliveryOrderRef.get(deliveryOrder._id) || []
        )
    );
}

export function parseSuratJalanDocumentId(value: string) {
    const normalized = value.trim();
    const separatorIndex = normalized.indexOf(':');
    if (separatorIndex < 0) {
        return {
            tripRef: normalized,
            referenceKey: 'primary',
        };
    }

    return {
        tripRef: normalized.slice(0, separatorIndex),
        referenceKey: normalized.slice(separatorIndex + 1) || 'primary',
    };
}

export function matchesSuratJalanDocumentItem(
    document: SuratJalanDocument,
    item: DeliveryOrderItem
) {
    if (document.referenceKey && document.referenceKey !== 'primary') {
        return item.shipperReferenceKey === document.referenceKey || item.shipperReferenceNumber === document.suratJalanNumber;
    }

    return !item.shipperReferenceKey && !item.shipperReferenceNumber;
}

export function mapSuratJalanDocumentItem(
    document: SuratJalanDocument,
    item: DeliveryOrderItem,
    deliveryOrder?: DeliveryOrder
): SuratJalanDocumentItem {
    const billableActualCargo = deliveryOrder
        ? getDeliveryOrderBillableCargoSummary(deliveryOrder, document.suratJalanNumber, item._id)
        : createCargoSummary();
    const resolvedActualCargo = hasCargo(billableActualCargo)
        ? billableActualCargo
        : {
            qtyKoli: item.actualQtyKoli || 0,
            weightKg: item.actualWeightKg || 0,
            volumeM3: item.actualVolumeM3 || 0,
        };

    return {
        _id: `${document._id}:${item._id}`,
        _type: 'suratJalanItem',
        suratJalanRef: document._id,
        tripRef: document.tripRef,
        sourceDeliveryOrderItemRef: item._id,
        referenceKey: document.referenceKey,
        suratJalanNumber: document.suratJalanNumber,
        orderItemDescription: item.orderItemDescription,
        plannedCargo: {
            qtyKoli: item.orderItemQtyKoli || item.shippedQtyKoli || 0,
            weightKg: item.orderItemWeight || item.shippedWeight || 0,
            volumeM3: item.orderItemVolumeM3 || 0,
        },
        actualCargo: resolvedActualCargo,
    };
}

export function mapDeliveryOrderToSuratJalanDocumentItems(
    deliveryOrder: DeliveryOrder,
    deliveryOrderItems: DeliveryOrderItem[] = []
) {
    const documents = mapDeliveryOrderToSuratJalanDocuments(deliveryOrder, deliveryOrderItems);
    return documents.flatMap(document =>
        deliveryOrderItems
            .filter(item => matchesSuratJalanDocumentItem(document, item))
            .map(item => mapSuratJalanDocumentItem(document, item, deliveryOrder))
    );
}

export function mapDeliveryOrderToSuratJalanItemRecords(
    deliveryOrder: DeliveryOrder,
    deliveryOrderItems: DeliveryOrderItem[] = []
): SuratJalanItemRecord[] {
    return mapDeliveryOrderToSuratJalanDocumentItems(deliveryOrder, deliveryOrderItems).map(item => ({
        _id: item._id,
        _type: 'suratJalanItem',
        suratJalanRef: item.suratJalanRef,
        tripRef: item.tripRef,
        deliveryOrderItemRef: item.sourceDeliveryOrderItemRef,
        referenceKey: item.referenceKey,
        suratJalanNumber: item.suratJalanNumber,
        orderItemDescription: item.orderItemDescription,
        plannedCargo: item.plannedCargo,
        actualCargo: item.actualCargo,
    }));
}

export function mapSuratJalanItemRecordToDocumentItem(
    itemRecord: SuratJalanItemRecord
): SuratJalanDocumentItem {
    return {
        _id: itemRecord._id,
        _type: 'suratJalanItem',
        suratJalanRef: itemRecord.suratJalanRef,
        tripRef: itemRecord.tripRef,
        sourceDeliveryOrderItemRef: itemRecord.deliveryOrderItemRef || '',
        referenceKey: itemRecord.referenceKey,
        suratJalanNumber: itemRecord.suratJalanNumber,
        orderItemDescription: itemRecord.orderItemDescription,
        plannedCargo: itemRecord.plannedCargo,
        actualCargo: itemRecord.actualCargo,
    };
}

export function mapDeliveryOrdersToSuratJalanDocumentItems(
    deliveryOrders: DeliveryOrder[],
    deliveryOrderItems: DeliveryOrderItem[]
) {
    const itemsByDeliveryOrderRef = deliveryOrderItems.reduce<Map<string, DeliveryOrderItem[]>>((acc, item) => {
        const rows = acc.get(item.deliveryOrderRef) || [];
        rows.push(item);
        acc.set(item.deliveryOrderRef, rows);
        return acc;
    }, new Map());

    return deliveryOrders.flatMap(deliveryOrder =>
        mapDeliveryOrderToSuratJalanDocumentItems(
            deliveryOrder,
            itemsByDeliveryOrderRef.get(deliveryOrder._id) || []
        )
    );
}

export function mapTrackingLogToTripTrackingEvent(log: TrackingLog): TripTrackingEvent {
    return {
        _id: log._id,
        _type: 'tripTrackingEvent',
        tripRef: log.refRef,
        sourceTrackingLogRef: log._id,
        status: log.status,
        note: log.note,
        locationText: log.locationText,
        timestamp: log.timestamp,
        userRef: log.userRef,
        userName: log.userName,
        latitude: log.latitude,
        longitude: log.longitude,
        accuracyM: log.accuracyM,
        speedKph: log.speedKph,
        source: log.source,
    };
}

export function mapTrackingLogsToTripTrackingEvents(logs: TrackingLog[]) {
    return logs
        .filter(log => log.refType === 'DO')
        .map(mapTrackingLogToTripTrackingEvent);
}
