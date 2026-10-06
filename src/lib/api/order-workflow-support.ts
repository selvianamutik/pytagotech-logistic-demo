import { createHash } from 'node:crypto';
import {
    calculateWeightPortion,
    deriveOrderItemStatusFromProgress,
    getOrderItemProgress,
    roundQuantity,
} from '@/lib/order-item-progress';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    getWeightInputFractionDigits,
    isVolumeInputUnit,
    isWeightInputUnit,
    readVolumeInputUnit,
    readWeightInputUnit,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { getBusinessDateValue } from '@/lib/business-date';
import { getDocumentById, listDocumentsByFilter } from '@/lib/repositories/document-store';
import type { DeliveryActualDropPoint, DeliveryActualDropType } from '@/lib/types';

import {
    isPlainObject,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';

function readOptionalBooleanInput(value: unknown, label: string) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'boolean') {
        throw new Error(label);
    }
    return value;
}

export type OrderItemStatusSummary = {
    status?: string;
    qtyKoli?: number;
    weight?: number;
    volume?: number;
    deliveredQtyKoli?: number;
    deliveredWeight?: number;
    deliveredVolume?: number;
    assignedQtyKoli?: number;
    assignedWeight?: number;
    assignedVolume?: number;
    heldQtyKoli?: number;
    heldWeight?: number;
    heldVolume?: number;
};

type CustomerProductOrderSource = {
    _id: string;
    _rev?: string;
    customerRef?: unknown;
    code?: string;
    name?: string;
    description?: string;
    defaultQtyKoli?: number;
    defaultWeight?: number;
    defaultWeightInputValue?: number;
    defaultWeightInputUnit?: WeightInputUnit;
    defaultVolume?: number;
    defaultVolumeInputValue?: number;
    defaultVolumeInputUnit?: VolumeInputUnit;
    active?: boolean;
};

export type NormalizedOrderItemInput = {
    id?: string;
    pickupStopKey?: string;
    pickupAddress?: string;
    shipperReferenceNumber?: string;
    customerProductRef?: string;
    customerProductRevision?: string;
    customerProductCode?: string;
    customerProductName?: string;
    description: string;
    qtyKoli: number;
    weight: number;
    volume?: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    value?: number;
};

export type DeliveryOrderItemSelection = {
    orderItemRef: string;
    qtyKoli: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    holdRemaining: boolean;
    holdReason?: string;
    holdLocation?: string;
};

export type OrderItemProgressSnapshot = {
    _id: string;
    orderRef?: unknown;
    entrySource?: 'ORDER' | 'DELIVERY_ORDER';
    sourceDeliveryOrderRef?: unknown;
    sourceDeliveryOrderNumber?: string;
    description?: string;
    qtyKoli?: number;
    weight?: number;
    volume?: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    status?: string;
    deliveredQtyKoli?: number;
    deliveredWeight?: number;
    deliveredVolume?: number;
    assignedQtyKoli?: number;
    assignedWeight?: number;
    assignedVolume?: number;
    heldQtyKoli?: number;
    heldWeight?: number;
    heldVolume?: number;
    holdReason?: string;
    holdLocation?: string;
};

export type DeliveryOrderItemCargoSnapshot = {
    _id: string;
    orderItemRef?: unknown;
    shipperReferenceKey?: string;
    shipperReferenceNumber?: string;
    heldQtyKoli?: number;
    heldWeight?: number;
    heldVolume?: number;
    shippedQtyKoli?: number;
    shippedWeight?: number;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
    orderItemVolumeM3?: number;
    orderItemWeightInputValue?: number;
    orderItemWeightInputUnit?: WeightInputUnit;
    orderItemVolumeInputValue?: number;
    orderItemVolumeInputUnit?: VolumeInputUnit;
    actualQtyKoli?: number;
    actualWeightKg?: number;
    actualVolumeM3?: number;
    actualWeightInputValue?: number;
    actualWeightInputUnit?: WeightInputUnit;
    actualVolumeInputValue?: number;
    actualVolumeInputUnit?: VolumeInputUnit;
};

export type NormalizedActualCargoInput = {
    deliveryOrderItemRef: string;
    actualQtyKoli: number;
    actualWeightKg: number;
    actualWeightInputValue?: number;
    actualWeightInputUnit?: WeightInputUnit;
    actualVolumeM3?: number;
    actualVolumeInputValue?: number;
    actualVolumeInputUnit?: VolumeInputUnit;
};

export type NormalizedDeliveryActualDropPoint = DeliveryActualDropPoint & {
    _key: string;
};

export type ActualCargoTotals = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

export type ResolvedOrderPartyData = {
    customer: { _id: string; _rev?: string; name?: string; address?: string; active?: boolean; creditLimitAmount?: number };
    service?: { _id: string; _rev?: string; name?: string; active?: boolean };
    serviceName?: string;
};

export type ResolvedCustomerRecipientData = {
    _id: string;
    _rev?: string;
    customerRef?: string;
    label?: string;
    receiverName?: string;
    receiverPhone?: string;
    receiverAddress?: string;
    receiverCompany?: string;
    active?: boolean;
};

export type ResolvedCustomerPickupData = {
    _id: string;
    _rev?: string;
    customerRef?: string;
    label?: string;
    pickupAddress?: string;
    active?: boolean;
};

