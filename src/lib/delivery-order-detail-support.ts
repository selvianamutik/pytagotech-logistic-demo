import type {
    DeliveryOrder,
    DeliveryOrderItem,
    Driver,
    Order,
    PendingDriverActualCargoItem,
    TrackingLog,
    Vehicle,
} from '@/lib/types';
import { formatFormattedNumberValue, parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    calculateVolumePortion,
    calculateWeightPortion,
    roundQuantity,
} from '@/lib/order-item-progress';
import {
    convertWeightToKg,
    convertKgToWeightInputValue,
    convertVolumeToM3,
    convertM3ToVolumeInputValue,
    formatCargoSummary,
    getWeightInputFractionDigits,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { buildTripResourceAssignments, type DeliveryOrderResourceLock } from '@/lib/trip-resource-lock-support';
import { DO_ACTUAL_DROP_TYPE_MAP, DO_STATUS_MAP, formatDate, formatDateTime, formatShipperDeliveryOrderNumber, formatShipperReceiverSummary } from '@/lib/utils';

export interface ActualCargoDraft {
    deliveryOrderItemRef: string;
    description: string;
    shipperReferenceKey: string;
    shipperReferenceNumber: string;
    plannedQtyKoli: number;
    plannedWeightKg: number;
    plannedWeightInputValue?: number;
    plannedWeightInputUnit?: WeightInputUnit;
    autoWeightBasisQtyKoli?: number;
    autoWeightBasisWeightKg?: number;
    autoVolumeBasisQtyKoli?: number;
    autoVolumeBasisVolumeM3?: number;
    plannedVolumeM3?: number;
    plannedVolumeInputValue?: number;
    plannedVolumeInputUnit?: VolumeInputUnit;
    actualQtyKoli: string;
    actualWeightInputValue: string;
    actualWeightInputUnit: WeightInputUnit;
    actualVolumeInputValue: string;
    actualVolumeInputUnit: VolumeInputUnit;
    requireQty: boolean;
    requireWeight: boolean;
    requireVolume: boolean;
}

export interface ActualDropDraft {
    draftKey: string;
    actualDropGroupKey?: string;
    stopType: 'DROP' | 'HOLD' | 'TRANSIT' | 'EXTRA_DROP' | 'RETURN';
    deliveryOrderItemRef: string;
    shipperReferenceKey: string;
    shipperReferenceNumber: string;
    billingCustomerRef: string;
    billingCustomerName: string;
    originLocationName: string;
    originLocationAddress: string;
    locationName: string;
    locationAddress: string;
    qtyKoli: string;
    weightInputValue: string;
    weightInputUnit: WeightInputUnit;
    autoWeightBasisQtyKoli?: number;
    autoWeightBasisWeightKg?: number;
    autoVolumeBasisQtyKoli?: number;
    autoVolumeBasisVolumeM3?: number;
    volumeInputValue: string;
    volumeInputUnit: VolumeInputUnit;
    note: string;
}

export type DeliveryOrderDetailState = {
    actualCargoTotals: {
        qtyKoli: number;
        weightKg: number;
        weightInputValue?: string;
        weightInputUnit?: WeightInputUnit;
        volumeM3: number;
        volumeInputValue?: string;
        volumeInputUnit?: VolumeInputUnit;
    };
    actualDropTotals: {
        qtyKoli: number;
        weightKg: number;
        volumeM3: number;
    };
    autoActualDropDraft: ActualDropDraft;
    effectiveActualDropPoints: ActualDropDraft[];
    actualCargoReady: boolean;
    actualDropReady: boolean;
    actualDropMismatchMessage: string | null;
    actualDropAmbiguityMessage: string | null;
    actualDropPointCount: number;
    actualDropSummary: NonNullable<DeliveryOrder['actualDropPoints']>;
    hasLiveCoordinates: boolean;
    trackingMapUrl: string | null;
    mapEmbedUrl: string | null;
};

export function buildActualCargoDraft(
    item: DeliveryOrderItem,
    pendingDraft?: PendingDriverActualCargoItem | null
): ActualCargoDraft {
    const plannedQtyKoli = parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0);
    const plannedWeightKg = parseFormattedNumberish(item.orderItemWeight ?? item.shippedWeight ?? 0);
    const plannedWeightInputUnit = item.orderItemWeightInputUnit || 'KG';
    const plannedWeightInputValue =
        item.orderItemWeightInputValue !== undefined && item.orderItemWeightInputValue !== null
            ? parseFormattedNumberish(item.orderItemWeightInputValue, {
                maxFractionDigits: getWeightInputFractionDigits(plannedWeightInputUnit),
            })
            : plannedWeightKg > 0
                ? convertKgToWeightInputValue(plannedWeightKg, plannedWeightInputUnit)
                : undefined;
    const plannedVolumeM3 = parseFormattedNumberish(item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 });
    const plannedVolumeInputUnit = item.orderItemVolumeInputUnit || 'M3';
    const plannedVolumeInputValue =
        item.orderItemVolumeInputValue !== undefined && item.orderItemVolumeInputValue !== null
            ? parseFormattedNumberish(item.orderItemVolumeInputValue, {
                maxFractionDigits: plannedVolumeInputUnit === 'LITER' ? 0 : 3,
            })
            : plannedVolumeM3 > 0
                ? convertM3ToVolumeInputValue(plannedVolumeM3, plannedVolumeInputUnit)
                : undefined;
    const actualWeightInputUnit = pendingDraft?.actualWeightInputUnit || item.actualWeightInputUnit || plannedWeightInputUnit || 'KG';
    const actualWeightInputValue =
        pendingDraft?.actualWeightInputValue !== undefined && pendingDraft.actualWeightInputValue !== null
            ? String(
                parseFormattedNumberish(pendingDraft.actualWeightInputValue, {
                    maxFractionDigits: getWeightInputFractionDigits(actualWeightInputUnit),
                })
            )
            : item.actualWeightInputValue !== undefined && item.actualWeightInputValue !== null
            ? String(
                parseFormattedNumberish(item.actualWeightInputValue, {
                    maxFractionDigits: getWeightInputFractionDigits(actualWeightInputUnit),
                })
            )
            : plannedWeightKg > 0
                ? String(convertKgToWeightInputValue(parseFormattedNumberish(item.actualWeightKg ?? item.orderItemWeight ?? item.shippedWeight ?? 0), actualWeightInputUnit))
                : '';
    const actualVolumeInputUnit = pendingDraft?.actualVolumeInputUnit || item.actualVolumeInputUnit || plannedVolumeInputUnit || 'M3';
    const actualVolumeInputValue =
        pendingDraft?.actualVolumeInputValue !== undefined && pendingDraft.actualVolumeInputValue !== null
            ? formatActualDropNumberValue(
                parseFormattedNumberish(pendingDraft.actualVolumeInputValue, {
                    maxFractionDigits: actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }),
                actualVolumeInputUnit === 'LITER' ? 0 : 3
            )
            : item.actualVolumeInputValue !== undefined && item.actualVolumeInputValue !== null
            ? formatActualDropNumberValue(
                parseFormattedNumberish(item.actualVolumeInputValue, {
                    maxFractionDigits: actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }),
                actualVolumeInputUnit === 'LITER' ? 0 : 3
            )
            : plannedVolumeM3 > 0
                ? formatActualDropNumberValue(convertM3ToVolumeInputValue(parseFormattedNumberish(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), actualVolumeInputUnit), actualVolumeInputUnit === 'LITER' ? 0 : 3)
                : '';
    const initialDraft: ActualCargoDraft = {
        deliveryOrderItemRef: item._id,
        description: item.orderItemDescription || '-',
        shipperReferenceKey: item.shipperReferenceKey || '',
        shipperReferenceNumber: item.shipperReferenceNumber || '',
        plannedQtyKoli,
        plannedWeightKg,
        plannedWeightInputValue,
        plannedWeightInputUnit,
        autoWeightBasisQtyKoli: plannedQtyKoli > 0 ? plannedQtyKoli : undefined,
        autoWeightBasisWeightKg: plannedWeightKg > 0 ? plannedWeightKg : undefined,
        plannedVolumeM3,
        plannedVolumeInputValue,
        plannedVolumeInputUnit,
        autoVolumeBasisQtyKoli: plannedQtyKoli > 0 ? plannedQtyKoli : undefined,
        autoVolumeBasisVolumeM3: plannedVolumeM3 > 0 ? plannedVolumeM3 : undefined,
        actualQtyKoli:
            plannedQtyKoli > 0
                ? String(parseFormattedNumberish(pendingDraft?.actualQtyKoli ?? item.actualQtyKoli ?? item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0))
                : '',
        actualWeightInputValue,
        actualWeightInputUnit,
        actualVolumeInputValue,
        actualVolumeInputUnit,
        requireQty: plannedQtyKoli > 0,
        requireWeight: plannedWeightKg > 0,
        requireVolume: plannedVolumeM3 > 0,
    };

    return pendingDraft ? initialDraft : applyActualCargoAutoWeightFromQty(initialDraft, initialDraft.actualQtyKoli);
}

