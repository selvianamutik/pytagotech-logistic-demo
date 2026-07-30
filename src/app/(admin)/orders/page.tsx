'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp, useToast } from '../layout';
import { Plus, Search, Eye, Edit, Trash2, Package } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { formatDate, getShipperReferenceCount, ORDER_STATUS_MAP } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAdminCollectionData, fetchAdminListPayload } from '@/lib/api/admin-client';
import type { DeliveryOrder, DriverVoucher, Order, Service } from '@/lib/types';
import { getDeliveryOrderHoldCargoSummary, hasDeliveryOrderBillableCargo } from '@/lib/delivery-order-completion';
import { hasPageAccess } from '@/lib/rbac';

type TripCashStatusCode = 'NO_DO' | 'NEEDS_BON' | 'BON_DRAFT' | 'BON_ISSUED' | 'BON_SETTLED' | 'NOT_REQUIRED';
type TripCashStatusMeta = { code: TripCashStatusCode; label: string; color: string };
type OrderDocumentSummary = {
    tripCount: number;
    sjCount: number;
    hasHold: boolean;
    hasBillable: boolean;
};
type OrderVoucherSummary = {
    total: number;
    vouchers: Array<Pick<DriverVoucher, '_id' | 'bonNumber'>>;
};
const ORDER_STATUS_FILTER_OPTIONS = Object.entries(ORDER_STATUS_MAP).filter(([status]) => status !== 'ON_HOLD');

function hasCargoSummaryValue(summary?: { qtyKoli?: number; weightKg?: number; volumeM3?: number } | null) {
    return Boolean((summary?.qtyKoli || 0) > 0 || (summary?.weightKg || 0) > 0 || (summary?.volumeM3 || 0) > 0);
}

function buildOrderDocumentSummary(deliveryOrders: DeliveryOrder[]): OrderDocumentSummary {
    const activeDeliveryOrders = deliveryOrders.filter(item => item.status !== 'CANCELLED');
    return {
        tripCount: activeDeliveryOrders.length,
        sjCount: activeDeliveryOrders.reduce((sum, item) => sum + getShipperReferenceCount(item), 0),
        hasHold: activeDeliveryOrders.some(item => hasCargoSummaryValue(getDeliveryOrderHoldCargoSummary(item))),
        hasBillable: activeDeliveryOrders.some(item => hasDeliveryOrderBillableCargo(item)),
    };
}

function renderOrderDocumentSummary(summary?: OrderDocumentSummary) {
    if (!summary || summary.tripCount === 0) {
        return <span className="text-muted text-sm">Belum ada Trip/SJ</span>;
    }

    return (
        <div style={{ display: 'grid', gap: '0.25rem' }}>
            <div className="font-medium">{summary.tripCount} Trip | {summary.sjCount} SJ</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {summary.hasHold && <span className="badge badge-warning"><span className="badge-dot" /> Ada hold</span>}
                {summary.hasBillable && <span className="badge badge-success"><span className="badge-dot" /> Siap ditagih</span>}
            </div>
        </div>
    );
}

const getTripCashStatusMeta = (order: Order, deliveryOrders: DeliveryOrder[], voucherByDeliveryOrderRef: Map<string, DriverVoucher>): TripCashStatusMeta => {
    if (order.status === 'CANCELLED') {
        return { code: 'NOT_REQUIRED', label: 'Tidak perlu bon', color: 'gray' };
    }

    const activeDeliveryOrders = deliveryOrders.filter(item => item.status !== 'CANCELLED');
    if (activeDeliveryOrders.length === 0) {
        return { code: 'NO_DO', label: 'Belum ada SJ/Trip', color: 'gray' };
    }

    const hasUnissuedBon = activeDeliveryOrders.some(item => !voucherByDeliveryOrderRef.has(item._id));
    if (hasUnissuedBon) {
        return { code: 'NEEDS_BON', label: 'Bon belum diterbitkan', color: 'warning' };
    }

    const vouchers = activeDeliveryOrders
        .map(item => voucherByDeliveryOrderRef.get(item._id))
        .filter(Boolean) as DriverVoucher[];

    if (vouchers.some(item => item.status === 'DRAFT')) {
        return { code: 'BON_DRAFT', label: 'Bon draft', color: 'gray' };
    }

    if (vouchers.some(item => item.status === 'ISSUED')) {
        return { code: 'BON_ISSUED', label: 'Bon berjalan', color: 'info' };
    }

    return { code: 'BON_SETTLED', label: 'Bon selesai', color: 'success' };
};

