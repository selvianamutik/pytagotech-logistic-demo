'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast, useApp } from '../layout';
import { Eye, Pencil, Plus, Save, Search, Trash2, Wallet, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import ExpenseEditModal from '@/components/ExpenseEditModal';
import { fetchAdminData, fetchAdminListPayload } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    fetchExpenseReferences,
    fetchOptionalCollection,
    getExpenseAccountLabel,
    getExpenseDescriptionLabel,
    getExpenseRelatedDocuments,
    getExpenseSource,
    getExpenseVehicleLabel,
    mapById,
    type ExpenseLinkPermissions,
    type ExpenseReferenceMaps,
} from '@/lib/expense-related-docs';
import {
    getDefaultInventoryReportPeriod,
    getInventoryReportDateRange,
    getInventoryReportYearOptions,
    INVENTORY_REPORT_MONTH_NAMES,
    type InventoryReportPeriodMode,
} from '@/lib/inventory-report-period';
import { formatDate, formatCurrency } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { BankAccount, DriverBorongan, DriverVoucher, Expense, ExpenseCategory, Incident, Maintenance, Vehicle } from '@/lib/types';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { isManualExpenseCategory } from '@/lib/expense-category-scope';

type ExpensePaymentMode = 'paid' | 'payable';

type ExpenseCategoryTotal = {
    name: string;
    total: number;
};

const DEFAULT_EXPENSE_FORM = () => ({
    categoryRef: '',
    date: getBusinessDateValue(),
    amount: 0,
    note: '',
    description: '',
    privacyLevel: 'internal' as 'internal' | 'ownerOnly',
    paymentMode: 'paid' as ExpensePaymentMode,
    bankAccountRef: '',
    bankAccountName: '',
});

const LINK_STYLE = { color: 'var(--color-primary)', fontWeight: 600 } as const;