export function buildActualCargoDrafts(
    items: DeliveryOrderItem[],
    pendingDrafts?: PendingDriverActualCargoItem[]
) {
    const pendingDraftByItemId = new Map(
        (pendingDrafts || [])
            .filter(item => Boolean(item?.deliveryOrderItemRef))
            .map(item => [item.deliveryOrderItemRef, item])
    );

    return items.map(item => buildActualCargoDraft(item, pendingDraftByItemId.get(item._id)));
}

export function updateActualCargoDraftWeightUnit(item: ActualCargoDraft, nextUnit: WeightInputUnit): ActualCargoDraft {
    if (item.actualWeightInputUnit === nextUnit) {
        return item;
    }

    const currentWeightInputValue = parseFormattedNumberish(item.actualWeightInputValue || 0, {
        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
    });
    const currentWeightKg =
        currentWeightInputValue > 0
            ? convertWeightToKg(currentWeightInputValue, item.actualWeightInputUnit)
            : 0;

    return {
        ...item,
        actualWeightInputUnit: nextUnit,
        actualWeightInputValue: currentWeightKg > 0 ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit)) : '',
    };
}

export function shouldLockActualCargoWeight(
    item: Pick<ActualCargoDraft, 'plannedQtyKoli' | 'plannedWeightKg'>
) {
    const plannedQtyKoli = parseFormattedNumberish(item.plannedQtyKoli || 0, { maxFractionDigits: 2 });
    const plannedWeightKg = parseFormattedNumberish(item.plannedWeightKg || 0, { maxFractionDigits: 2 });
    return plannedQtyKoli > 0 && plannedWeightKg > 0;
}

export function shouldLockActualCargoVolume(
    item: Pick<ActualCargoDraft, 'plannedQtyKoli' | 'plannedVolumeM3'>
) {
    const plannedQtyKoli = parseFormattedNumberish(item.plannedQtyKoli || 0, { maxFractionDigits: 2 });
    const plannedVolumeM3 = parseFormattedNumberish(item.plannedVolumeM3 || 0, { maxFractionDigits: 3 });
    return plannedQtyKoli > 0 && plannedVolumeM3 > 0;
}

export function applyActualCargoAutoWeightFromQty(
    item: ActualCargoDraft,
    nextQtyKoli: string | number,
    nextUnit: WeightInputUnit = item.actualWeightInputUnit || item.plannedWeightInputUnit || 'KG'
): ActualCargoDraft {
    const shouldAutoWeight = shouldLockActualCargoWeight(item);
    const shouldAutoVolume = shouldLockActualCargoVolume(item);
    if (!shouldAutoWeight && !shouldAutoVolume) {
        return {
            ...item,
            actualQtyKoli: String(nextQtyKoli),
            actualWeightInputUnit: nextUnit,
        };
    }

    const qtyKoli = parseFormattedNumberish(nextQtyKoli || 0, { maxFractionDigits: 2 });
    const basisQtyKoli =
        item.plannedQtyKoli > 0
            ? item.plannedQtyKoli
            : parseFormattedNumberish(item.autoWeightBasisQtyKoli ?? 0, { maxFractionDigits: 2 });
    const basisWeightKg =
        item.plannedWeightKg > 0
            ? item.plannedWeightKg
            : parseFormattedNumberish(item.autoWeightBasisWeightKg ?? 0, { maxFractionDigits: 2 });
    const basisVolumeQtyKoli =
        item.plannedQtyKoli > 0
            ? item.plannedQtyKoli
            : parseFormattedNumberish(item.autoVolumeBasisQtyKoli ?? 0, { maxFractionDigits: 2 });
    const basisVolumeM3 =
        (item.plannedVolumeM3 || 0) > 0
            ? item.plannedVolumeM3 || 0
            : parseFormattedNumberish(item.autoVolumeBasisVolumeM3 ?? 0, { maxFractionDigits: 3 });
    const currentQtyKoli = parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 });
    const currentWeightInputValue = parseFormattedNumberish(item.actualWeightInputValue || 0, {
        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
    });
    const currentWeightKg =
        currentWeightInputValue > 0
            ? convertWeightToKg(currentWeightInputValue, item.actualWeightInputUnit)
            : 0;
    const currentVolumeInputValue = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
        maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
    });
    const currentVolumeM3 =
        currentVolumeInputValue > 0
            ? convertVolumeToM3(currentVolumeInputValue, item.actualVolumeInputUnit)
            : 0;
    const previousAutoWeightKg = shouldAutoWeight
        ? calculateWeightPortion(basisWeightKg, basisQtyKoli, currentQtyKoli)
        : 0;
    const shouldRefreshAutoWeight =
        currentWeightKg <= 0 ||
        previousAutoWeightKg <= 0 ||
        Math.abs(currentWeightKg - previousAutoWeightKg) <= 0.01;
    const weightKg = shouldRefreshAutoWeight
        ? calculateWeightPortion(basisWeightKg, basisQtyKoli, qtyKoli)
        : currentWeightKg;
    const previousAutoVolumeM3 = shouldAutoVolume
        ? calculateVolumePortion(basisVolumeM3, basisVolumeQtyKoli, currentQtyKoli)
        : 0;
    const shouldRefreshAutoVolume =
        currentVolumeM3 <= 0 ||
        previousAutoVolumeM3 <= 0 ||
        Math.abs(currentVolumeM3 - previousAutoVolumeM3) <= 0.001;
    const volumeM3 = shouldAutoVolume && shouldRefreshAutoVolume
        ? calculateVolumePortion(basisVolumeM3, basisVolumeQtyKoli, qtyKoli)
        : currentVolumeM3;
    const actualWeightInputValue =
        shouldAutoWeight && weightKg > 0
            ? formatActualDropNumberValue(roundQuantity(convertKgToWeightInputValue(weightKg, nextUnit), getWeightInputFractionDigits(nextUnit)), getWeightInputFractionDigits(nextUnit))
            : '';
    const actualVolumeInputValue =
        volumeM3 > 0
            ? formatActualDropNumberValue(roundQuantity(convertM3ToVolumeInputValue(volumeM3, item.actualVolumeInputUnit), item.actualVolumeInputUnit === 'LITER' ? 0 : 3), item.actualVolumeInputUnit === 'LITER' ? 0 : 3)
            : '';

    return {
        ...item,
        actualQtyKoli: String(nextQtyKoli),
        actualWeightInputValue: shouldAutoWeight ? actualWeightInputValue : item.actualWeightInputValue,
        actualWeightInputUnit: nextUnit,
        actualVolumeInputValue: shouldAutoVolume ? actualVolumeInputValue : item.actualVolumeInputValue,
        autoWeightBasisQtyKoli: basisQtyKoli > 0 ? basisQtyKoli : undefined,
        autoWeightBasisWeightKg: basisWeightKg > 0 ? basisWeightKg : undefined,
        autoVolumeBasisQtyKoli: basisVolumeQtyKoli > 0 ? basisVolumeQtyKoli : undefined,
        autoVolumeBasisVolumeM3: basisVolumeM3 > 0 ? basisVolumeM3 : undefined,
    };
}