const getNextActionLabel = (order: Order, tripCashStatus?: TripCashStatusMeta) => {
    if (tripCashStatus?.code === 'NEEDS_BON') {
        return 'Terbitkan bon trip';
    }

    if (tripCashStatus?.code === 'BON_DRAFT' || tripCashStatus?.code === 'BON_ISSUED') {
        return 'Selesaikan uang jalan';
    }

    switch (order.status) {
        case 'OPEN':
            return 'Buat trip pertama';
        case 'PARTIAL':
            return 'Lanjutkan sisa pengiriman';
        case 'COMPLETE':
            return 'Siap ditagih / arsip';
        case 'CANCELLED':
            return 'Tidak ada tindak lanjut';
        default:
            return 'Periksa detail order';
    }
};

function renderOrderVoucherLinks(summary: OrderVoucherSummary | undefined, canOpenDriverVoucherPage: boolean) {
    if (!summary || summary.vouchers.length === 0) return null;
    const visibleVouchers = summary.vouchers.slice(0, 3);
    const hiddenCount = summary.total - visibleVouchers.length;

    return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {visibleVouchers.map(voucher => (
                canOpenDriverVoucherPage ? (
                    <Link
                        key={voucher._id}
                        href={`/driver-vouchers/${voucher._id}`}
                        className="font-mono"
                        style={{ color: 'var(--color-primary)' }}
                    >
                        {voucher.bonNumber}
                    </Link>
                ) : (
                    <span key={voucher._id} className="font-mono">{voucher.bonNumber}</span>
                )
            ))}
            {hiddenCount > 0 && <span className="text-muted text-sm">+{hiddenCount} bon</span>}
        </div>
    );
}

