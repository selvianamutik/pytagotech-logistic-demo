import { getBusinessDateValue } from '@/lib/business-date';
import {
    getDocumentById,
} from '@/lib/repositories/document-store';
import type { OrderPickupStop, OrderTripPlan } from '@/lib/types';
import { normalizeTripOwnership } from '@/lib/types';

import {
    assertIsoDate,
    extractRefId,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';
import { resolveTripRouteRateSelection } from './generic-workflow-support';

export function normalizeOrderPickupStopsInput(rawStops: unknown[], fallbackAddress?: string): OrderPickupStop[] {
    const stops = rawStops
        .filter(isPlainObject)
        .map((stop, index) => ({
            _key: normalizeOptionalText(stop._key) || normalizeOptionalText(stop.id) || crypto.randomUUID(),
            sequence: index + 1,
            customerPickupRef: normalizeOptionalText(stop.customerPickupRef),
            pickupLabel: normalizeOptionalText(stop.pickupLabel),
            pickupAddress: normalizeText(stop.pickupAddress),
            notes: normalizeOptionalText(stop.notes),
        }))
        .filter(stop => stop.pickupAddress);

    if (stops.length > 0) {
        return stops;
    }

    const fallback = normalizeOptionalText(fallbackAddress);
    return fallback
        ? [{
            _key: crypto.randomUUID(),
            sequence: 1,
            pickupAddress: fallback,
        }]
        : [];
}

export function normalizeRequestedPickupStopKeys(data: Record<string, unknown>) {
    return Array.isArray(data.pickupStopKeys)
        ? data.pickupStopKeys.map(key => normalizeOptionalText(key)).filter((key): key is string => Boolean(key))
        : [];
}

export function getExtraPickupRefsFromPayload(
    data: Record<string, unknown>,
    requestedPickupStopKeys: string[]
) {
    return [
        ...new Set([
            ...requestedPickupStopKeys
                .filter(key => key.startsWith('customer-pickup:'))
                .map(key => key.replace('customer-pickup:', '')),
            ...(Array.isArray(data.extraPickupRefs)
                ? data.extraPickupRefs.map(ref => normalizeOptionalText(ref)).filter((ref): ref is string => Boolean(ref))
                : []),
        ]),
    ];
}

export function remapRequestedPickupStopKeys(
    requestedPickupStopKeys: string[],
    pickupStopKeyAlias: Map<string, string>
) {
    return requestedPickupStopKeys
        .map(key => remapRequestedPickupStopKey(key, pickupStopKeyAlias))
        .filter((key): key is string => Boolean(key && !key.startsWith('customer-pickup:')));
}

export function remapRequestedPickupStopKey(
    key: unknown,
    pickupStopKeyAlias: Map<string, string>
) {
    const normalizedKey = normalizeOptionalText(key);
    return normalizedKey ? pickupStopKeyAlias.get(normalizedKey) || normalizedKey : undefined;
}

export async function resolveOrderPickupStopExpansion(params: {
    currentOrderPickupStops: OrderPickupStop[];
    requestedPickupStopKeys: string[];
    extraPickupRefs: string[];
    orderCustomerRef: string | null | undefined;
}) {
    if (params.extraPickupRefs.length > 0) {
        return {
            error: {
                message: 'Titik pickup dari master data tidak bisa dipakai langsung. Tambahkan dulu sebagai titik pickup order.',
                status: 409,
            },
            effectiveOrderPickupStops: params.currentOrderPickupStops,
            pickupStopKeyAlias: new Map<string, string>(),
            addedPickupStopCount: 0,
        };
    }
    const extraPickupDocs: Array<{
        _id: string;
        customerRef?: unknown;
        label?: string;
        pickupAddress?: string;
        notes?: string;
        active?: boolean;
    }> = [];
    if (extraPickupDocs.length !== params.extraPickupRefs.length) {
        return {
            error: {
                message: 'Sebagian master pickup tambahan tidak ditemukan',
                status: 404,
            },
            effectiveOrderPickupStops: params.currentOrderPickupStops,
            pickupStopKeyAlias: new Map<string, string>(),
            addedPickupStopCount: 0,
        };
    }
    const invalidExtraPickup = extraPickupDocs.find(pickup =>
        extractRefId(pickup.customerRef) !== params.orderCustomerRef ||
        pickup.active === false ||
        !normalizeOptionalText(pickup.pickupAddress)
    );
    if (invalidExtraPickup) {
        return {
            error: {
                message: 'Master pickup tambahan tidak aktif atau tidak sesuai customer order',
                status: 409,
            },
            effectiveOrderPickupStops: params.currentOrderPickupStops,
            pickupStopKeyAlias: new Map<string, string>(),
            addedPickupStopCount: 0,
        };
    }

    const orderPickupByMasterRef = new Map(
        params.currentOrderPickupStops
            .map(stop => [normalizeOptionalText(stop.customerPickupRef), stop] as const)
            .filter(([customerPickupRef]) => Boolean(customerPickupRef))
    );
    const orderPickupByAddress = new Map(
        params.currentOrderPickupStops
            .map(stop => [normalizeText(stop.pickupAddress).toLowerCase(), stop] as const)
            .filter(([pickupAddress]) => Boolean(pickupAddress))
    );
    const pickupStopKeyAlias = new Map<string, string>();
    const extraOrderPickupStops: OrderPickupStop[] = [];
    for (const pickup of extraPickupDocs) {
        const pickupAddress = normalizeText(pickup.pickupAddress);
        const existingStop =
            orderPickupByMasterRef.get(pickup._id) ||
            orderPickupByAddress.get(pickupAddress.toLowerCase());
        if (existingStop?._key) {
            pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, existingStop._key);
            continue;
        }

        const newStop: OrderPickupStop = {
            _key: crypto.randomUUID(),
            sequence: params.currentOrderPickupStops.length + extraOrderPickupStops.length + 1,
            customerPickupRef: pickup._id,
            pickupLabel: normalizeOptionalText(pickup.label),
            pickupAddress,
            notes: normalizeOptionalText(pickup.notes),
        };
        extraOrderPickupStops.push(newStop);
        orderPickupByMasterRef.set(pickup._id, newStop);
        orderPickupByAddress.set(pickupAddress.toLowerCase(), newStop);
        pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, newStop._key || '');
    }

    return {
        error: null,
        effectiveOrderPickupStops: [...params.currentOrderPickupStops, ...extraOrderPickupStops]
            .map((stop, index) => ({
                ...stop,
                sequence: index + 1,
            })),
        pickupStopKeyAlias,
        addedPickupStopCount: extraOrderPickupStops.length,
    };
}

