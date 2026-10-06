import { getBusinessCalendarDateParts } from './business-date';

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function buildFreightNotaDisplayNumberFromParts(
    notaNumber: string,
    issueDate: string,
    notaSeriesCode?: string | null,
) {
    const dateParts = getBusinessCalendarDateParts(issueDate);
    if (!dateParts) {
        return notaNumber;
    }

    const year = dateParts.year.slice(-2);
    const monthIndex = Number(dateParts.month) - 1;
    const romanMonth = ROMAN_MONTHS[monthIndex] || String(monthIndex + 1);
    const sequenceMatch = notaNumber.match(/(\d+)(?!.*\d)/);
    const sequence = sequenceMatch ? String(Number(sequenceMatch[1])).padStart(3, '0') : notaNumber;
    const seriesCode = notaSeriesCode?.trim() || '3';

    return `${year}/${romanMonth}/${seriesCode}/${sequence}`;
}

/**
 * Single place that decides the printed number ("No. Cetak Invoice").
 *
 * It is independent from the internal `notaNumber`: when the operator sets it, it is used
 * verbatim (e.g. `INV/DJABES/001` must not become `26/X/3/001`); otherwise it is derived
 * from the internal number into YY/ROMAN/SERIES/SEQ.
 */
export function resolveFreightNotaDisplayNumber(params: {
    notaNumber: string;
    issueDate: string;
    notaSeriesCode?: string | null;
    manualDisplayNumber?: string | null;
}) {
    const manualDisplayNumber = (params.manualDisplayNumber || '').trim();
    if (manualDisplayNumber) {
        return manualDisplayNumber;
    }
    return buildFreightNotaDisplayNumberFromParts(
        params.notaNumber,
        params.issueDate,
        params.notaSeriesCode,
    );
}
