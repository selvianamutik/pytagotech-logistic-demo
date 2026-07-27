'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Plus, Search, Receipt } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';

import { formatDate, formatCurrency, getDriverVoucherFinancialSummary } from '@/lib/utils';
import { formatDriverVoucherRouteForDisplay } from '@/lib/driver-voucher-route';
import { buildDriverVoucherSettlementDisplay, inferDriverVoucherDisbursementCount } from '@/lib/driver-voucher-detail-support';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAdminListPayload } from '@/lib/api/admin-client';
import {
    buildFinanceDateFilter,
    FINANCE_PERIOD_MONTH_NAMES,
    getDefaultFinanceCustomDateFrom,
    getDefaultFinanceCustomDateTo,
    getDefaultFinancePeriod,
    getFinancePeriodDateRange,
    getFinancePeriodYearOptions,
    isFinancePeriodRangeReady,
    type FinancePeriodMode,
} from '@/lib/finance-period';
import type { DriverVoucher } from '@/lib/types';
import { hasPermission } from '@/lib/rbac';
import { useApp, useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'badge-gray' },
    ISSUED: { label: 'Diberikan', cls: 'badge-blue' },
    SETTLED: { label: 'Selesai', cls: 'badge-green' },
};

const getNextVoucherAction = (voucher: DriverVoucher) => {
    const { balance } = getDriverVoucherFinancialSummary(voucher);
    if (voucher.status === 'DRAFT') {
        return 'Lengkapi lalu terbitkan';
    }
    if (voucher.status === 'ISSUED') {
        if (!voucher.issueBankRef) {
            return 'Rekonsiliasi sumber dana';
        }
        if (balance !== 0) {
            return 'Top up atau selesaikan trip';
        }
        return 'Selesaikan trip';
    }
    return 'Arsip / cek histori';
};

