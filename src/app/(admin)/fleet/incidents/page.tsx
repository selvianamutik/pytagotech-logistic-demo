'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp, useToast } from '../../layout';
import { Plus, Search, Eye, AlertTriangle, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import Combobox from '@/components/Combobox';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { fetchAdminCollectionData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
    buildIncidentsQuery,
    buildIncidentSelectableState,
    createDefaultIncidentForm,
    getIncidentLocationTextFromDeliveryOrder,
    getIncidentNextAction,
    type IncidentFormState,
} from '@/lib/fleet-queue-page-support';
import { formatDateTime, formatInternalDeliveryOrderNumber, formatQuantity, formatShipperDeliveryOrderNumber, getShipperReferenceCount, INCIDENT_STATUS_MAP, URGENCY_MAP, INCIDENT_TYPE_MAP } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPageAccess } from '@/lib/rbac';
import type { Incident, Vehicle, DeliveryOrder, IncidentSettlementLine } from '@/lib/types';

function isDriverSubmittedDraftLine(line: IncidentSettlementLine) {
    return line.status === 'DRAFT' && (line.note || '').includes('Diajukan driver');
}

function hasPendingDriverIncidentReview(incident: Incident, lines: IncidentSettlementLine[]) {
    return Boolean(incident.pendingDriverResolutionRequestedAt) || lines.some(isDriverSubmittedDraftLine);
}

