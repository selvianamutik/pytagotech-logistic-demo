import { escapePrintHtml } from './print';
import { getBusinessDateValue } from './business-date';
import {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatQuantity,
    INCIDENT_SETTLEMENT_CATEGORY_MAP,
    INCIDENT_SETTLEMENT_LINE_TYPE_MAP,
    INCIDENT_SETTLEMENT_STATUS_MAP,
    INCIDENT_STATUS_MAP,
    INCIDENT_TYPE_MAP,
    URGENCY_MAP,
} from './utils';
import type {
    Incident,
    IncidentActionLog,
    IncidentSettlementCategory,
    IncidentExpenseRoute,
    IncidentSettlementLine,
    IncidentSettlementLineStatus,
    IncidentSettlementLineType,
} from './types';

const INCIDENT_NEXT_STATUS_MAP: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED'],
    RESOLVED: ['CLOSED'],
};
const INCIDENT_SETTLEMENT_NEXT_STATUS_MAP: Record<IncidentSettlementLineStatus, IncidentSettlementLineStatus[]> = {
    DRAFT: ['APPROVED', 'VOID'],
    APPROVED: ['VOID', 'POSTED'],
    POSTED: [],
    VOID: [],
};

const INCIDENT_SETTLEMENT_CATEGORY_OPTIONS: Record<IncidentSettlementLineType, IncidentSettlementCategory[]> = {
    COST: ['TOWING', 'REPAIR', 'SPAREPART', 'TIRE', 'MEDICAL', 'THIRD_PARTY_DAMAGE', 'ADMINISTRATION', 'ACCOMMODATION', 'CARGO_HANDLING', 'OTHER'],
    COMPENSATION: ['COMPENSATION_DRIVER', 'COMPENSATION_CREW', 'COMPENSATION_THIRD_PARTY', 'COMPENSATION_FAMILY', 'OTHER'],
    RECOVERY: ['INSURANCE_CLAIM', 'THIRD_PARTY_RECOVERY', 'VENDOR_RECOVERY', 'INTERNAL_RECOVERY', 'OTHER'],
};

