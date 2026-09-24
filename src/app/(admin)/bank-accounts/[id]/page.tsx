'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRightLeft, CircleDollarSign, Edit, FileDown, Plus, Printer, Trash2, TrendingDown, TrendingUp, Wrench } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import Combobox from '@/components/Combobox';
import PageBackButton from '@/components/PageBackButton';
import { useApp, useToast } from '../../layout';
import { fetchAdminData, fetchAdminListPayload } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { formatBusinessDate, getBusinessDateValue } from '@/lib/business-date';
import {
    buildExpenseLookup,
    buildCustomerReceiptLookup,
    buildPaymentLookup,
    buildPurchaseLookup,
    buildRefundLookup,
    resolveBankTransactionSourceLink,
} from '@/lib/bank-transaction-links';
import { exportToExcel } from '@/lib/export';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
    createDefaultBankAdjustmentForm,
    type BankAdjustmentFormState,
} from '@/lib/bank-account-page-support';
import { escapePrintHtml, fetchCompanyProfile, openBrandedPrint, openPrintWindow } from '@/lib/print';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
    buildFinanceDateFilter,
    buildFinancePeriodLabel,
    FINANCE_PERIOD_MONTH_NAMES,
    getDefaultFinanceCustomDateFrom,
    getDefaultFinanceCustomDateTo,
    getDefaultFinancePeriod,
    getFinancePeriodDateRange,
    getFinancePeriodYearOptions,
    isFinancePeriodRangeReady,
    type FinancePeriodMode,
} from '@/lib/finance-period';
import type { BankAccount, BankTransaction, CompanyProfile, CustomerReceipt, CustomerOverpaymentRefund, Expense, FreightNota, Payment, Purchase } from '@/lib/types';
import { hasPageAccess, hasPermission } from '@/lib/rbac';

const BANK_TRANSACTION_PAGE_SIZE = DEFAULT_PAGE_SIZE;

type BankTransactionSummary = {
    totalIn: number;
    totalOut: number;
    totalTransactions: number;
};

const BANK_STYLES: Record<string, { color: string; gradient: string }> = {
    CASH: { color: '#14532d', gradient: 'linear-gradient(135deg, #14532d 0%, #16a34a 100%)' },
    BCA: { color: '#003b7b', gradient: 'linear-gradient(135deg, #003b7b 0%, #0060c7 100%)' },
    MANDIRI: { color: '#003868', gradient: 'linear-gradient(135deg, #003868 0%, #005ba5 100%)' },
    BRI: { color: '#00529c', gradient: 'linear-gradient(135deg, #00529c 0%, #0078d4 100%)' },
    BNI: { color: '#e35205', gradient: 'linear-gradient(135deg, #e35205 0%, #f97316 100%)' },
    BSI: { color: '#00a650', gradient: 'linear-gradient(135deg, #00a650 0%, #22c55e 100%)' },
    DEFAULT: { color: '#6b7280', gradient: 'linear-gradient(135deg, #374151 0%, #6b7280 100%)' },
};

function isCashAccount(account: Pick<BankAccount, 'accountType' | 'systemKey'>) {
    return account.accountType === 'CASH' || account.systemKey === 'cash-on-hand';
}

function getBankInfo(name: string) {
    const key = Object.keys(BANK_STYLES).find(bank => bank !== 'DEFAULT' && name.toUpperCase().includes(bank));
    return BANK_STYLES[key || 'DEFAULT'];
}

function BankDetailLogo({ name, size = 48 }: { name: string; size?: number }) {
    const info = getBankInfo(name);

    return (
        <div style={{ width: size, height: size, borderRadius: '0.6rem', background: info.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: size * 0.32, flexShrink: 0, boxShadow: `0 2px 8px ${info.color}40` }}>
            {name.slice(0, 3).toUpperCase()}
        </div>
    );
}

async function fetchEntity<T>(url: string) {
    const res = await fetch(url, { cache: 'no-store' });
    const result = await res.json();
    if (!res.ok) {
        throw new Error(result.error || 'Gagal memuat detail rekening');
    }
    return result.data as T;
}

async function fetchEntityByIds<T extends { _id: string }>(entity: string, ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
    if (uniqueIds.length === 0) {
        return [] as T[];
    }

    const rows = await Promise.all(
        uniqueIds.map(id =>
            fetchAdminData<T | null>(`/api/data?entity=${entity}&id=${encodeURIComponent(id)}`, `Gagal memuat relasi ${entity}`).catch(() => null)
        )
    );
    return rows.filter((row) => Boolean(row?._id)) as T[];
}

