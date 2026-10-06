import { computeDeliveryOrderOvertonage } from '@/lib/delivery-order-overtonage';
import { getTripRouteOvertonaseRatePerKg } from '@/lib/trip-route-rate-support';
import type { DeliveryOrder } from '@/lib/types';

import {
    extractRefId,
    normalizeCurrencyNumber,
    normalizeNumber,
} from './data-helpers';
import { computeDriverVoucherTotals } from './driver-workflow-support';
import {
    getDocumentById,
    listDocumentsByFilter,
} from '@/lib/repositories/document-store';

export type TripOvertonageComputationResult = ReturnType<typeof computeDeliveryOrderOvertonage>;

export async function computeTripOvertonageAdjustment(params: {
    deliveryOrder: DeliveryOrder;
    actualTotalTripWeightKg: number;
}) {
    const { deliveryOrder, actualTotalTripWeightKg } = params;
    const serviceRef = extractRefId(deliveryOrder.serviceRef);
    const vehicleRef = extractRefId(deliveryOrder.vehicleRef);
    const tripRouteRateRef = extractRefId(deliveryOrder.tripRouteRateRef);
    const [service, vehicle, tripRouteRate, linkedVoucher] = await Promise.all([
        serviceRef
            ? getDocumentById<{
                _id: string;
                maxPayloadKg?: number;
            }>(serviceRef, 'service')
            : Promise.resolve(null),
        vehicleRef
            ? getDocumentById<{
                _id: string;
                capacityKg?: number;
            }>(vehicleRef, 'vehicle')
            : Promise.resolve(null),
        tripRouteRateRef
            ? getDocumentById<{
                _id: string;
                overtonaseDriverRatePerTon?: number;
                overtonaseReferencePerTon?: number;
                notes?: string;
            }>(tripRouteRateRef, 'tripRouteRate')
            : Promise.resolve(null),
        listDocumentsByFilter<{
            _id: string;
            _rev?: string;
            bonNumber?: string;
            status?: string;
            totalSpent?: number;
            totalIssuedAmount?: number;
            cashGiven?: number;
            driverFeeAmount?: number;
        }>('driverVoucher', { deliveryOrderRef: deliveryOrder._id }).then(rows => rows[0] || null),
    ]);

    const overtonageResult = computeDeliveryOrderOvertonage({
        actualTotalWeightKg: actualTotalTripWeightKg,
        serviceMaxPayloadKg: service?.maxPayloadKg ?? deliveryOrder.serviceMaxPayloadKg,
        vehicleCapacityKg: vehicle?.capacityKg ?? deliveryOrder.vehicleCapacityKg,
        baseTripFee: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0),
        overtonaseDriverRatePerKg:
            normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? 0) > 0
                ? normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? 0)
                : getTripRouteOvertonaseRatePerKg(tripRouteRate),
        manualOvertonaseWeightKg: deliveryOrder.manualOvertonaseWeightKg,
        underloadDriverRatePerKg:
            normalizeCurrencyNumber(deliveryOrder.underloadDriverRatePerKg ?? 0) > 0
                ? normalizeCurrencyNumber(deliveryOrder.underloadDriverRatePerKg ?? 0)
                : getTripRouteOvertonaseRatePerKg(tripRouteRate),
        manualUnderloadWeightKg: deliveryOrder.manualUnderloadWeightKg,
    });

    let linkedVoucherPatch:
        | {
            _id: string;
            driverFeeAmount: number;
            totalClaimAmount: number;
            balance: number;
        }
        | undefined;
    let linkedVoucherAdjustmentSummary: string | undefined;
    let settledVoucherOvertonageWarning: string | undefined;

    if (
        linkedVoucher?._id &&
        linkedVoucher.status !== 'SETTLED' &&
        Math.abs(normalizeCurrencyNumber(linkedVoucher.driverFeeAmount ?? 0) - overtonageResult.effectiveTripFee) > 0.01
    ) {
        const voucherTotals = computeDriverVoucherTotals(
            normalizeNumber(linkedVoucher.totalIssuedAmount ?? linkedVoucher.cashGiven ?? 0, { maxFractionDigits: 0 }),
            normalizeNumber(linkedVoucher.totalSpent ?? 0, { maxFractionDigits: 0 }),
            overtonageResult.effectiveTripFee
        );
        linkedVoucherPatch = {
            _id: linkedVoucher._id,
            driverFeeAmount: voucherTotals.driverFeeAmount,
            totalClaimAmount: voucherTotals.totalClaimAmount,
            balance: voucherTotals.balance,
        };
        linkedVoucherAdjustmentSummary = `bon ${linkedVoucher.bonNumber || linkedVoucher._id} ikut disinkronkan ke ${voucherTotals.driverFeeAmount}`;
    }

    if (
        linkedVoucher?._id &&
        linkedVoucher.status === 'SETTLED' &&
        Math.abs(normalizeCurrencyNumber(linkedVoucher.driverFeeAmount ?? 0) - overtonageResult.effectiveTripFee) > 0.01
    ) {
        settledVoucherOvertonageWarning = `Bon ${linkedVoucher.bonNumber || linkedVoucher._id} sudah selesai, jadi tambahan overtonase tidak ikut mengubah penyelesaian uang jalan lama.`;
    }

    return {
        overtonageResult,
        linkedVoucherPatch,
        linkedVoucherAdjustmentSummary,
        settledVoucherOvertonageWarning,
    };
}
