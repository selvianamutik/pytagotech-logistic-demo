import type { CustomerPickupLocation, CustomerProduct, CustomerRecipient } from './types';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    getWeightInputFractionDigits,
    type VolumeInputUnit,
    type WeightInputUnit,
} from './measurement';

export const MANUAL_ITEM_OPTION_VALUE = '__manual__';

// Sentinel for "Titik Pickup" on the Surat Jalan cargo modal. Selecting it means
// the address is typed by hand instead of pointing at an order pickup stop, so
// the value is stored in pickupAddress and pickupStopKey is left empty.
export const MANUAL_PICKUP_OPTION_VALUE = '__manual_pickup__';

// Sentinel for "Master Pickup Customer" on the order create/edit forms. Same idea
// as MANUAL_PICKUP_OPTION_VALUE but one level up: the stop stops pointing at a
// master pickup record and the address below becomes the only source of truth.
export const MANUAL_PICKUP_MASTER_VALUE = '__manual_pickup_master__';
export const MANUAL_PICKUP_MASTER_LABEL = 'Tulis manual (di luar Master Pickup)';

export type OrderItemForm = {
    id?: string;
    manualEntry?: boolean;
    customerProductRef: string;
    description: string;
    qtyKoli: number;
    weightInputValue: number;
    weightInputUnit: WeightInputUnit;
    autoWeightBasisQtyKoli?: number;
    autoWeightBasisWeightKg?: number;
    autoVolumeBasisQtyKoli?: number;
    autoVolumeBasisVolumeM3?: number;
    volumeInputValue: number;
    volumeInputUnit: VolumeInputUnit;
    pickupStopKey: string;
    shipperReferenceNumber: string;
    value: number;
};

export type PickupStopForm = {
    id: string;
    customerPickupRef: string;
    pickupLabel: string;
    pickupAddress: string;
    notes: string;
};

export const DEFAULT_ORDER_ITEM_FORM: OrderItemForm = {
    customerProductRef: '',
    description: '',
    qtyKoli: 0,
    weightInputValue: 0,
    weightInputUnit: 'KG',
    volumeInputValue: 0,
    volumeInputUnit: 'M3',
    pickupStopKey: '',
    shipperReferenceNumber: '',
    value: 0,
};

export function createDefaultOrderItemForm(pickupStopKey = ''): OrderItemForm {
    return { ...DEFAULT_ORDER_ITEM_FORM, pickupStopKey };
}

export function createDefaultPickupStopForm(pickupAddress = ''): PickupStopForm {
    return {
        id: crypto.randomUUID(),
        customerPickupRef: '',
        pickupLabel: '',
        pickupAddress,
        notes: '',
    };
}

export function getDraftOrderItems(items: OrderItemForm[]) {
    return items.filter(item =>
        item.description.trim() ||
        item.customerProductRef ||
        item.qtyKoli > 0 ||
        item.weightInputValue > 0 ||
        item.volumeInputValue > 0
    );
}

export function summarizeDraftOrderCargo(items: OrderItemForm[]) {
    return getDraftOrderItems(items).reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + (item.weightInputValue > 0 ? convertWeightToKg(item.weightInputValue, item.weightInputUnit) : 0),
        volumeM3: sum.volumeM3 + (item.volumeInputValue > 0 ? convertVolumeToM3(item.volumeInputValue, item.volumeInputUnit) : 0),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
}

export function resetCustomerScopedOrderItems(items: OrderItemForm[]) {
    return items.map(item => (item.customerProductRef ? createDefaultOrderItemForm() : item));
}

export function applyOrderItemPickerSelection(
    item: OrderItemForm,
    nextValue: string,
    customerProducts: CustomerProduct[]
): OrderItemForm {
    if (nextValue === MANUAL_ITEM_OPTION_VALUE) {
        return { ...item, customerProductRef: '', manualEntry: true };
    }
    const selectedProduct = customerProducts.find(product => product._id === nextValue);
    return { ...applyCustomerProductToOrderItem(item, selectedProduct), manualEntry: false };
}

export function getOrderItemPickerValue(item: Pick<OrderItemForm, 'customerProductRef' | 'description' | 'manualEntry'>): string {
    if (item.customerProductRef) return item.customerProductRef;
    if (item.manualEntry || Boolean(item.description && item.description.trim())) return MANUAL_ITEM_OPTION_VALUE;
    return '';
}

