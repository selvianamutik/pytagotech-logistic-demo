'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit, FileDown, MapPin, Plus, Save, Search, Trash2, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { useApp, useToast } from '../layout';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { exportToExcel } from '@/lib/export';
import { getMasterDataImportExportColumns } from '@/lib/master-data-import-config';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPermission } from '@/lib/rbac';
import { formatCurrency } from '@/lib/utils';
import { getTripRouteOvertonaseRatePerTon, stripTripRouteOvertonaseRateNote } from '@/lib/trip-route-rate-support';
import type { Service, TripRouteRate } from '@/lib/types';

type TripRouteRateSortField = 'originArea' | 'destinationArea' | 'serviceName' | 'rate' | 'overtonaseDriverRatePerTon' | 'active';

function getNextSortDirection(currentField: TripRouteRateSortField, nextField: TripRouteRateSortField, currentDirection: SortDirection) {
    if (currentField !== nextField) {
        return nextField === 'rate' ? 'desc' : 'asc';
    }

    return currentDirection === 'asc' ? 'desc' : 'asc';
}

export default function TripRouteRatesPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<TripRouteRate[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [sortField, setSortField] = useState<TripRouteRateSortField>('serviceName');
    const [sortDir, setSortDir] = useState<SortDirection>('asc');
    const [search, setSearch] = useState('');
    const [serviceFilter, setServiceFilter] = useState('');
    const [originFilter, setOriginFilter] = useState('');
    const [destinationFilter, setDestinationFilter] = useState('');
    const [totalItems, setTotalItems] = useState(0);
    const [inactiveCount, setInactiveCount] = useState(0);
    const [allTripRouteRates, setAllTripRouteRates] = useState<TripRouteRate[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState<TripRouteRate | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [form, setForm] = useState({
        originArea: '',
        destinationArea: '',
        serviceRef: '',
        rate: 0,
        overtonaseDriverRatePerTon: 0,
        notes: '',
        active: true,
    });

    const canCreateTripRate = user ? hasPermission(user, 'tripRouteRates', 'create') : false;
    const canUpdateTripRate = user ? hasPermission(user, 'tripRouteRates', 'update') : false;
    const canDeleteTripRate = user ? hasPermission(user, 'tripRouteRates', 'delete') : false;
    const canExportTripRate = user ? hasPermission(user, 'tripRouteRates', 'export') : false;

    const loadReferenceData = useCallback(async () => {
        try {
            const [serviceRows, routeRows] = await Promise.all([
                fetchAdminCollectionData<Service[]>('/api/data?entity=services&sortField=code&sortDir=asc', 'Gagal memuat kategori armada'),
                fetchAdminCollectionData<TripRouteRate[]>('/api/data?entity=trip-route-rates&pageSize=1000&sortField=originArea&sortDir=asc', 'Gagal memuat filter biaya rute trip'),
            ]);

            setServices((serviceRows || []).filter(service => service.active !== false));
            setAllTripRouteRates(routeRows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat filter biaya rute trip');
        }
    }, [addToast]);

    const loadTripRouteRates = useCallback(async () => {
        setLoading(true);
        try {
            const listFilter: Record<string, unknown> = {};
            if (serviceFilter) {
                listFilter.serviceRef = serviceFilter;
            }
            if (originFilter) {
                listFilter.originArea = originFilter;
            }
            if (destinationFilter) {
                listFilter.destinationArea = destinationFilter;
            }

            const listParams = new URLSearchParams({
                entity: 'trip-route-rates',
                page: String(page),
                pageSize: String(DEFAULT_PAGE_SIZE),
                sortField,
                sortDir,
            });
            if (Object.keys(listFilter).length > 0) {
                listParams.set('filter', JSON.stringify(listFilter));
            }
            if (search.trim()) {
                listParams.set('search', search.trim());
                listParams.set('searchFields', 'originArea,destinationArea,serviceName,notes');
            }
            const inactiveFilter: Record<string, unknown> = { ...listFilter, active: false };
            const inactiveParams = new URLSearchParams({
                entity: 'trip-route-rates',
                countOnly: '1',
                filter: JSON.stringify(inactiveFilter),
            });
            if (search.trim()) {
                inactiveParams.set('search', search.trim());
                inactiveParams.set('searchFields', 'originArea,destinationArea,serviceName,notes');
            }
            const [listRes, inactiveRes] = await Promise.all([
                fetch(`/api/data?${listParams.toString()}`),
                fetch(`/api/data?${inactiveParams.toString()}`),
            ]);

            const [listPayload, inactivePayload] = await Promise.all([listRes.json(), inactiveRes.json()]);
            if (!listRes.ok) {
                throw new Error(listPayload.error || 'Gagal memuat biaya rute trip');
            }
            if (!inactiveRes.ok) {
                throw new Error(inactivePayload.error || 'Gagal memuat statistik biaya rute trip');
            }

            setItems(listPayload.data || []);
            setTotalItems(listPayload.meta?.total || 0);
            setInactiveCount(inactivePayload.meta?.total || 0);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat biaya rute trip');
        } finally {
            setLoading(false);
        }
    }, [addToast, destinationFilter, originFilter, page, search, serviceFilter, sortDir, sortField]);

    useEffect(() => {
        void loadTripRouteRates();
    }, [loadTripRouteRates]);

    useEffect(() => {
        void loadReferenceData();
    }, [loadReferenceData]);

    const handleExport = async () => {
        if (!canExportTripRate) return;
        try {
            const listFilter: Record<string, unknown> = {};
            if (serviceFilter) listFilter.serviceRef = serviceFilter;
            if (originFilter) listFilter.originArea = originFilter;
            if (destinationFilter) listFilter.destinationArea = destinationFilter;

            const listParams = new URLSearchParams({
                entity: 'trip-route-rates',
                pageSize: '500',
                sortField,
                sortDir,
            });
            if (Object.keys(listFilter).length > 0) {
                listParams.set('filter', JSON.stringify(listFilter));
            }
            if (search.trim()) {
                listParams.set('search', search.trim());
                listParams.set('searchFields', 'originArea,destinationArea,serviceName,notes');
            }

            const rows = await fetchAdminCollectionData<TripRouteRate[]>(
                `/api/data?${listParams.toString()}`,
                'Gagal memuat biaya rute trip untuk export',
                500,
            );
            const serviceCodeByRef = new Map(services.map((service) => [service._id, service.code]));
            await exportToExcel(
                (rows || []).map((rate) => ({
                    originArea: rate.originArea,
                    destinationArea: rate.destinationArea,
                    serviceCode: rate.serviceRef ? serviceCodeByRef.get(rate.serviceRef) || '' : '',
                    serviceName: rate.serviceName || '',
                    rate: rate.rate,
                    overtonaseDriverRatePerTon: rate.overtonaseDriverRatePerTon || 0,
                    notes: rate.notes || '',
                    active: rate.active !== false ? 'Aktif' : 'Nonaktif',
                })),
                getMasterDataImportExportColumns('trip-route-rates').map((column, index) => ({
                    ...column,
                    width: [24, 24, 18, 24, 18, 22, 28, 12][index] || 18,
                    ...(column.key === 'rate' || column.key === 'overtonaseDriverRatePerTon'
                        ? { formatter: (value: unknown) => Number(value || 0).toLocaleString('id-ID') }
                        : {}),
                })),
                `tarif-rute-trip-${new Date().toISOString().slice(0, 10)}`,
                'Tarif Rute Trip',
                {
                    title: 'Daftar Biaya Rute Trip',
                    subtitle: [serviceFilter ? `Layanan: ${serviceFilter}` : '', originFilter ? `Asal: ${originFilter}` : '', destinationFilter ? `Tujuan: ${destinationFilter}` : '', search.trim() ? `Pencarian: ${search.trim()}` : ''].filter(Boolean).join(' | ') || 'Semua rute',
                },
            );
            addToast('success', 'Excel biaya rute trip berhasil di-download');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel biaya rute trip');
        }
    };

    const activeCount = totalItems - inactiveCount;
    const selectedService = useMemo(
        () => services.find(service => service._id === form.serviceRef) || null,
        [form.serviceRef, services]
    );
    const originOptions = useMemo(() => {
        const values = allTripRouteRates
            .filter(rate => !serviceFilter || rate.serviceRef === serviceFilter)
            .map(rate => rate.originArea?.trim())
            .filter((value): value is string => Boolean(value));

        return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, 'id'));
    }, [allTripRouteRates, serviceFilter]);

    const destinationOptions = useMemo(() => {
        const values = allTripRouteRates
            .filter(rate => !serviceFilter || rate.serviceRef === serviceFilter)
            .filter(rate => !originFilter || rate.originArea === originFilter)
            .map(rate => rate.destinationArea?.trim())
            .filter((value): value is string => Boolean(value));

        return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, 'id'));
    }, [allTripRouteRates, originFilter, serviceFilter]);

    const handleSort = (field: TripRouteRateSortField) => {
        setSortDir(currentDirection => getNextSortDirection(sortField, field, currentDirection));
        setSortField(field);
        setPage(1);
    };

    useEffect(() => {
        setPage(1);
    }, [destinationFilter, originFilter, search, serviceFilter]);

    const openNew = () => {
        setEditItem(null);
        setForm({
            originArea: '',
            destinationArea: '',
            serviceRef: '',
            rate: 0,
            overtonaseDriverRatePerTon: 0,
            notes: '',
            active: true,
        });
        setShowModal(true);
    };

    const openEdit = (item: TripRouteRate) => {
        setEditItem(item);
        setForm({
            originArea: item.originArea || '',
            destinationArea: item.destinationArea || '',
            serviceRef: item.serviceRef || '',
            rate: item.rate || 0,
            overtonaseDriverRatePerTon: getTripRouteOvertonaseRatePerTon(item),
            notes: stripTripRouteOvertonaseRateNote(item.notes),
            active: item.active !== false,
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!(editItem ? canUpdateTripRate : canCreateTripRate)) {
            addToast('error', 'Anda tidak punya izin mengubah biaya rute trip');
            return;
        }
        if (!form.originArea.trim() || !form.destinationArea.trim()) {
            addToast('error', 'Asal dan tujuan area trip wajib diisi');
            return;
        }
        if (!form.rate || form.rate <= 0) {
            addToast('error', 'Tarif trip wajib lebih besar dari 0');
            return;
        }
        if (form.overtonaseDriverRatePerTon < 0) {
            addToast('error', 'Referensi overtonase tidak boleh negatif');
            return;
        }

        setSaving(true);
        try {
            const requestBody = editItem
                ? { entity: 'trip-route-rates', action: 'update', data: { id: editItem._id, updates: form } }
                : { entity: 'trip-route-rates', data: form };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menyimpan biaya rute trip');
                return;
            }

            if (!editItem && page !== 1) {
                setPage(1);
            } else {
                await loadTripRouteRates();
            }
            await loadReferenceData();

            setShowModal(false);
            addToast('success', editItem ? 'Biaya rute trip diperbarui' : 'Biaya rute trip ditambahkan');
        } catch {
            addToast('error', editItem ? 'Gagal memperbarui biaya rute trip' : 'Gagal menambah biaya rute trip');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!canDeleteTripRate) {
            addToast('error', 'Anda tidak punya izin menghapus biaya rute trip');
            return;
        }
        setDeletingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'trip-route-rates', action: 'delete', data: { id } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menghapus biaya rute trip');
                setDeleteId(null);
                return;
            }
            if (page > 1 && items.length === 1) {
                setPage(current => Math.max(1, current - 1));
            } else {
                await loadTripRouteRates();
            }
            await loadReferenceData();
            setDeleteId(null);
            addToast('success', 'Biaya rute trip dihapus');
        } catch {
            addToast('error', 'Gagal menghapus biaya rute trip');
            setDeleteId(null);
        } finally {
            setDeletingId(current => current === id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Biaya Rute Trip</h1>
                </div>
                <div className="page-actions">
                    {canExportTripRate && <button className="btn btn-secondary" onClick={() => void handleExport()}><FileDown size={18} /> Excel</button>}
                    {canCreateTripRate && (
                        <button className="btn btn-primary" onClick={openNew}>
                            <Plus size={18} /> Tambah Rute Trip
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Rute Aktif</div>
                        <div className="kpi-value">{activeCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Rute Nonaktif</div>
                        <div className="kpi-value">{inactiveCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Hak Ubah</div>
                        <div className="kpi-value">{canUpdateTripRate ? 'Bisa Ubah' : 'Lihat saja'}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search className="table-search-icon" size={16} />
                            <input
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                placeholder="Cari area, tujuan, armada, catatan..."
                            />
                        </div>
                        <select
                            className="filter-select"
                            value={serviceFilter}
                            onChange={event => {
                                setServiceFilter(event.target.value);
                                setOriginFilter('');
                                setDestinationFilter('');
                            }}
                        >
                            <option value="">Semua layanan armada</option>
                            {services.map(service => (
                                <option key={service._id} value={service._id}>
                                    {service.code} - {service.name}
                                </option>
                            ))}
                        </select>
                        <select
                            className="filter-select"
                            value={originFilter}
                            onChange={event => {
                                setOriginFilter(event.target.value);
                                setDestinationFilter('');
                            }}
                        >
                            <option value="">Semua asal area</option>
                            {originOptions.map(origin => (
                                <option key={origin} value={origin}>{origin}</option>
                            ))}
                        </select>
                        <select
                            className="filter-select"
                            value={destinationFilter}
                            onChange={event => setDestinationFilter(event.target.value)}
                        >
                            <option value="">Semua tujuan</option>
                            {destinationOptions.map(destination => (
                                <option key={destination} value={destination}>{destination}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>
                                    <SortableTableHeader
                                        label="Asal Area"
                                        direction={sortField === 'originArea' ? sortDir : null}
                                        onToggle={() => handleSort('originArea')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Tujuan"
                                        direction={sortField === 'destinationArea' ? sortDir : null}
                                        onToggle={() => handleSort('destinationArea')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Layanan Armada"
                                        direction={sortField === 'serviceName' ? sortDir : null}
                                        onToggle={() => handleSort('serviceName')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Tarif"
                                        direction={sortField === 'rate' ? sortDir : null}
                                        onToggle={() => handleSort('rate')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Overtonase"
                                        direction={sortField === 'overtonaseDriverRatePerTon' ? sortDir : null}
                                        onToggle={() => handleSort('overtonaseDriverRatePerTon')}
                                    />
                                </th>
                                <th>Catatan</th>
                                <th>
                                    <SortableTableHeader
                                        label="Status"
                                        direction={sortField === 'active' ? sortDir : null}
                                        onToggle={() => handleSort('active')}
                                    />
                                </th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2].map(row => (
                                    <tr key={row}>
                                        {[1, 2, 3, 4, 5, 6, 7, 8].map(cell => (
                                            <td key={cell}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : totalItems === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className="empty-state">
                                            <MapPin size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada biaya rute trip</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                items.map(item => (
                                    <tr key={item._id}>
                                        <td className="font-semibold">{item.originArea || '-'}</td>
                                        <td className="font-semibold">{item.destinationArea || '-'}</td>
                                        <td>{item.serviceName || <span className="text-muted">Semua layanan</span>}</td>
                                        <td className="font-semibold">{formatCurrency(item.rate || 0)}</td>
                                        <td className="font-semibold">
                                            {getTripRouteOvertonaseRatePerTon(item) > 0
                                                ? `${formatCurrency(getTripRouteOvertonaseRatePerTon(item))}/ton`
                                                : '-'}
                                        </td>
                                        <td className="text-muted">{stripTripRouteOvertonaseRateNote(item.notes) || '-'}</td>
                                        <td>
                                            <span className={`badge ${item.active !== false ? 'badge-success' : 'badge-gray'}`}>
                                                {item.active !== false ? 'Aktif' : 'Nonaktif'}
                                            </span>
                                        </td>
                                        <td>
                                            {canUpdateTripRate || canDeleteTripRate ? (
                                                <div className="table-actions">
                                                    {canUpdateTripRate && (
                                                        <button className="table-action-btn" onClick={() => openEdit(item)}>
                                                            <Edit size={14} /> Edit
                                                        </button>
                                                    )}
                                                    {canDeleteTripRate && (
                                                        <button className="table-action-btn danger" onClick={() => setDeleteId(item._id)}>
                                                            <Trash2 size={14} /> Hapus
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-muted">Lihat saja</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {totalItems > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} biaya rute trip</>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Biaya Rute Trip</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Asal Area <span className="required">*</span></label>
                                    <input
                                        className="form-input"
                                        value={form.originArea}
                                        onChange={event => setForm(previous => ({ ...previous, originArea: event.target.value }))}
                                        placeholder="Contoh: Tulangan / Gresik / Surabaya"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tujuan Area <span className="required">*</span></label>
                                    <input
                                        className="form-input"
                                        value={form.destinationArea}
                                        onChange={event => setForm(previous => ({ ...previous, destinationArea: event.target.value }))}
                                        placeholder="Contoh: Waru / Pasuruan / Jakarta"
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Layanan Armada</label>
                                    <select
                                        className="form-select"
                                        value={form.serviceRef}
                                        onChange={event => setForm(previous => ({ ...previous, serviceRef: event.target.value }))}
                                    >
                                        <option value="">Semua layanan armada</option>
                                        {services.map(service => (
                                            <option key={service._id} value={service._id}>
                                                {service.code} - {service.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tarif Trip <span className="required">*</span></label>
                                    <FormattedNumberInput allowDecimal={false}
                                        value={form.rate}
                                        onValueChange={value => setForm(previous => ({ ...previous, rate: value }))}
                                        placeholder="Ketik tarif upah trip"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Referensi Overtonase / Ton</label>
                                    <FormattedNumberInput allowDecimal={false}
                                        value={form.overtonaseDriverRatePerTon}
                                        onValueChange={value => setForm(previous => ({ ...previous, overtonaseDriverRatePerTon: value }))}
                                        placeholder="Ketik referensi overtonase"
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={form.notes}
                                    onChange={event => setForm(previous => ({ ...previous, notes: event.target.value }))}
                                    placeholder="Opsional. Misalnya rute reguler, area proyek, atau keterangan khusus."
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={form.active}
                                        onChange={event => setForm(previous => ({ ...previous, active: event.target.checked }))}
                                    /> Aktif
                                </label>
                            </div>
                            <div
                                style={{
                                    border: '1px solid var(--color-gray-200)',
                                    borderRadius: '0.75rem',
                                    padding: '0.85rem 1rem',
                                    background: 'var(--color-bg-secondary)',
                                }}
                            >
                                <div className="detail-label">Preview Rule</div>
                                <div className="detail-value" style={{ fontWeight: 600 }}>
                                    {form.originArea.trim() && form.destinationArea.trim()
                                        ? `${form.originArea.trim()} -> ${form.destinationArea.trim()}${selectedService ? ` | ${selectedService.name}` : ''}`
                                        : 'Isi asal dan tujuan area terlebih dahulu'}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {canDeleteTripRate && deleteId && (
                <div className="modal-overlay" onClick={() => { if (deletingId !== deleteId) setDeleteId(null); }}>
                    <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 420 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Hapus Biaya Rute Trip?</h3>
                        </div>
                        <div className="modal-body">
                            <p>Rule biaya rute trip akan dihapus permanen. Jika sudah dipakai di surat jalan, sistem akan menolak penghapusan ini.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>Batal</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteId)} disabled={deletingId === deleteId}>
                                <Trash2 size={16} /> {deletingId === deleteId ? 'Menghapus...' : 'Hapus'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