export function sortIncidentActionLogs(logs: IncidentActionLog[]) {
    return [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function getAvailableIncidentStatuses(status: Incident['status']) {
    return INCIDENT_NEXT_STATUS_MAP[status] || [];
}

export function hasUnsettledIncidentSettlementLines(lines: IncidentSettlementLine[]) {
    return lines.some(line => line.status !== 'POSTED' && line.status !== 'VOID');
}

export function getAvailableIncidentStatusesForContext(
    status: Incident['status']
) {
    return getAvailableIncidentStatuses(status);
}

export function sortIncidentSettlementLines(lines: IncidentSettlementLine[]) {
    return [...lines].sort((left, right) => {
        const dateCompare = String(right.date || '').localeCompare(String(left.date || ''));
        if (dateCompare !== 0) return dateCompare;
        return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    });
}

export function getIncidentSettlementCategoryOptions(lineType: IncidentSettlementLineType) {
    return INCIDENT_SETTLEMENT_CATEGORY_OPTIONS[lineType];
}

export function getAvailableIncidentSettlementStatuses(line: IncidentSettlementLine) {
    const nextStatuses = INCIDENT_SETTLEMENT_NEXT_STATUS_MAP[line.status] || [];
    if (line.lineType !== 'RECOVERY') {
        return nextStatuses.filter(status => status !== 'POSTED');
    }
    return nextStatuses;
}

export function canEditIncidentSettlementLine(line: IncidentSettlementLine) {
    return line.status === 'DRAFT' || line.status === 'APPROVED';
}

export function canDeleteIncidentSettlementLine(line: IncidentSettlementLine) {
    return (line.status === 'DRAFT' || line.status === 'APPROVED') && !line.linkedExpenseRef;
}

export function canPostIncidentSettlementLine(line: IncidentSettlementLine) {
    return line.lineType !== 'RECOVERY' && line.status === 'APPROVED' && !line.linkedExpenseRef;
}

export function canMarkIncidentRecoveryPosted(line: IncidentSettlementLine) {
    return line.lineType === 'RECOVERY' && line.status === 'APPROVED';
}

export function createDefaultIncidentSettlementForm() {
    return {
        lineType: 'COST' as IncidentSettlementLineType,
        category: 'TOWING' as IncidentSettlementCategory,
        date: getBusinessDateValue(),
        amount: 0,
        description: '',
        payeeName: '',
        recipientType: '',
        note: '',
    };
}

export function createDefaultIncidentExpensePostForm() {
    return {
        date: getBusinessDateValue(),
        incidentExpenseRoute: '' as IncidentExpenseRoute | '',
        categoryRef: '',
        bankAccountRef: '',
        note: '',
        description: '',
    };
}

export function summarizeIncidentSettlements(lines: IncidentSettlementLine[]) {
    return lines.reduce(
        (summary, line) => {
            if (line.status === 'VOID') {
                summary.voidCount += 1;
                return summary;
            }

            if (line.lineType === 'RECOVERY') {
                summary.totalRecovery += line.amount || 0;
                if (line.status === 'POSTED') {
                    summary.postedRecovery += line.amount || 0;
                } else {
                    summary.pendingRecovery += line.amount || 0;
                }
                return summary;
            }

            if (line.lineType === 'COMPENSATION') {
                summary.totalCompensation += line.amount || 0;
            } else {
                summary.totalCost += line.amount || 0;
            }

            if (line.status === 'POSTED') {
                summary.postedCost += line.amount || 0;
            } else {
                summary.openCost += line.amount || 0;
            }

            return summary;
        },
        {
            totalCost: 0,
            totalCompensation: 0,
            totalRecovery: 0,
            postedCost: 0,
            postedRecovery: 0,
            openCost: 0,
            pendingRecovery: 0,
            voidCount: 0,
        }
    );
}

export function buildIncidentPrintHtml(
    incident: Incident,
    logs: IncidentActionLog[],
    settlementLines: IncidentSettlementLine[] = []
) {
    const incidentNumber = escapePrintHtml(incident.incidentNumber);
    const incidentDateTime = escapePrintHtml(formatDateTime(incident.dateTime));
    const incidentType = escapePrintHtml(INCIDENT_TYPE_MAP[incident.incidentType] || incident.incidentType);
    const incidentStatus = escapePrintHtml(INCIDENT_STATUS_MAP[incident.status]?.label || incident.status);
    const urgency = escapePrintHtml(URGENCY_MAP[incident.urgency]?.label || incident.urgency);
    const vehiclePlate = escapePrintHtml(incident.vehiclePlate || '-');
    const driverName = escapePrintHtml(incident.driverName || '-');
    const odometerLabel = escapePrintHtml(`${incident.odometer ? formatQuantity(incident.odometer, 0) : '-'} km`);
    const locationText = escapePrintHtml(incident.locationText || '-');
    const relatedDONumber = incident.relatedDONumber ? escapePrintHtml(incident.relatedDONumber) : '';
    const description = escapePrintHtml(incident.description || '-');
    const settlementSummary = summarizeIncidentSettlements(settlementLines);
    const settlementRows = settlementLines.length > 0
        ? sortIncidentSettlementLines(settlementLines).map(item => `
            <tr>
                <td>${escapePrintHtml(formatDate(item.date))}</td>
                <td>${escapePrintHtml(INCIDENT_SETTLEMENT_LINE_TYPE_MAP[item.lineType]?.label || item.lineType)}</td>
                <td>${escapePrintHtml(INCIDENT_SETTLEMENT_CATEGORY_MAP[item.category] || item.category)}</td>
                <td>${escapePrintHtml(item.description || '-')}</td>
                <td>${escapePrintHtml(item.payeeName || '-')}</td>
                <td>${escapePrintHtml(INCIDENT_SETTLEMENT_STATUS_MAP[item.status]?.label || item.status)}</td>
                <td class="r">${escapePrintHtml(formatCurrency(item.amount))}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="7" class="c">Belum ada detail biaya / santunan insiden</td></tr>';
    const logRows = logs.length > 0
        ? logs.map(item => `
            <tr>
                <td>${escapePrintHtml(formatDateTime(item.timestamp))}</td>
                <td>${escapePrintHtml(item.note || '-')}</td>
                <td>${escapePrintHtml(item.userName || '-')}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" class="c">Belum ada log penanganan</td></tr>';

    return `
        <div style="margin-bottom:16px">
            <table style="width:100%;border:none"><tbody>
                <tr>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">No. Insiden</td>
                    <td style="border:none;padding:2px 8px">${incidentNumber}</td>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">Waktu</td>
                    <td style="border:none;padding:2px 8px">${incidentDateTime}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Tipe</td>
                    <td style="border:none;padding:2px 8px">${incidentType}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Status</td>
                    <td style="border:none;padding:2px 8px">${incidentStatus}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Urgensi</td>
                    <td style="border:none;padding:2px 8px">${urgency}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                    <td style="border:none;padding:2px 8px">${vehiclePlate}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Driver</td>
                    <td style="border:none;padding:2px 8px">${driverName}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Odometer</td>
                    <td style="border:none;padding:2px 8px">${odometerLabel}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Lokasi</td>
                    <td colspan="3" style="border:none;padding:2px 8px">${locationText}</td>
                </tr>
                ${relatedDONumber ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">DO Terkait</td><td colspan="3" style="border:none;padding:2px 8px">${relatedDONumber}</td></tr>` : ''}
            </tbody></table>
        </div>
        <div class="section-title">Kronologi</div>
        <div style="line-height:1.7;color:#334155">${description}</div>
        <div class="section-title">Ringkasan Finansial Insiden</div>
        <table>
            <tbody>
                <tr><td>Total Biaya Operasional</td><td class="r">${escapePrintHtml(formatCurrency(settlementSummary.totalCost))}</td></tr>
                <tr><td>Total Santunan</td><td class="r">${escapePrintHtml(formatCurrency(settlementSummary.totalCompensation))}</td></tr>
                <tr><td>Total Recovery</td><td class="r">${escapePrintHtml(formatCurrency(settlementSummary.totalRecovery))}</td></tr>
                <tr><td>Biaya Sudah Diposting</td><td class="r">${escapePrintHtml(formatCurrency(settlementSummary.postedCost))}</td></tr>
                <tr><td>Biaya Belum Diposting</td><td class="r">${escapePrintHtml(formatCurrency(settlementSummary.openCost))}</td></tr>
                <tr><td>Recovery Sudah Diterima</td><td class="r">${escapePrintHtml(formatCurrency(settlementSummary.postedRecovery))}</td></tr>
                <tr><td>Recovery Belum Diterima</td><td class="r">${escapePrintHtml(formatCurrency(settlementSummary.pendingRecovery))}</td></tr>
                <tr>
                    <td style="font-weight:700">Net Exposure</td>
                    <td class="r" style="font-weight:700">${escapePrintHtml(formatCurrency((settlementSummary.totalCost + settlementSummary.totalCompensation) - settlementSummary.postedRecovery))}</td>
                </tr>
            </tbody>
        </table>
        <div class="section-title">Detail Biaya / Santunan / Recovery</div>
        <table>
            <thead>
                <tr>
                    <th>Tanggal</th>
                    <th>Tipe</th>
                    <th>Kategori</th>
                    <th>Deskripsi</th>
                    <th>Pihak</th>
                    <th>Status</th>
                    <th class="r">Nominal</th>
                </tr>
            </thead>
            <tbody>
                ${settlementRows}
            </tbody>
        </table>
        <div class="section-title">Timeline Penanganan</div>
        <table>
            <thead>
                <tr>
                    <th>Waktu</th>
                    <th>Catatan</th>
                    <th>Petugas</th>
                </tr>
            </thead>
            <tbody>
                ${logRows}
            </tbody>
        </table>
    `;
}
