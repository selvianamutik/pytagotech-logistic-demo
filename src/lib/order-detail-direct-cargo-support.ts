import { getBusinessDateValue } from '@/lib/business-date';
import {
    createDefaultOrderItemForm,
    type OrderItemForm,
} from '@/lib/order-create-page-support';
import type { TripOwnership } from '@/lib/types';

export type DirectCargoGroupItem = Omit<OrderItemForm, 'pickupStopKey' | 'shipperReferenceNumber'>;

export type DirectCargoGroup = {
    id: string;
    pickupStopKey: string;
    shipperReferenceNumber: string;
    items: DirectCargoGroupItem[];
};

export type TripDraftForm = {
    id: string;
    tripOwnership: TripOwnership;
    pickupStopKeys: string[];
    vehicleRef: string;
    driverRef: string;
    tripOriginArea: string;
    tripDestinationArea: string;
    tripRouteRateRef: string;
    tripFee: number;
    vehicleOverrideReason: string;
    issueBankRef: string;
    cashGiven: number;
    notes: string;
    date: string;
};

export function toDirectCargoGroupItem(item: OrderItemForm): DirectCargoGroupItem {
    return {
        manualEntry: item.manualEntry,
        customerProductRef: item.customerProductRef,
        description: item.description,
        qtyKoli: item.qtyKoli,
        weightInputValue: item.weightInputValue,
        weightInputUnit: item.weightInputUnit,
        autoWeightBasisQtyKoli: item.autoWeightBasisQtyKoli,
        autoWeightBasisWeightKg: item.autoWeightBasisWeightKg,
        volumeInputValue: item.volumeInputValue,
        volumeInputUnit: item.volumeInputUnit,
        value: item.value,
    };
}

export function createDefaultDirectCargoGroupItem(): DirectCargoGroupItem {
    return toDirectCargoGroupItem(createDefaultOrderItemForm());
}

export function createDefaultDirectCargoGroup(pickupStopKey = ''): DirectCargoGroup {
    return {
        id: crypto.randomUUID(),
        pickupStopKey,
        shipperReferenceNumber: '',
        items: [createDefaultDirectCargoGroupItem()],
    };
}

export function createDefaultTripDraftForm(pickupStopKeys: string[] = []): TripDraftForm {
    return {
        id: crypto.randomUUID(),
        tripOwnership: 'INTERNAL',
        pickupStopKeys,
        vehicleRef: '',
        driverRef: '',
        tripOriginArea: '',
        tripDestinationArea: '',
        tripRouteRateRef: '',
        tripFee: 0,
        vehicleOverrideReason: '',
        issueBankRef: '',
        cashGiven: 0,
        notes: '',
        date: getBusinessDateValue(),
    };
}

export function isDirectCargoGroupItemDraft(item: DirectCargoGroupItem) {
    return Boolean(
        item.description.trim() ||
        item.customerProductRef ||
        item.qtyKoli > 0 ||
        item.weightInputValue > 0 ||
        item.volumeInputValue > 0
    );
}

export function getDirectCargoGroupDraftItems(group: DirectCargoGroup) {
    return group.items.filter(isDirectCargoGroupItemDraft);
}

export function flattenDirectCargoGroups(groups: DirectCargoGroup[]): OrderItemForm[] {
    return groups.flatMap(group =>
        group.items.map(item => ({
            ...item,
            pickupStopKey: group.pickupStopKey,
            shipperReferenceNumber: group.shipperReferenceNumber,
        }))
    );
}
