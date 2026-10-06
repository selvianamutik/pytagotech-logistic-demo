import type { DeliveryOrderPickupStop, DeliveryOrderShipperReference } from './types';
import { createDefaultOrderItemForm, type OrderItemForm } from './order-create-page-support';

export type DeliveryOrderCargoDraftItem = Omit<OrderItemForm, 'pickupStopKey' | 'shipperReferenceNumber'> & {
    deliveryOrderItemId?: string;
};

export type DeliveryOrderCargoDraftGroup = {
    id: string;
    shipperReferenceKey?: string;
    pickupStopKey: string;
    // Alamat pickup ketik manual. Dipakai hanya saat pickupStopKey kosong
    // (opsi "Tambah manual"), lalu dikirim sebagai pickupAddress.
    pickupAddress: string;
    shipperReferenceNumber: string;
    items: DeliveryOrderCargoDraftItem[];
};

type PickupStopLike = Pick<DeliveryOrderPickupStop, '_key'>;
type ShipperReferenceLike = Pick<DeliveryOrderShipperReference, '_key' | 'referenceNumber' | 'pickupStopKey' | 'pickupAddress'>;

export function toDeliveryOrderCargoDraftItem(item: DeliveryOrderCargoDraftItem | OrderItemForm): DeliveryOrderCargoDraftItem {
    return {
        manualEntry: item.manualEntry,
        customerProductRef: item.customerProductRef,
        description: item.description,
        qtyKoli: item.qtyKoli,
        weightInputValue: item.weightInputValue,
        weightInputUnit: item.weightInputUnit,
        autoWeightBasisQtyKoli: item.autoWeightBasisQtyKoli,
        autoWeightBasisWeightKg: item.autoWeightBasisWeightKg,
        autoVolumeBasisQtyKoli: item.autoVolumeBasisQtyKoli,
        autoVolumeBasisVolumeM3: item.autoVolumeBasisVolumeM3,
        volumeInputValue: item.volumeInputValue,
        volumeInputUnit: item.volumeInputUnit,
        value: item.value,
        id: item.id,
        deliveryOrderItemId: 'deliveryOrderItemId' in item ? item.deliveryOrderItemId : undefined,
    };
}

export function createDefaultDeliveryOrderCargoDraftItem(): DeliveryOrderCargoDraftItem {
    return toDeliveryOrderCargoDraftItem(createDefaultOrderItemForm());
}

export function createDefaultDeliveryOrderCargoDraftGroup(pickupStopKey = ''): DeliveryOrderCargoDraftGroup {
    return {
        id: crypto.randomUUID(),
        shipperReferenceKey: '',
        pickupStopKey,
        pickupAddress: '',
        shipperReferenceNumber: '',
        items: [createDefaultDeliveryOrderCargoDraftItem()],
    };
}

export function isDeliveryOrderCargoDraftItemFilled(item: DeliveryOrderCargoDraftItem) {
    return Boolean(
        item.description.trim() ||
        item.customerProductRef ||
        item.qtyKoli > 0 ||
        item.weightInputValue > 0 ||
        item.volumeInputValue > 0
    );
}

export function getDeliveryOrderCargoDraftItems(group: DeliveryOrderCargoDraftGroup) {
    return group.items.filter(isDeliveryOrderCargoDraftItemFilled);
}

export function getDraftDeliveryOrderCargoGroups(groups: DeliveryOrderCargoDraftGroup[]) {
    return groups
        .map(group => ({
            ...group,
            draftItems: getDeliveryOrderCargoDraftItems(group),
        }))
        .filter(group => group.shipperReferenceNumber.trim() || group.draftItems.length > 0);
}

export function flattenDeliveryOrderCargoDraftGroups(groups: DeliveryOrderCargoDraftGroup[]): OrderItemForm[] {
    return groups.flatMap(group =>
        group.items.map(item => ({
            ...item,
            pickupStopKey: group.pickupStopKey,
            shipperReferenceNumber: group.shipperReferenceNumber,
        }))
    );
}

export function buildInitialDeliveryOrderCargoDraftGroups(params: {
    pickupStops?: PickupStopLike[];
    shipperReferences?: ShipperReferenceLike[];
}) {
    const defaultPickupStopKey = params.pickupStops?.[0]?._key || '';
    const normalizedReferences = (params.shipperReferences || [])
        .map(reference => ({
            shipperReferenceKey: reference._key || '',
            referenceNumber: reference.referenceNumber?.trim().toUpperCase() || '',
            pickupStopKey: reference.pickupStopKey || defaultPickupStopKey,
            pickupAddress: reference.pickupAddress?.trim() || '',
        }))
        .filter(reference => Boolean(reference.referenceNumber));

    if (normalizedReferences.length === 0) {
        return [createDefaultDeliveryOrderCargoDraftGroup(defaultPickupStopKey)];
    }

    return normalizedReferences.map(reference => ({
        id: crypto.randomUUID(),
        shipperReferenceKey: reference.shipperReferenceKey,
        pickupStopKey: reference.pickupStopKey,
        pickupAddress: reference.pickupAddress,
        shipperReferenceNumber: reference.referenceNumber,
        items: [createDefaultDeliveryOrderCargoDraftItem()],
    }));
}
