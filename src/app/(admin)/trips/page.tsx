'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Truck } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { DO_STATUS_MAP, formatDate } from '@/lib/utils';
import { formatCargoSummary } from '@/lib/measurement';
import type { CargoSummary, Trip } from '@/lib/trip-document-types';
import type { DriverVoucher } from '@/lib/types';
import { hasPageAccess } from '@/lib/rbac';
import { useApp, useToast } from '../layout';

type TripBonStatusMeta = { label: string; color: string };
type TripConditionFilter = '' | 'driver-approval' | 'has-hold' | 'multi-sj' | 'no-sj' | 'unfinished' | 'completed' | 'bon-open';

function getTripBonStatusMeta(trip: Trip, voucher?: DriverVoucher): TripBonStatusMeta {
    if (trip.status === 'CANCELLED') {
        return { label: 'Tidak perlu bon', color: 'gray' };
    }

    if (!voucher) {
        return { label: 'Bon belum diterbitkan', color: 'warning' };
    }

    if (voucher.status === 'DRAFT') {
        return { label: 'Bon draft', color: 'gray' };
    }

    if (voucher.status === 'SETTLED') {
        return { label: 'Bon selesai', color: 'success' };
    }

    return { label: 'Bon berjalan', color: 'info' };
}

function matchesTripSearch(trip: Trip, search: string) {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
        trip.tripNumber,
        trip.masterResi,
        trip.customerName,
        trip.vehiclePlate,
        trip.driverName,
        trip.tripOriginArea,
        trip.tripDestinationArea,
        trip.pickupAddress,
        trip.receiverAddress,
        ...(trip.shipperReferenceLinks || []).map(item => item.label),
    ].some(value => String(value || '').toLowerCase().includes(needle));
}

function hasCargoSummaryValue(summary?: Partial<CargoSummary> | null) {
    return Boolean((summary?.qtyKoli || 0) > 0 || (summary?.weightKg || 0) > 0 || (summary?.volumeM3 || 0) > 0);
}

function isTripFinal(trip: Trip) {
    return trip.status === 'DELIVERED' || trip.status === 'PARTIAL_HOLD';
}

function matchesTripCondition(trip: Trip, voucher: DriverVoucher | undefined, conditionFilter: TripConditionFilter) {
    if (!conditionFilter) return true;
    if (conditionFilter === 'driver-approval') return Boolean(trip.pendingDriverStatus);
    if (conditionFilter === 'has-hold') return hasCargoSummaryValue(trip.holdCargo);
    if (conditionFilter === 'multi-sj') return trip.shipperReferenceCount > 1;
    if (conditionFilter === 'no-sj') return trip.shipperReferenceCount === 0;
    if (conditionFilter === 'unfinished') return !isTripFinal(trip) && trip.status !== 'CANCELLED';
    if (conditionFilter === 'completed') return isTripFinal(trip);
    if (conditionFilter === 'bon-open') return trip.status !== 'CANCELLED' && voucher?.status !== 'SETTLED';
    return true;
}

function renderTripCargoSummary(trip: Trip) {
    const finalTrip = isTripFinal(trip);
    const primarySummary = finalTrip && hasCargoSummaryValue(trip.actualCargo) ? trip.actualCargo : trip.cargoSummary;
    const primaryLabel = finalTrip && hasCargoSummaryValue(trip.actualCargo) ? 'Aktual' : 'Rencana';
    const parts = [`${primaryLabel}: ${hasCargoSummaryValue(primarySummary) ? formatCargoSummary(primarySummary) : '-'}`];
    if (hasCargoSummaryValue(trip.holdCargo)) {
        parts.push(`Hold: ${formatCargoSummary(trip.holdCargo)}`);
    }
    return parts.join(' | ');
}

function renderTripSuratJalanLinks(trip: Trip) {
    const links = trip.shipperReferenceLinks || [];
    if (links.length === 0) {
        return <span className="text-muted text-sm">Belum ada SJ</span>;
    }
    const visibleLinks = links.slice(0, 3);
    const hiddenCount = links.length - visibleLinks.length;
    return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {visibleLinks.map(link => (
                <Link
                    key={link.id}
                    href={`/surat-jalan/${encodeURIComponent(link.id)}`}
                    className="font-mono"
                    style={{
                        color: 'var(--color-primary)',
                        fontSize: '0.78rem',
                        padding: '0.15rem 0.4rem',
                        border: '1px solid var(--color-primary)',
                        borderRadius: '0.45rem',
                        background: 'var(--color-primary-light)',
                    }}
                >
                    {link.label}
                </Link>
            ))}
            {hiddenCount > 0 && <span className="text-muted text-sm">+{hiddenCount} SJ</span>}
        </div>
    );
}

