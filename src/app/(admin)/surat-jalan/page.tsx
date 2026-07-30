'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Search } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { fetchAdminPageData } from '@/lib/api/admin-client';
import { formatCargoSummary } from '@/lib/measurement';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { DO_STATUS_MAP, formatDate } from '@/lib/utils';
import type { SuratJalanDocument } from '@/lib/trip-document-types';
import { getSuratJalanActualDropDestinations, getSuratJalanDestination } from '@/lib/surat-jalan-destination';
import { hasPageAccess } from '@/lib/rbac';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { useApp, useToast } from '../layout';

/**
 * Maximum items to fetch for the initial load.
 * This balances performance with UX - enough for meaningful filtering,
 * but not so many that it causes timeout on large datasets.
 */
const MAX_INITIAL_FETCH = 500;

type SuratJalanConditionFilter = '' | 'has-hold' | 'billable' | 'not-billable' | 'multi-sj' | 'unfinished' | 'completed';

function matchesSuratJalanSearch(row: SuratJalanDocument, search: string) {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
        row.suratJalanNumber,
        row.tripNumber,
        row.masterResi,
        row.customerName,
        row.pickupAddress,
        row.tripDestinationArea,
        row.receiverName,
        row.receiverCompany,
        row.receiverAddress,
        row.vehiclePlate,
        row.driverName,
        ...getSuratJalanActualDropDestinations(row),
    ].some(value => String(value || '').toLowerCase().includes(needle));
}

function hasCargoSummaryValue(summary?: { qtyKoli?: number; weightKg?: number; volumeM3?: number } | null) {
    return Boolean((summary?.qtyKoli || 0) > 0 || (summary?.weightKg || 0) > 0 || (summary?.volumeM3 || 0) > 0);
}

function isSuratJalanFinal(row: SuratJalanDocument) {
    return row.tripStatus === 'DELIVERED' || row.tripStatus === 'PARTIAL_HOLD';
}