export async function normalizeOrderTripPlansInput(
    rawPlans: unknown[],
    pickupStops: OrderPickupStop[],
    serviceRef?: string
): Promise<OrderTripPlan[]> {
    const plans: OrderTripPlan[] = [];
    const validPickupStopKeys = new Set(pickupStops.map(stop => stop._key).filter((key): key is string => Boolean(key)));

    for (const [index, rawPlan] of rawPlans.filter(isPlainObject).entries()) {
        const tripOwnership = normalizeTripOwnership(rawPlan.tripOwnership);
        const isMitraTrip = tripOwnership === 'MITRA';
        const vehicleRef = isMitraTrip ? '' : normalizeText(rawPlan.vehicleRef);
        const driverRef = isMitraTrip ? '' : normalizeText(rawPlan.driverRef);
        const issueBankRef = isMitraTrip ? '' : normalizeText(rawPlan.issueBankRef);
        const cashGiven = normalizeCurrencyNumber(rawPlan.cashGiven ?? 0);
        const requestedTaripBorongan = normalizeCurrencyNumber(rawPlan.taripBorongan ?? rawPlan.tripFee ?? 0);
        const date = normalizeOptionalText(rawPlan.date) || getBusinessDateValue();
        const pickupStopKeys = Array.isArray(rawPlan.pickupStopKeys)
            ? rawPlan.pickupStopKeys
                .filter((value): value is string => typeof value === 'string' && validPickupStopKeys.has(value))
            : [];

        if (pickupStopKeys.length === 0) {
            throw new Error(`Minimal 1 titik pickup wajib dipilih pada trip ${index + 1}`);
        }
        if (!isMitraTrip) {
            if (!vehicleRef) {
                throw new Error(`Kendaraan wajib dipilih pada trip ${index + 1}`);
            }
            if (!driverRef) {
                throw new Error(`Supir wajib dipilih pada trip ${index + 1}`);
            }
            if (!issueBankRef) {
                throw new Error(`Rekening atau kas sumber wajib dipilih pada trip ${index + 1}`);
            }
            if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
                throw new Error(`Nominal uang jalan awal wajib diisi pada trip ${index + 1}`);
            }
        }
        if (!Number.isFinite(requestedTaripBorongan) || requestedTaripBorongan < 0) {
            throw new Error(`Upah trip pada trip ${index + 1} tidak valid`);
        }
        assertIsoDate(date, `Tanggal trip ${index + 1}`);

        const [vehicle, driver, issueBank] = await Promise.all([
            vehicleRef
                ? getDocumentById<{
                    _id: string;
                    plateNumber?: string;
                    status?: string;
                    serviceRef?: string;
                    serviceName?: string;
                }>(vehicleRef, 'vehicle')
                : Promise.resolve(null),
            driverRef
                ? getDocumentById<{ _id: string; name?: string; active?: boolean }>(driverRef, 'driver')
                : Promise.resolve(null),
            issueBankRef
                ? getDocumentById<{ _id: string; bankName?: string; accountNumber?: string; active?: boolean }>(issueBankRef, 'bankAccount')
                : Promise.resolve(null),
        ]);

        if (vehicleRef) {
            if (!vehicle) {
                throw new Error(`Kendaraan pada trip ${index + 1} tidak ditemukan`);
            }
            if (vehicle.status === 'SOLD' || vehicle.status === 'OUT_OF_SERVICE') {
                throw new Error(`Kendaraan pada trip ${index + 1} tidak bisa dipakai`);
            }
        }
        if (driverRef) {
            if (!driver) {
                throw new Error(`Supir pada trip ${index + 1} tidak ditemukan`);
            }
            if (driver.active === false) {
                throw new Error(`Supir pada trip ${index + 1} tidak aktif`);
            }
        }
        if (issueBankRef) {
            if (!issueBank) {
                throw new Error(`Rekening atau kas sumber pada trip ${index + 1} tidak ditemukan`);
            }
            if (issueBank.active === false) {
                throw new Error(`Rekening atau kas sumber pada trip ${index + 1} tidak aktif`);
            }
        }

        const vehicleServiceRef = vehicle ? extractRefId(vehicle.serviceRef) || undefined : undefined;
        const vehicleCategoryOverrideReason = normalizeOptionalText(rawPlan.vehicleCategoryOverrideReason);
        if (!isMitraTrip && serviceRef && vehicleServiceRef !== serviceRef && !vehicleCategoryOverrideReason) {
            throw new Error(`Alasan override armada wajib diisi pada trip ${index + 1}`);
        }
        const effectiveRouteServiceRef = serviceRef || vehicleServiceRef;
        let tripRouteSelection: Awaited<ReturnType<typeof resolveTripRouteRateSelection>>;
        try {
            tripRouteSelection = await resolveTripRouteRateSelection(rawPlan, {
                serviceRef: effectiveRouteServiceRef,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Master biaya rute trip tidak valid';
            throw new Error(`${message} pada trip ${index + 1}`);
        }
        const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection.matchedTripRouteRate?.rate ?? 0);
        if (
            !isMitraTrip &&
            matchedTripRouteRateFee > 0 &&
            requestedTaripBorongan > 0 &&
            Math.abs(requestedTaripBorongan - matchedTripRouteRateFee) > 0.01
        ) {
            throw new Error(`Upah trip pada trip ${index + 1} mengikuti master biaya rute trip yang dipilih`);
        }
        const taripBorongan = isMitraTrip
            ? 0
            : matchedTripRouteRateFee > 0
                ? matchedTripRouteRateFee
                : requestedTaripBorongan;
        if (!isMitraTrip && (!Number.isFinite(taripBorongan) || taripBorongan <= 0)) {
            throw new Error(`Upah trip wajib diisi pada trip ${index + 1}`);
        }

        plans.push({
            _key: normalizeOptionalText(rawPlan._key) || crypto.randomUUID(),
            sequence: index + 1,
            tripOwnership,
            pickupStopKeys,
            vehicleRef,
            vehiclePlate: vehicle?.plateNumber,
            vehicleServiceRef,
            vehicleServiceName: vehicle?.serviceName,
            vehicleCategoryOverrideReason,
            driverRef,
            driverName: driver?.name,
            tripRouteRateRef: tripRouteSelection.tripRouteRateRef,
            tripOriginArea: tripRouteSelection.tripOriginArea,
            tripDestinationArea: tripRouteSelection.tripDestinationArea,
            taripBorongan,
            issueBankRef,
            issueBankName: issueBank
                ? [issueBank.bankName, issueBank.accountNumber].filter(Boolean).join(' - ') || issueBank.bankName
                : undefined,
            cashGiven,
            date,
            notes: normalizeOptionalText(rawPlan.notes),
        });
    }

    return plans;
}