export function applyCustomerProductToOrderItem(item: OrderItemForm, selectedProduct: CustomerProduct | undefined): OrderItemForm {
    if (!selectedProduct) {
        return { ...item, customerProductRef: '' };
    }

    const productWeightInputUnit = selectedProduct.defaultWeightInputUnit || 'KG';
    const nextWeightUnit = selectedProduct.defaultWeightInputUnit || item.weightInputUnit || 'KG';
    const nextVolumeUnit = selectedProduct.defaultVolumeInputUnit || item.volumeInputUnit || 'M3';
    const currentQtyKoli = parseFormattedNumberish(item.qtyKoli ?? 0, {
        maxFractionDigits: 2,
    });
    const productDefaultQtyKoli = parseFormattedNumberish(selectedProduct.defaultQtyKoli ?? 0, {
        maxFractionDigits: 2,
    });
    const normalizedQtyKoli = currentQtyKoli > 0 ? currentQtyKoli : productDefaultQtyKoli;
    const normalizedWeightInputValue = parseFormattedNumberish(
        selectedProduct.defaultWeightInputValue ?? 0,
        { maxFractionDigits: getWeightInputFractionDigits(nextWeightUnit) }
    );
    const normalizedWeightKg = parseFormattedNumberish(selectedProduct.defaultWeight ?? 0, {
        maxFractionDigits: 2,
    });
    const productWeightPerKoliKg =
        normalizedWeightInputValue > 0
            ? convertWeightToKg(normalizedWeightInputValue, productWeightInputUnit)
            : normalizedWeightKg > 0
                ? normalizedWeightKg
                : 0;
    const nextWeightKg = productWeightPerKoliKg > 0 && normalizedQtyKoli > 0
        ? productWeightPerKoliKg * normalizedQtyKoli
        : 0;
    const nextWeightValue = nextWeightKg > 0
        ? roundToFractionDigits(
            convertKgToWeightInputValue(nextWeightKg, nextWeightUnit),
            getWeightInputFractionDigits(nextWeightUnit)
        )
        : 0;
    const productVolumeInputUnit = selectedProduct.defaultVolumeInputUnit || 'M3';
    const normalizedVolumeInputValue = parseFormattedNumberish(
        selectedProduct.defaultVolumeInputValue ?? 0,
        { maxFractionDigits: nextVolumeUnit === 'LITER' ? 0 : 3 }
    );
    const normalizedVolumeM3 = parseFormattedNumberish(selectedProduct.defaultVolume ?? 0, {
        maxFractionDigits: 3,
    });
    const productVolumePerKoliM3 =
        normalizedVolumeInputValue > 0
            ? convertVolumeToM3(normalizedVolumeInputValue, productVolumeInputUnit)
            : normalizedVolumeM3 > 0
                ? normalizedVolumeM3
                : 0;
    const nextVolumeM3 = productVolumePerKoliM3 > 0 && normalizedQtyKoli > 0
        ? productVolumePerKoliM3 * normalizedQtyKoli
        : 0;
    const nextVolumeValue = nextVolumeM3 > 0
        ? roundToFractionDigits(
            convertM3ToVolumeInputValue(nextVolumeM3, nextVolumeUnit),
            nextVolumeUnit === 'LITER' ? 0 : 3
        )
        : 0;

    return {
        ...item,
        customerProductRef: selectedProduct._id,
        description: selectedProduct.description || selectedProduct.name || item.description,
        qtyKoli: normalizedQtyKoli,
        weightInputValue: nextWeightValue,
        weightInputUnit: nextWeightUnit,
        autoWeightBasisQtyKoli: normalizedQtyKoli > 0 ? normalizedQtyKoli : undefined,
        autoWeightBasisWeightKg: nextWeightKg > 0 ? nextWeightKg : undefined,
        autoVolumeBasisQtyKoli: normalizedQtyKoli > 0 ? normalizedQtyKoli : undefined,
        autoVolumeBasisVolumeM3: nextVolumeM3 > 0 ? nextVolumeM3 : undefined,
        volumeInputValue: nextVolumeValue,
        volumeInputUnit: nextVolumeUnit,
    };
}