const DELIVERY_ACTUAL_DROP_TYPES = new Set<DeliveryActualDropType>([
    'DROP',
    'HOLD',
    'TRANSIT',
    'EXTRA_DROP',
    'RETURN',
]);
export const DO_STATUS_TRANSITIONS: Record<string, string[]> = {
    CREATED: ['ON_DELIVERY', 'CANCELLED'],
    ON_DELIVERY: ['ARRIVED', 'CANCELLED'],
    ARRIVED: ['DELIVERED', 'CANCELLED'],
    PARTIAL_HOLD: ['ON_DELIVERY', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
};

export const DRIVER_APPROVAL_REQUESTABLE_DO_STATUSES = new Set(['DELIVERED']);
export const DRIVER_STATUS_REQUEST_FIELDS = [
    'pendingDriverStatus',
    'pendingDriverStatusRequestedAt',
    'pendingDriverStatusRequestedBy',
    'pendingDriverStatusRequestedByName',
    'pendingDriverStatusNote',
    'pendingDriverActualCargoItems',
    'pendingDriverActualDropPoints',
];

export function getPeriodFromDate(value: string) {
    const normalized = normalizeText(value);
    const match = normalized.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (match) {
        return `${match[1]}${match[2]}`;
    }
    return getBusinessDateValue().slice(0, 7).replace('-', '');
}

export function normalizeCustomerDoPrefix(value: unknown) {
    const prefix = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return prefix || 'SJ';
}

export function buildDeliveryOrderCustomerDoConstraintId(customerRef: string, customerDoNumber: string) {
    const normalizedValue = `${normalizeText(customerRef)}::${normalizeText(customerDoNumber).toLowerCase()}`;
    const encodedValue = Buffer.from(normalizedValue, 'utf8').toString('base64url');
    const directId = `unique-constraint.deliveryOrder.customerRefCustomerDoNumber.${encodedValue}`;
    if (directId.length <= 128) {
        return directId;
    }
    const hash = createHash('sha256')
        .update(normalizedValue)
        .digest('base64url')
        .slice(0, 32);
    return `unique-constraint.deliveryOrder.customerRefCustomerDoNumber.h${hash}`;
}

export function buildDeliveryOrderCustomerDoConstraintDoc(
    deliveryOrderId: string,
    customerRef: string,
    customerDoNumber: string,
) {
    const normalizedValue = `${normalizeText(customerRef)}::${normalizeText(customerDoNumber).toLowerCase()}`;
    const timestamp = new Date().toISOString();

    return {
        _id: buildDeliveryOrderCustomerDoConstraintId(customerRef, customerDoNumber),
        _type: 'uniqueConstraint' as const,
        entityType: 'deliveryOrder',
        fieldName: 'customerRefCustomerDoNumber',
        value: normalizedValue,
        valueLower: normalizedValue,
        ownerRef: deliveryOrderId,
        ownerType: 'deliveryOrder',
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

export function resolvePayloadWeightInputUnit(value: unknown, label: string): WeightInputUnit {
    const normalized = normalizeText(value).toUpperCase();
    if (!normalized) {
        return 'KG';
    }
    if (!isWeightInputUnit(normalized)) {
        throw new Error(`${label} tidak valid`);
    }
    return normalized;
}

export function resolvePayloadVolumeInputUnit(value: unknown, label: string): VolumeInputUnit {
    const normalized = normalizeText(value).toUpperCase();
    if (!normalized) {
        return 'M3';
    }
    if (!isVolumeInputUnit(normalized)) {
        throw new Error(`${label} tidak valid`);
    }
    return normalized;
}

export function buildDriverRequestedTrackingStatus(status: string) {
    return `DRIVER_REQUESTED_${status}`;
}

export function deriveOrderStatusFromItems(items: OrderItemStatusSummary[]) {
    const itemProgress = items.map(item => getOrderItemProgress(item));
    const derivedItemStatuses = itemProgress.map(progress => deriveOrderItemStatusFromProgress(progress));
    const allDelivered = derivedItemStatuses.length > 0 && derivedItemStatuses.every(status => status === 'DELIVERED');
    const anyDelivered = itemProgress.some(progress =>
        progress.deliveredQtyKoli > 0 ||
        progress.deliveredWeight > 0 ||
        progress.deliveredVolume > 0
    );
    const anyHeld = itemProgress.some(progress =>
        progress.heldQtyKoli > 0 ||
        progress.heldWeight > 0 ||
        progress.heldVolume > 0
    );
    const anyHeldStatus = derivedItemStatuses.some(status => status === 'HOLD');

    if (allDelivered) return 'COMPLETE';
    if (anyDelivered || anyHeld || anyHeldStatus) return 'PARTIAL';
    return 'OPEN';
}

export async function resolveOrderPartyData(customerRef: string, serviceRef?: string) {
    const customer = await getDocumentById<{ _id: string; _rev?: string; name?: string; address?: string; active?: boolean }>(customerRef, 'customer') as ResolvedOrderPartyData['customer'] | null;
    if (!customer) {
        throw new Error('Customer order tidak ditemukan');
    }
    if (customer.active === false) {
        throw new Error('Customer order tidak aktif');
    }

    let serviceName: string | undefined;
    let service: ResolvedOrderPartyData['service'];
    if (serviceRef) {
        const serviceDoc = await getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(serviceRef, 'service');
        if (!serviceDoc) {
            throw new Error('Kategori armada order tidak ditemukan');
        }
        if (serviceDoc.active === false) {
            throw new Error('Kategori armada order tidak aktif');
        }
        service = serviceDoc;
        serviceName = serviceDoc.name || undefined;
    }

    return {
        customer,
        service,
        serviceName,
    } satisfies ResolvedOrderPartyData;
}

export async function resolveOrderRecipientData(customerRef: string, customerRecipientRef?: string) {
    if (!customerRecipientRef) {
        return null;
    }

    const recipient = await getDocumentById<ResolvedCustomerRecipientData>(customerRecipientRef, 'customerRecipient');
    if (!recipient || recipient._id !== customerRecipientRef) {
        throw new Error('Master penerima customer tidak ditemukan');
    }
    if (normalizeOptionalText((recipient as { customerRef?: string }).customerRef) !== customerRef) {
        throw new Error('Master penerima tidak sesuai dengan customer yang dipilih');
    }
    if (recipient.active === false) {
        throw new Error('Master penerima customer tidak aktif');
    }

    return recipient;
}

export async function resolveOrderPickupData(customerRef: string, customerPickupRef?: string) {
    if (!customerPickupRef) {
        return null;
    }

    const pickup = await getDocumentById<ResolvedCustomerPickupData>(customerPickupRef, 'customerPickupLocation');
    if (!pickup || pickup._id !== customerPickupRef) {
        throw new Error('Master pickup customer tidak ditemukan');
    }
    if (normalizeOptionalText((pickup as { customerRef?: string }).customerRef) !== customerRef) {
        throw new Error('Master pickup tidak sesuai dengan customer yang dipilih');
    }
    if (pickup.active === false) {
        throw new Error('Master pickup customer tidak aktif');
    }

    return pickup;
}

export async function normalizeOrderItemsInput(
    customerRef: string,
    rawItems: unknown[],
    options?: { allowEmpty?: boolean }
) {
    const items = rawItems
        .filter(isPlainObject)
        .filter(item => normalizeText(item.description) || normalizeOptionalText(item.customerProductRef))
        .map<NormalizedOrderItemInput>(item => {
            const description = normalizeOptionalText(item.description) || '';
            const customerProductRef = normalizeOptionalText(item.customerProductRef);
            const weightInputUnit = resolvePayloadWeightInputUnit(item.weightInputUnit, 'Satuan berat item order');
            const volumeInputUnit = resolvePayloadVolumeInputUnit(item.volumeInputUnit, 'Satuan volume item order');
            const qtyKoli = normalizeNumber(item.qtyKoli);
            const rawWeightInputValue = normalizeNumber(item.weightInputValue ?? item.weight ?? 0, {
                maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
            });
            const rawVolumeInputValue = normalizeNumber(item.volumeInputValue ?? item.volume, {
                maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
            });
            const value = normalizeNumber(item.value);

            if (!description && !customerProductRef) {
                throw new Error('Pilih barang customer atau isi deskripsi item order');
            }
            if (!Number.isFinite(qtyKoli) || qtyKoli < 0) {
                throw new Error('Jumlah koli item order tidak valid');
            }
            if (!Number.isFinite(rawWeightInputValue) || rawWeightInputValue < 0) {
                throw new Error('Berat item order tidak valid');
            }
            if (Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue < 0) {
                throw new Error('Volume item order tidak valid');
            }

            return {
                id: normalizeOptionalText(item.id),
pickupStopKey: normalizeOptionalText(item.pickupStopKey),
        pickupAddress: normalizeOptionalText(item.pickupAddress),
        shipperReferenceNumber: normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase(),
                customerProductRef,
                description,
                qtyKoli,
                weight: 0,
                volume: undefined,
                weightInputValue: Number.isFinite(rawWeightInputValue) && rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
                weightInputUnit: Number.isFinite(rawWeightInputValue) && rawWeightInputValue > 0 ? weightInputUnit : undefined,
                volumeInputValue: Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
                volumeInputUnit: Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
                value: Number.isFinite(value) && value >= 0 ? value : undefined,
            };
        });

    if (items.length === 0) {
        if (options?.allowEmpty) {
            return items;
        }
        throw new Error('Minimal 1 item order wajib diisi');
    }

    const customerProductRefs = [
        ...new Set(items.map(item => item.customerProductRef).filter((value): value is string => Boolean(value))),
    ];
    const customerProducts = customerProductRefs.length > 0
        ? await listDocumentsByFilter<CustomerProductOrderSource>('customerProduct', { _id: customerProductRefs })
        : [];
    const customerProductMap = new Map(customerProducts.map(item => [item._id, item]));

    for (const item of items) {
        const customerProduct = item.customerProductRef ? customerProductMap.get(item.customerProductRef) : undefined;
        if (item.customerProductRef && !customerProduct) {
            throw new Error('Barang customer yang dipilih tidak ditemukan');
        }
        if (customerProduct) {
            if (normalizeOptionalText(customerProduct.customerRef) !== customerRef) {
                throw new Error('Barang customer harus sesuai dengan customer order yang dipilih');
            }
            if (customerProduct.active === false) {
                throw new Error(`Barang customer ${customerProduct.name || customerProduct.code || ''} tidak aktif`);
            }
            item.customerProductCode = normalizeOptionalText(customerProduct.code);
            item.customerProductRevision = customerProduct._rev;
            item.customerProductName = normalizeOptionalText(customerProduct.name);
            item.description =
                item.description ||
                normalizeOptionalText(customerProduct.description) ||
                normalizeOptionalText(customerProduct.name) ||
                '';
            if (item.qtyKoli <= 0) {
                item.qtyKoli = normalizeNumber(customerProduct.defaultQtyKoli ?? 0);
            }
            const productWeightUnit = readWeightInputUnit(customerProduct.defaultWeightInputUnit, 'KG');
            const productWeightInputValue =
                normalizeNumber(customerProduct.defaultWeightInputValue, {
                    maxFractionDigits: getWeightInputFractionDigits(productWeightUnit),
                }) > 0
                    ? normalizeNumber(customerProduct.defaultWeightInputValue, {
                        maxFractionDigits: getWeightInputFractionDigits(productWeightUnit),
                    })
                    : convertKgToWeightInputValue(normalizeNumber(customerProduct.defaultWeight ?? 0), productWeightUnit);
            const productWeightKg = productWeightInputValue > 0
                ? convertWeightToKg(productWeightInputValue, productWeightUnit)
                : normalizeNumber(customerProduct.defaultWeight ?? 0);
            if (productWeightKg > 0 && item.qtyKoli > 0) {
                const lockedWeightKg = roundQuantity(productWeightKg * item.qtyKoli);
                item.weightInputValue = lockedWeightKg > 0
                    ? roundQuantity(convertKgToWeightInputValue(lockedWeightKg, productWeightUnit), getWeightInputFractionDigits(productWeightUnit))
                    : undefined;
                item.weightInputUnit = lockedWeightKg > 0 ? productWeightUnit : undefined;
            } else if (!item.weightInputValue || item.weightInputValue <= 0) {
                item.weightInputValue = productWeightInputValue > 0 ? productWeightInputValue : undefined;
                item.weightInputUnit = productWeightInputValue > 0 ? productWeightUnit : undefined;
            }
            if (!item.volumeInputValue || item.volumeInputValue <= 0) {
                const productVolumeUnit = readVolumeInputUnit(customerProduct.defaultVolumeInputUnit, 'M3');
                const productVolumeInputValue =
                    normalizeNumber(customerProduct.defaultVolumeInputValue, {
                        maxFractionDigits: productVolumeUnit === 'LITER' ? 0 : 3,
                    }) > 0
                        ? normalizeNumber(customerProduct.defaultVolumeInputValue, {
                            maxFractionDigits: productVolumeUnit === 'LITER' ? 0 : 3,
                        })
                        : convertM3ToVolumeInputValue(normalizeNumber(customerProduct.defaultVolume ?? 0), productVolumeUnit);
                item.volumeInputValue = productVolumeInputValue > 0 ? productVolumeInputValue : undefined;
                item.volumeInputUnit = productVolumeInputValue > 0 ? productVolumeUnit : undefined;
            }
        }

        if (!item.description) {
            throw new Error('Deskripsi item order wajib diisi');
        }
        if (!Number.isFinite(item.qtyKoli) || item.qtyKoli < 0) {
            throw new Error('Jumlah koli item order tidak valid');
        }

        const finalWeightInputUnit = item.weightInputUnit === 'TON' ? 'TON' : 'KG';
        const finalVolumeInputUnit =
            item.volumeInputUnit === 'LITER' || item.volumeInputUnit === 'KL' ? item.volumeInputUnit : 'M3';
        const finalWeightInputValue = roundQuantity(
            normalizeNumber(item.weightInputValue ?? 0, {
                maxFractionDigits: getWeightInputFractionDigits(finalWeightInputUnit),
            }),
            getWeightInputFractionDigits(finalWeightInputUnit)
        );
        const finalVolumeInputValue = roundQuantity(
            normalizeNumber(item.volumeInputValue ?? 0, {
                maxFractionDigits: finalVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            finalVolumeInputUnit === 'LITER' ? 0 : 3
        );
        if (!Number.isFinite(finalWeightInputValue) || finalWeightInputValue < 0) {
            throw new Error('Berat item order tidak valid');
        }
        if (!Number.isFinite(finalVolumeInputValue) || finalVolumeInputValue < 0) {
            throw new Error('Volume item order tidak valid');
        }

        item.weight = finalWeightInputValue > 0 ? convertWeightToKg(finalWeightInputValue, finalWeightInputUnit) : 0;
        item.volume = finalVolumeInputValue > 0 ? convertVolumeToM3(finalVolumeInputValue, finalVolumeInputUnit) : undefined;
        item.weightInputValue = finalWeightInputValue > 0 ? finalWeightInputValue : undefined;
        item.weightInputUnit = finalWeightInputValue > 0 ? finalWeightInputUnit : undefined;
        item.volumeInputValue = finalVolumeInputValue > 0 ? finalVolumeInputValue : undefined;
        item.volumeInputUnit = finalVolumeInputValue > 0 ? finalVolumeInputUnit : undefined;

        if (item.qtyKoli <= 0 && item.weight <= 0 && !item.volume) {
            throw new Error('Item order wajib punya koli, berat, atau volume lebih dari 0');
        }
    }

    return items;
}

export function normalizeDeliveryOrderSelections(data: Record<string, unknown>, orderItems: OrderItemProgressSnapshot[]) {
    const rawSelections = Array.isArray(data.items) ? data.items : [];
    if (rawSelections.length > 0) {
        const selections = rawSelections
            .filter(isPlainObject)
            .map<DeliveryOrderItemSelection>(item => {
                const orderItemRef = normalizeText(item.orderItemRef);
                const sourceOrderItem = orderItems.find(orderItem => orderItem._id === orderItemRef);
                const requestedQtyKoli = normalizeNumber(item.qtyKoli);
                const sourceQtyKoli = normalizeNumber(sourceOrderItem?.qtyKoli ?? 0);
                const sourceWeightKg = normalizeNumber(sourceOrderItem?.weight ?? 0);
                const sourceWeightInputUnit = readWeightInputUnit(sourceOrderItem?.weightInputUnit, 'KG');
                const weightInputUnit = sourceQtyKoli > 0 && sourceWeightKg > 0
                    ? sourceWeightInputUnit
                    : resolvePayloadWeightInputUnit(item.weightInputUnit, 'Satuan berat kirim');
                const volumeInputUnit = resolvePayloadVolumeInputUnit(item.volumeInputUnit, 'Satuan volume kirim');
                const lockedWeightKg = sourceQtyKoli > 0 && sourceWeightKg > 0 && requestedQtyKoli > 0
                    ? calculateWeightPortion(sourceWeightKg, sourceQtyKoli, requestedQtyKoli)
                    : 0;
                const weightInputValue = lockedWeightKg > 0
                    ? roundQuantity(convertKgToWeightInputValue(lockedWeightKg, weightInputUnit), getWeightInputFractionDigits(weightInputUnit))
                    : roundQuantity(normalizeNumber(item.weightInputValue, {
                        maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
                    }), getWeightInputFractionDigits(weightInputUnit));
                const volumeInputValue = roundQuantity(normalizeNumber(item.volumeInputValue, {
                    maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
                }), volumeInputUnit === 'LITER' ? 0 : 3);
                return {
                    orderItemRef,
                    qtyKoli: requestedQtyKoli,
                    weightInputValue: weightInputValue > 0 ? weightInputValue : undefined,
                    weightInputUnit: weightInputValue > 0 ? weightInputUnit : undefined,
                    volumeInputValue: volumeInputValue > 0 ? volumeInputValue : undefined,
                    volumeInputUnit: volumeInputValue > 0 ? volumeInputUnit : undefined,
                    holdRemaining:
                        readOptionalBooleanInput(item.holdRemaining, 'Status hold sisa muatan tidak valid') ?? false,
                    holdReason: normalizeOptionalText(item.holdReason),
                    holdLocation: normalizeOptionalText(item.holdLocation),
                };
            });
        return selections.filter(item => item.orderItemRef);
    }

    const rawItemRefs = Array.isArray(data.itemRefs) ? data.itemRefs : [];
    const itemRefs = rawItemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0);
    return orderItems
        .filter(item => itemRefs.includes(item._id))
        .map<DeliveryOrderItemSelection>(item => ({
            orderItemRef: item._id,
            qtyKoli: normalizeNumber(item.qtyKoli),
            weightInputValue:
                normalizeNumber(item.weightInputValue, {
                    maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                }) > 0
                    ? roundQuantity(normalizeNumber(item.weightInputValue, {
                        maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                    }), getWeightInputFractionDigits(item.weightInputUnit))
                    : normalizeNumber(item.weight) > 0
                        ? roundQuantity(convertKgToWeightInputValue(normalizeNumber(item.weight), item.weightInputUnit === 'TON' ? 'TON' : 'KG'), getWeightInputFractionDigits(item.weightInputUnit))
                        : undefined,
            weightInputUnit:
                normalizeNumber(item.weightInputValue, {
                    maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                }) > 0 || normalizeNumber(item.weight) > 0
                    ? item.weightInputUnit === 'TON' ? 'TON' : 'KG'
                    : undefined,
            volumeInputValue:
                normalizeNumber(item.volumeInputValue, {
                    maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                }) > 0
                    ? roundQuantity(normalizeNumber(item.volumeInputValue, {
                        maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                    }), item.volumeInputUnit === 'LITER' ? 0 : 3)
                    : normalizeNumber(item.volume) > 0
                        ? roundQuantity(
                            convertM3ToVolumeInputValue(
                                normalizeNumber(item.volume),
                                item.volumeInputUnit === 'LITER'
                                    ? 'LITER'
                                    : item.volumeInputUnit === 'KL'
                                        ? 'KL'
                                        : 'M3'
                            ),
                            item.volumeInputUnit === 'LITER' ? 0 : 3
                        )
                        : undefined,
            volumeInputUnit:
                normalizeNumber(item.volumeInputValue, {
                    maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                }) > 0 || normalizeNumber(item.volume) > 0
                    ? item.volumeInputUnit === 'LITER'
                        ? 'LITER'
                        : item.volumeInputUnit === 'KL'
                            ? 'KL'
                            : 'M3'
                    : undefined,
            holdRemaining: false,
        }));
}

export function normalizeDeliveryOrderActualCargoInputs(
    data: Record<string, unknown>,
    doItems: DeliveryOrderItemCargoSnapshot[]
) {
    const rawActualItems = Array.isArray(data.actualItems) ? data.actualItems : [];
    const knownDoItemIds = new Set(doItems.map(item => item._id));
    const providedActuals = new Map<string, Record<string, unknown>>();
    for (const rawItem of rawActualItems) {
        if (!isPlainObject(rawItem)) {
            continue;
        }
        const deliveryOrderItemRef = normalizeText(rawItem.deliveryOrderItemRef);
        if (!deliveryOrderItemRef) {
            continue;
        }
        if (!knownDoItemIds.has(deliveryOrderItemRef)) {
            throw new Error(`Item muatan aktual ${deliveryOrderItemRef} bukan milik surat jalan ini`);
        }
        if (providedActuals.has(deliveryOrderItemRef)) {
            throw new Error(`Item muatan aktual ${deliveryOrderItemRef} duplikat dalam payload`);
        }
        providedActuals.set(deliveryOrderItemRef, rawItem);
    }

    const normalized = new Map<string, NormalizedActualCargoInput>();
    for (const item of doItems) {
        const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
        const plannedWeightKg = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
        const plannedVolumeM3 = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);

        const rawItem = providedActuals.get(item._id);
        const weightInputUnit =
            rawItem && Object.prototype.hasOwnProperty.call(rawItem, 'actualWeightInputUnit')
                ? resolvePayloadWeightInputUnit(rawItem.actualWeightInputUnit, 'Satuan berat aktual DO')
                : readWeightInputUnit(item.actualWeightInputUnit || item.orderItemWeightInputUnit, 'KG');
        const volumeInputUnit =
            rawItem && Object.prototype.hasOwnProperty.call(rawItem, 'actualVolumeInputUnit')
                ? resolvePayloadVolumeInputUnit(rawItem.actualVolumeInputUnit, 'Satuan volume aktual DO')
                : readVolumeInputUnit(item.actualVolumeInputUnit || item.orderItemVolumeInputUnit, 'M3');

        const actualQtyKoli = roundQuantity(
            normalizeNumber(rawItem?.actualQtyKoli ?? item.actualQtyKoli ?? plannedQtyKoli)
        );
        const parsedWeightInputValue = roundQuantity(normalizeNumber(
            rawItem?.actualWeightInputValue ??
            item.actualWeightInputValue ??
            (item.actualWeightKg !== undefined
                ? convertKgToWeightInputValue(normalizeNumber(item.actualWeightKg), weightInputUnit)
                : item.orderItemWeightInputValue ?? convertKgToWeightInputValue(plannedWeightKg, weightInputUnit))
        , {
            maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
        }), getWeightInputFractionDigits(weightInputUnit));
        const rawVolumeInputValue = roundQuantity(normalizeNumber(
            rawItem?.actualVolumeInputValue ??
            item.actualVolumeInputValue ??
            (item.actualVolumeM3 !== undefined
                ? convertM3ToVolumeInputValue(normalizeNumber(item.actualVolumeM3), volumeInputUnit)
                : item.orderItemVolumeInputValue ?? convertM3ToVolumeInputValue(plannedVolumeM3, volumeInputUnit))
        , {
            maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
        }), volumeInputUnit === 'LITER' ? 0 : 3);
        const actualWeightKg = roundQuantity(convertWeightToKg(parsedWeightInputValue, weightInputUnit));
        const rawWeightInputValue = actualWeightKg > 0
            ? roundQuantity(convertKgToWeightInputValue(actualWeightKg, weightInputUnit), getWeightInputFractionDigits(weightInputUnit))
            : parsedWeightInputValue;
        const actualVolumeM3 = roundQuantity(convertVolumeToM3(rawVolumeInputValue, volumeInputUnit), 3);

        normalized.set(item._id, {
            deliveryOrderItemRef: item._id,
            actualQtyKoli,
            actualWeightKg,
            actualWeightInputValue: rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
            actualWeightInputUnit: rawWeightInputValue > 0 ? weightInputUnit : undefined,
            actualVolumeM3: actualVolumeM3 > 0 ? actualVolumeM3 : undefined,
            actualVolumeInputValue: rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
            actualVolumeInputUnit: rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
        });
    }

    return normalized;
}

export function summarizeActualCargoInputs(actualCargoByDoItemId: Map<string, NormalizedActualCargoInput>): ActualCargoTotals {
    let qtyKoli = 0;
    let weightKg = 0;
    let volumeM3 = 0;

    for (const item of actualCargoByDoItemId.values()) {
        qtyKoli += normalizeNumber(item.actualQtyKoli);
        weightKg += normalizeNumber(item.actualWeightKg);
        volumeM3 += normalizeNumber(item.actualVolumeM3 ?? 0);
    }

    return {
        qtyKoli: roundQuantity(qtyKoli),
        weightKg: roundQuantity(weightKg),
        volumeM3: roundQuantity(volumeM3, 3),
    };
}

export function normalizeDeliveryDropType(value: unknown, label = 'Tipe titik drop'): DeliveryActualDropType {
    const normalized = normalizeText(value).toUpperCase();
    if (!normalized) {
        return 'DROP';
    }
    if (!DELIVERY_ACTUAL_DROP_TYPES.has(normalized as DeliveryActualDropType)) {
        throw new Error(`${label} tidak valid`);
    }
    return normalized as DeliveryActualDropType;
}

export function buildDefaultActualDropPoint(totals: ActualCargoTotals): NormalizedDeliveryActualDropPoint {
    return {
        _key: crypto.randomUUID(),
        sequence: 1,
        stopType: 'DROP',
        locationName: 'Tujuan Invoice',
        locationAddress: '',
        qtyKoli: totals.qtyKoli > 0 ? totals.qtyKoli : undefined,
        weightKg: totals.weightKg > 0 ? totals.weightKg : undefined,
        weightInputValue: totals.weightKg > 0 ? convertKgToWeightInputValue(totals.weightKg, 'KG') : undefined,
        weightInputUnit: totals.weightKg > 0 ? 'KG' : undefined,
        volumeM3: totals.volumeM3 > 0 ? totals.volumeM3 : undefined,
        volumeInputValue: totals.volumeM3 > 0 ? convertM3ToVolumeInputValue(totals.volumeM3, 'M3') : undefined,
        volumeInputUnit: totals.volumeM3 > 0 ? 'M3' : undefined,
    };
}

function buildActualDropPhysicalGroupKey(params: {
    stopType: DeliveryActualDropType;
    billingCustomerRef?: string;
    billingCustomerName?: string;
    originLocationName?: string;
    originLocationAddress?: string;
    locationName?: string;
    locationAddress?: string;
    note?: string;
}) {
    return [
        params.stopType || 'DROP',
        normalizeOptionalText(params.billingCustomerRef),
        normalizeOptionalText(params.billingCustomerName),
        normalizeOptionalText(params.originLocationName),
        normalizeOptionalText(params.originLocationAddress),
        normalizeOptionalText(params.locationName),
        normalizeOptionalText(params.locationAddress),
        normalizeOptionalText(params.note),
    ].join('|');
}

export function normalizeDeliveryActualDropPoints(
    data: Record<string, unknown>,
    deliveryOrder: {
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
        shipperReferences?: Array<{
            _key?: string;
            referenceNumber?: string;
            receiverName?: string;
            receiverCompany?: string;
            receiverAddress?: string;
        }>;
    },
    actualCargoByDoItemId: Map<string, NormalizedActualCargoInput>
) {
    const actualTotals = summarizeActualCargoInputs(actualCargoByDoItemId);
    const rawDropPoints = Array.isArray(data.actualDropPoints) ? data.actualDropPoints : [];
    const fallbackPodReceiverName = normalizeOptionalText(data.podReceiverName);
    const fallbackPodReceivedDate = normalizeOptionalText(data.podReceivedDate);
    const fallbackPodNote = normalizeOptionalText(data.podNote);
    const shipperReferences = Array.isArray(deliveryOrder.shipperReferences) ? deliveryOrder.shipperReferences : [];
    const knownDeliveryOrderItemRefs = new Set(actualCargoByDoItemId.keys());

    if (rawDropPoints.length === 0) {
        return [{
            ...buildDefaultActualDropPoint(actualTotals),
            podReceiverName: fallbackPodReceiverName || undefined,
            podReceivedDate: fallbackPodReceivedDate || undefined,
            podNote: fallbackPodNote || undefined,
        }];
    }

    const normalized: NormalizedDeliveryActualDropPoint[] = [];
    rawDropPoints.forEach((rawPoint, index) => {
        if (!isPlainObject(rawPoint)) {
            return;
        }

        const locationName = normalizeOptionalText(rawPoint.locationName);
        const locationAddress = normalizeOptionalText(rawPoint.locationAddress);
        const note = normalizeOptionalText(rawPoint.note);
        const deliveryOrderItemRef = normalizeOptionalText(rawPoint.deliveryOrderItemRef);
        const deliveryOrderItemRefs = Array.isArray(rawPoint.deliveryOrderItemRefs)
            ? [...new Set(
                rawPoint.deliveryOrderItemRefs
                    .map(value => normalizeOptionalText(value))
                    .filter((value): value is string => Boolean(value))
            )]
            : [];
        const normalizedDeliveryOrderItemRefs = deliveryOrderItemRefs.length > 0
            ? deliveryOrderItemRefs
            : deliveryOrderItemRef
                ? [deliveryOrderItemRef]
                : [];
        const actualDropGroupKey = normalizeOptionalText(rawPoint.actualDropGroupKey);
        const requestedShipperReferenceNumber = normalizeOptionalText(rawPoint.shipperReferenceNumber);
        const requestedShipperReferenceKey = normalizeOptionalText(rawPoint.shipperReferenceKey);
        const billingCustomerRef = normalizeOptionalText(rawPoint.billingCustomerRef);
        const billingCustomerName = normalizeOptionalText(rawPoint.billingCustomerName);
        const originLocationName = normalizeOptionalText(rawPoint.originLocationName);
        const originLocationAddress = normalizeOptionalText(rawPoint.originLocationAddress);
        const podReceiverName = normalizeOptionalText(rawPoint.podReceiverName) || fallbackPodReceiverName;
        const podReceivedDate = normalizeOptionalText(rawPoint.podReceivedDate) || fallbackPodReceivedDate;
        const podNote = normalizeOptionalText(rawPoint.podNote) || fallbackPodNote;
        const stopType = normalizeDeliveryDropType(rawPoint.stopType, `Tipe titik drop #${index + 1}`);
        const resolvedActualDropGroupKey = actualDropGroupKey || (
            normalizedDeliveryOrderItemRefs.length > 0
                ? buildActualDropPhysicalGroupKey({
                    stopType,
                    billingCustomerRef,
                    billingCustomerName,
                    originLocationName,
                    originLocationAddress,
                    locationName,
                    locationAddress,
                    note,
                })
                : ''
        );
        const matchedShipperReference =
            shipperReferences.find(reference =>
                requestedShipperReferenceNumber &&
                normalizeOptionalText(reference.referenceNumber) === requestedShipperReferenceNumber
            ) ||
            shipperReferences.find(reference =>
                requestedShipperReferenceKey &&
                normalizeOptionalText(reference._key) === requestedShipperReferenceKey
            ) ||
            shipperReferences.find(reference => {
                const referenceTargetName =
                    normalizeOptionalText(reference.receiverCompany) ||
                    normalizeOptionalText(reference.receiverName) ||
                    normalizeOptionalText(reference.receiverAddress);
                const referenceTargetAddress = normalizeOptionalText(reference.receiverAddress);
                return Boolean(
                    (locationName || locationAddress) &&
                    referenceTargetName === (locationName || locationAddress) &&
                    (!referenceTargetAddress || !locationAddress || referenceTargetAddress === locationAddress)
                );
            });
        const qtyKoli = roundQuantity(normalizeNumber(rawPoint.qtyKoli));
        const itemSpecificActualCargo = normalizedDeliveryOrderItemRefs.length === 1
            ? actualCargoByDoItemId.get(normalizedDeliveryOrderItemRefs[0])
            : undefined;
        const hasExplicitDropWeightInput =
            rawPoint.weightInputValue !== undefined &&
            rawPoint.weightInputValue !== null &&
            (typeof rawPoint.weightInputValue !== 'string' || rawPoint.weightInputValue.trim().length > 0);
        const hasExplicitDropWeight =
            hasExplicitDropWeightInput ||
            (rawPoint.weightKg !== undefined && rawPoint.weightKg !== null);
        const hasExplicitDropWeightUnit =
            rawPoint.weightInputUnit !== undefined &&
            rawPoint.weightInputUnit !== null &&
            (typeof rawPoint.weightInputUnit !== 'string' || rawPoint.weightInputUnit.trim().length > 0);
        const weightInputUnit = hasExplicitDropWeightUnit
            ? resolvePayloadWeightInputUnit(rawPoint.weightInputUnit, `Satuan berat titik drop #${index + 1}`)
            : itemSpecificActualCargo?.actualWeightInputUnit
                || resolvePayloadWeightInputUnit(rawPoint.weightInputUnit, `Satuan berat titik drop #${index + 1}`);
        const itemSpecificWeightKg = !hasExplicitDropWeight && itemSpecificActualCargo &&
            itemSpecificActualCargo.actualQtyKoli > 0 &&
            itemSpecificActualCargo.actualWeightKg > 0 &&
            qtyKoli > 0
            ? calculateWeightPortion(itemSpecificActualCargo.actualWeightKg, itemSpecificActualCargo.actualQtyKoli, qtyKoli)
            : 0;
        const rawWeightInputValue = itemSpecificWeightKg > 0
            ? roundQuantity(convertKgToWeightInputValue(itemSpecificWeightKg, weightInputUnit), getWeightInputFractionDigits(weightInputUnit))
            : roundQuantity(
                normalizeNumber(rawPoint.weightInputValue ?? rawPoint.weightKg ?? 0, {
                    maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
                }),
                getWeightInputFractionDigits(weightInputUnit)
            );
        const volumeInputUnit = resolvePayloadVolumeInputUnit(rawPoint.volumeInputUnit, `Satuan volume titik drop #${index + 1}`);
        const rawVolumeInputValue = roundQuantity(
            normalizeNumber(rawPoint.volumeInputValue ?? rawPoint.volumeM3 ?? 0, {
                maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
            }),
            volumeInputUnit === 'LITER' ? 0 : 3
        );
        const weightKg = itemSpecificWeightKg > 0
            ? itemSpecificWeightKg
            : roundQuantity(convertWeightToKg(rawWeightInputValue, weightInputUnit));
        const volumeM3 = roundQuantity(convertVolumeToM3(rawVolumeInputValue, volumeInputUnit), 3);

        if (!locationName && !locationAddress) {
            throw new Error(`Titik drop #${index + 1} wajib punya nama atau alamat lokasi`);
        }
        if (qtyKoli < 0 || !Number.isFinite(qtyKoli)) {
            throw new Error(`Qty titik drop #${index + 1} tidak valid`);
        }
        if (!Number.isFinite(rawWeightInputValue) || rawWeightInputValue < 0) {
            throw new Error(`Berat titik drop #${index + 1} tidak valid`);
        }
        if (!Number.isFinite(rawVolumeInputValue) || rawVolumeInputValue < 0) {
            throw new Error(`Volume titik drop #${index + 1} tidak valid`);
        }
        if (qtyKoli <= 0 && weightKg <= 0 && volumeM3 <= 0) {
            throw new Error(`Titik drop #${index + 1} wajib punya qty, berat, atau volume lebih dari 0`);
        }
        for (const itemRef of normalizedDeliveryOrderItemRefs) {
            if (!knownDeliveryOrderItemRefs.has(itemRef)) {
                throw new Error(`Barang pada titik drop #${index + 1} bukan milik surat jalan ini`);
            }
        }

        normalized.push({
            _key: crypto.randomUUID(),
            sequence: index + 1,
            stopType,
            deliveryOrderItemRef: normalizedDeliveryOrderItemRefs[0],
            deliveryOrderItemRefs: normalizedDeliveryOrderItemRefs.length > 1 ? normalizedDeliveryOrderItemRefs : undefined,
            actualDropGroupKey: resolvedActualDropGroupKey || undefined,
            shipperReferenceKey: normalizeOptionalText(matchedShipperReference?._key) || requestedShipperReferenceKey,
            shipperReferenceNumber: normalizeOptionalText(matchedShipperReference?.referenceNumber) || requestedShipperReferenceNumber,
            billingCustomerRef,
            billingCustomerName,
            originLocationName: originLocationName || undefined,
            originLocationAddress: originLocationAddress || undefined,
            locationName: locationName || locationAddress || `Titik drop ${index + 1}`,
            locationAddress,
            qtyKoli: qtyKoli > 0 ? qtyKoli : undefined,
            weightKg: weightKg > 0 ? weightKg : undefined,
            weightInputValue: rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
            weightInputUnit: rawWeightInputValue > 0 ? weightInputUnit : undefined,
            volumeM3: volumeM3 > 0 ? volumeM3 : undefined,
            volumeInputValue: rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
            volumeInputUnit: rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
            podReceiverName: podReceiverName || undefined,
            podReceivedDate: podReceivedDate || undefined,
            podNote: podNote || undefined,
            note,
        });
    });

    if (normalized.length === 0) {
        return [{
            ...buildDefaultActualDropPoint(actualTotals),
            podReceiverName: fallbackPodReceiverName || undefined,
            podReceivedDate: fallbackPodReceivedDate || undefined,
            podNote: fallbackPodNote || undefined,
        }];
    }

    return normalized;
}

function hasUsableDropCargo(point: Pick<DeliveryActualDropPoint, 'qtyKoli' | 'weightKg' | 'weightInputValue' | 'weightInputUnit' | 'volumeM3' | 'volumeInputValue' | 'volumeInputUnit'>) {
    const weightKg = normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 }) > 0
        ? normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 })
        : convertWeightToKg(
            normalizeNumber(point.weightInputValue ?? 0, {
                maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
            }),
            point.weightInputUnit || 'KG'
        );
    const volumeM3 = normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 }) > 0
        ? normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 })
        : convertVolumeToM3(
            normalizeNumber(point.volumeInputValue ?? 0, {
                maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
            }),
            point.volumeInputUnit || 'M3'
        );

    return normalizeNumber(point.qtyKoli ?? 0, { maxFractionDigits: 2 }) > 0 || weightKg > 0 || volumeM3 > 0;
}