export default function DriverVouchersPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const defaultPeriod = useMemo(() => getDefaultFinancePeriod(), []);
    const [items, setItems] = useState<DriverVoucher[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [periodMode, setPeriodMode] = useState<FinancePeriodMode>('all');
    const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
    const [year, setYear] = useState(defaultPeriod.year);
    const [dateFrom, setDateFrom] = useState(getDefaultFinanceCustomDateFrom());
    const [dateTo, setDateTo] = useState(getDefaultFinanceCustomDateTo());
    const [page, setPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [queueCounts, setQueueCounts] = useState({ issued: 0, draft: 0, settled: 0 });
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);
    const canCreateVoucher = user ? hasPermission(user, 'driverVouchers', 'create') : false;
    const dateRange = useMemo(
        () => getFinancePeriodDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
        [dateFrom, dateTo, monthIndex, periodMode, year]
    );
    const isPeriodReady = isFinancePeriodRangeReady(periodMode, dateRange.startDate, dateRange.endDate);
    const yearOptions = useMemo(() => getFinancePeriodYearOptions(year), [year]);

    const buildVoucherQuery = useCallback((
        targetPage = page,
        targetPageSize = DEFAULT_PAGE_SIZE,
        options: { statusOverride?: string; countOnly?: boolean } = {}
    ) => {
        const params = new URLSearchParams({
            entity: 'driver-vouchers',
            page: String(targetPage),
            pageSize: String(targetPageSize),
        });
        if (options.countOnly) {
            params.set('countOnly', '1');
        }
        if (dateSortDir) {
            params.set('sortField', 'issuedDate');
            params.set('sortDir', dateSortDir);
        } else {
            params.set('sortPreset', 'work-queue');
        }
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'bonNumber,driverName,doNumber');
        }
        const filter: Record<string, unknown> = {};
        const effectiveStatus = options.statusOverride ?? statusFilter;
        if (effectiveStatus) {
            filter.status = effectiveStatus;
        }
        const dateFilter = buildFinanceDateFilter(dateRange.startDate, dateRange.endDate);
        if (periodMode !== 'all' && dateFilter) {
            filter.issuedDate = dateFilter;
        }
        if (Object.keys(filter).length > 0) {
            params.set('filter', JSON.stringify(filter));
        }
        return params.toString();
    }, [dateRange.endDate, dateRange.startDate, dateSortDir, page, periodMode, search, statusFilter]);

    const countVouchersByStatus = useCallback(async (status: DriverVoucher['status']) => {
        const payload = await fetchAdminListPayload<DriverVoucher>(
            `/api/data?${buildVoucherQuery(1, 1, { statusOverride: status, countOnly: true })}`,
            'Gagal memuat ringkasan uang jalan trip'
        );
        return payload.meta?.total || 0;
    }, [buildVoucherQuery]);

    const loadVouchers = useCallback(async () => {
        setLoading(true);
        try {
            if (!isPeriodReady) {
                setItems([]);
                setTotalItems(0);
                setQueueCounts({ issued: 0, draft: 0, settled: 0 });
                return;
            }
            const [listPayload, issuedCount, draftCount, settledCount] = await Promise.all([
                fetchAdminListPayload<DriverVoucher>(`/api/data?${buildVoucherQuery()}`, 'Gagal memuat uang jalan trip'),
                countVouchersByStatus('ISSUED'),
                countVouchersByStatus('DRAFT'),
                countVouchersByStatus('SETTLED'),
            ]);

            setItems(listPayload.data || []);
            setTotalItems(listPayload.meta?.total || 0);
            setQueueCounts({
                issued: issuedCount,
                draft: draftCount,
                settled: settledCount,
            });
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat uang jalan trip');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildVoucherQuery, countVouchersByStatus, isPeriodReady]);

    useEffect(() => {
        void loadVouchers();
    }, [loadVouchers]);

    useEffect(() => {
        setPage(1);
    }, [dateFrom, dateTo, monthIndex, periodMode, search, statusFilter, year]);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Uang Jalan Trip</h1>
                </div>
                <div className="page-actions">
                    {canCreateVoucher && (
                        <button className="btn btn-primary" onClick={() => router.push('/driver-vouchers/new')}>
                            <Plus size={18} /> Terbitkan Uang Jalan
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Belum Diselesaikan</div>
                        <div className="kpi-value">{queueCounts.issued}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Draft</div>
                        <div className="kpi-value">{queueCounts.draft}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Selesai</div>
                        <div className="kpi-value">{queueCounts.settled}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left finance-filter-toolbar">
                        <div className="table-search finance-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari no. bon, supir, no. DO internal..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                        <select className="form-select finance-filter" value={periodMode} onChange={event => setPeriodMode(event.target.value as FinancePeriodMode)}>
                            <option value="all">Semua Tanggal</option>
                            <option value="month">Bulanan</option>
                            <option value="year">Tahunan</option>
                            <option value="custom">Rentang Tanggal</option>
                        </select>
                        {periodMode === 'month' && (
                            <select className="form-select finance-filter" value={monthIndex} onChange={event => setMonthIndex(Number(event.target.value))}>
                                {FINANCE_PERIOD_MONTH_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
                            </select>
                        )}
                        {periodMode !== 'all' && periodMode !== 'custom' && (
                            <select className="form-select finance-filter" value={year} onChange={event => setYear(Number(event.target.value))}>
                                {yearOptions.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                        )}
                        {periodMode === 'custom' && (
                            <>
                                <input className="form-input finance-filter" type="date" value={dateFrom} onInput={event => setDateFrom(event.currentTarget.value)} onChange={event => setDateFrom(event.target.value)} />
                                <input className="form-input finance-filter" type="date" value={dateTo} onInput={event => setDateTo(event.currentTarget.value)} onChange={event => setDateTo(event.target.value)} />
                            </>
                        )}
                    </div>
                    <div className="table-toolbar-right">
                        <select className="form-select finance-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            <option value="DRAFT">Draft</option>
                            <option value="ISSUED">Diberikan</option>
                            <option value="SETTLED">Selesai</option>
                        </select>
                        {(search || statusFilter || periodMode !== 'all') && (
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setSearch('');
                                    setStatusFilter('');
                                    setPeriodMode('all');
                                    setMonthIndex(defaultPeriod.monthIndex);
                                    setYear(defaultPeriod.year);
                                    setDateFrom(getDefaultFinanceCustomDateFrom());
                                    setDateTo(getDefaultFinanceCustomDateTo());
                                    setPage(1);
                                }}
                            >
                                Reset
                            </button>
                        )}
                    </div>
                </div>
                {!isPeriodReady && (
                    <div className="info-banner" style={{ margin: '0 1rem 1rem' }}>
                        <div className="info-banner-text">Lengkapi tanggal awal dan akhir, lalu pastikan tanggal awal tidak melebihi tanggal akhir.</div>
                    </div>
                )}

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>No. Bon</th>
                                <th>Supir</th>
                                <th><SortableTableHeader label="Tanggal" direction={dateSortDir} onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')} /></th>
                                <th>No. DO Internal</th>
                                <th>Rute</th>
                                <th>Total Diberikan</th>
                                <th>Total Biaya</th>
                                <th>Penyelesaian Uang Jalan</th>
                                <th>Status</th>
                                <th>Tindak Lanjut</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map(i => (
                                    <tr key={i}>
                                        {Array.from({ length: 11 }).map((_, j) => (
                                            <td key={j}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : totalItems === 0 ? (
                                <tr>
                                    <td colSpan={11}>
                                        <div className="empty-state">
                                            <Receipt size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada uang jalan trip</div>
                                            <div className="empty-state-text">Terbitkan uang jalan yang tertaut ke DO internal untuk mencatat uang jalan awal, top up, biaya lain-lain, upah borongan, dan penyelesaian uang jalan</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                items.map(v => {
                                    const status = STATUS_MAP[v.status] || { label: v.status, cls: 'badge-gray' };
                                    const {
                                        totalClaimAmount,
                                        initialCashGiven,
                                        topUpAmount,
                                        totalIssuedAmount,
                                        balance,
                                    } = getDriverVoucherFinancialSummary(v);
                                    const routeLabel = formatDriverVoucherRouteForDisplay(v.route) || v.route || '-';
                                    const settlementDisplay = buildDriverVoucherSettlementDisplay({
                                        balance,
                                        fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                                            ...v,
                                            topUpAmount,
                                        }),
                                        initialCashGiven,
                                        topUpAmount,
                                        totalIssuedAmount,
                                        totalClaimAmount,
                                    });

                                    return (
                                        <tr key={v._id}>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ padding: 0, color: 'var(--color-primary)', fontWeight: 600 }}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        router.push(`/driver-vouchers/${v._id}`);
                                                    }}
                                                >
                                                    {v.bonNumber}
                                                </button>
                                            </td>
                                            <td className="font-medium">{v.driverName || '-'}</td>
                                            <td className="text-muted">{formatDate(v.issuedDate)}</td>
                                            <td>{v.doNumber || '-'}</td>
                                            <td className="text-muted">{routeLabel}</td>
                                            <td className="font-medium">{formatCurrency(totalIssuedAmount)}</td>
                                            <td className="font-medium">{formatCurrency(totalClaimAmount)}</td>
                                            <td
                                                className="font-medium"
                                                style={{ color: balance < 0 ? '#ef4444' : balance > 0 ? '#16a34a' : undefined }}
                                            >
                                                <div>{formatCurrency(balance < 0 ? settlementDisplay.amount : balance)}</div>
                                                <div className="text-muted text-sm">{settlementDisplay.label}</div>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start' }}>
                                                    <span className={`badge ${status.cls}`}>{status.label}</span>
                                                    {!v.issueBankRef && <span className="badge badge-warning">Perlu Rekonsiliasi</span>}
                                                </div>
                                            </td>
                                            <td><span style={{ fontWeight: 500 }}>{getNextVoucherAction(v)}</span></td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        router.push(`/driver-vouchers/${v._id}`);
                                                    }}
                                                >
                                                    <Eye size={14} /> Lihat
                                                </button>
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
                        {totalItems === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada uang jalan trip</div>
                                <div className="mobile-record-subtitle">Terbitkan uang jalan yang tertaut ke DO internal untuk mencatat uang jalan awal, top up, biaya lain-lain, upah borongan, dan penyelesaian uang jalan.</div>
                            </div>
                        ) : items.map(v => {
                            const status = STATUS_MAP[v.status] || { label: v.status, cls: 'badge-gray' };
                            const {
                                totalSpent,
                                driverFeeAmount,
                                totalClaimAmount,
                                initialCashGiven,
                                topUpAmount,
                                totalIssuedAmount,
                                balance,
                            } = getDriverVoucherFinancialSummary(v);
                            const routeLabel = formatDriverVoucherRouteForDisplay(v.route) || v.route || '-';
                            const settlementDisplay = buildDriverVoucherSettlementDisplay({
                                balance,
                                fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                                    ...v,
                                    topUpAmount,
                                }),
                                initialCashGiven,
                                topUpAmount,
                                totalIssuedAmount,
                                totalClaimAmount,
                            });

                            return (
                                <div key={v._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{v.bonNumber}</div>
                                            <div className="mobile-record-subtitle">{v.driverName || '-'} | {formatDate(v.issuedDate)}</div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <span className={`badge ${status.cls}`}>{status.label}</span>
                                            {!v.issueBankRef && <span className="badge badge-warning">Perlu Rekonsiliasi</span>}
                                        </div>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">No. DO Internal</span>
                                            <span className="mobile-record-value">{v.doNumber || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Rute</span>
                                            <span className="mobile-record-value">{routeLabel}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Bon Pertama</span>
                                            <span className="mobile-record-value">{formatCurrency(initialCashGiven)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Total Bon Tambahan</span>
                                            <span className="mobile-record-value">{formatCurrency(topUpAmount)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Total Diberikan</span>
                                            <span className="mobile-record-value">{formatCurrency(totalIssuedAmount)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Biaya Lain-lain</span>
                                            <span className="mobile-record-value">{formatCurrency(totalSpent)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Upah Borongan</span>
                                            <span className="mobile-record-value">{formatCurrency(driverFeeAmount)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Total Biaya</span>
                                            <span className="mobile-record-value">{formatCurrency(totalClaimAmount)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">{settlementDisplay.label}</span>
                                            <span className="mobile-record-value" style={{ fontWeight: 700, color: balance < 0 ? '#ef4444' : balance > 0 ? '#16a34a' : undefined }}>
                                                {formatCurrency(balance < 0 ? settlementDisplay.amount : balance)}
                                            </span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tindak Lanjut</span>
                                            <span className="mobile-record-value">{getNextVoucherAction(v)}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button type="button" className="btn btn-secondary" onClick={() => router.push(`/driver-vouchers/${v._id}`)}>
                                            <Eye size={14} /> Lihat
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {totalItems > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} trip</>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
