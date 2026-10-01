'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Lock, Pencil, Plus, RefreshCcw, Save, Trash2, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { findMatchingCustomerBillingRate } from '@/lib/customer-billing-rates';
import {
    calculateFreightNotaRowAmount,
    FREIGHT_NOTA_BILLING_MODE_OPTIONS,
    formatFreightNotaDisplayWeight,
    getFreightNotaBillingModeLabel,
    getFreightNotaDisplayWeightValue,
    getFreightNotaRateColumnLabel,
    getFreightNotaWeightColumnLabel,
    normalizeFreightNotaBillingMode,
} from '@/lib/freight-nota-billing';
import {
    buildNotaRowsFromDeliveryOrder,
    createEmptyNotaRow,
    getFreightNotaItemCoverageKeys,
    getInvoiceRowAvailabilityCoverageKeys,
    getInvoiceRowItemCoverageKeys,
    getSuggestedNotaDueDate,
    isEmptyNotaRow,
    type NotaItemRow,
} from '@/lib/invoice-create-page-support';
import { hasDeliveryOrderBillableCargo } from '@/lib/delivery-order-completion';
import { convertWeightToKg } from '@/lib/measurement';
import { buildPph23Label, calculatePph23Summary, DEFAULT_PPH23_RATE_PERCENT, PPH23_BASE_MODE_OPTIONS } from '@/lib/pph23';
import type { CompanyProfile, Customer, CustomerBillingRate, CustomerOverpaymentRefund, DeliveryOrder, DeliveryOrderItem, FreightNota, FreightNotaBillingMode, FreightNotaItem, Order, Payment } from '@/lib/types';
import { formatCurrency, formatInternalDeliveryOrderNumber, formatQuantity, formatShipperDeliveryOrderNumber, formatShipperReceiverSummary, getShipperReferenceCount } from '@/lib/utils';

import { useToast } from '../../layout';
import Combobox from '@/components/Combobox';

type PendingDeliveryOrderSelection = {
    deliveryOrder: DeliveryOrder;
    rows: NotaItemRow[];
    selectedGroupKeys: string[];
};

type InvoiceReferenceData = {
    orders: Order[];
    deliveryOrderItems: DeliveryOrderItem[];
    usedNotaDoRowKeys: string[];
    usedNotaDoItemRefs: string[];
};

type RevisionBlock = {
    invoiceNumber: string;
    totalPaid: number;
    paymentCount: number;
    totalAdjustmentAmount: number;
    refundedOverpaymentAmount: number;
};

function buildCustomerBillingRateLabel(rate: { basis?: string; routeFrom?: string; routeTo?: string; serviceName?: string }) {
    const route = [rate.routeFrom, rate.routeTo]
        .map(value => value?.trim())
        .filter(Boolean)
        .join(' - ');
    return [rate.serviceName, route, rate.basis]
        .map(value => value?.trim())
        .filter(Boolean)
        .join(' | ') || 'Tarif master customer';
}

function getInvoiceRowSjGroupKey(row: NotaItemRow) {
    return `${row.doRef || 'manual'}::sj::${row.noSJ?.trim() || row.doNumber || row.id}::customer::${row.customerRef || ''}`;
}

