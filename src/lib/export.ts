/* ============================================================
   LOGISTIK - Excel Export Utility
   Uses ExcelJS for spreadsheet generation
   ============================================================ */

import ExcelJS from 'exceljs';
import { resolveCompanyLogoUrl } from './branding';
import { formatBusinessDateTime, getBusinessDateValue } from './business-date';
import { buildEmployeeAttendanceRecapRows, EMPLOYEE_ATTENDANCE_STATUS_LABELS, type EmployeeAttendanceRecapRow } from './employee-attendance';
import {
    formatFreightNotaDisplayWeight,
    getFreightNotaRateColumnLabel,
    getFreightNotaWeightColumnLabel,
    normalizeFreightNotaBillingMode,
} from './freight-nota-billing';
import { buildPph23Label, calculatePph23Summary } from './pph23';
import {
    buildInvoiceInstructionAccountText,
    fetchCompanyProfile,
    fmtCurrency,
    fmtDate,
    fmtNumber,
    formatFreightNotaDisplayNumber,
    resolveDocumentIssuerProfile,
    resolveFreightNotaIssuerProfile,
    resolveInvoiceInstructionAccounts,
    type InvoiceInstructionAccount,
} from './print';
import type { CompanyProfile, Employee, EmployeeAttendanceRecord, FreightNota, FreightNotaItem } from './types';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { getReceivableNetAmount } from './utils';

type ExportValue = string | number | boolean | Date | null | undefined;

interface ExportColumn {
    header: string;
    key: string;
    width?: number;
    formatter?: (value: unknown, row: Record<string, unknown>) => ExportValue;
}

interface ExportMetaItem {
    label: string;
    value: ExportValue;
}

interface ExportTotalRow {
    label: string;
    values?: Record<string, ExportValue>;
}

interface ExportOptions {
    title?: string;
    subtitle?: string;
    company?: CompanyProfile | null;
    metadata?: ExportMetaItem[];
    footnotes?: string[];
    totalRow?: ExportTotalRow;
    emptyMessage?: string;
    showCompanyHeader?: boolean;
    includeRowCount?: boolean;
}

interface EmployeeAttendanceExportSummary {
    periodLabel: string;
    startDate: string;
    endDate: string;
    activeEmployeeCount: number;
    recordedEmployeeCount: number;
    unrecordedEmployeeCount: number;
    totalRecords: number;
    presentCount: number;
    earlyLeaveCount: number;
    permissionCount: number;
    sickCount: number;
    leaveCount: number;
    absentCount: number;
    offCount: number;
    pendingEmployees: Array<{
        employeeCode?: string;
        name?: string;
        division?: string;
        position?: string;
    }>;
}

interface EmployeeAttendanceExportFilters {
    search?: string;
    statusLabel?: string;
    employeeLabel?: string;
    anchorDate?: string;
}

interface MergeRange {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
}

type ExcelImageExtension = 'png' | 'jpeg' | 'gif';

function numericish(value: unknown): string | number | undefined {
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function booleanish(value: unknown): string | boolean | undefined {
    return typeof value === 'string' || typeof value === 'boolean' ? value : undefined;
}

function sanitizeSheetName(name: string) {
    const normalized = name.replace(/[\\/?*[\]:]/g, ' ').trim();
    return normalized.slice(0, 31) || 'Data';
}

function timestampLabel() {
    return formatBusinessDateTime(new Date(), 'id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: undefined,
    }).replace(/\./g, ':');
}

function textValue(value: ExportValue) {
    if (value === undefined || value === null) return '';
    if (value instanceof Date) return fmtDate(value.toISOString());
    return String(value);
}

function resolveCellValue(column: ExportColumn, row: Record<string, unknown>) {
    const rawValue = row[column.key];
    if (column.formatter) return column.formatter(rawValue, row);
    if (rawValue === undefined || rawValue === null) return '';
    return rawValue as ExportValue;
}

function assignCellValue(
    worksheet: ExcelJS.Worksheet,
    rowIndex: number,
    colIndex: number,
    value: ExportValue,
    column?: ExportColumn,
) {
    const cell = worksheet.getRow(rowIndex).getCell(colIndex + 1);

    if (value === undefined || value === null || value === '') {
        cell.value = '';
        return;
    }

    if (value instanceof Date) {
        cell.value = value;
        cell.numFmt = 'dd-mmm-yy';
        return;
    }

    cell.value = value as ExcelJS.CellValue;

    if (typeof value === 'number' && !column?.formatter) {
        if (/jumlah|saldo|total|uang|ongkos|tarip|biaya|nominal/i.test(column?.header || '')) {
            cell.numFmt = '#,##0';
        }
    }
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string) {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob(
        [buffer],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );

    const safeFilename = `${filename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'export'}.xlsx`;
    if (
        typeof window !== 'undefined'
        && (window.navigator as unknown as Record<string, unknown>).msSaveOrOpenBlob
    ) {
        (window.navigator as unknown as Record<string, (...args: unknown[]) => void>)
            .msSaveOrOpenBlob(blob, safeFilename);
        return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = safeFilename;
    link.setAttribute('download', safeFilename);
    document.body.appendChild(link);

    setTimeout(() => {
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 200);
    }, 0);
}

function applyMerges(worksheet: ExcelJS.Worksheet, merges: MergeRange[]) {
    merges.forEach((merge) => {
        if (merge.endCol > merge.startCol || merge.endRow > merge.startRow) {
            worksheet.mergeCells(merge.startRow, merge.startCol, merge.endRow, merge.endCol);
        }
    });
}

