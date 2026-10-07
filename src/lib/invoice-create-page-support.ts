import { addDaysToDateValue, getBusinessDateValue } from './business-date';
import {
    getDeliveryOrderActualDropDestinations,
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderItemSpecificBillableCargoSummary,
    getDeliveryOrderNonBillableCargoSummary,
    hasDeliveryOrderBillableCargo,
    hasDeliveryOrderItemSpecificDropMapping,
} from './delivery-order-completion';
import type { CompanyProfile, Customer, DeliveryOrder, DeliveryOrderItem, Order } from './types';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { findLatestActualDropPoint, getActualDropPointSequence, isHoldContinuationStopType } from '@/lib/actual-drop-point-utils';

export interface NotaItemRow {
    id: string;
    doRef: string;
    deliveryOrderItemRef?: string;
    deliveryOrderItemRefs?: string[];
    actualDropPointKey?: string;
    customerRef?: string;
    customerName?: string;
    /**
     * Where this row's customer came from. `scalar` means neither the drop nor the SJ overrode it,
     * so the row silently inherits the order/DO customer — which must not be billed on a trip that
     * serves more than one customer.
     */
    customerSource?: 'drop' | 'reference' | 'scalar';
    doNumber: string;
    vehiclePlate: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang: string;
    collie: number;
    beratKg: number;
    volumeM3?: number;
    tarip: number;
    taripSource?: 'MASTER' | 'MANUAL';
    customerBillingRateRef?: string;
    customerBillingRateName?: string;
    customerBillingRateSnapshot?: number;
    uangRp: number;
    ket: string;
    plt: string;
    pc: string;
    k: string;
    kbl: string;
    invoiceLineDate: string;
}

export function createEmptyNotaRow(): NotaItemRow {
    return {
        id: Math.random().toString(36).slice(2),
        doRef: '',
        customerRef: '',
        customerName: '',
        doNumber: '',
        vehiclePlate: '',
        date: getBusinessDateValue(),
        noSJ: '',
        dari: '',
        tujuan: '',
        barang: '',
        collie: 0,
        beratKg: 0,
        volumeM3: 0,
        tarip: 0,
        taripSource: 'MANUAL',
        uangRp: 0,
        ket: '',
        plt: '',
        pc: '',
        k: '',
        kbl: '',
        invoiceLineDate: '',
    };
}

export function isEmptyNotaRow(row: NotaItemRow) {
    return (
        !row.doRef &&
        !row.customerRef &&
        !row.customerName &&
        !row.doNumber &&
        !row.vehiclePlate &&
        !row.noSJ &&
        !row.dari &&
        !row.tujuan &&
        !row.barang &&
        !row.ket &&
        !row.plt &&
        !row.pc &&
        !row.k &&
        !row.kbl &&
        !row.invoiceLineDate &&
        (row.collie || 0) === 0 &&
        (row.beratKg || 0) === 0 &&
        (row.volumeM3 || 0) === 0 &&
        (row.tarip || 0) === 0 &&
        (row.uangRp || 0) === 0
    );
}

export function getInvoiceRowItemRefs(row: Pick<NotaItemRow, 'deliveryOrderItemRef' | 'deliveryOrderItemRefs'>) {
    return Array.isArray(row.deliveryOrderItemRefs) && row.deliveryOrderItemRefs.length > 0
        ? row.deliveryOrderItemRefs
        : row.deliveryOrderItemRef
            ? [row.deliveryOrderItemRef]
            : [];
}

export function getInvoiceRowItemCoverageKeys(row: Pick<NotaItemRow, 'doRef' | 'deliveryOrderItemRef' | 'deliveryOrderItemRefs' | 'tujuan' | 'actualDropPointKey'>) {
    const itemRefs = getInvoiceRowItemRefs(row);
    const doRef = row.doRef || 'manual';
    const actualDropPointKey = row.actualDropPointKey?.trim();
    if (actualDropPointKey) {
        const tujuan = row.tujuan?.trim() || '-';
        return itemRefs.map(itemRef => `${doRef}::item::${itemRef}::tujuan::${tujuan}::drop::${actualDropPointKey}`);
    }
    return itemRefs.map(itemRef => `${doRef}::item::${itemRef}`);
}

