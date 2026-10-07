import type { Customer, Order, OrderItem, OrderPickupStop } from './types';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    convertKgToWeightInputValue,
    convertWeightToKg,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    getWeightInputFractionDigits,
    type WeightInputUnit,
    type VolumeInputUnit,
} from './measurement';
import {
    createDefaultPickupStopForm,
    getDraftPickupStops,
    summarizeDraftOrderCargo,
    type OrderItemForm,
    type PickupStopForm,
} from './order-create-page-support';

export type OrderEditFormState = {
    cargoEntryMode: 'ORDER' | 'DELIVERY_ORDER';
    customerRef: string;
    customerName: string;
    /** Additional customers this order serves; the primary is excluded (it stays in `customerRef`). */
    additionalCustomerRefs: string[];
    customerRecipientRef: string;
    customerPickupRef: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
    pickupAddress: string;
    pickupStops: PickupStopForm[];
    serviceRef: string;
    serviceName: string;
    notes: string;
    saveRecipientToMaster: boolean;
    saveRecipientAsDefault: boolean;
    recipientMasterLabel: string;
    savePickupToMaster: boolean;
    savePickupAsDefault: boolean;
    pickupMasterLabel: string;
};

export const DEFAULT_ORDER_EDIT_FORM: OrderEditFormState = {
    cargoEntryMode: 'ORDER',
    customerRef: '',
    customerName: '',
    additionalCustomerRefs: [],
    customerRecipientRef: '',
    customerPickupRef: '',
    receiverName: '',
    receiverPhone: '',
    receiverAddress: '',
    receiverCompany: '',
    pickupAddress: '',
    pickupStops: [],
    serviceRef: '',
    serviceName: '',
    notes: '',
    saveRecipientToMaster: false,
    saveRecipientAsDefault: false,
    recipientMasterLabel: '',
    savePickupToMaster: false,
    savePickupAsDefault: false,
    pickupMasterLabel: '',
};

export function buildOrderEditForm(order: Order | null): OrderEditFormState {
    if (!order) {
        return {
            ...DEFAULT_ORDER_EDIT_FORM,
            pickupStops: [createDefaultPickupStopForm()],
        };
    }
    const pickupStops = getOrderEditPickupStops(order);
    const firstPickupStop = getDraftPickupStops(pickupStops)[0] || pickupStops[0] || createDefaultPickupStopForm(order.pickupAddress || '');

    return {
        cargoEntryMode: order.cargoEntryMode || 'ORDER',
        customerRef: order.customerRef,
        customerName: order.customerName || '',
        additionalCustomerRefs: (order.customerRefs || []).filter(ref => ref !== order.customerRef),
        customerRecipientRef: order.customerRecipientRef || '',
        customerPickupRef: firstPickupStop.customerPickupRef || order.customerPickupRef || '',
        receiverName: order.receiverName || '',
        receiverPhone: order.receiverPhone || '',
        receiverAddress: order.receiverAddress || '',
        receiverCompany: order.receiverCompany || '',
        pickupAddress: firstPickupStop.pickupAddress || order.pickupAddress || '',
        pickupStops,
        serviceRef: order.serviceRef,
        serviceName: order.serviceName || '',
        notes: order.notes || '',
        saveRecipientToMaster: false,
        saveRecipientAsDefault: false,
        recipientMasterLabel: '',
        savePickupToMaster: false,
        savePickupAsDefault: false,
        pickupMasterLabel: '',
    };
}

function mapOrderPickupStopToEditForm(stop: OrderPickupStop, index: number): PickupStopForm {
    return {
        id: stop._key || `pickup-${index + 1}`,
        customerPickupRef: stop.customerPickupRef || '',
        pickupLabel: stop.pickupLabel || '',
        pickupAddress: stop.pickupAddress || '',
        notes: stop.notes || '',
    };
}

export function getOrderEditPickupStops(order: Pick<Order, 'pickupAddress' | 'pickupStops' | 'customerPickupRef'> | null): PickupStopForm[] {
    if (!order) {
        return [createDefaultPickupStopForm()];
    }

    const stops = (order.pickupStops || [])
        .filter(stop => stop && (stop.pickupAddress || stop.pickupLabel || stop.customerPickupRef || stop.notes))
        .map(mapOrderPickupStopToEditForm);
    if (stops.length > 0) {
        return stops;
    }

    return [{
        ...createDefaultPickupStopForm(order.pickupAddress || ''),
        customerPickupRef: order.customerPickupRef || '',
    }];
}

