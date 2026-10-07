import { getDriverSession, getSession, getSessionFromToken } from '@/lib/auth';
import { getBusinessDateValue } from '@/lib/business-date';
import { getDriverScoreStatusMeta } from '@/lib/driver-scoring-support';
import { getCurrentDriverScore } from '@/lib/api/driver-score-workflows';
import { getCompanyProfile, getDocumentById, listDocumentsByFilter } from '@/lib/repositories/document-store';
import { clearRelationalReadCache } from '@/lib/supabase-relational';
import { resolveOrderCargoEntryMode } from '@/lib/order-cargo-entry-mode';
import { isDeliveryOrderResourceLocked } from '@/lib/trip-resource-lock-support';
import { mapDeliveryOrderToSuratJalanRecords } from '@/lib/trip-document-mappers';
import type { SuratJalanRecord } from '@/lib/trip-document-types';
import type {
    CompanyProfile,
    Customer,
    CustomerRecipient,
    CustomerProduct,
    DeliveryOrder,
    DeliveryOrderItem,
    DriverVoucher,
    DriverVoucherDisbursement,
    DriverVoucherItem,
    Driver,
    DriverScore,
    OrderPickupStop,
    OrderTripPlan,
    SessionUser,
    TrackingLog,
    User,
    Vehicle,
} from '@/lib/types';
import { normalizeUserRole, type InternalUserRole } from '@/lib/rbac';
import {
    buildDriverVoucherDetailSummary,
    isActiveDriverVoucherDisbursement,
    sortDriverVoucherDisbursementsChronologically,
    sortDriverVoucherItems,
} from '@/lib/driver-voucher-detail-support';

export type DriverSessionContext = {
    session: SessionUser;
    user: User;
    driver: Driver;
};

export type DriverAssignedDeliveryOrderCargoItem = DeliveryOrderItem;

export type DriverAssignedDeliveryOrder = DeliveryOrder & {
    _createdAt?: string;
    driverCargoItems?: DriverAssignedDeliveryOrderCargoItem[];
    driverSuratJalanRecords?: SuratJalanRecord[];
    allowsDirectCargoInput?: boolean;
    vehicleLastOdometer?: number;
    vehicleLastOdometerAt?: string;
    driverRejectedRequestStatus?: string;
    driverRejectedRequestNote?: string;
    driverRejectedRequestAt?: string;
};

export type DriverAssignedTripPlanPickupStop = {
    _key: string;
    sequence: number;
    pickupLabel?: string;
    pickupAddress: string;
    notes?: string;
};

export type DriverAssignedTripPlan = {
    orderRef: string;
    masterResi?: string;
    customerRef?: string;
    /** Every customer the order serves; the primary `customerRef` is first. */
    customerRefs?: string[];
    customerName?: string;
    serviceName?: string;
    pickupAddress?: string;
    tripPlanKey: string;
    tripSequence: number;
    pickupStops: DriverAssignedTripPlanPickupStop[];
    vehicleRef?: string;
    vehiclePlate?: string;
    driverRef?: string;
    driverName?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    taripBorongan?: number;
    cashGiven?: number;
    issueBankName?: string;
    date?: string;
    notes?: string;
    linkedDeliveryOrderRef?: string;
    linkedDeliveryOrderNumber?: string;
    linkedDeliveryOrderStatus?: DeliveryOrder['status'] | 'UNKNOWN';
    allowsDirectCargoInput?: boolean;
};

export type DriverPortalVoucher = DriverVoucher & {
    disbursements: DriverVoucherDisbursement[];
    items: DriverVoucherItem[];
    initialCashGiven: number;
    topUpAmount: number;
    totalIssuedAmount: number;
    operationalSpent: number;
    operationalBalance: number;
    driverFeeAmount: number;
    totalClaimAmount: number;
    netSettlementAmount: number;
};

export type DriverPortalAccessNotice = {
    scoreId: string;
    scoreType: DriverScore['scoreType'];
    title: string;
    message: string;
    blocking: boolean;
    effectiveDate: string;
    dueDate: string;
    durationDays: number;
    notes?: string;
    warningAcknowledgedAt?: string;
};

