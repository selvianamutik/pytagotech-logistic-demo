'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Car, Smartphone, Truck, Wallet } from 'lucide-react';
import { useApp, useToast } from '../../../layout';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchOptionalAdminCollectionData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { buildDriverScoresQuery, DRIVER_SCORE_TYPE_META, getDriverScoreStatusMeta, getLatestDriverScoreSummary } from '@/lib/driver-scoring-support';
import { buildDriverAccountMap, isDriverAccountActive, type DriverMobileAccount } from '@/lib/fleet-asset-page-support';
import { buildDriverVoucherSettlementDisplay, DRIVER_VOUCHER_STATUS_MAP, inferDriverVoucherDisbursementCount } from '@/lib/driver-voucher-detail-support';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import type { DeliveryOrder, Driver, DriverScore, DriverVoucher } from '@/lib/types';
import {
    DO_STATUS_MAP,
    formatCurrency,
    formatDate,
    formatDateTime,
    getShipperReferenceCount,
    getDriverVoucherFinancialSummary,
    formatInternalDeliveryOrderNumber,
    formatShipperDeliveryOrderNumber,
} from '@/lib/utils';

export default function DriverDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const driverId = params.id as string;
    const [driver, setDriver] = useState<Driver | null>(null);
    const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [vouchers, setVouchers] = useState<DriverVoucher[]>([]);
    const [scores, setScores] = useState<DriverScore[]>([]);
    const [accounts, setAccounts] = useState<DriverMobileAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);

    const canViewDriverAccounts = user ? hasPermission(user, 'drivers', 'view') : false;
    const canViewDriverScores = user ? hasPermission(user, 'driverScores', 'view') : false;
    const canViewDriverVouchers = user ? hasPermission(user, 'driverVouchers', 'view') : false;
    const canOpenCustomerPage = user ? hasPageAccess(user, 'customers') : false;
    const canOpenDeliveryOrderPage = user ? hasPageAccess(user, 'deliveryOrders') : false;
    const canOpenDriverVoucherPage = user ? hasPageAccess(user, 'driverVouchers') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user, 'vehicles') : false;

    const loadDriverDetail = useCallback(async () => {
        setLoading(true);
        setLoadNotice(null);
        try {
            const driverFilter = encodeURIComponent(JSON.stringify({ driverRef: driverId }));
            const optionalFetchOptions = { onError: (message: string) => addToast('error', message), silentAccessDenied: true };
            const loadedDriver = await fetchAdminData<Driver | null>(`/api/data?entity=drivers&id=${driverId}`, 'Gagal memuat data supir');
            const [doRows, voucherRows, accountRows, scoreRows] = await Promise.all([
                fetchOptionalAdminCollectionData<DeliveryOrder>(`/api/data?entity=delivery-orders&filter=${driverFilter}&sortField=date&sortDir=desc`, 'Gagal memuat riwayat DO', undefined, optionalFetchOptions),
                canViewDriverVouchers
                    ? fetchOptionalAdminCollectionData<DriverVoucher>(`/api/data?entity=driver-vouchers&filter=${driverFilter}&sortField=issuedDate&sortDir=desc`, 'Gagal memuat riwayat uang jalan', undefined, optionalFetchOptions)
                    : Promise.resolve([] as DriverVoucher[]),
                canViewDriverAccounts
                    ? fetch(`/api/driver/accounts?driverRefs=${encodeURIComponent(driverId)}`)
                        .then(async res => {
                            const payload = await res.json();
                            if (!res.ok) throw new Error(payload.error || 'Gagal memuat akses mobile driver');
                            return (payload.data || []) as DriverMobileAccount[];
                        })
                        .catch(error => {
                            addToast('error', error instanceof Error ? error.message : 'Gagal memuat akses mobile driver');
                            return [] as DriverMobileAccount[];
                        })
                    : Promise.resolve([] as DriverMobileAccount[]),
                canViewDriverScores
                    ? fetchOptionalAdminCollectionData<DriverScore>(
                        `/api/data?${buildDriverScoresQuery({ page: 1, pageSize: 500, driverRef: driverId })}`,
                        'Gagal memuat riwayat scoring supir',
                        undefined,
                        optionalFetchOptions
                    )
                    : Promise.resolve([] as DriverScore[]),
            ]);

            setDriver(loadedDriver);
            setDeliveryOrders((doRows || []).sort((a, b) => `${b.date}-${b._id}`.localeCompare(`${a.date}-${a._id}`)));
            setVouchers((voucherRows || []).sort((a, b) => `${b.issuedDate}-${b._id}`.localeCompare(`${a.issuedDate}-${a._id}`)));
            setAccounts(accountRows || []);
            setScores((scoreRows || []).sort((a, b) => `${b.effectiveDate}-${b.createdAt}-${b._id}`.localeCompare(`${a.effectiveDate}-${a.createdAt}-${a._id}`)));
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat detail supir');
            setLoadNotice(buildAdminLoadNotice(
                message,
                'Supir',
                'Halaman ini hanya bisa dilihat oleh role yang punya akses Supir.'
            ));
            addToast('error', message);
        } finally {
            setLoading(false);
        }
    }, [addToast, canViewDriverAccounts, canViewDriverScores, canViewDriverVouchers, driverId]);

    useEffect(() => {
        void loadDriverDetail();
    }, [loadDriverDetail]);

    const account = useMemo(() => buildDriverAccountMap(accounts).get(driverId), [accounts, driverId]);
    const activeTrip = useMemo(
        () => deliveryOrders.find(item => ['CREATED', 'ON_DELIVERY', 'ARRIVED'].includes(item.status)),
        [deliveryOrders]
    );
    const unsettledVoucherCount = useMemo(() => vouchers.filter(item => item.status !== 'SETTLED').length, [vouchers]);
    const totalOperationalSpent = useMemo(
        () => vouchers.reduce((sum, item) => sum + getDriverVoucherFinancialSummary(item).totalSpent, 0),
        [vouchers]
    );
    const totalDriverFee = useMemo(
        () => vouchers.reduce((sum, item) => sum + getDriverVoucherFinancialSummary(item).driverFeeAmount, 0),
        [vouchers]
    );
    const latestScoreSummary = useMemo(() => getLatestDriverScoreSummary(scores), [scores]);

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 320 }} /></div>;
    }

    if (!driver) {
        return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Supir tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;
    }

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/drivers" />
                    <h1 className="page-title">{driver.name}</h1>
                    <p className="page-subtitle">{driver.phone} | {driver.licenseNumber || 'SIM belum diisi'}</p>
                </div>
            </div>

            <div className="kpi-grid">
                <div className="kpi-card">
                    <div className="kpi-icon info"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Riwayat DO Driver</div>
                        <div className="kpi-value">{deliveryOrders.length}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Trip Aktif</div>
                        <div className="kpi-value">{activeTrip ? 1 : 0}</div>
                    </div>
                </div>
                {canViewDriverVouchers && (
                    <div className="kpi-card">
                        <div className="kpi-icon success"><Wallet size={20} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Uang Jalan Belum Selesai</div>
                            <div className="kpi-value">{unsettledVoucherCount}</div>
                        </div>
                    </div>
                )}
                {canViewDriverVouchers && (
                    <div className="kpi-card">
                        <div className="kpi-icon primary"><Car size={20} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Total Upah Trip Snapshot</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(totalDriverFee)}</div>
                        </div>
                    </div>
                )}
            </div>

            <div className="card">
                <div className="card-body">
                    <div className="detail-grid">
                        <div>
                            <div className="detail-row"><div className="detail-item"><div className="detail-label">Status Supir</div><div className="detail-value">{driver.active !== false ? 'Aktif' : 'Non-aktif'}</div></div><div className="detail-item"><div className="detail-label">No. SIM</div><div className="detail-value">{driver.licenseNumber || '-'}</div></div></div>
                            <div className="detail-row"><div className="detail-item"><div className="detail-label">SIM Berlaku Sampai</div><div className="detail-value">{driver.simExpiry ? formatDate(driver.simExpiry) : '-'}</div></div><div className="detail-item"><div className="detail-label">No. KTP</div><div className="detail-value">{driver.ktpNumber || '-'}</div></div></div>
                            <div className="detail-row"><div className="detail-item"><div className="detail-label">Alamat</div><div className="detail-value">{driver.address || '-'}</div></div><div className="detail-item"><div className="detail-label">Trip Aktif</div><div className="detail-value">{activeTrip ? (canOpenDeliveryOrderPage ? <Link href={`/delivery-orders/${activeTrip._id}`}>{formatInternalDeliveryOrderNumber(activeTrip)}</Link> : formatInternalDeliveryOrderNumber(activeTrip)) : '-'}</div></div></div>
                        </div>
                        <div>
                            <div style={{ padding: '0.9rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)' }}>
                                <div className="text-muted text-sm">Akses Mobile Driver</div>
                                {!canViewDriverAccounts ? (
                                    <div style={{ marginTop: '0.35rem' }}>Detail login mobile hanya ditampilkan untuk owner dan armada.</div>
                                ) : account ? (
                                    <div style={{ marginTop: '0.35rem', display: 'grid', gap: '0.35rem' }}>
                                        <div className="font-medium" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Smartphone size={16} /> {account.email}
                                        </div>
                                        <div className="text-muted text-sm">
                                            {isDriverAccountActive(account) ? 'Akun mobile aktif' : 'Akun mobile non-aktif'}
                                            {account.lastLoginAt ? ` | Login terakhir ${formatDateTime(account.lastLoginAt)}` : ' | Belum pernah login'}
                                        </div>
                                        <div className="text-muted text-sm">
                                            Kelola akses mobile dari <Link href="/fleet/drivers" style={{ color: 'var(--color-primary)' }}>daftar supir</Link>.
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ marginTop: '0.35rem' }}>
                                        Belum ada akun mobile untuk supir ini.
                                    </div>
                                )}
                            </div>
                            <div style={{ padding: '0.9rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)', background: 'white', marginTop: '1rem' }}>
                                <div className="text-muted text-sm">Status Scoring</div>
                                {latestScoreSummary ? (
                                    <div style={{ marginTop: '0.35rem', display: 'grid', gap: '0.35rem' }}>
                                        <div className="font-medium" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <span>{DRIVER_SCORE_TYPE_META[latestScoreSummary.score.scoreType].label}</span>
                                            <span className={`badge ${getDriverScoreStatusMeta(latestScoreSummary.score).badgeClass}`}>
                                                {getDriverScoreStatusMeta(latestScoreSummary.score).label}
                                            </span>
                                        </div>
                                        <div className="text-muted text-sm">
                                            Berlaku {formatDate(latestScoreSummary.score.effectiveDate)} sampai {formatDate(latestScoreSummary.score.dueDate)}
                                        </div>
                                        <div className="text-muted text-sm">
                                            {latestScoreSummary.score.notes || 'Belum ada catatan tambahan'}
                                        </div>
                                        {canViewDriverScores && (
                                            <div className="text-muted text-sm">
                                                Kelola skors dari <Link href={`/fleet/drivers/skors?driverRef=${driverId}`} style={{ color: 'var(--color-primary)' }}>halaman skors supir</Link>.
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ marginTop: '0.35rem' }}>
                                        Belum ada scoring untuk supir ini.
                                    </div>
                                )}
                            </div>
                            <div style={{ padding: '0.9rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-primary-soft)', background: 'var(--color-primary-surface)', marginTop: '1rem' }}>
                                <div className="text-muted text-sm">Catatan Struktur Data</div>
                                <div style={{ marginTop: '0.35rem', lineHeight: 1.6 }}>
                                    Riwayat uang jalan dan upah trip ditampilkan di halaman supir karena ini hak dan settlement perjalanan driver.
                                    Biaya kendaraan murni dilihat di halaman unit untuk servis, ban, insiden, dan pengeluaran unit.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <div>
                        <span className="card-header-title">Riwayat DO Driver</span>
                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Semua trip yang pernah dijalankan supir ini.</div>
                    </div>
                </div>
                <div className="card-body">
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead><tr><th>No. DO Internal</th><th>Tanggal</th><th>Customer</th><th>Kendaraan</th><th>Status</th></tr></thead>
                            <tbody>
                                {deliveryOrders.length === 0 ? (
                                    <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada riwayat DO untuk supir ini</td></tr>
                                ) : deliveryOrders.map(item => (
                                    <tr key={item._id}>
                                        <td>
                                            <Link href={`/delivery-orders/${item._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                                                {formatInternalDeliveryOrderNumber(item)}
                                            </Link>
                                            {getShipperReferenceCount(item) > 0 && <div className="text-muted text-sm font-mono">{formatShipperDeliveryOrderNumber(item)}</div>}
                                        </td>
                                        <td>{formatDate(item.date)}</td>
                                        <td>{canOpenCustomerPage && item.customerRef ? <Link href={`/customers/${item.customerRef}`} style={{ color: 'var(--color-primary)' }}>{item.customerName || '-'}</Link> : (item.customerName || '-')}</td>
                                        <td>{canOpenVehiclePage && item.vehicleRef ? <Link href={`/fleet/vehicles/${item.vehicleRef}`} style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate || '-'}</Link> : (item.vehiclePlate || '-')}</td>
                                        <td><span className={`badge badge-${DO_STATUS_MAP[item.status]?.color || 'gray'}`}>{DO_STATUS_MAP[item.status]?.label || item.status}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {deliveryOrders.length === 0 ? (
                            <div className="mobile-record-card"><div className="mobile-record-title">Belum ada riwayat DO untuk supir ini</div></div>
                        ) : deliveryOrders.map(item => (
                            <div key={item._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{formatInternalDeliveryOrderNumber(item)}</div>
                                        <div className="mobile-record-subtitle">{item.customerName || '-'} | {formatDate(item.date)}</div>
                                    </div>
                                    <span className={`badge badge-${DO_STATUS_MAP[item.status]?.color || 'gray'}`}>{DO_STATUS_MAP[item.status]?.label || item.status}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    {getShipperReferenceCount(item) > 0 && (
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">SJ Pengirim</span>
                                            <span className="mobile-record-value">{formatShipperDeliveryOrderNumber(item)}</span>
                                        </div>
                                    )}
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kendaraan</span>
                                        <span className="mobile-record-value">{item.vehiclePlate || '-'}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <Link className="btn btn-secondary" href={`/delivery-orders/${item._id}`}>Lihat Trip</Link>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {canViewDriverScores && <div className="card">
                <div className="card-header">
                    <div>
                        <span className="card-header-title">Riwayat Warning & Skors Supir</span>
                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Warning hilang setelah dibaca driver. Skors selesai otomatis saat masa berlakunya lewat.</div>
                    </div>
                </div>
                <div className="card-body">
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead><tr><th>Skor</th><th>Mulai Berlaku</th><th>Durasi</th><th>Jatuh Tempo</th><th>Status</th><th>Catatan</th></tr></thead>
                            <tbody>
                                {scores.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada riwayat scoring untuk supir ini</td></tr>
                                ) : scores.map(item => {
                                    const statusMeta = getDriverScoreStatusMeta(item);
                                    return (
                                        <tr key={item._id}>
                                            <td>{DRIVER_SCORE_TYPE_META[item.scoreType].label}</td>
                                            <td>{formatDate(item.effectiveDate)}</td>
                                            <td>{item.durationDays} hari</td>
                                            <td>{formatDate(item.dueDate)}</td>
                                            <td><span className={`badge ${statusMeta.badgeClass}`}>{statusMeta.label}</span></td>
                                            <td>{item.notes || '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {scores.length === 0 ? (
                            <div className="mobile-record-card"><div className="mobile-record-title">Belum ada riwayat scoring untuk supir ini</div></div>
                        ) : scores.map(item => {
                            const statusMeta = getDriverScoreStatusMeta(item);
                            return (
                                <div key={item._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{DRIVER_SCORE_TYPE_META[item.scoreType].label}</div>
                                            <div className="mobile-record-subtitle">{formatDate(item.effectiveDate)} - {formatDate(item.dueDate)}</div>
                                        </div>
                                        <span className={`badge ${statusMeta.badgeClass}`}>{statusMeta.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Durasi</span>
                                            <span className="mobile-record-value">{item.durationDays} hari</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Catatan</span>
                                            <span className="mobile-record-value">{item.notes || '-'}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>}

            <div className="card">
                <div className="card-header">
                    <div>
                        <span className="card-header-title">Riwayat Uang Jalan & Upah Trip</span>
                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                            Riwayat ini milik driver/trip. Di sini terlihat uang jalan yang diterima, biaya perjalanan, dan upah trip snapshot DO.
                        </div>
                    </div>
                </div>
                <div className="card-body">
                    {!canViewDriverVouchers ? (
                        <div style={{ padding: '0.85rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)' }}>
                            Detail uang jalan dan upah trip hanya ditampilkan untuk role yang punya akses modul Uang Jalan Trip.
                        </div>
                    ) : (
                        <>
                            <div className="table-wrapper table-desktop-only">
                                <table>
                                    <thead><tr><th>Bon</th><th>Tanggal</th><th>No. DO Internal</th><th>Kendaraan</th><th>Uang Jalan</th><th>Biaya Jalan</th><th>Upah Trip</th><th>Total Biaya</th><th>Penyelesaian Uang Jalan</th><th>Status</th></tr></thead>
                                    <tbody>
                                        {vouchers.length === 0 ? (
                                            <tr><td colSpan={10} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada riwayat uang jalan untuk supir ini</td></tr>
                                        ) : vouchers.map(item => {
                                            const statusConfig = DRIVER_VOUCHER_STATUS_MAP[item.status] || DRIVER_VOUCHER_STATUS_MAP.DRAFT;
                                            const {
                                                totalIssuedAmount,
                                                totalSpent,
                                                driverFeeAmount,
                                                totalClaimAmount,
                                                initialCashGiven,
                                                topUpAmount,
                                                balance,
                                            } = getDriverVoucherFinancialSummary(item);
                                            const settlementDisplay = buildDriverVoucherSettlementDisplay({
                                                balance,
                                                fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                                                    ...item,
                                                    topUpAmount,
                                                }),
                                                initialCashGiven,
                                                totalIssuedAmount,
                                                topUpAmount,
                                                totalClaimAmount,
                                            });
                                            return (
                                                <tr key={item._id}>
                                                    <td>
                                                        <Link href={`/driver-vouchers/${item._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                                                            {item.bonNumber}
                                                        </Link>
                                                        <div className="text-muted text-sm">{item.route || '-'}</div>
                                                    </td>
                                                    <td>{formatDate(item.issuedDate)}</td>
                                                    <td>{canOpenDeliveryOrderPage && item.deliveryOrderRef ? <Link href={`/delivery-orders/${item.deliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{item.doNumber || '-'}</Link> : (item.doNumber || '-')}</td>
                                                    <td>{canOpenVehiclePage && item.vehicleRef ? <Link href={`/fleet/vehicles/${item.vehicleRef}`} style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate || '-'}</Link> : (item.vehiclePlate || '-')}</td>
                                                    <td>{formatCurrency(totalIssuedAmount)}</td>
                                                    <td>{formatCurrency(totalSpent)}</td>
                                                    <td>{formatCurrency(driverFeeAmount)}</td>
                                                    <td>{formatCurrency(totalClaimAmount)}</td>
                                                    <td>
                                                        <div>{formatCurrency(balance < 0 ? settlementDisplay.amount : balance)}</div>
                                                        <div className="text-muted text-sm">{settlementDisplay.label}</div>
                                                    </td>
                                                    <td><span className={`badge ${statusConfig.cls}`}>{statusConfig.label}</span></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mobile-record-list">
                                {vouchers.length === 0 ? (
                                    <div className="mobile-record-card"><div className="mobile-record-title">Belum ada riwayat uang jalan untuk supir ini</div></div>
                                ) : vouchers.map(item => {
                                    const statusConfig = DRIVER_VOUCHER_STATUS_MAP[item.status] || DRIVER_VOUCHER_STATUS_MAP.DRAFT;
                                    const {
                                        totalIssuedAmount,
                                        totalSpent,
                                        driverFeeAmount,
                                        totalClaimAmount,
                                        initialCashGiven,
                                        balance,
                                        topUpAmount,
                                    } = getDriverVoucherFinancialSummary(item);
                                    const settlementDisplay = buildDriverVoucherSettlementDisplay({
                                        balance,
                                        fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                                            ...item,
                                            topUpAmount,
                                        }),
                                        initialCashGiven,
                                        totalIssuedAmount,
                                        topUpAmount,
                                        totalClaimAmount,
                                    });
                                    return (
                                        <div key={item._id} className="mobile-record-card">
                                            <div className="mobile-record-header">
                                                <div>
                                                    <div className="mobile-record-title">{canOpenDriverVoucherPage ? <Link href={`/driver-vouchers/${item._id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{item.bonNumber}</Link> : item.bonNumber}</div>
                                                    <div className="mobile-record-subtitle">{formatDate(item.issuedDate)} | {item.doNumber || '-'}</div>
                                                </div>
                                                <span className={`badge ${statusConfig.cls}`}>{statusConfig.label}</span>
                                            </div>
                                            <div className="mobile-record-meta">
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Kendaraan</span>
                                                    <span className="mobile-record-value">{canOpenVehiclePage && item.vehicleRef ? <Link href={`/fleet/vehicles/${item.vehicleRef}`} style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate || '-'}</Link> : (item.vehiclePlate || '-')}</span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Uang Jalan</span>
                                                    <span className="mobile-record-value">{formatCurrency(totalIssuedAmount)}</span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Biaya Jalan</span>
                                                    <span className="mobile-record-value">{formatCurrency(totalSpent)}</span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Upah Trip</span>
                                                    <span className="mobile-record-value">{formatCurrency(driverFeeAmount)}</span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Total Biaya</span>
                                                    <span className="mobile-record-value">{formatCurrency(totalClaimAmount)}</span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">{settlementDisplay.label}</span>
                                                    <span className="mobile-record-value">{formatCurrency(balance < 0 ? settlementDisplay.amount : balance)}</span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Top Up</span>
                                                    <span className="mobile-record-value">{formatCurrency(topUpAmount)}</span>
                                                </div>
                                            </div>
                                            <div className="mobile-record-actions">
                                                <Link className="btn btn-secondary" href={`/driver-vouchers/${item._id}`}>Lihat Uang Jalan</Link>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)' }}>
                                <div className="text-muted text-sm">Ringkasan</div>
                                <div style={{ marginTop: '0.35rem', lineHeight: 1.7 }}>
                                    Total biaya perjalanan tercatat: <strong>{formatCurrency(totalOperationalSpent)}</strong>.
                                    Total upah trip snapshot: <strong>{formatCurrency(totalDriverFee)}</strong>.
                                    Riwayat ini mengikuti trip yang dijalankan supir, bukan biaya kepemilikan kendaraan.
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