export default function TripsPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<Trip[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [conditionFilter, setConditionFilter] = useState<TripConditionFilter>('');
    const [page, setPage] = useState(1);
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);
    const [voucherByDeliveryOrderRef, setVoucherByDeliveryOrderRef] = useState<Record<string, DriverVoucher>>({});
    const canOpenSourceOrderPage = user ? hasPageAccess(user, 'orders') : false;
    const canOpenDriverVoucherPage = user ? hasPageAccess(user, 'driverVouchers') : false;

    const loadTrips = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ entity: 'trips' });
            if (dateSortDir) {
                params.set('sortField', 'date');
                params.set('sortDir', dateSortDir);
            } else {
                params.set('sortPreset', 'work-queue');
            }
            const rows = await fetchAllAdminCollectionData<Trip>(
                `/api/data?${params.toString()}`,
                'Gagal memuat trip'
            );
            const deliveryOrderRefs = Array.from(new Set(
                (rows || []).map(item => item.sourceDeliveryOrderRef || item._id).filter(Boolean)
            ));
            const vouchers = deliveryOrderRefs.length > 0
                ? await fetchAllAdminCollectionData<DriverVoucher>(
                    `/api/data?entity=driver-vouchers&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderRefs }))}`,
                    'Gagal memuat status bon trip'
                )
                : [];
            setItems(rows || []);
            setVoucherByDeliveryOrderRef(Object.fromEntries(
                (vouchers || [])
                    .filter(item => item.deliveryOrderRef)
                    .map(item => [item.deliveryOrderRef as string, item])
            ));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat trip');
        } finally {
            setLoading(false);
        }
    }, [addToast, dateSortDir]);

    useEffect(() => {
        void loadTrips();
    }, [loadTrips]);

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, conditionFilter]);

    const filteredItems = useMemo(
        () => items.filter(item => {
            const voucher = voucherByDeliveryOrderRef[item.sourceDeliveryOrderRef || item._id];
            return (!statusFilter || item.status === statusFilter)
                && matchesTripCondition(item, voucher, conditionFilter)
                && matchesTripSearch(item, search);
        }),
        [conditionFilter, items, search, statusFilter, voucherByDeliveryOrderRef]
    );
    const pageItems = filteredItems.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);
    const activeTripCount = items.filter(item => ['CREATED', 'ON_DELIVERY', 'ARRIVED'].includes(item.status)).length;
    const pendingApprovalCount = items.filter(item => item.pendingDriverStatus).length;
    const completedCount = items.filter(item => item.status === 'DELIVERED').length;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Trip</h1>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Trip Aktif</div>
                        <div className="kpi-value">{activeTripCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Approval Driver</div>
                        <div className="kpi-value">{pendingApprovalCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Selesai</div>
                        <div className="kpi-value">{completedCount}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari trip, resi, customer, kendaraan, driver..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 150 }} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(DO_STATUS_MAP).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={conditionFilter} onChange={event => setConditionFilter(event.target.value as TripConditionFilter)}>
                            <option value="">Semua Kondisi</option>
                            <option value="driver-approval">Butuh approval driver</option>
                            <option value="has-hold">Ada hold</option>
                            <option value="multi-sj">Multi-SJ</option>
                            <option value="no-sj">Belum ada SJ</option>
                            <option value="unfinished">Belum final</option>
                            <option value="completed">Selesai</option>
                            <option value="bon-open">Bon belum selesai</option>
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>No. Trip</th>
                                <th>Order / Resi</th>
                                <th>Customer</th>
                                <th>Rute</th>
                                <th>Armada</th>
                                <th>Driver</th>
                                <th>
                                    <SortableTableHeader
                                        label="Tanggal"
                                        direction={dateSortDir}
                                        onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')}
                                    />
                                </th>
                                <th>SJ</th>
                                <th>Status</th>
                                <th>Status Bon</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(row => (
                                <tr key={row}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(cell => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
                            )) : pageItems.length === 0 ? (
                                <tr>
                                    <td colSpan={11}>
                                        <div className="empty-state">
                                            <Truck size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada trip</div>
                                            <div className="empty-state-text">Trip dibuat dari order / resi.</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : pageItems.map(item => {
                                const statusMeta = DO_STATUS_MAP[item.status];
                                const voucher = voucherByDeliveryOrderRef[item.sourceDeliveryOrderRef || item._id];
                                const bonStatusMeta = getTripBonStatusMeta(item, voucher);
                                return (
                                    <tr key={item._id}>
                                        <td><Link className="font-semibold" style={{ color: 'var(--color-primary)' }} href={`/trips/${item._id}`}>{item.tripNumber}</Link></td>
                                        <td>{canOpenSourceOrderPage ? <Link href={`/orders/${item.orderRef}`}>{item.masterResi || '-'}</Link> : (item.masterResi || '-')}</td>
                                        <td>{item.customerName || '-'}</td>
                                        <td>{item.tripOriginArea && item.tripDestinationArea ? `${item.tripOriginArea} -> ${item.tripDestinationArea}` : `${item.pickupAddress || '-'} -> ${item.receiverAddress || '-'}`}</td>
                                        <td>{item.vehiclePlate || '-'}</td>
                                        <td>{item.driverName || '-'}</td>
                                        <td>{formatDate(item.date)}</td>
                                        <td>
                                            {renderTripSuratJalanLinks(item)}
                                            <div className="text-muted text-sm" style={{ marginTop: 4 }}>{renderTripCargoSummary(item)}</div>
                                        </td>
                                        <td><span className={`badge badge-${statusMeta?.color || 'gray'}`}><span className="badge-dot" /> {statusMeta?.label || item.status}</span></td>
                                        <td>
                                            <span className={`badge badge-${bonStatusMeta.color}`}>
                                                <span className="badge-dot" /> {bonStatusMeta.label}
                                            </span>
                                            {voucher?.bonNumber && (
                                                <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                                                    {canOpenDriverVoucherPage ? (
                                                        <Link href={`/driver-vouchers/${voucher._id}`}>{voucher.bonNumber}</Link>
                                                    ) : voucher.bonNumber}
                                                </div>
                                            )}
                                        </td>
                                        <td><Link className="table-action-btn" href={`/trips/${item._id}`}>Lihat</Link></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-card-list">
                    {pageItems.map(item => {
                        const statusMeta = DO_STATUS_MAP[item.status];
                        const voucher = voucherByDeliveryOrderRef[item.sourceDeliveryOrderRef || item._id];
                        const bonStatusMeta = getTripBonStatusMeta(item, voucher);
                        return (
                            <div className="mobile-data-card" key={item._id}>
                                <div className="mobile-card-header">
                                    <Link className="mobile-card-title" href={`/trips/${item._id}`}>{item.tripNumber}</Link>
                                    <span className={`badge badge-${statusMeta?.color || 'gray'}`}><span className="badge-dot" /> {statusMeta?.label || item.status}</span>
                                </div>
                                <div className="mobile-card-body">
                                    <div><strong>{item.masterResi || '-'}</strong> | {item.customerName || '-'}</div>
                                    <div>{item.vehiclePlate || '-'} | {item.driverName || '-'}</div>
                                    <div>{formatDate(item.date)}</div>
                                    <div>{renderTripSuratJalanLinks(item)}</div>
                                    <div className="text-muted text-sm">{renderTripCargoSummary(item)}</div>
                                    <div>
                                        Bon: <span className={`badge badge-${bonStatusMeta.color}`}><span className="badge-dot" /> {bonStatusMeta.label}</span>
                                        {voucher?.bonNumber && (
                                            <div style={{ marginTop: 6 }}>
                                                {canOpenDriverVoucherPage ? (
                                                    <Link href={`/driver-vouchers/${voucher._id}`}>{voucher.bonNumber}</Link>
                                                ) : (
                                                    <span>{voucher.bonNumber}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <AppPagination page={page} totalItems={filteredItems.length} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} />
            </div>
        </div>
    );
}