export async function requireInternalSession(allowedRoles?: InternalUserRole[]) {
    const session = await getSession();
    if (!session) {
        return { error: 'Unauthorized', status: 401 } as const;
    }
    const normalizedRole = normalizeUserRole(session.role);
    if (normalizedRole === 'DRIVER') {
        return { error: 'Forbidden', status: 403 } as const;
    }
    if (allowedRoles && !allowedRoles.includes(normalizedRole)) {
        return { error: 'Forbidden', status: 403 } as const;
    }
    return { session } as const;
}

function getBearerToken(request?: Request) {
    if (!request) return null;
    const authorization = request.headers.get('authorization') || '';
    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return null;
    }
    return token.trim() || null;
}

export function hasBearerDriverAuth(request?: Request) {
    return Boolean(getBearerToken(request));
}

export async function requireDriverSessionContext(request?: Request): Promise<DriverSessionContext | { error: string; status: number }> {
    const bearerToken = getBearerToken(request);
    const session = bearerToken ? await getSessionFromToken(bearerToken) : await getDriverSession();
    if (!session) {
        return { error: 'Unauthorized', status: 401 };
    }
    if (session.role !== 'DRIVER' || !session.driverRef) {
        return { error: 'Forbidden', status: 403 };
    }

    const user = await getDocumentById<User>(session._id, 'user');
    if (!user || user.role !== 'DRIVER' || !user.driverRef || user.active === false) {
        return { error: 'Akun driver tidak aktif', status: 403 };
    }

    const driver = await getDocumentById<Driver>(user.driverRef, 'driver');
    if (!driver || driver.active === false) {
        return { error: 'Data supir tidak aktif atau tidak ditemukan', status: 403 };
    }

    return { session, user, driver };
}

export async function getDriverAppContext() {
    const company = await getCompanyProfile<CompanyProfile>();
    return {
        company: company
            ? {
                _id: company._id,
                name: company.name,
                phone: company.phone,
                themeColor: company.themeColor,
            }
            : null,
    };
}

export async function getDriverPortalAccessNotice(driverRef: string): Promise<DriverPortalAccessNotice | null> {
    const score = await getCurrentDriverScore(driverRef, getBusinessDateValue());
    if (!score) {
        return null;
    }

    const statusMeta = getDriverScoreStatusMeta(score);
    const blocking = score.scoreType === 'DAYS';
    const title = blocking ? 'Akses aplikasi ditangguhkan' : 'Peringatan untuk akun driver';
    const baseMessage = blocking
        ? `Akun driver ini sedang diskors sampai ${score.dueDate || 'waktu yang belum ditentukan'}. Akses aplikasi ditutup sementara.`
        : `Akun driver ini mendapat warning aktif yang perlu dibaca.`;
    const noteText = score.notes ? ` Catatan admin: ${score.notes}` : '';

    return {
        scoreId: score._id,
        scoreType: score.scoreType,
        title,
        message: `${baseMessage}${noteText} (${statusMeta.label})`,
        blocking,
        effectiveDate: score.effectiveDate,
        dueDate: score.dueDate,
        durationDays: score.durationDays,
        notes: score.notes,
        warningAcknowledgedAt: score.warningAcknowledgedAt,
    };
}

