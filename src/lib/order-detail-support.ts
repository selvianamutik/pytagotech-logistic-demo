import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    formatCargoSummary,
    getWeightInputFractionDigits,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { calculateWeightPortion, getOrderItemProgress, roundQuantity } from '@/lib/order-item-progress';
import { buildTripResourceAssignments } from '@/lib/trip-resource-lock-support';
import type { DeliveryOrder, DeliveryOrderItem, Driver, Order, OrderItem, Vehicle } from '@/lib/types';

export type SelectedShipmentMap = Record<string, {
    qtyKoli: string;
    weightInputValue: string;
    weightInputUnit: WeightInputUnit;
    volumeInputValue: string;
    volumeInputUnit: VolumeInputUnit;
    holdRemaining: boolean;
    holdReason: string;
    holdLocation: string;
}>;

export type CargoAggregate = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

export type OrderItemProgressInfo = ReturnType<typeof getOrderItemProgress>;

export type SelectedShipmentRow = {
    itemId: string;
    description?: string;
    holdRemaining: boolean;
    cargo: CargoAggregate;
};

export type CreateDeliveryOrderItemInput = {
    orderItemRef: string;
    qtyKoli: number;
    weightInputValue: number;
    weightInputUnit: WeightInputUnit;
    volumeInputValue: number;
    volumeInputUnit: VolumeInputUnit;
    holdRemaining: boolean;
    holdReason: string;
    holdLocation: string;
};

export type VehicleSummary = Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName' | 'capacityMin' | 'capacityMax' | 'capacityKg'>;

export type HoldFormState = {
    holdQtyKoli: string;
    holdWeightInputValue: string;
    holdWeightInputUnit: WeightInputUnit;
    holdVolumeInputValue: string;
    holdVolumeInputUnit: VolumeInputUnit;
    holdReason: string;
    holdLocation: string;
};

export type OrderDetailMetrics = {
    activeAssignmentByItemId: Record<string, DeliveryOrder | undefined>;
    doItemByOrderItemId: Record<string, DeliveryOrderItem | undefined>;
    itemProgressById: Record<string, OrderItemProgressInfo>;
    deliveredActualCargoByItemId: Record<string, CargoAggregate>;
    activePlannedCargoByItemId: Record<string, CargoAggregate>;
    availableItems: OrderItem[];
    totalOrderCargo: CargoAggregate;
    totalHeldCargo: CargoAggregate;
    totalPendingCargo: CargoAggregate;
    totalDeliveredActualCargo: CargoAggregate;
    totalActivePlannedCargo: CargoAggregate;
    doPlannedCargoById: Record<string, CargoAggregate>;
    doActualCargoById: Record<string, CargoAggregate>;
    progress: number;
    deliveredDoCount: number;
};

export function createCargoAggregate(): CargoAggregate {
    return {
        qtyKoli: 0,
        weightKg: 0,
        volumeM3: 0,
    };
}

export function addCargoAggregate(base: CargoAggregate, next: Partial<CargoAggregate>) {
    return {
        qtyKoli: roundQuantity(base.qtyKoli + parseFormattedNumberish(next.qtyKoli || 0)),
        weightKg: roundQuantity(base.weightKg + parseFormattedNumberish(next.weightKg || 0)),
        volumeM3: roundQuantity(base.volumeM3 + parseFormattedNumberish(next.volumeM3 || 0, { maxFractionDigits: 3 }), 3),
    };
}

export function getPlannedDoItemCargo(doItem: DeliveryOrderItem): CargoAggregate {
    return {
        qtyKoli: parseFormattedNumberish(doItem.orderItemQtyKoli || 0),
        weightKg: parseFormattedNumberish(doItem.orderItemWeight || 0),
        volumeM3: parseFormattedNumberish(doItem.orderItemVolumeM3 || 0, { maxFractionDigits: 3 }),
    };
}

export function getActualDoItemCargo(doItem: DeliveryOrderItem): CargoAggregate {
    return {
        qtyKoli: parseFormattedNumberish(doItem.actualQtyKoli ?? doItem.orderItemQtyKoli ?? 0),
        weightKg: parseFormattedNumberish(doItem.actualWeightKg ?? doItem.orderItemWeight ?? 0),
        volumeM3: parseFormattedNumberish(doItem.actualVolumeM3 ?? doItem.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }),
    };
}