function setColumnWidths(worksheet: ExcelJS.Worksheet, columns: ExportColumn[]) {
    columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width || 20;
    });
}

function addRows(worksheet: ExcelJS.Worksheet, rows: ExportValue[][]) {
    rows.forEach((row) => {
        worksheet.addRow(row);
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
                resolve(result);
                return;
            }
            reject(new Error('Gagal membaca logo perusahaan'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('Gagal membaca logo perusahaan'));
        reader.readAsDataURL(blob);
    });
}

function getExcelImageExtension(base64: string): ExcelImageExtension | null {
    const match = base64.match(/^data:image\/(png|jpeg|jpg|gif);base64,/i);
    if (!match) return null;
    const extension = match[1].toLowerCase();
    if (extension === 'jpg') return 'jpeg';
    if (extension === 'png' || extension === 'jpeg' || extension === 'gif') return extension;
    return null;
}

async function resolveCompanyLogoBase64(company?: Pick<CompanyProfile, 'logoUrl'> | null) {
    const logoUrl = resolveCompanyLogoUrl(company);
    if (!logoUrl) return null;
    if (logoUrl.startsWith('data:image/')) return logoUrl;

    try {
        const response = await fetch(logoUrl, { cache: 'no-store' });
        if (!response.ok) return null;
        const blob = await response.blob();
        return await blobToDataUrl(blob);
    } catch {
        return null;
    }
}

async function addCompanyLogoToWorksheet(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
    company?: Pick<CompanyProfile, 'logoUrl'> | null,
    placement: {
        col: number;
        row: number;
        width: number;
        height: number;
    } = {
        col: 0.15,
        row: 0.15,
        width: 128,
        height: 56,
    },
) {
    const base64 = await resolveCompanyLogoBase64(company);
    const extension = base64 ? getExcelImageExtension(base64) : null;
    if (!base64 || !extension) return false;

    const imageId = workbook.addImage({ base64, extension });
    worksheet.addImage(imageId, {
        tl: { col: placement.col, row: placement.row },
        ext: { width: placement.width, height: placement.height },
    });
    return true;
}

function applyAttendanceSectionHeading(
    worksheet: ExcelJS.Worksheet,
    rowNumber: number,
    totalColumns: number,
    label: string,
) {
    worksheet.mergeCells(rowNumber, 1, rowNumber, totalColumns);
    const cell = worksheet.getRow(rowNumber).getCell(1);
    cell.value = label;
    cell.font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
    cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF6FF' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    worksheet.getRow(rowNumber).height = 22;
}

function applyAttendanceTableHeaderStyle(row: ExcelJS.Row) {
    row.font = { bold: true, color: { argb: 'FF111827' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE5E7EB' },
        };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        };
    });
}

function applyAttendanceBodyBorder(row: ExcelJS.Row) {
    row.eachCell((cell) => {
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
        cell.alignment = { vertical: 'top', wrapText: true };
    });
}

function applyAttendanceKeyValueStyle(labelCell: ExcelJS.Cell, valueCell: ExcelJS.Cell) {
    labelCell.font = { bold: true, color: { argb: 'FF374151' } };
    labelCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF9FAFB' },
    };
    labelCell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
    valueCell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
    valueCell.alignment = { vertical: 'middle', wrapText: true };
}