export function shouldLockActualDropWeight(cargoItem?: ActualCargoDraft | null) {
    return Boolean(cargoItem && shouldLockActualCargoWeight(cargoItem));
}

export function shouldLockActualDropVolume(cargoItem?: ActualCargoDraft | null) {
    return Boolean(cargoItem && shouldLockActualCargoVolume(cargoItem));
}

export function updateActualDropDraftWeightUnit(drop: ActualDropDraft, nextUnit: WeightInputUnit): ActualDropDraft {
    if (drop.weightInputUnit === nextUnit) {
        return drop;
    }

    const currentWeightInputValue = parseFormattedNumberish(drop.weightInputValue || 0, {
        maxFractionDigits: getWeightInputFractionDigits(drop.weightInputUnit),
    });
    const currentWeightKg =
        currentWeightInputValue > 0
            ? convertWeightToKg(currentWeightInputValue, drop.weightInputUnit)
            : 0;

    return {
        ...drop,
        weightInputUnit: nextUnit,
        weightInputValue: currentWeightKg > 0
            ? String(roundQuantity(convertKgToWeightInputValue(currentWeightKg, nextUnit), getWeightInputFractionDigits(nextUnit)))
            : '',
    };
}

export function updateActualDropDraftVolumeUnit(drop: ActualDropDraft, nextUnit: VolumeInputUnit): ActualDropDraft {
    if (drop.volumeInputUnit === nextUnit) {
        return drop;
    }

    const currentVolumeInputValue = parseFormattedNumberish(drop.volumeInputValue || 0, {
        maxFractionDigits: drop.volumeInputUnit === 'LITER' ? 0 : 3,
    });
    const currentVolumeM3 =
        currentVolumeInputValue > 0
            ? convertVolumeToM3(currentVolumeInputValue, drop.volumeInputUnit)
            : 0;

    return {
        ...drop,
        volumeInputUnit: nextUnit,
        volumeInputValue: currentVolumeM3 > 0
            ? formatActualDropNumberValue(
                roundQuantity(convertM3ToVolumeInputValue(currentVolumeM3, nextUnit), nextUnit === 'LITER' ? 0 : 3),
                nextUnit === 'LITER' ? 0 : 3
            )
            : '',
    };
}

export function applyActualDropAutoWeightFromQty(
    drop: ActualDropDraft,
    cargoItem: ActualCargoDraft | undefined,
    nextQtyKoli: string | number,
    nextUnit: WeightInputUnit = drop.weightInputUnit
): ActualDropDraft {
    const shouldAutoWeight = shouldLockActualDropWeight(cargoItem);
    const shouldAutoVolume = shouldLockActualDropVolume(cargoItem);
    if (!shouldAutoWeight && !shouldAutoVolume) {
        return {
            ...drop,
            qtyKoli: String(nextQtyKoli),
            weightInputUnit: nextUnit,
        };
    }

    const qtyKoli = parseFormattedNumberish(nextQtyKoli || 0, { maxFractionDigits: 2 });
    const actualQtyKoli = parseFormattedNumberish(cargoItem?.actualQtyKoli || 0, { maxFractionDigits: 2 });
    const actualWeightKg = cargoItem
        ? convertWeightToKg(
            parseFormattedNumberish(cargoItem.actualWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(cargoItem.actualWeightInputUnit),
            }),
            cargoItem.actualWeightInputUnit
        )
        : 0;
    const actualVolumeM3 = cargoItem
        ? convertVolumeToM3(
            parseFormattedNumberish(cargoItem.actualVolumeInputValue || 0, {
                maxFractionDigits: cargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            cargoItem.actualVolumeInputUnit
        )
        : 0;
    const basisQtyKoli = actualQtyKoli > 0
        ? actualQtyKoli
        : cargoItem?.plannedQtyKoli || parseFormattedNumberish(drop.autoWeightBasisQtyKoli ?? 0, { maxFractionDigits: 2 });
    const basisWeightKg = actualWeightKg > 0
        ? actualWeightKg
        : cargoItem?.plannedWeightKg || parseFormattedNumberish(drop.autoWeightBasisWeightKg ?? 0, { maxFractionDigits: 2 });
    const basisVolumeQtyKoli = actualQtyKoli > 0
        ? actualQtyKoli
        : cargoItem?.plannedQtyKoli || parseFormattedNumberish(drop.autoVolumeBasisQtyKoli ?? 0, { maxFractionDigits: 2 });
    const basisVolumeM3 = actualVolumeM3 > 0
        ? actualVolumeM3
        : cargoItem?.plannedVolumeM3 || parseFormattedNumberish(drop.autoVolumeBasisVolumeM3 ?? 0, { maxFractionDigits: 3 });
    const currentQtyKoli = parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 });
    const currentWeightInputValue = parseFormattedNumberish(drop.weightInputValue || 0, {
        maxFractionDigits: getWeightInputFractionDigits(drop.weightInputUnit),
    });
    const currentWeightKg =
        currentWeightInputValue > 0
            ? convertWeightToKg(currentWeightInputValue, drop.weightInputUnit)
            : 0;
    const currentVolumeInputValue = parseFormattedNumberish(drop.volumeInputValue || 0, {
        maxFractionDigits: drop.volumeInputUnit === 'LITER' ? 0 : 3,
    });
    const currentVolumeM3 =
        currentVolumeInputValue > 0
            ? convertVolumeToM3(currentVolumeInputValue, drop.volumeInputUnit)
            : 0;
    const previousAutoWeightKg = shouldAutoWeight
        ? calculateWeightPortion(basisWeightKg, basisQtyKoli, currentQtyKoli)
        : 0;
    const shouldRefreshAutoWeight =
        currentWeightKg <= 0 ||
        previousAutoWeightKg <= 0 ||
        Math.abs(currentWeightKg - previousAutoWeightKg) <= 0.01;
    const weightKg = shouldRefreshAutoWeight
        ? calculateWeightPortion(basisWeightKg, basisQtyKoli, qtyKoli)
        : currentWeightKg;
    const previousAutoVolumeM3 = shouldAutoVolume
        ? calculateVolumePortion(basisVolumeM3, basisVolumeQtyKoli, currentQtyKoli)
        : 0;
    const shouldRefreshAutoVolume =
        currentVolumeM3 <= 0 ||
        previousAutoVolumeM3 <= 0 ||
        Math.abs(currentVolumeM3 - previousAutoVolumeM3) <= 0.001;
    const volumeM3 = shouldAutoVolume && shouldRefreshAutoVolume
        ? calculateVolumePortion(basisVolumeM3, basisVolumeQtyKoli, qtyKoli)
        : currentVolumeM3;

    return {
        ...drop,
        qtyKoli: String(nextQtyKoli),
        weightInputValue: shouldAutoWeight
            ? formatActualDropNumberValue(roundQuantity(convertKgToWeightInputValue(weightKg, nextUnit), getWeightInputFractionDigits(nextUnit)), getWeightInputFractionDigits(nextUnit))
            : drop.weightInputValue,
        weightInputUnit: nextUnit,
        volumeInputValue: shouldAutoVolume
            ? formatActualDropNumberValue(roundQuantity(convertM3ToVolumeInputValue(volumeM3, drop.volumeInputUnit), drop.volumeInputUnit === 'LITER' ? 0 : 3), drop.volumeInputUnit === 'LITER' ? 0 : 3)
            : drop.volumeInputValue,
        autoWeightBasisQtyKoli: basisQtyKoli > 0 ? basisQtyKoli : undefined,
        autoWeightBasisWeightKg: basisWeightKg > 0 ? basisWeightKg : undefined,
        autoVolumeBasisQtyKoli: basisVolumeQtyKoli > 0 ? basisVolumeQtyKoli : undefined,
        autoVolumeBasisVolumeM3: basisVolumeM3 > 0 ? basisVolumeM3 : undefined,
    };
}

