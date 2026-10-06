export type WeightInputUnit = 'KG' | 'TON';
export type VolumeInputUnit = 'M3' | 'LITER' | 'KL';

import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';

export const WEIGHT_INPUT_UNIT_OPTIONS: Array<{ value: WeightInputUnit; label: string }> = [
  { value: 'KG', label: 'Kg' },
  { value: 'TON', label: 'Ton' },
];

export const VOLUME_INPUT_UNIT_OPTIONS: Array<{ value: VolumeInputUnit; label: string }> = [
  { value: 'M3', label: 'm3' },
  { value: 'LITER', label: 'Liter' },
  { value: 'KL', label: 'KL' },
];

export function isWeightInputUnit(value: unknown): value is WeightInputUnit {
  return value === 'KG' || value === 'TON';
}

export function isVolumeInputUnit(value: unknown): value is VolumeInputUnit {
  return value === 'M3' || value === 'LITER' || value === 'KL';
}

export function readWeightInputUnit(value: unknown, fallback: WeightInputUnit = 'KG'): WeightInputUnit {
  return isWeightInputUnit(value) ? value : fallback;
}

export function readVolumeInputUnit(value: unknown, fallback: VolumeInputUnit = 'M3'): VolumeInputUnit {
  return isVolumeInputUnit(value) ? value : fallback;
}

function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

function formatQuantityValue(value: number) {
  return formatNumber(value, {
    maximumFractionDigits: 2,
  });
}

export function getWeightInputFractionDigits(unit: WeightInputUnit | 'KG' = 'KG') {
  // Kg supports two decimals, so ton needs five decimals to preserve 0.01 kg.
  return unit === 'TON' ? 5 : 2;
}

function formatWeightValue(value: number, unit: WeightInputUnit | 'KG' = 'KG') {
  return formatNumber(value, {
    maximumFractionDigits: getWeightInputFractionDigits(unit),
  });
}

function formatVolumeValue(value: number, unit: VolumeInputUnit | 'M3' = 'M3') {
  return formatNumber(value, {
    maximumFractionDigits: unit === 'LITER' ? 0 : 3,
  });
}

function readRawCommaDecimal(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d*),(\d+)$/);
  if (!match) return null;

  const integerPart = match[1] || '0';
  const fractionPart = match[2];
  const numeric = Number(`${integerPart}.${fractionPart}`);
  if (!Number.isFinite(numeric)) return null;
  const integerValue = Number(integerPart);
  const displayIntegerPart = Number.isFinite(integerValue)
    ? formatNumber(integerValue, { maximumFractionDigits: 0 })
    : integerPart;

  return {
    numeric,
    display: `${displayIntegerPart},${fractionPart}`,
  };
}

export const KG_PER_TON = 1000;
export const LITERS_PER_M3 = 1000;

export function convertWeightToKg(value: number, unit: WeightInputUnit) {
  return unit === 'TON' ? value * KG_PER_TON : value;
}

export function convertKgToWeightInputValue(valueKg: number, unit: WeightInputUnit) {
  return unit === 'TON' ? valueKg / KG_PER_TON : valueKg;
}

export function convertVolumeToM3(value: number, unit: VolumeInputUnit) {
  return unit === 'LITER' ? value / LITERS_PER_M3 : value;
}

export function convertM3ToVolumeInputValue(valueM3: number, unit: VolumeInputUnit) {
  return unit === 'LITER' ? valueM3 * LITERS_PER_M3 : valueM3;
}

export function formatWeightDisplay(input: {
  weightKg?: number | string;
  weightInputValue?: number | string;
  weightInputUnit?: WeightInputUnit;
  includeCanonical?: boolean;
}) {
  const unit = input.weightInputUnit || 'KG';
  const weightKg = parseFormattedNumberish(input.weightKg || 0);
  const inputValue = parseFormattedNumberish(input.weightInputValue || 0, {
    maxFractionDigits: getWeightInputFractionDigits(unit),
  });
  const rawInputValue = readRawCommaDecimal(input.weightInputValue);

  if (inputValue > 0) {
    const inputLabel = `${rawInputValue?.display || formatWeightValue(inputValue, unit)} ${unit === 'TON' ? 'ton' : 'kg'}`;
    if (input.includeCanonical && unit === 'TON') {
      return `${inputLabel} (${formatWeightValue(weightKg, 'KG')} kg)`;
    }
    return inputLabel;
  }

  if (weightKg <= 0) {
    return '-';
  }

  return `${formatWeightValue(weightKg, 'KG')} kg`;
}

export function formatVolumeDisplay(input: {
  volumeM3?: number | string;
  volumeInputValue?: number | string;
  volumeInputUnit?: VolumeInputUnit;
  includeCanonical?: boolean;
}) {
  const unit = input.volumeInputUnit || 'M3';
  const volumeM3 = parseFormattedNumberish(input.volumeM3 || 0, {
    maxFractionDigits: 3,
  });
  const inputValue = parseFormattedNumberish(input.volumeInputValue || 0, {
    maxFractionDigits: unit === 'LITER' ? 0 : 3,
  });
  const rawInputValue = readRawCommaDecimal(input.volumeInputValue);

  if (inputValue > 0) {
    const unitLabel = unit === 'M3' ? 'm3' : unit === 'KL' ? 'KL' : 'liter';
    const inputLabel = `${rawInputValue?.display || formatVolumeValue(inputValue, unit)} ${unitLabel}`;
    if (input.includeCanonical && unit !== 'M3') {
      return `${inputLabel} (${formatVolumeValue(volumeM3, 'M3')} m3)`;
    }
    return inputLabel;
  }

  if (volumeM3 <= 0) {
    return '-';
  }

  return `${formatVolumeValue(volumeM3, 'M3')} m3`;
}

export function formatCargoSummary(input: {
  qtyKoli?: number | string;
  weightKg?: number | string;
  weightInputValue?: number | string;
  weightInputUnit?: WeightInputUnit;
  volumeM3?: number | string;
  volumeInputValue?: number | string;
  volumeInputUnit?: VolumeInputUnit;
}) {
  const segments: string[] = [];
  const qtyKoli = parseFormattedNumberish(input.qtyKoli || 0, {
    maxFractionDigits: 2,
  });
  if (qtyKoli > 0) {
    segments.push(`${formatQuantityValue(qtyKoli)} koli`);
  }

  const weightLabel = formatWeightDisplay({
    weightKg: input.weightKg,
    weightInputValue: input.weightInputValue,
    weightInputUnit: input.weightInputUnit,
    includeCanonical: true,
  });
  if (weightLabel !== '-') {
    segments.push(weightLabel);
  }

  const volumeLabel = formatVolumeDisplay({
    volumeM3: input.volumeM3,
    volumeInputValue: input.volumeInputValue,
    volumeInputUnit: input.volumeInputUnit,
    includeCanonical: true,
  });
  if (volumeLabel !== '-') {
    segments.push(volumeLabel);
  }

  return segments.length > 0 ? segments.join(' / ') : '-';
}