export function deriveActualCargoInputsFromDropPoints(
    actualDropPoints: NormalizedDeliveryActualDropPoint[] | undefined,
    doItems: DeliveryOrderItemCargoSnapshot[],
    options?: { billableOnly?: boolean }
) {
    const points = actualDropPoints || [];
    const doItemById = new Map(doItems.map(item => [item._id, item]));
    const derived = new Map<string, NormalizedActualCargoInput>();

    const addPointToItem = (itemRef: string, point: NormalizedDeliveryActualDropPoint) => {
        const item = doItemById.get(itemRef);
        if (!item) {
            return;
        }
        const weightInputUnit = point.weightInputUnit || readWeightInputUnit(item.actualWeightInputUnit || item.orderItemWeightInputUnit, 'KG');
        const volumeInputUnit = point.volumeInputUnit || readVolumeInputUnit(item.actualVolumeInputUnit || item.orderItemVolumeInputUnit, 'M3');
        const qtyKoli = roundQuantity(normalizeNumber(point.qtyKoli ?? 0, { maxFractionDigits: 2 }));
        const weightKg = normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 }) > 0
            ? roundQuantity(normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 }))
            : roundQuantity(convertWeightToKg(
                normalizeNumber(point.weightInputValue ?? 0, {
                    maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
                }),
                weightInputUnit
            ));
        const volumeM3 = normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 }) > 0
            ? roundQuantity(normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 }), 3)
            : roundQuantity(convertVolumeToM3(
                normalizeNumber(point.volumeInputValue ?? 0, {
                    maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                volumeInputUnit
            ), 3);
        const current = derived.get(itemRef) || {
            deliveryOrderItemRef: itemRef,
            actualQtyKoli: 0,
            actualWeightKg: 0,
            actualWeightInputUnit: weightInputUnit,
            actualVolumeM3: 0,
            actualVolumeInputUnit: volumeInputUnit,
        };
        const nextWeightKg = roundQuantity(current.actualWeightKg + weightKg);
        const nextVolumeM3 = roundQuantity((current.actualVolumeM3 || 0) + volumeM3, 3);
        const nextWeightUnit = current.actualWeightInputUnit || weightInputUnit;
        const nextVolumeUnit = current.actualVolumeInputUnit || volumeInputUnit;
        derived.set(itemRef, {
            ...current,
            actualQtyKoli: roundQuantity(current.actualQtyKoli + qtyKoli),
            actualWeightKg: nextWeightKg,
            actualWeightInputValue: nextWeightKg > 0
                ? roundQuantity(convertKgToWeightInputValue(nextWeightKg, nextWeightUnit), getWeightInputFractionDigits(nextWeightUnit))
                : undefined,
            actualWeightInputUnit: nextWeightKg > 0 ? nextWeightUnit : undefined,
            actualVolumeM3: nextVolumeM3 > 0 ? nextVolumeM3 : undefined,
            actualVolumeInputValue: nextVolumeM3 > 0
                ? roundQuantity(convertM3ToVolumeInputValue(nextVolumeM3, nextVolumeUnit), nextVolumeUnit === 'LITER' ? 0 : 3)
                : undefined,
            actualVolumeInputUnit: nextVolumeM3 > 0 ? nextVolumeUnit : undefined,
        });
    };

    for (const point of points) {
        if (options?.billableOnly && point.stopType !== 'DROP' && point.stopType !== 'EXTRA_DROP') {
            continue;
        }
        if (!hasUsableDropCargo(point)) {
            continue;
        }
        const pointItemRefs = [
            normalizeOptionalText(point.deliveryOrderItemRef),
            ...(Array.isArray(point.deliveryOrderItemRefs)
                ? point.deliveryOrderItemRefs.map(ref => normalizeOptionalText(ref))
                : []),
        ].filter((ref): ref is string => Boolean(ref));
        if (pointItemRefs.length !== 1) {
            continue;
        }
        addPointToItem(pointItemRefs[0], point);
    }

    return derived.size > 0 ? derived : null;
}