export function updateActualCargoDraftVolumeUnit(item: ActualCargoDraft, nextUnit: VolumeInputUnit): ActualCargoDraft {
    if (item.actualVolumeInputUnit === nextUnit) {
        return item;
    }

    const currentVolumeInputValue = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
        maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
    });
    const currentVolumeM3 =
        currentVolumeInputValue > 0
            ? convertVolumeToM3(currentVolumeInputValue, item.actualVolumeInputUnit)
            : 0;

    return {
        ...item,
        actualVolumeInputUnit: nextUnit,
        actualVolumeInputValue: currentVolumeM3 > 0 ? formatActualDropNumberValue(convertM3ToVolumeInputValue(currentVolumeM3, nextUnit), nextUnit === 'LITER' ? 0 : 3) : '',
    };
}

export function summarizeActualCargoDrafts(items: ActualCargoDraft[]) {
    const qtyKoli = items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli || 0), 0);
    const weightKg = items.reduce((sum, item) => {
        const value = parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        });
        if (!value) return sum;
        return sum + (item.actualWeightInputUnit === 'TON' ? value * 1000 : value);
    }, 0);
    const volumeM3 = items.reduce((sum, item) => {
        const value = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });
        if (!value) return sum;
        if (item.actualVolumeInputUnit === 'LITER') return sum + value / 1000;
        if (item.actualVolumeInputUnit === 'KL') return sum + value;
        return sum + value;
    }, 0);

    const singleItem = items.length === 1 ? items[0] : null;

    return {
        qtyKoli,
        weightKg,
        weightInputValue: singleItem?.actualWeightInputValue,
        weightInputUnit: singleItem?.actualWeightInputUnit,
        volumeM3,
        volumeInputValue: singleItem?.actualVolumeInputValue,
        volumeInputUnit: singleItem?.actualVolumeInputUnit,
    };
}

type DropReferenceLike = {
    deliveryOrderItemRef?: string;
    shipperReferenceKey?: string;
    shipperReferenceNumber?: string;
};

export function getActualCargoDraftsForDrop(drop: DropReferenceLike, cargoItems: ActualCargoDraft[]) {
    const deliveryOrderItemRef = (drop.deliveryOrderItemRef || '').trim();
    if (deliveryOrderItemRef) {
        return cargoItems.filter(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
    }

    const shipperReferenceKey = (drop.shipperReferenceKey || '').trim();
    const shipperReferenceNumber = (drop.shipperReferenceNumber || '').trim().toUpperCase();
    if (!shipperReferenceKey && !shipperReferenceNumber) {
        return cargoItems;
    }

    return cargoItems.filter(item => {
        const itemReferenceKey = item.shipperReferenceKey.trim();
        const itemReferenceNumber = item.shipperReferenceNumber.trim().toUpperCase();
        return (
            (shipperReferenceKey && itemReferenceKey === shipperReferenceKey) ||
            (shipperReferenceNumber && itemReferenceNumber === shipperReferenceNumber)
        );
    });
}

export function summarizeActualCargoDraftDescriptions(items: ActualCargoDraft[]) {
    const descriptions = Array.from(new Set(
        items
            .map(item => item.description.trim())
            .filter(Boolean)
    ));
    if (descriptions.length === 0) {
        return 'Belum ada barang';
    }
    if (descriptions.length <= 3) {
        return descriptions.join(', ');
    }
    return `${descriptions.slice(0, 3).join(', ')} +${descriptions.length - 3} barang`;
}

export function getDeliveryOrderItemsForDrop(drop: DropReferenceLike, items: DeliveryOrderItem[]) {
    const deliveryOrderItemRef = (drop.deliveryOrderItemRef || '').trim();
    if (deliveryOrderItemRef) {
        return items.filter(item => item._id === deliveryOrderItemRef);
    }

    const shipperReferenceKey = (drop.shipperReferenceKey || '').trim();
    const shipperReferenceNumber = (drop.shipperReferenceNumber || '').trim().toUpperCase();
    if (!shipperReferenceKey && !shipperReferenceNumber) {
        return items;
    }

    return items.filter(item => {
        const itemReferenceKey = (item.shipperReferenceKey || '').trim();
        const itemReferenceNumber = (item.shipperReferenceNumber || '').trim().toUpperCase();
        return (
            (shipperReferenceKey && itemReferenceKey === shipperReferenceKey) ||
            (shipperReferenceNumber && itemReferenceNumber === shipperReferenceNumber)
        );
    });
}

export function summarizeDeliveryOrderItemDescriptionsForDrop(
    drop: DropReferenceLike,
    items: DeliveryOrderItem[]
) {
    const descriptions = Array.from(new Set(
        getDeliveryOrderItemsForDrop(drop, items)
            .map(item => (item.orderItemDescription || '').trim())
            .filter(Boolean)
    ));
    if (descriptions.length === 0) {
        return 'Belum ada barang';
    }
    if (descriptions.length <= 3) {
        return descriptions.join(', ');
    }
    return `${descriptions.slice(0, 3).join(', ')} +${descriptions.length - 3} barang`;
}

export function summarizeActualDropDrafts(items: ActualDropDraft[]) {
    const qtyKoli = items.reduce((sum, item) => sum + parseFormattedNumberish(item.qtyKoli || 0), 0);
    const weightKg = items.reduce((sum, item) => {
        const value = parseFormattedNumberish(item.weightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
        });
        if (!value) return sum;
        return sum + convertWeightToKg(value, item.weightInputUnit);
    }, 0);
    const volumeM3 = items.reduce((sum, item) => {
        const value = parseFormattedNumberish(item.volumeInputValue || 0, {
            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
        });
        if (!value) return sum;
        return sum + convertVolumeToM3(value, item.volumeInputUnit);
    }, 0);

    return {
        qtyKoli,
        weightKg,
        volumeM3,
    };
}

function formatActualDropNumberValue(value: number, maxFractionDigits: number) {
    return formatFormattedNumberValue(value, true, maxFractionDigits, true);
}

function getActualDropMismatchMessage(
    actualCargoTotals: DeliveryOrderDetailState['actualCargoTotals'],
    actualDropTotals: DeliveryOrderDetailState['actualDropTotals']
) {
    if (actualCargoTotals.qtyKoli > 0 && Math.abs(actualDropTotals.qtyKoli - actualCargoTotals.qtyKoli) > 0.01) {
        return 'Total qty titik realisasi harus sama dengan qty aktual muatan.';
    }
    if (actualCargoTotals.weightKg > 0 && Math.abs(actualDropTotals.weightKg - actualCargoTotals.weightKg) > 0.01) {
        return 'Total berat titik realisasi harus sama dengan berat aktual muatan.';
    }
    if (actualCargoTotals.volumeM3 > 0 && Math.abs(actualDropTotals.volumeM3 - actualCargoTotals.volumeM3) > 0.001) {
        return 'Total volume titik realisasi harus sama dengan volume aktual muatan.';
    }
    return null;
}