export async function exportToExcel(
    data: Record<string, unknown>[],
    columns: ExportColumn[],
    filename: string,
    sheetName = 'Data',
    options: ExportOptions = {},
) {
    const company = options.company ?? await fetchCompanyProfile();
    const totalColumns = Math.max(columns.length, 1);
    const rows: ExportValue[][] = [];
    const merges: MergeRange[] = [];

    const addMergedRow = (value: ExportValue) => {
        const rowNumber = rows.length + 1;
        rows.push([value]);
        if (totalColumns > 1) {
            merges.push({
                startRow: rowNumber,
                startCol: 1,
                endRow: rowNumber,
                endCol: totalColumns,
            });
        }
    };

    const title = options.title || sheetName;
    if (options.showCompanyHeader !== false) {
        addMergedRow(company?.name || 'PT Gading Mas Surya');
    }
    addMergedRow(title);
    if (options.subtitle) addMergedRow(options.subtitle);
    addMergedRow(`Diekspor: ${timestampLabel()}`);
    if (options.includeRowCount !== false) {
        addMergedRow(`Jumlah data: ${fmtNumber(data.length)}`);
    }

    if (options.metadata && options.metadata.length > 0) {
        rows.push([]);
        options.metadata.forEach((item) => {
            rows.push([item.label, textValue(item.value)]);
        });
    }

    rows.push([]);
    const headerRowIndex = rows.length + 1;
    rows.push(columns.map((column) => column.header));

    if (data.length === 0) {
        const rowNumber = rows.length + 1;
        rows.push([options.emptyMessage || 'Tidak ada data untuk diekspor']);
        if (totalColumns > 1) {
            merges.push({
                startRow: rowNumber,
                startCol: 1,
                endRow: rowNumber,
                endCol: totalColumns,
            });
        }
    } else {
        data.forEach((item) => {
            rows.push(columns.map((column) => resolveCellValue(column, item)));
        });
    }

    if (options.totalRow) {
        rows.push(
            columns.map((column, index) => {
                if (index === 0) return options.totalRow?.label;
                return options.totalRow?.values?.[column.key] ?? '';
            }),
        );
    }

    if (options.footnotes && options.footnotes.length > 0) {
        rows.push([]);
        options.footnotes.forEach((note) => {
            const rowNumber = rows.length + 1;
            rows.push([note]);
            if (totalColumns > 1) {
                merges.push({
                    startRow: rowNumber,
                    startCol: 1,
                    endRow: rowNumber,
                    endCol: totalColumns,
                });
            }
        });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = company?.name || 'PT Gading Mas Surya';
    workbook.company = company?.name || 'PT Gading Mas Surya';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = options.subtitle || sheetName;
    workbook.title = title;

    const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName));
    addRows(worksheet, rows);
    setColumnWidths(worksheet, columns);
    applyMerges(worksheet, merges);
    const logoPlaced = await addCompanyLogoToWorksheet(workbook, worksheet, company, {
        col: Math.max(totalColumns - 2.2, 0.15),
        row: 0.15,
        width: 124,
        height: 54,
    });
    if (logoPlaced) {
        worksheet.getRow(1).height = Math.max(worksheet.getRow(1).height || 0, 26);
        worksheet.getRow(2).height = Math.max(worksheet.getRow(2).height || 0, 24);
        worksheet.getRow(3).height = Math.max(worksheet.getRow(3).height || 0, 22);
        worksheet.getRow(4).height = Math.max(worksheet.getRow(4).height || 0, 20);
    }

    if (columns.length > 0) {
        const dataRowCount = Math.max(data.length, 1);
        worksheet.autoFilter = {
            from: { row: headerRowIndex, column: 1 },
            to: { row: headerRowIndex + dataRowCount - 1, column: columns.length },
        };
    }

    const dataStartRowIndex = headerRowIndex + 1;
    data.forEach((item, itemIndex) => {
        columns.forEach((column, colIndex) => {
            const value = resolveCellValue(column, item);
            assignCellValue(worksheet, dataStartRowIndex + itemIndex, colIndex, value, column);
        });
    });

    if (options.totalRow) {
        const totalRowIndex = dataStartRowIndex + Math.max(data.length, 1);
        columns.forEach((column, colIndex) => {
            const value = colIndex === 0
                ? options.totalRow?.label
                : options.totalRow?.values?.[column.key];
            assignCellValue(worksheet, totalRowIndex, colIndex, value, column);
        });
    }

    await downloadWorkbook(workbook, filename);
}

