'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, FileText, Printer, FileDown, Receipt } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAdminCollectionData, fetchAdminListPayload, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { formatFreightNotaDisplayWeight, normalizeFreightNotaBillingMode } from '@/lib/freight-nota-billing';
import { deriveReceivableStatus, formatDate, formatCurrency, formatQuantity, getReceivableNetAmount, PAYMENT_METHOD_MAP } from '@/lib/utils';
import { buildFreightNotaPrintDocument, openBrandedPrint, openPrintWindow, fetchCompanyProfile, formatFreightNotaDisplayNumber, resolveDocumentIssuerProfile } from '@/lib/print';
import { exportFreightNotaDetail } from '@/lib/export';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
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
import type { BankAccount, CompanyProfile, Customer, CustomerOverpayment, CustomerReceipt, FreightNota, FreightNotaItem, Payment } from '@/lib/types';
import { hasPageAccess, hasPermission } from '@/lib/rbac';

import { useApp, useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Lunas', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
    VOID: { label: 'Dibatalkan', color: 'secondary' },
};

const getNextInvoiceAction = (status: string, nota: FreightNota, remainingAmount: number) => {
    if (status === 'VOID') {
        return 'Arsip pembatalan';
    }
    if (status === 'UNPAID') {
        return 'Tagih atau catat penerimaan';
    }
    if (status === 'PARTIAL') {
        return remainingAmount > 0 ? 'Follow up sisa pembayaran invoice' : 'Cek alokasi penerimaan';
    }
    return parseFormattedNumberish(nota.totalAdjustmentAmount || 0, { maxFractionDigits: 0 }) > 0
        ? 'Arsip + cek potongan invoice'
        : 'Arsip / cetak';
};

const parseWholeMoneyLike = (value: unknown) =>
    Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);

function mergeFreightNotas(...groups: FreightNota[][]) {
    const byId = new Map<string, FreightNota>();
    groups.flat().forEach(nota => {
        if (nota._id) byId.set(nota._id, nota);
    });
    return [...byId.values()];
}

function sortInvoiceRows(rows: FreightNota[], dateSortDir: SortDirection | null) {
    if (dateSortDir) {
        const direction = dateSortDir === 'asc' ? 1 : -1;
        return [...rows].sort((left, right) => {
            const dateCompare = String(left.issueDate || '').localeCompare(String(right.issueDate || '')) * direction;
            if (dateCompare !== 0) return dateCompare;
            return String(left.notaNumber || '').localeCompare(String(right.notaNumber || '')) * direction;
        });
    }

    const statusRank: Record<string, number> = { UNPAID: 0, PARTIAL: 1, PAID: 2, VOID: 99 };
    return [...rows].sort((left, right) => {
        const statusCompare = (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99);
        if (statusCompare !== 0) return statusCompare;
        const dateCompare = String(left.issueDate || '').localeCompare(String(right.issueDate || ''));
        if (dateCompare !== 0) return dateCompare;
        return String((right as { _createdAt?: string })._createdAt || '').localeCompare(String((left as { _createdAt?: string })._createdAt || ''));
    });
}

function filterInvoiceRowsForCurrentView(rows: FreightNota[], params: {
    statusFilter: string;
    periodMode: FinancePeriodMode;
    dateFrom?: string;
    dateTo?: string;
}) {
    return rows.filter(nota => {
        if (params.statusFilter && nota.status !== params.statusFilter) return false;
        if (params.periodMode !== 'all' && params.dateFrom && params.dateTo) {
            const issueDate = nota.issueDate || '';
            if (issueDate < params.dateFrom || issueDate > params.dateTo) return false;
        }
        return true;
    });
}