export default function NewNotaPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addToast } = useToast();
    const editNotaId = searchParams.get('edit')?.trim() || '';
    const returnTo = searchParams.get('returnTo')?.trim() || '';
    const sourceOrderRef = searchParams.get('orderRef')?.trim() || '';
    const sourceDoRef = searchParams.get('doRef')?.trim() || '';
    const isEditMode = Boolean(editNotaId);
    const skipCustomerDefaultsRef = useRef(false);
    const invoiceReferenceDataRef = useRef<InvoiceReferenceData | null>(null);
    const customerBillingRatesRef = useRef<CustomerBillingRate[]>([]);
    const loadedBillingRateCustomerRefsRef = useRef<Set<string>>(new Set());
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [deliveryOrderItems, setDeliveryOrderItems] = useState<DeliveryOrderItem[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [customerBillingRates, setCustomerBillingRates] = useState<CustomerBillingRate[]>([]);
    const [usedNotaDoRowKeys, setUsedNotaDoRowKeys] = useState<string[]>([]);
    const [usedNotaDoItemRefs, setUsedNotaDoItemRefs] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [loadingInitialData, setLoadingInitialData] = useState(true);
    const [loadingInvoiceReferenceData, setLoadingInvoiceReferenceData] = useState(false);
    const [invoiceReferenceDataLoaded, setInvoiceReferenceDataLoaded] = useState(false);
    const [loadingBillingRates, setLoadingBillingRates] = useState(false);
    const [revisionBlock, setRevisionBlock] = useState<RevisionBlock | null>(null);

    const [customerRef, setCustomerRef] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [issueDate, setIssueDate] = useState(getBusinessDateValue());
    const [dueDate, setDueDate] = useState('');
    const [dueDateTouched, setDueDateTouched] = useState(false);
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<NotaItemRow[]>([]);
    const [billingMode, setBillingMode] = useState<FreightNotaBillingMode>('PER_KG');
    const [pph23Enabled, setPph23Enabled] = useState(false);
    const [pph23RatePercent, setPph23RatePercent] = useState(DEFAULT_PPH23_RATE_PERCENT);
    const [pph23BaseMode, setPph23BaseMode] = useState<'BEFORE_CLAIM' | 'AFTER_CLAIM'>('BEFORE_CLAIM');
    const [editingRow, setEditingRow] = useState<NotaItemRow | null>(null);
    const [pendingDoSelection, setPendingDoSelection] = useState<PendingDeliveryOrderSelection | null>(null);

    const mergeCustomerBillingRates = useCallback((nextRates: CustomerBillingRate[]) => {
        const activeRates = nextRates.filter(rate => rate.active !== false);
        const mergedMap = new Map(customerBillingRatesRef.current.map(rate => [rate._id, rate]));
        for (const rate of activeRates) {
            mergedMap.set(rate._id, rate);
        }
        const merged = Array.from(mergedMap.values());
        customerBillingRatesRef.current = merged;
        setCustomerBillingRates(merged);
        return merged;
    }, []);

    const ensureCustomerBillingRates = useCallback(async (targetCustomerRef?: string) => {
        const normalizedCustomerRef = targetCustomerRef?.trim() || '';
        if (!normalizedCustomerRef) {
            return customerBillingRatesRef.current;
        }
        if (loadedBillingRateCustomerRefsRef.current.has(normalizedCustomerRef)) {
            return customerBillingRatesRef.current.filter(rate => rate.customerRef === normalizedCustomerRef);
        }

        setLoadingBillingRates(true);
        try {
            const filter = encodeURIComponent(JSON.stringify({ customerRef: normalizedCustomerRef }));
            const rates = await fetchAllAdminCollectionData<CustomerBillingRate>(
                `/api/data?entity=customer-billing-rates&filter=${filter}`,
                'Gagal memuat tarif customer'
            );
            loadedBillingRateCustomerRefsRef.current.add(normalizedCustomerRef);
            const merged = mergeCustomerBillingRates(rates);
            return merged.filter(rate => rate.customerRef === normalizedCustomerRef);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat tarif customer');
            return customerBillingRatesRef.current.filter(rate => rate.customerRef === normalizedCustomerRef);
        } finally {
            setLoadingBillingRates(false);
        }
    }, [addToast, mergeCustomerBillingRates]);

    const ensureInvoiceReferenceData = useCallback(async (): Promise<InvoiceReferenceData> => {
        if (invoiceReferenceDataRef.current) {
            return invoiceReferenceDataRef.current;
        }

        setLoadingInvoiceReferenceData(true);
        try {
            const [ords, doItems, notaItems] = await Promise.all([
                fetchAllAdminCollectionData<Order>('/api/data?entity=orders', 'Gagal memuat order pendukung invoice'),
                fetchAllAdminCollectionData<DeliveryOrderItem>('/api/data?entity=delivery-order-items', 'Gagal memuat item DO pendukung invoice'),
                fetchAllAdminCollectionData<{
                    doRef?: string;
                    noSJ?: string;
                    notaRef?: string;
                    deliveryOrderItemRef?: string;
                    deliveryOrderItemRefs?: string[];
                    actualDropPointKey?: string;
                    tujuan?: string;
                    status?: string;
                }>('/api/data?entity=freight-nota-items', 'Gagal memuat pemakaian DO invoice'),
            ]);
            const usableNotaItems = (notaItems || []).filter(item => item.status !== 'VOID' && (!editNotaId || item.notaRef !== editNotaId));
            const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
            const nextUsedNotaDoRowKeys = usableNotaItems.flatMap(item => {
                const doRef = item.doRef?.trim() || '';
                const matchedDeliveryOrder = deliveryOrderMap.get(doRef);
                return getFreightNotaItemCoverageKeys(item, matchedDeliveryOrder);
            });
            const nextUsedNotaDoItemRefs = usableNotaItems.flatMap(item => {
                const doRef = item.doRef?.trim() || '';
                if (!doRef) {
                    return [];
                }
                const itemRefs =
                    Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
                        ? item.deliveryOrderItemRefs
                        : item.deliveryOrderItemRef
                            ? [item.deliveryOrderItemRef]
                            : [];
                return getInvoiceRowItemCoverageKeys({
                    doRef,
                    deliveryOrderItemRef: itemRefs[0],
                    deliveryOrderItemRefs: itemRefs,
                    tujuan: item.tujuan || '',
                    actualDropPointKey: item.actualDropPointKey,
                });
            });
            const dataset = {
                orders: ords || [],
                deliveryOrderItems: doItems || [],
                usedNotaDoRowKeys: nextUsedNotaDoRowKeys,
                usedNotaDoItemRefs: nextUsedNotaDoItemRefs,
            };
            invoiceReferenceDataRef.current = dataset;
            setOrders(dataset.orders);
            setDeliveryOrderItems(dataset.deliveryOrderItems);
            setUsedNotaDoRowKeys(dataset.usedNotaDoRowKeys);
            setUsedNotaDoItemRefs(dataset.usedNotaDoItemRefs);
            setInvoiceReferenceDataLoaded(true);
            return dataset;
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data SJ invoice');
            throw error;
        } finally {
            setLoadingInvoiceReferenceData(false);
        }
    }, [addToast, deliveryOrders, editNotaId]);

    useEffect(() => {
        async function loadData() {
            try {
                const [cust, comp, dos, editNota, editNotaItems, editPayments, editAdjustments, editRefunds] = await Promise.all([
                    fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat customer'),
                    fetchAdminData<CompanyProfile | null>('/api/data?entity=company', 'Gagal memuat profil perusahaan').catch(() => null),
                    fetchAdminCollectionData<DeliveryOrder[]>('/api/data?entity=delivery-orders', 'Gagal memuat surat jalan'),
                    editNotaId
                        ? fetchAdminData<FreightNota | null>(`/api/data?entity=freight-notas&id=${editNotaId}`, 'Gagal memuat invoice yang akan direvisi')
                        : Promise.resolve(null),
                    editNotaId
                        ? fetchAllAdminCollectionData<FreightNotaItem>(
                            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: editNotaId }))}`,
                            'Gagal memuat item invoice yang akan direvisi'
                        )
                        : Promise.resolve([] as FreightNotaItem[]),
                    editNotaId
                        ? fetchAllAdminCollectionData<Payment>(
                            `/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: editNotaId }))}`,
                            'Gagal memuat pembayaran invoice yang akan direvisi'
                        )
                        : Promise.resolve([] as Payment[]),
                    editNotaId
                        ? fetchAllAdminCollectionData<{ amount?: number; status?: string }>(
                            `/api/data?entity=invoice-adjustments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: editNotaId }))}`,
                            'Gagal memuat potongan invoice yang akan direvisi'
                        )
                        : Promise.resolve([] as Array<{ amount?: number; status?: string }>),
                    editNotaId
                        ? fetchAllAdminCollectionData<CustomerOverpaymentRefund>(
                            `/api/data?entity=customer-overpayment-refunds&filter=${encodeURIComponent(JSON.stringify({ sourceInvoiceRef: editNotaId }))}`,
                            'Gagal memuat refund invoice yang akan direvisi'
                        )
                        : Promise.resolve([] as CustomerOverpaymentRefund[]),
                ]);
                setCustomers((cust || []).filter(customer => customer.active !== false));
                setCompany(comp || null);
                setDeliveryOrders((dos || []).filter((item: DeliveryOrder) => {
                    const readyForInvoice =
                        item.status === 'DELIVERED' ||
                        (item.status !== 'CANCELLED' && hasDeliveryOrderBillableCargo(item));
                    const matchesSourceOrder = !sourceOrderRef || item.orderRef === sourceOrderRef;
                    const matchesSourceDo = !sourceDoRef || item._id === sourceDoRef;
                    return readyForInvoice && matchesSourceOrder && matchesSourceDo;
                }));
                if (editNotaId) {
                    if (!editNota) {
                    throw new Error('Invoice yang akan direvisi tidak ditemukan');
                    }
                    const totalPaid = editPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
                    const totalAdjustmentAmount = editAdjustments
                        .filter(adjustment => adjustment.status !== 'VOID')
                        .reduce((sum, adjustment) => sum + (Number(adjustment.amount) || 0), 0);
                    const refundedOverpaymentAmount = editRefunds
                        .filter(refund => refund.sourceType === 'INVOICE_OVERPAID')
                        .reduce((sum, refund) => sum + (Number(refund.amount) || 0), 0);
                    if (totalPaid > 0 || totalAdjustmentAmount > 0 || refundedOverpaymentAmount > 0) {
                        setRevisionBlock({
                            invoiceNumber: editNota.notaDisplayNumber || editNota.notaNumber,
                            totalPaid,
                            paymentCount: editPayments.length,
                            totalAdjustmentAmount,
                            refundedOverpaymentAmount,
                        });
                        return;
                    }
                    skipCustomerDefaultsRef.current = true;
                    setCustomerRef(editNota.customerRef || '');
                    setCustomerName(editNota.customerName || '');
                    setIssueDate(editNota.issueDate || getBusinessDateValue());
                    setDueDate(editNota.dueDate || '');
                    setDueDateTouched(Boolean(editNota.dueDate));
                    setNotes(editNota.notes || '');
                    setBillingMode(normalizeFreightNotaBillingMode(editNota.billingMode));
                    setPph23Enabled(editNota.pph23Enabled === true);
                    setPph23RatePercent(
                        typeof editNota.pph23RatePercent === 'number'
                            ? editNota.pph23RatePercent
                            : DEFAULT_PPH23_RATE_PERCENT
                    );
                    setPph23BaseMode(editNota.pph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM');
                    setRows(
                        editNotaItems.length > 0
                            ? editNotaItems.map(item => ({
                                id: item._id,
                                doRef: item.doRef || '',
                                deliveryOrderItemRef: item.deliveryOrderItemRef,
                                deliveryOrderItemRefs: item.deliveryOrderItemRefs,
                                actualDropPointKey: item.actualDropPointKey,
                                customerRef: item.customerRef,
                                customerName: item.customerName,
                                doNumber: item.doNumber || '',
                                vehiclePlate: item.vehiclePlate || '',
                                date: item.date || getBusinessDateValue(),
                                noSJ: item.noSJ || '',
                                dari: item.dari || '',
                                tujuan: item.tujuan || '',
                                barang: item.barang || '',
                                collie: item.collie || 0,
                                beratKg: item.beratKg || 0,
                                volumeM3: item.volumeM3 || 0,
                                tarip: item.tarip || 0,
                                taripSource: item.taripSource || 'MANUAL',
                                customerBillingRateRef: item.customerBillingRateRef,
                                customerBillingRateName: item.customerBillingRateName,
                                customerBillingRateSnapshot: item.customerBillingRateSnapshot,
                                uangRp: item.uangRp || 0,
                                ket: item.ket || '',
                                plt: item.plt || '',
                                pc: item.pc || '',
                                k: item.k || '',
                                kbl: item.kbl || '',
                                invoiceLineDate: item.invoiceLineDate || '',
                            }))
                            : [createEmptyNotaRow()]
                    );
                }
            } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data invoice');
            } finally {
                setLoadingInitialData(false);
            }
        }

        void loadData();
    }, [addToast, editNotaId, sourceDoRef, sourceOrderRef]);

    useEffect(() => {
        const nextDueDate = getSuggestedNotaDueDate({
            customerRef,
            customers,
            company,
            issueDate,
            dueDateTouched,
        });
        if (nextDueDate) {
            setDueDate(nextDueDate);
        }
    }, [company, customerRef, customers, dueDateTouched, issueDate]);

    useEffect(() => {
        if (!customerRef) return;
        void ensureCustomerBillingRates(customerRef);
        if (skipCustomerDefaultsRef.current) {
            skipCustomerDefaultsRef.current = false;
            return;
        }
        const selectedCustomer = customers.find(item => item._id === customerRef);
        if (!selectedCustomer) return;
        setBillingMode(normalizeFreightNotaBillingMode(selectedCustomer.defaultFreightNotaBillingMode));
        setPph23Enabled(selectedCustomer.defaultPph23Enabled === true);
        setPph23RatePercent(
            typeof selectedCustomer.defaultPph23RatePercent === 'number'
                ? selectedCustomer.defaultPph23RatePercent
                : DEFAULT_PPH23_RATE_PERCENT
        );
        setPph23BaseMode(selectedCustomer.defaultPph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM');
    }, [customerRef, customers, ensureCustomerBillingRates]);

    useEffect(() => {
        if (!customerRef || editNotaId) return;
        void ensureInvoiceReferenceData().catch(() => {});
    }, [customerRef, editNotaId, ensureInvoiceReferenceData]);

    useEffect(() => {
        setRows(previous => previous.map(row => ({
            ...row,
            uangRp: Math.round(calculateFreightNotaRowAmount({
                beratKg: row.beratKg,
                volumeM3: row.volumeM3,
                tarip: row.tarip,
                billingMode,
            })),
        })));
    }, [billingMode]);

    const resolveRowBillingRate = useCallback((
        row: NotaItemRow,
        mode: FreightNotaBillingMode = billingMode,
        rateRows: CustomerBillingRate[] = customerBillingRates
    ) => {
        const deliveryOrder = row.doRef ? deliveryOrders.find(item => item._id === row.doRef) : null;
        return findMatchingCustomerBillingRate(rateRows, {
            customerRef: row.customerRef || customerRef,
            serviceRef: deliveryOrder?.vehicleServiceRef || deliveryOrder?.serviceRef,
            basis: mode,
            routeFrom: row.dari,
            routeTo: row.tujuan,
        });
    }, [billingMode, customerBillingRates, customerRef, deliveryOrders]);

    const buildCalculatedRow = useCallback((
        row: NotaItemRow,
        mode: FreightNotaBillingMode = billingMode,
        rateRows: CustomerBillingRate[] = customerBillingRates
    ) => {
        const matchedRate = resolveRowBillingRate(row, mode, rateRows);
        const shouldKeepManualRate = row.taripSource === 'MANUAL';
        const hasMasterSnapshot = row.taripSource === 'MASTER' && Boolean(row.customerBillingRateRef || row.customerBillingRateSnapshot);
        const tarip = shouldKeepManualRate ? row.tarip : matchedRate?.rate || row.tarip;
        const taripSource: NotaItemRow['taripSource'] = !shouldKeepManualRate && (matchedRate || hasMasterSnapshot) ? 'MASTER' : 'MANUAL';
        return {
            ...row,
            tarip,
            taripSource,
            customerBillingRateRef: taripSource === 'MASTER' ? (matchedRate?._id || row.customerBillingRateRef) : undefined,
            customerBillingRateName: taripSource === 'MASTER' ? (matchedRate ? buildCustomerBillingRateLabel(matchedRate) : row.customerBillingRateName) : undefined,
            customerBillingRateSnapshot: taripSource === 'MASTER' ? tarip : undefined,
            uangRp: Math.round(calculateFreightNotaRowAmount({
                beratKg: row.beratKg,
                volumeM3: row.volumeM3,
                tarip,
                billingMode: mode,
            })),
        };
    }, [billingMode, customerBillingRates, resolveRowBillingRate]);

    useEffect(() => {
        setRows(previous => previous.map(row => buildCalculatedRow(row)));
    }, [buildCalculatedRow]);

    const shouldRecalculateRow = (field: keyof NotaItemRow) =>
        field === 'beratKg' ||
        field === 'volumeM3' ||
        field === 'tarip' ||
        field === 'dari' ||
        field === 'tujuan' ||
        field === 'customerRef';

    const updateRow = (id: string, field: keyof NotaItemRow, value: string | number) => {
        setRows(previous =>
            previous.map(row => {
                if (row.id !== id) return row;
                const updated = {
                    ...row,
                    [field]: value,
                    ...(field === 'tarip'
                        ? {
                            taripSource: 'MANUAL' as const,
                            customerBillingRateRef: undefined,
                            customerBillingRateName: undefined,
                            customerBillingRateSnapshot: undefined,
                        }
                        : field === 'dari' || field === 'tujuan' || field === 'customerRef'
                            ? {
                                customerBillingRateRef: undefined,
                                customerBillingRateName: undefined,
                                customerBillingRateSnapshot: undefined,
                            }
                        : {}),
                };
                return shouldRecalculateRow(field)
                    ? buildCalculatedRow(updated)
                    : updated;
            })
        );
    };

    const updateEditingRow = (field: keyof NotaItemRow, value: string | number) => {
        setEditingRow(previous => {
            if (!previous) return previous;
            const updated = {
                ...previous,
                [field]: value,
                ...(field === 'tarip'
                    ? {
                        taripSource: 'MANUAL' as const,
                        customerBillingRateRef: undefined,
                        customerBillingRateName: undefined,
                        customerBillingRateSnapshot: undefined,
                    }
                    : field === 'dari' || field === 'tujuan' || field === 'customerRef'
                        ? {
                            customerBillingRateRef: undefined,
                            customerBillingRateName: undefined,
                            customerBillingRateSnapshot: undefined,
                        }
                    : {}),
            };
            return shouldRecalculateRow(field)
                ? buildCalculatedRow(updated)
                : updated;
        });
    };

    const openEditRowModal = (row: NotaItemRow) => {
        setEditingRow({ ...row });
    };

    const closeEditRowModal = () => {
        setEditingRow(null);
    };

    const saveEditedRow = () => {
        if (!editingRow) return;
        setRows(previous => previous.map(row => (
            row.id === editingRow.id ? buildCalculatedRow(editingRow) : row
        )));
        closeEditRowModal();
    };

    const applyMasterRateToRow = async (rowId: string) => {
        const targetRow = rows.find(row => row.id === rowId);
        if (!targetRow) return;
        const rates = await ensureCustomerBillingRates(targetRow.customerRef || customerRef);
        const matchedRate = resolveRowBillingRate(targetRow, billingMode, rates);
        if (!matchedRate) {
            addToast('error', 'Tarif master untuk baris ini belum ditemukan');
            return;
        }
        setRows(previous => previous.map(row => (
            row.id === rowId
                ? buildCalculatedRow({ ...row, taripSource: 'MASTER' }, billingMode, rates)
                : row
        )));
    };

    const applyMasterRateToEditingRow = async () => {
        if (!editingRow) return;
        const rates = await ensureCustomerBillingRates(editingRow.customerRef || customerRef);
        const matchedRate = resolveRowBillingRate(editingRow, billingMode, rates);
        if (!matchedRate) {
            addToast('error', 'Tarif master untuk baris ini belum ditemukan');
            return;
        }
        setEditingRow(buildCalculatedRow({ ...editingRow, taripSource: 'MASTER' }, billingMode, rates));
    };

    const getAvailableNotaRowsForDeliveryOrder = useCallback((
        deliveryOrder: DeliveryOrder,
        targetCustomerRef?: string,
        referenceData?: InvoiceReferenceData
    ) => {
        const referenceOrders = referenceData?.orders ?? orders;
        const referenceDeliveryOrderItems = referenceData?.deliveryOrderItems ?? deliveryOrderItems;
        const referenceUsedNotaDoRowKeys = referenceData?.usedNotaDoRowKeys ?? usedNotaDoRowKeys;
        const referenceUsedNotaDoItemRefs = referenceData?.usedNotaDoItemRefs ?? usedNotaDoItemRefs;
        const usedDoRowKeySet = new Set(referenceUsedNotaDoRowKeys);
        const usedDoItemRefSet = new Set(referenceUsedNotaDoItemRefs);
        const selectedDoItemRefSet = new Set(
            rows.flatMap(row => getInvoiceRowItemCoverageKeys(row))
        );
        const selectedRowKeys = new Set(
            rows.flatMap(row => {
                if (isEmptyNotaRow(row)) {
                    return [];
                }
                const rowItemCoverageKeys = getInvoiceRowItemCoverageKeys(row);
                return rowItemCoverageKeys.length > 0
                    ? rowItemCoverageKeys
                    : [`${row.doRef || 'manual'}::${row.noSJ || row.id}`];
            })
        );

        return buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: referenceOrders,
            deliveryOrderItems: referenceDeliveryOrderItems,
        }).filter(row => {
            const rowItemCoverageKeys = getInvoiceRowItemCoverageKeys(row);
            if (rowItemCoverageKeys.length > 0 && rowItemCoverageKeys.some(itemKey => usedDoItemRefSet.has(itemKey) || selectedDoItemRefSet.has(itemKey))) {
                return false;
            }
            if (targetCustomerRef && (row.customerRef || '') !== targetCustomerRef) {
                return false;
            }
            const rowCoverageKeys = getInvoiceRowAvailabilityCoverageKeys(row, deliveryOrder);
            if (rowCoverageKeys.some(key => usedDoRowKeySet.has(key) || selectedRowKeys.has(key))) {
                return false;
            }
            return true;
        });
    }, [deliveryOrderItems, orders, rows, usedNotaDoItemRefs, usedNotaDoRowKeys]);

    const appendInvoiceRows = useCallback((nextRows: NotaItemRow[]) => {
        setRows(previous => {
            const calculatedRows = nextRows.map(row => buildCalculatedRow(row));
            const emptyIndex = previous.findIndex(isEmptyNotaRow);
            if (emptyIndex === -1) {
                return [...previous, ...calculatedRows];
            }

            const next = [...previous];
            const [firstRow, ...remainingRows] = calculatedRows;
            next[emptyIndex] = { ...firstRow, id: previous[emptyIndex].id };
            if (remainingRows.length > 0) {
                next.push(...remainingRows);
            }
            return next;
        });
    }, [buildCalculatedRow]);

    const applyCustomerDefaults = (selectedCustomer: Customer) => {
        setBillingMode(normalizeFreightNotaBillingMode(selectedCustomer.defaultFreightNotaBillingMode));
        setPph23Enabled(selectedCustomer.defaultPph23Enabled === true);
        setPph23RatePercent(
            typeof selectedCustomer.defaultPph23RatePercent === 'number'
                ? selectedCustomer.defaultPph23RatePercent
                : DEFAULT_PPH23_RATE_PERCENT
        );
        setPph23BaseMode(selectedCustomer.defaultPph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM');
    };

    const applyCustomerFromInvoiceRows = (nextRows: NotaItemRow[]): { ok: boolean; billingMode: FreightNotaBillingMode; customerRef?: string } => {
        let effectiveBillingMode = billingMode;
        let effectiveCustomerRef = customerRef;
        if (!customerRef) {
            const rowCustomers: Array<[string, string]> = Array.from(
                new Map(
                    nextRows
                        .filter(row => row.customerRef && row.customerName)
                        .map(row => [row.customerRef as string, row.customerName as string])
                ).entries()
            );
            if (rowCustomers.length > 1) {
                addToast('error', 'DO ini punya SJ dengan customer invoice berbeda. Pilih customer invoice dulu.');
                return { ok: false, billingMode: effectiveBillingMode };
            }
            if (rowCustomers.length === 1) {
                const [nextCustomerRef, nextCustomerName] = rowCustomers[0];
                effectiveCustomerRef = nextCustomerRef;
                setCustomerRef(nextCustomerRef);
                setCustomerName(nextCustomerName);
                const selectedCustomer = customers.find(customer => customer._id === nextCustomerRef);
                if (selectedCustomer) {
                    effectiveBillingMode = normalizeFreightNotaBillingMode(selectedCustomer.defaultFreightNotaBillingMode);
                    applyCustomerDefaults(selectedCustomer);
                }
            }
        } else if (!customerName) {
            const selectedCustomerName = customers.find(customer => customer._id === customerRef)?.name || '';
            if (selectedCustomerName) {
                setCustomerName(selectedCustomerName);
            }
        }
        return { ok: true, billingMode: effectiveBillingMode, customerRef: effectiveCustomerRef };
    };

    const openDORowSelector = async (doId: string) => {
        const deliveryOrder = deliveryOrders.find(item => item._id === doId);
        if (!deliveryOrder) {
            addToast('error', 'DO tidak ditemukan');
            return;
        }
        let referenceData: InvoiceReferenceData;
        try {
            referenceData = await ensureInvoiceReferenceData();
        } catch {
            return;
        }
        const nextRows = getAvailableNotaRowsForDeliveryOrder(deliveryOrder, customerRef || undefined, referenceData);
        if (nextRows.length === 0) {
            addToast('error', customerRef ? 'Tidak ada SJ yang tersisa untuk customer invoice ini pada DO tersebut' : 'Semua item SJ pada DO ini sudah masuk invoice atau sudah ada di invoice saat ini');
            return;
        }

        const customerApplication = applyCustomerFromInvoiceRows(nextRows);
        if (!customerApplication.ok) {
            return;
        }
        const rateCustomerRef = customerApplication.customerRef || nextRows[0]?.customerRef || customerRef;
        const rateRows = await ensureCustomerBillingRates(rateCustomerRef);

        const groupKeys = [...new Set(nextRows.map(getInvoiceRowSjGroupKey))];
        setPendingDoSelection({
            deliveryOrder,
            rows: nextRows.map(row => buildCalculatedRow(row, customerApplication.billingMode, rateRows)),
            selectedGroupKeys: groupKeys.length === 1 ? groupKeys : [],
        });
    };

    useEffect(() => {
        setPendingDoSelection(previous => previous ? ({
            ...previous,
            rows: previous.rows.map(row => buildCalculatedRow(row)),
        }) : previous);
    }, [buildCalculatedRow]);

    const togglePendingSjGroup = (groupKey: string) => {
        setPendingDoSelection(previous => {
            if (!previous) return previous;
            const selectedSet = new Set(previous.selectedGroupKeys);
            if (selectedSet.has(groupKey)) {
                selectedSet.delete(groupKey);
            } else {
                selectedSet.add(groupKey);
            }
            return { ...previous, selectedGroupKeys: Array.from(selectedSet) };
        });
    };

    const confirmPendingDoSelection = () => {
        if (!pendingDoSelection) return;
        const selectedSet = new Set(pendingDoSelection.selectedGroupKeys);
        const selectedRows = pendingDoSelection.rows.filter(row => selectedSet.has(getInvoiceRowSjGroupKey(row)));
        if (selectedRows.length === 0) {
            addToast('error', 'Pilih minimal 1 SJ yang akan masuk invoice');
            return;
        }
        appendInvoiceRows(selectedRows);
        setPendingDoSelection(null);
    };

    const removeRow = (id: string) => {
        setRows(previous => previous.filter(row => row.id !== id));
    };

    const pendingSjGroups = useMemo(() => {
        if (!pendingDoSelection) {
            return [];
        }

        const groupMap = new Map<string, {
            key: string;
            noSJ: string;
            customerName: string;
            tujuanSummary: string;
            rows: NotaItemRow[];
            collie: number;
            beratKg: number;
            volumeM3: number;
            amount: number;
        }>();

        for (const row of pendingDoSelection.rows) {
            const key = getInvoiceRowSjGroupKey(row);
            const current = groupMap.get(key) || {
                key,
                noSJ: row.noSJ || '-',
                customerName: row.customerName || customerName || '-',
                tujuanSummary: '',
                rows: [],
                collie: 0,
                beratKg: 0,
                volumeM3: 0,
                amount: 0,
            };
            current.rows.push(row);
            current.collie += row.collie || 0;
            current.beratKg += row.beratKg || 0;
            current.volumeM3 += row.volumeM3 || 0;
            current.amount += row.uangRp || 0;
            current.tujuanSummary = [...new Set(
                current.rows
                    .map(item => item.tujuan?.trim())
                    .filter((value): value is string => Boolean(value))
            )].join(', ');
            groupMap.set(key, current);
        }

        return Array.from(groupMap.values());
    }, [customerName, pendingDoSelection]);

    if (loadingInitialData) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 220 }} /></div>;
    }

    if (revisionBlock) {
        return (
            <div>
                <div className="page-header">
                    <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <PageBackButton href={returnTo || `/invoices/${editNotaId}`} />
                        <h1 className="page-title" style={{ margin: 0 }}>Invoice Tidak Bisa Direvisi Penuh</h1>
                    </div>
                </div>
                <div className="empty-state" style={{ maxWidth: 760, margin: '2rem auto', textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <div style={{ width: 42, height: 42, borderRadius: '0.65rem', background: 'var(--color-warning-light)', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Lock size={22} />
                        </div>
                        <div>
                            <div className="empty-state-title" style={{ margin: 0 }}>{revisionBlock.invoiceNumber}</div>
                            <div className="empty-state-text" style={{ marginTop: '0.15rem' }}>
                                Invoice sudah punya transaksi lanjutan, jadi isi invoice tidak dibuka untuk revisi penuh.
                            </div>
                        </div>
                    </div>
                    <div className="card" style={{ border: '1px solid var(--color-border)', marginTop: '1rem' }}>
                        <div className="card-body" style={{ display: 'grid', gap: '0.75rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                                <div><div className="detail-label">Penerimaan</div><div className="detail-value">{revisionBlock.paymentCount} transaksi | {formatCurrency(revisionBlock.totalPaid)}</div></div>
                                <div><div className="detail-label">Klaim / Potongan</div><div className="detail-value">{formatCurrency(revisionBlock.totalAdjustmentAmount)}</div></div>
                                <div><div className="detail-label">Refund</div><div className="detail-value">{formatCurrency(revisionBlock.refundedOverpaymentAmount)}</div></div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                                <AlertTriangle size={16} style={{ marginTop: 2, color: 'var(--color-warning)', flexShrink: 0 }} />
                                <span>
                                    Kalau nominal uang masuk salah, buka detail invoice lalu gunakan Koreksi pada Riwayat Pembayaran. Kalau ada SJ tambahan setelah invoice dibayar, buat invoice baru sebagai tagihan susulan agar kas dan histori invoice lama tetap utuh.
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button className="btn btn-primary" onClick={() => router.push(`/invoices/${editNotaId}`)}>
                                    Buka Detail Invoice
                                </button>
                                <button className="btn btn-secondary" onClick={() => router.push('/invoices/new')}>
                                    Buat Tagihan Susulan
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalBerat = rows.reduce((sum, row) => sum + (row.beratKg || 0), 0);
    const totalVolume = rows.reduce((sum, row) => sum + (row.volumeM3 || 0), 0);
    const totalAmount = rows.reduce((sum, row) => sum + (row.uangRp || 0), 0);
    const pph23Summary = calculatePph23Summary({
        grossAmount: totalAmount,
        claimAmount: 0,
        enabled: pph23Enabled,
        ratePercent: pph23RatePercent,
        baseMode: pph23BaseMode,
    });
    const hasSelectedRows = rows.some(row => Boolean(row.doRef));
    const totalBeratLabel = formatFreightNotaDisplayWeight({
        beratKg: totalBerat,
        volumeM3: totalVolume,
        billingMode,
        includeCanonical: billingMode === 'PER_TON',
    });

    const handleSave = async () => {
        if (!customerName) {
            addToast('error', 'Nama customer wajib diisi');
            return;
        }
        const filledRows = rows.filter(row => !isEmptyNotaRow(row));
        if (filledRows.length === 0) {
            addToast('error', 'Minimal 1 baris perjalanan');
            return;
        }
        if (customerRef) {
            const mismatchedRow = filledRows.find(row => row.customerRef && row.customerRef !== customerRef);
            if (mismatchedRow) {
            addToast('error', `SJ ${mismatchedRow.noSJ || '-'} memakai customer invoice berbeda. Pisahkan ke invoice lain.`);
                return;
            }
        }

        setSaving(true);
        try {
            const notaResponse = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'freight-notas',
                    action: isEditMode ? 'update-with-items' : 'create-with-items',
                    data: {
                        id: editNotaId || undefined,
                        customerRef: customerRef || undefined,
                        customerName,
                        issueDate,
                        dueDate: dueDate || undefined,
                        notes: notes || undefined,
                        billingMode,
                        pph23Enabled,
                        pph23RatePercent,
                        pph23BaseMode,
                        items: filledRows,
                    },
                }),
            });
            const notaPayload = await notaResponse.json();
            if (!notaResponse.ok) {
                addToast('error', notaPayload.error || (isEditMode ? 'Gagal merevisi invoice' : 'Gagal membuat invoice'));
                return;
            }

            addToast('success', isEditMode ? 'Invoice berhasil direvisi' : 'Invoice berhasil dibuat');
            const nextNotaId = isEditMode ? editNotaId : notaPayload.data._id;
            router.push(
                returnTo
                    ? `/invoices/${nextNotaId}?returnTo=${encodeURIComponent(returnTo)}`
                    : `/invoices/${nextNotaId}`
            );
        } catch {
            addToast('error', isEditMode ? 'Gagal merevisi invoice' : 'Gagal membuat invoice');
        } finally {
            setSaving(false);
        }
    };

    const availableDeliveryOrderOptions = deliveryOrders.flatMap(deliveryOrder => {
        if (!invoiceReferenceDataLoaded) {
            if (customerRef) {
                const matchesSelectedCustomer =
                    deliveryOrder.customerRef === customerRef ||
                    orders.some(order => order._id === deliveryOrder.orderRef && order.customerRef === customerRef) ||
                    (deliveryOrder.shipperReferences || []).some(reference => reference.billingCustomerRef === customerRef) ||
                    (deliveryOrder.actualDropPoints || []).some(point => point.billingCustomerRef === customerRef);
                if (!matchesSelectedCustomer) {
                    return [];
                }
            }
            const noSJList = [...new Set(
                (deliveryOrder.shipperReferences || [])
                    .map(reference => reference.referenceNumber?.trim())
                    .filter((value): value is string => Boolean(value))
            )];
            const tujuanList = [...new Set(
                (deliveryOrder.shipperReferences || [])
                    .map(reference => reference.receiverAddress?.trim())
                    .filter((value): value is string => Boolean(value))
            )];
            return [{
                deliveryOrder,
                noSJSummary: noSJList.join(', ') || deliveryOrder.customerDoNumber || deliveryOrder.doNumber || '-',
                tujuanSummary: tujuanList.join(', ') || deliveryOrder.receiverAddress || '-',
                sjCount: noSJList.length || 1,
                rowCount: 0,
            }];
        }

        const nextRows = getAvailableNotaRowsForDeliveryOrder(deliveryOrder, customerRef || undefined, invoiceReferenceDataRef.current || undefined);
        if (nextRows.length === 0) {
            return [];
        }
        if (!customerRef) {
            const rowCustomers = Array.from(
                new Map(
                    nextRows
                        .filter(row => row.customerRef && row.customerName)
                        .map(row => [row.customerRef as string, row.customerName as string])
                ).entries()
            );
            if (rowCustomers.length > 1) {
                return [];
            }
        }

        const noSJList = [...new Set(nextRows.map(row => row.noSJ?.trim()).filter((value): value is string => Boolean(value)))];
        const tujuanList = [...new Set(nextRows.map(row => row.tujuan?.trim()).filter((value): value is string => Boolean(value)))];

        return [{
            deliveryOrder,
            noSJSummary: noSJList.join(', '),
            tujuanSummary: tujuanList.join(', '),
            sjCount: noSJList.length || nextRows.length,
            rowCount: nextRows.length,
        }];
    });
    const sourceOrder = sourceOrderRef ? orders.find(item => item._id === sourceOrderRef) || null : null;
    const sourceDo = sourceDoRef ? deliveryOrders.find(item => item._id === sourceDoRef) || null : null;
    const hasSourceContext = Boolean(sourceOrderRef || sourceDoRef);
    const sourceContextLabel = sourceDo
        ? formatInternalDeliveryOrderNumber(sourceDo)
        : sourceOrder
            ? sourceOrder.masterResi || 'order ini'
            : sourceDoRef
                ? 'DO yang dipilih'
                : sourceOrderRef
                    ? 'order yang dipilih'
                    : '';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href={returnTo || (isEditMode ? `/invoices/${editNotaId}` : '/invoices')} />
                    <h1 className="page-title" style={{ margin: 0 }}>{isEditMode ? 'Revisi Invoice Ongkos Angkut' : 'Buat Invoice Ongkos Angkut'}</h1>
                </div>
            </div>

            <div className="detail-grid">
                <div>
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">Info Invoice</span>
                        </div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">
                                    Customer / Penagih <span className="required">*</span>
                                </label>
                                                                <Combobox
                                    value={customerRef}
                                    onChange={(v: string) => {
                                        const selectedId = v;
                                        setCustomerRef(selectedId);
                                        const customer = customers.find(item => item._id === selectedId);
                                        setCustomerName(customer?.name || '');
                                    }}
                                    options={customers.map(customer => (
                                        { value: customer._id, label: customer.name }
                                    ))}
                                    placeholder="-- Pilih Customer --"
                                    disabled={hasSelectedRows}
                                    className="form-select"
                                />
                            </div>

                            {!customerRef && (
                                <div className="form-group">
                                    <label className="form-label">Atau ketik nama customer / penagih</label>
                                    <input
                                        className="form-input"
                                        value={customerName}
                                        onChange={event => setCustomerName(event.target.value)}
                                        placeholder="Nama perusahaan..."
                                    />
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Invoice</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={issueDate}
                                        onChange={event => setIssueDate(event.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jatuh Tempo</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={dueDate}
                                        onChange={event => {
                                            setDueDateTouched(true);
                                            setDueDate(event.target.value);
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="form-group" style={{ maxWidth: 320 }}>
                                <label className="form-label">Basis Billing Invoice</label>
                                                                <Combobox
                                    value={billingMode}
                                    onChange={(v: string) => setBillingMode(v as FreightNotaBillingMode)}
                                    options={FREIGHT_NOTA_BILLING_MODE_OPTIONS.map(option => (
                                        { value: option.value, label: option.label }
                                    ))}
                                    className="form-select"
                                />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Default customer akan terpakai otomatis. Kamu masih bisa override per invoice kalau customer minta invoice dalam ton.
                                </div>
                            </div>
                            <div className="card" style={{ marginTop: '1rem', border: '1px solid var(--color-border)' }}>
                                <div className="card-body" style={{ padding: '1rem' }}>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">PPh 23</label>
                                                                                        <Combobox
                                                value={pph23Enabled ? 'YA' : 'TIDAK'}
                                                onChange={(v: string) => {
                                                    const nextEnabled = v === 'YA';
                                                    setPph23Enabled(nextEnabled);
                                                    if (nextEnabled && pph23RatePercent <= 0) {
                                                        setPph23RatePercent(DEFAULT_PPH23_RATE_PERCENT);
                                                    }
                                                }}
                                                options={[{ value: "TIDAK", label: "Tidak dipotong" }, { value: "YA", label: "Potong PPh 23" }]}
                                                className="form-select"
                                            />
                                        </div>
                                        <div className="form-group" style={{ maxWidth: 180 }}>
                                            <label className="form-label">Tarif PPh 23 (%)</label>
                                            <FormattedNumberInput
                                                maxFractionDigits={2}
                                                value={pph23RatePercent}
                                                onValueChange={value => setPph23RatePercent(value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ maxWidth: 280 }}>
                                        <label className="form-label">Basis Hitung PPh 23</label>
                                                                                <Combobox
                                            value={pph23BaseMode}
                                            onChange={(v: string) => setPph23BaseMode(v as 'BEFORE_CLAIM' | 'AFTER_CLAIM')}
                                            options={PPH23_BASE_MODE_OPTIONS.map(option => (
                                                { value: option.value, label: option.label }
                                            ))}
                                            className="form-select"
                                        />
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        {buildPph23Label({ enabled: pph23Enabled, ratePercent: pph23RatePercent, baseMode: pph23BaseMode })}. Masih bisa diubah lagi di detail invoice sebelum ada pembayaran.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={notes}
                                    onChange={event => setNotes(event.target.value)}
                                    placeholder="Opsional..."
                                />
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="card-header">
                            <span className="card-header-title">Tambah dari Surat Jalan</span>
                        </div>
                        <div className="card-body">
                            {hasSourceContext && (
                                <div
                                    className="text-sm"
                                    style={{
                                        marginBottom: '0.75rem',
                                        padding: '0.65rem 0.75rem',
                                        borderRadius: '0.5rem',
                                        background: 'var(--color-primary-light)',
                                        color: 'var(--color-primary-800)',
                                    }}
                                >
                                    Menampilkan SJ siap tagih dari {sourceContextLabel}. SJ yang sudah masuk invoice lain tetap disembunyikan.
                                </div>
                            )}
                                                        <Combobox
                                value=""
                                onChange={(v: string) => {
                                    if (v) {
                                        void openDORowSelector(v);
                                        
                                    }
                                }}
                                options={availableDeliveryOrderOptions.map(({ deliveryOrder, noSJSummary, tujuanSummary, sjCount, rowCount }) => {
                                            const availabilityText = invoiceReferenceDataLoaded
                                                ? `${sjCount} SJ tersisa / ${rowCount} barang`
                                                : `${sjCount} SJ siap dicek`;
                                            return (
                                                { value: deliveryOrder._id, label: `${formatInternalDeliveryOrderNumber(deliveryOrder)} | ${availabilityText}${noSJSummary ? ` | ${noSJSummary}` : getShipperReferenceCount(deliveryOrder) > 0 ? ` | ${formatShipperDeliveryOrderNumber(deliveryOrder)}` : ''} - ${deliveryOrder.vehiclePlate || '-'} - ${tujuanSummary || formatShipperReceiverSummary(deliveryOrder, { fallback: deliveryOrder.receiverAddress || '-' })}` }
                                            );
                                        })}
                                placeholder={loadingInvoiceReferenceData ? 'Memuat data SJ...' : '-- Pilih SJ siap tagih --'}
                                disabled={loadingInvoiceReferenceData}
                                className="form-select"
                            />
                        </div>
                    </div>
                </div>

                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div
                            style={{
                                background: 'linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)',
                                color: '#fff',
                                padding: '1.25rem',
                            }}
                            >
                                <div
                                    style={{
                                    fontSize: '0.72rem',
                                    opacity: 0.8,
                                    textTransform: 'uppercase',
                                    marginBottom: '0.25rem',
                                }}
                            >
                                Invoice Bruto
                            </div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(totalAmount)}</div>
                        </div>
                        <div className="card-body">
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '0.5rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">Total Collie</span>
                                <strong>{formatQuantity(totalCollie)}</strong>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '1rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">Total Berat</span>
                                <strong>{totalBeratLabel}</strong>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '1rem',
                                    fontSize: '0.85rem',
                                }}
                                >
                                    <span className="text-muted">Basis Billing</span>
                                    <strong>{getFreightNotaBillingModeLabel(billingMode)}</strong>
                                </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '0.5rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">PPh 23</span>
                                <strong>{pph23Enabled ? `-${formatCurrency(pph23Summary.amount)}` : '-'}</strong>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '1rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">Invoice Transfer Final</span>
                                <strong>{formatCurrency(pph23Summary.netAmount)}</strong>
                            </div>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {saving ? 'Menyimpan...' : isEditMode ? 'Simpan Revisi Invoice' : 'Simpan Invoice'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginTop: '1.5rem' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-header-title">Perincian Perjalanan</span>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setRows(previous => [...previous, createEmptyNotaRow()])}>
                                        <Plus size={14} /> Tambah Baris
                                    </button>
                </div>
                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: 1280 }}>
                        <thead>
                            <tr>
                                <th style={{ minWidth: 80 }}>NO.TRUCK</th>
                                <th style={{ minWidth: 90 }}>TANGGAL</th>
                                <th style={{ minWidth: 120 }}>NO.SJ</th>
                                <th style={{ minWidth: 100 }}>DARI</th>
                                <th style={{ minWidth: 120 }}>TUJUAN</th>
                                <th style={{ minWidth: 100 }}>BARANG</th>
                                <th style={{ minWidth: 70 }}>COLLIE</th>
                                <th style={{ minWidth: 90 }}>{getFreightNotaWeightColumnLabel(billingMode)}</th>
                                <th style={{ minWidth: 100 }}>{getFreightNotaRateColumnLabel(billingMode)}</th>
                                <th style={{ minWidth: 110 }}>UANG RP</th>
                                <th style={{ minWidth: 70 }}>PLT</th>
                                <th style={{ minWidth: 70 }}>PC</th>
                                <th style={{ minWidth: 70 }}>K</th>
                                <th style={{ minWidth: 70 }}>KBL</th>
                                <th style={{ minWidth: 110 }}>TGL</th>
                                <th style={{ minWidth: 80 }}>KET</th>
                                <th style={{ width: 96 }}>AKSI</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.id}>
                                    <td>
                                        <input
                                            className="form-input"
                                            style={{ minWidth: 75 }}
                                            value={row.vehiclePlate}
                                            onChange={event => updateRow(row.id, 'vehiclePlate', event.target.value)}
                                            placeholder="Plat..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={row.date}
                                            onChange={event => updateRow(row.id, 'date', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.noSJ}
                                            onChange={event => updateRow(row.id, 'noSJ', event.target.value)}
                                            placeholder="No. SJ..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.dari}
                                            onChange={event => updateRow(row.id, 'dari', event.target.value)}
                                            placeholder="Dari..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.tujuan}
                                            onChange={event => updateRow(row.id, 'tujuan', event.target.value)}
                                            placeholder="Tujuan..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.barang}
                                            onChange={event => updateRow(row.id, 'barang', event.target.value)}
                                            placeholder="Barang..."
                                        />
                                    </td>
                                    <td>
                                        <FormattedNumberInput
                                            maxFractionDigits={2}
                                            value={row.collie}
                                            onValueChange={value => updateRow(row.id, 'collie', value)}
                                        />
                                    </td>
                                    <td>
                                        <FormattedNumberInput
                                            maxFractionDigits={billingMode === 'PER_TON' || billingMode === 'PER_VOLUME' || billingMode === 'PER_LITER' ? 3 : 2}
                                            value={getFreightNotaDisplayWeightValue(row.beratKg, billingMode, row.volumeM3)}
                                            onValueChange={value => {
                                                if (billingMode === 'PER_VOLUME') {
                                                    updateRow(row.id, 'volumeM3', value);
                                                    return;
                                                }
                                                if (billingMode === 'PER_LITER') {
                                                    updateRow(row.id, 'volumeM3', value / 1000);
                                                    return;
                                                }
                                                if (billingMode === 'PER_TRIP') {
                                                    return;
                                                }
                                                updateRow(
                                                    row.id,
                                                    'beratKg',
                                                    convertWeightToKg(value, billingMode === 'PER_TON' ? 'TON' : 'KG'),
                                                );
                                            }}
                                        />
                                    </td>
                                    <td>
                                        <FormattedNumberInput allowDecimal={false}
                                            value={row.tarip}
                                            onValueChange={value => updateRow(row.id, 'tarip', value)}
                                            placeholder={
                                                billingMode === 'PER_TON'
                                                    ? 'Ketik tarif per ton'
                                                    : billingMode === 'PER_VOLUME'
                                                        ? 'Ketik tarif per m3'
                                                        : billingMode === 'PER_LITER'
                                                            ? 'Ketik tarif per liter'
                                                            : billingMode === 'PER_TRIP'
                                                                ? 'Ketik tarif per trip'
                                                                : 'Ketik tarif per kg'
                                            }
                                        />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                                            <span className={`badge badge-${row.taripSource === 'MASTER' ? 'success' : 'warning'}`} title={row.customerBillingRateName || undefined}>
                                                {row.taripSource === 'MASTER' ? 'Master' : 'Manual'}
                                            </span>
                                            {row.taripSource === 'MANUAL' && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.72rem' }}
                                                    onClick={() => void applyMasterRateToRow(row.id)}
                                                    disabled={loadingBillingRates}
                                                    title="Pakai tarif master customer untuk baris ini"
                                                >
                                                    <RefreshCcw size={12} /> Master
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{formatCurrency(row.uangRp)}</td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.plt}
                                            onChange={event => updateRow(row.id, 'plt', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.pc}
                                            onChange={event => updateRow(row.id, 'pc', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.k}
                                            onChange={event => updateRow(row.id, 'k', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.kbl}
                                            onChange={event => updateRow(row.id, 'kbl', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={row.invoiceLineDate}
                                            onChange={event => updateRow(row.id, 'invoiceLineDate', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.ket}
                                            onChange={event => updateRow(row.id, 'ket', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                                            <button className="table-action-btn" onClick={() => openEditRowModal(row)} title="Edit detail perjalanan">
                                                <Pencil size={13} />
                                            </button>
                                            <button className="table-action-btn danger" onClick={() => removeRow(row.id)} title="Hapus baris">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            <tr
                                style={{
                                    background: 'var(--color-bg-secondary)',
                                    fontWeight: 700,
                                    borderTop: '2px solid var(--color-border)',
                                }}
                            >
                                <td colSpan={6} style={{ textAlign: 'right', paddingRight: '0.75rem' }}>
                                    Jumlah
                                </td>
                                <td>{formatQuantity(totalCollie)}</td>
                                <td>{getFreightNotaDisplayWeightValue(totalBerat, billingMode, totalVolume).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: billingMode === 'PER_TON' || billingMode === 'PER_VOLUME' || billingMode === 'PER_LITER' ? 3 : 2 })}</td>
                                <td />
                                <td style={{ color: 'var(--color-danger)' }}>{formatCurrency(totalAmount)}</td>
                                <td colSpan={7} />
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {pendingDoSelection && (
                <div className="modal-overlay" onClick={() => setPendingDoSelection(null)}>
                    <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 880, width: '100%' }}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Pilih SJ untuk Invoice</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                    {formatInternalDeliveryOrderNumber(pendingDoSelection.deliveryOrder)} - {pendingDoSelection.deliveryOrder.vehiclePlate || '-'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setPendingDoSelection(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                <div className="text-muted text-sm">
                                    SJ yang sudah masuk invoice lain tidak ditampilkan. Pilih SJ yang akan ditagihkan sekarang.
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setPendingDoSelection(previous => previous ? ({
                                        ...previous,
                                        selectedGroupKeys: pendingSjGroups.map(group => group.key),
                                    }) : previous)}
                                >
                                    Pilih Semua Sisa
                                </button>
                            </div>
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                {pendingSjGroups.map(group => {
                                    const selected = pendingDoSelection.selectedGroupKeys.includes(group.key);
                                    return (
                                        <label
                                            key={group.key}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'auto minmax(0, 1fr)',
                                                gap: '0.75rem',
                                                alignItems: 'start',
                                                border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-gray-200)'}`,
                                                borderRadius: '0.85rem',
                                                padding: '0.9rem',
                                                background: selected ? 'var(--color-primary-light)' : 'var(--color-white)',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selected}
                                                onChange={() => togglePendingSjGroup(group.key)}
                                                style={{ marginTop: '0.25rem' }}
                                            />
                                            <div style={{ display: 'grid', gap: '0.45rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <div>
                                                        <div className="font-semibold">SJ {group.noSJ}</div>
                                                        <div className="text-muted text-sm">{group.customerName}</div>
                                                    </div>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <div className="font-semibold">{formatCurrency(group.amount)}</div>
                                                        <div className="text-muted text-sm">{group.rows.length} barang</div>
                                                    </div>
                                                </div>
                                                <div className="text-muted text-sm">
                                                    Tujuan: {group.tujuanSummary || '-'}
                                                </div>
                                                <div className="text-muted text-sm">
                                                    Muatan: {formatQuantity(group.collie)} koli / {formatFreightNotaDisplayWeight({ beratKg: group.beratKg, volumeM3: group.volumeM3, billingMode, includeCanonical: billingMode === 'PER_TON' })}
                                                </div>
                                                <div className="text-muted text-sm">
                                                    Barang: {group.rows.map(row => row.barang).filter(Boolean).join(', ') || '-'}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setPendingDoSelection(null)}>Batal</button>
                            <button className="btn btn-primary" onClick={confirmPendingDoSelection}>
                                <Plus size={16} /> Tambahkan {pendingDoSelection.selectedGroupKeys.length} SJ
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editingRow && (
                <div className="modal-overlay" onClick={closeEditRowModal}>
                    <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 860, width: '100%' }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Detail Surat Jalan</h3>
                            <button className="modal-close" onClick={closeEditRowModal}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">No. Truck</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.vehiclePlate}
                                        onChange={event => updateEditingRow('vehiclePlate', event.target.value)}
                                        placeholder="Plat kendaraan..."
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={editingRow.date}
                                        onChange={event => updateEditingRow('date', event.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">No. SJ</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.noSJ}
                                        onChange={event => updateEditingRow('noSJ', event.target.value)}
                                        placeholder="Nomor surat jalan..."
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Barang</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.barang}
                                        onChange={event => updateEditingRow('barang', event.target.value)}
                                        placeholder="Deskripsi barang..."
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Dari</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.dari}
                                        onChange={event => updateEditingRow('dari', event.target.value)}
                                        placeholder="Lokasi asal..."
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tujuan</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.tujuan}
                                        onChange={event => updateEditingRow('tujuan', event.target.value)}
                                        placeholder="Lokasi tujuan..."
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Collie</label>
                                    <FormattedNumberInput
                                        maxFractionDigits={2}
                                        value={editingRow.collie}
                                        onValueChange={value => updateEditingRow('collie', value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{getFreightNotaWeightColumnLabel(billingMode)}</label>
                                    <FormattedNumberInput
                                        maxFractionDigits={billingMode === 'PER_TON' || billingMode === 'PER_VOLUME' || billingMode === 'PER_LITER' ? 3 : 2}
                                        value={getFreightNotaDisplayWeightValue(editingRow.beratKg, billingMode, editingRow.volumeM3)}
                                        onValueChange={value => {
                                            if (billingMode === 'PER_VOLUME') {
                                                updateEditingRow('volumeM3', value);
                                                return;
                                            }
                                            if (billingMode === 'PER_LITER') {
                                                updateEditingRow('volumeM3', value / 1000);
                                                return;
                                            }
                                            if (billingMode === 'PER_TRIP') {
                                                return;
                                            }
                                            updateEditingRow(
                                                'beratKg',
                                                convertWeightToKg(value, billingMode === 'PER_TON' ? 'TON' : 'KG'),
                                            );
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">{getFreightNotaRateColumnLabel(billingMode)}</label>
                                    <FormattedNumberInput allowDecimal={false}
                                        value={editingRow.tarip}
                                        onValueChange={value => updateEditingRow('tarip', value)}
                                        placeholder={
                                            billingMode === 'PER_TON'
                                                ? 'Ketik tarif per ton'
                                                : billingMode === 'PER_VOLUME'
                                                    ? 'Ketik tarif per m3'
                                                    : billingMode === 'PER_LITER'
                                                        ? 'Ketik tarif per liter'
                                                        : billingMode === 'PER_TRIP'
                                                            ? 'Ketik tarif per trip'
                                                : 'Ketik tarif per kg'
                                        }
                                    />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                                        <span className={`badge badge-${editingRow.taripSource === 'MASTER' ? 'success' : 'warning'}`} title={editingRow.customerBillingRateName || undefined}>
                                            {editingRow.taripSource === 'MASTER' ? 'Master' : 'Manual'}
                                        </span>
                                        {editingRow.taripSource === 'MANUAL' && (
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => void applyMasterRateToEditingRow()}
                                                disabled={loadingBillingRates}
                                                title="Pakai tarif master customer untuk baris ini"
                                            >
                                                <RefreshCcw size={12} /> Master
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Uang Rp</label>
                                    <input
                                        className="form-input"
                                        value={formatCurrency(editingRow.uangRp)}
                                        readOnly
                                    />
                                </div>
                            </div>

<div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Pc</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.pc}
                                        onChange={event => updateEditingRow('pc', event.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">K</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.k}
                                        onChange={event => updateEditingRow('k', event.target.value)}
                                    />
</div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kbl</label>
                                    <input
                                        className="form-input"
                                        value={editingRow.kbl}
                                        onChange={event => updateEditingRow('kbl', event.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tgl</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={editingRow.invoiceLineDate}
                                        onChange={event => updateEditingRow('invoiceLineDate', event.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Keterangan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={editingRow.ket}
                                    onChange={event => updateEditingRow('ket', event.target.value)}
                                    placeholder="Catatan tambahan..."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeEditRowModal}>Batal</button>
                            <button className="btn btn-primary" onClick={saveEditedRow}>
                                <Save size={16} /> Simpan Perubahan
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