export function hasCargoAggregate(cargo: CargoAggregate) {
    return cargo.qtyKoli > 0 || cargo.weightKg > 0 || cargo.volumeM3 > 0;
}

export function buildSelectedNonKoliCargo(selection?: SelectedShipmentMap[string]): CargoAggregate {
    if (!selection) {
        return createCargoAggregate();
    }

    return {
        qtyKoli: 0,
        weightKg:
            selection.weightInputValue.trim() && selection.weightInputUnit
                ? roundQuantity(convertWeightToKg(parseFormattedNumberish(selection.weightInputValue, {
                    maxFractionDigits: getWeightInputFractionDigits(selection.weightInputUnit),
                }), selection.weightInputUnit))
                : 0,
        volumeM3:
            selection.volumeInputValue.trim() && selection.volumeInputUnit
                ? roundQuantity(convertVolumeToM3(parseFormattedNumberish(selection.volumeInputValue, {
                    maxFractionDigits: selection.volumeInputUnit === 'LITER' ? 0 : 3,
                }), selection.volumeInputUnit), 3)
                : 0,
    };
}

export function getCargoBasisValue(cargo: CargoAggregate) {
    if (cargo.qtyKoli > 0) {
        return cargo.qtyKoli;
    }
    if (cargo.weightKg > 0) {
        return cargo.weightKg;
    }
    return cargo.volumeM3;
}

export function formatProgressLine(label: string, cargo: CargoAggregate) {
    if (!hasCargoAggregate(cargo)) {
        return null;
    }
    return `${label}: ${formatCargoSummary({
        qtyKoli: cargo.qtyKoli > 0 ? cargo.qtyKoli : undefined,
        weightKg: cargo.weightKg > 0 ? cargo.weightKg : undefined,
        volumeM3: cargo.volumeM3 > 0 ? cargo.volumeM3 : undefined,
    })}`;
}

export function buildDefaultShipmentSelection(item: OrderItem, progressInfo: OrderItemProgressInfo): SelectedShipmentMap[string] {
    return {
        qtyKoli: progressInfo.totalQtyKoli > 0 ? String(progressInfo.pendingQtyKoli) : '0',
        weightInputValue:
            progressInfo.totalQtyKoli === 0 && progressInfo.pendingWeight > 0
                ? String(convertKgToWeightInputValue(progressInfo.pendingWeight, item.weightInputUnit || 'KG'))
                : '',
        weightInputUnit: item.weightInputUnit || 'KG',
        volumeInputValue:
            progressInfo.totalQtyKoli === 0 && progressInfo.pendingVolume > 0
                ? String(convertM3ToVolumeInputValue(progressInfo.pendingVolume, item.volumeInputUnit || 'M3'))
                : '',
        volumeInputUnit: item.volumeInputUnit || 'M3',
        holdRemaining: false,
        holdReason: '',
        holdLocation: '',
    };
}