export async function exportEmployeeAttendanceReport(input: {
    records: EmployeeAttendanceRecord[];
    summary: EmployeeAttendanceExportSummary;
    filters: EmployeeAttendanceExportFilters;
    filename?: string;
    company?: CompanyProfile | null;
    employees?: Array<Pick<Employee, '_id' | 'employeeCode' | 'name' | 'division' | 'position'>>;
}) {
    const company = input.company ?? await fetchCompanyProfile();
    const workbook = new ExcelJS.Workbook();
    const filename = input.filename || `absensi-${getBusinessDateValue()}`;
    const rangeLabel = input.summary.startDate === input.summary.endDate
        ? fmtDate(input.summary.startDate)
        : `${fmtDate(input.summary.startDate)} s/d ${fmtDate(input.summary.endDate)}`;
    const searchLabel = input.filters.search?.trim() || '-';
    const statusLabel = input.filters.statusLabel || 'Semua Status';
    const employeeLabel = input.filters.employeeLabel || 'Semua Karyawan';
    const anchorLabel = input.filters.anchorDate ? fmtDate(input.filters.anchorDate) : fmtDate(getBusinessDateValue());
    const recapEmployeeRows = buildEmployeeAttendanceRecapRows(input.records, input.employees || []);

    workbook.creator = company?.name || 'PT Gading Mas Surya';
    workbook.company = company?.name || 'PT Gading Mas Surya';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = `Laporan Absensi ${input.summary.periodLabel}`;
    workbook.title = `Absensi ${input.summary.periodLabel}`;

    const summarySheet = workbook.addWorksheet(sanitizeSheetName('Ringkasan Absensi'));
    summarySheet.columns = [
        { width: 24 },
        { width: 26 },
        { width: 24 },
        { width: 26 },
    ];

    summarySheet.mergeCells('A1:D1');
    summarySheet.getCell('A1').value = company?.name || 'PT Gading Mas Surya';
    summarySheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF111827' } };

    summarySheet.mergeCells('A2:D2');
    summarySheet.getCell('A2').value = 'Laporan Absensi Karyawan';
    summarySheet.getCell('A2').font = { bold: true, size: 13, color: { argb: 'FF1F2937' } };

    summarySheet.mergeCells('A3:D3');
    summarySheet.getCell('A3').value = `Diekspor: ${timestampLabel()}`;
    summarySheet.getCell('A3').font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };

    await addCompanyLogoToWorksheet(workbook, summarySheet, company, {
        col: 3.1,
        row: 0.15,
        width: 124,
        height: 54,
    });

    applyAttendanceSectionHeading(summarySheet, 5, 4, 'Filter dan Periode');
    const filterRows: Array<[string, ExportValue, string, ExportValue]> = [
        ['Periode', input.summary.periodLabel, 'Tanggal Acuan', anchorLabel],
        ['Rentang Tanggal', rangeLabel, 'Status', statusLabel],
        ['Karyawan', employeeLabel, 'Pencarian', searchLabel],
    ];

    let currentRow = 6;
    filterRows.forEach(([labelA, valueA, labelB, valueB]) => {
        summarySheet.getCell(`A${currentRow}`).value = labelA;
        summarySheet.getCell(`B${currentRow}`).value = valueA;
        summarySheet.getCell(`C${currentRow}`).value = labelB;
        summarySheet.getCell(`D${currentRow}`).value = valueB;
        applyAttendanceKeyValueStyle(summarySheet.getCell(`A${currentRow}`), summarySheet.getCell(`B${currentRow}`));
        applyAttendanceKeyValueStyle(summarySheet.getCell(`C${currentRow}`), summarySheet.getCell(`D${currentRow}`));
        currentRow += 1;
    });

    currentRow += 1;
    applyAttendanceSectionHeading(summarySheet, currentRow, 4, 'Rekap Periode');
    currentRow += 1;
    const recapSummaryRows: Array<[string, ExportValue, string, ExportValue]> = [
        ['Karyawan Aktif', input.summary.activeEmployeeCount, 'Tercatat', input.summary.recordedEmployeeCount],
        ['Belum Tercatat', input.summary.unrecordedEmployeeCount, 'Total Record', input.summary.totalRecords],
        ['Hadir Normal', Math.max(input.summary.presentCount - input.summary.earlyLeaveCount, 0), 'Pulang Lebih Awal', input.summary.earlyLeaveCount],
        ['Izin', input.summary.permissionCount, 'Sakit', input.summary.sickCount],
        ['Cuti', input.summary.leaveCount, 'Alpha', input.summary.absentCount],
        ['Libur', input.summary.offCount, '', ''],
    ];
    recapSummaryRows.forEach(([labelA, valueA, labelB, valueB]) => {
        summarySheet.getCell(`A${currentRow}`).value = labelA;
        summarySheet.getCell(`B${currentRow}`).value = valueA;
        summarySheet.getCell(`C${currentRow}`).value = labelB;
        summarySheet.getCell(`D${currentRow}`).value = valueB;
        applyAttendanceKeyValueStyle(summarySheet.getCell(`A${currentRow}`), summarySheet.getCell(`B${currentRow}`));
        applyAttendanceKeyValueStyle(summarySheet.getCell(`C${currentRow}`), summarySheet.getCell(`D${currentRow}`));
        currentRow += 1;
    });

    if (input.summary.pendingEmployees.length > 0) {
        currentRow += 1;
        applyAttendanceSectionHeading(summarySheet, currentRow, 4, 'Karyawan Belum Tercatat');
        currentRow += 1;
        const pendingHeader = summarySheet.getRow(currentRow);
        pendingHeader.values = ['Kode', 'Nama', 'Divisi', 'Jabatan'];
        applyAttendanceTableHeaderStyle(pendingHeader);
        currentRow += 1;

        input.summary.pendingEmployees.forEach((employee) => {
            const row = summarySheet.getRow(currentRow);
            row.values = [
                employee.employeeCode || '-',
                employee.name || '-',
                employee.division || '-',
                employee.position || '-',
            ];
            applyAttendanceBodyBorder(row);
            currentRow += 1;
        });
    }

    summarySheet.views = [{ state: 'frozen', ySplit: 5 }];

    const recapSheet = workbook.addWorksheet(sanitizeSheetName('Rekap Karyawan'));
    recapSheet.columns = [
        { key: 'employeeCode', width: 16 },
        { key: 'employeeName', width: 26 },
        { key: 'division', width: 18 },
        { key: 'position', width: 22 },
        { key: 'recordedDays', width: 14 },
        { key: 'presentCount', width: 12 },
        { key: 'earlyLeaveCount', width: 18 },
        { key: 'permissionCount', width: 12 },
        { key: 'sickCount', width: 12 },
        { key: 'leaveCount', width: 12 },
        { key: 'absentCount', width: 12 },
        { key: 'offCount', width: 12 },
        { key: 'lastAttendanceDate', width: 16 },
    ];

    recapSheet.addRow([
        `Rekap Absensi per Karyawan - ${input.summary.periodLabel}`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
    ]);
    recapSheet.mergeCells(1, 1, 1, 13);
    recapSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF111827' } };

    recapSheet.addRow([
        `Rentang: ${rangeLabel} | Status: ${statusLabel} | Karyawan: ${employeeLabel} | Cari: ${searchLabel}`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
    ]);
    recapSheet.mergeCells(2, 1, 2, 13);
    recapSheet.getCell('A2').font = { size: 10, color: { argb: 'FF4B5563' } };

    const recapHeaderRow = recapSheet.addRow([
        'Kode Karyawan',
        'Nama Karyawan',
        'Divisi',
        'Jabatan',
        'Hari Tercatat',
        'Hadir Normal',
        'Pulang Lebih Awal',
        'Izin',
        'Sakit',
        'Cuti',
        'Alpha',
        'Libur',
        'Tanggal Terakhir',
    ]);
    applyAttendanceTableHeaderStyle(recapHeaderRow);

    if (recapEmployeeRows.length === 0) {
        const emptyRow = recapSheet.addRow(['Tidak ada rekap absensi untuk periode ini']);
        recapSheet.mergeCells(emptyRow.number, 1, emptyRow.number, 13);
        emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
    } else {
        recapEmployeeRows.forEach((row: EmployeeAttendanceRecapRow) => {
            const recapRow = recapSheet.addRow([
                row.employeeCode || '-',
                row.employeeName || '-',
                row.division || '-',
                row.position || '-',
                row.recordedDays,
                Math.max(row.presentCount - row.earlyLeaveCount, 0),
                row.earlyLeaveCount,
                row.permissionCount,
                row.sickCount,
                row.leaveCount,
                row.absentCount,
                row.offCount,
                row.lastAttendanceDate ? fmtDate(row.lastAttendanceDate) : '-',
            ]);
            applyAttendanceBodyBorder(recapRow);
        });
    }

    recapSheet.views = [{ state: 'frozen', ySplit: 3 }];
    recapSheet.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: Math.max(3, recapEmployeeRows.length + 3), column: 13 },
    };

    const detailSheet = workbook.addWorksheet(sanitizeSheetName('Detail Absensi'));
    detailSheet.columns = [
        { key: 'date', width: 16 },
        { key: 'employeeCode', width: 16 },
        { key: 'employeeName', width: 26 },
        { key: 'division', width: 18 },
        { key: 'position', width: 22 },
        { key: 'status', width: 14 },
        { key: 'checkInTime', width: 12 },
        { key: 'checkOutTime', width: 12 },
        { key: 'note', width: 30 },
        { key: 'updatedAt', width: 22 },
        { key: 'updatedByName', width: 20 },
    ];

    detailSheet.addRow([
        `Laporan Absensi ${input.summary.periodLabel}`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
    ]);
    detailSheet.mergeCells(1, 1, 1, 11);
    detailSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF111827' } };

    detailSheet.addRow([
        `Rentang: ${rangeLabel} | Status: ${statusLabel} | Karyawan: ${employeeLabel} | Cari: ${searchLabel}`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
    ]);
    detailSheet.mergeCells(2, 1, 2, 11);
    detailSheet.getCell('A2').font = { size: 10, color: { argb: 'FF4B5563' } };

    const detailHeaderRow = detailSheet.addRow([
        'Tanggal',
        'Kode Karyawan',
        'Nama Karyawan',
        'Divisi',
        'Jabatan',
        'Status',
        'Jam Masuk',
        'Jam Pulang',
        'Catatan',
        'Input Terakhir',
        'Diubah Oleh',
    ]);
    applyAttendanceTableHeaderStyle(detailHeaderRow);

    if (input.records.length === 0) {
        const emptyRow = detailSheet.addRow(['Tidak ada data absensi untuk periode ini']);
        detailSheet.mergeCells(emptyRow.number, 1, emptyRow.number, 11);
        emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
    } else {
        input.records.forEach((record) => {
            const row = detailSheet.addRow([
                fmtDate(record.date),
                record.employeeCode || '-',
                record.employeeName || '-',
                record.division || '-',
                record.position || '-',
                EMPLOYEE_ATTENDANCE_STATUS_LABELS[record.status] || record.status,
                record.checkInTime || '-',
                record.checkOutTime || '-',
                record.note || '-',
                record.updatedAt ? formatBusinessDateTime(record.updatedAt, 'id-ID', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: undefined,
                }).replace(/\./g, ':') : '-',
                record.updatedByName || record.createdByName || '-',
            ]);
            applyAttendanceBodyBorder(row);
        });
    }

    detailSheet.views = [{ state: 'frozen', ySplit: 3 }];
    detailSheet.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: Math.max(3, input.records.length + 3), column: 11 },
    };

    await downloadWorkbook(workbook, filename);
}