export function applyOrderItemAutoWeightFromQty(
    item: OrderItemForm,
    nextQtyKoli: number | string
): OrderItemForm {
    const normalizedNextQtyKoli = parseFormattedNumberish(nextQtyKoli ?? 0, {
        maxFractionDigits: 2,
    });
    const normalizedCurrentQtyKoli = parseFormattedNumberish(item.qtyKoli ?? 0, {
        maxFractionDigits: 2,
    });
    const normalizedCurrentWeightInputValue = parseFormattedNumberish(item.weightInputValue ?? 0, {
        maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
    });
    const normalizedCurrentVolumeInputValue = parseFormattedNumberish(item.volumeInputValue ?? 0, {
        maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
    });
    const currentWeightKg = normalizedCurrentWeightInputValue > 0
        ? convertWeightToKg(normalizedCurrentWeightInputValue, item.weightInputUnit)
        : 0;
    const currentVolumeM3 = normalizedCurrentVolumeInputValue > 0
        ? convertVolumeToM3(normalizedCurrentVolumeInputValue, item.volumeInputUnit)
        : 0;
    const basisQtyKoli = normalizedCurrentQtyKoli > 0
        ? normalizedCurrentQtyKoli
        : parseFormattedNumberish(item.autoWeightBasisQtyKoli ?? 0, { maxFractionDigits: 2 });
    const volumeBasisQtyKoli = normalizedCurrentQtyKoli > 0
        ? normalizedCurrentQtyKoli
        : parseFormattedNumberish(item.autoVolumeBasisQtyKoli ?? basisQtyKoli, { maxFractionDigits: 2 });
    const basisWeightKg = currentWeightKg > 0
        ? currentWeightKg
        : parseFormattedNumberish(item.autoWeightBasisWeightKg ?? 0, { maxFractionDigits: 2 });
    const basisVolumeM3 = currentVolumeM3 > 0
        ? currentVolumeM3
        : parseFormattedNumberish(item.autoVolumeBasisVolumeM3 ?? 0, { maxFractionDigits: 3 });
    const nextBasis = {
        autoWeightBasisQtyKoli: basisQtyKoli > 0 ? basisQtyKoli : undefined,
        autoWeightBasisWeightKg: basisWeightKg > 0 ? basisWeightKg : undefined,
        autoVolumeBasisQtyKoli: volumeBasisQtyKoli > 0 ? volumeBasisQtyKoli : undefined,
        autoVolumeBasisVolumeM3: basisVolumeM3 > 0 ? basisVolumeM3 : undefined,
    };

    if ((basisQtyKoli <= 0 || basisWeightKg <= 0) && (volumeBasisQtyKoli <= 0 || basisVolumeM3 <= 0)) {
        return {
            ...item,
            qtyKoli: normalizedNextQtyKoli,
            ...nextBasis,
        };
    }

    const maxFractionDigits = getWeightInputFractionDigits(item.weightInputUnit);
    const nextWeightKg = basisQtyKoli > 0 && basisWeightKg > 0
        ? (basisWeightKg / basisQtyKoli) * normalizedNextQtyKoli
        : 0;
    const nextWeightInputValue = nextWeightKg > 0
        ? roundToFractionDigits(
            convertKgToWeightInputValue(nextWeightKg, item.weightInputUnit),
            maxFractionDigits
        )
        : 0;
    const nextVolumeM3 = volumeBasisQtyKoli > 0 && basisVolumeM3 > 0
        ? (basisVolumeM3 / volumeBasisQtyKoli) * normalizedNextQtyKoli
        : 0;
    const nextVolumeInputValue = roundToFractionDigits(
        convertM3ToVolumeInputValue(nextVolumeM3, item.volumeInputUnit),
        item.volumeInputUnit === 'LITER' ? 0 : 3
    );

    return {
        ...item,
        qtyKoli: normalizedNextQtyKoli,
        weightInputValue: normalizedNextQtyKoli > 0 && basisQtyKoli > 0 && basisWeightKg > 0 ? nextWeightInputValue : item.weightInputValue,
        volumeInputValue: normalizedNextQtyKoli > 0 && volumeBasisQtyKoli > 0 && basisVolumeM3 > 0 ? nextVolumeInputValue : item.volumeInputValue,
        ...nextBasis,
    };
}

function roundToFractionDigits(value: number, fractionDigits: number) {
    const factor = 10 ** fractionDigits;
    return Math.round(value * factor) / factor;
}

export function shouldLockOrderItemWeight(
    item: Pick<OrderItemForm, 'customerProductRef' | 'qtyKoli' | 'weightInputValue'>
) {
    const qtyKoli = parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 });
    const weightInputValue = parseFormattedNumberish(item.weightInputValue || 0);
    return Boolean(item.customerProductRef && qtyKoli > 0 && weightInputValue > 0);
}

export function shouldLockOrderItemVolume(
    item: Pick<OrderItemForm, 'customerProductRef' | 'qtyKoli' | 'volumeInputValue'>
) {
    const qtyKoli = parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 });
    const volumeInputValue = parseFormattedNumberish(item.volumeInputValue || 0);
    return Boolean(item.customerProductRef && qtyKoli > 0 && volumeInputValue > 0);
}

export function updateOrderItemWeightUnit(item: OrderItemForm, nextUnit: WeightInputUnit): OrderItemForm {
    if (item.weightInputUnit === nextUnit) {
        return item;
    }

    const currentWeightKg =
        item.weightInputValue > 0
            ? convertWeightToKg(item.weightInputValue, item.weightInputUnit)
            : 0;

    return {
        ...item,
        weightInputUnit: nextUnit,
        weightInputValue: currentWeightKg > 0 ? convertKgToWeightInputValue(currentWeightKg, nextUnit) : 0,
        autoWeightBasisWeightKg: currentWeightKg > 0 ? currentWeightKg : item.autoWeightBasisWeightKg,
    };
}