export async function getDriverAssignedDeliveryOrders(driverRef: string) {
    clearRelationalReadCache();
    const deliveryOrders = (await listDocumentsByFilter<DriverAssignedDeliveryOrder>('deliveryOrder', { driverRef }))
        .filter(item => isDeliveryOrderResourceLocked(item));
    if (deliveryOrders.length === 0) {
        return [];
    }

    const orderRefs = [...new Set(deliveryOrders.map(item => item.orderRef).filter((value): value is string => typeof value === 'string' && value.length > 0))];
    const vehicleRefs = [...new Set(deliveryOrders.map(item => item.vehicleRef).filter((value): value is string => typeof value === 'string' && value.length > 0))];
    const [orders, cargoItems, suratJalanRecords, directCargoCapabilities, vehicles, rejectedRequestLogs] = await Promise.all([
        orderRefs.length > 0 ? listDocumentsByFilter<Array<Record<string, unknown> & { _id: string }>[number]>('order', { _id: orderRefs }) : Promise.resolve([]),
        listDocumentsByFilter<DeliveryOrderItem & { _createdAt?: string }>('deliveryOrderItem', {
            deliveryOrderRef: deliveryOrders.map(item => item._id),
        }),
        listDocumentsByFilter<SuratJalanRecord>('suratJalan', {
            tripRef: deliveryOrders.map(item => item._id),
        }),
        getDriverOrderCargoCapabilities(orderRefs),
        vehicleRefs.length > 0
            ? listDocumentsByFilter<Pick<Vehicle, '_id' | 'lastOdometer' | 'lastOdometerAt'>>('vehicle', { _id: vehicleRefs })
            : Promise.resolve([]),
        listDocumentsByFilter<Pick<TrackingLog, 'refRef' | 'status' | 'note' | 'timestamp'>>('trackingLog', {
            refType: 'DO',
            refRef: deliveryOrders.map(item => item._id),
            status: 'DRIVER_REQUEST_REJECTED',
        }),
    ]);

    const orderMap = new Map(orders.map(order => [order._id, order]));
    const vehicleMap = new Map(vehicles.map(vehicle => [vehicle._id, vehicle]));
    const cargoByDeliveryOrderRef = new Map<string, DeliveryOrderItem[]>();
    for (const item of cargoItems.sort((left, right) => (left._createdAt || '').localeCompare(right._createdAt || ''))) {
        const current = cargoByDeliveryOrderRef.get(item.deliveryOrderRef) || [];
        current.push(item);
        cargoByDeliveryOrderRef.set(item.deliveryOrderRef, current);
    }
    const suratJalanByTripRef = new Map<string, SuratJalanRecord[]>();
    for (const item of suratJalanRecords) {
        const current = suratJalanByTripRef.get(item.tripRef) || [];
        current.push(item);
        suratJalanByTripRef.set(item.tripRef, current);
    }
    const latestRejectedRequestLogByDeliveryOrderRef = new Map<string, Pick<TrackingLog, 'refRef' | 'status' | 'note' | 'timestamp'>>();
    for (const log of rejectedRequestLogs) {
        const deliveryOrderRef = typeof log.refRef === 'string' ? log.refRef : '';
        if (!deliveryOrderRef) continue;
        const current = latestRejectedRequestLogByDeliveryOrderRef.get(deliveryOrderRef);
        if (!current || String(log.timestamp || '').localeCompare(String(current.timestamp || '')) > 0) {
            latestRejectedRequestLogByDeliveryOrderRef.set(deliveryOrderRef, log);
        }
    }

    return deliveryOrders
        .sort((left, right) => {
            const dateCmp = (right.date || '').localeCompare(left.date || '');
            if (dateCmp !== 0) return dateCmp;
            return (right._createdAt || '').localeCompare(left._createdAt || '');
        })
        .map(item => {
            const relatedOrder = typeof item.orderRef === 'string' ? orderMap.get(item.orderRef) : undefined;
            const vehicle = typeof item.vehicleRef === 'string' ? vehicleMap.get(item.vehicleRef) : undefined;
            const rejectedRequestLog = latestRejectedRequestLogByDeliveryOrderRef.get(item._id);
            const [rejectedRequestStatus = '', ...rejectedRequestReasonParts] = String(rejectedRequestLog?.note || '').split(':');
            const rejectedRequestReason = rejectedRequestReasonParts.join(':').trim();
            return {
                ...item,
                customerName: item.customerName || (typeof relatedOrder?.customerName === 'string' ? relatedOrder.customerName : undefined),
                receiverName: item.receiverName,
                receiverAddress: item.receiverAddress,
                pickupAddress: item.pickupAddress || (typeof relatedOrder?.pickupAddress === 'string' ? relatedOrder.pickupAddress : undefined),
                driverCargoItems: cargoByDeliveryOrderRef.get(item._id) || [],
                driverSuratJalanRecords: mergeDriverSuratJalanRecordsWithLiveCargo(
                    suratJalanByTripRef.get(item._id) || [],
                    mapDeliveryOrderToSuratJalanRecords(item, cargoByDeliveryOrderRef.get(item._id) || [])
                ),
                allowsDirectCargoInput: typeof item.orderRef === 'string' ? (directCargoCapabilities.get(item.orderRef) ?? false) : false,
                vehicleLastOdometer: vehicle?.lastOdometer,
                vehicleLastOdometerAt: vehicle?.lastOdometerAt,
                driverRejectedRequestStatus: rejectedRequestLog ? rejectedRequestStatus.trim() : undefined,
                driverRejectedRequestNote: rejectedRequestLog ? rejectedRequestReason || rejectedRequestLog.note : undefined,
                driverRejectedRequestAt: rejectedRequestLog?.timestamp,
            };
        });
}