export function buildOrderDetailMetrics(
    items: OrderItem[],
    dos: DeliveryOrder[],
    doItems: DeliveryOrderItem[]
): OrderDetailMetrics {
    const activeAssignmentByItemId = doItems.reduce<Record<string, DeliveryOrder | undefined>>((acc, doi) => {
        const activeDeliveryOrder = dos.find(
            d =>
                d._id === doi.deliveryOrderRef &&
                ['CREATED', 'ON_DELIVERY', 'ARRIVED'].includes(d.status)
        );
        if (activeDeliveryOrder && doi.orderItemRef) {
            acc[doi.orderItemRef] = activeDeliveryOrder;
        }
        return acc;
    }, {});
    const doItemByOrderItemId = doItems.reduce<Record<string, DeliveryOrderItem | undefined>>((acc, doi) => {
        if (doi.orderItemRef && activeAssignmentByItemId[doi.orderItemRef]) {
            acc[doi.orderItemRef] = doi;
        }
        return acc;
    }, {});
    const itemProgressById = items.reduce<Record<string, OrderItemProgressInfo>>((acc, item) => {
        acc[item._id] = getOrderItemProgress(item);
        return acc;
    }, {});
    const deliveredActualCargoByItemId = items.reduce<Record<string, CargoAggregate>>((acc, item) => {
        const progress = itemProgressById[item._id];
        acc[item._id] = {
            qtyKoli: roundQuantity(progress.deliveredQtyKoli),
            weightKg: roundQuantity(progress.deliveredWeight),
            volumeM3: roundQuantity(progress.deliveredVolume, 3),
        };
        return acc;
    }, {});
    const activePlannedCargoByItemId = doItems.reduce<Record<string, CargoAggregate>>((acc, doItem) => {
        const deliveryOrder = dos.find(item => item._id === doItem.deliveryOrderRef);
        if (
            !deliveryOrder ||
            !['CREATED', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status) ||
            !doItem.orderItemRef
        ) {
            return acc;
        }
        const progress = itemProgressById[doItem.orderItemRef];
        if (!progress) {
            return acc;
        }
        const current = acc[doItem.orderItemRef] || createCargoAggregate();
        const activeCargo = {
            qtyKoli: progress.assignedQtyKoli,
            weightKg: progress.assignedWeight,
            volumeM3: progress.assignedVolume,
        };
        acc[doItem.orderItemRef] = hasCargoAggregate(current)
            ? current
            : activeCargo;
        return acc;
    }, {});
    const availableItems = items.filter(item => {
        const progress = itemProgressById[item._id];
        return (
            (progress.pendingQtyKoli > 0 || progress.pendingWeight > 0 || progress.pendingVolume > 0) &&
            !activeAssignmentByItemId[item._id]
        );
    });
    const totalOrderCargo = items.reduce(
        (sum, item) =>
            addCargoAggregate(sum, {
                qtyKoli: item.qtyKoli,
                weightKg: item.weight,
                volumeM3: item.volume,
            }),
        createCargoAggregate()
    );
    const totalHeldCargo = items.reduce((sum, item) => {
        const progress = itemProgressById[item._id];
        return addCargoAggregate(sum, {
            qtyKoli: progress.heldQtyKoli,
            weightKg: progress.heldWeight,
            volumeM3: progress.heldVolume,
        });
    }, createCargoAggregate());
    const totalPendingCargo = items.reduce((sum, item) => {
        const progress = itemProgressById[item._id];
        return addCargoAggregate(sum, {
            qtyKoli: progress.pendingQtyKoli,
            weightKg: progress.pendingWeight,
            volumeM3: progress.pendingVolume,
        });
    }, createCargoAggregate());
    const totalDeliveredActualCargo = Object.values(deliveredActualCargoByItemId).reduce(
        (sum, cargo) => addCargoAggregate(sum, cargo),
        createCargoAggregate()
    );
    const totalActivePlannedCargo = Object.values(activePlannedCargoByItemId).reduce(
        (sum, cargo) => addCargoAggregate(sum, cargo),
        createCargoAggregate()
    );
    const doPlannedCargoById = doItems.reduce<Record<string, CargoAggregate>>((acc, doItem) => {
        const current = acc[doItem.deliveryOrderRef] || createCargoAggregate();
        acc[doItem.deliveryOrderRef] = addCargoAggregate(current, getPlannedDoItemCargo(doItem));
        return acc;
    }, {});
    const doActualCargoById = doItems.reduce<Record<string, CargoAggregate>>((acc, doItem) => {
        const current = acc[doItem.deliveryOrderRef] || createCargoAggregate();
        acc[doItem.deliveryOrderRef] = addCargoAggregate(current, getActualDoItemCargo(doItem));
        return acc;
    }, {});
    const totalProgressBasis = getCargoBasisValue(totalOrderCargo);
    const deliveredProgressBasis = getCargoBasisValue(totalDeliveredActualCargo);
    const progress =
        totalProgressBasis > 0
            ? Math.min(100, Math.round((deliveredProgressBasis / totalProgressBasis) * 100))
            : 0;
    const deliveredDoCount = dos.filter(d => d.status === 'DELIVERED').length;

    return {
        activeAssignmentByItemId,
        doItemByOrderItemId,
        itemProgressById,
        deliveredActualCargoByItemId,
        activePlannedCargoByItemId,
        availableItems,
        totalOrderCargo,
        totalHeldCargo,
        totalPendingCargo,
        totalDeliveredActualCargo,
        totalActivePlannedCargo,
        doPlannedCargoById,
        doActualCargoById,
        progress,
        deliveredDoCount,
    };
}

