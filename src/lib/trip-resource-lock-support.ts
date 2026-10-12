import type { DeliveryOrder, Order } from '@/lib/types';

export type DeliveryOrderResourceLock = Pick<
    DeliveryOrder,
    | '_id'
    | 'status'
    | 'vehicleRef'
    | 'vehiclePlate'
    | 'driverRef'
    | 'driverName'
> &
    Partial<Pick<
        DeliveryOrder,
        | 'doNumber'
        | 'pendingDriverStatus'
        | 'pendingDriverRequests'
        | 'tripClosedByAdminAt'
        | 'tripEndOdometerKm'
        | 'odometerConfirmedAt'
    >> &
    Partial<{
        sourceDeliveryOrderRef: string;
    }>;

type OrderResourceLock = Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>;

const LOCKING_DELIVERY_ORDER_STATUSES = new Set<DeliveryOrder['status']>([
    'CREATED',
    'ON_DELIVERY',
    'ARRIVED',
    'PARTIAL_HOLD',
    'DELIVERED',
]);

const LOCKING_ORDER_STATUSES = new Set<Order['status']>(['OPEN', 'PARTIAL']);

export function isDeliveryOrderResourceLocked(order: DeliveryOrderResourceLock) {
    if (!order || order.status === 'CANCELLED' || order.tripClosedByAdminAt) {
        return false;
    }

    if (LOCKING_DELIVERY_ORDER_STATUSES.has(order.status)) {
        return true;
    }

    const hasPendingDriverRequest =
        Boolean(order.pendingDriverStatus) ||
        (Array.isArray(order.pendingDriverRequests) && order.pendingDriverRequests.length > 0);
    const hasPendingOdometerApproval =
        typeof order.tripEndOdometerKm === 'number' &&
        order.tripEndOdometerKm > 0 &&
        !order.odometerConfirmedAt;

    return hasPendingDriverRequest || hasPendingOdometerApproval;
}

export type TripResourceAssignment = {
    source: 'deliveryOrder' | 'orderTripPlan';
    sourceRef: string;
    tripPlanKey?: string;
    label: string;
    status?: string;
    tripClosedByAdminAt?: string;
};

type DeliveryOrderAssignment = DeliveryOrderResourceLock & { tripNumber?: string };

function isOpenDeliveryOrder(order: DeliveryOrderAssignment) {
    if (!order || order.tripClosedByAdminAt) {
        return false;
    }
    // Badges only reflect work still in progress: delivered, cancelled,
    // and admin-closed trips are intentionally hidden. Unknown future
    // statuses stay visible so new in-progress work is never hidden.
    return order.status !== 'DELIVERED' && order.status !== 'CANCELLED';
}

function pushAssignment(
    index: Map<string, TripResourceAssignment[]>,
    ref: string | undefined,
    assignment: TripResourceAssignment
) {
    if (!ref) {
        return;
    }
    const existing = index.get(ref);
    if (existing) {
        existing.push(assignment);
        return;
    }
    index.set(ref, [assignment]);
}

export type TripResourceAssignmentIndex = {
    byVehicleRef: Map<string, TripResourceAssignment[]>;
    byDriverRef: Map<string, TripResourceAssignment[]>;
};

export function buildTripResourceAssignments(params: {
    deliveryOrders?: DeliveryOrderAssignment[];
    orders?: OrderResourceLock[];
}): TripResourceAssignmentIndex {
    const byVehicleRef = new Map<string, TripResourceAssignment[]>();
    const byDriverRef = new Map<string, TripResourceAssignment[]>();

    for (const order of params.deliveryOrders || []) {
        if (!isOpenDeliveryOrder(order)) {
            continue;
        }
        const assignment: TripResourceAssignment = {
            source: 'deliveryOrder',
            sourceRef: order._id,
            label: order.doNumber || order.tripNumber || order._id,
            status: order.status,
            tripClosedByAdminAt: order.tripClosedByAdminAt,
        };
        pushAssignment(byVehicleRef, order.vehicleRef, assignment);
        pushAssignment(byDriverRef, order.driverRef, assignment);
    }

    for (const order of params.orders || []) {
        if (!order || !LOCKING_ORDER_STATUSES.has(order.status)) {
            continue;
        }
        for (const [index, plan] of (order.tripPlans || []).entries()) {
            if (plan.linkedDeliveryOrderRef) {
                continue;
            }
            const assignment: TripResourceAssignment = {
                source: 'orderTripPlan',
                sourceRef: order._id,
                tripPlanKey: plan._key || `order-trip-${index + 1}`,
                label: `${order.masterResi || order._id} / Trip ${plan.sequence || index + 1}`,
            };
            pushAssignment(byVehicleRef, plan.vehicleRef, assignment);
            pushAssignment(byDriverRef, plan.driverRef, assignment);
        }
    }

    return { byVehicleRef, byDriverRef };
}

export function tripVehicleAssignments(
    vehicleRef: string | undefined,
    index: TripResourceAssignmentIndex | undefined
): TripResourceAssignment[] {
    if (!vehicleRef || !index) {
        return [];
    }
    return index.byVehicleRef.get(vehicleRef) || [];
}

export function tripDriverAssignments(
    driverRef: string | undefined,
    index: TripResourceAssignmentIndex | undefined
): TripResourceAssignment[] {
    if (!driverRef || !index) {
        return [];
    }
    return index.byDriverRef.get(driverRef) || [];
}