export async function exportToCSV(
    data: Record<string, unknown>[],
    columns: ExportColumn[],
    filename: string,
) {
    const headers = columns.map((column) => column.header);
    const rows = data.map((item) =>
        columns.map((column) => {
            const value = resolveCellValue(column, item);
            const output = textValue(value);
            if (output.includes(',') || output.includes('"') || output.includes('\n')) {
                return `"${output.replace(/"/g, '""')}"`;
            }
            return output;
        }),
    );

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export async function exportOrders(orders: Record<string, unknown>[]) {
    await exportToExcel(
        orders,
        [
            { header: 'No. Resi', key: 'masterResi', width: 20 },
            { header: 'Customer', key: 'customerName', width: 25 },
            { header: 'Penerima', key: 'receiverName', width: 20 },
            { header: 'Kategori Truk', key: 'serviceName', width: 18 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Tanggal', key: 'createdAt', width: 18, formatter: (value) => fmtDate(String(value || '')) },
        ],
        `orders-${getBusinessDateValue()}`,
        'Orders',
        { title: 'Daftar Order / Resi' },
    );
}

export async function exportInvoices(invoices: Record<string, unknown>[]) {
    const company = await fetchCompanyProfile();
    await exportToExcel(
        invoices.map((invoice) => ({
            ...invoice,
            notaDisplayNumber: formatFreightNotaDisplayNumber(
                {
                    notaNumber: String(invoice.notaNumber || ''),
                    issueDate: String(invoice.issueDate || ''),
                    notaDisplayNumber: typeof invoice.notaDisplayNumber === 'string' ? invoice.notaDisplayNumber : undefined,
                },
                company,
            ),
            netAmount: getReceivableNetAmount({
                totalAmount: numericish(invoice.totalAmount),
                totalAdjustmentAmount: numericish(invoice.totalAdjustmentAmount),
                pph23Enabled: booleanish(invoice.pph23Enabled),
                pph23RatePercent: numericish(invoice.pph23RatePercent),
                pph23BaseMode: typeof invoice.pph23BaseMode === 'string' ? invoice.pph23BaseMode : undefined,
                pph23Amount: numericish(invoice.pph23Amount),
                netAmount: numericish(invoice.netAmount),
            }),
        })),
        [
            { header: 'No. Cetak Invoice', key: 'notaDisplayNumber', width: 22 },
            { header: 'No. Invoice Internal', key: 'notaNumber', width: 22 },
            { header: 'Customer', key: 'customerName', width: 28 },
            { header: 'Tanggal', key: 'issueDate', width: 18, formatter: (value) => fmtDate(String(value || '')) },
            { header: 'Jatuh Tempo', key: 'dueDate', width: 18, formatter: (value) => value ? fmtDate(String(value)) : '-' },
            { header: 'Total Collie', key: 'totalCollie', width: 14 },
            {
                header: 'Dasar Invoice',
                key: 'totalWeightKg',
                width: 18,
                formatter: (value, row) => formatFreightNotaDisplayWeight({
                    beratKg: value,
                    volumeM3: row.totalVolumeM3,
                    billingMode: normalizeFreightNotaBillingMode(row.billingMode),
                    includeCanonical: false,
                }),
            },
            { header: 'Berat Final Sistem (Kg)', key: 'totalWeightKg', width: 20 },
            { header: 'PPh 23', key: 'pph23Amount', width: 16, formatter: (value) => fmtCurrency(parseFormattedNumberish(value || 0)) },
            { header: 'Invoice Transfer Final', key: 'netAmount', width: 20 },
            { header: 'Status', key: 'status', width: 14 },
        ],
        `invoice-ongkos-${getBusinessDateValue()}`,
        'Invoice Ongkos',
        {
            title: 'Daftar Invoice Ongkos Angkut',
            company,
            totalRow: {
                label: 'TOTAL',
                values: {
                    totalCollie: invoices.reduce((sum, item) => sum + parseFormattedNumberish(item.totalCollie || 0), 0),
                    totalWeightKg: invoices.reduce((sum, item) => sum + parseFormattedNumberish(item.totalWeightKg || 0), 0),
                    pph23Amount: invoices.reduce((sum, item) => sum + parseFormattedNumberish(item.pph23Amount || 0), 0),
                    netAmount: invoices.reduce((sum, item) => sum + getReceivableNetAmount({
                        totalAmount: numericish(item.totalAmount),
                        totalAdjustmentAmount: numericish(item.totalAdjustmentAmount),
                        pph23Enabled: booleanish(item.pph23Enabled),
                        pph23RatePercent: numericish(item.pph23RatePercent),
                        pph23BaseMode: typeof item.pph23BaseMode === 'string' ? item.pph23BaseMode : undefined,
                        pph23Amount: numericish(item.pph23Amount),
                        netAmount: numericish(item.netAmount),
                    }), 0),
                },
            },
        },
    );
}

export async function exportExpenses(expenses: Record<string, unknown>[]) {
    await exportToExcel(
        expenses.map((expense) => {
            const accountLabel = typeof expense.accountLabel === 'string' && expense.accountLabel
                ? expense.accountLabel
                : expense.bankAccountName
                    ? `${String(expense.bankAccountName)}${expense.bankAccountNumber ? ` - ${String(expense.bankAccountNumber)}` : ''}`
                    : '';
            const vehicleLabel = typeof expense.vehicleLabel === 'string' && expense.vehicleLabel
                ? expense.vehicleLabel
                : expense.relatedVehiclePlate
                    ? String(expense.relatedVehiclePlate)
                    : '';
            const descriptionLabel = typeof expense.descriptionLabel === 'string' && expense.descriptionLabel
                ? expense.descriptionLabel
                : expense.note || expense.description || '';

            return {
                ...expense,
                descriptionLabel,
                accountLabel,
                vehicleLabel,
            };
        }),
        [
            { header: 'Tanggal', key: 'date', width: 18, formatter: (value) => fmtDate(String(value || '')) },
            { header: 'Kategori', key: 'categoryName', width: 22 },
            { header: 'Deskripsi', key: 'descriptionLabel', width: 35 },
            { header: 'Kendaraan', key: 'vehicleLabel', width: 18 },
            { header: 'Rekening / Kas', key: 'accountLabel', width: 28 },
            { header: 'Jumlah', key: 'amount', width: 18 },
            { header: 'Privasi', key: 'privacyLevel', width: 14 },
        ],
        `expenses-${getBusinessDateValue()}`,
        'Expenses',
        {
            title: 'Daftar Pengeluaran',
            totalRow: {
                label: 'TOTAL',
                values: {
                    amount: expenses.reduce((sum, item) => sum + parseFormattedNumberish(item.amount || 0), 0),
                },
            },
        },
    );
}

export async function exportVehicles(vehicles: Record<string, unknown>[]) {
    await exportToExcel(
        vehicles,
        [
            { header: 'Kode', key: 'unitCode', width: 12 },
            { header: 'Plat Nomor', key: 'plateNumber', width: 16 },
            { header: 'Merk/Model', key: 'brandModel', width: 25 },
            { header: 'Ukuran', key: 'size', width: 16 },
            { header: 'Dimensi', key: 'dimension', width: 20 },
            { header: 'Kapasitas Min', key: 'capacityMin', width: 18 },
            { header: 'Kapasitas Maks', key: 'capacityMax', width: 18 },
            { header: 'Kategori Armada', key: 'serviceName', width: 20 },
            { header: 'Tipe', key: 'vehicleType', width: 12 },
            { header: 'Tahun', key: 'year', width: 8 },
            { header: 'Tanggal Masuk Unit', key: 'registeredDate', width: 18 },
            { header: 'Kepemilikan', key: 'ownershipType', width: 18 },
            { header: 'Pemilik Mitra', key: 'partnerOwnerName', width: 24 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Odometer', key: 'lastOdometer', width: 14 },
        ],
        `vehicles-${getBusinessDateValue()}`,
        'Vehicles',
        { title: 'Daftar Kendaraan' },
    );
}

export async function exportFreightNotaDetail(
    nota: FreightNota,
    items: FreightNotaItem[],
    company?: CompanyProfile | null,
    invoiceBankAccounts: InvoiceInstructionAccount[] = [],
) {
    const resolvedCompany = company ?? await fetchCompanyProfile();
    const issuerProfile = resolveFreightNotaIssuerProfile(nota, resolvedCompany);
    const issuerBranding = resolveDocumentIssuerProfile(nota, resolvedCompany);
    const displayNumber = formatFreightNotaDisplayNumber(nota, resolvedCompany);
    const billingMode = normalizeFreightNotaBillingMode(nota.billingMode);
    const grossAmount = parseFormattedNumberish(nota.totalAmount || 0);
    const adjustmentAmount = parseFormattedNumberish(nota.totalAdjustmentAmount || 0);
    const pph23Summary = calculatePph23Summary({
        grossAmount,
        claimAmount: adjustmentAmount,
        enabled: nota.pph23Enabled,
        ratePercent: nota.pph23RatePercent,
        baseMode: nota.pph23BaseMode,
    });
    const netAmount = getReceivableNetAmount(nota);
    const groupedRows = items.reduce<Array<{
        vehiclePlate: string;
        date: string;
        entries: Array<{
            noSJ: string;
            dari: string;
            tujuan: string;
            barang: string;
            collie: string | number;
            billedWeight: string;
            tarip: string | number;
            uangRp: string | number;
            plt: string;
            pc: string;
            k: string;
            kbl: string;
            invoiceLineDate: string;
        }>;
    }>>((groups, item) => {
        const vehiclePlate = item.vehiclePlate || '';
        const date = fmtDate(item.date || '');
        const key = `${vehiclePlate}__${date}`;
        const existing = groups.find((group) => `${group.vehiclePlate}__${group.date}` === key);
        const entry = {
            noSJ: item.noSJ || '',
            dari: item.dari || '',
            tujuan: item.tujuan || '',
            barang: item.barang || '',
            collie: parseFormattedNumberish(item.collie || 0) || '',
            billedWeight: formatFreightNotaDisplayWeight({
                beratKg: item.beratKg || 0,
                volumeM3: item.volumeM3 || 0,
                billingMode,
                includeCanonical: false,
            }),
            tarip: item.tarip ? fmtNumber(parseFormattedNumberish(item.tarip)) : '',
            uangRp: item.uangRp ? fmtNumber(parseFormattedNumberish(item.uangRp)) : '',
            plt: item.plt || '',
            pc: item.pc || '',
            k: item.k || '',
            kbl: item.kbl || '',
            invoiceLineDate: item.invoiceLineDate ? fmtDate(item.invoiceLineDate) : '',
        };

        if (existing) {
            existing.entries.push(entry);
            return groups;
        }

        groups.push({
            vehiclePlate,
            date,
            entries: [entry],
        });
        return groups;
    }, []);

    const rows: ExportValue[][] = [];
    const merges: MergeRange[] = [];
    const totalColumns = 15;
    const companyLine = [issuerProfile.phone ? `TELP. ${issuerProfile.phone}` : '', issuerProfile.email ? `EMAIL : ${issuerProfile.email}` : '']
        .filter(Boolean)
        .join('  ');
    const invoiceInstructionLines = resolveInvoiceInstructionAccounts(resolvedCompany, invoiceBankAccounts, nota.instructionAccounts || [])
        .map(buildInvoiceInstructionAccountText);
    const extraNote = [nota.footerNote || resolvedCompany?.invoiceSettings?.footerNote, nota.notes].filter(Boolean).join(' ');

    rows.push(['', '', issuerProfile.name, '', '', `PERINCIAN ONGKOS ANGKUT NO.${displayNumber}`, '', '', '', '', 'TGL CETAK', timestampLabel()]);
    merges.push({ startRow: 1, startCol: 3, endRow: 1, endCol: 5 });
    merges.push({ startRow: 1, startCol: 6, endRow: 1, endCol: 10 });

    rows.push(['', '', issuerProfile.address || '', '', '', 'KEPADA YANG TERHORMAT :']);
    merges.push({ startRow: 2, startCol: 3, endRow: 2, endCol: 5 });
    merges.push({ startRow: 2, startCol: 6, endRow: 2, endCol: 14 });

    rows.push(['', '', companyLine, '', '', nota.customerName]);
    merges.push({ startRow: 3, startCol: 3, endRow: 3, endCol: 5 });
    merges.push({ startRow: 3, startCol: 6, endRow: 3, endCol: 14 });

    rows.push([]);

    const headerRowIndex = rows.length + 1;
    rows.push(['NO.TRUCK', 'TANGGAL', 'NO. SJ', 'DARI', 'TUJUAN', 'BARANG', 'COLLIE', getFreightNotaWeightColumnLabel(billingMode), getFreightNotaRateColumnLabel(billingMode), 'UANG RP.', 'PLT', 'PC', 'K', 'KBL', 'TGL']);

    groupedRows.forEach((group) => {
        const groupStartRow = rows.length + 1;
        group.entries.forEach((entry, index) => {
            rows.push([
                index === 0 ? group.vehiclePlate : '',
                index === 0 ? group.date : '',
                entry.noSJ,
                entry.dari,
                entry.tujuan,
                entry.barang,
                entry.collie,
                entry.billedWeight,
                entry.tarip,
                entry.uangRp,
                entry.plt,
                entry.pc,
                entry.k,
                entry.kbl,
                entry.invoiceLineDate,
            ]);
        });

        const groupEndRow = rows.length;
        if (groupEndRow > groupStartRow) {
            merges.push({ startRow: groupStartRow, startCol: 1, endRow: groupEndRow, endCol: 1 });
            merges.push({ startRow: groupStartRow, startCol: 2, endRow: groupEndRow, endCol: 2 });
        }
    });

    const fillerCount = Math.max(13 - items.length, 0);
    for (let i = 0; i < fillerCount; i += 1) {
        rows.push(Array.from({ length: totalColumns }, () => ''));
    }

    const totalRowIndex = rows.length + 1;
    rows.push([
        'Jumlah',
        '',
        '',
        '',
        '',
        '',
        parseFormattedNumberish(nota.totalCollie || 0) || 0,
        formatFreightNotaDisplayWeight({
            beratKg: nota.totalWeightKg || 0,
            volumeM3: nota.totalVolumeM3 || 0,
            billingMode,
            includeCanonical: false,
        }),
        '',
        nota.totalAmount ? fmtNumber(parseFormattedNumberish(nota.totalAmount)) : 0,
        '',
        '',
        '',
        '',
        '',
    ]);
    merges.push({ startRow: totalRowIndex, startCol: 1, endRow: totalRowIndex, endCol: 6 });

    if (adjustmentAmount > 0) {
        const adjustmentRowIndex = rows.length + 1;
        rows.push(['Potongan / Klaim', '', '', '', '', '', '', '', '', fmtNumber(adjustmentAmount), '', '', '', '', '']);
        merges.push({ startRow: adjustmentRowIndex, startCol: 1, endRow: adjustmentRowIndex, endCol: 9 });
    }

    if (pph23Summary.amount > 0) {
        const pph23RowIndex = rows.length + 1;
        rows.push([buildPph23Label({
            enabled: pph23Summary.enabled,
            ratePercent: pph23Summary.ratePercent,
            baseMode: pph23Summary.baseMode,
        }), '', '', '', '', '', '', '', '', fmtNumber(pph23Summary.amount), '', '', '', '', '']);
        merges.push({ startRow: pph23RowIndex, startCol: 1, endRow: pph23RowIndex, endCol: 9 });
    }

    const transferRowIndex = rows.length + 1;
    rows.push(['Invoice Transfer Final', '', '', '', '', '', '', '', '', fmtNumber(netAmount), '', '', '', '', '']);
    merges.push({ startRow: transferRowIndex, startCol: 1, endRow: transferRowIndex, endCol: 9 });

    rows.push([]);
    rows.push(['NOTE : ONGKOS ANGKUTAN HARAP DITRANSFER KE :']);
    merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });

    invoiceInstructionLines.forEach(line => {
        rows.push([line]);
        merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });
    });

    if (extraNote) {
        rows.push([extraNote]);
        merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });
    }

    rows.push([`NO. SISTEM : ${nota.notaNumber}`]);
    merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = issuerProfile.name;
    workbook.company = issuerProfile.name;
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = `Invoice ${displayNumber}`;
    workbook.title = `Perincian Ongkos Angkut ${displayNumber}`;

    const worksheet = workbook.addWorksheet(sanitizeSheetName('Invoice Detail'));
    addRows(worksheet, rows);
    applyMerges(worksheet, merges);
    const logoPlaced = await addCompanyLogoToWorksheet(workbook, worksheet, issuerBranding, {
        col: 0.1,
        row: 0.1,
        width: 88,
        height: 44,
    });
    if (logoPlaced) {
        worksheet.getRow(1).height = Math.max(worksheet.getRow(1).height || 0, 28);
        worksheet.getRow(2).height = Math.max(worksheet.getRow(2).height || 0, 22);
        worksheet.getRow(3).height = Math.max(worksheet.getRow(3).height || 0, 20);
    }

    const columnWidths = [14, 12, 20, 16, 16, 16, 8, 12, 12, 14, 8, 8, 8, 8, 12];
    columnWidths.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
    });

    worksheet.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: Math.max(headerRowIndex + Math.max(items.length, 1) - 1, headerRowIndex), column: totalColumns },
    };

    const numberColumns = new Set([7, 10]);
    rows.forEach((row, rowIndex) => {
        row.forEach((value, colIndex) => {
            assignCellValue(worksheet, rowIndex + 1, colIndex, value);
            const cell = worksheet.getRow(rowIndex + 1).getCell(colIndex + 1);
            if (numberColumns.has(colIndex + 1) && typeof value === 'number') {
                cell.numFmt = '#,##0';
            }
        });
    });

    await downloadWorkbook(workbook, `invoice-${displayNumber}`);
}