export default function OrdersPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [orders, setOrders] = useState<Order[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [serviceFilter, setServiceFilter] = useState('');
    const [page, setPage] = useState(1);
    const [totalOrders, setTotalOrders] = useState(0);
    const [queueCounts, setQueueCounts] = useState({ needDispatch: 0, inProgress: 0, onHold: 0 });
    const [tripCashStatusByOrderId, setTripCashStatusByOrderId] = useState<Record<string, TripCashStatusMeta>>({});
    const [orderDocumentSummaryByOrderId, setOrderDocumentSummaryByOrderId] = useState<Record<string, OrderDocumentSummary>>({});
    const [orderVoucherSummaryByOrderId, setOrderVoucherSummaryByOrderId] = useState<Record<string, OrderVoucherSummary>>({});
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);
    const canOpenDriverVoucherPage = user ? hasPageAccess(user, 'driverVouchers') : false;

    const buildOrdersQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'orders',
            page: String(targetPage),
            pageSize: String(targetPageSize),
        });

        if (dateSortDir) {
            params.set('sortField', 'createdAt');
            params.set('sortDir', dateSortDir);
        } else {
            params.set('sortPreset', 'work-queue');
        }

        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'masterResi,customerName,pickupAddress,serviceName');
        }

        const filter: Record<string, string> = {};
        if (statusFilter) filter.status = statusFilter;
        if (serviceFilter) filter.serviceRef = serviceFilter;
        if (Object.keys(filter).length > 0) {
            params.set('filter', JSON.stringify(filter));
        }

        return params.toString();
    }, [dateSortDir, page, search, serviceFilter, statusFilter]);

    const fetchAllMatchingOrders = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: Order[] = [];

        do {
            const payload = await fetchAdminListPayload<Order>(
                `/api/data?${buildOrdersQuery(currentPage, pageSize)}`,
                'Gagal memuat order'
            );
            const nextItems = (payload.data || []) as Order[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildOrdersQuery]);

    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const [ordersPayload, serviceRows, matchingOrders] = await Promise.all([
                fetchAdminListPayload<Order>(`/api/data?${buildOrdersQuery()}`, 'Gagal memuat order'),
                fetchAdminCollectionData<Service[]>('/api/data?entity=services&sortField=code&sortDir=asc', 'Gagal memuat kategori armada'),
                fetchAllMatchingOrders(),
            ]);

            const pageOrders = ordersPayload.data || [];
            const pageOrderIds = pageOrders.map(item => item._id).filter(Boolean);
            let nextTripCashStatusByOrderId: Record<string, TripCashStatusMeta> = {};
            let nextOrderDocumentSummaryByOrderId: Record<string, OrderDocumentSummary> = {};
            let nextOrderVoucherSummaryByOrderId: Record<string, OrderVoucherSummary> = {};

            if (pageOrderIds.length > 0) {
                const deliveryOrders = await fetchAdminCollectionData<DeliveryOrder[]>(
                    `/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: pageOrderIds }))}`,
                    'Gagal memuat status trip order'
                );
                const deliveryOrderIds = (deliveryOrders || []).map(item => item._id).filter(Boolean);
                const vouchers = deliveryOrderIds.length > 0
                    ? await fetchAdminCollectionData<DriverVoucher[]>(
                        `/api/data?entity=driver-vouchers&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderIds }))}`,
                        'Gagal memuat status bon order'
                    )
                    : [];
                const deliveryOrdersByOrderRef = new Map<string, DeliveryOrder[]>();
                (deliveryOrders || []).forEach(item => {
                    const existing = deliveryOrdersByOrderRef.get(item.orderRef) || [];
                    existing.push(item);
                    deliveryOrdersByOrderRef.set(item.orderRef, existing);
                });
                const voucherByDeliveryOrderRef = new Map<string, DriverVoucher>();
                (vouchers || []).forEach(item => {
                    if (item.deliveryOrderRef) {
                        voucherByDeliveryOrderRef.set(item.deliveryOrderRef, item);
                    }
                });

                nextTripCashStatusByOrderId = Object.fromEntries(
                    pageOrders.map(order => [
                        order._id,
                        getTripCashStatusMeta(order, deliveryOrdersByOrderRef.get(order._id) || [], voucherByDeliveryOrderRef),
                    ])
                );
                nextOrderDocumentSummaryByOrderId = Object.fromEntries(
                    pageOrders.map(order => [
                        order._id,
                        buildOrderDocumentSummary(deliveryOrdersByOrderRef.get(order._id) || []),
                    ])
                );
                nextOrderVoucherSummaryByOrderId = Object.fromEntries(
                    pageOrders.map(order => {
                        const orderDeliveryOrders = deliveryOrdersByOrderRef.get(order._id) || [];
                        const vouchersForOrder = orderDeliveryOrders
                            .map(item => voucherByDeliveryOrderRef.get(item._id))
                            .filter(Boolean) as DriverVoucher[];
                        return [
                            order._id,
                            {
                                total: vouchersForOrder.length,
                                vouchers: vouchersForOrder.map(voucher => ({
                                    _id: voucher._id,
                                    bonNumber: voucher.bonNumber,
                                })),
                            },
                        ];
                    })
                );
            }

            const nextQueueCounts = matchingOrders.reduce(
                (totals, order) => {
                    if (order.status === 'OPEN') {
                        totals.needDispatch += 1;
                    } else if (order.status === 'PARTIAL' || order.status === 'ON_HOLD') {
                        totals.inProgress += 1;
                    }
                    return totals;
                },
                { needDispatch: 0, inProgress: 0, onHold: 0 }
            );

            setOrders(pageOrders);
            setTotalOrders(ordersPayload.meta?.total || 0);
            setServices(serviceRows || []);
            setQueueCounts(nextQueueCounts);
            setTripCashStatusByOrderId(nextTripCashStatusByOrderId);
            setOrderDocumentSummaryByOrderId(nextOrderDocumentSummaryByOrderId);
            setOrderVoucherSummaryByOrderId(nextOrderVoucherSummaryByOrderId);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat order');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildOrdersQuery, fetchAllMatchingOrders]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, serviceFilter]);

    const getServiceLabel = (order: Order) => {
        const service = services.find(item => item._id === order.serviceRef);
        if (service) {
            return `${service.code} - ${service.name}`;
        }
        return order.serviceName || '-';
    };

    const availableServiceOptions = useMemo(
        () => services.filter(service => service.active !== false || service._id === serviceFilter),
        [serviceFilter, services]
    );

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'orders', action: 'delete', data: { id } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus order');
                setDeleteId(null);
                return;
            }
            if (page > 1 && orders.length === 1) {
                setPage(current => Math.max(1, current - 1));
            } else {
                await loadOrders();
            }
            addToast('success', 'Order berhasil dihapus');
            setDeleteId(null);
        } catch {
            addToast('error', 'Gagal menghapus order');
            setDeleteId(null);
        } finally {
            setDeletingId(current => current === id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Order / Resi</h1>
                </div>
                <div className="page-actions">
                    <Link href="/orders/new" className="btn btn-primary">
                        <Plus size={18} className="btn-icon" /> Buat Order Baru
                    </Link>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Package size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Perlu Buat Trip</div>
                        <div className="kpi-value">{queueCounts.needDispatch}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Package size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Sedang Berjalan</div>
                        <div className="kpi-value">{queueCounts.inProgress}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Package size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Masih Hold</div>
                        <div className="kpi-value">{queueCounts.onHold}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input
                                type="text"
                                placeholder="Cari resi, customer, pickup, kategori..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <select
                            className="form-select"
                            style={{ width: 'auto', minWidth: 180 }}
                            value={serviceFilter}
                            onChange={e => setServiceFilter(e.target.value)}
                        >
                            <option value="">Semua Kategori</option>
                            {availableServiceOptions.map(service => (
                                <option key={service._id} value={service._id}>{service.code} - {service.name}</option>
                            ))}
                        </select>
                        <select
                            className="form-select"
                            style={{ width: 'auto', minWidth: 140 }}
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                        >
                            <option value="">Semua Status</option>
                            {ORDER_STATUS_FILTER_OPTIONS.map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>No. Resi</th>
                                <th>Customer</th>
                                <th>Pickup</th>
                                <th>Kategori Armada</th>
                                <th>Dokumen</th>
                                <th>Status</th>
                                <th>Status Bon</th>
                                <th>Tindak Lanjut</th>
                                <th>
                                    <SortableTableHeader
                                        label="Tanggal"
                                        direction={dateSortDir}
                                        onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')}
                                    />
                                </th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map(i => (
                                    <tr key={i}>
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => (
                                            <td key={j}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : totalOrders === 0 ? (
                                <tr>
                                    <td colSpan={10}>
                                        <div className="empty-state">
                                            <Package size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada order</div>
                                            <div className="empty-state-text">Buat order baru untuk memulai pengiriman</div>
                                            <Link href="/orders/new" className="btn btn-primary">
                                                <Plus size={16} /> Buat Order Baru
                                            </Link>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                orders.map(order => {
                                    const tripCashStatus = tripCashStatusByOrderId[order._id];
                                    return (
                                        <tr key={order._id}>
                                            <td>
                                                <Link href={`/orders/${order._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                                                    {order.masterResi}
                                                </Link>
                                            </td>
                                            <td>{order.customerName}</td>
                                            <td>{order.pickupAddress || '-'}</td>
                                            <td>{getServiceLabel(order)}</td>
                                            <td>
                                                <Link href={`/orders/${order._id}#order-surat-jalan-section`} style={{ color: 'inherit' }}>
                                                    {renderOrderDocumentSummary(orderDocumentSummaryByOrderId[order._id])}
                                                </Link>
                                            </td>
                                            <td>
                                                <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                                    <span className="badge-dot" />
                                                    {ORDER_STATUS_MAP[order.status]?.label || order.status}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`badge badge-${tripCashStatus?.color || 'gray'}`}>
                                                    <span className="badge-dot" />
                                                    {tripCashStatus?.label || 'Belum dicek'}
                                                </span>
                                                {renderOrderVoucherLinks(orderVoucherSummaryByOrderId[order._id], canOpenDriverVoucherPage)}
                                            </td>
                                            <td>
                                                <span style={{ fontWeight: 500 }}>{getNextActionLabel(order, tripCashStatus)}</span>
                                            </td>
                                            <td className="text-muted">{formatDate(order.createdAt)}</td>
                                            <td>
                                                <div className="table-actions">
                                                    <button className="table-action-btn" onClick={() => router.push(`/orders/${order._id}`)}>
                                                        <Eye size={14} /> Buka
                                                    </button>
                                                    <button className="table-action-btn" onClick={() => router.push(`/orders/${order._id}/edit`)}>
                                                        <Edit size={14} /> Edit
                                                    </button>
                                                    <button className="table-action-btn danger" onClick={() => setDeleteId(order._id)}>
                                                        <Trash2 size={14} /> Hapus
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {totalOrders === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada order</div>
                                <div className="mobile-record-subtitle">Buat order baru untuk memulai pengiriman.</div>
                                <div className="mobile-record-actions">
                                    <Link href="/orders/new" className="btn btn-primary">
                                        <Plus size={16} /> Buat Order Baru
                                    </Link>
                                </div>
                            </div>
                        ) : orders.map(order => {
                            const tripCashStatus = tripCashStatusByOrderId[order._id];
                            return (
                            <div key={order._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{order.masterResi}</div>
                                        <div className="mobile-record-subtitle">{order.customerName || '-'} • {formatDate(order.createdAt)}</div>
                                    </div>
                                    <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                        <span className="badge-dot" /> {ORDER_STATUS_MAP[order.status]?.label || order.status}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Pickup</span>
                                        <span className="mobile-record-value">{order.pickupAddress || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kategori Armada</span>
                                        <span className="mobile-record-value">{getServiceLabel(order)}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Dokumen</span>
                                        <span className="mobile-record-value">
                                            <Link href={`/orders/${order._id}#order-surat-jalan-section`} style={{ color: 'inherit' }}>
                                                {renderOrderDocumentSummary(orderDocumentSummaryByOrderId[order._id])}
                                            </Link>
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Status Bon</span>
                                        <div className="mobile-record-value">
                                            <span className={`badge badge-${tripCashStatus?.color || 'gray'}`}>
                                                <span className="badge-dot" /> {tripCashStatus?.label || 'Belum dicek'}
                                            </span>
                                            {renderOrderVoucherLinks(orderVoucherSummaryByOrderId[order._id], canOpenDriverVoucherPage)}
                                        </div>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getNextActionLabel(order, tripCashStatus)}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => router.push(`/orders/${order._id}`)}>
                                        <Eye size={14} /> Buka
                                    </button>
                                    <button className="btn btn-secondary" onClick={() => router.push(`/orders/${order._id}/edit`)}>
                                        <Edit size={14} /> Edit
                                    </button>
                                    <button className="btn btn-danger" onClick={() => setDeleteId(order._id)}>
                                        <Trash2 size={14} /> Hapus
                                    </button>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                )}

                {totalOrders > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalOrders}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} order. Urutan dimulai dari yang paling perlu tindakan.
                            </>
                        )}
                    />
                )}
            </div>

            {/* Delete Confirmation Dialog */}
            {deleteId && (
                <div className="modal-overlay" onClick={() => { if (deletingId !== deleteId) setDeleteId(null); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Konfirmasi Hapus</h3>
                            <button className="modal-close" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>
                                <span>&times;</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Apakah Anda yakin ingin menghapus order ini? Tindakan ini tidak dapat dibatalkan.</p>
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