export function summarizeSelectedShipments(
    availableItems: OrderItem[],
    selectedShipments: SelectedShipmentMap,
    itemProgressById: Record<string, OrderItemProgressInfo>
) {
    const rows = availableItems.flatMap(item => {
        const selection = selectedShipments[item._id];
        if (!selection) {
            return [];
        }
        const progressInfo = itemProgressById[item._id];
        if (progressInfo.totalQtyKoli > 0) {
            const qtyKoli = parseFormattedNumberish(selection.qtyKoli || 0);
            const ratio = progressInfo.totalQtyKoli > 0 ? qtyKoli / progressInfo.totalQtyKoli : 0;
            return [{
                itemId: item._id,
                description: item.description,
                holdRemaining: selection.holdRemaining,
                cargo: {
                    qtyKoli,
                    weightKg: qtyKoli > 0 ? calculateWeightPortion(progressInfo.totalWeight, progressInfo.totalQtyKoli, qtyKoli) : 0,
                    volumeM3: qtyKoli > 0 && ratio > 0 ? roundQuantity(progressInfo.totalVolume * ratio, 3) : 0,
                },
            } satisfies SelectedShipmentRow];
        }
        return [{
            itemId: item._id,
            description: item.description,
            holdRemaining: selection.holdRemaining,
            cargo: buildSelectedNonKoliCargo(selection),
        } satisfies SelectedShipmentRow];
    });

    return {
        rows,
        totals: rows.reduce((sum, row) => addCargoAggregate(sum, row.cargo), createCargoAggregate()),
        itemCount: rows.length,
        holdCount: rows.filter(row => row.holdRemaining).length,
    };
}

export function buildCreateDeliveryOrderItems(
    availableItems: OrderItem[],
    selectedShipments: SelectedShipmentMap,
    itemProgressById: Record<string, OrderItemProgressInfo>
): CreateDeliveryOrderItemInput[] {
    return availableItems
        .filter(item => selectedShipments[item._id])
        .map(item => {
            const progress = itemProgressById[item._id];
            const selection = selectedShipments[item._id];
            const qtyKoli = parseFormattedNumberish(selection.qtyKoli || 0);
            const selectedNonKoliCargo = buildSelectedNonKoliCargo(selection);
            return {
                orderItemRef: item._id,
                qtyKoli,
                weightInputValue: selection.weightInputValue.trim()
                    ? parseFormattedNumberish(selection.weightInputValue, {
                        maxFractionDigits: getWeightInputFractionDigits(selection.weightInputUnit),
                    })
                    : 0,
                weightInputUnit: selection.weightInputUnit,
                volumeInputValue: selection.volumeInputValue.trim()
                    ? parseFormattedNumberish(selection.volumeInputValue, {
                        maxFractionDigits: selection.volumeInputUnit === 'LITER' ? 0 : 3,
                    })
                    : 0,
                volumeInputUnit: selection.volumeInputUnit,
                holdRemaining:
                    selection.holdRemaining &&
                    (progress.totalQtyKoli > 0
                        ? qtyKoli < progress.pendingQtyKoli
                        : selectedNonKoliCargo.weightKg < progress.pendingWeight ||
                          selectedNonKoliCargo.volumeM3 < progress.pendingVolume),
                holdReason: selection.holdReason.trim(),
                holdLocation: selection.holdLocation.trim(),
            };
        })
        .filter(item =>
            itemProgressById[item.orderItemRef].totalQtyKoli > 0
                ? Number.isFinite(item.qtyKoli) && item.qtyKoli > 0
                : item.weightInputValue > 0 || item.volumeInputValue > 0
        );
}

