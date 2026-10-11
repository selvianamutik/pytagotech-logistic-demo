import { getReceivableNetAmount } from './utils';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';

export interface DashboardAttentionTrip {
    _id: string;
    doNumber?: string;
    masterResi?: string;
    driverName?: string;
    vehiclePlate?: string;
    date?: string;
    status?: string;
    attentionKind: 'unfinished' | 'unclosed' | 'approval';
    pendingLabel?: string;
    pendingRequestedAt?: string;
    pendingRequestedByName?: string;
}

export interface DashboardAttentionIncident {
    _id: string;
    incidentNumber?: string;
    vehiclePlate?: string;
    driverName?: string;
    status?: string;
    pendingLabel?: string;
    draftSettlementCount?: number;
}

export interface DashboardAttention {
    trips: { total: number; items: DashboardAttentionTrip[] };
    tripApprovals: { total: number; items: DashboardAttentionTrip[] };
    incidentApprovals: { total: number; items: DashboardAttentionIncident[] };
}

export const DASHBOARD_ATTENTION_LIMIT = 5;

export function emptyDashboardAttention(): DashboardAttention {
    return {
        trips: { total: 0, items: [] },
        tripApprovals: { total: 0, items: [] },
        incidentApprovals: { total: 0, items: [] },
    };
}

export type DashboardAttentionTripSource = {
    _id: string;
    status?: string;
    tripClosedByAdminAt?: string | null;
    doNumber?: string;
    masterResi?: string;
    driverName?: string;
    vehiclePlate?: string;
    date?: string;
    pendingDriverStatus?: string | null;
    pendingDriverStatusRequestedAt?: string;
    pendingDriverStatusRequestedByName?: string;
    pendingDriverRequests?: Array<{
        requestId?: string;
        status?: string;
        requestedAt?: string;
        requestedByName?: string;
    } | null> | null;
    tripEndOdometerKm?: number | null;
    odometerConfirmedAt?: string | null;
};

function getValidDriverRequests(source: DashboardAttentionTripSource) {
    return (Array.isArray(source.pendingDriverRequests) ? source.pendingDriverRequests : [])
        .filter((request): request is NonNullable<typeof request> & { requestId: string; status: string } => Boolean(request && request.requestId && request.status));
}

export function getTripApprovalInfo(source: DashboardAttentionTripSource): Pick<DashboardAttentionTrip, 'pendingLabel' | 'pendingRequestedAt' | 'pendingRequestedByName'> | null {
    if (source.pendingDriverStatus) {
        return {
            pendingLabel: `Menunggu approval status: ${source.pendingDriverStatus}`,
            pendingRequestedAt: source.pendingDriverStatusRequestedAt,
            pendingRequestedByName: source.pendingDriverStatusRequestedByName,
        };
    }
    const requests = getValidDriverRequests(source);
    if (requests.length > 0) {
        const [first] = requests;
        return {
            pendingLabel: requests.length > 1 ? `${requests.length} pengajuan driver menunggu` : 'Pengajuan driver menunggu',
            pendingRequestedAt: first.requestedAt,
            pendingRequestedByName: first.requestedByName,
        };
    }
    if (typeof source.tripEndOdometerKm === 'number' && source.tripEndOdometerKm > 0 && !source.odometerConfirmedAt) {
        return { pendingLabel: 'Odometer akhir menunggu konfirmasi' };
    }
    return null;
}

export function getTripOpenKind(source: DashboardAttentionTripSource): 'unfinished' | 'unclosed' | null {
    if (!source || source.status === 'CANCELLED' || source.tripClosedByAdminAt) {
        return null;
    }
    if (source.status === 'DELIVERED') {
        return 'unclosed';
    }
    return 'unfinished';
}

export function toDashboardAttentionTrip(source: DashboardAttentionTripSource, attentionKind: DashboardAttentionTrip['attentionKind']): DashboardAttentionTrip {
    const approval = attentionKind === 'approval' ? getTripApprovalInfo(source) : null;
    return {
        _id: source._id,
        doNumber: source.doNumber,
        masterResi: source.masterResi,
        driverName: source.driverName,
        vehiclePlate: source.vehiclePlate,
        date: source.date,
        status: source.status,
        attentionKind,
        pendingLabel: approval?.pendingLabel,
        pendingRequestedAt: approval?.pendingRequestedAt,
        pendingRequestedByName: approval?.pendingRequestedByName,
    };
}

export type DashboardAttentionIncidentSource = {
    _id: string;
    incidentNumber?: string;
    vehiclePlate?: string;
    driverName?: string;
    status?: string;
    dateTime?: string;
    pendingDriverResolutionRequestedAt?: string;
    pendingDriverResolutionRequestedByName?: string;
};