export default function BankAccountDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const accountId = params.id as string;
    const defaultPeriod = useMemo(() => getDefaultFinancePeriod(), []);
    const [account, setAccount] = useState<BankAccount | null>(null);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [transactionPage, setTransactionPage] = useState(1);
    const [transactionTotal, setTransactionTotal] = useState(0);
    const [transactionSummary, setTransactionSummary] = useState<BankTransactionSummary>({
        totalIn: 0,
        totalOut: 0,
        totalTransactions: 0,
    });
    const [relatedPayments, setRelatedPayments] = useState<Array<Pick<Payment, '_id' | 'invoiceRef' | 'receiptNumber'>>>([]);
    const [relatedReceipts, setRelatedReceipts] = useState<Array<Pick<CustomerReceipt, '_id' | 'receiptNumber'>>>([]);
    const [relatedRefunds, setRelatedRefunds] = useState<Array<Pick<CustomerOverpaymentRefund, '_id' | 'sourceInvoiceRef' | 'sourceReceiptRef' | 'sourceReceiptNumber' | 'sourceType'>>>([]);
    const [relatedExpenses, setRelatedExpenses] = useState<Array<Pick<Expense, '_id' | 'voucherRef' | 'boronganRef' | 'relatedVehicleRef' | 'relatedIncidentRef' | 'relatedMaintenanceRef'>>>([]);
    const [relatedPurchases, setRelatedPurchases] = useState<Array<Pick<Purchase, '_id' | 'purchaseNumber' | 'supplierName'>>>([]);
    const [relatedFreightNotas, setRelatedFreightNotas] = useState<Array<Pick<FreightNota, '_id'>>>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [periodMode, setPeriodMode] = useState<FinancePeriodMode>('all');
    const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
    const [year, setYear] = useState(defaultPeriod.year);
    const [dateFrom, setDateFrom] = useState(getDefaultFinanceCustomDateFrom());
    const [dateTo, setDateTo] = useState(getDefaultFinanceCustomDateTo());
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [transactionsLoading, setTransactionsLoading] = useState(true);
    const canExportBankAccount = user ? hasPermission(user, 'bankAccounts', 'export') : false;
    const canPrintBankAccount = user ? hasPermission(user, 'bankAccounts', 'print') : false;
    const canOpenInvoices = user ? hasPageAccess(user, 'invoices') : false;
    const canOpenDriverVouchers = user ? hasPageAccess(user, 'driverVouchers') : false;
    const canOpenDriverBorongans = user ? hasPageAccess(user, 'driverBorongans') : false;
    const canOpenVehicles = user ? hasPageAccess(user, 'vehicles') : false;
    const canOpenIncidents = user ? hasPageAccess(user, 'incidents') : false;
    const canOpenMaintenance = user ? hasPageAccess(user, 'maintenance') : false;
    const canOpenPurchases = user ? hasPageAccess(user, 'purchases') : false;
    const canManageBankAccount = user ? hasPermission(user, 'bankAccounts', 'update') : false;
    const [showAdjust, setShowAdjust] = useState(false);
    const [adjusting, setAdjusting] = useState(false);
    const [adjustReview, setAdjustReview] = useState(false);
    const [adjustEditId, setAdjustEditId] = useState<string | null>(null);
    const [adjustForm, setAdjustForm] = useState<BankAdjustmentFormState>(() => createDefaultBankAdjustmentForm(accountId));
    const [adjustDeleteConfirm, setAdjustDeleteConfirm] = useState<BankTransaction | null>(null);
    const [adjustDeleting, setAdjustDeleting] = useState(false);
    const [adjustEditOriginalDelta, setAdjustEditOriginalDelta] = useState(0);
    const dateRange = useMemo(
        () => getFinancePeriodDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
        [dateFrom, dateTo, monthIndex, periodMode, year]
    );
    const isPeriodReady = isFinancePeriodRangeReady(periodMode, dateRange.startDate, dateRange.endDate);
    const periodLabel = useMemo(
        () => buildFinancePeriodLabel({ mode: periodMode, monthIndex, year, startDate: dateRange.startDate, endDate: dateRange.endDate }),
        [dateRange.endDate, dateRange.startDate, monthIndex, periodMode, year]
    );
    const yearOptions = useMemo(() => getFinancePeriodYearOptions(year), [year]);

    const paymentsById = useMemo(() => buildPaymentLookup(relatedPayments), [relatedPayments]);
    const receiptsById = useMemo(() => buildCustomerReceiptLookup(relatedReceipts), [relatedReceipts]);
    const refundsById = useMemo(() => buildRefundLookup(relatedRefunds), [relatedRefunds]);
    const expensesById = useMemo(() => buildExpenseLookup(relatedExpenses), [relatedExpenses]);
    const purchasesById = useMemo(() => buildPurchaseLookup(relatedPurchases), [relatedPurchases]);
    const invoiceIdsWithPages = useMemo(() => new Set(relatedFreightNotas.map(nota => nota._id)), [relatedFreightNotas]);

    const buildTransactionListUrl = useCallback((page?: number, pageSize?: number) => {
        const filter: Record<string, unknown> = { bankAccountRef: accountId };
        const dateFilter = buildFinanceDateFilter(dateRange.startDate, dateRange.endDate);
        if (periodMode !== 'all' && dateFilter) {
            filter.date = dateFilter;
        }
        const params = new URLSearchParams({
            entity: 'bank-transactions',
            filter: JSON.stringify(filter),
            sortField: 'date',
            sortDir: 'desc',
        });
        if (page) params.set('page', String(page));
        if (pageSize) params.set('pageSize', String(pageSize));
        return `/api/data?${params.toString()}`;
    }, [accountId, dateRange.endDate, dateRange.startDate, periodMode]);

    const fetchAllAccountTransactions = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const rows: BankTransaction[] = [];

        do {
            const payload = await fetchAdminListPayload<BankTransaction>(
                buildTransactionListUrl(currentPage, pageSize),
                'Gagal memuat mutasi rekening'
            );
            const nextRows = payload.data || [];
            total = payload.meta?.total ?? nextRows.length;
            rows.push(...nextRows);
            if (nextRows.length === 0) break;
            currentPage += 1;
        } while (rows.length < total);

        return rows;
    }, [buildTransactionListUrl]);

    useEffect(() => {
        setTransactionPage(1);
    }, [accountId, dateFrom, dateTo, monthIndex, periodMode, year]);

    useEffect(() => {
        const loadAccountOverview = async () => {
            setLoading(true);
            setLoadNotice(null);
            try {
                const summaryParams = new URLSearchParams({
                    entity: 'bank-transactions-summary',
                    bankAccountRef: accountId,
                });
                if (periodMode !== 'all' && isPeriodReady) {
                    summaryParams.set('dateFrom', dateRange.startDate);
                    summaryParams.set('dateTo', dateRange.endDate);
                }
                const [accountData, summaryData, companyData] = await Promise.all([
                    fetchEntity<BankAccount | null>(`/api/data?entity=bank-accounts&id=${accountId}`),
                    isPeriodReady
                        ? fetchAdminData<BankTransactionSummary>(
                            `/api/data?${summaryParams.toString()}`,
                            'Gagal memuat ringkasan mutasi rekening'
                        )
                        : Promise.resolve({ totalIn: 0, totalOut: 0, totalTransactions: 0 }),
                    fetchCompanyProfile().catch(() => null),
                ]);

                setAccount(accountData);
                setTransactionSummary(summaryData || { totalIn: 0, totalOut: 0, totalTransactions: 0 });
                setTransactionTotal(summaryData?.totalTransactions || 0);
                setCompany(companyData || null);
            } catch (error) {
                const message = getAdminErrorMessage(error, 'Gagal memuat detail rekening');
                setLoadNotice(buildAdminLoadNotice(
                    message,
                    'Rekening',
                    'Halaman ini hanya bisa dilihat oleh role yang punya akses Rekening & Kas.'
                ));
                addToast('error', message);
            } finally {
                setLoading(false);
            }
        };

        void loadAccountOverview();
    }, [accountId, addToast, dateRange.endDate, dateRange.startDate, isPeriodReady, periodMode]);

    useEffect(() => {
        const loadTransactionPage = async () => {
            setTransactionsLoading(true);
            try {
                if (!isPeriodReady) {
                    setTransactions([]);
                    setTransactionTotal(0);
                    setRelatedPayments([]);
                    setRelatedReceipts([]);
                    setRelatedRefunds([]);
                    setRelatedExpenses([]);
                    setRelatedPurchases([]);
                    setRelatedFreightNotas([]);
                    return;
                }
                const payload = await fetchAdminListPayload<BankTransaction>(
                    buildTransactionListUrl(transactionPage, BANK_TRANSACTION_PAGE_SIZE),
                    'Gagal memuat mutasi rekening'
                );
                const transactionRows = (payload.data || []) as BankTransaction[];
                const paymentRows = await fetchEntityByIds<Pick<Payment, '_id' | 'invoiceRef' | 'receiptNumber'>>(
                    'payments',
                    transactionRows.map(transaction => transaction.relatedPaymentRef || '')
                );
                const receiptRows = await fetchEntityByIds<Pick<CustomerReceipt, '_id' | 'receiptNumber'>>(
                    'customer-receipts',
                    transactionRows.map(transaction => transaction.relatedReceiptRef || '')
                );
                const refundRows = await fetchEntityByIds<Pick<CustomerOverpaymentRefund, '_id' | 'sourceInvoiceRef' | 'sourceReceiptRef' | 'sourceReceiptNumber' | 'sourceType'>>(
                    'customer-overpayment-refunds',
                    transactionRows.map(transaction => transaction.relatedOverpaymentRefundRef || '')
                );
                const expenseRows = await fetchEntityByIds<Pick<Expense, '_id' | 'voucherRef' | 'boronganRef' | 'relatedVehicleRef' | 'relatedIncidentRef' | 'relatedMaintenanceRef'>>(
                    'expenses',
                    transactionRows.map(transaction => transaction.relatedExpenseRef || '')
                );
                const purchaseRows = await fetchEntityByIds<Pick<Purchase, '_id' | 'purchaseNumber' | 'supplierName'>>(
                    'purchases',
                    transactionRows.map(transaction => transaction.relatedPurchaseRef || '')
                );
                const freightNotaRows = await fetchEntityByIds<Pick<FreightNota, '_id'>>(
                    'freight-notas',
                    [
                        ...paymentRows.map(payment => payment.invoiceRef || ''),
                        ...refundRows.map(refund => refund.sourceInvoiceRef || ''),
                    ]
                );

                setTransactions(transactionRows);
                setTransactionTotal(payload.meta?.total ?? transactionRows.length);
                setRelatedPayments(paymentRows);
                setRelatedReceipts(receiptRows);
                setRelatedRefunds(refundRows);
                setRelatedExpenses(expenseRows);
                setRelatedPurchases(purchaseRows);
                setRelatedFreightNotas(freightNotaRows);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat mutasi rekening');
            } finally {
                setTransactionsLoading(false);
            }
        };

        void loadTransactionPage();
    }, [addToast, buildTransactionListUrl, isPeriodReady, transactionPage]);

    const fmt = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
    const fmtN = (n: number) => new Intl.NumberFormat('id-ID').format(n);
    const parseWholeMoneyLike = (value: unknown) =>
        parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 });
    const fmtDate = (d: string) => {
        try {
            return formatBusinessDate(d, 'id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
            return d;
        }
    };

    const typeConfig: Record<string, { label: string; badge: string; sign: string; icon: ReactNode }> = {
        CREDIT: { label: 'Masuk', badge: 'badge-success', sign: '+', icon: <TrendingUp size={14} /> },
        DEBIT: { label: 'Keluar', badge: 'badge-danger', sign: '-', icon: <TrendingDown size={14} /> },
        TRANSFER_IN: { label: 'Transfer Masuk', badge: 'badge-success', sign: '+', icon: <ArrowRightLeft size={14} /> },
        TRANSFER_OUT: { label: 'Transfer Keluar', badge: 'badge-danger', sign: '-', icon: <ArrowRightLeft size={14} /> },
        ADJUSTMENT: { label: 'Tambah Saldo', badge: 'badge-success', sign: '+', icon: <Wrench size={14} /> },
        ADJUSTMENT_DEBIT: { label: 'Kurangi Saldo', badge: 'badge-danger', sign: '-', icon: <Wrench size={14} /> },
    };

    const handleExportExcel = async () => {
        if (!isPeriodReady) {
            addToast('error', 'Rentang tanggal belum valid');
            return;
        }
        try {
            const allTransactions = await fetchAllAccountTransactions();
            await exportToExcel(
                allTransactions.map((tx) => ({
                    date: tx.date,
                    type: tx.type,
                    description: tx.description,
                    amount: parseWholeMoneyLike(tx.amount),
                    balanceAfter: parseWholeMoneyLike(tx.balanceAfter),
                })),
                [
                    { header: 'Tanggal', key: 'date', width: 15 },
                    { header: 'Tipe', key: 'type', width: 15 },
                    { header: 'Deskripsi', key: 'description', width: 35 },
                    { header: 'Jumlah', key: 'amount', width: 18 },
                    { header: 'Saldo Setelah', key: 'balanceAfter', width: 18 },
                ],
                `mutasi-${account?.bankName || 'akun'}-${getBusinessDateValue()}`,
                'Transaksi'
            );
            addToast('success', 'Excel mutasi rekening berhasil di-download');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel mutasi rekening');
        }
    };

    const openAdjustNew = () => {
        setAdjustEditId(null);
        setAdjustForm(createDefaultBankAdjustmentForm(accountId));
        setAdjustEditOriginalDelta(0);
        setAdjustReview(false);
        setShowAdjust(true);
    };

    const openAdjustEdit = (transaction: BankTransaction) => {
        const amt = parseWholeMoneyLike(transaction.amount);
        const origDelta = transaction.type === 'ADJUSTMENT_DEBIT' ? -amt : amt;
        setAdjustEditId(transaction._id);
        setAdjustForm({
            bankAccountRef: accountId,
            direction: transaction.type === 'ADJUSTMENT_DEBIT' ? 'out' : 'in',
            amount: amt,
            date: transaction.date || getBusinessDateValue(),
            description: transaction.description || '',
        });
        setAdjustEditOriginalDelta(origDelta);
        setAdjustReview(false);
        setShowAdjust(true);
    };

    const closeAdjust = () => {
        if (!adjusting) {
            setShowAdjust(false);
            setAdjustReview(false);
            setAdjustEditId(null);
        }
    };

    const handleAdjustSubmit = async () => {
        if (!adjustForm.amount || adjustForm.amount <= 0) {
            addToast('error', 'Nominal penyesuaian tidak valid');
            return;
        }
        if (!adjustForm.date) {
            addToast('error', 'Tanggal penyesuaian wajib diisi');
            return;
        }
        setAdjusting(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'bank-transactions',
                    action: adjustEditId ? 'adjust-update' : 'adjust',
                    data: adjustEditId ? { id: adjustEditId, ...adjustForm } : adjustForm,
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Penyesuaian saldo gagal');
                return;
            }
            addToast('success', adjustEditId ? 'Penyesuaian saldo berhasil diperbarui' : 'Saldo berhasil disesuaikan');
            closeAdjust();
            window.location.reload();
        } catch {
            addToast('error', 'Penyesuaian saldo gagal');
        } finally {
            setAdjusting(false);
        }
    };

    const handleAdjustDelete = async () => {
        if (!adjustDeleteConfirm) {
            return;
        }
        setAdjustDeleting(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'bank-transactions',
                    action: 'adjust-delete',
                    data: { id: adjustDeleteConfirm._id },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Hapus penyesuaian saldo gagal');
                return;
            }
            addToast('success', 'Penyesuaian saldo berhasil dihapus');
            setAdjustDeleteConfirm(null);
            window.location.reload();
        } catch {
            addToast('error', 'Hapus penyesuaian saldo gagal');
        } finally {
            setAdjustDeleting(false);
        }
    };

    const isActiveAdjustment = (transaction: BankTransaction) =>
        (transaction.type === 'ADJUSTMENT' || transaction.type === 'ADJUSTMENT_DEBIT') &&
        !transaction.reversesBankTransactionRef &&
        !transaction.replacedByBankTransactionRef;

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 120 }} /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    }

    if (!account) {
        return <div className="card"><div className="card-body"><div className="empty-state-title">{loadNotice?.title || 'Rekening tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div></div>;
    }

    const cashAccount = isCashAccount(account);
    const bankInfo = cashAccount ? BANK_STYLES.CASH : getBankInfo(account.bankName);
    const invoiceBankAccountRefs = Array.isArray(company?.invoiceSettings?.invoiceBankAccountRefs)
        ? company.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
    const isInvoiceAccount = invoiceBankAccountRefs.includes(account._id);
    const isDefaultInvoiceAccount = company?.invoiceSettings?.defaultInvoiceBankAccountRef === account._id;
    const currentBalance = parseWholeMoneyLike(account.currentBalance);
    const adjustNewDelta = adjustForm.direction === 'in' ? adjustForm.amount : -adjustForm.amount;
    const adjustPreviewAfterBalance = currentBalance - adjustEditOriginalDelta + adjustNewDelta;
    const totalIn = parseWholeMoneyLike(transactionSummary.totalIn);
    const totalOut = parseWholeMoneyLike(transactionSummary.totalOut);
    const totalTransactions = transactionSummary.totalTransactions || transactionTotal;

    const handlePrint = async () => {
        if (!isPeriodReady) {
            addToast('error', 'Rentang tanggal belum valid');
            return;
        }
        const printWindow = openPrintWindow('Menyiapkan print rekening...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba print lagi.');
            return;
        }
        try {
            const resolvedCompany = company ?? await fetchCompanyProfile().catch(() => null);
            const allTransactions = await fetchAllAccountTransactions();
            const rows = allTransactions.length === 0
                ? '<tr><td colspan="5" class="c">Belum ada transaksi</td></tr>'
                : allTransactions.map(tx => {
                    const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                    const amount = parseWholeMoneyLike(tx.amount);
                    const balanceAfter = parseWholeMoneyLike(tx.balanceAfter);
                    return `<tr>
                        <td>${escapePrintHtml(fmtDate(tx.date))}</td>
                        <td>${escapePrintHtml(cfg.label)}</td>
                        <td>${escapePrintHtml(tx.description || '-')}</td>
                        <td class="r ${cfg.sign === '+' ? 's' : 'd'} b">${escapePrintHtml(`${cfg.sign}${fmtN(amount)}`)}</td>
                        <td class="r b">${escapePrintHtml(fmtN(balanceAfter))}</td>
                    </tr>`;
                }).join('');

            openBrandedPrint({
                title: cashAccount ? `Mutasi Kas ${account.bankName}` : `Mutasi Rekening ${account.bankName}`,
                subtitle: `${account.accountNumber} - a.n. ${account.accountHolder}`,
                company: resolvedCompany,
                targetWindow: printWindow,
                bodyHtml: `
                    <div class="stats-row">
                        <div class="stat-box"><div class="stat-label">Saldo Saat Ini</div><div class="stat-value">${fmtN(currentBalance)}</div></div>
                        <div class="stat-box"><div class="stat-label">Total Masuk</div><div class="stat-value s">${fmtN(totalIn)}</div></div>
                        <div class="stat-box"><div class="stat-label">Total Keluar</div><div class="stat-value d">${fmtN(totalOut)}</div></div>
                    </div>
                    <table>
                        <thead>
                            <tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th class="r">Jumlah</th><th class="r">Saldo</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `,
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan dokumen print rekening');
        }
    };

    return (
        <div className="bank-detail-page">
            <div className="page-header bank-detail-header">
                <div className="bank-detail-main">
                    <PageBackButton href="/bank-accounts" />
                    <div className="bank-detail-identity">
                        <BankDetailLogo name={account.bankName} size={52} />
                        <div className="bank-detail-title-block">
                            <h1 className="page-title bank-detail-title">
                                {account.bankName}
                                {cashAccount && <span className="badge badge-success">Kas Tunai</span>}
                                {!cashAccount && isDefaultInvoiceAccount && <span className="badge badge-primary">Default Invoice</span>}
                                {!cashAccount && isInvoiceAccount && !isDefaultInvoiceAccount && <span className="badge badge-info">Tampil di Invoice</span>}
                            </h1>
                            <p className="page-subtitle bank-detail-account-line">{account.accountNumber} - a.n. {account.accountHolder}</p>
                        </div>
                    </div>
                </div>
                <div className="page-actions bank-detail-actions">
                    {canManageBankAccount && <button className="btn btn-secondary btn-sm" onClick={openAdjustNew}><CircleDollarSign size={15} /> Tambah Saldo</button>}
                    {canExportBankAccount && <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={15} /> Excel</button>}
                    {canPrintBankAccount && <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={15} /> Print</button>}
                </div>
            </div>

            <div className="bank-detail-summary-grid">
                <div className="card bank-detail-balance-card" style={{ background: bankInfo.gradient }}>
                    <div style={{ position: 'absolute', right: -15, top: -15, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                    <div className="card-body" style={{ padding: '1.1rem', position: 'relative' }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Saldo Saat Ini</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{fmt(currentBalance)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                            <TrendingUp size={14} style={{ color: 'var(--success)' }} /> Total Masuk
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--success)' }}>{fmt(totalIn)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                            <TrendingDown size={14} style={{ color: 'var(--danger)' }} /> Total Keluar
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--danger)' }}>{fmt(totalOut)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Transaksi</div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{totalTransactions}</div>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-header-title">Riwayat Transaksi</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{periodLabel} | {totalTransactions} transaksi</span>
                </div>
                <div className="table-toolbar">
                    <div className="table-toolbar-left finance-filter-toolbar">
                        <Combobox className="form-select finance-filter" value={periodMode} onChange={(v: string) => setPeriodMode(v as FinancePeriodMode)} options={[{ value: 'all', label: 'Semua Tanggal' }, { value: 'month', label: 'Bulanan' }, { value: 'year', label: 'Tahunan' }, { value: 'custom', label: 'Rentang Tanggal' }]} />
                        {periodMode === 'month' && (
                            <Combobox className="form-select finance-filter" value={String(monthIndex)} onChange={(v: string) => setMonthIndex(Number(v))} options={FINANCE_PERIOD_MONTH_NAMES.map((name, index) => ({ value: String(index), label: name }))} />
                        )}
                        {periodMode !== 'all' && periodMode !== 'custom' && (
                            <Combobox className="form-select finance-filter" value={String(year)} onChange={(v: string) => setYear(Number(v))} options={yearOptions.map(option => ({ value: String(option), label: String(option) }))} />
                        )}
                        {periodMode === 'custom' && (
                            <>
                                <input className="form-input finance-filter" type="date" value={dateFrom} onInput={event => setDateFrom(event.currentTarget.value)} onChange={event => setDateFrom(event.target.value)} />
                                <input className="form-input finance-filter" type="date" value={dateTo} onInput={event => setDateTo(event.currentTarget.value)} onChange={event => setDateTo(event.target.value)} />
                            </>
                        )}
                        {periodMode !== 'all' && (
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setPeriodMode('all');
                                    setMonthIndex(defaultPeriod.monthIndex);
                                    setYear(defaultPeriod.year);
                                    setDateFrom(getDefaultFinanceCustomDateFrom());
                                    setDateTo(getDefaultFinanceCustomDateTo());
                                    setTransactionPage(1);
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
                <div className="table-wrapper table-desktop-only" style={{ overflowX: 'auto' }}>
                    <table className="bank-transaction-table">
                        <thead>
                            <tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th style={{ textAlign: 'right' }}>Jumlah</th><th style={{ textAlign: 'right' }}>Saldo Setelah</th>{canManageBankAccount && <th style={{ textAlign: 'center' }}>Aksi</th>}</tr>
                        </thead>
                        <tbody suppressHydrationWarning>
                            {transactionsLoading ? (
                                [1, 2, 3, 4, 5].map(row => (
                                    <tr key={row}>
                                        <td><div className="skeleton skeleton-text" /></td>
                                        <td><div className="skeleton skeleton-text" /></td>
                                        <td><div className="skeleton skeleton-text" /></td>
                                        <td><div className="skeleton skeleton-text" /></td>
                                        <td><div className="skeleton skeleton-text" /></td>
                                    </tr>
                                ))
                            ) : transactions.length === 0 ? (
                                <tr><td colSpan={canManageBankAccount ? 6 : 5} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 }}>-</div>
                                    <div>Belum ada transaksi</div>
                                </td></tr>
                            ) : transactions.map(tx => {
                                const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                                const isPositive = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                                const amount = parseWholeMoneyLike(tx.amount);
                                const balanceAfter = parseWholeMoneyLike(tx.balanceAfter);
                                const sourceLink = resolveBankTransactionSourceLink({
                                    transaction: tx,
                                    paymentsById,
                        receiptsById,
                        refundsById,
                        expensesById,
                        purchasesById,
                        invoiceIdsWithPages,
                        permissions: {
                          canOpenInvoices,
                          canOpenDriverVouchers,
                          canOpenDriverBorongans,
                          canOpenVehicles,
                          canOpenIncidents,
                          canOpenMaintenance,
                          canOpenPurchases,
                        },
                      });
                                return (
                                    <tr key={tx._id} style={{ transition: 'background 0.1s' }}
                                        onMouseEnter={event => (event.currentTarget.style.background = 'var(--bg-secondary, #f8fafc)')}
                                        onMouseLeave={event => (event.currentTarget.style.background = '')}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(tx.date)}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                <span style={{ color: isPositive ? 'var(--success)' : 'var(--danger)', display: 'flex' }}>{cfg.icon}</span>
                                                <span className={`badge ${cfg.badge}`} style={{ fontSize: '0.68rem' }}>{cfg.label}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div>{tx.description}</div>
                                            {sourceLink && (
                                                <div style={{ marginTop: '0.2rem' }}>
                                                    <Link href={sourceLink.href} style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                        {sourceLink.label}
                                                    </Link>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: isPositive ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                                            {cfg.sign}{fmt(amount)}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>{fmt(balanceAfter)}</td>
                                        {canManageBankAccount && (
                                            <td style={{ textAlign: 'center' }}>
                                                {isActiveAdjustment(tx) && (
                                                    <div className="table-actions-col">
                                                        <button className="table-action-btn" title="Perbarui penyesuaian" onClick={() => openAdjustEdit(tx)}>
                                                            <Edit size={14} /> Perbarui
                                                        </button>
                                                        <button className="table-action-btn danger" title="Hapus penyesuaian" onClick={() => setAdjustDeleteConfirm(tx)}>
                                                            <Trash2 size={14} /> Hapus
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {transactionsLoading ? (
                        <div className="mobile-record-card">
                            <div className="skeleton skeleton-text" />
                            <div className="skeleton skeleton-text" />
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada transaksi</div>
                        </div>
                    ) : transactions.map(tx => {
                        const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                        const isPositive = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                        const amount = parseWholeMoneyLike(tx.amount);
                        const balanceAfter = parseWholeMoneyLike(tx.balanceAfter);
                        const sourceLink = resolveBankTransactionSourceLink({
                            transaction: tx,
                            paymentsById,
                      receiptsById,
                      refundsById,
                      expensesById,
                      purchasesById,
                      invoiceIdsWithPages,
                      permissions: {
                        canOpenInvoices,
                        canOpenDriverVouchers,
                        canOpenDriverBorongans,
                        canOpenVehicles,
                        canOpenIncidents,
                        canOpenMaintenance,
                        canOpenPurchases,
                      },
                    });
                        return (
                            <div key={tx._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{tx.description || cfg.label}</div>
                                        <div className="mobile-record-subtitle">{fmtDate(tx.date)}</div>
                                        {sourceLink && (
                                            <div style={{ marginTop: '0.2rem' }}>
                                                <Link href={sourceLink.href} style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                    {sourceLink.label}
                                                </Link>
                                            </div>
                                        )}
                                    </div>
                                    <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Jumlah</span>
                                        <span className="mobile-record-value" style={{ fontWeight: 700, color: isPositive ? 'var(--success)' : 'var(--danger)' }}>
                                            {cfg.sign}{fmt(amount)}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Saldo Setelah</span>
                                        <span className="mobile-record-value">{fmt(balanceAfter)}</span>
                                    </div>
                                </div>
                                {canManageBankAccount && isActiveAdjustment(tx) && (
                                    <div className="mobile-record-actions">
                                        <button className="table-action-btn" title="Perbarui penyesuaian" onClick={() => openAdjustEdit(tx)}>
                                            <Edit size={14} /> Perbarui
                                        </button>
                                        <button className="table-action-btn danger" title="Hapus penyesuaian" onClick={() => setAdjustDeleteConfirm(tx)}>
                                            <Trash2 size={14} /> Hapus
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                <AppPagination
                    page={transactionPage}
                    pageSize={BANK_TRANSACTION_PAGE_SIZE}
                    totalItems={transactionTotal}
                    onPageChange={setTransactionPage}
                    info={({ startIndex, endIndex, totalItems }) =>
                        totalItems === 0
                            ? 'Belum ada transaksi'
                            : `Menampilkan ${startIndex}-${endIndex} dari ${totalItems} transaksi`
                    }
                />
            </div>

            {canManageBankAccount && account && showAdjust && (
                <div className="modal-overlay" onClick={() => { if (!adjusting) closeAdjust(); }}>
                    <div
                        className="modal"
                        onClick={(event) => event.stopPropagation()}
                        style={{ maxWidth: 500 }}
                    >
                        <div className="modal-header">
                            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <CircleDollarSign size={18} /> {adjustReview ? 'Konfirmasi Penyesuaian Saldo' : (adjustEditId ? 'Perbarui Penyesuaian Saldo' : 'Tambah Saldo')}
                            </h3>
                            <button className="modal-close" onClick={closeAdjust} disabled={adjusting}>
                                x
                            </button>
                        </div>
                        <div className="modal-body">
                            {adjustReview ? (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: 12, padding: '1rem 1.1rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Rekening / Kas</label>
                                        <div className="font-medium">{account.bankName} - {account.accountNumber}</div>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Jenis Penyesuaian</label>
                                        <div className="font-medium">
                                            {adjustForm.direction === 'in' ? 'Tambah saldo (+)' : 'Kurangi saldo (-)'}
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Nominal (Rp)</label>
                                        <div className="font-medium">{fmt(adjustForm.amount)}</div>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Tanggal</label>
                                        <div className="font-medium">{adjustForm.date || '-'}</div>
                                    </div>
                                    {adjustForm.description && (
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label">Keterangan</label>
                                            <div className="font-medium">{adjustForm.description}</div>
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                                        <div>Saldo saat ini</div>
                                        <div className="font-medium">{fmt(currentBalance)}</div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                                        <div>Penyesuaian</div>
                                        <div className="font-medium" style={{ color: adjustForm.direction === 'in' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                            {fmt(adjustForm.direction === 'in' ? adjustForm.amount : -adjustForm.amount)}
                                        </div>
                                    </div>
                                    {adjustEditId && adjustEditOriginalDelta !== 0 && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                                            <div>Penyesuaian sebelumnya</div>
                                            <div className="font-medium" style={{ color: adjustEditOriginalDelta > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                                                {fmt(-adjustEditOriginalDelta)}
                                            </div>
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', borderTop: '1px solid var(--color-gray-200)', paddingTop: '0.75rem', fontWeight: 700 }}>
                                        <div>Saldo setelah penyesuaian</div>
                                        <div>{fmt(adjustPreviewAfterBalance)}</div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Rekening / Kas</label>
                                        <div className="font-medium">{account.bankName} - {account.accountNumber}</div>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Jenis Penyesuaian</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
                                            <button
                                                type="button"
                                                className={adjustForm.direction === 'in' ? 'btn btn-success' : 'btn btn-secondary'}
                                                disabled={adjusting}
                                                onClick={() => setAdjustForm({ ...adjustForm, direction: 'in' })}
                                            >
                                                Tambah saldo (+)
                                            </button>
                                            <button
                                                type="button"
                                                className={adjustForm.direction === 'out' ? 'btn btn-danger' : 'btn btn-secondary'}
                                                disabled={adjusting}
                                                onClick={() => setAdjustForm({ ...adjustForm, direction: 'out' })}
                                            >
                                                Kurangi saldo (-)
                                            </button>
                                        </div>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Nominal (Rp) *</label>
                                            <FormattedNumberInput
                                                allowDecimal={false}
                                                value={adjustForm.amount}
                                                disabled={adjusting}
                                                onValueChange={(value) => setAdjustForm({ ...adjustForm, amount: value })}
                                                placeholder="Ketik nominal penyesuaian"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Tanggal *</label>
                                            <input
                                                className="form-input"
                                                type="date"
                                                value={adjustForm.date}
                                                disabled={adjusting}
                                                onChange={(event) => setAdjustForm({ ...adjustForm, date: event.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Keterangan</label>
                                        <input
                                            className="form-input"
                                            type="text"
                                            value={adjustForm.description}
                                            disabled={adjusting}
                                            onChange={(event) => setAdjustForm({ ...adjustForm, description: event.target.value })}
                                            placeholder="Contoh: koreksi saldo awal, penyesuaian bank"
                                        />
                                    </div>
                                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                        Saldo saat ini: {fmt(currentBalance)} · Setelah penyesuaian: {fmt(adjustPreviewAfterBalance)}
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    if (adjustReview) {
                                        setAdjustReview(false);
                                    } else {
                                        closeAdjust();
                                    }
                                }}
                                disabled={adjusting}
                            >
                                {adjustReview ? 'Kembali' : 'Batal'}
                            </button>
                            {adjustReview ? (
                                <button className="btn btn-primary" onClick={handleAdjustSubmit} disabled={adjusting || !adjustForm.amount || adjustForm.amount <= 0}>
                                    <CircleDollarSign size={16} /> {adjusting ? 'Menyimpan...' : 'Simpan Penyesuaian'}
                                </button>
                            ) : (
                                <button className="btn btn-primary" onClick={() => setAdjustReview(true)} disabled={!adjustForm.amount || adjustForm.amount <= 0 || !adjustForm.date}>
                                    Lanjutkan
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {canManageBankAccount && adjustDeleteConfirm && (
                <div className="modal-overlay" onClick={() => { if (!adjustDeleting) setAdjustDeleteConfirm(null); }}>
                    <div className="modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 420 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Hapus Penyesuaian Saldo?</h3>
                        </div>
                        <div className="modal-body">
                            <p>
                                Penyesuaian <strong>{fmt(adjustDeleteConfirm.amount)}</strong> pada {account.bankName} ({fmtDate(adjustDeleteConfirm.date)}) akan dihapus permanen dan saldo rekening diperbarui.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setAdjustDeleteConfirm(null)} disabled={adjustDeleting}>Batal</button>
                            <button className="btn btn-danger" onClick={handleAdjustDelete} disabled={adjustDeleting}>
                                <Trash2 size={16} /> {adjustDeleting ? 'Menghapus...' : 'Hapus Penyesuaian'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