export type FreightNotaCoverageItem = {
    doRef?: string | null;
    noSJ?: string | null;
    deliveryOrderItemRef?: string | null;
    deliveryOrderItemRefs?: string[] | null;
    tujuan?: string | null;
    actualDropPointKey?: string | null;
};

export function getFreightNotaItemCoverageKeys(
    item: FreightNotaCoverageItem,
    deliveryOrder?: Parameters<typeof buildFreightNotaCoverageRowKeys>[0]['deliveryOrder'] | null
) {
    const doRef = item.doRef?.trim();
    if (!doRef) {
        return [];
    }
    const itemRefs = Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
        ? item.deliveryOrderItemRefs
        : item.deliveryOrderItemRef
            ? [item.deliveryOrderItemRef]
            : [];
    if (itemRefs.length > 0) {
        return getInvoiceRowItemCoverageKeys({
            doRef,
            deliveryOrderItemRef: itemRefs[0],
            deliveryOrderItemRefs: itemRefs,
            tujuan: item.tujuan || '',
            actualDropPointKey: item.actualDropPointKey || '',
        });
    }
    if (deliveryOrder) {
        return buildFreightNotaCoverageRowKeys({
            deliveryOrder,
            noSJ: item.noSJ,
            deliveryOrderItemRefs: itemRefs,
        });
    }
    const noSJ = item.noSJ?.trim();
    return noSJ ? [`${doRef}::${noSJ}`] : [];
}

export function getInvoiceRowAvailabilityCoverageKeys(
    row: NotaItemRow,
    deliveryOrder?: Parameters<typeof buildFreightNotaCoverageRowKeys>[0]['deliveryOrder'] | null
) {
    const rowItemCoverageKeys = getInvoiceRowItemCoverageKeys(row);
    const rowItemBaseCoverageKeys = row.actualDropPointKey?.trim()
        ? getInvoiceRowItemRefs(row).map(itemRef => `${row.doRef || 'manual'}::item::${itemRef}`)
        : [];
    const rowKey = `${row.doRef || 'manual'}::${row.noSJ || row.id}`;
    const rowShipperCoverageKeys = deliveryOrder && row.doRef === deliveryOrder._id
        ? buildFreightNotaCoverageRowKeys({
            deliveryOrder,
            noSJ: row.noSJ,
            deliveryOrderItemRefs: [],
        })
        : [];
    return rowItemCoverageKeys.length > 0 || rowItemBaseCoverageKeys.length > 0 || rowShipperCoverageKeys.length > 0
        ? [...rowItemCoverageKeys, ...rowItemBaseCoverageKeys, ...rowShipperCoverageKeys]
        : [rowKey];
}

export function calculateNotaDueDate(baseDate: string, termDays: number) {
    return addDaysToDateValue(baseDate, termDays);
}

export function getSuggestedNotaDueDate(params: {
    customerRef: string;
    customers: Customer[];
    company: CompanyProfile | null;
    issueDate: string;
    dueDateTouched: boolean;
}) {
    if (params.dueDateTouched) return null;
    const customer = params.customerRef
        ? params.customers.find(item => item._id === params.customerRef)
        : null;
    const customerTerm = customer && Number.isFinite(customer.defaultPaymentTerm) && customer.defaultPaymentTerm >= 0
        ? customer.defaultPaymentTerm
        : null;
    const companyTerm = params.company?.invoiceSettings?.dueDateDays ?? params.company?.invoiceSettings?.defaultTermDays;
    const termDays = customerTerm ?? (
        typeof companyTerm === 'number' && Number.isFinite(companyTerm) && companyTerm >= 0
            ? companyTerm
            : null
    );

    return termDays === null ? null : calculateNotaDueDate(params.issueDate, termDays);
}