export function summarizeSelection(selection: DeliveryOrderItemSelection, description?: string) {
    if (selection.qtyKoli <= 0) {
        const segments: string[] = [];
        if ((selection.weightInputValue || 0) > 0) {
            segments.push(`${roundQuantity(normalizeNumber(selection.weightInputValue, {
                maxFractionDigits: getWeightInputFractionDigits(selection.weightInputUnit),
            }), getWeightInputFractionDigits(selection.weightInputUnit))} ${selection.weightInputUnit === 'TON' ? 'ton' : 'kg'}`);
        }
        if ((selection.volumeInputValue || 0) > 0) {
            const volumeUnitLabel =
                selection.volumeInputUnit === 'LITER'
                    ? 'liter'
                    : selection.volumeInputUnit === 'KL'
                        ? 'KL'
                        : 'm3';
            segments.push(`${roundQuantity(normalizeNumber(selection.volumeInputValue, {
                maxFractionDigits: selection.volumeInputUnit === 'LITER' ? 0 : 3,
            }), selection.volumeInputUnit === 'LITER' ? 0 : 3)} ${volumeUnitLabel}`);
        }
        return `${description || selection.orderItemRef}: ${segments.join(' / ') || 'muatan parsial'}${selection.holdRemaining ? ' + sisa hold' : ''}`;
    }
    return `${description || selection.orderItemRef}: ${roundQuantity(selection.qtyKoli)} koli${selection.holdRemaining ? ' + sisa hold' : ''}`;
}