function getActualDropAmbiguityMessage(
    actualDropPoints: ActualDropDraft[],
    cargoItems: ActualCargoDraft[]
) {
    if (actualDropPoints.length <= 1 || cargoItems.length <= 1) {
        return null;
    }

    const billableTypes = new Set<ActualDropDraft['stopType']>(['DROP', 'EXTRA_DROP']);
    const nonBillableTypes = new Set<ActualDropDraft['stopType']>(['HOLD', 'TRANSIT', 'RETURN']);
    const cargoGroups = cargoItems.reduce<Map<string, ActualCargoDraft[]>>((acc, item) => {
        const key = item.shipperReferenceKey || item.shipperReferenceNumber || 'TANPA-SJ';
        const current = acc.get(key) || [];
        current.push(item);
        acc.set(key, current);
        return acc;
    }, new Map());

    for (const [groupKey, groupItems] of cargoGroups.entries()) {
        if (groupItems.length <= 1) {
            continue;
        }

        const groupItemRefs = new Set(groupItems.map(item => item.deliveryOrderItemRef));
        const groupDrops = actualDropPoints.filter(drop => {
            const dropItems = getActualCargoDraftsForDrop(drop, cargoItems);
            return dropItems.some(item => groupItemRefs.has(item.deliveryOrderItemRef));
        });
        const hasBillable = groupDrops.some(drop => billableTypes.has(drop.stopType));
        const hasNonBillable = groupDrops.some(drop => nonBillableTypes.has(drop.stopType));
        if (!hasBillable || !hasNonBillable) {
            continue;
        }

        const hasAmbiguousDrop = groupDrops.some(drop => {
            if (drop.deliveryOrderItemRef.trim()) {
                return false;
            }
            return getActualCargoDraftsForDrop(drop, cargoItems).length > 1;
        });
        if (hasAmbiguousDrop) {
            const groupLabel = groupKey === 'TANPA-SJ'
                ? 'SJ ini'
                : `SJ ${groupItems[0]?.shipperReferenceNumber || groupKey}`;
            return `${groupLabel} punya campuran drop dan hold/return. Pilih barang spesifik untuk setiap titik agar invoice per barang tidak salah.`;
        }
    }

    return null;
}

function resolveDefaultActualDropTarget() {
    return {
        locationName: '',
        locationAddress: '',
        distinctTargetCount: 0,
    };
}

export function buildDefaultActualDropDrafts(
    doData: DeliveryOrder | null,
    cargoItems: ActualCargoDraft[],
    sourceDropPoints: DeliveryOrder['actualDropPoints'] | DeliveryOrder['pendingDriverActualDropPoints'] = doData?.actualDropPoints
): ActualDropDraft[] {
    if (sourceDropPoints && sourceDropPoints.length > 0) {
        return sourceDropPoints.map((point, index) => ({
            draftKey: point._key || `${index + 1}`,
            stopType: point.stopType,
            deliveryOrderItemRef: point.deliveryOrderItemRef || '',
            shipperReferenceKey: point.shipperReferenceKey || '',
            shipperReferenceNumber: point.shipperReferenceNumber || '',
            billingCustomerRef: point.billingCustomerRef || '',
            billingCustomerName: point.billingCustomerName || '',
            originLocationName: point.originLocationName || '',
            originLocationAddress: point.originLocationAddress || '',
            locationName: point.locationName || '',
            locationAddress: point.locationAddress || '',
            qtyKoli: point.qtyKoli !== undefined ? formatActualDropNumberValue(point.qtyKoli, 2) : '',
            weightInputValue: point.weightInputValue !== undefined
                ? formatActualDropNumberValue(point.weightInputValue, getWeightInputFractionDigits(point.weightInputUnit || 'KG'))
                : point.weightKg !== undefined
                    ? formatActualDropNumberValue(point.weightKg, 2)
                    : '',
            weightInputUnit: point.weightInputUnit || 'KG',
            volumeInputValue: point.volumeInputValue !== undefined
                ? formatActualDropNumberValue(point.volumeInputValue, (point.volumeInputUnit || 'M3') === 'LITER' ? 0 : 3)
                : point.volumeM3 !== undefined
                    ? formatActualDropNumberValue(point.volumeM3, 3)
                    : '',
            volumeInputUnit: point.volumeInputUnit || 'M3',
            note: point.note || '',
        }));
    }

    const defaultTarget = resolveDefaultActualDropTarget();
    const shipperReferences = doData?.shipperReferences || [];
    const buildDraftFromCargoItems = (
        items: ActualCargoDraft[],
        locationName: string,
        locationAddress: string,
        reference?: {
            key?: string;
            number?: string;
        }
    ): ActualDropDraft => {
        const itemTotals = summarizeActualCargoDrafts(items);
        const singleItem = items.length === 1 ? items[0] : null;
        return {
        draftKey: crypto.randomUUID(),
        stopType: 'DROP',
        deliveryOrderItemRef: '',
        shipperReferenceKey: reference?.key || singleItem?.shipperReferenceKey || '',
        shipperReferenceNumber: reference?.number || singleItem?.shipperReferenceNumber || '',
        billingCustomerRef: '',
        billingCustomerName: '',
        originLocationName: '',
        originLocationAddress: '',
        locationName,
        locationAddress,
        qtyKoli: formatActualDropNumberValue(itemTotals.qtyKoli, 2),
        weightInputValue: formatActualDropNumberValue(itemTotals.weightKg, 2),
        weightInputUnit: 'KG',
        volumeInputValue: formatActualDropNumberValue(itemTotals.volumeM3, 3),
        volumeInputUnit: 'M3',
        note: '',
        };
    };

    const singleShipperReference = shipperReferences.length === 1 ? shipperReferences[0] : null;
    return [
        buildDraftFromCargoItems(cargoItems, defaultTarget.locationName, defaultTarget.locationAddress, {
            key: singleShipperReference?._key || '',
            number: singleShipperReference?.referenceNumber || '',
        }),
    ];
}

export function buildAutoActualDropDraft(doData: DeliveryOrder | null, cargoItems: ActualCargoDraft[]): ActualDropDraft {
    const totals = summarizeActualCargoDrafts(cargoItems);
    const defaultTarget = resolveDefaultActualDropTarget();
    const singleShipperReference = doData?.shipperReferences?.length === 1 ? doData.shipperReferences[0] : null;
    return {
        draftKey: 'auto-default-drop',
        stopType: 'DROP',
        deliveryOrderItemRef: '',
        shipperReferenceKey: singleShipperReference?._key || '',
        shipperReferenceNumber: singleShipperReference?.referenceNumber || '',
        billingCustomerRef: '',
        billingCustomerName: '',
        originLocationName: '',
        originLocationAddress: '',
        locationName: defaultTarget.locationName,
        locationAddress: defaultTarget.locationAddress,
        qtyKoli: formatActualDropNumberValue(totals.qtyKoli, 2),
        weightInputValue: formatActualDropNumberValue(totals.weightKg, 2),
        weightInputUnit: 'KG',
        volumeInputValue: formatActualDropNumberValue(totals.volumeM3, 3),
        volumeInputUnit: 'M3',
        note: '',
    };
}

export function shouldOpenAdvancedDropEditor(doData: DeliveryOrder | null, dropDrafts: ActualDropDraft[]) {
    const defaultTarget = resolveDefaultActualDropTarget();

    if (defaultTarget.distinctTargetCount > 1) {
        return true;
    }

    return dropDrafts.length > 1 || dropDrafts.some(point =>
        point.stopType !== 'DROP' ||
        (point.locationName || '') !== defaultTarget.locationName ||
        (point.locationAddress || '') !== defaultTarget.locationAddress ||
        point.note.trim().length > 0
    );
}