export function buildOrderResourceAssignmentIndex(params: {
    deliveryOrders?: DeliveryOrder[];
    orders?: Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>;
}) {
    return buildTripResourceAssignments({
        deliveryOrders: params.deliveryOrders || [],
        orders: params.orders || [],
    });
}

export function sortOrderDetailVehicles(vehicles: VehicleSummary[], order: Order | null) {
    return vehicles
        .slice()
        .sort((left, right) => {
            const leftMatches = order?.serviceRef && left.serviceRef === order.serviceRef ? 1 : 0;
            const rightMatches = order?.serviceRef && right.serviceRef === order.serviceRef ? 1 : 0;
            if (leftMatches !== rightMatches) {
                return rightMatches - leftMatches;
            }
            const leftLabel = `${left.unitCode || ''} ${left.plateNumber || ''}`.trim();
            const rightLabel = `${right.unitCode || ''} ${right.plateNumber || ''}`.trim();
            return leftLabel.localeCompare(rightLabel, 'id');
        });
}

export function getAvailableVehicles(vehicles: VehicleSummary[]) {
    return vehicles.slice();
}

export function getAvailableDrivers(drivers: Driver[]) {
    return drivers.slice();
}

export function shouldRequireVehicleOverrideReason(order: Order | null, selectedVehicle?: VehicleSummary) {
    if (!order?.serviceRef || !selectedVehicle) {
        return false;
    }
    return selectedVehicle.serviceRef !== order.serviceRef || !selectedVehicle.serviceRef;
}

export function buildHoldFormState(item: OrderItem, progressInfo: OrderItemProgressInfo): HoldFormState {
    const defaultWeightUnit = item.weightInputUnit || 'KG';
    const defaultVolumeUnit = item.volumeInputUnit || 'M3';

    return {
        holdQtyKoli: String(progressInfo.pendingQtyKoli || ''),
        holdWeightInputValue:
            progressInfo.pendingWeight > 0
                ? String(convertKgToWeightInputValue(progressInfo.pendingWeight, defaultWeightUnit))
                : '',
        holdWeightInputUnit: defaultWeightUnit,
        holdVolumeInputValue:
            progressInfo.pendingVolume > 0
                ? String(convertM3ToVolumeInputValue(progressInfo.pendingVolume, defaultVolumeUnit))
                : '',
        holdVolumeInputUnit: defaultVolumeUnit,
        holdReason: '',
        holdLocation: '',
    };
}

export function buildCreateDeliveryOrderRequestData(params: {
    order: Order | null;
    items: CreateDeliveryOrderItemInput[];
    customerDoNumber?: string;
    pickupStopKeys?: string[];
    tripRouteRateRef?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    vehicleRef?: string;
    selectedVehicle?: VehicleSummary;
    driverRef?: string;
    selectedDriver?: Driver;
    date: string;
    notes: string;
    taripBorongan?: number;
    requiresVehicleOverrideReason: boolean;
    vehicleOverrideReason: string;
}) {
    return {
        orderRef: params.order?._id,
        items: params.items,
        masterResi: params.order?.masterResi,
        customerDoNumber: params.customerDoNumber?.trim() || undefined,
        pickupStopKeys: params.pickupStopKeys || [],
        tripRouteRateRef: params.tripRouteRateRef?.trim() || undefined,
        tripOriginArea: params.tripOriginArea?.trim() || undefined,
        tripDestinationArea: params.tripDestinationArea?.trim() || undefined,
        vehicleRef: params.vehicleRef || undefined,
        vehiclePlate: params.selectedVehicle?.plateNumber || '',
        vehicleCategoryOverrideReason: params.requiresVehicleOverrideReason ? params.vehicleOverrideReason.trim() : undefined,
        driverRef: params.driverRef || undefined,
        driverName: params.selectedDriver?.name || '',
        taripBorongan: params.taripBorongan && params.taripBorongan > 0 ? params.taripBorongan : undefined,
        date: params.date,
        notes: params.notes,
        customerName: params.order?.customerName,
    };
}