export default function SuratJalanPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [rows, setRows] = useState<SuratJalanDocument[]>([]);
    const [totalRows, setTotalRows] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [conditionFilter, setConditionFilter] = useState<SuratJalanConditionFilter>('');
    const [page, setPage] = useState(1);
    const [dateSortDir, setDateSortDir] = useState<SortDirection>('desc');
    const canOpenTripPage = user ? hasPageAccess(user, 'deliveryOrders') : false;
    const canOpenSourceOrderPage = user ? hasPageAccess(user, 'orders') : false;

    const loadSuratJalan = useCallback(async () => {
        setLoading(true);
        setLoadNotice(null);
        try {
            const params = new URLSearchParams({
                entity: 'surat-jalan',
                sortField: 'tripDate',
                sortDir: dateSortDir,
            });
            // Fetch single page with reasonable limit for initial load
            // This prevents timeout on large datasets while maintaining UX
            const payload = await fetchAdminPageData<SuratJalanDocument>(
                `/api/data?${params.toString()}`,
                'Gagal memuat surat jalan',
                1,
                MAX_INITIAL_FETCH
            );
            setRows(payload.data || []);
            setTotalRows(payload.meta?.total || payload.data?.length || 0);
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat surat jalan');
            setRows([]);
            setTotalRows(0);
            setLoadNotice(buildAdminLoadNotice(
                message,
                'Surat Jalan',
                'Halaman ini hanya bisa dilihat oleh role yang punya akses Surat Jalan.'
            ));
            addToast('error', message);
        } finally {
            setLoading(false);
        }
    }, [addToast, dateSortDir]);

    useEffect(() => {
        void loadSuratJalan();
    }, [loadSuratJalan]);

    useEffect(() => {
        setPage(1);
    }, [conditionFilter, search, statusFilter]);
    const tripSjCountByTripRef = useMemo(
        () => rows.reduce<Map<string, number>>((acc, row) => {
            acc.set(row.tripRef, (acc.get(row.tripRef) || 0) + 1);
            return acc;
        }, new Map()),
        [rows]
    );
    const filteredRows = useMemo(
        () => rows.filter(row => {
            const matchesCondition = (() => {
                if (!conditionFilter) return true;
                if (conditionFilter === 'has-hold') return hasCargoSummaryValue(row.holdCargo);
                if (conditionFilter === 'billable') return hasCargoSummaryValue(row.billableCargo);
                if (conditionFilter === 'not-billable') return !hasCargoSummaryValue(row.billableCargo);
                if (conditionFilter === 'multi-sj') return (tripSjCountByTripRef.get(row.tripRef) || 0) > 1;
                if (conditionFilter === 'unfinished') return !isSuratJalanFinal(row) && row.tripStatus !== 'CANCELLED';
                if (conditionFilter === 'completed') return isSuratJalanFinal(row);
                return true;
            })();
            return (!statusFilter || row.tripStatus === statusFilter)
                && matchesCondition
                && matchesSuratJalanSearch(row, search);
        }),
        [conditionFilter, rows, search, statusFilter, tripSjCountByTripRef]
    );
    // Client-side pagination on the fetched (filtered) data
    const pageRows = filteredRows.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);
    const multiSjTripCount = useMemo(() => {
        return Array.from(tripSjCountByTripRef.values()).filter(count => count > 1).length;
    }, [tripSjCountByTripRef]);
    const holdRowCount = rows.filter(row => hasCargoSummaryValue(row.holdCargo)).length;
    // Track if we fetched a limited dataset (for showing notice to user)
    const isDataLimited = totalRows > rows.length;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Surat Jalan</h1>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon info"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Dokumen SJ</div>
                        <div className="kpi-value">{totalRows >0 ? totalRows : rows.length}</div>
                        {isDataLimited && <div className="text-muted text-sm">Menampilkan {rows.length} teratas</div>}
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Trip Multi-SJ</div>
                        <div className="kpi-value">{multiSjTripCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Ada Hold</div>
                        <div className="kpi-value">{holdRowCount}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari no. SJ, trip, resi, customer, tujuan..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 150 }} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status Operasional</option>
                            {Object.entries(DO_STATUS_MAP).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={conditionFilter} onChange={event => setConditionFilter(event.target.value as SuratJalanConditionFilter)}>
                            <option value="">Semua Kondisi</option>
                            <option value="has-hold">Ada hold</option>
                            <option value="billable">Masuk tagihan</option>
                            <option value="not-billable">Belum masuk tagihan</option>
                            <option value="multi-sj">Trip multi-SJ</option>
                            <option value="unfinished">Belum final</option>
                            <option value="completed">Sudah final</option>
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>No. SJ</th>
                                <th>
                                    <SortableTableHeader
                                        label="Tanggal"
                                        direction={dateSortDir}
                                        onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')}
                                    />
                                </th>
                                <th>Trip</th>
                                <th>Order / Resi</th>
                                <th>Customer</th>
                                <th>Pickup</th>
                                <th>Tujuan</th>
                                <th>Total di SJ</th>
                                <th>Masuk Tagihan</th>
                                <th>Ditahan</th>
                                <th>Status Operasional</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(row => (
                                <tr key={row}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(cell => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
                            )) : pageRows.length === 0 ? (
                                <tr>
                                    <td colSpan={12}>
                                        <div className="empty-state">
                                            <FileText size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">{loadNotice?.title || 'Belum ada surat jalan'}</div>
                                            <div className="empty-state-text">{loadNotice?.text || 'SJ akan muncul per nomor dokumen, termasuk saat satu trip membawa beberapa SJ.'}</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : pageRows.map(row => {
                                const statusMeta = row.tripStatus ? DO_STATUS_MAP[row.tripStatus] : null;
                                return (
                                    <tr key={row._id}>
                                        <td className="font-semibold"><Link href={`/surat-jalan/${encodeURIComponent(row._id)}`} style={{ color: 'var(--color-primary)' }}>{row.suratJalanNumber || '-'}</Link></td>
                                        <td>{formatDate(row.tripDate)}</td>
                                        <td>{canOpenTripPage ? <Link href={`/trips/${row.tripRef}`} style={{ color: 'var(--color-primary)' }}>{row.tripNumber}</Link> : row.tripNumber}</td>
                                        <td>{canOpenSourceOrderPage && row.orderRef ? <Link href={`/orders/${row.orderRef}`}>{row.masterResi || '-'}</Link> : (row.masterResi || '-')}</td>
                                        <td>{row.customerName || '-'}</td>
                                        <td>{row.pickupAddress || '-'}</td>
                                        <td>{getSuratJalanDestination(row)}</td>
                                        <td>{row.itemCount} item<div className="text-muted text-sm">{formatCargoSummary(row.cargoSummary)}</div></td>
                                        <td>{formatCargoSummary(row.billableCargo)}</td>
                                        <td>{formatCargoSummary(row.holdCargo)}</td>
                                        <td>{statusMeta ? <span className={`badge badge-${statusMeta.color}`}><span className="badge-dot" /> {statusMeta.label}</span> : '-'}</td>
                                        <td><Link className="table-action-btn" href={`/surat-jalan/${encodeURIComponent(row._id)}`}>Lihat Dokumen</Link></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-card-list">
                    {!loading && pageRows.length === 0 && (
                        <div className="mobile-data-card">
                            <div className="mobile-record-title">{loadNotice?.title || 'Belum ada surat jalan'}</div>
                            <div className="mobile-record-subtitle">{loadNotice?.text || 'SJ akan muncul per nomor dokumen, termasuk saat satu trip membawa beberapa SJ.'}</div>
                        </div>
                    )}
                    {pageRows.map(row => {
                        const statusMeta = row.tripStatus ? DO_STATUS_MAP[row.tripStatus] : null;
                        return (
                            <div className="mobile-data-card" key={row._id}>
                                <div className="mobile-card-header">
                                    <Link className="mobile-card-title" href={`/surat-jalan/${encodeURIComponent(row._id)}`}>{row.suratJalanNumber || '-'}</Link>
                                    {statusMeta && <span className={`badge badge-${statusMeta.color}`}><span className="badge-dot" /> {statusMeta.label}</span>}
                                </div>
                                <div className="mobile-card-body">
                                    <div>{formatDate(row.tripDate)}</div>
                                    <div>
                                        <strong>
                                            {canOpenTripPage ? <Link href={`/trips/${row.tripRef}`}>{row.tripNumber}</Link> : row.tripNumber}
                                        </strong>
                                        {' | '}
                                        {canOpenSourceOrderPage && row.orderRef ? <Link href={`/orders/${row.orderRef}`}>{row.masterResi || '-'}</Link> : (row.masterResi || '-')}
                                    </div>
                                    <div>{row.customerName || '-'}</div>
                                    <div>Tujuan: {getSuratJalanDestination(row)}</div>
                                    <div>{row.itemCount} item | Masuk tagihan {formatCargoSummary(row.billableCargo)} | Ditahan {formatCargoSummary(row.holdCargo)}</div>
                                    <Link className="btn btn-secondary btn-sm" href={`/surat-jalan/${encodeURIComponent(row._id)}`}>Lihat Dokumen</Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <AppPagination page={page} totalItems={filteredRows.length} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} />
            </div>
        </div>
    );
}