export default function NotaListPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const defaultPeriod = useMemo(() => getDefaultFinancePeriod(), []);
    const [items, setItems] = useState<FreightNota[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [overpayments, setOverpayments] = useState<CustomerOverpayment[]>([]);
    const [queueOverpayments, setQueueOverpayments] = useState<CustomerOverpayment[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState(searchParams.get('q') || '');
    const [statusFilter, setStatusFilter] = useState('');
    const [periodMode, setPeriodMode] = useState<FinancePeriodMode>('all');
    const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
    const [year, setYear] = useState(defaultPeriod.year);
    const [dateFrom, setDateFrom] = useState(getDefaultFinanceCustomDateFrom());
    const [dateTo, setDateTo] = useState(getDefaultFinanceCustomDateTo());
    const [page, setPage] = useState(1);
    const [totalInvoices, setTotalInvoices] = useState(0);
    const [summary, setSummary] = useState({
        filteredNetTotal: 0,
        filteredOutstandingTotal: 0,
        unpaidCount: 0,
        partialCount: 0,
        paidCount: 0,
        overpaymentTotal: 0,
    });
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [receiving, setReceiving] = useState(false);
    const [receiptCustomerRef, setReceiptCustomerRef] = useState('');
    const [receiptDate, setReceiptDate] = useState(getBusinessDateValue());
    const [receiptMethod, setReceiptMethod] = useState('TRANSFER');
    const [receiptAmount, setReceiptAmount] = useState(0);
    const [receiptNote, setReceiptNote] = useState('');
    const [receiptBankRef, setReceiptBankRef] = useState('');
    const [receiptAllocations, setReceiptAllocations] = useState<Record<string, number>>({});
    const [receiptOpenNotas, setReceiptOpenNotas] = useState<FreightNota[]>([]);
    const [receiptOpenPayments, setReceiptOpenPayments] = useState<Payment[]>([]);
    const [receiptNotesLoading, setReceiptNotesLoading] = useState(false);
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [refunding, setRefunding] = useState(false);
    const [refundTarget, setRefundTarget] = useState<CustomerOverpayment | null>(null);
    const [refundDate, setRefundDate] = useState(getBusinessDateValue());
    const [refundAmount, setRefundAmount] = useState(0);
    const [refundBankRef, setRefundBankRef] = useState('');
    const [refundNote, setRefundNote] = useState('');
    const canCreateInvoice = user ? hasPermission(user, 'invoices', 'create') : false;
    const canCreateReceipt = user ? hasPermission(user, 'invoices', 'update') : false;
    const canExportInvoices = user ? hasPermission(user, 'invoices', 'export') : false;
    const canPrintInvoices = user ? hasPermission(user, 'invoices', 'print') : false;
    const canManageOverpayments = canCreateReceipt;
    const canOpenCustomers = user ? hasPageAccess(user, 'customers') : false;
    const dateRange = useMemo(
        () => getFinancePeriodDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
        [dateFrom, dateTo, monthIndex, periodMode, year]
    );
    const isPeriodReady = isFinancePeriodRangeReady(periodMode, dateRange.startDate, dateRange.endDate);
    const yearOptions = useMemo(() => getFinancePeriodYearOptions(year), [year]);

    const buildInvoicesQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'freight-notas',
            page: String(targetPage),
            pageSize: String(targetPageSize),
        });

        if (dateSortDir) {
            params.set('sortField', 'issueDate');
            params.set('sortDir', dateSortDir);
        } else {
            params.set('sortPreset', 'work-queue');
        }

        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'notaNumber,customerName');
        }

        const filter: Record<string, unknown> = {};
        if (statusFilter) {
            filter.status = statusFilter;
        }
        const dateFilter = buildFinanceDateFilter(dateRange.startDate, dateRange.endDate);
        if (periodMode !== 'all' && dateFilter) {
            filter.issueDate = dateFilter;
        }
        if (Object.keys(filter).length > 0) {
            params.set('filter', JSON.stringify(filter));
        }

        return params.toString();
    }, [dateRange.endDate, dateRange.startDate, dateSortDir, page, periodMode, search, statusFilter]);

    const fetchAllMatchingInvoices = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: FreightNota[] = [];

        do {
            const payload = await fetchAdminListPayload<FreightNota>(
                `/api/data?${buildInvoicesQuery(currentPage, pageSize)}`,
                'Gagal memuat invoice'
            );
            const nextItems = (payload.data || []) as FreightNota[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildInvoicesQuery]);

    const fetchReceiptSearchInvoiceRefs = useCallback(async (keyword: string) => {
        const searchKeyword = keyword.trim();
        if (!searchKeyword) return [] as string[];

        const searchQuery = encodeURIComponent(searchKeyword);
        const [directPaymentRows, receiptRows] = await Promise.all([
            fetchAllAdminCollectionData<Payment>(
                `/api/data?entity=payments&q=${searchQuery}&searchFields=receiptNumber`,
                'Gagal memuat pembayaran berdasarkan nomor receipt'
            ).catch(() => []),
            fetchAllAdminCollectionData<CustomerReceipt>(
                `/api/data?entity=customer-receipts&q=${searchQuery}&searchFields=receiptNumber,customerName`,
                'Gagal memuat penerimaan berdasarkan nomor receipt'
            ).catch(() => []),
        ]);

        const receiptIds = receiptRows.map(receipt => receipt._id).filter(Boolean);
        const receiptPaymentRows = receiptIds.length > 0
            ? await fetchAllAdminCollectionData<Payment>(
                `/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ receiptRef: receiptIds }))}`,
                'Gagal memuat alokasi penerimaan'
            ).catch(() => [])
            : [];

        return [...new Set(
            [...directPaymentRows, ...receiptPaymentRows]
                .map(payment => payment.invoiceRef)
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        )];
    }, []);

    const fetchInvoicesByIds = useCallback(async (invoiceRefs: string[]) => {
        const ids = [...new Set(invoiceRefs.filter(Boolean))];
        if (ids.length === 0) return [] as FreightNota[];
        return fetchAllAdminCollectionData<FreightNota>(
            `/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: ids }))}`,
            'Gagal memuat invoice dari receipt'
        );
    }, []);

    useEffect(() => {
        const nextSearch = searchParams.get('q') || '';
        setSearch(current => (current === nextSearch ? current : nextSearch));
    }, [searchParams]);

    const reloadData = useCallback(async () => {
        setLoading(true);
        if (!isPeriodReady) {
            setItems([]);
            setPayments([]);
            setQueueOverpayments([]);
            setTotalInvoices(0);
            setSummary({
                filteredNetTotal: 0,
                filteredOutstandingTotal: 0,
                unpaidCount: 0,
                partialCount: 0,
                paidCount: 0,
                overpaymentTotal: 0,
            });
            return;
        }
        const [notaPayload, baseMatchingNotas, receiptSearchInvoiceRefs, customerRes, overpaymentRes, bankRes, companyPayload] = await Promise.all([
            fetchAdminListPayload<FreightNota>(`/api/data?${buildInvoicesQuery()}`, 'Gagal memuat invoice'),
            fetchAllMatchingInvoices(),
            search.trim() ? fetchReceiptSearchInvoiceRefs(search.trim()) : Promise.resolve([] as string[]),
            fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat customer'),
            fetchAllAdminCollectionData<CustomerOverpayment>('/api/data?entity=customer-overpayments&sortPreset=work-queue', 'Gagal memuat kelebihan bayar customer'),
            fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat rekening'),
            fetchCompanyProfile().catch(() => null),
        ]);

        const receiptSearchNotas = receiptSearchInvoiceRefs.length > 0
            ? await fetchInvoicesByIds(receiptSearchInvoiceRefs)
            : [];
        const matchingNotas = sortInvoiceRows(
            filterInvoiceRowsForCurrentView(
                mergeFreightNotas(baseMatchingNotas, receiptSearchNotas),
                {
                    statusFilter,
                    periodMode,
                    dateFrom: dateRange.startDate,
                    dateTo: dateRange.endDate,
                }
            ),
            dateSortDir
        );
        const shouldUseMergedSearchRows = search.trim() && receiptSearchInvoiceRefs.length > 0;
        const notaRows = shouldUseMergedSearchRows
            ? matchingNotas.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE)
            : (notaPayload.data || []) as FreightNota[];
        const matchingNotaIdList = matchingNotas.map(nota => nota._id).filter(Boolean);
        let matchingPaymentRows: Payment[] = [];

        if (matchingNotaIdList.length > 0) {
            matchingPaymentRows = await fetchAdminCollectionData<Payment[]>(
                `/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: matchingNotaIdList }))}`,
                'Gagal memuat pembayaran invoice'
            );
        }
        const currentNotaIds = new Set(notaRows.map(nota => nota._id).filter(Boolean));
        const paymentRows = matchingPaymentRows.filter(payment => currentNotaIds.has(payment.invoiceRef));
        const matchingPaymentTotals = matchingPaymentRows.reduce<Record<string, number>>((acc, payment) => {
            acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + parseWholeMoneyLike(payment.amount);
            return acc;
        }, {});

        const matchingCustomerRefs = new Set(
            matchingNotas
                .map(nota => nota.customerRef)
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        );
        const matchingCustomerNames = new Set(
            matchingNotas
                .map(nota => nota.customerName)
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        );
        const getEffectivePaidAmount = (nota: FreightNota) =>
            parseWholeMoneyLike(nota.totalPaidEffective ?? matchingPaymentTotals[nota._id] ?? 0);
        const derivedSummary = matchingNotas.reduce(
            (acc, nota) => {
                if (nota.status === 'VOID') {
                    return acc;
                }
                const paidAmount = getEffectivePaidAmount(nota);
                const derivedStatus = deriveReceivableStatus(nota, paidAmount);
                acc.filteredNetTotal += getReceivableNetAmount(nota);
                acc.filteredOutstandingTotal += Math.max(getReceivableNetAmount(nota) - paidAmount, 0);
                if (derivedStatus === 'UNPAID') acc.unpaidCount += 1;
                if (derivedStatus === 'PARTIAL') acc.partialCount += 1;
                if (derivedStatus === 'PAID') acc.paidCount += 1;
                return acc;
            },
            {
                filteredNetTotal: 0,
                filteredOutstandingTotal: 0,
                unpaidCount: 0,
                partialCount: 0,
                paidCount: 0,
            }
        );
        const matchingNotaIds = new Set(
            matchingNotas.map(nota => nota._id).filter((value): value is string => Boolean(value))
        );
        const normalizedSearch = search.trim().toLowerCase();
        const matchesOverpaymentSearch = (item: CustomerOverpayment) => {
            if (!normalizedSearch) return true;
            return [
                item.customerName,
                item.sourceLabel,
                item.sourceDescription,
                item.sourceInvoiceNumber,
                item.sourceReceiptNumber,
            ].some(value => typeof value === 'string' && value.toLowerCase().includes(normalizedSearch));
        };
        const matchingOverpayments = (overpaymentRes || []).filter(item => {
            if (!matchesOverpaymentSearch(item)) return false;
            if (normalizedSearch) return true;
            if (matchingNotaIds.has(item.sourceInvoiceRef || '')) return true;
            return (
                matchingCustomerRefs.has(item.customerRef || '')
                || matchingCustomerNames.has(item.customerName || '')
            );
        });
        const derivedOverpaymentTotal = matchingOverpayments.reduce((sum, item) => {
            if (item.status !== 'OPEN') return sum;
            return sum + parseWholeMoneyLike(item.remainingAmount);
        }, 0);

        setItems(notaRows);
        setPayments(paymentRows);
        setTotalInvoices(shouldUseMergedSearchRows ? matchingNotas.length : notaPayload.meta?.total || 0);
        setSummary({
            ...derivedSummary,
            overpaymentTotal: derivedOverpaymentTotal,
        });
        setCustomers((customerRes || []).filter(customer => customer.active !== false));
        setOverpayments(overpaymentRes || []);
        setQueueOverpayments(matchingOverpayments);
        setBankAccounts((bankRes || []).filter(account => account.active !== false));
        setCompany(companyPayload);
    }, [buildInvoicesQuery, dateRange.endDate, dateRange.startDate, dateSortDir, fetchAllMatchingInvoices, fetchInvoicesByIds, fetchReceiptSearchInvoiceRefs, isPeriodReady, page, periodMode, search, statusFilter]);

    useEffect(() => {
        reloadData()
            .catch(error => {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat invoice');
            })
            .finally(() => {
                setLoading(false);
            });
    }, [addToast, reloadData]);

    useEffect(() => {
        setPage(1);
    }, [dateFrom, dateTo, monthIndex, periodMode, search, statusFilter, year]);

    const paymentTotalsByInvoice = payments.reduce<Record<string, number>>((acc, payment) => {
        acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + parseWholeMoneyLike(payment.amount);
        return acc;
    }, {});

    const getNotaEffectivePaid = (nota: FreightNota) =>
        parseWholeMoneyLike(nota.totalPaidEffective ?? paymentTotalsByInvoice[nota._id] ?? 0);

    const getNotaRemaining = (nota: FreightNota) =>
        Math.max(getReceivableNetAmount(nota) - getNotaEffectivePaid(nota), 0);

    const allOpenOverpayments = overpayments.filter(item => item.status === 'OPEN' && parseWholeMoneyLike(item.remainingAmount) > 0);
    const openOverpayments = queueOverpayments.filter(item => item.status === 'OPEN' && parseWholeMoneyLike(item.remainingAmount) > 0);

    const receiptCustomerOptions = Array.from(
        customers.reduce<Map<string, { ref: string; name: string }>>((map, customer) => {
            map.set(customer._id, { ref: customer._id, name: customer.name });
            return map;
        }, new Map()).values()
    );
    receiptCustomerOptions.sort((a, b) => a.name.localeCompare(b.name));

    const selectedReceiptCustomer = receiptCustomerOptions.find(option => option.ref === receiptCustomerRef) || null;
    const receiptPaymentTotals = receiptOpenPayments.reduce<Record<string, number>>((acc, payment) => {
        acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + parseWholeMoneyLike(payment.amount);
        return acc;
    }, {});
    const receiptOpenNotaItems = receiptOpenNotas
        .map(nota => {
            const netAmount = getReceivableNetAmount(nota);
            const paidAmount = parseWholeMoneyLike(nota.totalPaidEffective ?? receiptPaymentTotals[nota._id] ?? 0);
            return {
                nota,
                paidAmount,
                netAmount,
                remainingAmount: Math.max(netAmount - paidAmount, 0),
            };
        })
        .filter(item => item.remainingAmount > 0)
        .sort((a, b) => a.nota.issueDate.localeCompare(b.nota.issueDate));
    const singleOpenNota = receiptOpenNotaItems.length === 1 ? receiptOpenNotaItems[0] : null;
    const hasSingleOpenNota = Boolean(singleOpenNota);

    const totalAllocated = Object.values(receiptAllocations).reduce((sum, amount) => sum + amount, 0);
    const unappliedReceiptAmount = Math.max(receiptAmount - totalAllocated, 0);
    const customerOverpaymentByRef = allOpenOverpayments.reduce<Record<string, number>>((acc, entry) => {
        const key = entry.customerRef || entry.customerName;
        if (!key) return acc;
        const remainingAmount = parseWholeMoneyLike(entry.remainingAmount);
        if (remainingAmount <= 0) return acc;
        acc[key] = (acc[key] || 0) + remainingAmount;
        return acc;
    }, {});
    const selectedCustomerStoredOverpayment = customerOverpaymentByRef[receiptCustomerRef] || 0;
    const selectedCustomerOpenTotal = receiptOpenNotaItems.reduce((sum, item) => sum + item.remainingAmount, 0);
    const receiptOpenCount = receiptOpenNotaItems.length;
    const receiptPrimaryLabel = receiptOpenCount === 0
        ? 'Simpan Kelebihan Bayar'
        : unappliedReceiptAmount > 0
            ? 'Simpan Penerimaan & Kelebihan Bayar'
            : 'Simpan Penerimaan';
    const receiptAccountOptions = receiptMethod === 'TRANSFER'
        ? bankAccounts.filter(account => account.accountType !== 'CASH')
        : receiptMethod === 'CASH'
            ? []
            : bankAccounts;

    const getOverpaymentSourceHref = useCallback((item: CustomerOverpayment) => {
        if (item.sourceType === 'INVOICE_OVERPAID' && item.sourceInvoiceRef) {
            return `/invoices/${item.sourceInvoiceRef}`;
        }
        const receiptKey = item.sourceReceiptNumber || item.sourceReceiptRef;
        if (item.sourceType === 'RECEIPT_UNAPPLIED' && receiptKey) {
            return `/invoices?q=${encodeURIComponent(receiptKey)}`;
        }
        return null;
    }, []);

    useEffect(() => {
        if (!showReceiptModal || !receiptCustomerRef) {
            setReceiptOpenNotas([]);
            setReceiptOpenPayments([]);
            setReceiptNotesLoading(false);
            return;
        }

        let cancelled = false;

        const loadReceiptOpenNotas = async () => {
            setReceiptNotesLoading(true);
            try {
                const fetchNotaBatch = async (filterObj: Record<string, unknown>) => {
                    return fetchAdminCollectionData<FreightNota[]>(
                        `/api/data?entity=freight-notas&sortPreset=work-queue&filter=${encodeURIComponent(JSON.stringify(filterObj))}`,
                        'Gagal memuat invoice terbuka customer'
                    );
                };

                const [byCustomerRef, byCustomerName] = await Promise.all([
                    fetchNotaBatch({ customerRef: receiptCustomerRef, status: ['UNPAID', 'PARTIAL'] }),
                    selectedReceiptCustomer?.name
                        ? fetchNotaBatch({ customerName: selectedReceiptCustomer.name, status: ['UNPAID', 'PARTIAL'] })
                        : Promise.resolve([] as FreightNota[]),
                ]);

                const notaMap = new Map<string, FreightNota>();
                [...byCustomerRef, ...byCustomerName].forEach(nota => {
                    notaMap.set(nota._id, nota);
                });
                const notaRows = Array.from(notaMap.values());
                const notaIds = notaRows.map(nota => nota._id).filter(Boolean);
                let paymentRows: Payment[] = [];

                if (notaIds.length > 0) {
                    paymentRows = await fetchAdminCollectionData<Payment[]>(
                        `/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: notaIds }))}`,
                        'Gagal memuat alokasi penerimaan'
                    );
                }

                if (cancelled) return;
                setReceiptOpenNotas(notaRows);
                setReceiptOpenPayments(paymentRows);
            } catch (error) {
                if (cancelled) return;
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat invoice terbuka customer');
            } finally {
                if (!cancelled) {
                    setReceiptNotesLoading(false);
                }
            }
        };

        void loadReceiptOpenNotas();

        return () => {
            cancelled = true;
        };
    }, [addToast, receiptCustomerRef, selectedReceiptCustomer?.name, showReceiptModal]);

    useEffect(() => {
        if (!receiptBankRef) return;
        const selectedAccount = bankAccounts.find(account => account._id === receiptBankRef);
        if (!selectedAccount) {
            setReceiptBankRef('');
            return;
        }
        if (receiptMethod === 'TRANSFER' && selectedAccount.accountType === 'CASH') {
            setReceiptBankRef('');
        }
    }, [bankAccounts, receiptBankRef, receiptMethod]);

    useEffect(() => {
        if (!singleOpenNota) {
            return;
        }

        const maxAllowed = singleOpenNota.remainingAmount;
        const nextAmount = receiptAmount > 0 ? receiptAmount : maxAllowed;
        const nextAllocation = Math.min(nextAmount, maxAllowed);
        const currentAmount = receiptAllocations[singleOpenNota.nota._id] || 0;
        const allocationKeys = Object.keys(receiptAllocations);

        if (receiptAmount !== nextAmount) {
            setReceiptAmount(nextAmount);
            return;
        }

        if (currentAmount !== nextAllocation || allocationKeys.length !== 1 || allocationKeys[0] !== singleOpenNota.nota._id) {
            setReceiptAllocations(nextAllocation > 0 ? { [singleOpenNota.nota._id]: nextAllocation } : {});
        }
    }, [singleOpenNota, receiptAmount, receiptAllocations]);

    const resetReceiptModal = () => {
        setReceiptCustomerRef('');
        setReceiptDate(getBusinessDateValue());
        setReceiptMethod('TRANSFER');
        setReceiptAmount(0);
        setReceiptNote('');
        setReceiptBankRef('');
        setReceiptAllocations({});
    };

    const openReceiptModal = () => {
        resetReceiptModal();
        setShowReceiptModal(true);
    };

    const resetRefundModal = () => {
        setRefundTarget(null);
        setRefundDate(getBusinessDateValue());
        setRefundAmount(0);
        setRefundBankRef('');
        setRefundNote('');
    };

    const openRefundModal = (target: CustomerOverpayment) => {
        resetRefundModal();
        setRefundTarget(target);
        setRefundAmount(parseWholeMoneyLike(target.remainingAmount));
        setShowRefundModal(true);
    };

    const updateReceiptAllocation = (notaId: string, amount: number) => {
        setReceiptAllocations(prev => {
            const next = { ...prev };
            if (!Number.isFinite(amount) || amount <= 0) {
                delete next[notaId];
            } else {
                next[notaId] = amount;
            }
            return next;
        });
    };

    const handleCreateCustomerReceipt = async () => {
        const allocations = receiptOpenNotaItems
            .map(item => ({
                invoiceRef: item.nota._id,
                amount: receiptAllocations[item.nota._id] || 0,
            }))
            .filter(item => item.amount > 0);

        if (!receiptCustomerRef) {
            addToast('error', 'Pilih customer dulu');
            return;
        }
        if (receiptAmount <= 0) {
            addToast('error', 'Total penerimaan harus lebih dari 0');
            return;
        }
        if (totalAllocated - receiptAmount > 0.00001) {
            addToast('error', 'Total alokasi tidak boleh melebihi total penerimaan');
            return;
        }
        if (receiptMethod === 'TRANSFER' && !receiptBankRef) {
            addToast('error', 'Pilih rekening untuk transfer');
            return;
        }

        setReceiving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'customer-receipts',
                    data: {
                        customerRef: receiptCustomerRef,
                        date: receiptDate,
                        totalAmount: receiptAmount,
                        method: receiptMethod,
                        note: receiptNote,
                        bankAccountRef: receiptBankRef || undefined,
                        allocations,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal mencatat penerimaan');
                return;
            }
            const unappliedAmount = parseWholeMoneyLike(payload.data?.unappliedAmount);
            addToast(
                'success',
                unappliedAmount > 0
                    ? `Penerimaan customer berhasil dicatat. Kelebihan bayar tersimpan ${formatCurrency(unappliedAmount)}`
                    : 'Penerimaan customer berhasil dicatat'
            );
            setShowReceiptModal(false);
            resetReceiptModal();
            setLoading(true);
            await reloadData();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal mencatat penerimaan');
        } finally {
            setLoading(false);
            setReceiving(false);
        }
    };

    const handleConfirmOverpaymentRefund = async () => {
        if (!refundTarget) {
            addToast('error', 'Data kelebihan bayar tidak tersedia');
            return;
        }
        if (refundAmount <= 0) {
            addToast('error', 'Nominal refund harus lebih dari 0');
            return;
        }
        if (refundAmount > parseWholeMoneyLike(refundTarget.remainingAmount)) {
            addToast('error', 'Nominal refund melebihi kelebihan bayar yang masih terbuka');
            return;
        }
        if (!refundBankRef) {
            addToast('error', 'Pilih rekening atau kas sumber refund');
            return;
        }

        setRefunding(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'customer-overpayment-refunds',
                    data: {
                        sourceType: refundTarget.sourceType,
                        sourceReceiptRef: refundTarget.sourceReceiptRef,
                        sourceInvoiceRef: refundTarget.sourceInvoiceRef,
                        date: refundDate,
                        amount: refundAmount,
                        bankAccountRef: refundBankRef,
                        note: refundNote,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal mengonfirmasi refund kelebihan bayar');
                return;
            }
            addToast('success', 'Refund kelebihan bayar berhasil dikonfirmasi');
            setShowRefundModal(false);
            resetRefundModal();
            setLoading(true);
            await reloadData();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal mengonfirmasi refund kelebihan bayar');
        } finally {
            setLoading(false);
            setRefunding(false);
        }
    };

    const grandTotal = summary.filteredNetTotal;
    const outstandingTotal = summary.filteredOutstandingTotal;
    const queueCounts = {
        needPayment: summary.unpaidCount,
        partialPayment: summary.partialCount,
        paid: summary.paidCount,
    };

    const fetchNotaItems = async (notaId: string) => {
        return fetchAllAdminCollectionData<FreightNotaItem>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`,
            'Gagal memuat item invoice',
        );
    };

    const fetchCustomerSummary = async (customerRef?: string) => {
        if (!customerRef) return null;
        try {
            const response = await fetch(`/api/data?entity=customers&id=${customerRef}`);
            const payload = await response.json();
            if (!response.ok) {
                return null;
            }
            return (payload.data || null) as Pick<Customer, '_id' | 'name' | 'address' | 'contactPerson' | 'phone'> | null;
        } catch {
            return null;
        }
    };

    const handlePrintNota = async (nota: FreightNota) => {
        const printWindow = openPrintWindow('Menyiapkan cetak invoice...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }
        try {
            const [resolvedCompany, notaItems, customer] = await Promise.all([
                company ? Promise.resolve(company) : fetchCompanyProfile().catch(() => null),
                fetchNotaItems(nota._id),
                nota.customerRef && !(nota.customerAddress || nota.customerContactPerson || nota.customerPhone)
                    ? fetchCustomerSummary(nota.customerRef)
                    : Promise.resolve(null),
            ]);
            const issuerBranding = resolveDocumentIssuerProfile(nota, resolvedCompany);
            setCompany(resolvedCompany);
            const doc = buildFreightNotaPrintDocument({
                nota,
                items: notaItems,
                company: resolvedCompany,
                customer,
                invoiceBankAccounts: bankAccounts,
            });
            openBrandedPrint({
                title: doc.title,
                subtitle: doc.subtitle,
                company: issuerBranding,
                bodyHtml: doc.bodyHtml,
                extraStyles: doc.extraStyles,
                showCompanyHeader: doc.showCompanyHeader,
                showFooter: doc.showFooter,
                targetWindow: printWindow,
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan cetak invoice');
        }
    };

    const handleExportNota = async (nota: FreightNota) => {
        try {
            const [resolvedCompany, notaItems] = await Promise.all([
                company ? Promise.resolve(company) : fetchCompanyProfile().catch(() => null),
                fetchNotaItems(nota._id),
            ]);
            setCompany(resolvedCompany);
            await exportFreightNotaDetail(nota, notaItems, resolvedCompany, bankAccounts);
            addToast('success', 'Excel invoice berhasil di-download');
        } catch {
            addToast('error', 'Gagal menyiapkan Excel invoice');
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Invoice Ongkos Angkut</h1>
                </div>
                <div className="page-actions">
                    {canCreateReceipt && <button className="btn btn-success" onClick={openReceiptModal}><Plus size={18} /> Catat Penerimaan</button>}
                    {canCreateInvoice && <button className="btn btn-primary" onClick={() => router.push('/invoices/new')}><Plus size={18} /> Buat Invoice Baru</button>}
                </div>
            </div>

            {/* KPI */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Sisa Piutang</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem', color: 'var(--color-danger)' }}>{formatCurrency(outstandingTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Perlu Ditagih</div>
                        <div className="kpi-value">{queueCounts.needPayment}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Follow Up Parsial</div>
                        <div className="kpi-value">{queueCounts.partialPayment}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Kelebihan Bayar</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem' }}>{formatCurrency(summary.overpaymentTotal)}</div>
                    </div>
                </div>
            </div>

            {canManageOverpayments && (
                <div className="card" style={{ marginBottom: '1.25rem' }}>
                    <div className="card-header">
                        <span className="card-header-title">Tindak Lanjut Kelebihan Bayar</span>
                    </div>
                    <div className="card-body">
                        {openOverpayments.length === 0 ? (
                            <div className="empty-state" style={{ padding: '1rem 0' }}>
                                <div className="empty-state-title">Tidak ada kelebihan bayar terbuka</div>
                                <div className="empty-state-text">Queue ini otomatis menangkap sisa penerimaan customer dan invoice yang menjadi overpaid setelah klaim/potongan.</div>
                            </div>
                        ) : (
                            <>
                            <div className="table-wrapper table-desktop-only" style={{ overflowX: 'auto' }}>
                                <table style={{ minWidth: 760 }}>
                                    <thead>
                                        <tr>
                                            <th>Sumber</th>
                                            <th>Customer</th>
                                            <th>Terdeteksi</th>
                                            <th>Status</th>
                                            <th>Nominal Terbuka</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {openOverpayments.map(item => (
                                            <tr key={item._id}>
                                                <td>
                                                    <div className="font-semibold">
                                                        {(() => {
                                                            const sourceHref = getOverpaymentSourceHref(item);
                                                            if (!sourceHref) return item.sourceLabel;
                                                            return (
                                                                <Link href={sourceHref} style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
                                                                    {item.sourceLabel}
                                                                </Link>
                                                            );
                                                        })()}
                                                    </div>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.sourceDescription}</div>
                                                </td>
                                                <td>
                                                    {item.customerRef && canOpenCustomers ? (
                                                        <Link href={`/customers/${item.customerRef}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                                                            {item.customerName}
                                                        </Link>
                                                    ) : item.customerName}
                                                </td>
                                                <td>{formatDate(item.detectedDate)}</td>
                                                <td><span className="badge badge-warning"><span className="badge-dot" /> Belum Ditindaklanjuti</span></td>
                                                <td>
                                                    <div className="font-semibold" style={{ color: 'var(--color-warning)' }}>{formatCurrency(item.remainingAmount)}</div>
                                                    {parseWholeMoneyLike(item.refundedAmount) > 0 && (
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                            Sudah refund {formatCurrency(item.refundedAmount)}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <button className="table-action-btn" onClick={() => openRefundModal(item)}>
                                                        Konfirmasi Transfer Balik
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mobile-record-list">
                                {openOverpayments.map(item => {
                                    const sourceHref = getOverpaymentSourceHref(item);
                                    return (
                                        <article key={item._id} className="mobile-record-card">
                                            <div className="mobile-record-header">
                                                <div>
                                                    <div className="mobile-record-title">
                                                        {sourceHref ? (
                                                            <Link href={sourceHref} style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
                                                                {item.sourceLabel}
                                                            </Link>
                                                        ) : item.sourceLabel}
                                                    </div>
                                                    <div className="mobile-record-subtitle">{item.sourceDescription}</div>
                                                </div>
                                                <span className="badge badge-warning"><span className="badge-dot" /> Belum Ditindaklanjuti</span>
                                            </div>
                                            <div className="mobile-record-meta">
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Customer</span>
                                                    <span className="mobile-record-value">
                                                        {item.customerRef && canOpenCustomers ? (
                                                            <Link href={`/customers/${item.customerRef}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                                                                {item.customerName}
                                                            </Link>
                                                        ) : item.customerName}
                                                    </span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Terdeteksi</span>
                                                    <span className="mobile-record-value">{formatDate(item.detectedDate)}</span>
                                                </div>
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Nominal Terbuka</span>
                                                    <span className="mobile-record-value" style={{ fontWeight: 700, color: 'var(--color-warning)' }}>{formatCurrency(item.remainingAmount)}</span>
                                                </div>
                                                {parseWholeMoneyLike(item.refundedAmount) > 0 && (
                                                    <div className="mobile-record-kv">
                                                        <span className="mobile-record-label">Sudah Refund</span>
                                                        <span className="mobile-record-value">{formatCurrency(item.refundedAmount)}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="mobile-record-actions">
                                                <button className="btn btn-secondary" onClick={() => openRefundModal(item)}>
                                                    Konfirmasi Transfer Balik
                                                </button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left finance-filter-toolbar">
                        <div className="table-search finance-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari invoice, customer, receipt..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select finance-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status Aktif</option>
                            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
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
                        <thead><tr><th>No. Invoice</th><th>Customer</th><th><SortableTableHeader label="Tanggal" direction={dateSortDir} onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')} /></th><th>Total Collie</th><th>Dasar Invoice</th><th>Invoice Transfer Final</th><th>Status</th><th>Tindak Lanjut</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                totalInvoices === 0 ? (
                                    <tr><td colSpan={9}><div className="empty-state"><FileText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada invoice</div><div className="empty-state-text">Belum ada invoice yang bisa ditampilkan</div></div></td></tr>
                                ) : items.map(n => (
                                    (() => {
                                        const displayStatus = deriveReceivableStatus(n, getNotaEffectivePaid(n));
                                        return (
                                    <tr key={n._id}>
                                        <td>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                style={{ padding: 0, textAlign: 'left', color: 'var(--color-primary)' }}
                                                onClick={() => router.push(`/invoices/${n._id}`)}
                                            >
                                                <div className="font-semibold">{formatFreightNotaDisplayNumber(n, company)}</div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{n.notaNumber}</div>
                                            </button>
                                        </td>
                                        <td>{n.customerName}</td>
                                        <td className="text-muted">{formatDate(n.issueDate)}</td>
                                    <td>{formatQuantity(n.totalCollie || 0)}</td>
                                        <td>{formatFreightNotaDisplayWeight({ beratKg: n.totalWeightKg || 0, volumeM3: n.totalVolumeM3 || 0, billingMode: normalizeFreightNotaBillingMode(n.billingMode), includeCanonical: false })}</td>
                                        <td>
                                            <div className="font-semibold">{formatCurrency(getReceivableNetAmount(n))}</div>
                                            {(parseWholeMoneyLike(n.totalAdjustmentAmount) > 0 || parseWholeMoneyLike(n.pph23Amount) > 0) && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Bruto {formatCurrency(n.totalAmount)} • Klaim {formatCurrency(parseWholeMoneyLike(n.totalAdjustmentAmount))} • PPh 23 {formatCurrency(parseWholeMoneyLike(n.pph23Amount))}</div>}
                                            {parseWholeMoneyLike(n.openOverpaymentAmount) > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--color-warning)' }}>Kelebihan Bayar {formatCurrency(n.openOverpaymentAmount)}</div>}
                                        </td>
                                        <td><span className={`badge badge-${STATUS_MAP[displayStatus]?.color}`}><span className="badge-dot" /> {STATUS_MAP[displayStatus]?.label}</span></td>
                                        <td><span style={{ fontWeight: 500 }}>{getNextInvoiceAction(displayStatus, n, getNotaRemaining(n))}</span></td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                <button className="table-action-btn" onClick={() => router.push(`/invoices/${n._id}`)}>Buka</button>
                                                {canExportInvoices && <button className="table-action-btn" onClick={() => void handleExportNota(n)}><FileDown size={13} /> Excel</button>}
                                                {canPrintInvoices && <button className="table-action-btn" onClick={() => void handlePrintNota(n)}><Printer size={13} /> Cetak</button>}
                                            </div>
                                        </td>
                                    </tr>
                                        );
                                    })()
                                ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {totalInvoices === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada invoice</div>
                                <div className="mobile-record-subtitle">Belum ada invoice yang bisa ditampilkan.</div>
                            </div>
                        ) : items.map(n => (
                            (() => {
                                const displayStatus = deriveReceivableStatus(n, getNotaEffectivePaid(n));
                                return (
                            <div key={n._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{formatFreightNotaDisplayNumber(n, company)}</div>
                                        <div className="mobile-record-subtitle">{n.customerName || '-'} | {formatDate(n.issueDate)}</div>
                                    </div>
                                    <span className={`badge badge-${STATUS_MAP[displayStatus]?.color}`}>
                                        <span className="badge-dot" /> {STATUS_MAP[displayStatus]?.label}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">No. Invoice Internal</span>
                                        <span className="mobile-record-value">{n.notaNumber}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Total Collie</span>
                                                    <span className="mobile-record-value">{formatQuantity(n.totalCollie || 0)}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Dasar Invoice</span>
                                        <span className="mobile-record-value">{formatFreightNotaDisplayWeight({ beratKg: n.totalWeightKg || 0, volumeM3: n.totalVolumeM3 || 0, billingMode: normalizeFreightNotaBillingMode(n.billingMode), includeCanonical: false })}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Invoice Transfer Final</span>
                                        <span className="mobile-record-value" style={{ fontWeight: 700 }}>{formatCurrency(getReceivableNetAmount(n))}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getNextInvoiceAction(displayStatus, n, getNotaRemaining(n))}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => router.push(`/invoices/${n._id}`)}>Buka</button>
                                    {canExportInvoices && <button className="btn btn-secondary" onClick={() => void handleExportNota(n)}><FileDown size={13} /> Excel</button>}
                                    {canPrintInvoices && <button className="btn btn-secondary" onClick={() => void handlePrintNota(n)}><Printer size={13} /> Cetak</button>}
                                </div>
                            </div>
                                );
                            })()
                        ))}
                    </div>
                )}
                {totalInvoices > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalInvoices}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} invoice. Urutan dimulai dari invoice yang paling perlu ditindaklanjuti. Total invoice transfer final terfilter: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</strong>
                            </>
                        )}
                    />
                )}
            </div>
            {canManageOverpayments && showRefundModal && refundTarget && (
                <div className="modal-overlay" onClick={() => { if (!refunding) setShowRefundModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Konfirmasi Transfer Balik Kelebihan Bayar</h3>
                            <button className="modal-close" onClick={() => setShowRefundModal(false)} disabled={refunding}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.85rem 1rem', marginBottom: '1rem', display: 'grid', gap: '0.35rem' }}>
                                <div><strong>{refundTarget.sourceLabel}</strong></div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{refundTarget.customerName}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{refundTarget.sourceDescription}</div>
                                <div style={{ fontSize: '0.8rem' }}>Nominal terbuka: <strong>{formatCurrency(refundTarget.remainingAmount)}</strong></div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Transfer Balik</label>
                                <input type="date" className="form-input" value={refundDate} onChange={e => setRefundDate(e.target.value)} disabled={refunding} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Nominal Refund (Rp)</label>
                                <FormattedNumberInput allowDecimal={false} value={refundAmount} onValueChange={value => setRefundAmount(value)} disabled={refunding} placeholder="Ketik nominal refund" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Rekening / Kas Sumber</label>
                                <select className="form-select" value={refundBankRef} onChange={e => setRefundBankRef(e.target.value)} disabled={refunding}>
                                    <option value="">-- Pilih rekening atau kas --</option>
                                    {bankAccounts.map(account => (
                                        <option key={account._id} value={account._id}>
                                            {account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={refundNote} onChange={e => setRefundNote(e.target.value)} disabled={refunding} placeholder="Contoh: Transfer balik ke rekening customer sesuai konfirmasi 1 April 2026" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRefundModal(false)} disabled={refunding}>Batal</button>
                            <button className="btn btn-warning" onClick={() => void handleConfirmOverpaymentRefund()} disabled={refunding}>
                                {refunding ? 'Memproses...' : 'Konfirmasi Transfer Balik'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {canCreateReceipt && showReceiptModal && (
                <div className="modal-overlay" onClick={() => { if (!receiving) setShowReceiptModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Catat Penerimaan Customer</h3>
                            <button className="modal-close" onClick={() => setShowReceiptModal(false)} disabled={receiving}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Customer</label>
                                    <select className="form-select" value={receiptCustomerRef} onChange={e => { setReceiptCustomerRef(e.target.value); setReceiptAllocations({}); setReceiptAmount(0); }} disabled={receiving}>
                                        <option value="">-- Pilih customer --</option>
                                        {receiptCustomerOptions.map(option => <option key={option.ref} value={option.ref}>{option.name}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Penerimaan</label>
                                    <input type="date" className="form-input" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} disabled={receiving} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Metode</label>
                                    <select
                                        className="form-select"
                                        value={receiptMethod}
                                        onChange={e => {
                                            const nextMethod = e.target.value;
                                            setReceiptMethod(nextMethod);
                                            if (nextMethod === 'CASH') {
                                                setReceiptBankRef('');
                                            }
                                        }}
                                        disabled={receiving}
                                    >
                                        {Object.entries(PAYMENT_METHOD_MAP).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Rekening / Kas</label>
                                    <select className="form-select" value={receiptBankRef} onChange={e => setReceiptBankRef(e.target.value)} disabled={receiving || receiptMethod === 'CASH'}>
                                        <option value="">{receiptMethod === 'CASH' ? '-- Otomatis ke Kas Tunai --' : '-- Pilih --'}</option>
                                        {receiptAccountOptions.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Total Penerimaan (Rp)</label>
                                    <FormattedNumberInput allowDecimal={false} value={receiptAmount} onValueChange={value => setReceiptAmount(value)} disabled={receiving} placeholder="Ketik total penerimaan" />
                                </div>
                                {!hasSingleOpenNota && (
                                    <div className="form-group" style={{ alignSelf: 'end' }}>
                                        <button className="btn btn-secondary" type="button" onClick={() => setReceiptAmount(totalAllocated)} disabled={receiving || totalAllocated <= 0}>Samakan Dengan Total Alokasi</button>
                                    </div>
                                )}
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={receiptNote} onChange={e => setReceiptNote(e.target.value)} disabled={receiving} placeholder="Contoh: Transfer gabungan invoice Arwana batch 1" />
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                {receiptMethod === 'CASH'
                                    ? 'Penerimaan tunai selalu diposting ke akun Kas Tunai. Jika uangnya nanti disetor ke bank, catat transfer kas ke rekening secara terpisah.'
                                    : 'Satu penerimaan customer mewakili satu uang masuk nyata di bank/kas. Penerimaan ini bisa dialokasikan ke beberapa invoice customer yang sama. Jika ada sisa yang belum dialokasikan, sistem menyimpannya sebagai kelebihan bayar customer.'}
                            </div>
                            {receiptCustomerRef && (
                                <div style={{ background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-100)', borderRadius: '0.75rem', padding: '0.9rem 1rem', marginBottom: '1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.82rem' }}>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Jumlah Invoice Terbuka</div>
                                                    <div style={{ fontWeight: 700 }}>{receiptOpenCount} invoice</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Invoice Terbuka Saat Ini</div>
                                            <div style={{ fontWeight: 700 }}>{formatCurrency(selectedCustomerOpenTotal)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Kelebihan Bayar Belum Selesai</div>
                                            <div style={{ fontWeight: 700 }}>{formatCurrency(selectedCustomerStoredOverpayment)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Belum Dialokasikan dari Penerimaan Ini</div>
                                            <div style={{ fontWeight: 700, color: unappliedReceiptAmount > 0 ? 'var(--color-warning)' : 'inherit' }}>{formatCurrency(unappliedReceiptAmount)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Mode Penerimaan</div>
                                            <div style={{ fontWeight: 700 }}>
                                                {receiptOpenCount === 0
                                                    ? 'Semua jadi kredit'
                                                    : hasSingleOpenNota
                                                        ? 'Alokasi otomatis'
                                                        : 'Alokasi manual'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {!receiptCustomerRef ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Pilih customer</div>
                                    <div className="empty-state-text">Daftar invoice terbuka dan kelebihan bayar customer akan muncul setelah customer dipilih.</div>
                                </div>
                            ) : receiptNotesLoading ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Memuat invoice terbuka</div>
                                    <div className="empty-state-text">Sedang mengambil sisa invoice customer ini.</div>
                                </div>
                            ) : receiptOpenNotaItems.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Tidak ada invoice terbuka</div>
                                    <div className="empty-state-text">Customer ini tidak punya sisa invoice final. Kamu tetap bisa menyimpan penerimaan ini sebagai kelebihan bayar.</div>
                                </div>
                            ) : hasSingleOpenNota && singleOpenNota ? (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                            <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Alokasi Otomatis ke Satu Invoice</div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'grid', gap: '0.25rem' }}>
                                        <div>Invoice: <strong>{formatFreightNotaDisplayNumber(singleOpenNota.nota, company)}</strong></div>
                                        <div>No. Invoice Internal: {singleOpenNota.nota.notaNumber}</div>
                                        <div>Sisa invoice: <strong>{formatCurrency(singleOpenNota.remainingAmount)}</strong></div>
                                        <div>Penerimaan yang kamu isi di atas akan langsung dialokasikan ke invoice ini sampai penuh. Jika nominalnya lebih besar, sisanya otomatis menjadi kelebihan bayar.</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                                    <table style={{ minWidth: 720 }}>
                                        <thead><tr><th>No. Invoice</th><th>Tgl</th><th>Invoice Final</th><th>Sudah Dibayar</th><th>Sisa</th><th>Alokasi Penerimaan</th></tr></thead>
                                        <tbody>
                                            {receiptOpenNotaItems.map(item => (
                                                <tr key={item.nota._id}>
                                                    <td>
                                                        <div className="font-semibold">{formatFreightNotaDisplayNumber(item.nota, company)}</div>
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.nota.notaNumber}</div>
                                                    </td>
                                                    <td>{formatDate(item.nota.issueDate)}</td>
                                                    <td>{formatCurrency(item.netAmount)}</td>
                                                    <td>{formatCurrency(item.paidAmount)}</td>
                                                    <td>
                                                        <div className="font-semibold">{formatCurrency(item.remainingAmount)}</div>
                                                        <button className="table-action-btn" type="button" onClick={() => updateReceiptAllocation(item.nota._id, item.remainingAmount)} disabled={receiving}>Isi penuh</button>
                                                    </td>
                                                    <td><FormattedNumberInput allowDecimal={false} value={receiptAllocations[item.nota._id] || 0} onValueChange={value => updateReceiptAllocation(item.nota._id, value)} disabled={receiving} placeholder="Alokasi" /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total alokasi: <strong>{formatCurrency(totalAllocated)}</strong></div>
                                <div style={{ fontSize: '0.85rem', color: totalAllocated - receiptAmount > 0.00001 ? 'var(--color-danger)' : unappliedReceiptAmount > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                                    {totalAllocated - receiptAmount > 0.00001
                                        ? 'Total alokasi melebihi total penerimaan'
                                        : unappliedReceiptAmount > 0
                                            ? `Belum dialokasikan / kelebihan bayar: ${formatCurrency(unappliedReceiptAmount)}`
                                            : 'Total alokasi sudah cocok dengan penerimaan'}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowReceiptModal(false)} disabled={receiving}>Batal</button>
                            <button className="btn btn-success" onClick={() => void handleCreateCustomerReceipt()} disabled={receiving}>{receiving ? 'Memproses...' : receiptPrimaryLabel}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