export function getIncidentApprovalInfo(
    source: DashboardAttentionIncidentSource,
    draftSettlementCount: number,
): Pick<DashboardAttentionIncident, 'pendingLabel' | 'draftSettlementCount'> | null {
    const parts: string[] = [];
    if (source.pendingDriverResolutionRequestedAt) {
        parts.push('Pengajuan selesai driver menunggu persetujuan');
    }
    if (draftSettlementCount > 0) {
        parts.push(`${draftSettlementCount} baris settlement menunggu approval`);
    }
    if (parts.length === 0) {
        return null;
    }
    return { pendingLabel: parts.join(' · '), draftSettlementCount };
}

function compareOptionalDateAsc(left?: string, right?: string) {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? -1 : left > right ? 1 : 0;
}

export function buildDashboardAttention(
    deliveryOrders: DashboardAttentionTripSource[],
    incidents: DashboardAttentionIncidentSource[],
    draftSettlementLines: Array<{ incidentRef?: string }>,
): DashboardAttention {
    const tripApprovalItems: DashboardAttentionTrip[] = deliveryOrders
        .map(row => ({ row, approval: getTripApprovalInfo(row) }))
        .filter(entry => entry.approval !== null)
        .sort((left, right) => compareOptionalDateAsc(left.row.date, right.row.date))
        .map(entry => toDashboardAttentionTrip(entry.row, 'approval'));
    // Approval trips live only in the approvals bucket so the two trip cards
    // never double-count the same trip.
    const approvalIds = new Set(tripApprovalItems.map(item => item._id));
    const openTripItems: DashboardAttentionTrip[] = deliveryOrders
        .map(row => ({ row, kind: getTripOpenKind(row) }))
        .filter(entry => entry.kind !== null && !approvalIds.has(entry.row._id))
        .sort((left, right) => compareOptionalDateAsc(left.row.date, right.row.date))
        .map(entry => toDashboardAttentionTrip(entry.row, entry.kind as 'unfinished' | 'unclosed'));
    const draftSettlementCountByIncidentRef = new Map<string, number>();
    for (const line of draftSettlementLines) {
        if (!line.incidentRef) continue;
        draftSettlementCountByIncidentRef.set(line.incidentRef, (draftSettlementCountByIncidentRef.get(line.incidentRef) || 0) + 1);
    }
    const incidentApprovalItems: DashboardAttentionIncident[] = incidents
        .map(incident => ({
            incident,
            info: getIncidentApprovalInfo(incident, draftSettlementCountByIncidentRef.get(incident._id) || 0),
        }))
        .filter(entry => entry.info !== null)
        .sort((left, right) => compareOptionalDateAsc(left.incident.dateTime, right.incident.dateTime))
        .map(entry => ({
            _id: entry.incident._id,
            incidentNumber: entry.incident.incidentNumber,
            vehiclePlate: entry.incident.vehiclePlate,
            driverName: entry.incident.driverName,
            status: entry.incident.status,
            pendingLabel: entry.info?.pendingLabel,
            draftSettlementCount: entry.info?.draftSettlementCount,
        }));
    return {
        trips: { total: openTripItems.length, items: openTripItems.slice(0, DASHBOARD_ATTENTION_LIMIT) },
        tripApprovals: { total: tripApprovalItems.length, items: tripApprovalItems.slice(0, DASHBOARD_ATTENTION_LIMIT) },
        incidentApprovals: { total: incidentApprovalItems.length, items: incidentApprovalItems.slice(0, DASHBOARD_ATTENTION_LIMIT) },
    };
}

export interface DashboardData {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    attention: DashboardAttention;
    recentOrders: Array<{ _id: string; masterResi: string; customerName: string; status: string; createdAt: string }>;
    recentNotas: Array<{
        _id: string;
        notaNumber: string;
        customerName: string;
        status: string;
        totalAmount: number;
        totalAdjustmentAmount?: number;
        pph23Enabled?: boolean;
        pph23RatePercent?: number;
        pph23BaseMode?: 'BEFORE_CLAIM' | 'AFTER_CLAIM';
        pph23Amount?: number;
        netAmount?: number;
    }>;
}

export function getRecentOrderAction(status: string) {
    switch (status) {
        case 'OPEN':
            return 'Buat trip pertama';
        case 'PARTIAL':
            return 'Lanjutkan sisa pengiriman';
        case 'COMPLETE':
            return 'Siap ditagih / arsip';
        default:
            return 'Buka detail order';
    }
}

export function getRecentNotaAction(nota: DashboardData['recentNotas'][number]) {
    if (nota.status === 'UNPAID') return 'Tagih atau catat penerimaan';
    if (nota.status === 'PARTIAL') return 'Follow up sisa pembayaran invoice';
    return parseFormattedNumberish(nota.totalAdjustmentAmount || 0, { maxFractionDigits: 0 }) > 0
        ? 'Arsip + cek potongan invoice'
        : 'Arsip / cetak';
}

export function getDashboardNotaNetAmount(nota: DashboardData['recentNotas'][number]) {
    return getReceivableNetAmount(nota);
}