export function buildFreightNotaCoverageRowKeys(params: {
    deliveryOrder: {
        _id: string;
        doNumber?: string;
        customerDoNumber?: string;
        shipperReferences?: Array<{ referenceNumber?: string | undefined }>;
    };
    noSJ?: string | null | undefined;
    deliveryOrderItemRefs?: string[] | null | undefined;
}) {
    const { deliveryOrder } = params;
    const doRef = deliveryOrder._id?.trim();
    const normalizedNoSJ = params.noSJ?.trim() || '';
    const normalizedItemRefs = Array.from(
        new Set(
            (params.deliveryOrderItemRefs || [])
                .map(value => value?.trim())
                .filter((value): value is string => Boolean(value))
        )
    );
    if (!doRef) {
        return [];
    }

    if (normalizedItemRefs.length > 0) {
        return normalizedItemRefs.map(itemRef => `${doRef}::item::${itemRef}`);
    }

    const doNumber = deliveryOrder.doNumber?.trim() || '';
    const customerDoNumber = deliveryOrder.customerDoNumber?.trim() || '';
    const explicitReferences = Array.from(
        new Set(
            (deliveryOrder.shipperReferences || [])
                .map(reference => reference.referenceNumber?.trim())
                .filter((value): value is string => Boolean(value))
        )
    );

    const coverageNumbers = new Set<string>();
    if (normalizedNoSJ) {
        coverageNumbers.add(normalizedNoSJ);
    }

    const matchesExplicitReference = normalizedNoSJ ? explicitReferences.includes(normalizedNoSJ) : false;
    const matchesLegacyHeaderNumber =
        normalizedNoSJ &&
        (normalizedNoSJ === doNumber || normalizedNoSJ === customerDoNumber);

    if (matchesLegacyHeaderNumber && !matchesExplicitReference) {
        if (doNumber) {
            coverageNumbers.add(doNumber);
        }
        if (customerDoNumber) {
            coverageNumbers.add(customerDoNumber);
        }
        explicitReferences.forEach(referenceNumber => coverageNumbers.add(referenceNumber));
    }

    return Array.from(coverageNumbers).map(referenceNumber => `${doRef}::${referenceNumber}`);
}

