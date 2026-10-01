import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { convertKgToWeightInputValue } from './measurement';
import type { FreightNotaBillingMode } from './types';

export const FREIGHT_NOTA_BILLING_MODE_OPTIONS: Array<{
    value: FreightNotaBillingMode;
    label: string;
    description: string;
}> = [
    {
        value: 'PER_KG',
        label: 'Kg / Tarif per kg',
        description: 'Invoice tampil dalam kg dan total dihitung per kg.',
    },
    {
        value: 'PER_TON',
        label: 'Ton / Tarif per ton',
        description: 'Invoice tampil dalam ton dan total dihitung per ton.',
    },
    {
        value: 'PER_VOLUME',
        label: 'Volume / Tarif per m3',
        description: 'Invoice dihitung dari volume muatan dalam meter kubik.',
    },
    {
        value: 'PER_LITER',
        label: 'Liter / Tarif per liter',
        description: 'Invoice dihitung dari volume muatan dalam liter (1 m3 = 1000 liter).',
    },
    {
        value: 'PER_TRIP',
        label: 'Trip / Tarif per surat jalan',
        description: 'Invoice dihitung satu tarif tetap per baris surat jalan.',
    },
];

export function isFreightNotaBillingMode(value: unknown): value is FreightNotaBillingMode {
    return value === 'PER_KG' || value === 'PER_TON' || value === 'PER_VOLUME' || value === 'PER_LITER' || value === 'PER_TRIP';
}

export function normalizeFreightNotaBillingMode(value: unknown): FreightNotaBillingMode {
    return isFreightNotaBillingMode(value) ? value : 'PER_KG';
}

export function resolveFreightNotaBillingModeInput(
    value: unknown,
    label: string,
    options?: { defaultMode?: FreightNotaBillingMode; allowEmpty?: boolean }
): FreightNotaBillingMode {
    const normalized =
        typeof value === 'string'
            ? value.trim().toUpperCase()
            : '';
    if (!normalized) {
        if (options?.allowEmpty) {
            return options?.defaultMode || 'PER_KG';
        }
        throw new Error(`${label} tidak valid`);
    }
    if (!isFreightNotaBillingMode(normalized)) {
        throw new Error(`${label} tidak valid`);
    }
    return normalized;
}

export function getFreightNotaBillingModeLabel(mode: FreightNotaBillingMode) {
    if (mode === 'PER_TON') return 'Per Ton';
    if (mode === 'PER_VOLUME') return 'Per Volume';
    if (mode === 'PER_LITER') return 'Per Liter';
    if (mode === 'PER_TRIP') return 'Per Trip';
    return 'Per Kg';
}

export function getFreightNotaWeightColumnLabel(mode: FreightNotaBillingMode) {
    if (mode === 'PER_VOLUME') return 'VOLUME';
    if (mode === 'PER_LITER') return 'LITER';
    if (mode === 'PER_TRIP') return 'QTY';
    return 'BERAT';
}

export function getFreightNotaRateColumnLabel(_mode: FreightNotaBillingMode) {
    void _mode;
    return 'TARIF';
}

export function getFreightNotaWeightUnitLabel(mode: FreightNotaBillingMode) {
    if (mode === 'PER_VOLUME') return 'm3';
    if (mode === 'PER_LITER') return 'liter';
    if (mode === 'PER_TRIP') return 'trip';
    return mode === 'PER_TON' ? 'ton' : 'kg';
}

export function getFreightNotaDisplayWeightValue(beratKg: unknown, mode: FreightNotaBillingMode, volumeM3?: unknown) {
    const normalizedKg = Math.max(parseFormattedNumberish(beratKg || 0), 0);
    if (mode === 'PER_VOLUME') {
        return Math.max(parseFormattedNumberish(volumeM3 || 0, { maxFractionDigits: 3 }), 0);
    }
    if (mode === 'PER_LITER') {
        return Math.max(parseFormattedNumberish(volumeM3 || 0, { maxFractionDigits: 3 }), 0) * 1000;
    }
    if (mode === 'PER_TRIP') {
        return 1;
    }
    return mode === 'PER_TON'
        ? convertKgToWeightInputValue(normalizedKg, 'TON')
        : normalizedKg;
}

export function roundFreightNotaCurrencyAmount(value: unknown) {
    const numeric = parseFormattedNumberish(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return Math.round(numeric);
}

export function calculateFreightNotaRowAmount(params: {
    beratKg: unknown;
    volumeM3?: unknown;
    tarip: unknown;
    billingMode: FreightNotaBillingMode;
}) {
    const beratKg = Math.max(parseFormattedNumberish(params.beratKg || 0), 0);
    const volumeM3 = Math.max(parseFormattedNumberish(params.volumeM3 || 0, { maxFractionDigits: 3 }), 0);
    const tarip = Math.max(parseFormattedNumberish(params.tarip || 0), 0);
    if (params.billingMode === 'PER_TRIP') {
        return roundFreightNotaCurrencyAmount(tarip);
    }
    if (params.billingMode === 'PER_VOLUME') {
        return roundFreightNotaCurrencyAmount(volumeM3 * tarip);
    }
    if (params.billingMode === 'PER_LITER') {
        return roundFreightNotaCurrencyAmount(volumeM3 * 1000 * tarip);
    }
    const billedWeight = params.billingMode === 'PER_TON' ? convertKgToWeightInputValue(beratKg, 'TON') : beratKg;
    return roundFreightNotaCurrencyAmount(billedWeight * tarip);
}

function formatBillingValue(value: number, maxFractionDigits: number) {
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxFractionDigits,
    }).format(value);
}

export function formatFreightNotaDisplayWeight(params: {
    beratKg: unknown;
    volumeM3?: unknown;
    billingMode: FreightNotaBillingMode;
    includeCanonical?: boolean;
}) {
    const beratKg = Math.max(parseFormattedNumberish(params.beratKg || 0), 0);
    if (params.billingMode === 'PER_VOLUME') {
        return `${formatBillingValue(Math.max(parseFormattedNumberish(params.volumeM3 || 0, { maxFractionDigits: 3 }), 0), 3)} m3`;
    }
    if (params.billingMode === 'PER_LITER') {
        return `${formatBillingValue(Math.max(parseFormattedNumberish(params.volumeM3 || 0, { maxFractionDigits: 3 }), 0) * 1000, 3)} liter`;
    }
    if (params.billingMode === 'PER_TRIP') {
        return '1 trip';
    }
    if (params.billingMode === 'PER_TON') {
        const tonValue = getFreightNotaDisplayWeightValue(beratKg, 'PER_TON');
        const tonLabel = `${formatBillingValue(tonValue, 3)} ton`;
        if (params.includeCanonical) {
            return `${tonLabel} (${formatBillingValue(beratKg, 2)} kg)`;
        }
        return tonLabel;
    }

    return `${formatBillingValue(beratKg, 2)} kg`;
}