export default function ExpensesPage() {
    const { addToast } = useToast();
    const { user } = useApp();
    const defaultPeriod = getDefaultInventoryReportPeriod();
    const [items, setItems] = useState<Expense[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [driverVouchers, setDriverVouchers] = useState<DriverVoucher[]>([]);
    const [driverBorongans, setDriverBorongans] = useState<DriverBorongan[]>([]);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalExpenses, setFilteredTotalExpenses] = useState(0);
    const [grandTotal, setGrandTotal] = useState(0);
    const [transactionCount, setTransactionCount] = useState(0);
    const [avgAmount, setAvgAmount] = useState(0);
    const [categoryTotals, setCategoryTotals] = useState<ExpenseCategoryTotal[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState(false);
    const [editExpense, setEditExpense] = useState<Expense | null>(null);
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>('desc');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [bankAccountFilter, setBankAccountFilter] = useState('');
    const [privacyFilter, setPrivacyFilter] = useState('');
    const [periodMode, setPeriodMode] = useState<InventoryReportPeriodMode>('month');
    const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
    const [year, setYear] = useState(defaultPeriod.year);
    const [dateFrom, setDateFrom] = useState(`${defaultPeriod.year}-${String(defaultPeriod.monthIndex + 1).padStart(2, '0')}-01`);
    const [dateTo, setDateTo] = useState(getBusinessDateValue());
    const [form, setForm] = useState(DEFAULT_EXPENSE_FORM);

    const isOwner = user ? hasPermission(user, 'expenses', 'update') : false;
    const canCreateExpenses = user ? hasPermission(user, 'expenses', 'create') : false;
    const canDeleteExpenses = user ? hasPermission(user, 'expenses', 'delete') : false;
    const canUpdateExpenses = user ? hasPermission(user, 'expenses', 'update') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user, 'vehicles') : false;
    const canOpenBankAccountPage = user ? hasPageAccess(user, 'bankAccounts') : false;
    const canOpenDriverVoucherPage = user ? hasPageAccess(user, 'driverVouchers') : false;
    const canOpenDriverBoronganPage = user ? hasPageAccess(user, 'driverBorongans') : false;
    const canOpenIncidentPage = user ? hasPageAccess(user, 'incidents') : false;
    const canOpenMaintenancePage = user ? hasPageAccess(user, 'maintenance') : false;
    const canOpenOrderPage = user ? hasPageAccess(user, 'orders') : false;
    const vehicleMap = useMemo(() => new Map(vehicles.map(vehicle => [vehicle._id, vehicle])), [vehicles]);
    const accountMap = useMemo(() => new Map(bankAccounts.map(account => [account._id, account])), [bankAccounts]);
    const voucherMap = useMemo(() => mapById(driverVouchers), [driverVouchers]);
    const boronganMap = useMemo(() => mapById(driverBorongans), [driverBorongans]);
    const incidentMap = useMemo(() => mapById(incidents), [incidents]);
    const maintenanceMap = useMemo(() => mapById(maintenances), [maintenances]);
    const referenceMaps = useMemo<ExpenseReferenceMaps>(() => ({
        accountMap,
        boronganMap,
        incidentMap,
        maintenanceMap,
        vehicleMap,
        voucherMap,
    }), [accountMap, boronganMap, incidentMap, maintenanceMap, vehicleMap, voucherMap]);
    const linkPermissions = useMemo<ExpenseLinkPermissions>(() => ({
        canOpenBankAccountPage,
        canOpenDriverBoronganPage,
        canOpenDriverVoucherPage,
        canOpenIncidentPage,
        canOpenMaintenancePage,
        canOpenOrderPage,
        canOpenVehiclePage,
    }), [canOpenBankAccountPage, canOpenDriverBoronganPage, canOpenDriverVoucherPage, canOpenIncidentPage, canOpenMaintenancePage, canOpenOrderPage, canOpenVehiclePage]);
    const manualCategories = useMemo(
        () => categories.filter(isManualExpenseCategory),
        [categories]
    );
    const yearOptions = useMemo(() => getInventoryReportYearOptions(year), [year]);
    const dateRange = useMemo(
        () => getInventoryReportDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
        [dateFrom, dateTo, monthIndex, periodMode, year]
    );
    const isValidDateRange = Boolean(dateRange.startDate && dateRange.endDate && dateRange.startDate <= dateRange.endDate);
    const isPaidNow = form.paymentMode === 'paid';
    const hasValidPaymentAccount = Boolean(form.bankAccountRef && accountMap.has(form.bankAccountRef));
    const isFormValid = Boolean(
        form.categoryRef
        && manualCategories.some(category => category._id === form.categoryRef)
        && form.date
        && /^\d{4}-\d{2}-\d{2}$/.test(form.date)
        && Number(form.amount) > 0
        && (form.paymentMode === 'payable' || hasValidPaymentAccount)
    );

    useEffect(() => {
        setPage(1);
    }, [bankAccountFilter, categoryFilter, dateFrom, dateTo, monthIndex, periodMode, privacyFilter, search, year]);

    const buildExpensesQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'expenses',
            page: String(targetPage),
            pageSize: String(targetPageSize),
        });

        if (dateSortDir) {
            params.set('sortField', 'date');
            params.set('sortDir', dateSortDir);
        }

        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'note,description,categoryName,relatedVehiclePlate');
        }

        const filter: Record<string, string> = {};
        if (categoryFilter) filter.categoryRef = categoryFilter;
        if (bankAccountFilter) filter.bankAccountRef = bankAccountFilter;
        if (isOwner && privacyFilter) {
            filter.privacyLevel = privacyFilter;
        }
        if (!isOwner) {
            filter.privacyLevel = 'internal';
        }
        if (Object.keys(filter).length > 0) {
            params.set('filter', JSON.stringify(filter));
        }

        if (isValidDateRange) {
            params.set('dateFrom', dateRange.startDate);
            params.set('dateTo', dateRange.endDate);
        }

        return params.toString();
    }, [bankAccountFilter, categoryFilter, dateRange.endDate, dateRange.startDate, dateSortDir, isOwner, isValidDateRange, page, privacyFilter, search]);

    const buildExpensesSummaryQuery = useCallback(() => {
        const params = new URLSearchParams({ entity: 'expenses-summary' });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'note,description,categoryName,relatedVehiclePlate');
        }

        const filter: Record<string, string> = {};
        if (categoryFilter) filter.categoryRef = categoryFilter;
        if (bankAccountFilter) filter.bankAccountRef = bankAccountFilter;
        if (isOwner && privacyFilter) {
            filter.privacyLevel = privacyFilter;
        }
        if (!isOwner) {
            filter.privacyLevel = 'internal';
        }
        if (Object.keys(filter).length > 0) {
            params.set('filter', JSON.stringify(filter));
        }
        if (isValidDateRange) {
            params.set('dateFrom', dateRange.startDate);
            params.set('dateTo', dateRange.endDate);
        }

        return params.toString();
    }, [bankAccountFilter, categoryFilter, dateRange.endDate, dateRange.startDate, isOwner, isValidDateRange, privacyFilter, search]);

    const loadExpenses = useCallback(async () => {
        if (!user) return;
        if (periodMode === 'custom' && !isValidDateRange) {
            setItems([]);
            setFilteredTotalExpenses(0);
            setGrandTotal(0);
            setTransactionCount(0);
            setAvgAmount(0);
            setCategoryTotals([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const [listPayload, summaryPayload, categoryRows, accountRows, vehicleRows] = await Promise.all([
                fetchAdminListPayload<Expense>(`/api/data?${buildExpensesQuery()}`, 'Gagal memuat data pengeluaran'),
                fetchAdminData<{
                    grandTotal?: number;
                    transactionCount?: number;
                    avgAmount?: number;
                    categoryTotals?: ExpenseCategoryTotal[];
                }>(`/api/data?${buildExpensesSummaryQuery()}`, 'Gagal memuat ringkasan pengeluaran'),
                fetchOptionalCollection<ExpenseCategory[]>('/api/data?entity=expense-categories', []),
                fetchOptionalCollection<BankAccount[]>('/api/data?entity=bank-accounts', []),
                hasPermission(user, 'vehicles', 'view')
                    ? fetchOptionalCollection<Vehicle[]>('/api/data?entity=vehicles', [])
                    : Promise.resolve([] as Vehicle[]),
            ]);

            const listItems = (listPayload.data || []) as Expense[];
            const referenceRows = await fetchExpenseReferences(listItems);
            setItems(listItems);
            setFilteredTotalExpenses(listPayload.meta?.total || 0);
            setGrandTotal(summaryPayload.grandTotal || 0);
            setTransactionCount(summaryPayload.transactionCount || 0);
            setAvgAmount(summaryPayload.avgAmount || 0);
            setCategoryTotals(summaryPayload.categoryTotals || []);
            setCategories((categoryRows || []).filter(category => category.active !== false));
            setBankAccounts((accountRows || []).filter(account => account.active !== false));
            setVehicles((vehicleRows || []).filter(vehicle => vehicle.status !== 'SOLD'));
            setDriverVouchers(referenceRows.voucherRows);
            setDriverBorongans(referenceRows.boronganRows);
            setIncidents(referenceRows.incidentRows);
            setMaintenances(referenceRows.maintenanceRows);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data pengeluaran');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildExpensesQuery, buildExpensesSummaryQuery, isValidDateRange, periodMode, user]);

    useEffect(() => {
        void loadExpenses();
    }, [loadExpenses]);

    const openCreateModal = () => {
        setForm(DEFAULT_EXPENSE_FORM());
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!canCreateExpenses) {
            addToast('error', 'Tidak punya akses mencatat pengeluaran');
            return;
        }
        if (!form.categoryRef || !form.amount) {
            addToast('error', 'Kategori dan nominal wajib');
            return;
        }
        if (!form.date || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
            addToast('error', 'Tanggal pengeluaran wajib valid');
            return;
        }
        const category = manualCategories.find(item => item._id === form.categoryRef);
        if (!category) {
            addToast('error', 'Kategori ini tidak boleh dipakai untuk pengeluaran manual');
            return;
        }
        if (isPaidNow && !hasValidPaymentAccount) {
            addToast('error', 'Pilih rekening/kas yang dipakai untuk membayar');
            return;
        }
        setSaving(true);
        try {
            const { paymentMode, bankAccountRef, bankAccountName, ...expenseFormData } = form;
            const expenseData: Record<string, unknown> = {
                ...expenseFormData,
                categoryName: category?.name || '',
            };
            if (paymentMode === 'paid') {
                expenseData.bankAccountRef = bankAccountRef;
                expenseData.bankAccountName = bankAccountName;
            }

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'expenses', data: expenseData }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal mencatat pengeluaran');
                return;
            }
            addToast('success', 'Pengeluaran dicatat');
            setShowModal(false);
            setForm(DEFAULT_EXPENSE_FORM());
            if (page !== 1) {
                setPage(1);
            } else {
                await loadExpenses();
            }
        } catch {
            addToast('error', 'Gagal mencatat pengeluaran');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!canDeleteExpenses) return;
        setDeletingId(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'expenses', action: 'delete', data: { id } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menghapus pengeluaran');
                return;
            }
            addToast('success', 'Pengeluaran dihapus');
            setDeleteId(null);
            setItems(prev => prev.filter(expense => expense._id !== id));
        } catch {
            addToast('error', 'Gagal menghapus pengeluaran');
        } finally {
            setDeletingId(false);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Pengeluaran</h1></div>
                <div className="page-actions">
                    {canCreateExpenses && <button className="btn btn-primary" onClick={openCreateModal}><Plus size={18} /> Tambah Pengeluaran</button>}
                </div></div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Wallet size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Pengeluaran</div>
                        <div className="kpi-value" style={{ fontSize: '1.1rem', color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Search size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Jumlah Transaksi</div>
                        <div className="kpi-value">{transactionCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Wallet size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Rata-rata / Transaksi</div>
                        <div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(Math.round(avgAmount))}</div>
                    </div>
                </div>
            </div>

            {!loading && categoryTotals.length > 1 && (
                <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Breakdown per Kategori</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {categoryTotals.map(category => (
                            <div key={category.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.4rem 0.75rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{category.name}</span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: 700 }}>{formatCurrency(category.total)}</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>({grandTotal > 0 ? Math.round((category.total / grandTotal) * 100) : 0}%)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left finance-filter-toolbar">
                        <div className="table-search finance-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari catatan, kategori, kendaraan..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                        <select className="form-select finance-filter" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
                            <option value="">Semua Kategori</option>
                            {categories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}
                        </select>
                        <select className="form-select finance-filter" value={bankAccountFilter} onChange={event => setBankAccountFilter(event.target.value)}>
                            <option value="">Semua Rekening/Kas</option>
                            {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                        </select>
                        {isOwner && (
                            <select className="form-select finance-filter" value={privacyFilter} onChange={event => setPrivacyFilter(event.target.value)}>
                                <option value="">Semua Privasi</option>
                                <option value="internal">Internal</option>
                                <option value="ownerOnly">Owner Only</option>
                            </select>
                        )}
                        <select className="form-select finance-filter" value={periodMode} onChange={event => setPeriodMode(event.target.value as InventoryReportPeriodMode)}>
                            <option value="month">Bulanan</option>
                            <option value="year">Tahunan</option>
                            <option value="custom">Rentang Tanggal</option>
                        </select>
                        {periodMode === 'month' && (
                            <select className="form-select finance-filter" value={monthIndex} onChange={event => setMonthIndex(Number(event.target.value))}>
                                {INVENTORY_REPORT_MONTH_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
                            </select>
                        )}
                        {periodMode !== 'custom' && (
                            <select className="form-select finance-filter" value={year} onChange={event => setYear(Number(event.target.value))}>
                                {yearOptions.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                        )}
                        {periodMode === 'custom' && (
                            <>
                                <input className="form-input finance-filter" type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
                                <input className="form-input finance-filter" type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
                            </>
                        )}
                        {(search || categoryFilter || bankAccountFilter || privacyFilter || periodMode !== 'month' || monthIndex !== defaultPeriod.monthIndex || year !== defaultPeriod.year) && (
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setSearch('');
                                    setCategoryFilter('');
                                    setBankAccountFilter('');
                                    setPrivacyFilter('');
                                    setPeriodMode('month');
                                    setMonthIndex(defaultPeriod.monthIndex);
                                    setYear(defaultPeriod.year);
                                    setDateFrom(`${defaultPeriod.year}-${String(defaultPeriod.monthIndex + 1).padStart(2, '0')}-01`);
                                    setDateTo(getBusinessDateValue());
                                }}
                            >
                                Reset
                            </button>
                        )}
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th><SortableTableHeader label="Tanggal" direction={dateSortDir} onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')} /></th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th>{isOwner && <th>Privacy</th>}<th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{Array.from({ length: isOwner ? 6 : 5 }, (_, j) => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalExpenses === 0 ? <tr><td colSpan={isOwner ? 6 : 5}><div className="empty-state"><Wallet size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada pengeluaran</div></div></td></tr> :
                                    items.map(expense => {
                                        const relatedDocs = getExpenseRelatedDocuments(expense, referenceMaps, linkPermissions);
                                        const vehicleLabel = getExpenseVehicleLabel(expense, vehicleMap);
                                        const accountLabel = getExpenseAccountLabel(expense, accountMap);
                                        const expenseSource = getExpenseSource(expense, referenceMaps, linkPermissions);
                                        return (
                                            <tr key={expense._id}>
                                                <td className="text-muted">{formatDate(expense.date)}</td>
                                                <td><span className="badge badge-gray">{expense.categoryName}</span></td>
                                                <td>
                                                    <div><Link href={`/expenses/${expense._id}`} style={LINK_STYLE}>{getExpenseDescriptionLabel(expense)}</Link></div>
                                                    {relatedDocs.length > 0 && (
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                                                            dokumen{' '}
                                                            {relatedDocs.map((doc, index) => (
                                                                <span key={doc.key}>
                                                                    {index > 0 && <span> · </span>}
                                                                    <span>{doc.kind}: </span>
                                                                    {doc.href ? (
                                                                        <Link href={doc.href} style={LINK_STYLE}>
                                                                            {doc.label}
                                                                        </Link>
                                                                    ) : (
                                                                        <span>{doc.label}</span>
                                                                    )}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {vehicleLabel && (
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                                                            kendaraan{' '}
                                                            {expense.relatedVehicleRef && canOpenVehiclePage ? (
                                                                <Link href={`/fleet/vehicles/${expense.relatedVehicleRef}`} style={LINK_STYLE}>
                                                                    {vehicleLabel}
                                                                </Link>
                                                            ) : (
                                                                vehicleLabel
                                                            )}
                                                        </div>
                                                    )}
                                                    {accountLabel && (
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                                                            via{' '}
                                                            {expense.bankAccountRef && canOpenBankAccountPage ? (
                                                                <Link href={`/bank-accounts/${expense.bankAccountRef}`} style={LINK_STYLE}>
                                                                    {accountLabel}
                                                                </Link>
                                                            ) : (
                                                                accountLabel
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="font-medium">{formatCurrency(expense.amount)}</td>
                                                {isOwner && <td><span className={`badge ${expense.privacyLevel === 'ownerOnly' ? 'badge-purple' : 'badge-info'}`}>{expense.privacyLevel === 'ownerOnly' ? 'Owner Only' : 'Internal'}</span></td>}
                                                <td>
                                                    <div className="table-actions-col">
                                                        <Link href={`/expenses/${expense._id}`} className="table-action-btn">
                                                            <Eye size={14} /> Lihat Detail
                                                        </Link>
                                                        {canUpdateExpenses && expenseSource.editable && (
                                                            <button className="table-action-btn" onClick={() => setEditExpense(expense)} aria-label={`Edit ${getExpenseDescriptionLabel(expense)}`}>
                                                                <Pencil size={14} /> Edit
                                                            </button>
                                                        )}
                                                        {canDeleteExpenses && (
                                                            <button className="table-action-btn" onClick={() => setDeleteId(expense._id)} disabled={deletingId} aria-label={`Hapus ${getExpenseDescriptionLabel(expense)}`}>
                                                                <Trash2 size={14} style={{ color: '#ef4444' }} /> Hapus
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            {!loading && filteredTotalExpenses > 0 && (
                                <tr style={{ background: 'var(--color-bg-secondary)', borderTop: '2px solid var(--color-border)' }}>
                                    <td colSpan={3} className="font-semibold" style={{ textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>TOTAL</td>
                                    <td className="font-semibold" style={{ color: 'var(--color-danger)', fontSize: '1rem' }}>{formatCurrency(grandTotal)}</td>
                                    {isOwner && <td />}
                                    <td />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalExpenses === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada pengeluaran</div>
                                <div className="mobile-record-subtitle">Catat pengeluaran pertama untuk mulai melihat rangkuman kas operasional.</div>
                            </div>
                        ) : (
                            items.map(expense => {
                                const relatedDocs = getExpenseRelatedDocuments(expense, referenceMaps, linkPermissions);
                                const vehicleLabel = getExpenseVehicleLabel(expense, vehicleMap);
                                const accountLabel = getExpenseAccountLabel(expense, accountMap);
                                const expenseSource = getExpenseSource(expense, referenceMaps, linkPermissions);
                                return (
                                    <div key={expense._id} className="mobile-record-card">
                                        <div className="mobile-record-header">
                                            <div>
                                                <div className="mobile-record-title"><Link href={`/expenses/${expense._id}`} style={LINK_STYLE}>{getExpenseDescriptionLabel(expense)}</Link></div>
                                                <div className="mobile-record-subtitle">{formatDate(expense.date)} | {expense.categoryName || 'Tanpa kategori'}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(expense.amount)}</div>
                                                {isOwner && <span className={`badge ${expense.privacyLevel === 'ownerOnly' ? 'badge-purple' : 'badge-info'}`}>{expense.privacyLevel === 'ownerOnly' ? 'Owner Only' : 'Internal'}</span>}
                                            </div>
                                        </div>
                                        <div className="mobile-record-meta">
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Kategori</span>
                                                <span className="mobile-record-value">{expense.categoryName || '-'}</span>
                                            </div>
                                            {relatedDocs.length > 0 && (
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Dokumen</span>
                                                    <span className="mobile-record-value">
                                                        {relatedDocs.map((doc, index) => (
                                                            <span key={doc.key}>
                                                                {index > 0 && <span> · </span>}
                                                                <span>{doc.kind}: </span>
                                                                {doc.href ? (
                                                                    <Link href={doc.href} style={LINK_STYLE}>
                                                                        {doc.label}
                                                                    </Link>
                                                                ) : (
                                                                    doc.label
                                                                )}
                                                            </span>
                                                        ))}
                                                    </span>
                                                </div>
                                            )}
                                            {vehicleLabel && (
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Kendaraan</span>
                                                    <span className="mobile-record-value">
                                                        {expense.relatedVehicleRef && canOpenVehiclePage ? (
                                                            <Link href={`/fleet/vehicles/${expense.relatedVehicleRef}`} style={LINK_STYLE}>
                                                                {vehicleLabel}
                                                            </Link>
                                                        ) : (
                                                            vehicleLabel
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                            {accountLabel && (
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Dibayar dari</span>
                                                    <span className="mobile-record-value">
                                                        {expense.bankAccountRef && canOpenBankAccountPage ? (
                                                            <Link href={`/bank-accounts/${expense.bankAccountRef}`} style={LINK_STYLE}>
                                                                {accountLabel}
                                                            </Link>
                                                        ) : (
                                                            accountLabel
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="mobile-record-actions">
                                            <Link href={`/expenses/${expense._id}`} className="table-action-btn">
                                                <Eye size={14} /> Lihat Detail
                                            </Link>
                                            {canUpdateExpenses && expenseSource.editable && (
                                                <button className="table-action-btn" onClick={() => setEditExpense(expense)} aria-label={`Edit ${getExpenseDescriptionLabel(expense)}`}>
                                                    <Pencil size={14} /> Edit
                                                </button>
                                            )}
                                            {canDeleteExpenses && (
                                                <button className="table-action-btn" onClick={() => setDeleteId(expense._id)} disabled={deletingId} aria-label={`Hapus ${getExpenseDescriptionLabel(expense)}`}>
                                                    <Trash2 size={14} style={{ color: '#ef4444' }} /> Hapus
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
                {filteredTotalExpenses > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalExpenses}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} transaksi | Total: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</strong>
                            </>
                        )}
                    />
                )}
            </div>


            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Pengeluaran</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Kategori <span className="required">*</span></label>
                                <select className="form-select" value={form.categoryRef} onChange={event => setForm({ ...form, categoryRef: event.target.value })} disabled={saving}>
                                    <option value="">Pilih kategori umum</option>{manualCategories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} disabled={saving} /></div>
                                <div className="form-group"><label className="form-label">Nominal <span className="required">*</span></label><FormattedNumberInput allowDecimal={false} value={form.amount} onValueChange={value => setForm({ ...form, amount: value })} disabled={saving} placeholder="Ketik nominal pengeluaran" /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan/Deskripsi</label><textarea className="form-textarea" rows={2} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} disabled={saving} /></div>
                            <div className="form-group"><label className="form-label">Status Pembayaran <span className="required">*</span></label>
                                <select className="form-select" value={form.paymentMode} onChange={event => {
                                    const nextMode = event.target.value as ExpensePaymentMode;
                                    setForm(current => ({
                                        ...current,
                                        paymentMode: nextMode,
                                        ...(nextMode === 'payable' ? { bankAccountRef: '', bankAccountName: '' } : {}),
                                    }));
                                }} disabled={saving}>
                                    <option value="paid">Sudah dibayar dari rekening/kas</option>
                                    <option value="payable">Belum dibayar (catat hutang biaya)</option>
                                </select>
                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                                    {isPaidNow
                                        ? 'Saldo rekening/kas akan langsung berkurang.'
                                        : 'Tidak mengurangi kas sekarang; masuk catatan hutang biaya.'}
                                </div>
                            </div>
                            <div className="form-group"><label className="form-label">Rekening / Kas Pembayaran {isPaidNow && <span className="required">*</span>}</label>
                                <select className="form-select" value={isPaidNow ? form.bankAccountRef : ''} onChange={event => {
                                    const account = bankAccounts.find(item => item._id === event.target.value);
                                    setForm({ ...form, bankAccountRef: event.target.value, bankAccountName: account?.bankName || '' });
                                }} disabled={saving || !isPaidNow}>
                                    <option value="">{isPaidNow ? 'Pilih rekening/kas' : 'Tidak dipakai karena belum dibayar'}</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                            </div>
                            {isOwner && <div className="form-group"><label className="form-label">Privacy Level</label>
                                <select className="form-select" value={form.privacyLevel} onChange={event => setForm({ ...form, privacyLevel: event.target.value as 'internal' | 'ownerOnly' })} disabled={saving}>
                                    <option value="internal">Internal</option><option value="ownerOnly">Owner Only</option>
                                </select>
                            </div>}
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving || !isFormValid}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
            {canDeleteExpenses && deleteId && (
                <div className="modal-overlay" onClick={() => { if (!deletingId) setDeleteId(null); }}>
                    <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 420 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Hapus Pengeluaran?</h3>
                        </div>
                        <div className="modal-body">
                            <p>Catatan pengeluaran akan dihapus permanen dan jurnal akunting serta transaksi kas terkait akan dibatalkan. Jika sudah terhubung ke detail insiden atau bon trip, sistem akan menolak penghapusan ini.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteId(null)} disabled={deletingId}>Batal</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteId)} disabled={deletingId}>
                                <Trash2 size={16} /> {deletingId ? 'Menghapus...' : 'Hapus'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {editExpense && (
                <ExpenseEditModal
                    expense={editExpense}
                    open={Boolean(editExpense)}
                    isOwner={canUpdateExpenses}
                    onClose={() => setEditExpense(null)}
                    onSaved={() => void loadExpenses()}
                />
            )}
        </div>
    );
}
