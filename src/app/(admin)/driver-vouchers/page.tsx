'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle, ChevronDown, ChevronUp, Eye, Plus, Search, Receipt, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import Combobox from '@/components/Combobox';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';

import { formatDate, formatCurrency, getDriverVoucherFinancialSummary } from '@/lib/utils';
import { formatDriverVoucherRouteForDisplay } from '@/lib/driver-voucher-route';
import { buildDriverVoucherSettlementDisplay, inferDriverVoucherDisbursementCount } from '@/lib/driver-voucher-detail-support';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAdminCollectionData, fetchAdminListPayload, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
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
import type { BankAccount, DriverVoucher } from '@/lib/types';
import { hasPageAccess, hasPermission, normalizeUserRole } from '@/lib/rbac';
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
    const canOpenDriverPage = user ? hasPageAccess(user, 'drivers') : false;
    const canOpenDeliveryOrderPage = user ? hasPageAccess(user, 'trips') : false;
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
    const normalizedRole = user ? normalizeUserRole(user.role) : null;
    const canBatchSettle = normalizedRole === 'OWNER' || normalizedRole === 'FINANCE';
    const [selectedVouchers, setSelectedVouchers] = useState<Record<string, DriverVoucher>>({});
    const [batchCandidates, setBatchCandidates] = useState<DriverVoucher[]>([]);
    const [loadingBatchCandidates, setLoadingBatchCandidates] = useState(false);
    const [showBatchSettle, setShowBatchSettle] = useState(false);
    const [batchSettleDate, setBatchSettleDate] = useState(getBusinessDateValue());
    const [batchSettleBankRef, setBatchSettleBankRef] = useState('');
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [settlingBatch, setSettlingBatch] = useState(false);
    const [batchResult, setBatchResult] = useState<{ settled: Array<{ id: string; bonNumber: string }>; failed: Array<{ id: string; error: string }> } | null>(null);
    const [expandedVoucherId, setExpandedVoucherId] = useState<string | null>(null);
    const dateRange = useMemo(
        () => getFinancePeriodDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
        [dateFrom, dateTo, monthIndex, periodMode, year]
    );
    const isPeriodReady = isFinancePeriodRangeReady(periodMode, dateRange.startDate, dateRange.endDate);
    const yearOptions = useMemo(() => getFinancePeriodYearOptions(year), [year]);

    const isBatchSettleEligible = useCallback((voucher: DriverVoucher) => {
        if (voucher.status !== 'ISSUED' || !voucher.issueBankRef) {
            return false;
        }
        const { totalSpent, driverFeeAmount } = getDriverVoucherFinancialSummary(voucher);
        return totalSpent > 0 || driverFeeAmount > 0;
    }, []);

    const selectedCount = Object.keys(selectedVouchers).length;

    const toggleVoucherSelection = useCallback((voucher: DriverVoucher) => {
        setSelectedVouchers(current => {
            const next = { ...current };
            if (next[voucher._id]) {
                delete next[voucher._id];
            } else {
                next[voucher._id] = voucher;
            }
            return next;
        });
    }, []);

    const toggleSelectAll = useCallback(() => {
        setSelectedVouchers(current => {
            if (batchCandidates.length > 0 && batchCandidates.every(voucher => current[voucher._id])) {
                return {};
            }
            return Object.fromEntries(batchCandidates.map(voucher => [voucher._id, voucher]));
        });
    }, [batchCandidates]);

    const allCandidatesSelected = batchCandidates.length > 0 && batchCandidates.every(voucher => selectedVouchers[voucher._id]);

    const loadBatchCandidates = useCallback(async () => {
        setLoadingBatchCandidates(true);
        try {
            const params = new URLSearchParams({
                entity: 'driver-vouchers',
                filter: JSON.stringify({ status: 'ISSUED' }),
            });
            const vouchers = await fetchAllAdminCollectionData<DriverVoucher>(
                `/api/data?${params.toString()}`,
                'Gagal memuat uang jalan trip yang bisa diselesaikan'
            );
            setBatchCandidates(vouchers.filter(isBatchSettleEligible));
        } catch (error) {
            setBatchCandidates([]);
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat uang jalan trip yang bisa diselesaikan');
        } finally {
            setLoadingBatchCandidates(false);
        }
    }, [addToast, isBatchSettleEligible]);

    const openBatchSettle = useCallback(() => {
        setBatchSettleDate(getBusinessDateValue());
        setBatchSettleBankRef('');
        setBatchResult(null);
        setExpandedVoucherId(null);
        setSelectedVouchers({});
        setBatchCandidates([]);
        setShowBatchSettle(true);
        void loadBatchCandidates();
    }, [loadBatchCandidates]);

    const closeBatchSettle = useCallback(() => {
        if (settlingBatch) return;
        setShowBatchSettle(false);
        if (batchResult) {
            setSelectedVouchers({});
        }
    }, [batchResult, settlingBatch]);

    const loadBankAccounts = useCallback(async () => {
        if (bankAccounts.length > 0) return;
        try {
            const accounts = await fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat rekening');
            setBankAccounts((accounts || []).filter(account => account.active !== false));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat rekening');
        }
    }, [addToast, bankAccounts.length]);

    const handleBatchSettle = useCallback(async () => {
        if (settlingBatch || selectedCount === 0) return;
        if (!batchSettleDate) {
            addToast('error', 'Pilih tanggal penyelesaian');
            return;
        }
        setSettlingBatch(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-vouchers',
                    action: 'settle-batch',
                    data: {
                        ids: Object.keys(selectedVouchers),
                        date: batchSettleDate,
                        settlementBankRef: batchSettleBankRef || undefined,
                    },
                }),
            });
            const result = await res.json();

            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyelesaikan bon');
                return;
            }

            setBatchResult(result.data);
            addToast('success', 'Penyelesaian massal selesai diproses');
        } catch {
            addToast('error', 'Gagal menyelesaikan bon');
        } finally {
            setSettlingBatch(false);
        }
    }, [addToast, batchSettleBankRef, batchSettleDate, selectedCount, selectedVouchers, settlingBatch]);

    useEffect(() => {
        if (bankAccounts.length === 0) return;
        const activeBankRefSet = new Set(bankAccounts.map(account => account._id));
        if (batchSettleBankRef && !activeBankRefSet.has(batchSettleBankRef)) {
            setBatchSettleBankRef('');
        }
    }, [bankAccounts, batchSettleBankRef]);

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
        if (batchResult) {
            void loadVouchers();
        }
    }, [batchResult, loadVouchers]);

    const handleCloseBatchSettle = useCallback(() => {
        const shouldRefresh = Boolean(batchResult);
        closeBatchSettle();
        if (shouldRefresh) {
            void loadVouchers();
        }
    }, [batchResult, closeBatchSettle, loadVouchers]);

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
                    {canBatchSettle && (
                        <button className="btn btn-secondary" onClick={openBatchSettle}>
                            <CheckCircle size={18} /> Selesaikan Massal
                        </button>
                    )}
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
                        <Combobox className="form-select finance-filter" value={periodMode} onChange={(v: string) => setPeriodMode(v as FinancePeriodMode)} options={[{ value: 'all', label: 'Semua Tanggal' }, { value: 'month', label: 'Bulanan' }, { value: 'year', label: 'Tahunan' }, { value: 'custom', label: 'Rentang Tanggal' }]} />
                        {periodMode === 'month' && (
                            <Combobox className="form-select finance-filter" value={String(monthIndex)} onChange={(v: string) => setMonthIndex(Number(v))} options={FINANCE_PERIOD_MONTH_NAMES.map((name, index) => ({ value: String(index), label: name }))} />
                        )}
                        {periodMode !== 'all' && periodMode !== 'custom' && (
                            <Combobox className="form-select finance-filter" value={String(year)} onChange={(v: string) => setYear(Number(v))} options={yearOptions.map(option => String(option))} />
                        )}
                        {periodMode === 'custom' && (
                            <>
                                <input className="form-input finance-filter" type="date" value={dateFrom} onInput={event => setDateFrom(event.currentTarget.value)} onChange={event => setDateFrom(event.target.value)} />
                                <input className="form-input finance-filter" type="date" value={dateTo} onInput={event => setDateTo(event.currentTarget.value)} onChange={event => setDateTo(event.target.value)} />
                            </>
                        )}
                    </div>
                    <div className="table-toolbar-right">
                        <Combobox className="form-select finance-filter" value={statusFilter} onChange={(v: string) => setStatusFilter(v)} placeholder="Semua Status" options={[{ value: 'DRAFT', label: 'Draft' }, { value: 'ISSUED', label: 'Diberikan' }, { value: 'SETTLED', label: 'Selesai' }]} />
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
                                                <Link
                                                    href={`/driver-vouchers/${v._id}`}
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ padding: 0, color: 'var(--color-primary)', fontWeight: 600 }}
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    {v.bonNumber}
                                                </Link>
                                            </td>
                                            <td className="font-medium">{v.driverRef && canOpenDriverPage ? <Link href={`/fleet/drivers/${v.driverRef}`} style={{ color: 'var(--color-primary)' }}>{v.driverName || '-'}</Link> : (v.driverName || '-')}</td>
                                            <td className="text-muted">{formatDate(v.issuedDate)}</td>
                                            <td>{v.deliveryOrderRef && canOpenDeliveryOrderPage ? <Link href={`/delivery-orders/${v.deliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{v.doNumber || '-'}</Link> : (v.doNumber || '-')}</td>
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
                                            <div className="mobile-record-title"><Link href={`/driver-vouchers/${v._id}`} style={{ color: 'var(--color-primary)' }}>{v.bonNumber}</Link></div>
                                            <div className="mobile-record-subtitle">{v.driverRef && canOpenDriverPage ? <Link href={`/fleet/drivers/${v.driverRef}`} style={{ color: 'var(--color-primary)' }}>{v.driverName || '-'}</Link> : (v.driverName || '-')} | {formatDate(v.issuedDate)}</div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <span className={`badge ${status.cls}`}>{status.label}</span>
                                            {!v.issueBankRef && <span className="badge badge-warning">Perlu Rekonsiliasi</span>}
                                        </div>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">No. DO Internal</span>
                                            <span className="mobile-record-value">{v.deliveryOrderRef && canOpenDeliveryOrderPage ? <Link href={`/delivery-orders/${v.deliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{v.doNumber || '-'}</Link> : (v.doNumber || '-')}</span>
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

            {showBatchSettle && canBatchSettle && (
                <div className="modal-overlay" onClick={() => { if (!settlingBatch) handleCloseBatchSettle(); }}>
                    <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 640 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Selesaikan Uang Jalan Trip</h3>
                            <button className="modal-close" onClick={handleCloseBatchSettle} disabled={settlingBatch}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            {!batchResult ? (
                                <>
                                    <p className="text-muted" style={{ marginBottom: '1rem' }}>Pilih uang jalan trip yang ingin diselesaikan, lalu tentukan tanggal penyelesaian. Rekening opsional; setiap trip yang saldonya di atas nol tetap wajib memakai rekening (akan memakai rekening sumber dana trip bila tidak dipilih).</p>

                                    <div className="form-group">
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.4rem' }}>
                                            <label className="form-label" style={{ marginBottom: 0 }}>Pilih Uang Jalan Trip <span className="required">*</span></label>
                                            {batchCandidates.length > 0 && (
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={allCandidatesSelected} onChange={toggleSelectAll} disabled={settlingBatch} />
                                                    Pilih semua ({batchCandidates.length})
                                                </label>
                                            )}
                                        </div>
                                        <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.6rem', padding: '0.35rem 0', maxHeight: 260, overflowY: 'auto' }}>
                                            {loadingBatchCandidates ? (
                                                <div className="text-muted" style={{ padding: '0.85rem' }}>Memuat uang jalan trip...</div>
                                            ) : batchCandidates.length === 0 ? (
                                                <div className="text-muted" style={{ padding: '0.85rem' }}>Tidak ada uang jalan trip yang bisa diselesaikan.</div>
                                            ) : batchCandidates.map(voucher => {
                                                const summary = getDriverVoucherFinancialSummary(voucher);
                                                const expanded = expandedVoucherId === voucher._id;
                                                return (
                                                    <div key={voucher._id} style={{ borderBottom: '1px solid var(--color-gray-100)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.85rem' }}>
                                                            <input
                                                                type="checkbox"
                                                                aria-label={`Pilih ${voucher.bonNumber}`}
                                                                checked={Boolean(selectedVouchers[voucher._id])}
                                                                onChange={() => toggleVoucherSelection(voucher)}
                                                                disabled={settlingBatch}
                                                                style={{ flexShrink: 0 }}
                                                            />
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-sm"
                                                                style={{ flex: 1, justifyContent: 'space-between', padding: '0.2rem 0', borderRadius: 0 }}
                                                                onClick={() => setExpandedVoucherId(expanded ? null : voucher._id)}
                                                                disabled={settlingBatch}
                                                            >
                                                                <span style={{ fontWeight: 600 }}>{voucher.bonNumber}</span>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <span className="text-muted text-sm">{voucher.driverName || '-'}</span>
                                                                    <span style={{ fontWeight: 600, color: summary.balance < 0 ? 'var(--color-danger)' : summary.balance > 0 ? 'var(--color-success)' : undefined }}>
                                                                        {formatCurrency(summary.balance)}
                                                                    </span>
                                                                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                                </span>
                                                            </button>
                                                        </div>
                                                        {expanded && (
                                                            <div style={{ padding: '0.5rem 0.85rem 0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
                                                                <div><span className="text-muted text-sm">Total Diberikan</span><div className="font-medium">{formatCurrency(summary.totalIssuedAmount)}</div></div>
                                                                <div><span className="text-muted text-sm">Biaya Lain-lain</span><div className="font-medium">{formatCurrency(summary.totalSpent)}</div></div>
                                                                <div><span className="text-muted text-sm">Upah Borongan</span><div className="font-medium">{formatCurrency(summary.driverFeeAmount)}</div></div>
                                                                <div><span className="text-muted text-sm">Total Biaya</span><div className="font-medium">{formatCurrency(summary.totalClaimAmount)}</div></div>
                                                                <div style={{ gridColumn: '1 / -1' }}>
                                                                    <span className="text-muted text-sm">Rekening Sumber Dana</span>
                                                                    <div className="font-medium">{voucher.issueBankName || 'Tidak tercatat'}</div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Tanggal Selesaikan Trip <span className="required">*</span></label>
                                        <input type="date" className="form-input" value={batchSettleDate} onChange={event => setBatchSettleDate(event.target.value)} disabled={settlingBatch} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Rekening Penyelesaian</label>
                                        <div onFocus={loadBankAccounts}>
                                            <Combobox
                                                className="form-select"
                                                value={batchSettleBankRef}
                                                onChange={(v: string) => setBatchSettleBankRef(v)}
                                                disabled={settlingBatch}
                                                placeholder="Pilih rekening atau kas (opsional)"
                                                options={bankAccounts.map(account => ({ value: account._id, label: `${account.bankName} - ${account.accountNumber}${account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}` }))}
                                            />
                                        </div>
                                        <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>Dipakai untuk semua trip yang dipilih bila diberikan; tanpa ini masing-masing trip memakai rekening sumber dananya.</div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                        <div className="info-banner-text">
                                            {batchResult.settled.length} trip selesai, {batchResult.failed.length} gagal.
                                        </div>
                                    </div>
                                    {batchResult.settled.length > 0 && (
                                        <div style={{ marginBottom: '1rem' }}>
                                            <div className="text-muted text-sm" style={{ marginBottom: '0.35rem' }}>Berhasil</div>
                                            {batchResult.settled.map(entry => (
                                                <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid var(--color-gray-100)' }}>
                                                    <span style={{ fontWeight: 500 }}>{entry.bonNumber || entry.id}</span>
                                                    <span className="badge badge-green">Selesai</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {batchResult.failed.length > 0 && (
                                        <div>
                                            <div className="text-muted text-sm" style={{ marginBottom: '0.35rem' }}>Gagal</div>
                                            {batchResult.failed.map(entry => (
                                                <div key={entry.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--color-gray-100)' }}>
                                                    <div style={{ fontWeight: 500 }}>{Object.values(selectedVouchers).find(v => v._id === entry.id)?.bonNumber || entry.id}</div>
                                                    <div className="text-muted text-sm" style={{ color: 'var(--color-danger)' }}>{entry.error}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            {!batchResult ? (
                                <>
                                    <button className="btn btn-secondary" onClick={handleCloseBatchSettle} disabled={settlingBatch}>Batal</button>
                                    <button className="btn btn-primary" onClick={handleBatchSettle} disabled={settlingBatch || selectedCount === 0}>
                                        <CheckCircle size={16} /> {settlingBatch ? 'Memproses...' : `Selesaikan ${selectedCount} Trip`}
                                    </button>
                                </>
                            ) : (
                                <button className="btn btn-primary" onClick={handleCloseBatchSettle}>
                                    Tutup
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