export function buildNotaRowsFromDeliveryOrder(params: {
    deliveryOrder: DeliveryOrder;
    orders: Order[];
    deliveryOrderItems: DeliveryOrderItem[];
}): NotaItemRow[] {
    const { deliveryOrder, orders, deliveryOrderItems } = params;
    const relatedOrder = orders.find(order => order._id === deliveryOrder.orderRef);
    const relatedItems = deliveryOrderItems.filter(item => item.deliveryOrderRef === deliveryOrder._id);
    const hasActualDropPoints = Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0;
    const actualDropPoints = Array.isArray(deliveryOrder.actualDropPoints) ? deliveryOrder.actualDropPoints : [];
    const actualDropPointsHaveReference = actualDropPoints.some(point => Boolean(point.shipperReferenceNumber?.trim()));
    const shipperReferences = (deliveryOrder.shipperReferences || [])
        .filter(reference => Boolean(reference.referenceNumber?.trim()))
        .map(reference => ({
            ...reference,
            referenceNumber: reference.referenceNumber!.trim(),
        }));
    const shipperReferenceMap = new Map(
        shipperReferences.map(reference => [reference.referenceNumber, reference])
    );
    const fallbackShipperReferenceNumber = shipperReferences[0]?.referenceNumber || deliveryOrder.customerDoNumber || deliveryOrder.doNumber || '';
    const baseRow = {
        doRef: deliveryOrder._id,
        customerRef: relatedOrder?.customerRef || deliveryOrder.customerRef || '',
        customerName: relatedOrder?.customerName || deliveryOrder.customerName || '',
        // Overridden per row below once a drop or an SJ supplies an explicit billing customer.
        customerSource: 'scalar' as const,
        doNumber: deliveryOrder.doNumber || '',
        vehiclePlate: deliveryOrder.vehiclePlate || '',
        date: deliveryOrder.date || getBusinessDateValue(),
        noSJ: fallbackShipperReferenceNumber,
        dari: deliveryOrder.pickupAddress || relatedOrder?.pickupAddress || '',
        tujuan: deliveryOrder.receiverAddress || relatedOrder?.receiverAddress || '',
        tarip: 0,
        uangRp: 0,
        ket: '',
        plt: '',
        pc: '',
        k: '',
        kbl: '',
        invoiceLineDate: '',
    };

    const hasCargo = (cargo: { qtyKoli: number; weightKg: number; volumeM3: number }) =>
        cargo.qtyKoli > 0 || cargo.weightKg > 0 || cargo.volumeM3 > 0;

    /**
     * Classifies where a row's billing customer came from. The explicit return type matters: without
     * it the ternary widens to `string` and the row builders no longer satisfy `NotaItemRow`.
     */
    const resolveRowCustomerSource = (
        dropBillingCustomerRef?: string | null,
        referenceBillingCustomerRef?: string | null
    ): NotaItemRow['customerSource'] => (
        (dropBillingCustomerRef || '').trim()
            ? 'drop'
            : (referenceBillingCustomerRef || '').trim() ? 'reference' : 'scalar'
    );

    const getItemActualOrPlannedCargo = (item: DeliveryOrderItem) => ({
        qtyKoli: parseFormattedNumberish(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0),
        weightKg: parseFormattedNumberish(item.actualWeightKg ?? item.orderItemWeight ?? 0),
        volumeM3: parseFormattedNumberish(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }),
    });

    const groupedItems = relatedItems.reduce<Map<string, DeliveryOrderItem[]>>((acc, item) => {
        const key = item.shipperReferenceNumber?.trim() || fallbackShipperReferenceNumber || 'TANPA-SJ';
        const current = acc.get(key) || [];
        current.push(item);
        acc.set(key, current);
        return acc;
    }, new Map());
    const shouldScopeDropsByReference = actualDropPointsHaveReference || shipperReferences.length > 1 || groupedItems.size > 1;
    const getDropReferenceScope = (shipperReferenceNumber: string) =>
        shouldScopeDropsByReference ? shipperReferenceNumber : undefined;
    const getReferenceBillableCargo = (shipperReferenceNumber: string) =>
        getDeliveryOrderBillableCargoSummary(deliveryOrder, getDropReferenceScope(shipperReferenceNumber));
    const getReferenceNonBillableCargo = (shipperReferenceNumber: string) =>
        getDeliveryOrderNonBillableCargoSummary(deliveryOrder, getDropReferenceScope(shipperReferenceNumber));
    const getReferenceDestinationSummary = (shipperReferenceNumber: string, deliveryOrderItemRef?: string) =>
        getDeliveryOrderActualDropDestinations(deliveryOrder, {
            shipperReferenceNumber: getDropReferenceScope(shipperReferenceNumber),
            billableOnly: true,
            deliveryOrderItemRef,
        }).join(', ');
    const getActualDropDestination = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) =>
        point.locationAddress?.trim() || point.locationName?.trim() || '';
    const getActualDropPointItemRefs = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => [
        point.deliveryOrderItemRef,
        ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
    ].map(value => (value || '').trim()).filter(Boolean);
    const actualDropPointMatchesCargo = (
        point: NonNullable<DeliveryOrder['actualDropPoints']>[number],
        shipperReferenceNumber: string,
        deliveryOrderItemRef?: string
    ) => {
        const normalizedReference = (getDropReferenceScope(shipperReferenceNumber) || '').trim();
        if (normalizedReference && (point.shipperReferenceNumber || '').trim() !== normalizedReference) {
            return false;
        }
        const normalizedItemRef = (deliveryOrderItemRef || '').trim();
        if (!normalizedItemRef) {
            return true;
        }
        const pointItemRefs = getActualDropPointItemRefs(point);
        return pointItemRefs.length === 0 || pointItemRefs.includes(normalizedItemRef);
    };
    const getActualDropOrigin = (
        point: NonNullable<DeliveryOrder['actualDropPoints']>[number],
        _pointIndex: number,
        shipperReferenceNumber: string,
        deliveryOrderItemRef?: string
    ) => {
        const explicitOrigin = point.originLocationName?.trim() || point.originLocationAddress?.trim() || '';
        if (explicitOrigin) {
            return explicitOrigin;
        }

        const actualPointIndex = Math.max(actualDropPoints.indexOf(point), 0);
        const pointSequence = getActualDropPointSequence(point, actualPointIndex);
        const holdPoint = findLatestActualDropPoint(actualDropPoints, (candidate, candidateIndex) => {
            if (!isHoldContinuationStopType(candidate.stopType)) {
                return false;
            }
            if (!actualDropPointMatchesCargo(candidate, shipperReferenceNumber, deliveryOrderItemRef)) {
                return false;
            }
            const candidateSequence = getActualDropPointSequence(candidate, candidateIndex);
            return candidateSequence < pointSequence || (candidateSequence === pointSequence && candidateIndex < actualPointIndex);
        });

        if (holdPoint) {
            return holdPoint.locationName?.trim() || holdPoint.locationAddress?.trim() || '';
        }

        return '';
    };
    const getActualDropCargoSummary = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => ({
        qtyKoli: parseFormattedNumberish(point.qtyKoli || 0),
        weightKg: parseFormattedNumberish(point.weightKg ?? point.weightInputValue ?? 0),
        volumeM3: parseFormattedNumberish(point.volumeM3 ?? point.volumeInputValue ?? 0, { maxFractionDigits: 3 }),
    });
    const getBillableActualDropPointsForItem = (shipperReferenceNumber: string, item: DeliveryOrderItem) => {
        const scopedReference = getDropReferenceScope(shipperReferenceNumber);
        const normalizedReference = (scopedReference || '').trim();
        return actualDropPoints
            .filter(point => {
                if (!['DROP', 'EXTRA_DROP'].includes(point.stopType || '')) {
                    return false;
                }
                if (normalizedReference && (point.shipperReferenceNumber || '').trim() !== normalizedReference) {
                    return false;
                }
                const pointItemRefs = getActualDropPointItemRefs(point);
                return pointItemRefs.includes(item._id);
            })
            .sort((left, right) => {
                const leftIndex = Math.max(actualDropPoints.indexOf(left), 0);
                const rightIndex = Math.max(actualDropPoints.indexOf(right), 0);
                const leftSequence = getActualDropPointSequence(left, leftIndex);
                const rightSequence = getActualDropPointSequence(right, rightIndex);
                return leftSequence - rightSequence || leftIndex - rightIndex;
            });
    };
    const getActualDropBillingContext = (shipperReferenceNumber: string, deliveryOrderItemRef?: string) => {
        const scopedReference = getDropReferenceScope(shipperReferenceNumber);
        const normalizedReference = (scopedReference || '').trim();
        const normalizedItemRef = (deliveryOrderItemRef || '').trim();
        const billableDrop = actualDropPoints.find(point => {
            if (!['DROP', 'EXTRA_DROP'].includes(point.stopType || '')) {
                return false;
            }
            if (normalizedReference && (point.shipperReferenceNumber || '').trim() !== normalizedReference) {
                return false;
            }
            if (normalizedItemRef) {
                const pointItemRefs = [
                    point.deliveryOrderItemRef,
                    ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
                ].map(value => (value || '').trim()).filter(Boolean);
                if (pointItemRefs.length > 0 && !pointItemRefs.includes(normalizedItemRef)) {
                    return false;
                }
            }
            return Boolean(point.billingCustomerRef || point.billingCustomerName);
        });

        return {
            customerRef: billableDrop?.billingCustomerRef || '',
            customerName: billableDrop?.billingCustomerName || '',
        };
    };

    const buildShipperReferenceRow = (
        shipperReferenceNumber: string,
        items: DeliveryOrderItem[] = []
    ): NotaItemRow => {
        const matchedReference = shipperReferenceMap.get(shipperReferenceNumber.trim());
        const actualDropBilling = getActualDropBillingContext(shipperReferenceNumber);
        const billableItems = hasActualDropPoints
            ? items.filter(item => {
                const itemBillableCargo = getDeliveryOrderBillableCargoSummary(
                    deliveryOrder,
                    shipperReferenceNumber,
                    item._id
                );
                return itemBillableCargo.qtyKoli > 0 || itemBillableCargo.weightKg > 0 || itemBillableCargo.volumeM3 > 0;
            })
            : items;
        const itemDescriptions = billableItems.length > 0
            ? [...new Set(billableItems.map(item => item.orderItemDescription?.trim()).filter((value): value is string => Boolean(value)))].join(', ')
            : '';
        const billableCargo = getReferenceBillableCargo(shipperReferenceNumber);
        const destinationSummary = getReferenceDestinationSummary(shipperReferenceNumber);

        return {
            id: Math.random().toString(36).slice(2),
            ...baseRow,
            deliveryOrderItemRef: billableItems[0]?._id,
            deliveryOrderItemRefs: billableItems.map(item => item._id).filter(Boolean),
            customerRef: actualDropBilling.customerRef || matchedReference?.billingCustomerRef || baseRow.customerRef,
            customerName: actualDropBilling.customerName || matchedReference?.billingCustomerName || baseRow.customerName,
            customerSource: resolveRowCustomerSource(actualDropBilling.customerRef, matchedReference?.billingCustomerRef),
            noSJ: shipperReferenceNumber,
            dari: matchedReference?.pickupAddress || baseRow.dari,
            tujuan:
                (hasActualDropPoints && destinationSummary) ||
                matchedReference?.receiverAddress ||
                baseRow.tujuan,
            barang: itemDescriptions,
            collie: hasActualDropPoints
                ? billableCargo.qtyKoli
                : items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0), 0),
            beratKg: hasActualDropPoints
                ? billableCargo.weightKg
                : items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualWeightKg ?? item.orderItemWeight ?? 0), 0),
            volumeM3: hasActualDropPoints
                ? billableCargo.volumeM3
                : items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
        };
    };

    const buildItemRow = (
        shipperReferenceNumber: string,
        item: DeliveryOrderItem,
        options?: {
            billableCargoOverride?: { qtyKoli: number; weightKg: number; volumeM3: number };
            useSpecificBillableCargo?: boolean;
        }
    ): NotaItemRow | null => {
        const matchedReference = shipperReferenceMap.get(shipperReferenceNumber.trim());
        const actualDropBilling = getActualDropBillingContext(shipperReferenceNumber, item._id);
        const itemActualCargo = getItemActualOrPlannedCargo(item);
        const itemSpecificBillableCargo = getDeliveryOrderItemSpecificBillableCargoSummary(
            deliveryOrder,
            getDropReferenceScope(shipperReferenceNumber),
            item._id
        );
        const destinationSummary = getReferenceDestinationSummary(shipperReferenceNumber, item._id);
        const billableCargo = options?.billableCargoOverride
            || (options?.useSpecificBillableCargo
                ? itemSpecificBillableCargo
                : itemActualCargo);

        if (hasActualDropPoints && !hasCargo(billableCargo)) {
            return null;
        }

        return {
            id: `${deliveryOrder._id}-${item._id}`,
            ...baseRow,
            deliveryOrderItemRef: item._id,
            deliveryOrderItemRefs: [item._id],
            customerRef: actualDropBilling.customerRef || matchedReference?.billingCustomerRef || baseRow.customerRef,
            customerName: actualDropBilling.customerName || matchedReference?.billingCustomerName || baseRow.customerName,
            customerSource: resolveRowCustomerSource(actualDropBilling.customerRef, matchedReference?.billingCustomerRef),
            noSJ: shipperReferenceNumber,
            dari: matchedReference?.pickupAddress || baseRow.dari,
            tujuan:
                (hasActualDropPoints && destinationSummary) ||
                matchedReference?.receiverAddress ||
                baseRow.tujuan,
            barang: item.orderItemDescription?.trim() || '',
            collie: billableCargo.qtyKoli,
            beratKg: billableCargo.weightKg,
            volumeM3: billableCargo.volumeM3,
        };
    };
    const buildActualDropPointItemRow = (
        shipperReferenceNumber: string,
        item: DeliveryOrderItem,
        point: NonNullable<DeliveryOrder['actualDropPoints']>[number],
        pointIndex: number
    ): NotaItemRow | null => {
        const matchedReference = shipperReferenceMap.get(shipperReferenceNumber.trim());
        const billableCargo = getActualDropCargoSummary(point);
        if (!hasCargo(billableCargo)) {
            return null;
        }
        return {
            id: `${deliveryOrder._id}-${item._id}-${point._key || point.sequence || pointIndex}`,
            ...baseRow,
            deliveryOrderItemRef: item._id,
            deliveryOrderItemRefs: [item._id],
            actualDropPointKey: point._key || `${point.sequence ?? pointIndex}`,
            customerRef: point.billingCustomerRef || matchedReference?.billingCustomerRef || baseRow.customerRef,
            customerName: point.billingCustomerName || matchedReference?.billingCustomerName || baseRow.customerName,
            customerSource: resolveRowCustomerSource(point.billingCustomerRef, matchedReference?.billingCustomerRef),
            noSJ: shipperReferenceNumber,
            dari: getActualDropOrigin(point, pointIndex, shipperReferenceNumber, item._id) || matchedReference?.pickupAddress || baseRow.dari,
            tujuan:
                getActualDropDestination(point) ||
                matchedReference?.receiverAddress ||
                baseRow.tujuan,
            barang: item.orderItemDescription?.trim() || '',
            collie: billableCargo.qtyKoli,
            beratKg: billableCargo.weightKg,
            volumeM3: billableCargo.volumeM3,
        };
    };
    if (relatedItems.length === 0) {
        if (shipperReferences.length > 0) {
            const rows = shipperReferences.map(reference => {
                const billableCargo = getDeliveryOrderBillableCargoSummary(deliveryOrder, reference.referenceNumber);
                const destinationSummary = getDeliveryOrderActualDropDestinations(deliveryOrder, {
                    shipperReferenceNumber: reference.referenceNumber,
                    billableOnly: true,
                }).join(', ');
                const actualDropBilling = getActualDropBillingContext(reference.referenceNumber);

                return {
                    id: Math.random().toString(36).slice(2),
                    ...baseRow,
                    customerRef: actualDropBilling.customerRef || reference.billingCustomerRef || baseRow.customerRef,
                    customerName: actualDropBilling.customerName || reference.billingCustomerName || baseRow.customerName,
                    customerSource: resolveRowCustomerSource(actualDropBilling.customerRef, reference.billingCustomerRef),
                    noSJ: reference.referenceNumber,
                    dari: reference.pickupAddress || baseRow.dari,
                    tujuan:
                        (hasActualDropPoints && destinationSummary) ||
                        reference.receiverAddress ||
                        baseRow.tujuan,
                    barang: '',
                    collie: hasActualDropPoints ? billableCargo.qtyKoli : 0,
                    beratKg: hasActualDropPoints ? billableCargo.weightKg : 0,
                    volumeM3: hasActualDropPoints ? billableCargo.volumeM3 : 0,
                };
            });

            return hasActualDropPoints
                ? rows.filter(row => (row.collie || 0) > 0 || (row.beratKg || 0) > 0)
                : rows;
        }

        return [{
            id: Math.random().toString(36).slice(2),
            ...baseRow,
            barang: '',
            collie: 0,
            beratKg: 0,
            volumeM3: 0,
        }];
    }

    const rows: NotaItemRow[] = [];
    const emittedReferences = new Set<string>();

    // Item-anchored fallback: a billable DROP point without its own SJ tag still
    // proves delivery when it names items of this SJ. Without it, a combined
    // drop covering several SJs matches no reference scope and every SJ is
    // skipped even though per-item attribution data fully exists. Each item
    // belongs to exactly one SJ, so rows stay partitioned (no double billing).
    const hasItemAnchoredBillableCargo = (items: DeliveryOrderItem[]) => items.some(item => {
        const itemActual = getItemActualOrPlannedCargo(item);
        if (!hasCargo({ qtyKoli: itemActual.qtyKoli, weightKg: itemActual.weightKg, volumeM3: itemActual.volumeM3 })) {
            return false;
        }
        return actualDropPoints.some(point => {
            if (!['DROP', 'EXTRA_DROP'].includes(point.stopType || '')) {
                return false;
            }
            if ((point.shipperReferenceNumber || '').trim()) {
                return false;
            }
            if (!hasCargo(getActualDropCargoSummary(point))) {
                return false;
            }
            return getActualDropPointItemRefs(point).includes(item._id);
        });
    });

    for (const reference of shipperReferences) {
        const shipperReferenceNumber = reference.referenceNumber;
        emittedReferences.add(shipperReferenceNumber);
        const itemsForReference = groupedItems.get(shipperReferenceNumber) || [];
        const hasSpecificMapping = hasDeliveryOrderItemSpecificDropMapping(deliveryOrder, shipperReferenceNumber);
        const referenceBillableCargo = getReferenceBillableCargo(shipperReferenceNumber);
        const nonBillableCargo = getReferenceNonBillableCargo(shipperReferenceNumber);
        const hasNonBillableOutcome = hasActualDropPoints && hasCargo(nonBillableCargo);

        if (hasActualDropPoints && !hasCargo(referenceBillableCargo) && !hasItemAnchoredBillableCargo(itemsForReference)) {
            continue;
        }

        const itemRows = itemsForReference
            .flatMap(item => {
                if (hasActualDropPoints && hasSpecificMapping) {
                    const pointRows = getBillableActualDropPointsForItem(shipperReferenceNumber, item)
                        .map((point, pointIndex) => buildActualDropPointItemRow(shipperReferenceNumber, item, point, pointIndex))
                        .filter((row): row is NotaItemRow => Boolean(row));
                    if (pointRows.length > 0) {
                        return pointRows;
                    }
                }
                const row = buildItemRow(shipperReferenceNumber, item, {
                    billableCargoOverride: hasActualDropPoints && !hasSpecificMapping && hasNonBillableOutcome && itemsForReference.length === 1
                        ? referenceBillableCargo
                        : undefined,
                    useSpecificBillableCargo: hasSpecificMapping,
                });
                return row ? [row] : [];
            })
            .filter((row): row is NotaItemRow => Boolean(row));

        if (itemRows.length > 0) {
            rows.push(...itemRows);
            continue;
        }

        rows.push(buildShipperReferenceRow(shipperReferenceNumber, itemsForReference));
    }

    for (const [shipperReferenceNumber, items] of groupedItems.entries()) {
        if (emittedReferences.has(shipperReferenceNumber)) {
            continue;
        }
        const hasSpecificMapping = hasDeliveryOrderItemSpecificDropMapping(deliveryOrder, shipperReferenceNumber);
        const referenceBillableCargo = getReferenceBillableCargo(shipperReferenceNumber);
        const nonBillableCargo = getReferenceNonBillableCargo(shipperReferenceNumber);
        const hasNonBillableOutcome = hasActualDropPoints && hasCargo(nonBillableCargo);

        if (hasActualDropPoints && !hasCargo(referenceBillableCargo) && !hasItemAnchoredBillableCargo(items)) {
            continue;
        }

        const itemRows = items
            .flatMap(item => {
                if (hasActualDropPoints && hasSpecificMapping) {
                    const pointRows = getBillableActualDropPointsForItem(shipperReferenceNumber, item)
                        .map((point, pointIndex) => buildActualDropPointItemRow(shipperReferenceNumber, item, point, pointIndex))
                        .filter((row): row is NotaItemRow => Boolean(row));
                    if (pointRows.length > 0) {
                        return pointRows;
                    }
                }
                const row = buildItemRow(shipperReferenceNumber, item, {
                    billableCargoOverride: hasActualDropPoints && !hasSpecificMapping && hasNonBillableOutcome && items.length === 1
                        ? referenceBillableCargo
                        : undefined,
                    useSpecificBillableCargo: hasSpecificMapping,
                });
                return row ? [row] : [];
            })
            .filter((row): row is NotaItemRow => Boolean(row));

        if (itemRows.length > 0) {
            rows.push(...itemRows);
            continue;
        }

        rows.push(buildShipperReferenceRow(shipperReferenceNumber, items));
    }

    if (!hasActualDropPoints) {
        return rows;
    }

    return rows.filter(row =>
        (row.collie || 0) > 0 ||
        (row.beratKg || 0) > 0 ||
        hasDeliveryOrderBillableCargo(deliveryOrder, getDropReferenceScope(row.noSJ))
    );
}