function hasDriverSuratJalanCargo(summary?: SuratJalanRecord['holdCargo']) {
    return Boolean(
        (summary?.qtyKoli || 0) > 0 ||
        (summary?.weightKg || 0) > 0 ||
        (summary?.volumeM3 || 0) > 0
    );
}

function getDriverSuratJalanRecordKey(record: Pick<SuratJalanRecord, '_id' | 'referenceKey' | 'suratJalanNumber'>) {
    return [
        record._id,
        record.referenceKey ? `key:${record.referenceKey}` : '',
        record.suratJalanNumber ? `number:${record.suratJalanNumber.trim().toUpperCase()}` : '',
    ].filter(Boolean);
}

function mergeDriverSuratJalanRecordWithLiveCargo(
    record: SuratJalanRecord,
    liveRecord?: SuratJalanRecord
): SuratJalanRecord {
    if (!liveRecord) {
        return record;
    }
    const shouldPreserveDraftStatus =
        record.tripStatus === 'CREATED' &&
        ['ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'PARTIAL_HOLD'].includes(liveRecord.tripStatus || '');
    const liveHasHoldCargo = hasDriverSuratJalanCargo(liveRecord.holdCargo);
    const resolvedTripStatus =
        shouldPreserveDraftStatus
            ? record.tripStatus
            : record.tripStatus === 'CREATED' && liveRecord.tripStatus && liveRecord.tripStatus !== 'CREATED'
                ? liveRecord.tripStatus
                : record.tripStatus || liveRecord.tripStatus;
    return {
        ...record,
        pickupAddress: liveHasHoldCargo
            ? liveRecord.pickupAddress || record.pickupAddress
            : record.pickupAddress || liveRecord.pickupAddress,
        tripStatus: resolvedTripStatus,
        itemCount: liveRecord.itemCount,
        cargoSummary: liveRecord.cargoSummary,
        billableCargo: liveRecord.billableCargo,
        holdCargo: liveRecord.holdCargo,
        returnCargo: liveRecord.returnCargo,
    };
}

function mergeDriverSuratJalanRecordsWithLiveCargo(
    records: SuratJalanRecord[],
    liveRecords: SuratJalanRecord[]
) {
    const liveByIdentity = new Map<string, SuratJalanRecord>();
    for (const liveRecord of liveRecords) {
        for (const key of getDriverSuratJalanRecordKey(liveRecord)) {
            liveByIdentity.set(key, liveRecord);
        }
    }

    const merged = records.map(record => {
        const liveRecord = getDriverSuratJalanRecordKey(record)
            .map(key => liveByIdentity.get(key))
            .find(Boolean);
        return mergeDriverSuratJalanRecordWithLiveCargo(record, liveRecord);
    });

    const existingKeys = new Set(merged.flatMap(getDriverSuratJalanRecordKey));
    for (const liveRecord of liveRecords) {
        if (getDriverSuratJalanRecordKey(liveRecord).some(key => existingKeys.has(key))) {
            continue;
        }
        merged.push(liveRecord);
    }
    return merged;
}

export async function getDriverOrderCargoCapabilities(orderRefs: string[]) {
    const normalizedOrderRefs = [...new Set(orderRefs.filter(Boolean))];
    if (normalizedOrderRefs.length === 0) {
        return new Map<string, boolean>();
    }

    const [orders, orderItemHints] = await Promise.all([
        listDocumentsByFilter<Array<{
            _id: string;
            _createdAt?: string;
            createdAt?: string;
            cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        }>[number]>('order', { _id: normalizedOrderRefs }),
        listDocumentsByFilter<Array<{
            orderRef?: string;
            _createdAt?: string;
            entrySource?: 'ORDER' | 'DELIVERY_ORDER';
            sourceDeliveryOrderRef?: string;
        }>[number]>('orderItem', { orderRef: normalizedOrderRefs }),
    ]);

    const orderMap = new Map(orders.map(order => [order._id, order]));
    const hintsByOrderRef = new Map<string, Array<{
        _createdAt?: string;
        entrySource?: 'ORDER' | 'DELIVERY_ORDER';
        sourceDeliveryOrderRef?: string;
    }>>();
    for (const item of orderItemHints) {
        const orderRef = typeof item.orderRef === 'string' ? item.orderRef : '';
        if (!orderRef) {
            continue;
        }
        const current = hintsByOrderRef.get(orderRef) || [];
        current.push({
            _createdAt: item._createdAt,
            entrySource: item.entrySource,
            sourceDeliveryOrderRef: item.sourceDeliveryOrderRef,
        });
        hintsByOrderRef.set(orderRef, current);
    }

    const capabilities = new Map<string, boolean>();
    normalizedOrderRefs.forEach(orderRef => {
        const order = orderMap.get(orderRef);
        const hints = hintsByOrderRef.get(orderRef) || [];
        const resolvedCargoEntryMode = resolveOrderCargoEntryMode(order, hints);
        capabilities.set(orderRef, resolvedCargoEntryMode === 'DELIVERY_ORDER' || hints.length === 0);
    });

    return capabilities;
}

function normalizeTripPlanPickupStops(
    pickupStops: OrderPickupStop[] | undefined,
    pickupAddress: string | undefined,
    pickupStopKeys: string[] | undefined
): DriverAssignedTripPlanPickupStop[] {
    const normalizedStops: DriverAssignedTripPlanPickupStop[] = [];
    for (const [index, stop] of (pickupStops || []).entries()) {
        const pickupAddressValue = stop.pickupAddress?.trim();
        if (!pickupAddressValue) {
            continue;
        }
        normalizedStops.push({
            _key: stop._key || `pickup-stop-${index + 1}`,
            sequence: stop.sequence || index + 1,
            pickupLabel: stop.pickupLabel,
            pickupAddress: pickupAddressValue,
            notes: stop.notes,
        });
    }
    normalizedStops.sort((left, right) => left.sequence - right.sequence);

    const resolvedStops = normalizedStops.length > 0
        ? normalizedStops
        : pickupAddress?.trim()
            ? [{
                _key: 'pickup-stop-1',
                sequence: 1,
                pickupLabel: '',
                pickupAddress: pickupAddress.trim(),
                notes: '',
            }]
            : [];

    const selectedPickupStopKeys = new Set((pickupStopKeys || []).filter(Boolean));
    if (selectedPickupStopKeys.size === 0) {
        return resolvedStops;
    }

    const filteredStops = resolvedStops.filter(stop => stop._key && selectedPickupStopKeys.has(stop._key));
    return filteredStops.length > 0 ? filteredStops : resolvedStops;
}

export async function getDriverAssignedTripPlans(driverRef: string) {
    const activeOrderStatuses = new Set(['OPEN', 'PARTIAL']);
    const allOrders = await listDocumentsByFilter<Array<{
        _id: string;
        status?: string;
        masterResi?: string;
        customerRef?: string;
        customerRefs?: string[];
        customerName?: string;
        serviceName?: string;
        pickupAddress?: string;
        pickupStops?: OrderPickupStop[];
        tripPlans?: OrderTripPlan[];
        createdAt?: string;
        _createdAt?: string;
    }>[number]>('order', {});
    const orders = allOrders
        .map(order => ({
            ...order,
            tripPlans: (order.tripPlans || []).filter(plan => plan.driverRef === driverRef),
        }))
        .filter(order => (order.tripPlans || []).length > 0)
        .sort((left, right) => (right.createdAt || right._createdAt || '').localeCompare(left.createdAt || left._createdAt || ''));

    const linkedDeliveryOrderRefs = [
        ...new Set(
            orders.flatMap(order =>
                (order.tripPlans || [])
                    .map(plan => plan.linkedDeliveryOrderRef)
                    .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
            )
        ),
    ];

    const linkedDeliveryOrders = linkedDeliveryOrderRefs.length > 0
        ? await listDocumentsByFilter<Array<Pick<DeliveryOrder, '_id' | 'status' | 'doNumber' | 'pendingDriverStatus' | 'pendingDriverRequests' | 'tripClosedByAdminAt' | 'tripEndOdometerKm' | 'odometerConfirmedAt'>>[number]>('deliveryOrder', { _id: linkedDeliveryOrderRefs })
        : [];
    const linkedDeliveryOrderMap = new Map(linkedDeliveryOrders.map(item => [item._id, item]));

    const plannedTrips: DriverAssignedTripPlan[] = [];
    for (const order of orders) {
        for (const [index, plan] of (order.tripPlans || []).entries()) {
            const tripPlanKey = plan._key || `order-trip-${index + 1}`;
            const linkedDeliveryOrder = plan.linkedDeliveryOrderRef
                ? linkedDeliveryOrderMap.get(plan.linkedDeliveryOrderRef) || null
                : null;
            if (plan.linkedDeliveryOrderRef) {
                if (!linkedDeliveryOrder || !isDeliveryOrderResourceLocked(linkedDeliveryOrder)) {
                    continue;
                }
            } else if (!activeOrderStatuses.has(String(order.status || ''))) {
                continue;
            }

            plannedTrips.push({
                orderRef: order._id,
                masterResi: order.masterResi,
                customerRef: order.customerRef,
                customerRefs: order.customerRefs,
                customerName: order.customerName,
                serviceName: order.serviceName,
                pickupAddress: order.pickupAddress,
                tripPlanKey,
                tripSequence: plan.sequence || index + 1,
                pickupStops: normalizeTripPlanPickupStops(order.pickupStops, order.pickupAddress, plan.pickupStopKeys),
                vehicleRef: plan.vehicleRef,
                vehiclePlate: plan.vehiclePlate,
                driverRef: plan.driverRef,
                driverName: plan.driverName,
                tripOriginArea: plan.tripOriginArea,
                tripDestinationArea: plan.tripDestinationArea,
                taripBorongan: plan.taripBorongan,
                cashGiven: plan.cashGiven,
                issueBankName: plan.issueBankName,
                date: plan.date,
                notes: plan.notes,
                linkedDeliveryOrderRef: plan.linkedDeliveryOrderRef,
                linkedDeliveryOrderNumber: linkedDeliveryOrder?.doNumber || plan.linkedDeliveryOrderNumber,
                linkedDeliveryOrderStatus: linkedDeliveryOrder?.status || (plan.linkedDeliveryOrderRef ? 'UNKNOWN' : undefined),
            });
        }
    }

    return plannedTrips;
}

export async function getDriverCustomerProducts(customerRefs: string[]) {
    const normalizedCustomerRefs = [...new Set(customerRefs.filter(Boolean))];
    if (normalizedCustomerRefs.length === 0) {
        return [] as CustomerProduct[];
    }

    return (await listDocumentsByFilter<CustomerProduct>('customerProduct', {
        customerRef: normalizedCustomerRefs,
    }))
        .filter(item => item.active !== false)
        .sort((left, right) => `${left.code || left.name || ''}`.localeCompare(`${right.code || right.name || ''}`));
}

export async function getDriverCustomerRecipients(customerRefs: string[]) {
    const normalizedCustomerRefs = [...new Set(customerRefs.filter(Boolean))];
    if (normalizedCustomerRefs.length === 0) {
        return [] as CustomerRecipient[];
    }

    return (await listDocumentsByFilter<CustomerRecipient>('customerRecipient', {
        customerRef: normalizedCustomerRefs,
    }))
        .filter(item => item.active !== false)
        .sort((left, right) => `${left.label || left.receiverCompany || left.receiverName || ''}`.localeCompare(`${right.label || right.receiverCompany || right.receiverName || ''}`));
}

export async function getDriverBillingCustomers() {
    return (await listDocumentsByFilter<Pick<Customer, '_id' | '_type' | 'name' | 'active'>>('customer', {}))
        .filter(item => item.active !== false)
        .sort((left, right) => (left.name || '').localeCompare(right.name || ''));
}

export async function getDriverAssignedVouchers(driverRef: string): Promise<DriverPortalVoucher[]> {
    const normalizedDriverRef = driverRef.trim();
    if (!normalizedDriverRef) {
        return [];
    }

    const vouchers = (await listDocumentsByFilter<DriverVoucher>('driverVoucher', {
        driverRef: normalizedDriverRef,
    })).sort((left, right) =>
        `${right.issuedDate || ''}-${right.bonNumber || ''}`.localeCompare(
            `${left.issuedDate || ''}-${left.bonNumber || ''}`
        )
    );

    if (vouchers.length === 0) {
        return [];
    }

    const voucherRefs = vouchers.map(item => item._id);
    const [rawDisbursements, rawItems] = await Promise.all([
        listDocumentsByFilter<DriverVoucherDisbursement>('driverVoucherDisbursement', { voucherRef: voucherRefs }),
        listDocumentsByFilter<DriverVoucherItem>('driverVoucherItem', { voucherRef: voucherRefs }),
    ]);

    const disbursementsByVoucher = new Map<string, DriverVoucherDisbursement[]>();
    for (const disbursement of rawDisbursements.filter(isActiveDriverVoucherDisbursement)) {
        const current = disbursementsByVoucher.get(disbursement.voucherRef) || [];
        current.push(disbursement);
        disbursementsByVoucher.set(disbursement.voucherRef, current);
    }

    const itemsByVoucher = new Map<string, DriverVoucherItem[]>();
    for (const item of rawItems) {
        const current = itemsByVoucher.get(item.voucherRef) || [];
        current.push(item);
        itemsByVoucher.set(item.voucherRef, current);
    }

    return vouchers.map(voucher => {
        const disbursements = sortDriverVoucherDisbursementsChronologically(disbursementsByVoucher.get(voucher._id) || []);
        const items = sortDriverVoucherItems(itemsByVoucher.get(voucher._id) || []);
        const summary = buildDriverVoucherDetailSummary(voucher, items);

        return {
            ...voucher,
            disbursements,
            items,
            initialCashGiven: summary.initialCashGiven,
            topUpAmount: summary.topUpAmount,
            totalIssuedAmount: summary.totalIssuedAmount,
            operationalSpent: summary.operationalSpent,
            operationalBalance: summary.operationalBalance,
            driverFeeAmount: summary.driverFeeAmount,
            totalClaimAmount: summary.totalClaimAmount,
            netSettlementAmount: summary.balance,
        };
    });
}

export function sanitizeDriverForMobile(driver: Driver) {
    return {
        _id: driver._id,
        name: driver.name,
        phone: driver.phone,
        active: driver.active,
    };
}

export function formatTrackingLocationText(latitude: number, longitude: number) {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function normalizeTrackingNumber(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function toSpeedKph(speedMetersPerSecond: number | null) {
    if (speedMetersPerSecond === null || speedMetersPerSecond < 0) return undefined;
    return Math.round(speedMetersPerSecond * 3.6 * 10) / 10;
}