export default function IncidentsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addToast } = useToast();
    const { user } = useApp();
    const canOpenVehicles = user ? hasPageAccess(user, 'vehicles') : false;
    const canOpenDrivers = user ? hasPageAccess(user, 'drivers') : false;
    const canOpenDeliveryOrders = user ? hasPageAccess(user, 'trips') : false;
    const [items, setItems] = useState<Incident[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [vehicleFilter, setVehicleFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalIncidents, setFilteredTotalIncidents] = useState(0);
    const [openIncidentCount, setOpenIncidentCount] = useState(0);
    const [progressIncidentCount, setProgressIncidentCount] = useState(0);
    const [resolvedIncidentCount, setResolvedIncidentCount] = useState(0);
    const [pendingDriverReviewCount, setPendingDriverReviewCount] = useState(0);
    const [incidentSettlementLines, setIncidentSettlementLines] = useState<IncidentSettlementLine[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [prefillApplied, setPrefillApplied] = useState(false);
    const [form, setForm] = useState<IncidentFormState>(createDefaultIncidentForm());
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);

    useEffect(() => {
        setPage(1);
    }, [search, vehicleFilter, statusFilter]);

    const buildCurrentIncidentsQuery = useCallback(
        (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
            buildIncidentsQuery({
                page: targetPage,
                pageSize: targetPageSize,
                search,
                vehicleFilter,
                statusFilter,
                sortField: dateSortDir ? 'dateTime' : undefined,
                sortDir: dateSortDir || undefined,
        }),
        [dateSortDir, page, search, vehicleFilter, statusFilter]
    );

    const fetchAllMatchingIncidents = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: Incident[] = [];

        do {
            const res = await fetch(`/api/data?${buildCurrentIncidentsQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat insiden');
            }

            const nextItems = (payload.data || []) as Incident[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildCurrentIncidentsQuery]);

    const loadIncidents = useCallback(async () => {
        setLoading(true);
        try {
            const fetchEntity = async <T,>(url: string) => {
                const res = await fetch(url);
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat insiden');
                }
                return payload as { data: T; meta?: { total?: number } };
            };

            const [listPayload, vehiclePayload, doPayload, matchingIncidents] = await Promise.all([
                fetchEntity<Incident[]>(`/api/data?${buildCurrentIncidentsQuery()}`),
                fetchAdminCollectionData<Vehicle[]>('/api/data?entity=vehicles', 'Gagal memuat insiden'),
                fetchAdminCollectionData<DeliveryOrder[]>('/api/data?entity=delivery-orders', 'Gagal memuat insiden'),
                fetchAllMatchingIncidents(),
            ]);
            const matchingIncidentIds = matchingIncidents.map(item => item._id).filter(Boolean);
            const currentIncidentIds = (listPayload.data || []).map(item => item._id).filter(Boolean);
            const [matchingLineRows, currentLineRows] = await Promise.all([
                matchingIncidentIds.length > 0
                    ? fetchAllAdminCollectionData<IncidentSettlementLine>(
                        `/api/data?entity=incident-settlement-lines&filter=${encodeURIComponent(JSON.stringify({ incidentRef: matchingIncidentIds }))}`,
                        'Gagal memuat detail biaya insiden'
                    )
                    : Promise.resolve([]),
                currentIncidentIds.length > 0
                    ? fetchAllAdminCollectionData<IncidentSettlementLine>(
                        `/api/data?entity=incident-settlement-lines&filter=${encodeURIComponent(JSON.stringify({ incidentRef: currentIncidentIds }))}`,
                        'Gagal memuat detail biaya insiden'
                    )
                    : Promise.resolve([]),
            ]);
            const matchingLinesByIncident = matchingLineRows.reduce<Map<string, IncidentSettlementLine[]>>((map, line) => {
                const current = map.get(line.incidentRef) || [];
                current.push(line);
                map.set(line.incidentRef, current);
                return map;
            }, new Map<string, IncidentSettlementLine[]>());

            const nextCounts = matchingIncidents.reduce(
                (totals, incident) => {
                    if (incident.status === 'OPEN') {
                        totals.open += 1;
                    } else if (incident.status === 'IN_PROGRESS') {
                        totals.inProgress += 1;
                    } else if (incident.status === 'RESOLVED') {
                        totals.resolved += 1;
                    }
                    if (hasPendingDriverIncidentReview(incident, matchingLinesByIncident.get(incident._id) || [])) {
                        totals.pendingDriverReview += 1;
                    }
                    return totals;
                },
                { open: 0, inProgress: 0, resolved: 0, pendingDriverReview: 0 }
            );

            setItems(listPayload.data || []);
            setFilteredTotalIncidents(listPayload.meta?.total || 0);
            setVehicles((vehiclePayload || []).filter(vehicle => vehicle.status !== 'SOLD'));
            setDos(doPayload || []);
            setIncidentSettlementLines(currentLineRows);
            setOpenIncidentCount(nextCounts.open);
            setProgressIncidentCount(nextCounts.inProgress);
            setResolvedIncidentCount(nextCounts.resolved);
            setPendingDriverReviewCount(nextCounts.pendingDriverReview);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat insiden');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCurrentIncidentsQuery, fetchAllMatchingIncidents]);

    useEffect(() => {
        void loadIncidents();
    }, [loadIncidents]);

    const linesByIncident = incidentSettlementLines.reduce<Map<string, IncidentSettlementLine[]>>((map, line) => {
        const current = map.get(line.incidentRef) || [];
        current.push(line);
        map.set(line.incidentRef, current);
        return map;
    }, new Map<string, IncidentSettlementLine[]>());

    useEffect(() => {
        if (loading || prefillApplied) {
            return;
        }

        const requestedVehicleRef = searchParams.get('vehicleRef') || '';
        const requestedDeliveryOrderRef = searchParams.get('deliveryOrderRef') || '';
        const shouldOpen = searchParams.get('open') === '1';

        const selectedDeliveryOrder = requestedDeliveryOrderRef
            ? dos.find(deliveryOrder => deliveryOrder._id === requestedDeliveryOrderRef) || null
            : null;
        const selectedVehicle = requestedVehicleRef
            ? vehicles.find(vehicle => vehicle._id === requestedVehicleRef) || null
            : selectedDeliveryOrder?.vehicleRef
                ? vehicles.find(vehicle => vehicle._id === selectedDeliveryOrder.vehicleRef) || null
                : null;

        if (selectedVehicle) {
            setVehicleFilter(selectedVehicle._id);
        }
        if (selectedVehicle || selectedDeliveryOrder) {
            setForm(createDefaultIncidentForm(selectedVehicle, selectedDeliveryOrder));
        }
        if (shouldOpen) {
            setShowModal(true);
        }
        setPrefillApplied(true);
    }, [dos, loading, prefillApplied, searchParams, vehicles]);

    const handleRelatedDOChange = (deliveryOrderRef: string) => {
        const deliveryOrder = dos.find(item => item._id === deliveryOrderRef);
        setForm(prev => ({
            ...prev,
            relatedDeliveryOrderRef: deliveryOrderRef,
            vehicleRef: deliveryOrderRef ? (deliveryOrder?.vehicleRef || '') : prev.vehicleRef,
            locationText: deliveryOrderRef
                ? getIncidentLocationTextFromDeliveryOrder(deliveryOrder)
                : '',
        }));
    };

    const handleVehicleChange = (vehicleRef: string) => {
        const selectedVehicle = vehicles.find(vehicle => vehicle._id === vehicleRef) || null;
        setForm(prev => {
            const relatedDeliveryOrder = prev.relatedDeliveryOrderRef
                ? dos.find(item => item._id === prev.relatedDeliveryOrderRef)
                : undefined;
            const nextRelatedDeliveryOrderRef =
                relatedDeliveryOrder && relatedDeliveryOrder.vehicleRef && relatedDeliveryOrder.vehicleRef !== vehicleRef
                    ? ''
                    : prev.relatedDeliveryOrderRef;

            return {
                ...prev,
                vehicleRef,
                relatedDeliveryOrderRef: nextRelatedDeliveryOrderRef,
                odometer: prev.odometer || selectedVehicle?.lastOdometer || 0,
            };
        });
    };

    const { filteredDos, selectedVehicle, selectedRelatedDO } = buildIncidentSelectableState({
        vehicles,
        dos,
        form,
    });

    const openIncidentModal = (vehicle?: Vehicle | null, deliveryOrder?: DeliveryOrder | null) => {
        setForm(createDefaultIncidentForm(vehicle, deliveryOrder));
        setShowModal(true);
    };

    const closeIncidentModal = () => {
        if (saving) return;
        const filteredVehicle = vehicles.find(vehicle => vehicle._id === vehicleFilter) || null;
        setShowModal(false);
        setForm(createDefaultIncidentForm(filteredVehicle));
    };

    const handleSave = async () => {
        if ((!form.vehicleRef && !form.relatedDeliveryOrderRef) || !form.description) {
            addToast('error', 'Kendaraan atau DO internal terkait serta deskripsi wajib');
            return;
        }
        const vehicle = vehicles.find(item => item._id === form.vehicleRef);
        const doData = dos.find(item => item._id === form.relatedDeliveryOrderRef);
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incidents', data: { ...form, vehiclePlate: vehicle?.plateNumber, relatedDONumber: doData?.doNumber } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal membuat insiden');
                return;
            }
            setForm(createDefaultIncidentForm(vehicleFilter ? vehicles.find(item => item._id === vehicleFilter) || null : null));
            addToast('success', `Insiden dilaporkan: ${result.data?.incidentNumber || ''}`);
            setShowModal(false);
            if (page !== 1) {
                setPage(1);
            } else {
                await loadIncidents();
            }
        } catch {
            addToast('error', 'Gagal membuat insiden');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Insiden Kendaraan</h1>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => openIncidentModal(vehicleFilter ? vehicles.find(vehicle => vehicle._id === vehicleFilter) || null : null)}>
                        <Plus size={18} /> Laporkan Insiden
                    </button>
                </div>
            </div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon danger"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Terbuka</div><div className="kpi-value">{openIncidentCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Ditangani</div><div className="kpi-value">{progressIncidentCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Review Driver</div><div className="kpi-value">{pendingDriverReviewCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon success"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Selesai</div><div className="kpi-value">{resolvedIncidentCount}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari nomor, kendaraan, supir, no. DO internal, lokasi..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <Combobox className="form-select" value={vehicleFilter} onChange={(v: string) => setVehicleFilter(v)} options={vehicles.map(vehicle => ({ value: vehicle._id, label: `${vehicle.plateNumber} - ${vehicle.brandModel}` }))} placeholder="Semua Kendaraan" />
                        <Combobox className="form-select" value={statusFilter} onChange={(v: string) => setStatusFilter(v)} options={Object.entries(INCIDENT_STATUS_MAP).map(([key, meta]) => ({ value: key, label: meta.label }))} placeholder="Semua Status" />
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>No.</th><th><SortableTableHeader label="Waktu" direction={dateSortDir} onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')} /></th><th>Kendaraan</th><th>Supir</th><th>No. DO Internal</th><th>Tipe</th><th>Lokasi</th><th>Urgency</th><th>Status</th><th>Tindak Lanjut</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalIncidents === 0 ? <tr><td colSpan={11}><div className="empty-state"><AlertTriangle size={48} className="empty-state-icon" /><div className="empty-state-title">Tidak ada insiden</div></div></td></tr> :
                                    items.map(item => {
                                        const pendingDriverReview = hasPendingDriverIncidentReview(item, linesByIncident.get(item._id) || []);
                                        return (
                                        <tr key={item._id}>
                                            <td><Link href={`/fleet/incidents/${item._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{item.incidentNumber}</Link></td>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.dateTime)}</td>
                                            <td>{item.vehicleRef && canOpenVehicles ? <Link href={`/fleet/vehicles/${item.vehicleRef}`} style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate || '-'}</Link> : (item.vehiclePlate || '-')}</td>
                                            <td>{item.driverRef && canOpenDrivers ? <Link href={`/fleet/drivers/${item.driverRef}`} style={{ color: 'var(--color-primary)' }}>{item.driverName || '-'}</Link> : (item.driverName || '-')}</td>
                                            <td>{item.relatedDeliveryOrderRef && canOpenDeliveryOrders ? <Link href={`/delivery-orders/${item.relatedDeliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{item.relatedDONumber || '-'}</Link> : (item.relatedDONumber || '-')}</td>
                                            <td>{INCIDENT_TYPE_MAP[item.incidentType] || item.incidentType}</td>
                                            <td>{item.locationText}</td>
                                            <td><span className={`badge badge-${URGENCY_MAP[item.urgency]?.color}`}>{URGENCY_MAP[item.urgency]?.label}</span></td>
                                            <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className={`badge badge-${INCIDENT_STATUS_MAP[item.status]?.color}`}><span className="badge-dot" /> {INCIDENT_STATUS_MAP[item.status]?.label}</span>{pendingDriverReview && <span className="badge badge-warning">Review Driver</span>}</div></td>
                                            <td>{getIncidentNextAction(item)}</td>
                                            <td><button className="table-action-btn" onClick={() => router.push(`/fleet/incidents/${item._id}`)}><Eye size={14} /> Lihat</button></td>
                                        </tr>
                                    )})}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalIncidents === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Tidak ada insiden</div>
                            </div>
                        ) : items.map(item => {
                            const pendingDriverReview = hasPendingDriverIncidentReview(item, linesByIncident.get(item._id) || []);
                            return (
                            <div key={item._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{item.incidentNumber}</div>
                                        <div className="mobile-record-subtitle">{item.vehicleRef && canOpenVehicles ? <Link href={`/fleet/vehicles/${item.vehicleRef}`} style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate || '-'}</Link> : (item.vehiclePlate || '-')} / {formatDateTime(item.dateTime)}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <span className={`badge badge-${INCIDENT_STATUS_MAP[item.status]?.color}`}>
                                            <span className="badge-dot" /> {INCIDENT_STATUS_MAP[item.status]?.label}
                                        </span>
                                        {pendingDriverReview && <span className="badge badge-warning">Review Driver</span>}
                                    </div>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Supir</span>
                                        <span className="mobile-record-value">{item.driverRef && canOpenDrivers ? <Link href={`/fleet/drivers/${item.driverRef}`} style={{ color: 'var(--color-primary)' }}>{item.driverName || '-'}</Link> : (item.driverName || '-')}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">No. DO Internal</span>
                                        <span className="mobile-record-value">{item.relatedDeliveryOrderRef && canOpenDeliveryOrders ? <Link href={`/delivery-orders/${item.relatedDeliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{item.relatedDONumber || '-'}</Link> : (item.relatedDONumber || '-')}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tipe</span>
                                        <span className="mobile-record-value">{INCIDENT_TYPE_MAP[item.incidentType] || item.incidentType}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Lokasi</span>
                                        <span className="mobile-record-value">{item.locationText || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Urgency</span>
                                        <span className="mobile-record-value">{URGENCY_MAP[item.urgency]?.label || item.urgency}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getIncidentNextAction(item)}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    {item.vehicleRef && (
                                        <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${item.vehicleRef}`)}>
                                            Unit
                                        </button>
                                    )}
                                    <button className="btn btn-secondary" onClick={() => router.push(`/fleet/incidents/${item._id}`)}>
                                        <Eye size={14} /> Lihat
                                    </button>
                                </div>
                            </div>
                        )})}
                    </div>
                )}
                {filteredTotalIncidents > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalIncidents}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} insiden</>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={closeIncidentModal}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Laporkan Insiden</h3><button className="modal-close" onClick={closeIncidentModal} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kendaraan <span className="required">*</span></label>
                                    <Combobox className="form-select" value={form.vehicleRef} onChange={(v: string) => handleVehicleChange(v)} options={vehicles.map(vehicle => ({ value: vehicle._id, label: vehicle.plateNumber }))} placeholder="Pilih" disabled={Boolean(form.relatedDeliveryOrderRef)} />
                                    {form.relatedDeliveryOrderRef && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                            Kendaraan mengikuti DO internal terkait. Hapus pilihan DO internal dulu jika ingin mengganti kendaraan.
                                        </div>
                                    )}
                                </div>
                                <div className="form-group"><label className="form-label">Waktu Insiden</label><input type="datetime-local" className="form-input" value={form.dateTime} onChange={e => setForm({ ...form, dateTime: e.target.value })} /></div>
                            </div>
                            {(selectedVehicle || selectedRelatedDO) && (
                                <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', marginBottom: '1rem' }}>
                                    <div className="text-muted text-sm">Konteks unit</div>
                                    <div className="font-medium">
                                        {selectedVehicle?.plateNumber || selectedRelatedDO?.vehiclePlate || '-'}
                                        {selectedVehicle?.brandModel ? ` - ${selectedVehicle.brandModel}` : ''}
                                    </div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                        {selectedRelatedDO
                                            ? `No. DO Internal ${formatInternalDeliveryOrderNumber(selectedRelatedDO)}${getShipperReferenceCount(selectedRelatedDO) > 0 ? ` | SJ ${formatShipperDeliveryOrderNumber(selectedRelatedDO)}` : ''} / driver ${selectedRelatedDO.driverName || '-'}`
                                            : `Odometer terakhir ${selectedVehicle?.lastOdometer ? `${formatQuantity(selectedVehicle.lastOdometer, 0)} km` : 'belum diisi'}`}
                                    </div>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tipe Insiden</label>
                                    <Combobox className="form-select" value={form.incidentType} onChange={(v: string) => setForm({ ...form, incidentType: v as Incident['incidentType'] })} options={Object.entries(INCIDENT_TYPE_MAP).map(([key, value]) => ({ value: key, label: value }))} /></div>
                                <div className="form-group"><label className="form-label">Urgency</label>
                                    <Combobox className="form-select" value={form.urgency} onChange={(v: string) => setForm({ ...form, urgency: v as Incident['urgency'] })} options={Object.entries(URGENCY_MAP).map(([key, value]) => ({ value: key, label: value.label }))} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Lokasi</label><input className="form-input" value={form.locationText} onChange={e => setForm({ ...form, locationText: e.target.value })} placeholder="Tol Cikampek KM 45..." /></div>
                                <div className="form-group"><label className="form-label">Odometer</label><FormattedNumberInput allowDecimal={false} value={form.odometer} onValueChange={value => setForm({ ...form, odometer: value })} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">DO Internal Terkait (Opsional)</label>
                                <Combobox className="form-select" value={form.relatedDeliveryOrderRef} onChange={(v: string) => handleRelatedDOChange(v)} options={filteredDos.map(deliveryOrder => ({ value: deliveryOrder._id, label: `${formatInternalDeliveryOrderNumber(deliveryOrder)}${getShipperReferenceCount(deliveryOrder) > 0 ? ` | SJ ${formatShipperDeliveryOrderNumber(deliveryOrder)}` : ''}` }))} placeholder="- Tidak ada -" /></div>
                            <div className="form-group"><label className="form-label">Kronologi / Deskripsi <span className="required">*</span></label><textarea className="form-textarea" rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Jelaskan kronologi insiden secara detail..." /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeIncidentModal} disabled={saving}>Batal</button><button className="btn btn-danger" onClick={handleSave} disabled={saving}><AlertTriangle size={16} /> {saving ? 'Menyimpan...' : 'Laporkan Insiden'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
