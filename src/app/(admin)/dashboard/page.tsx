'use client';

import { useState, useEffect } from 'react';
import { useApp, useToast } from '../layout';
import {
    Package, Truck, FileText, AlertTriangle, Wrench, DollarSign,
    TrendingUp, Clock, ArrowUpRight
} from 'lucide-react';
import { getDashboardNotaNetAmount, getRecentNotaAction, getRecentOrderAction, type DashboardData } from '@/lib/dashboard-page-support';
import { formatCurrency, formatDate, ORDER_STATUS_MAP, INVOICE_STATUS_MAP } from '@/lib/utils';
import Link from 'next/link';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { useSearchParams } from 'next/navigation';

export default function DashboardPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const searchParams = useSearchParams();
    const accessDenied = searchParams.get('access') === 'denied';
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        if (accessDenied) {
            addToast('error', 'Akses halaman dibatasi untuk role akun ini');
        }
    }, [accessDenied, addToast]);

    useEffect(() => {
        const controller = new AbortController();
        let disposed = false;
        const markDisposed = () => {
            disposed = true;
            controller.abort();
        };

        async function load() {
            setLoading(true);
            setLoadError(null);
            try {
                const res = await fetch('/api/data?entity=dashboard-summary', { signal: controller.signal });
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat dashboard');
                }

                setData(payload.data);
            } catch (err) {
                const pageHidden =
                    typeof document !== 'undefined' && document.visibilityState === 'hidden';
                const transientNavigationFailure =
                    err instanceof TypeError &&
                    err.message === 'Failed to fetch' &&
                    pageHidden;

                if (
                    disposed ||
                    controller.signal.aborted ||
                    transientNavigationFailure ||
                    (err instanceof Error && err.name === 'AbortError')
                ) {
                    return;
                }
                console.error('Dashboard load error:', err);
                const message = err instanceof Error ? err.message : 'Gagal memuat dashboard';
                setLoadError(message);
                addToast('error', message);
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        }
        void load();

        window.addEventListener('pagehide', markDisposed);
        window.addEventListener('beforeunload', markDisposed);

        return () => {
            window.removeEventListener('pagehide', markDisposed);
            window.removeEventListener('beforeunload', markDisposed);
            markDisposed();
        };
    }, [addToast]);

    if (loading) {
        return (
            <div>
                <div className="page-header">
                    <div className="page-header-left">
                        <div className="skeleton skeleton-title" />
                        <div className="skeleton skeleton-text short" />
                    </div>
                </div>
                <div className="kpi-grid">
                    {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton skeleton-card" />)}
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div>
                <div className="page-header">
                    <div className="page-header-left">
                        <h1 className="page-title">Dashboard</h1>
                    </div>
                </div>
                <div className="card">
                    <div className="card-body" style={{ display: 'grid', gap: '0.9rem' }}>
                        <div style={{ fontWeight: 600 }}>Dashboard belum bisa dimuat</div>
                        <div className="text-muted">{loadError || 'Terjadi gangguan saat memuat ringkasan dashboard.'}</div>
                        <div>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => window.location.reload()}
                            >
                                Coba Muat Ulang
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    const canSeeFinancialTotals = user ? hasPermission(user, 'reports', 'view') : false;
    const canViewOrders = user ? hasPageAccess(user, 'orders') : false;
    const canViewDeliveryOrders = user ? hasPermission(user, 'deliveryOrders', 'view') : false;
    const canViewInvoices = user ? hasPermission(user, 'invoices', 'view') : false;
    const canViewIncidents = user ? hasPermission(user, 'incidents', 'view') : false;
    const canViewMaintenance = user ? hasPermission(user, 'maintenance', 'view') : false;
    const canViewTripCash = user ? hasPermission(user, 'driverVouchers', 'view') : false;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Dashboard</h1>
                </div>
            </div>

            {accessDenied && (
                <div
                    className="card"
                    style={{
                        border: '1px solid #f59e0b',
                        background: '#fffbeb',
                        marginBottom: '1rem',
                    }}
                >
                    <div className="card-body" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <AlertTriangle size={20} style={{ color: '#b45309', flexShrink: 0, marginTop: 2 }} />
                        <div>
                            <div style={{ fontWeight: 700, color: '#92400e' }}>Akses halaman dibatasi</div>
                            <div style={{ color: '#78350f', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                                Role akun ini tidak punya izin membuka halaman tersebut.
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div className="kpi-grid">
                {canViewOrders && <Link href="/orders" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon primary"><Package size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Total Order</div>
                            <div className="kpi-value">{data.orderStats.total}</div>
                            <div className="kpi-sub">{data.orderStats.open} belum terkirim, {data.orderStats.partial} sebagian terkirim{data.orderStats.onHold > 0 ? `, ${data.orderStats.onHold} tertahan` : ''}</div>
                        </div>
                    </div>
                </Link>}

                {canViewDeliveryOrders && <Link href="/trips" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon secondary"><Truck size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">DO Dalam Pengiriman</div>
                            <div className="kpi-value">{data.doStats.onDelivery}</div>
                            <div className="kpi-sub">{data.doStats.total} total surat jalan</div>
                        </div>
                    </div>
                </Link>}

                {canViewInvoices && <Link href="/invoices" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon warning"><FileText size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Invoice Belum Lunas</div>
                            <div className="kpi-value">{data.notaStats.unpaid}</div>
                            {canSeeFinancialTotals && <div className="kpi-sub">{formatCurrency(data.notaStats.totalOutstanding)} piutang aktif</div>}
                        </div>
                    </div>
                </Link>}

                {canViewIncidents && <Link href="/fleet/incidents" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon danger"><AlertTriangle size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Insiden Open</div>
                            <div className="kpi-value">{data.fleetStats.openIncidents}</div>
                            <div className="kpi-sub">Perlu penanganan</div>
                        </div>
                    </div>
                </Link>}

                {canViewMaintenance && <Link href="/fleet/maintenance" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon info"><Wrench size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Servis Due</div>
                            <div className="kpi-value">{data.fleetStats.maintenanceDue}</div>
                            <div className="kpi-sub">Maintenance terjadwal</div>
                        </div>
                    </div>
                </Link>}

                {canViewTripCash && <Link href="/driver-vouchers" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon success"><DollarSign size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Uang Jalan Trip Belum Diselesaikan</div>
                            <div className="kpi-value">{data.voucherStats.unsettled}</div>
                            {canSeeFinancialTotals && <div className="kpi-sub">{formatCurrency(data.voucherStats.totalIssued)} uang jalan dicairkan</div>}
                        </div>
                    </div>
                </Link>}
            </div>

            {/* Tables */}
            <div className="chart-grid">
                {/* Recent Orders */}
                {canViewOrders && <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Order Terbaru</span>
                        <Link href="/orders" className="btn btn-ghost btn-sm">
                            Lihat Semua <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead>
                                <tr>
                                    <th>Resi</th>
                                    <th>Customer</th>
                                    <th>Status</th>
                                    <th>Tindak Lanjut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentOrders.length === 0 ? (
                                    <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada order</td></tr>
                                ) : (
                                    data.recentOrders.map(order => (
                                        <tr key={order._id}>
                                            <td>
                                                <Link href={`/orders/${order._id}`} className="font-medium">{order.masterResi}</Link>
                                            </td>
                                            <td>{order.customerName}</td>
                                            <td>
                                                <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                                    {ORDER_STATUS_MAP[order.status]?.label || order.status}
                                                </span>
                                            </td>
                                            <td>{getRecentOrderAction(order.status)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {data.recentOrders.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada order</div>
                            </div>
                        ) : (
                            data.recentOrders.map(order => (
                                <div key={order._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{order.masterResi}</div>
                                            <div className="mobile-record-subtitle">{order.customerName} | {formatDate(order.createdAt)}</div>
                                        </div>
                                        <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                            {ORDER_STATUS_MAP[order.status]?.label || order.status}
                                        </span>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <div className="mobile-record-kv" style={{ width: '100%' }}>
                                            <span className="mobile-record-label">Tindak Lanjut</span>
                                            <span className="mobile-record-value">{getRecentOrderAction(order.status)}</span>
                                        </div>
                                        <Link href={`/orders/${order._id}`} className="btn btn-sm btn-secondary">
                                            Lihat Detail
                                        </Link>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>}

                {/* Recent Notas */}
                {canViewInvoices && <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Invoice Terbaru</span>
                        <Link href="/invoices" className="btn btn-ghost btn-sm">
                            Lihat Semua <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead>
                                <tr>
                                    <th>No. Invoice</th>
                                    <th>Customer</th>
                                    <th>Status</th>
                                    <th>Tindak Lanjut</th>
                                    {canSeeFinancialTotals && <th>Jumlah</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentNotas.length === 0 ? (
                                    <tr><td colSpan={canSeeFinancialTotals ? 5 : 4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada invoice</td></tr>
                                ) : (
                                    data.recentNotas.map(nota => (
                                        <tr key={nota._id}>
                                            <td>
                                                <Link href={`/invoices/${nota._id}`} className="font-medium">{nota.notaNumber}</Link>
                                            </td>
                                            <td>{nota.customerName}</td>
                                            <td>
                                                <span className={`badge badge-${INVOICE_STATUS_MAP[nota.status]?.color || 'gray'}`}>
                                                    {INVOICE_STATUS_MAP[nota.status]?.label || nota.status}
                                                </span>
                                            </td>
                                            <td>{getRecentNotaAction(nota)}</td>
                                            {canSeeFinancialTotals && <td className="font-medium">{formatCurrency(getDashboardNotaNetAmount(nota))}</td>}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {data.recentNotas.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada invoice</div>
                            </div>
                        ) : (
                            data.recentNotas.map(nota => (
                                <div key={nota._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{nota.notaNumber}</div>
                                            <div className="mobile-record-subtitle">{nota.customerName}</div>
                                        </div>
                                        <span className={`badge badge-${INVOICE_STATUS_MAP[nota.status]?.color || 'gray'}`}>
                                            {INVOICE_STATUS_MAP[nota.status]?.label || nota.status}
                                        </span>
                                    </div>
                                    {canSeeFinancialTotals && (
                                        <div className="mobile-record-meta">
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Invoice Final</span>
                                                <span className="mobile-record-value">{formatCurrency(getDashboardNotaNetAmount(nota))}</span>
                                            </div>
                                        </div>
                                    )}
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tindak Lanjut</span>
                                            <span className="mobile-record-value">{getRecentNotaAction(nota)}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <Link href={`/invoices/${nota._id}`} className="btn btn-sm btn-secondary">
                                            Lihat Detail
                                        </Link>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>}
            </div>

            {/* Reminders */}
            <div className="card mt-6">
                <div className="card-header">
                    <span className="card-header-title">Tindak Lanjut Hari Ini</span>
                </div>
                <div className="card-body">
                    <ul className="reminder-list">
                        {canViewOrders && data.orderStats.onHold > 0 && (
                            <li className="reminder-item">
                                <div className="reminder-icon warning"><Clock size={16} /></div>
                                <div>
                                    <strong>{data.orderStats.onHold} order</strong> masih tertahan dan perlu keputusan lanjut
                                </div>
                            </li>
                        )}
                        {canViewInvoices && data.notaStats.unpaid > 0 && (
                            <li className="reminder-item">
                                <div className="reminder-icon danger"><FileText size={16} /></div>
                                <div>
                        <strong>{data.notaStats.unpaid} invoice</strong> masih menunggu pelunasan{canSeeFinancialTotals ? ` (${formatCurrency(data.notaStats.totalOutstanding)})` : ''}
                                </div>
                            </li>
                        )}
                        {canViewTripCash && data.voucherStats.unsettled > 0 && (
                            <li className="reminder-item">
                                <div className="reminder-icon info"><DollarSign size={16} /></div>
                                <div>
                                    <strong>{data.voucherStats.unsettled} trip</strong> masih menunggu penyelesaian uang jalan{canSeeFinancialTotals ? ` (${formatCurrency(data.voucherStats.totalIssued)} sudah dicairkan)` : ''}
                                </div>
                            </li>
                        )}
                        {canViewMaintenance && data.fleetStats.maintenanceDue > 0 && (
                            <li className="reminder-item">
                                <div className="reminder-icon info"><Wrench size={16} /></div>
                                <div>
                                    <strong>{data.fleetStats.maintenanceDue} kendaraan</strong> perlu servis
                                </div>
                            </li>
                        )}
                        {canViewIncidents && data.fleetStats.openIncidents > 0 && (
                            <li className="reminder-item">
                                <div className="reminder-icon danger"><AlertTriangle size={16} /></div>
                                <div>
                                    <strong>{data.fleetStats.openIncidents} insiden</strong> masih terbuka
                                </div>
                            </li>
                        )}
                        {(!canViewOrders || data.orderStats.onHold === 0) &&
                            (!canViewInvoices || data.notaStats.unpaid === 0) &&
                            (!canViewTripCash || data.voucherStats.unsettled === 0) &&
                            (!canViewMaintenance || data.fleetStats.maintenanceDue === 0) &&
                            (!canViewIncidents || data.fleetStats.openIncidents === 0) && (
                            <li className="reminder-item">
                                <div className="reminder-icon" style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                                    <TrendingUp size={16} />
                                </div>
                                <div>Operasional cukup aman. Tidak ada tindak lanjut mendesak saat ini.</div>
                            </li>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}