export function getNextDeliveryOrderStatuses(current: string): string[] {
    const transitions: Record<string, string[]> = {
        CREATED: ['ON_DELIVERY'],
        ON_DELIVERY: ['ARRIVED'],
        ARRIVED: ['DELIVERED'],
        PARTIAL_HOLD: ['ON_DELIVERY'],
        DELIVERED: [],
    };
    return transitions[current] || [];
}

export function buildTripResourceAssignmentIndex(params: {
    activeDeliveryOrders: DeliveryOrderResourceLock[];
    activeOrders?: Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>;
}) {
    return buildTripResourceAssignments({
        deliveryOrders: params.activeDeliveryOrders,
        orders: params.activeOrders || [],
    });
}

export function getAssignableTripVehicles(params: {
    vehicles: Vehicle[];
    currentVehicleRef?: string;
    requestedServiceRef?: string;
}) {
    const { vehicles, requestedServiceRef } = params;

    return vehicles
        .filter(vehicle => {
            const isCurrent = vehicle._id === params.currentVehicleRef;
            if (!isCurrent && ['SOLD', 'OUT_OF_SERVICE'].includes(vehicle.status)) {
                return false;
            }
            return true;
        })
        .sort((left, right) => {
            const leftMatches = requestedServiceRef && left.serviceRef === requestedServiceRef ? 1 : 0;
            const rightMatches = requestedServiceRef && right.serviceRef === requestedServiceRef ? 1 : 0;
            if (leftMatches !== rightMatches) {
                return rightMatches - leftMatches;
            }
            const leftLabel = `${left.unitCode || ''} ${left.plateNumber || ''}`.trim();
            const rightLabel = `${right.unitCode || ''} ${right.plateNumber || ''}`.trim();
            return leftLabel.localeCompare(rightLabel, 'id');
        });
}

export function getAssignableTripDrivers(params: {
    drivers: Driver[];
    currentDriverRef?: string;
}) {
    const { drivers } = params;

    return drivers
        .filter(driver => {
            const isCurrent = driver._id === params.currentDriverRef;
            return driver.active !== false || isCurrent;
        })
        .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'id'));
}

export function shouldRequireTripVehicleOverrideReason(deliveryOrder: DeliveryOrder | null, vehicle: Vehicle | null) {
    if (!deliveryOrder?.serviceRef || !vehicle) {
        return false;
    }
    return (vehicle.serviceRef || '') !== deliveryOrder.serviceRef;
}

export function getTripResourceActionLabel(deliveryOrder: DeliveryOrder | null) {
    if (!deliveryOrder) {
        return 'Lengkapi Armada Trip';
    }
    if (!deliveryOrder.vehicleRef && !deliveryOrder.driverRef) {
        return 'Lengkapi Armada Trip';
    }
    if (!deliveryOrder.vehicleRef) {
        return 'Pilih Kendaraan';
    }
    if (!deliveryOrder.driverRef) {
        return 'Pilih Supir';
    }
    return 'Ganti Armada / Supir';
}

