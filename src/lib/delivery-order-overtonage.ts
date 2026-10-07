export type DeliveryOrderOvertonageResult = {
    actualTotalWeightKg: number;
    serviceMaxPayloadKg?: number;
    vehicleCapacityKg?: number;
    overtonaseWeightKg?: number;
    manualOvertonaseWeightKg?: number;
    overtonaseDriverRatePerKg?: number;
    overtonaseDriverAmount?: number;
    vehicleCapacityExceededKg?: number;
    manualTripFeeDeductionAmount?: number;
    effectiveTripFee: number;
};

function normalizeNonNegative(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return numeric;
}

function roundQuantity(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function floorToWholeTonsKg(valueKg: number) {
    return Math.floor(valueKg / 1000) * 1000;
}

export function computeDeliveryOrderOvertonage(params: {
    actualTotalWeightKg: unknown;
    serviceMaxPayloadKg?: unknown;
    vehicleCapacityKg?: unknown;
    baseTripFee?: unknown;
    overtonaseDriverRatePerKg?: unknown;
    manualOvertonaseWeightKg?: unknown;
    manualTripFeeDeductionAmount?: unknown;
}): DeliveryOrderOvertonageResult {
    const actualTotalWeightKg = roundQuantity(normalizeNonNegative(params.actualTotalWeightKg));
    const serviceMaxPayloadKg = roundQuantity(normalizeNonNegative(params.serviceMaxPayloadKg));
    const vehicleCapacityKg = roundQuantity(normalizeNonNegative(params.vehicleCapacityKg));
    const baseTripFee = Math.round(normalizeNonNegative(params.baseTripFee));
    const overtonaseDriverRatePerKg = Math.round(normalizeNonNegative(params.overtonaseDriverRatePerKg));
    const manualOvertonaseWeightKg = roundQuantity(normalizeNonNegative(params.manualOvertonaseWeightKg));
    const manualTripFeeDeductionAmount = Math.round(normalizeNonNegative(params.manualTripFeeDeductionAmount));
    const effectivePayloadLimitKg = serviceMaxPayloadKg > 0 ? serviceMaxPayloadKg : 0;

    const automaticOvertonaseWeightKg =
        actualTotalWeightKg > 0 && effectivePayloadLimitKg > 0
            ? roundQuantity(Math.max(actualTotalWeightKg - effectivePayloadLimitKg, 0))
            : 0;
    const overtonaseWeightKg = manualOvertonaseWeightKg > 0
        ? manualOvertonaseWeightKg
        : automaticOvertonaseWeightKg;
    const vehicleCapacityExceededKg =
        actualTotalWeightKg > 0 && vehicleCapacityKg > 0
            ? roundQuantity(Math.max(actualTotalWeightKg - vehicleCapacityKg, 0))
            : 0;
    const payableOvertonaseWeightKg = floorToWholeTonsKg(overtonaseWeightKg);
    const overtonaseDriverAmount =
        payableOvertonaseWeightKg > 0 && overtonaseDriverRatePerKg > 0
            ? Math.round(payableOvertonaseWeightKg * overtonaseDriverRatePerKg)
            : 0;

    return {
        actualTotalWeightKg,
        serviceMaxPayloadKg: serviceMaxPayloadKg > 0 ? serviceMaxPayloadKg : undefined,
        vehicleCapacityKg: vehicleCapacityKg > 0 ? vehicleCapacityKg : undefined,
        manualOvertonaseWeightKg: manualOvertonaseWeightKg > 0 ? manualOvertonaseWeightKg : undefined,
        overtonaseWeightKg: overtonaseWeightKg > 0 ? overtonaseWeightKg : undefined,
        overtonaseDriverRatePerKg: overtonaseDriverRatePerKg > 0 ? overtonaseDriverRatePerKg : undefined,
        overtonaseDriverAmount: overtonaseDriverAmount > 0 ? overtonaseDriverAmount : undefined,
        vehicleCapacityExceededKg: vehicleCapacityExceededKg > 0 ? vehicleCapacityExceededKg : undefined,
        manualTripFeeDeductionAmount: manualTripFeeDeductionAmount > 0 ? manualTripFeeDeductionAmount : undefined,
        effectiveTripFee: Math.max(baseTripFee + overtonaseDriverAmount - manualTripFeeDeductionAmount, 0),
    };
}