export function mapOrderItemToOrderEditForm(item: OrderItem): OrderItemForm {
    const nextWeightUnit = (item.weightInputUnit || 'KG') as WeightInputUnit;
    const nextVolumeUnit = (item.volumeInputUnit || 'M3') as VolumeInputUnit;
    const normalizedQtyKoli = parseFormattedNumberish(item.qtyKoli ?? 0, {
        maxFractionDigits: 2,
    });
    const normalizedWeightInputValue = parseFormattedNumberish(item.weightInputValue ?? 0, {
        maxFractionDigits: getWeightInputFractionDigits(nextWeightUnit),
    });
    const normalizedWeightKg = parseFormattedNumberish(item.weight ?? 0, {
        maxFractionDigits: 2,
    });
    const normalizedVolumeInputValue = parseFormattedNumberish(item.volumeInputValue ?? 0, {
        maxFractionDigits: nextVolumeUnit === 'LITER' ? 0 : 3,
    });
    const normalizedVolumeM3 = parseFormattedNumberish(item.volume ?? 0, {
        maxFractionDigits: 3,
    });
    const normalizedValue = parseFormattedNumberish(item.value ?? 0, {
        maxFractionDigits: 0,
    });

    return {
        id: item._id,
        customerProductRef: item.customerProductRef || '',
        description: item.description || '',
        qtyKoli: normalizedQtyKoli,
        weightInputValue:
            normalizedWeightInputValue > 0
                ? normalizedWeightInputValue
                : normalizedWeightKg > 0
                    ? convertKgToWeightInputValue(normalizedWeightKg, nextWeightUnit)
                    : 0,
        weightInputUnit: nextWeightUnit,
        autoWeightBasisQtyKoli: normalizedQtyKoli > 0 ? normalizedQtyKoli : undefined,
        autoWeightBasisWeightKg: normalizedWeightKg > 0
            ? normalizedWeightKg
            : normalizedWeightInputValue > 0
                ? convertWeightToKg(normalizedWeightInputValue, nextWeightUnit)
                : undefined,
        autoVolumeBasisQtyKoli: normalizedQtyKoli > 0 ? normalizedQtyKoli : undefined,
        autoVolumeBasisVolumeM3: normalizedVolumeM3 > 0
            ? normalizedVolumeM3
            : normalizedVolumeInputValue > 0
                ? convertVolumeToM3(normalizedVolumeInputValue, nextVolumeUnit)
                : undefined,
        volumeInputValue:
            normalizedVolumeInputValue > 0
                ? normalizedVolumeInputValue
                : normalizedVolumeM3 > 0
                    ? convertM3ToVolumeInputValue(normalizedVolumeM3, nextVolumeUnit)
                    : 0,
        volumeInputUnit: nextVolumeUnit,
        pickupStopKey: '',
        shipperReferenceNumber: '',
        value: normalizedValue,
    };
}

export function getOrderEditItems(orderItems: OrderItem[]) {
    return (orderItems || []).map(mapOrderItemToOrderEditForm);
}

export function hasOrderItemOperationalProgress(orderItems: OrderItem[]) {
    return (orderItems || []).some(item =>
        parseFormattedNumberish(item.deliveredQtyKoli || 0) > 0 ||
        parseFormattedNumberish(item.assignedQtyKoli || 0) > 0 ||
        parseFormattedNumberish(item.heldQtyKoli || 0) > 0 ||
        parseFormattedNumberish(item.deliveredWeight || 0) > 0 ||
        parseFormattedNumberish(item.assignedWeight || 0) > 0 ||
        parseFormattedNumberish(item.heldWeight || 0) > 0 ||
        parseFormattedNumberish(item.deliveredVolume || 0) > 0 ||
        parseFormattedNumberish(item.assignedVolume || 0) > 0 ||
        parseFormattedNumberish(item.heldVolume || 0) > 0
    );
}

export function resolvePickupAddressForCustomer(params: {
    nextCustomerRef: string;
    previousCustomerRef: string;
    previousPickupAddress: string;
    customers: Customer[];
}) {
    const nextCustomer = params.customers.find(customer => customer._id === params.nextCustomerRef);
    const previousCustomer = params.customers.find(customer => customer._id === params.previousCustomerRef);
    const previousCustomerAddress = previousCustomer?.address?.trim() || '';
    const currentPickup = params.previousPickupAddress.trim();

    if (!currentPickup || (previousCustomerAddress && currentPickup === previousCustomerAddress)) {
        return nextCustomer?.address || '';
    }

    return params.previousPickupAddress;
}

export function summarizeOrderEditTargetCargo(items: OrderItemForm[]) {
    return summarizeDraftOrderCargo(items);
}