export function buildDeliveryOrderDetailState(params: {
    doData: DeliveryOrder | null;
    actualCargoItems: ActualCargoDraft[];
    actualDropPoints: ActualDropDraft[];
    showAdvancedDropEditor: boolean;
}): DeliveryOrderDetailState {
    const { doData, actualCargoItems, actualDropPoints, showAdvancedDropEditor } = params;
    const actualCargoTotals = summarizeActualCargoDrafts(actualCargoItems);
    const defaultAutoActualDropDraft = buildAutoActualDropDraft(doData, actualCargoItems);
    const manualAutoDropDraft = !showAdvancedDropEditor && actualDropPoints.length === 1
        ? actualDropPoints[0]
        : null;
    const autoActualDropDraft = manualAutoDropDraft
        ? {
            ...defaultAutoActualDropDraft,
            draftKey: manualAutoDropDraft.draftKey || defaultAutoActualDropDraft.draftKey,
            stopType: manualAutoDropDraft.stopType || defaultAutoActualDropDraft.stopType,
            deliveryOrderItemRef: manualAutoDropDraft.deliveryOrderItemRef || defaultAutoActualDropDraft.deliveryOrderItemRef,
            shipperReferenceKey: manualAutoDropDraft.shipperReferenceKey || defaultAutoActualDropDraft.shipperReferenceKey,
            shipperReferenceNumber: manualAutoDropDraft.shipperReferenceNumber || defaultAutoActualDropDraft.shipperReferenceNumber,
            billingCustomerRef: manualAutoDropDraft.billingCustomerRef || defaultAutoActualDropDraft.billingCustomerRef,
            billingCustomerName: manualAutoDropDraft.billingCustomerName || defaultAutoActualDropDraft.billingCustomerName,
            originLocationName: manualAutoDropDraft.originLocationName || defaultAutoActualDropDraft.originLocationName,
            originLocationAddress: manualAutoDropDraft.originLocationAddress || defaultAutoActualDropDraft.originLocationAddress,
            locationName: manualAutoDropDraft.locationName,
            locationAddress: manualAutoDropDraft.locationAddress,
            note: manualAutoDropDraft.note || defaultAutoActualDropDraft.note,
        }
        : defaultAutoActualDropDraft;
    const effectiveActualDropPoints = showAdvancedDropEditor ? actualDropPoints : [autoActualDropDraft];
    const actualDropTotals = summarizeActualDropDrafts(effectiveActualDropPoints);
    const actualCargoReady = actualCargoItems.every(item => {
        const qty = parseFormattedNumberish(item.actualQtyKoli);
        const weight = parseFormattedNumberish(item.actualWeightInputValue, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        });
        const volume = parseFormattedNumberish(item.actualVolumeInputValue, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });
        return (
            (!item.requireQty || (Number.isFinite(qty) && qty > 0)) &&
            (!item.requireWeight || (Number.isFinite(weight) && weight > 0)) &&
            (!item.requireVolume || (Number.isFinite(volume) && volume > 0)) &&
            (
                (item.requireQty && Number.isFinite(qty) && qty > 0) ||
                (Number.isFinite(weight) && weight > 0) ||
                (Number.isFinite(volume) && volume > 0)
            )
        );
    });
    const actualDropMismatchMessage = getActualDropMismatchMessage(actualCargoTotals, actualDropTotals);
    const actualDropAmbiguityMessage = getActualDropAmbiguityMessage(effectiveActualDropPoints, actualCargoItems);
    const actualDropReady = effectiveActualDropPoints.length > 0 && effectiveActualDropPoints.every(item => {
        const qty = parseFormattedNumberish(item.qtyKoli);
        const weight = parseFormattedNumberish(item.weightInputValue, {
            maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
        });
        const volume = parseFormattedNumberish(item.volumeInputValue, {
            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
        });
        return (
            Boolean(item.locationName.trim() || item.locationAddress.trim()) &&
            ((Number.isFinite(qty) && qty > 0) || (Number.isFinite(weight) && weight > 0) || (Number.isFinite(volume) && volume > 0))
        );
    }) && !actualDropMismatchMessage && !actualDropAmbiguityMessage;
    const actualDropPointCount = effectiveActualDropPoints.length;
    const actualDropSummary = doData?.actualDropPoints || [];
    const hasLiveCoordinates = typeof doData?.trackingLastLat === 'number' && typeof doData?.trackingLastLng === 'number';
    const trackingMapUrl = hasLiveCoordinates ? `https://www.google.com/maps?q=${doData?.trackingLastLat},${doData?.trackingLastLng}` : null;
    const trackingLat = hasLiveCoordinates ? (doData?.trackingLastLat as number) : null;
    const trackingLng = hasLiveCoordinates ? (doData?.trackingLastLng as number) : null;
    const mapEmbedUrl = hasLiveCoordinates
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${trackingLng! - 0.01},${trackingLat! - 0.01},${trackingLng! + 0.01},${trackingLat! + 0.01}&layer=mapnik&marker=${trackingLat!},${trackingLng!}`
        : null;

    return {
        actualCargoTotals,
        actualDropTotals,
        autoActualDropDraft,
        effectiveActualDropPoints,
        actualCargoReady,
        actualDropReady,
        actualDropMismatchMessage,
        actualDropAmbiguityMessage,
        actualDropPointCount,
        actualDropSummary,
        hasLiveCoordinates,
        trackingMapUrl,
        mapEmbedUrl,
    };
}

export function buildDeliveryOrderPrintHtml(
    doData: DeliveryOrder,
    doItems: DeliveryOrderItem[],
    trackingLogs: Array<Pick<TrackingLog, 'status' | 'note' | 'locationText' | 'timestamp'>>
) {
    const receiverSummary = formatShipperReceiverSummary(doData, {
        mode: 'summary',
        fallback: '-',
    });
    const receiverFullSummary = formatShipperReceiverSummary(doData, {
        mode: 'full',
        fallback: '-',
    });

    return `
        <div style="margin-bottom:16px">
            <table style="width:100%;border:none"><tbody>
                <tr>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">No. SJ Pengirim</td>
                    <td style="border:none;padding:2px 8px">${formatShipperDeliveryOrderNumber(doData, { mode: 'full' })}</td>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">Tanggal</td>
                    <td style="border:none;padding:2px 8px">${formatDate(doData.date || '')}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">No. DO Internal</td>
                    <td style="border:none;padding:2px 8px">${doData.doNumber || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Master Resi</td>
                    <td style="border:none;padding:2px 8px">${doData.masterResi || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600"></td>
                    <td style="border:none;padding:2px 8px"></td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Status</td>
                    <td style="border:none;padding:2px 8px">${DO_STATUS_MAP[doData.status || '']?.label || doData.status || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Customer</td>
                    <td style="border:none;padding:2px 8px">${doData.customerName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                    <td style="border:none;padding:2px 8px">${doData.vehiclePlate || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Driver</td>
                    <td style="border:none;padding:2px 8px">${doData.driverName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Penerima</td>
                    <td style="border:none;padding:2px 8px">${receiverSummary}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Telepon Penerima</td>
                    <td style="border:none;padding:2px 8px">${doData.receiverPhone || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Armada Diminta</td>
                    <td style="border:none;padding:2px 8px">${doData.serviceName || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Armada Aktual</td>
                    <td style="border:none;padding:2px 8px">${doData.vehicleServiceName || doData.serviceName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                    <td style="border:none;padding:2px 8px">${doData.vehiclePlate || '-'}</td>
                </tr>
                ${doData.vehicleCategoryOverrideReason ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Alasan Override Armada</td><td colspan="3" style="border:none;padding:2px 8px">${doData.vehicleCategoryOverrideReason}</td></tr>` : ''}
                ${doData.receiverCompany ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Perusahaan Penerima</td><td colspan="3" style="border:none;padding:2px 8px">${doData.receiverCompany}</td></tr>` : ''}
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Alamat Pickup</td>
                    <td colspan="3" style="border:none;padding:2px 8px">${doData.pickupAddress || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Alamat Penerima</td>
                    <td colspan="3" style="border:none;padding:2px 8px">${receiverFullSummary}</td>
                </tr>
                ${doData.notes ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Catatan</td><td colspan="3" style="border:none;padding:2px 8px">${doData.notes}</td></tr>` : ''}
                ${doData.podReceiverName ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">POD</td><td colspan="3" style="border:none;padding:2px 8px">Diterima oleh ${doData.podReceiverName} pada ${formatDate(doData.podReceivedDate || '')}${doData.podNote ? ` - ${doData.podNote}` : ''}</td></tr>` : ''}
            </tbody></table>
        </div>
        ${(doData.shipperReferences || []).length > 0 ? `
        <div class="section-title">Ringkasan SJ Pengirim</div>
        <table>
            <thead>
                <tr>
                    <th>No. SJ</th>
                    <th>Customer Invoice</th>
                    <th>Tujuan</th>
                    <th>Alamat Tujuan</th>
                </tr>
            </thead>
            <tbody>
                ${(doData.shipperReferences || []).map(reference => `
                    <tr>
                        <td>${reference.referenceNumber || '-'}</td>
                        <td>${reference.billingCustomerName || doData.customerName || '-'}</td>
                        <td>${reference.receiverCompany || reference.receiverName || '-'}</td>
                        <td>${reference.receiverAddress || '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        ` : ''}
        <div class="section-title">Route Invoice & Realisasi Drop</div>
        <table>
            <thead>
                <tr>
                    <th>Tipe</th>
                    <th>Lokasi</th>
                    <th>Alamat</th>
                    <th>Barang</th>
                    <th>Muatan</th>
                    <th>Catatan</th>
                </tr>
            </thead>
            <tbody>
                ${(doData.actualDropPoints || []).length > 0
                    ? (doData.actualDropPoints || [])
                        .slice()
                        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
                        .map(point => `
                            <tr>
                                <td>${DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.label || point.stopType}</td>
                                <td>${point.sequence}. ${point.locationName || '-'}</td>
                                <td>${point.locationAddress || '-'}</td>
                                <td>${summarizeDeliveryOrderItemDescriptionsForDrop(point, doItems)}</td>
                                <td>${formatCargoSummary({
                                    qtyKoli: point.qtyKoli,
                                    weightKg: point.weightKg,
                                    weightInputValue: point.weightInputValue,
                                    weightInputUnit: point.weightInputUnit,
                                    volumeM3: point.volumeM3,
                                    volumeInputValue: point.volumeInputValue,
                                    volumeInputUnit: point.volumeInputUnit,
                                })}</td>
                                <td>${point.note || '-'}</td>
                            </tr>
                        `).join('')
                    : `
                        <tr>
                            <td>Drop</td>
                            <td>1. ${receiverSummary}</td>
                            <td>${receiverFullSummary}</td>
                            <td>${doItems.length > 0 ? Array.from(new Set(doItems.map(item => item.orderItemDescription).filter(Boolean))).join(', ') : '-'}</td>
                            <td>-</td>
                            <td>Realisasi drop belum dicatat terpisah.</td>
                        </tr>
                    `}
            </tbody>
        </table>
        <div class="section-title">Detail Barang</div>
        <table>
            <thead>
                <tr>
                    <th>No</th>
                    <th>Deskripsi</th>
                    <th class="r">Koli</th>
                    <th>Muatan</th>
                </tr>
            </thead>
            <tbody>
                ${doItems.map((item, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${item.orderItemDescription || '-'}</td>
                        <td class="r">${item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0}</td>
                        <td>${formatCargoSummary(
                            item.actualQtyKoli !== undefined || item.actualWeightKg !== undefined || item.actualVolumeM3 !== undefined
                                ? {
                                    qtyKoli: item.actualQtyKoli,
                                    weightKg: item.actualWeightKg,
                                    weightInputValue: item.actualWeightInputValue,
                                    weightInputUnit: item.actualWeightInputUnit,
                                    volumeM3: item.actualVolumeM3,
                                    volumeInputValue: item.actualVolumeInputValue,
                                    volumeInputUnit: item.actualVolumeInputUnit,
                                }
                                : {
                                    qtyKoli: item.orderItemQtyKoli,
                                    weightKg: item.orderItemWeight,
                                    weightInputValue: item.orderItemWeightInputValue,
                                    weightInputUnit: item.orderItemWeightInputUnit,
                                    volumeM3: item.orderItemVolumeM3,
                                    volumeInputValue: item.orderItemVolumeInputValue,
                                    volumeInputUnit: item.orderItemVolumeInputUnit,
                                }
                        )}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="section-title">Timeline Pengiriman</div>
        <table>
            <thead>
                <tr>
                    <th>Waktu</th>
                    <th>Status</th>
                    <th>Catatan</th>
                </tr>
            </thead>
            <tbody>
                ${trackingLogs.length > 0 ? trackingLogs.map((item) => `
                    <tr>
                        <td>${formatDateTime(item.timestamp)}</td>
                        <td>${DO_STATUS_MAP[item.status]?.label || item.status || '-'}</td>
                        <td>${item.note || '-'}</td>
                    </tr>
                `).join('') : '<tr><td colspan="3" class="c">Belum ada log tracking</td></tr>'}
            </tbody>
        </table>
    `;
}

export function buildResolvedDeliveryOrder(deliveryOrder: DeliveryOrder | null, sourceOrder: Order | null) {
    if (!deliveryOrder) {
        return null;
    }

    const parsedTaripBorongan = parseFormattedNumberish(deliveryOrder.taripBorongan, { maxFractionDigits: 0 });
    const parsedBaseTaripBorongan = parseFormattedNumberish(deliveryOrder.baseTaripBorongan, { maxFractionDigits: 0 });
    const parsedActualTotalWeightKg = parseFormattedNumberish(deliveryOrder.actualTotalWeightKg, { maxFractionDigits: 2 });
    const parsedServiceMaxPayloadKg = parseFormattedNumberish(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 });
    const parsedVehicleCapacityKg = parseFormattedNumberish(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 });
    const parsedOvertonaseWeightKg = parseFormattedNumberish(deliveryOrder.overtonaseWeightKg, { maxFractionDigits: 2 });
    const parsedOvertonaseDriverRatePerKg = parseFormattedNumberish(deliveryOrder.overtonaseDriverRatePerKg, { maxFractionDigits: 0 });
    const parsedOvertonaseDriverAmount = parseFormattedNumberish(deliveryOrder.overtonaseDriverAmount, { maxFractionDigits: 0 });
    const parsedVehicleCapacityExceededKg = parseFormattedNumberish(deliveryOrder.vehicleCapacityExceededKg, { maxFractionDigits: 2 });

    return {
        ...deliveryOrder,
        baseTaripBorongan: Number.isFinite(parsedBaseTaripBorongan) ? parsedBaseTaripBorongan : 0,
        taripBorongan: Number.isFinite(parsedTaripBorongan) ? parsedTaripBorongan : 0,
        actualTotalWeightKg: Number.isFinite(parsedActualTotalWeightKg) ? parsedActualTotalWeightKg : undefined,
        serviceMaxPayloadKg: Number.isFinite(parsedServiceMaxPayloadKg) ? parsedServiceMaxPayloadKg : undefined,
        vehicleCapacityKg: Number.isFinite(parsedVehicleCapacityKg) ? parsedVehicleCapacityKg : undefined,
        overtonaseWeightKg: Number.isFinite(parsedOvertonaseWeightKg) ? parsedOvertonaseWeightKg : undefined,
        overtonaseDriverRatePerKg: Number.isFinite(parsedOvertonaseDriverRatePerKg) ? parsedOvertonaseDriverRatePerKg : undefined,
        overtonaseDriverAmount: Number.isFinite(parsedOvertonaseDriverAmount) ? parsedOvertonaseDriverAmount : undefined,
        vehicleCapacityExceededKg: Number.isFinite(parsedVehicleCapacityExceededKg) ? parsedVehicleCapacityExceededKg : undefined,
        customerName: deliveryOrder.customerName || sourceOrder?.customerName,
        receiverName: deliveryOrder.receiverName || sourceOrder?.receiverName,
        receiverPhone: deliveryOrder.receiverPhone || sourceOrder?.receiverPhone,
        receiverAddress: deliveryOrder.receiverAddress || sourceOrder?.receiverAddress,
        receiverCompany: deliveryOrder.receiverCompany || sourceOrder?.receiverCompany,
        pickupAddress: deliveryOrder.pickupAddress || sourceOrder?.pickupAddress,
        serviceRef: deliveryOrder.serviceRef || sourceOrder?.serviceRef,
        serviceName: deliveryOrder.serviceName || sourceOrder?.serviceName,
    };
}

export function sortTrackingLogs<T extends { timestamp: string }>(logs: T[]) {
    return [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function createEmptyActualDropDraft(): ActualDropDraft {
    return {
        draftKey: crypto.randomUUID(),
        stopType: 'DROP',
        deliveryOrderItemRef: '',
        shipperReferenceKey: '',
        shipperReferenceNumber: '',
        billingCustomerRef: '',
        billingCustomerName: '',
        originLocationName: '',
        originLocationAddress: '',
        locationName: '',
        locationAddress: '',
        qtyKoli: '',
        weightInputValue: '',
        weightInputUnit: 'KG',
        volumeInputValue: '',
        volumeInputUnit: 'M3',
        note: '',
    };
}

export function buildDeliveryOrderStatusUpdateData(params: {
    id?: string;
    status: string;
    note: string;
    actualCargoItems: ActualCargoDraft[];
    actualDropPoints: ActualDropDraft[];
    effectiveActualDropPoints: ActualDropDraft[];
    podName: string;
    podDate: string;
    podNote: string;
}) {
    const completingDelivery = params.status === 'DELIVERED';

    return {
        id: params.id,
        status: params.status,
        note: params.note,
        ...(completingDelivery
            ? {
                podReceiverName: params.podName,
                podReceivedDate: params.podDate,
                podNote: params.podNote,
                actualItems: params.actualCargoItems.map(item => ({
                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                    actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli),
                    actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue, {
                        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                    }),
                    actualWeightInputUnit: item.actualWeightInputUnit,
                    actualVolumeInputValue: item.actualVolumeInputValue.trim()
                        ? parseFormattedNumberish(item.actualVolumeInputValue, {
                            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                        })
                        : 0,
                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                })),
                actualDropPoints: params.effectiveActualDropPoints.map(item => ({
                    stopType: item.stopType,
                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                    shipperReferenceKey: item.shipperReferenceKey,
                    shipperReferenceNumber: item.shipperReferenceNumber,
                    billingCustomerRef: item.billingCustomerRef,
                    billingCustomerName: item.billingCustomerName,
                    originLocationName: item.originLocationName,
                    originLocationAddress: item.originLocationAddress,
                    locationName: item.locationName,
                    locationAddress: item.locationAddress,
                    qtyKoli: item.qtyKoli.trim() ? parseFormattedNumberish(item.qtyKoli) : 0,
                    weightInputValue: item.weightInputValue.trim()
                        ? parseFormattedNumberish(item.weightInputValue, {
                            maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                        })
                        : 0,
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: item.volumeInputValue.trim()
                        ? parseFormattedNumberish(item.volumeInputValue, {
                            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                        })
                        : 0,
                    volumeInputUnit: item.volumeInputUnit,
                    note: item.note,
                })),
            }
            : {}),
    };
}

export function buildDeliveryOrderPodUpdateData(params: {
    id?: string;
    podName: string;
    podDate: string;
    podNote: string;
}) {
    return {
        id: params.id,
        updates: {
            podReceiverName: params.podName,
            podReceivedDate: params.podDate,
            podNote: params.podNote,
        },
    };
}

export function buildDeliveryOrderTripFeeUpdateData(params: {
    id?: string;
    tripRouteRateRef?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    taripBorongan: number;
    keteranganBorongan: string;
}) {
    return {
        id: params.id,
        updates: {
            tripRouteRateRef: params.tripRouteRateRef?.trim() || '',
            tripOriginArea: params.tripOriginArea?.trim() || '',
            tripDestinationArea: params.tripDestinationArea?.trim() || '',
            taripBorongan: params.taripBorongan,
            keteranganBorongan: params.keteranganBorongan,
        },
    };
}