export function updateOrderItemVolumeUnit(item: OrderItemForm, nextUnit: VolumeInputUnit): OrderItemForm {
    if (item.volumeInputUnit === nextUnit) {
        return item;
    }

    const currentVolumeM3 =
        item.volumeInputValue > 0
            ? convertVolumeToM3(item.volumeInputValue, item.volumeInputUnit)
            : 0;

    return {
        ...item,
        volumeInputUnit: nextUnit,
        volumeInputValue: currentVolumeM3 > 0 ? convertM3ToVolumeInputValue(currentVolumeM3, nextUnit) : 0,
        autoVolumeBasisVolumeM3: currentVolumeM3 > 0 ? currentVolumeM3 : item.autoVolumeBasisVolumeM3,
    };
}

export function applyCustomerRecipientSnapshot(selectedRecipient: CustomerRecipient | undefined) {
    if (!selectedRecipient) {
        return {
            receiverName: '',
            receiverPhone: '',
            receiverAddress: '',
            receiverCompany: '',
        };
    }

    return {
        receiverName: selectedRecipient.receiverName || '',
        receiverPhone: selectedRecipient.receiverPhone || '',
        receiverAddress: selectedRecipient.receiverAddress || '',
        receiverCompany: selectedRecipient.receiverCompany || '',
    };
}

export function sortCustomerRecipients(recipients: CustomerRecipient[]) {
    return [...recipients].sort((a, b) => {
        if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
            return a.isDefault ? -1 : 1;
        }
        return (a.label || '').localeCompare(b.label || '');
    });
}

export function findDefaultCustomerRecipient(recipients: CustomerRecipient[]) {
    return recipients.find(recipient => recipient.active !== false && recipient.isDefault) || null;
}

export function applyCustomerPickupSnapshot(selectedPickup: CustomerPickupLocation | undefined) {
    return {
        pickupLabel: selectedPickup?.label || '',
        pickupAddress: selectedPickup?.pickupAddress || '',
    };
}

export function applyCustomerPickupToStop(stop: PickupStopForm, selectedPickup: CustomerPickupLocation | undefined): PickupStopForm {
    const snapshot = applyCustomerPickupSnapshot(selectedPickup);
    return {
        ...stop,
        customerPickupRef: selectedPickup?._id || '',
        pickupLabel: snapshot.pickupLabel,
        pickupAddress: snapshot.pickupAddress,
    };
}

export function getPickupStopMasterValue(
    stop: Pick<PickupStopForm, 'customerPickupRef' | 'pickupLabel' | 'pickupAddress'>
): string {
    if (stop.customerPickupRef) {
        return stop.customerPickupRef;
    }
    if (stop.pickupLabel.trim() || stop.pickupAddress.trim()) {
        return MANUAL_PICKUP_MASTER_VALUE;
    }
    return '';
}

export function applyCustomerPickupMasterSelection(
    stop: PickupStopForm,
    nextValue: string,
    customerPickups: CustomerPickupLocation[]
): PickupStopForm {
    // Menulis manual: lepas master ref, lalu kosongkan alamat yang disalin dari
    // master supaya isian "Alamat Pickup" jadi satu-satunya sumber. Stop yang
    // sudah manual sejak awal tetap menyimpan alamat ketikan tangannya.
    if (nextValue === MANUAL_PICKUP_MASTER_VALUE) {
        return {
            ...stop,
            customerPickupRef: '',
            pickupLabel: '',
            pickupAddress: stop.customerPickupRef ? '' : stop.pickupAddress,
        };
    }
    // Tombol clear: kembali ke kosong tanpa menyentuh alamat yang diketik manual.
    if (nextValue === '') {
        return { ...stop, customerPickupRef: '' };
    }
    return applyCustomerPickupToStop(stop, customerPickups.find(pickup => pickup._id === nextValue));
}

export function sortCustomerPickups(pickups: CustomerPickupLocation[]) {
    return [...pickups].sort((a, b) => {
        if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
            return a.isDefault ? -1 : 1;
        }
        return (a.label || '').localeCompare(b.label || '');
    });
}

export function findDefaultCustomerPickup(pickups: CustomerPickupLocation[]) {
    return pickups.find(pickup => pickup.active !== false && pickup.isDefault) || null;
}

export function getDraftPickupStops(items: PickupStopForm[]) {
    return items.filter(item =>
        item.customerPickupRef ||
        item.pickupAddress.trim() ||
        item.pickupLabel.trim() ||
        item.notes.trim()
    );
}

export function summarizePickupStopList(items: PickupStopForm[]) {
    const draftStops = getDraftPickupStops(items);
    if (draftStops.length === 0) {
        return 'Belum diisi';
    }
    if (draftStops.length === 1) {
        return draftStops[0].pickupAddress || draftStops[0].pickupLabel || '1 titik pickup';
    }
    return `${draftStops.length} titik pickup`;
}
