'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useApp, useToast } from '../../layout';
import { Printer, DollarSign, Landmark, Trash2, FileDown, Pencil } from 'lucide-react';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    formatFreightNotaDisplayWeight,
    getFreightNotaRateColumnLabel,
    getFreightNotaWeightColumnLabel,
    normalizeFreightNotaBillingMode,
} from '@/lib/freight-nota-billing';
import {
    buildBankAccountMap,
    buildInvoiceDetailSummary,
    INVOICE_DETAIL_STATUS_MAP,
    resolvePaymentAccountLabel,
    sortInvoiceAdjustments,
} from '@/lib/invoice-detail-page-support';
import { buildPph23Label, calculatePph23Summary, DEFAULT_PPH23_RATE_PERCENT, PPH23_BASE_MODE_OPTIONS } from '@/lib/pph23';
import { buildFreightNotaPrintDocument, buildPaymentReceiptPrintDocument, fetchCompanyProfile, formatFreightNotaDisplayNumber, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import { exportFreightNotaDetail } from '@/lib/export';
import { deriveReceivableStatus, formatDate, formatCurrency, formatQuantity, INVOICE_ADJUSTMENT_KIND_MAP, PAYMENT_METHOD_MAP } from '@/lib/utils';
import type { FreightNota, FreightNotaItem, Payment, BankAccount, CompanyProfile, InvoiceAdjustment, Customer } from '@/lib/types';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
export default function NotaDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const notaId = params.id as string;
    const returnTo = searchParams.get('returnTo')?.trim() || '';
    const [nota, setNota] = useState<FreightNota | null>(null);
    const [items, setItems] = useState<FreightNotaItem[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [adjustments, setAdjustments] = useState<InvoiceAdjustment[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [customer, setCustomer] = useState<Pick<Customer, '_id' | 'name' | 'address' | 'contactPerson' | 'phone'> | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [showPayModal, setShowPayModal] = useState(false);
    const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
    const [showPph23Modal, setShowPph23Modal] = useState(false);
    const [showTaxInvoiceModal, setShowTaxInvoiceModal] = useState(false);
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [paying, setPaying] = useState(false);
    const [adjusting, setAdjusting] = useState(false);
    const [savingPph23, setSavingPph23] = useState(false);
    const [savingTaxInvoice, setSavingTaxInvoice] = useState(false);
    const [refunding, setRefunding] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [voidingAdjustmentId, setVoidingAdjustmentId] = useState<string | null>(null);
    const [payAmount, setPayAmount] = useState(0);
    const [payMethod, setPayMethod] = useState('TRANSFER');
    const [payDate, setPayDate] = useState(getBusinessDateValue());
    const [payNote, setPayNote] = useState('');
    const [payBankRef, setPayBankRef] = useState('');
    const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
    const [adjustAmount, setAdjustAmount] = useState(0);
    const [adjustKind, setAdjustKind] = useState('DAMAGE_CLAIM');
    const [adjustDate, setAdjustDate] = useState(getBusinessDateValue());
    const [adjustNote, setAdjustNote] = useState('');
    const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(null);
    const [pph23Enabled, setPph23Enabled] = useState(false);
    const [pph23RatePercent, setPph23RatePercent] = useState(DEFAULT_PPH23_RATE_PERCENT);
    const [pph23BaseMode, setPph23BaseMode] = useState<'BEFORE_CLAIM' | 'AFTER_CLAIM'>('BEFORE_CLAIM');
    const [taxInvoiceNumberDraft, setTaxInvoiceNumberDraft] = useState('');
    const [refundDate, setRefundDate] = useState(getBusinessDateValue());
    const [refundAmount, setRefundAmount] = useState(0);
    const [refundBankRef, setRefundBankRef] = useState('');
    const [refundNote, setRefundNote] = useState('');

    const loadNotaDetail = useCallback(async () => {
        setLoading(true);
        setLoadNotice(null);
        try {
            const [notaData, notaItems, paymentRows, adjustmentRows, accounts, companyData] = await Promise.all([
                fetchAdminData<FreightNota | null>(`/api/data?entity=freight-notas&id=${notaId}`, 'Gagal memuat detail invoice'),
                fetchAllAdminCollectionData<FreightNotaItem>(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`, 'Gagal memuat detail invoice'),
                fetchAllAdminCollectionData<Payment>(`/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: notaId }))}`, 'Gagal memuat detail invoice'),
                fetchAllAdminCollectionData<InvoiceAdjustment>(`/api/data?entity=invoice-adjustments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: notaId }))}`, 'Gagal memuat detail invoice'),
                fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat detail invoice'),
                fetchCompanyProfile().catch(() => null),
            ]);
            let customerData: Pick<Customer, '_id' | 'name' | 'address' | 'contactPerson' | 'phone'> | null = null;
            if (notaData?.customerRef && !(notaData.customerAddress || notaData.customerContactPerson || notaData.customerPhone)) {
                try {
                customerData = await fetchAdminData<Pick<Customer, '_id' | 'name' | 'address' | 'contactPerson' | 'phone'> | null>(`/api/data?entity=customers&id=${notaData.customerRef}`, 'Gagal memuat detail invoice');
                } catch {
                    customerData = null;
                }
            }

            setNota(notaData);
            setPph23Enabled(notaData?.pph23Enabled === true);
            setPph23RatePercent(
                typeof notaData?.pph23RatePercent === 'number'
                    ? notaData.pph23RatePercent
                    : DEFAULT_PPH23_RATE_PERCENT
            );
            setPph23BaseMode(notaData?.pph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM');
            setItems([...(notaItems || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setPayments([...(paymentRows || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setAdjustments(sortInvoiceAdjustments(adjustmentRows || []));
            setBankAccounts((accounts || []).filter(account => account.active !== false));
            setCompany(companyData);
            setCustomer(customerData);
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat detail invoice');
            setLoadNotice(buildAdminLoadNotice(
                message,
                'Invoice',
                'Halaman ini hanya bisa dilihat oleh role yang punya akses Invoice.'
            ));
            addToast('error', message);
        } finally {
            setLoading(false);
        }
    }, [addToast, notaId]);

    useEffect(() => {
        void loadNotaDetail();
    }, [loadNotaDetail]);

    const {
        totalPaidRaw,
        totalPaid,
        refundedOverpaymentAmount,
        grossAmount,
        totalAdjustmentAmount,
        pph23Enabled: effectivePph23Enabled,
        pph23RatePercent: effectivePph23RatePercent,
        pph23BaseMode: effectivePph23BaseMode,
        pph23BaseAmount,
        pph23Amount,
        netAmount,
        remaining,
        creditAmount,
        paidPercent,
    } = buildInvoiceDetailSummary({ nota, payments, adjustments });
    const accountMap = buildBankAccountMap(bankAccounts);
    const canManageInvoice = user ? hasPermission(user, 'invoices', 'update') : false;
    const canDeleteInvoice = user ? hasPermission(user, 'invoices', 'delete') : false;
    const canExportInvoice = user ? hasPermission(user, 'invoices', 'export') : false;
    const canPrintInvoice = user ? hasPermission(user, 'invoices', 'print') : false;
    const canManageOverpaymentRefund = canManageInvoice;
    const canOpenBankAccounts = user ? hasPageAccess(user, 'bankAccounts') : false;
    const isVoidedInvoice = nota?.status === 'VOID';
    const canEditPph23 = canManageInvoice && !isVoidedInvoice && totalPaidRaw <= 0 && refundedOverpaymentAmount <= 0;
    const canReviseInvoice = canManageInvoice && !isVoidedInvoice && totalPaidRaw <= 0 && refundedOverpaymentAmount <= 0 && totalAdjustmentAmount <= 0;
    const canDeleteInvoiceSafely = canDeleteInvoice && !isVoidedInvoice && totalPaidRaw <= 0 && refundedOverpaymentAmount <= 0 && totalAdjustmentAmount <= 0;
    const editingPayment = editingPaymentId ? payments.find(payment => payment._id === editingPaymentId) || null : null;
    const maxPaymentAmount = Math.max(remaining + (editingPayment ? Number(editingPayment.amount) || 0 : 0), 0);
    const draftPph23Summary = calculatePph23Summary({
        grossAmount,
        claimAmount: totalAdjustmentAmount,
        enabled: pph23Enabled,
        ratePercent: pph23RatePercent,
        baseMode: pph23BaseMode,
    });
    const paymentAccountOptions = payMethod === 'TRANSFER'
        ? bankAccounts.filter(account => account.accountType !== 'CASH')
        : payMethod === 'CASH'
            ? []
            : bankAccounts;

    useEffect(() => {
        if (!payBankRef) return;
        const selectedAccount = bankAccounts.find(account => account._id === payBankRef);
        if (!selectedAccount) {
            setPayBankRef('');
            return;
        }
        if (payMethod === 'TRANSFER' && selectedAccount.accountType === 'CASH') {
            setPayBankRef('');
        }
    }, [bankAccounts, payBankRef, payMethod]);

    const resetPaymentForm = () => {
        setEditingPaymentId(null);
        setPayAmount(0);
        setPayMethod('TRANSFER');
        setPayDate(getBusinessDateValue());
        setPayNote('');
        setPayBankRef('');
    };

    const closePaymentModal = () => {
        if (paying) return;
        setShowPayModal(false);
        resetPaymentForm();
    };

    const openCreatePaymentModal = () => {
        resetPaymentForm();
        setShowPayModal(true);
    };

    const openEditPaymentModal = (payment: Payment) => {
        if (payment.receiptRef) {
            addToast('error', 'Pembayaran dari penerimaan customer dikoreksi dari menu penerimaan customer.');
            return;
        }
        setEditingPaymentId(payment._id);
        setPayAmount(Number(payment.amount) || 0);
        setPayMethod(payment.method || 'TRANSFER');
        setPayDate(payment.date || getBusinessDateValue());
        setPayNote(payment.note || '');
        setPayBankRef(payment.method === 'CASH' ? '' : payment.bankAccountRef || '');
        setShowPayModal(true);
    };

    const resetAdjustmentForm = () => {
        setEditingAdjustmentId(null);
        setAdjustAmount(0);
        setAdjustKind('DAMAGE_CLAIM');
        setAdjustDate(getBusinessDateValue());
        setAdjustNote('');
    };

    const openCreateAdjustmentModal = () => {
        resetAdjustmentForm();
        setShowAdjustmentModal(true);
    };

    const resetPph23Form = () => {
        setPph23Enabled(nota?.pph23Enabled === true);
        setPph23RatePercent(
            typeof nota?.pph23RatePercent === 'number'
                ? nota.pph23RatePercent
                : DEFAULT_PPH23_RATE_PERCENT
        );
        setPph23BaseMode(nota?.pph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM');
    };

    const openPph23Modal = () => {
        resetPph23Form();
        setShowPph23Modal(true);
    };

    const openTaxInvoiceModal = () => {
        setTaxInvoiceNumberDraft(nota?.taxInvoiceNumber?.trim() || '');
        setShowTaxInvoiceModal(true);
    };

    const openEditAdjustmentModal = (adjustment: InvoiceAdjustment) => {
        setEditingAdjustmentId(adjustment._id);
        setAdjustAmount(Number(adjustment.amount) || 0);
        setAdjustKind(adjustment.kind || 'DAMAGE_CLAIM');
        setAdjustDate(adjustment.date || getBusinessDateValue());
        setAdjustNote(adjustment.note || '');
        setShowAdjustmentModal(true);
    };

    const resetRefundForm = () => {
        setRefundDate(getBusinessDateValue());
        setRefundAmount(Math.max(creditAmount, 0));
        setRefundBankRef('');
        setRefundNote('');
    };

    const openRefundOverpaymentModal = () => {
        resetRefundForm();
        setShowRefundModal(true);
    };

    const handleSavePayment = async () => {
        if (payAmount <= 0) { addToast('error', 'Nominal harus lebih dari 0'); return; }
        if (payAmount > maxPaymentAmount) { addToast('error', 'Nominal melebihi sisa invoice'); return; }
        if (payMethod === 'TRANSFER' && !payBankRef) { addToast('error', 'Pilih rekening bank untuk transfer'); return; }
        setPaying(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'payments',
                    action: editingPaymentId ? 'update' : undefined,
                    data: {
                        _id: editingPaymentId || undefined,
                        invoiceRef: nota?._id,
                        date: payDate,
                        amount: payAmount,
                        method: payMethod,
                        note: payNote,
                        bankAccountRef: payBankRef || undefined,
                    }
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal');
                return;
            }
            addToast('success', editingPaymentId ? 'Pembayaran invoice dikoreksi' : 'Pembayaran invoice dicatat');
            setShowPayModal(false);
            resetPaymentForm();
            await loadNotaDetail();
        } catch {
            addToast('error', 'Gagal');
        } finally {
            setPaying(false);
        }
    };

    const handleSavePph23 = async () => {
        if (!nota) return;
        if (pph23Enabled && pph23RatePercent <= 0) {
            addToast('error', 'Tarif PPh 23 harus lebih dari 0%');
            return;
        }

        setSavingPph23(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'freight-notas',
                    action: 'update-pph23',
                    data: {
                        id: nota._id,
                        pph23Enabled,
                        pph23RatePercent,
                        pph23BaseMode,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan pengaturan PPh 23');
                return;
            }
            addToast('success', 'Pengaturan PPh 23 berhasil diperbarui');
            setShowPph23Modal(false);
            await loadNotaDetail();
        } catch {
            addToast('error', 'Gagal menyimpan pengaturan PPh 23');
        } finally {
            setSavingPph23(false);
        }
    };

    const handleSaveTaxInvoiceNumber = async () => {
        if (!nota) return;

        setSavingTaxInvoice(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'freight-notas',
                    action: 'update-tax-invoice',
                    data: {
                        id: nota._id,
                        taxInvoiceNumber: taxInvoiceNumberDraft.trim(),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan no faktur pajak');
                return;
            }
            addToast('success', 'No faktur pajak berhasil diperbarui');
            setShowTaxInvoiceModal(false);
            await loadNotaDetail();
        } catch {
            addToast('error', 'Gagal menyimpan no faktur pajak');
        } finally {
            setSavingTaxInvoice(false);
        }
    };

    const handleSaveAdjustment = async () => {
        if (adjustAmount <= 0) {
            addToast('error', 'Nominal potongan invoice harus lebih dari 0');
            return;
        }
        const adjustmentBeingEdited = adjustments.find(item => item._id === editingAdjustmentId) || null;
        const adjustmentBaseAmount = adjustmentBeingEdited && adjustmentBeingEdited.status !== 'VOID'
            ? Number(adjustmentBeingEdited.amount) || 0
            : 0;
        if ((totalAdjustmentAmount - adjustmentBaseAmount + adjustAmount) > Math.max(grossAmount, 0)) {
            addToast('error', 'Potongan melebihi sisa nilai bruto invoice');
            return;
        }

        setAdjusting(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'invoice-adjustments',
                    action: editingAdjustmentId ? 'update' : undefined,
                    data: {
                        id: editingAdjustmentId || undefined,
                        invoiceRef: nota?._id,
                        date: adjustDate,
                        amount: adjustAmount,
                        kind: adjustKind,
                        note: adjustNote,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan potongan invoice');
                return;
            }
            addToast('success', editingAdjustmentId ? 'Potongan invoice berhasil diperbarui' : 'Potongan invoice berhasil dicatat');
            setShowAdjustmentModal(false);
            resetAdjustmentForm();
            await loadNotaDetail();
        } catch {
            addToast('error', 'Gagal menyimpan potongan invoice');
        } finally {
            setAdjusting(false);
        }
    };

    const handleDeleteAdjustment = async (adjustmentId: string) => {
        if (voidingAdjustmentId) return;
        if (!confirm('Hapus potongan invoice ini? Riwayatnya akan tetap tersimpan di audit log.')) return;
        setVoidingAdjustmentId(adjustmentId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'invoice-adjustments',
                    action: 'delete',
                    data: { id: adjustmentId },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus potongan invoice');
                return;
            }
            addToast('success', 'Potongan invoice dihapus');
            await loadNotaDetail();
        } catch {
            addToast('error', 'Gagal menghapus potongan invoice');
        } finally {
            setVoidingAdjustmentId(current => current === adjustmentId ? null : current);
        }
    };

    const handleConfirmOverpaymentRefund = async () => {
        if (!nota) return;
        if (refundAmount <= 0) {
            addToast('error', 'Nominal refund harus lebih dari 0');
            return;
        }
        if (refundAmount > creditAmount) {
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
                        sourceType: 'INVOICE_OVERPAID',
                        sourceInvoiceRef: nota._id,
                        date: refundDate,
                        amount: refundAmount,
                        bankAccountRef: refundBankRef,
                        note: refundNote,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal mengonfirmasi refund kelebihan bayar');
                return;
            }
            addToast('success', 'Refund kelebihan bayar berhasil dikonfirmasi');
            setShowRefundModal(false);
            resetRefundForm();
            await loadNotaDetail();
        } catch {
            addToast('error', 'Gagal mengonfirmasi refund kelebihan bayar');
        } finally {
            setRefunding(false);
        }
    };

    const handlePrint = async () => {
        if (!nota) return;
        const printWindow = openPrintWindow('Menyiapkan cetak invoice...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }
        try {
            const resolvedCompany = company ?? await fetchCompanyProfile().catch(() => null);
            const issuerBranding = resolveDocumentIssuerProfile(nota, resolvedCompany);
            setCompany(resolvedCompany);
            const doc = buildFreightNotaPrintDocument({
                nota,
                items,
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
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    const handlePrintPaymentReceipt = async (payment: Payment) => {
        if (!nota) return;
        const printWindow = openPrintWindow('Menyiapkan cetak kwitansi...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }
        try {
            const resolvedCompany = company ?? await fetchCompanyProfile().catch(() => null);
            const issuerBranding = resolveDocumentIssuerProfile(nota, resolvedCompany);
            setCompany(resolvedCompany);
            const doc = buildPaymentReceiptPrintDocument({
                payment,
                nota,
                company: resolvedCompany,
                customer,
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
                autoPrint: false,
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan kwitansi');
        }
    };

    const handleDelete = async () => {
        if (deleting) return;
        if (!confirm('Hapus invoice ini?')) return;
        setDeleting(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'freight-notas', action: 'delete', data: { id: notaId } })
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus invoice');
                return;
            }
            addToast('success', 'Invoice dihapus');
            router.push(returnTo || '/invoices');
        } catch {
            addToast('error', 'Gagal menghapus invoice');
        } finally {
            setDeleting(false);
        }
    };

    const handleExportExcel = async () => {
        if (!nota) return;
        try {
            const resolvedCompany = company ?? await fetchCompanyProfile().catch(() => null);
            setCompany(resolvedCompany);
            await exportFreightNotaDetail(nota, items, resolvedCompany, bankAccounts);
            addToast('success', 'Excel invoice berhasil di-download');
        } catch {
            addToast('error', 'Gagal menyiapkan Excel invoice');
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!nota) return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Invoice tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;

    const displayStatus = isVoidedInvoice ? 'VOID' : deriveReceivableStatus(nota, totalPaid);
    const statusConf = INVOICE_DETAIL_STATUS_MAP[displayStatus] || { label: displayStatus, color: 'secondary' };
    const displayNotaNumber = formatFreightNotaDisplayNumber(nota, company);
    const billingMode = normalizeFreightNotaBillingMode(nota.billingMode);
    const totalBilledWeightLabel = formatFreightNotaDisplayWeight({
        beratKg: nota.totalWeightKg || 0,
        volumeM3: nota.totalVolumeM3 || 0,
        billingMode,
        includeCanonical: false,
    });
    const uniqueShipperReferenceCount = new Set(
        items
            .map(item => item.noSJ?.trim())
            .filter((value): value is string => Boolean(value))
    ).size;

    return (
        <div>
            <div className="page-header" style={{ marginBottom: '0.5rem' }}>
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, flexWrap: 'wrap' }}>
                    <PageBackButton href={returnTo || '/invoices'} />
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{displayNotaNumber}</h1>
                        <span className={`badge badge-${statusConf.color}`}><span className="badge-dot" /> {statusConf.label}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        No. Invoice Internal: {nota.notaNumber}
                    </div>
                </div>
                </div>
                <div className="page-actions" style={{ gap: '0.4rem' }}>
                    {canManageInvoice && (
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => router.push(
                                returnTo
                                    ? `/invoices/new?edit=${nota._id}&returnTo=${encodeURIComponent(returnTo)}`
                                    : `/invoices/new?edit=${nota._id}`
                            )}
                            disabled={!canReviseInvoice}
                            title={canReviseInvoice ? 'Revisi invoice ini' : 'Revisi invoice hanya tersedia sebelum ada pembayaran, refund, atau klaim/potongan aktif'}
                        >
                            <Pencil size={14} /> Revisi Invoice
                        </button>
                    )}
                    {canManageInvoice && !isVoidedInvoice && displayStatus !== 'PAID' && <button className="btn btn-success btn-sm" onClick={openCreatePaymentModal}><DollarSign size={14} /> Catat Pembayaran</button>}
                    {canManageInvoice && !isVoidedInvoice && grossAmount > totalAdjustmentAmount && <button className="btn btn-secondary btn-sm" onClick={openCreateAdjustmentModal}>Catat Klaim / Potongan</button>}
                    {canEditPph23 && <button className="btn btn-secondary btn-sm" onClick={openPph23Modal}>Atur PPh 23</button>}
                    {canManageInvoice && !isVoidedInvoice && <button className="btn btn-secondary btn-sm" onClick={openTaxInvoiceModal}>No Faktur Pajak</button>}
                    {canManageOverpaymentRefund && creditAmount > 0 && <button className="btn btn-warning btn-sm" onClick={openRefundOverpaymentModal}>Konfirmasi Transfer Balik</button>}
                    {canExportInvoice && <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={14} /> Excel</button>}
                    {canPrintInvoice && <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={14} /> Cetak Invoice</button>}
                    {canDeleteInvoice && (
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={handleDelete}
                            disabled={deleting || !canDeleteInvoiceSafely}
                            title={canDeleteInvoiceSafely ? 'Hapus invoice ini' : 'Invoice tidak bisa dihapus setelah ada pembayaran, refund, atau klaim/potongan aktif'}
                        >
                            <Trash2 size={14} /> Hapus Invoice
                        </button>
                    )}
                </div>
            </div>

            {canManageInvoice && !canReviseInvoice && !isVoidedInvoice && (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.65rem',
                        padding: '0.75rem 0.85rem',
                        borderRadius: '0.55rem',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-warning-light)',
                        color: 'var(--color-warning)',
                        marginBottom: '0.75rem',
                    }}
                >
                    <Pencil size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.86rem', lineHeight: 1.45 }}>
                        Invoice ini sudah punya pembayaran, refund, atau klaim/potongan. Koreksi nominal uang masuk dari Riwayat Pembayaran, dan buat invoice baru kalau ada SJ tambahan yang perlu ditagih.
                    </div>
                </div>
            )}

            <div className="detail-grid" style={{ alignItems: 'start' }}>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Detail Invoice</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Cetak Invoice</div><div className="detail-value font-mono">{displayNotaNumber}</div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(nota.issueDate)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value font-semibold">{nota.customerName}</div></div>
                            <div className="detail-item"><div className="detail-label">Jatuh Tempo</div><div className="detail-value">{nota.dueDate ? formatDate(nota.dueDate) : '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Invoice Internal</div><div className="detail-value font-mono">{nota.notaNumber}</div></div>
                            <div className="detail-item"><div className="detail-label">No Faktur Pajak</div><div className="detail-value font-mono">{nota.taxInvoiceNumber?.trim() || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Total Collie</div><div className="detail-value">{formatQuantity(nota.totalCollie || 0)}</div></div>
                            <div className="detail-item"><div className="detail-label">Dasar Invoice Final</div><div className="detail-value">{totalBilledWeightLabel}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Berat Final Sistem (Kg)</div><div className="detail-value">{formatQuantity(nota.totalWeightKg || 0)} kg</div></div>
                            <div className="detail-item"><div className="detail-label">Invoice Bruto</div><div className="detail-value font-semibold">{formatCurrency(grossAmount)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Invoice Transfer Final</div><div className="detail-value font-semibold">{formatCurrency(netAmount)}</div></div>
                            <div className="detail-item"><div className="detail-label">Status Invoice</div><div className="detail-value">{statusConf.label}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">PPh 23</div><div className="detail-value">{effectivePph23Enabled ? `${buildPph23Label({ enabled: effectivePph23Enabled, ratePercent: effectivePph23RatePercent, baseMode: effectivePph23BaseMode })} • -${formatCurrency(pph23Amount)}` : 'Tidak dipotong'}</div></div>
                            <div className="detail-item"><div className="detail-label">{creditAmount > 0 ? 'Kelebihan Bayar' : 'Sisa Invoice Transfer'}</div><div className="detail-value font-semibold">{formatCurrency(creditAmount > 0 ? creditAmount : remaining)}</div></div>
                        </div>
                    </div>
                </div>

                {/* Right: payment */}
                <div>
                    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                        <div className="card" style={{ overflow: 'hidden' }}>
                            <div style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)', color: '#fff', padding: '1.25rem' }}>
                                <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Invoice Transfer Final</div>
                                <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(netAmount)}</div>
                                {(totalAdjustmentAmount > 0 || pph23Amount > 0) && (
                                    <div style={{ fontSize: '0.78rem', opacity: 0.85, marginTop: '0.25rem' }}>
                                        Bruto {formatCurrency(grossAmount)} | Klaim {formatCurrency(totalAdjustmentAmount)} | PPh 23 {formatCurrency(pph23Amount)}
                                    </div>
                                )}
                            </div>
                            <div className="card-body">
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                    <div><div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Invoice Bruto</div><div style={{ fontSize: '1rem', fontWeight: 700 }}>{formatCurrency(grossAmount)}</div></div>
                                    <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Potongan</div><div style={{ fontSize: '1rem', fontWeight: 700, color: totalAdjustmentAmount > 0 ? 'var(--color-warning)' : 'var(--color-gray-600)' }}>-{formatCurrency(totalAdjustmentAmount)}</div></div>
                                    <div><div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>PPh 23</div><div style={{ fontSize: '1rem', fontWeight: 700, color: effectivePph23Enabled ? 'var(--color-warning)' : 'var(--color-gray-600)' }}>{effectivePph23Enabled ? `-${formatCurrency(pph23Amount)}` : '-'}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{effectivePph23Enabled ? `${formatCurrency(pph23BaseAmount)} • ${buildPph23Label({ enabled: effectivePph23Enabled, ratePercent: effectivePph23RatePercent, baseMode: effectivePph23BaseMode })}` : 'Tidak dipotong'}</div></div>
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sudah Dibayar</div>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-success)' }}>{formatCurrency(totalPaid)}</div>
                                        {refundedOverpaymentAmount > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Masuk awal {formatCurrency(totalPaidRaw)} • Refund {formatCurrency(refundedOverpaymentAmount)}</div>}
                                    </div>
                                    <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>{creditAmount > 0 ? 'Kelebihan Bayar' : 'Sisa'}</div><div style={{ fontSize: '1.1rem', fontWeight: 700, color: creditAmount > 0 ? 'var(--color-primary)' : remaining > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{formatCurrency(creditAmount > 0 ? creditAmount : remaining)}</div></div>
                                </div>
                                <div className="progress-bar" style={{ marginBottom: '0.5rem' }}>
                                    <div className={`progress-bar-fill ${paidPercent >= 100 ? 'success' : ''}`} style={{ width: `${paidPercent}%` }} />
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-gray-400)', marginBottom: '1rem' }}>{paidPercent.toFixed(0)}% terbayar</div>
                                {canManageInvoice && !isVoidedInvoice && displayStatus !== 'PAID' && <button className="btn btn-success" style={{ width: '100%' }} onClick={openCreatePaymentModal}><DollarSign size={16} /> Catat Pembayaran</button>}
                            </div>
                        </div>

                        <CollapsibleCard title="Riwayat Pembayaran Invoice" defaultOpen={payments.length > 0}>
                            <div style={{ padding: payments.length === 0 ? '2rem 1.5rem' : 0 }}>
                                {payments.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: 'var(--color-gray-400)' }}>
                                        <div
                                            style={{
                                                fontSize: '1.5rem',
                                                opacity: 0.3,
                                                marginBottom: '0.25rem',
                                                display: 'flex',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            <DollarSign size={22} />
                                        </div>
                                        <div style={{ fontSize: '0.82rem' }}>Belum ada pembayaran</div>
                                    </div>
                                ) : payments.map((p, i) => (
                                    (() => {
                                        const accountLabel = resolvePaymentAccountLabel(p, accountMap);
                                        return (
                                    <div key={p._id} style={{ padding: '0.75rem 1rem', borderBottom: i < payments.length - 1 ? '1px solid var(--color-gray-100)' : 'none' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{formatDate(p.date)}</div>
                                            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-success)' }}>+{formatCurrency(p.amount)}</div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--color-gray-400)', flexWrap: 'wrap' }}>
                                            <span className={`badge badge-${p.method === 'CASH' ? 'warning' : 'info'}`} style={{ fontSize: '0.62rem' }}>{PAYMENT_METHOD_MAP[p.method] || p.method}</span>
                                            {p.receiptNumber && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>Penerimaan {p.receiptNumber}</span>}
                                            {accountLabel && (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    <Landmark size={10} />
                                                    {p.bankAccountRef && canOpenBankAccounts ? (
                                                        <Link href={`/bank-accounts/${p.bankAccountRef}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                                                            {accountLabel}
                                                        </Link>
                                                    ) : (
                                                        accountLabel
                                                    )}
                                                </span>
                                            )}
                                            {p.note && <span>| {p.note}</span>}
                                        </div>
                                        {(canPrintInvoice || (canManageInvoice && !isVoidedInvoice && !p.receiptRef)) && (
                                            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {canManageInvoice && !isVoidedInvoice && !p.receiptRef && (
                                                    <button className="table-action-btn" onClick={() => openEditPaymentModal(p)} disabled={paying}>
                                                        <Pencil size={13} /> Koreksi
                                                    </button>
                                                )}
                                                {canPrintInvoice && <button className="table-action-btn" onClick={() => void handlePrintPaymentReceipt(p)}>
                                                    <Printer size={13} /> Kwitansi
                                                </button>}
                                            </div>
                                        )}
                                    </div>
                                        );
                                    })()
                                ))}
                            </div>
                        </CollapsibleCard>

                        <CollapsibleCard title="Riwayat Klaim / Potongan" defaultOpen={adjustments.length > 0}>
                            <div style={{ padding: adjustments.length === 0 ? '2rem 1.5rem' : 0 }}>
                                {adjustments.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: 'var(--color-gray-400)' }}>
                                        <div style={{ fontSize: '0.82rem' }}>Belum ada potongan invoice</div>
                                    </div>
                                ) : adjustments.map((adjustment, index) => (
                                    <div key={adjustment._id} style={{ padding: '0.85rem 1rem', borderBottom: index < adjustments.length - 1 ? '1px solid var(--color-gray-100)' : 'none' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{formatDate(adjustment.date)}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <span className={`badge badge-${adjustment.status === 'VOID' ? 'secondary' : 'warning'}`}><span className="badge-dot" /> {adjustment.status === 'VOID' ? 'Dihapus' : 'Disetujui'}</span>
                                                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-warning)' }}>-{formatCurrency(adjustment.amount)}</span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--color-gray-400)' }}>
                                            <span>{INVOICE_ADJUSTMENT_KIND_MAP[adjustment.kind] || adjustment.kind}</span>
                                            {adjustment.note && <span>| {adjustment.note}</span>}
                                            {adjustment.editedAt && <span>| Diedit {formatDate(adjustment.editedAt)}</span>}
                                        </div>
                                        {adjustment.status !== 'VOID' && (
                                            <div style={{ marginTop: '0.5rem' }}>
                                                {canManageInvoice && (
                                                    <>
                                                        <button className="table-action-btn" onClick={() => openEditAdjustmentModal(adjustment)} disabled={Boolean(voidingAdjustmentId)}>Edit</button>
                                                        <button className="table-action-btn" onClick={() => void handleDeleteAdjustment(adjustment._id)} disabled={voidingAdjustmentId === adjustment._id}>{voidingAdjustmentId === adjustment._id ? 'Memproses...' : 'Batalkan'}</button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </CollapsibleCard>
                    </div>
                </div>

                <div className="detail-full">
                    <CollapsibleCard title="Rincian Perjalanan">
                        <div
                            style={{
                                margin: '0 0 1rem',
                                padding: '0.85rem 1rem',
                                borderRadius: '0.75rem',
                                border: '1px solid var(--color-gray-200)',
                                background: 'var(--color-gray-50)',
                            }}
                        >
                            <div className="font-medium" style={{ marginBottom: '0.2rem' }}>
                                {items.length} baris invoice dari {uniqueShipperReferenceCount || 0} SJ pengirim
                            </div>
                            <div className="text-muted text-sm">
                                Invoice hanya memuat baris drop yang billable. Barang dengan hasil hold, transit, atau retur tidak ikut ditagihkan di sini.
                            </div>
                        </div>
                        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                            <table style={{ minWidth: 1180 }}>
                                <thead>
                                    <tr>
                                        <th>NO.TRUCK</th>
                                        <th>TGL</th>
                                        <th>NO.SJ</th>
                                        <th>DARI</th>
                                        <th>TUJUAN</th>
                                        <th>BARANG</th>
                                        <th>COLLIE</th>
                                        <th>{getFreightNotaWeightColumnLabel(billingMode)}</th>
                                        <th>{getFreightNotaRateColumnLabel(billingMode)}</th>
                                        <th style={{ textAlign: 'right' }}>UANG RP</th>
                                        <th>PLT</th>
                                        <th>PC</th>
                                        <th>KBL</th>
                                        <th>TGL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map(it => (
                                        <tr key={it._id}>
                                            <td className="font-mono">{it.vehiclePlate || '-'}</td>
                                            <td className="text-muted">{formatDate(it.date)}</td>
                                            <td>{it.noSJ || '-'}</td>
                                            <td>{it.dari}</td>
                                            <td>{it.tujuan}</td>
                                            <td>{it.barang || '-'}</td>
                                    <td>{it.collie ? formatQuantity(it.collie) : '-'}</td>
                                            <td>{formatFreightNotaDisplayWeight({ beratKg: it.beratKg || 0, volumeM3: it.volumeM3 || 0, billingMode, includeCanonical: false })}</td>
                                            <td>
                                                <div>{formatCurrency(it.tarip || 0)}</div>
                                                <span
                                                    className={`badge badge-${it.taripSource === 'MASTER' ? 'success' : 'warning'}`}
                                                    title={it.customerBillingRateName || undefined}
                                                    style={{ marginTop: '0.25rem' }}
                                                >
                                                    {it.taripSource === 'MASTER' ? 'Master' : 'Manual'}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(it.uangRp)}</td>
                                            <td className="text-muted">{it.plt || '-'}</td>
                                            <td className="text-muted">{it.pc || '-'}</td>
                                            <td className="text-muted">{it.kbl || '-'}</td>
                                            <td className="text-muted">{it.invoiceLineDate ? formatDate(it.invoiceLineDate) : '-'}</td>
                                        </tr>
                                    ))}
                                    <tr style={{ background: 'var(--color-bg-secondary)', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                                        <td colSpan={6} style={{ textAlign: 'right' }}>Jumlah</td>
                            <td>{formatQuantity(nota.totalCollie || 0)}</td>
                                        <td>{totalBilledWeightLabel}</td>
                                        <td></td>
                                        <td style={{ textAlign: 'right', color: 'var(--color-danger)' }}>{formatCurrency(nota.totalAmount)}</td>
                                        <td colSpan={4}></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </CollapsibleCard>
                </div>
            </div>
            {/* Pay Modal */}
            {canManageInvoice && showPayModal && (
                <div className="modal-overlay" onClick={closePaymentModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editingPaymentId ? 'Koreksi Penerimaan Invoice' : 'Catat Pembayaran Invoice'}</h3><button className="modal-close" onClick={closePaymentModal} disabled={paying}>&times;</button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>{editingPaymentId ? 'Maksimum Koreksi' : 'Sisa Invoice'}</div><div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(maxPaymentAmount)}</div></div>
                                <button className="btn btn-sm btn-ghost" onClick={() => setPayAmount(maxPaymentAmount)} style={{ fontSize: '0.72rem' }} disabled={paying}>Bayar penuh</button>
                            </div>
                            <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={payDate} onChange={e => setPayDate(e.target.value)} disabled={paying} /></div>
                            <div className="form-group"><label className="form-label">Nominal (Rp)</label><FormattedNumberInput allowDecimal={false} value={payAmount} onValueChange={value => setPayAmount(value)} disabled={paying} placeholder="Ketik nominal pembayaran invoice" /></div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Metode</label>
                                    <select
                                        className="form-select"
                                        value={payMethod}
                                        onChange={e => {
                                            const nextMethod = e.target.value;
                                            setPayMethod(nextMethod);
                                            if (nextMethod === 'CASH') {
                                                setPayBankRef('');
                                            }
                                        }}
                                        disabled={paying}
                                    >
                                        <option value="TRANSFER">Transfer</option><option value="CASH">Tunai</option><option value="OTHER">Lainnya</option>
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Rekening</label>
                                    <select className="form-select" value={payBankRef} onChange={e => setPayBankRef(e.target.value)} disabled={paying || payMethod === 'CASH'}>
                                        <option value="">{payMethod === 'CASH' ? '-- Otomatis ke Kas Tunai --' : '-- Pilih --'}</option>
                                        {paymentAccountOptions.map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber}{a.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                {payMethod === 'TRANSFER'
                                    ? 'Transfer akan mengurangi sisa invoice, mencatat pendapatan, dan menambah saldo rekening yang dipilih.'
                                    : payMethod === 'CASH'
                                        ? 'Tunai selalu diposting ke akun Kas Tunai. Jika uangnya nanti disetor ke bank, catat transfer kas ke rekening secara terpisah.'
                                        : 'Metode lain tetap mengurangi sisa invoice dan mencatat pendapatan. Mutasi bank hanya dibuat jika rekening dipilih.'}
                            </div>
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={payNote} onChange={e => setPayNote(e.target.value)} disabled={paying} /></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closePaymentModal} disabled={paying}>Batal</button>
                            <button className="btn btn-success" onClick={handleSavePayment} disabled={paying}><DollarSign size={16} /> {paying ? 'Memproses...' : editingPaymentId ? 'Simpan Koreksi Penerimaan' : 'Simpan Pembayaran Invoice'}</button>
                        </div>
                    </div>
                </div>
            )}
            {canManageInvoice && showAdjustmentModal && (
                <div className="modal-overlay" onClick={() => { if (!adjusting) setShowAdjustmentModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editingAdjustmentId ? 'Edit Klaim / Potongan' : 'Catat Klaim / Potongan'}</h3><button className="modal-close" onClick={() => setShowAdjustmentModal(false)} disabled={adjusting}>&times;</button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                                <div><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Invoice Awal</div><div style={{ fontSize: '1rem', fontWeight: 700 }}>{formatCurrency(grossAmount)}</div></div>
                                <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sisa Nilai Bisa Dipotong</div><div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-warning)' }}>{formatCurrency(Math.max(grossAmount - totalAdjustmentAmount, 0))}</div></div>
                            </div>
                            <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={adjustDate} onChange={e => setAdjustDate(e.target.value)} disabled={adjusting} /></div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Jenis</label>
                                    <select className="form-select" value={adjustKind} onChange={e => setAdjustKind(e.target.value)} disabled={adjusting}>
                                        {Object.entries(INVOICE_ADJUSTMENT_KIND_MAP).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Nominal (Rp)</label><FormattedNumberInput allowDecimal={false} value={adjustAmount} onValueChange={value => setAdjustAmount(value)} disabled={adjusting} placeholder="Ketik nominal potongan" /></div>
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                Klaim / potongan akan mengurangi invoice final. Ini bukan pembayaran masuk dan tidak membuat mutasi kas/bank.
                            </div>
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={adjustNote} onChange={e => setAdjustNote(e.target.value)} disabled={adjusting} placeholder="Contoh: Klaim 2 dus pecah saat bongkar" /></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAdjustmentModal(false)} disabled={adjusting}>Batal</button>
                            <button className="btn btn-warning" onClick={handleSaveAdjustment} disabled={adjusting}>{adjusting ? 'Menyimpan...' : editingAdjustmentId ? 'Simpan Perubahan' : 'Simpan Klaim / Potongan'}</button>
                        </div>
                    </div>
                </div>
            )}
            {canManageInvoice && showPph23Modal && (
                <div className="modal-overlay" onClick={() => { if (!savingPph23) setShowPph23Modal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Atur PPh 23 Invoice</h3><button className="modal-close" onClick={() => setShowPph23Modal(false)} disabled={savingPph23}>&times;</button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                                <div><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Invoice Bruto</div><div style={{ fontSize: '1rem', fontWeight: 700 }}>{formatCurrency(grossAmount)}</div></div>
                                <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Klaim / Potongan</div><div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-warning)' }}>-{formatCurrency(totalAdjustmentAmount)}</div></div>
                                <div><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>PPh 23 Preview</div><div style={{ fontSize: '1rem', fontWeight: 700, color: draftPph23Summary.enabled ? 'var(--color-warning)' : 'var(--color-gray-600)' }}>{draftPph23Summary.enabled ? `-${formatCurrency(draftPph23Summary.amount)}` : '-'}</div></div>
                                <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Invoice Transfer Final</div><div style={{ fontSize: '1rem', fontWeight: 700 }}>{formatCurrency(draftPph23Summary.netAmount)}</div></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">PPh 23</label>
                                    <select
                                        className="form-select"
                                        value={pph23Enabled ? 'YA' : 'TIDAK'}
                                        onChange={e => {
                                            const nextEnabled = e.target.value === 'YA';
                                            setPph23Enabled(nextEnabled);
                                            if (nextEnabled && pph23RatePercent <= 0) {
                                                setPph23RatePercent(DEFAULT_PPH23_RATE_PERCENT);
                                            }
                                        }}
                                        disabled={savingPph23}
                                    >
                                        <option value="TIDAK">Tidak dipotong</option>
                                        <option value="YA">Potong PPh 23</option>
                                    </select>
                                </div>
                                <div className="form-group" style={{ maxWidth: 180 }}>
                                    <label className="form-label">Tarif PPh 23 (%)</label>
                                    <FormattedNumberInput
                                        maxFractionDigits={2}
                                        value={pph23RatePercent}
                                        onValueChange={value => setPph23RatePercent(value)}
                                        disabled={savingPph23}
                                    />
                                </div>
                            </div>
                            <div className="form-group" style={{ maxWidth: 300 }}>
                                <label className="form-label">Basis Hitung PPh 23</label>
                                <select
                                    className="form-select"
                                    value={pph23BaseMode}
                                    onChange={e => setPph23BaseMode(e.target.value as 'BEFORE_CLAIM' | 'AFTER_CLAIM')}
                                    disabled={savingPph23}
                                >
                                    {PPH23_BASE_MODE_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)' }}>
                                {buildPph23Label({ enabled: pph23Enabled, ratePercent: pph23RatePercent, baseMode: pph23BaseMode })}. Setelah invoice punya pembayaran, pengaturan ini otomatis terkunci agar piutang tidak berubah di tengah jalan.
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPph23Modal(false)} disabled={savingPph23}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSavePph23} disabled={savingPph23}>{savingPph23 ? 'Menyimpan...' : 'Simpan PPh 23'}</button>
                        </div>
                    </div>
                </div>
            )}
            {canManageInvoice && showTaxInvoiceModal && (
                <div className="modal-overlay" onClick={() => { if (!savingTaxInvoice) setShowTaxInvoiceModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">No Faktur Pajak</h3>
                            <button className="modal-close" onClick={() => setShowTaxInvoiceModal(false)} disabled={savingTaxInvoice}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">No Faktur Pajak</label>
                                <input
                                    className="form-input"
                                    value={taxInvoiceNumberDraft}
                                    onChange={e => setTaxInvoiceNumberDraft(e.target.value)}
                                    disabled={savingTaxInvoice}
                                    placeholder="Ketik no faktur pajak..."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTaxInvoiceModal(false)} disabled={savingTaxInvoice}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSaveTaxInvoiceNumber} disabled={savingTaxInvoice}>
                                {savingTaxInvoice ? 'Menyimpan...' : 'Simpan No Faktur Pajak'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {canManageOverpaymentRefund && showRefundModal && (
                <div className="modal-overlay" onClick={() => { if (!refunding) setShowRefundModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Konfirmasi Transfer Balik Kelebihan Bayar</h3><button className="modal-close" onClick={() => setShowRefundModal(false)} disabled={refunding}>&times;</button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.85rem 1rem', marginBottom: '1rem', display: 'grid', gap: '0.35rem' }}>
                                <div><strong>{displayNotaNumber}</strong></div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{nota.customerName}</div>
                                <div style={{ fontSize: '0.8rem' }}>Kelebihan bayar terbuka: <strong>{formatCurrency(creditAmount)}</strong></div>
                                {refundedOverpaymentAmount > 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sudah pernah ditransfer balik: {formatCurrency(refundedOverpaymentAmount)}</div>}
                            </div>
                            <div className="form-group"><label className="form-label">Tanggal Transfer Balik</label><input type="date" className="form-input" value={refundDate} onChange={e => setRefundDate(e.target.value)} disabled={refunding} /></div>
                            <div className="form-group"><label className="form-label">Nominal Refund (Rp)</label><FormattedNumberInput allowDecimal={false} value={refundAmount} onValueChange={value => setRefundAmount(value)} disabled={refunding} placeholder="Ketik nominal refund" /></div>
                            <div className="form-group">
                                <label className="form-label">Rekening / Kas Sumber</label>
                                <select className="form-select" value={refundBankRef} onChange={e => setRefundBankRef(e.target.value)} disabled={refunding}>
                                    <option value="">-- Pilih rekening atau kas --</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={refundNote} onChange={e => setRefundNote(e.target.value)} disabled={refunding} placeholder="Contoh: Refund ke rekening customer sesuai konfirmasi finance" /></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRefundModal(false)} disabled={refunding}>Batal</button>
                            <button className="btn btn-warning" onClick={handleConfirmOverpaymentRefund} disabled={refunding}>{refunding ? 'Memproses...' : 'Konfirmasi Transfer Balik'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
