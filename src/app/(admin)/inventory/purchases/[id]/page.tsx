'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileDown, Printer, Save, Wallet, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
  computePurchaseSummary,
  formatInventoryQuantity,
  getDerivedPurchasePaymentStatus,
  getDerivedPurchaseReceiptStatus,
  getPurchasePaymentBadgeClass,
  getPurchaseReceiptBadgeClass,
  isTireTrackedWarehouseItem,
  isCancelledPurchase,
  PURCHASE_PAYMENT_STATUS_LABELS,
  PURCHASE_RECEIPT_STATUS_LABELS,
  STOCK_MOVEMENT_SOURCE_LABELS,
  WAREHOUSE_ITEM_TRACKING_MODE_LABELS,
} from '@/lib/inventory';
import { hasPageAccess, hasPermission, normalizeUserRole } from '@/lib/rbac';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow } from '@/lib/print';
import type { BankAccount, Purchase, PurchaseItem, PurchasePayment, StockMovement, Supplier, TireEvent } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../../../layout';

type ReceiveLineState = { purchaseItemRef: string; itemName: string; remainingQty: number; receivedQty: number; note: string; unit: string };
type PaymentFormState = { date: string; bankAccountRef: string; amount: number; note: string };

const PRICE_SOURCE_LABELS: Record<NonNullable<PurchaseItem['priceSource']>, string> = {
  SUPPLIER_PRICE: 'Dari harga supplier',
  WAREHOUSE_DEFAULT: 'Dari harga default barang',
  MANUAL: 'Diisi manual',
};

function PurchaseLifecycleBadges({ purchase }: { purchase: Purchase }) {
  const receiptStatus = getDerivedPurchaseReceiptStatus(purchase);
  const paymentStatus = getDerivedPurchasePaymentStatus(purchase);

  return (
    <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'start' }}>
      <span className={`badge ${getPurchaseReceiptBadgeClass(receiptStatus)}`}>
        Terima: {PURCHASE_RECEIPT_STATUS_LABELS[receiptStatus]}
      </span>
      <span className={`badge ${getPurchasePaymentBadgeClass(paymentStatus)}`}>
        Bayar: {PURCHASE_PAYMENT_STATUS_LABELS[paymentStatus]}
      </span>
    </div>
  );
}

function getDateOnly(value: string | undefined | null) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : '';
}

function getMaxDate(...values: Array<string | undefined | null>) {
  return values.map(getDateOnly).filter(Boolean).sort().at(-1) || getBusinessDateValue();
}

function getPurchaseItemPriceSourceLabel(item: PurchaseItem) {
  if (item.priceOverridden) return 'Diisi manual';
  return item.priceSource ? PRICE_SOURCE_LABELS[item.priceSource] || item.priceSource : 'Harga saat itu';
}

function buildReceiveState(items: PurchaseItem[]): ReceiveLineState[] {
  return items
    .map((item) => {
      const remainingQty = Math.max(Number(item.orderedQty || 0) - Number(item.receivedQty || 0), 0);
      return { purchaseItemRef: item._id, itemName: item.itemName || item.itemCode || item._id, remainingQty, receivedQty: remainingQty > 0 ? remainingQty : 0, note: '', unit: item.itemUnit || '' };
    })
    .filter((item) => item.remainingQty > 0);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function PurchaseDetailPage() {
  const params = useParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const purchaseId = params.id as string;
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [linkedTires, setLinkedTires] = useState<TireEvent[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [receiveDate, setReceiveDate] = useState(getBusinessDateValue());
  const [receiveLines, setReceiveLines] = useState<ReceiveLineState[]>([]);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({ date: getBusinessDateValue(), bankAccountRef: '', amount: 0, note: '' });
  const [savingReceive, setSavingReceive] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [printing, setPrinting] = useState(false);
  const normalizedRole = user ? normalizeUserRole(user.role) : null;
  const canReceive = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL';
  const canPay = normalizedRole === 'OWNER' || normalizedRole === 'FINANCE';
  const canPrint = user ? hasPermission(user, 'purchases', 'print') : false;
  const canOpenBankAccounts = user ? hasPageAccess(user, 'bankAccounts') : false;
  const canOpenSuppliers = user ? hasPageAccess(user, 'suppliers') : false;
  const canOpenItems = user ? hasPageAccess(user, 'warehouseItems') : false;
  const canOpenTires = user ? hasPageAccess(user, 'tires') : false;

  const summary = useMemo(() => purchase ? computePurchaseSummary({ purchase, items, payments }) : null, [items, payments, purchase]);
  const receiptStatus = useMemo(() => (purchase ? getDerivedPurchaseReceiptStatus(purchase) : null), [purchase]);
  const paymentStatus = useMemo(() => (purchase ? getDerivedPurchasePaymentStatus(purchase) : null), [purchase]);
  const tiresByPurchaseItemRef = useMemo(() => linkedTires.reduce<Record<string, TireEvent[]>>((acc, tire) => {
    const key = tire.sourcePurchaseItemRef || '';
    if (!key) return acc;
    acc[key] = acc[key] || [];
    acc[key].push(tire);
    return acc;
  }, {}), [linkedTires]);

  const loadPurchaseDetail = useCallback(async () => {
    setLoading(true);
    try {
      const purchaseData = await fetchAdminData<Purchase | null>(`/api/data?entity=purchases&id=${purchaseId}`, 'Gagal memuat detail pembelian');
      if (!purchaseData) {
        setPurchase(null);
        return;
      }
      const [itemRows, paymentRows, movementRows, tireRows, accountRows, supplierRow] = await Promise.all([
        fetchAllAdminCollectionData<PurchaseItem>(`/api/data?entity=purchase-items&filter=${encodeURIComponent(JSON.stringify({ purchaseRef: purchaseId }))}`, 'Gagal memuat item pembelian'),
        fetchAllAdminCollectionData<PurchasePayment>(`/api/data?entity=purchase-payments&filter=${encodeURIComponent(JSON.stringify({ purchaseRef: purchaseId }))}`, 'Gagal memuat pembayaran supplier'),
        fetchAllAdminCollectionData<StockMovement>(`/api/data?entity=stock-movements&filter=${encodeURIComponent(JSON.stringify({ sourceRef: purchaseId }))}`, 'Gagal memuat mutasi stok'),
        canOpenTires
          ? fetchAllAdminCollectionData<TireEvent>(`/api/data?entity=tire-events&filter=${encodeURIComponent(JSON.stringify({ sourcePurchaseRef: purchaseId }))}`, 'Gagal memuat ban dari pembelian')
          : Promise.resolve([]),
        fetchAllAdminCollectionData<BankAccount>('/api/data?entity=bank-accounts&pageSize=200', 'Gagal memuat rekening'),
        purchaseData.supplierRef ? fetchAdminData<Supplier | null>(`/api/data?entity=suppliers&id=${purchaseData.supplierRef}`, 'Gagal memuat supplier').catch(() => null) : Promise.resolve(null),
      ]);
      setPurchase(purchaseData);
      setSupplier(supplierRow || null);
      setItems((itemRows || []).sort((a, b) => String(a.itemCode || '').localeCompare(String(b.itemCode || ''))));
      setPayments((paymentRows || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));
      setStockMovements((movementRows || []).sort((a, b) => String(b.movementDate || '').localeCompare(String(a.movementDate || ''))));
      setLinkedTires((tireRows || []).sort((a, b) => String(a.tireCode || '').localeCompare(String(b.tireCode || ''))));
      const activeAccounts = (accountRows || []).filter((account) => account.active !== false);
      setBankAccounts(activeAccounts);
      setPaymentForm((current) => ({ ...current, bankAccountRef: current.bankAccountRef || activeAccounts[0]?._id || '' }));
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail pembelian');
    } finally {
      setLoading(false);
    }
  }, [addToast, canOpenTires, purchaseId]);

  useEffect(() => { void loadPurchaseDetail(); }, [loadPurchaseDetail]);

  const openReceiveModal = () => {
    if (!canReceive) return;
    setReceiveDate(getBusinessDateValue());
    setReceiveLines(buildReceiveState(items));
    setShowReceiveModal(true);
  };

  const openPaymentModal = () => {
    if (!canPay || !summary) return;
    const minimumPaymentDate = getMaxDate(purchase?.orderDate, purchase?.lastPaidAt);
    setPaymentForm({
      date: getMaxDate(minimumPaymentDate, getBusinessDateValue()),
      bankAccountRef: bankAccounts[0]?._id || '',
      amount: Number(summary.outstandingAmount || 0),
      note: '',
    });
    setShowPaymentModal(true);
  };

  const handleReceiveSave = async () => {
    if (!purchase) return;
    const validLines = receiveLines.filter((line) => Number(line.receivedQty || 0) > 0);
    if (validLines.length === 0) return addToast('error', 'Isi minimal satu qty terima lebih besar dari 0');
    setSavingReceive(true);
    try {
      const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'purchases', action: 'receive', data: { purchaseRef: purchase._id, receiveDate, items: validLines.map((line) => ({ purchaseItemRef: line.purchaseItemRef, receivedQty: line.receivedQty, note: line.note || undefined })) } }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menerima barang');
      addToast('success', 'Penerimaan barang berhasil dicatat');
      setShowReceiveModal(false);
      await loadPurchaseDetail();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menerima barang');
    } finally {
      setSavingReceive(false);
    }
  };

  const handlePaymentSave = async () => {
    if (!purchase) return;
    if (!paymentForm.bankAccountRef) return addToast('error', 'Pilih rekening pembayaran supplier');
    if (!paymentForm.amount || paymentForm.amount <= 0) return addToast('error', 'Nominal pembayaran supplier wajib diisi');
    setSavingPayment(true);
    try {
      const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'purchase-payments', action: 'record-payment', data: { purchaseRef: purchase._id, bankAccountRef: paymentForm.bankAccountRef, date: paymentForm.date, amount: paymentForm.amount, note: paymentForm.note || undefined } }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal mencatat pembayaran supplier');
      addToast('success', 'Pembayaran supplier berhasil dicatat');
      setShowPaymentModal(false);
      await loadPurchaseDetail();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal mencatat pembayaran supplier');
    } finally {
      setSavingPayment(false);
    }
  };

  const handlePrint = async () => {
    if (!purchase || !summary) return;
    setPrinting(true);
    const w = openPrintWindow('Menyiapkan cetak pembelian...');
    if (!w) {
      addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba print lagi.');
      setPrinting(false);
      return;
    }
    try {
      const company = await fetchCompanyProfile().catch(() => null);
      const itemRows = items.map((item) => `<tr><td>${escapeHtml(item.itemCode || '-')}</td><td>${escapeHtml(item.itemName || '-')}</td><td class="c">${escapeHtml(item.itemUnit || '-')}</td><td class="r">${escapeHtml(formatInventoryQuantity(item.orderedQty || 0))}</td><td class="r">${escapeHtml(formatInventoryQuantity(item.receivedQty || 0))}</td><td class="r">${escapeHtml(formatCurrency(Number(item.unitPrice || 0)))}</td><td class="r">${escapeHtml(formatCurrency(Number(item.subtotal || 0)))}</td></tr>`).join('');
      const paymentRows = payments.length === 0 ? '<tr><td colspan="4" class="c">Belum ada pembayaran supplier</td></tr>' : payments.map((payment) => `<tr><td>${escapeHtml(formatDate(payment.date))}</td><td>${escapeHtml(payment.bankAccountName || '-')}</td><td class="r">${escapeHtml(formatCurrency(Number(payment.amount || 0)))}</td><td>${escapeHtml(payment.note || '-')}</td></tr>`).join('');
      const printReceiptStatus = PURCHASE_RECEIPT_STATUS_LABELS[getDerivedPurchaseReceiptStatus(purchase)];
      const printPaymentStatus = PURCHASE_PAYMENT_STATUS_LABELS[getDerivedPurchasePaymentStatus(purchase)];
      openBrandedPrint({
        title: 'Pembelian Supplier',
        subtitle: purchase.purchaseNumber,
        company,
        targetWindow: w,
        bodyHtml: `
          <div class="stats-row">
            <div class="stat-box"><div class="stat-label">Supplier</div><div class="stat-value">${escapeHtml(purchase.supplierName || '-')}</div></div>
            <div class="stat-box"><div class="stat-label">Tanggal</div><div class="stat-value">${escapeHtml(formatDate(purchase.orderDate))}</div></div>
            <div class="stat-box"><div class="stat-label">Penerimaan</div><div class="stat-value">${escapeHtml(printReceiptStatus)}</div></div>
            <div class="stat-box"><div class="stat-label">Pembayaran</div><div class="stat-value">${escapeHtml(printPaymentStatus)}</div></div>
          </div>
          <table><tbody>
            <tr><td>Jatuh Tempo</td><td>${escapeHtml(purchase.dueDate ? formatDate(purchase.dueDate) : '-')}</td><td>Total</td><td class="r">${escapeHtml(formatCurrency(Number(summary.totalAmount || 0)))}</td></tr>
            <tr><td>Sisa Tagihan</td><td>${escapeHtml(formatCurrency(Number(summary.outstandingAmount || 0)))}</td><td>Dibayar</td><td class="r">${escapeHtml(formatCurrency(Number(summary.paidAmount || 0)))}</td></tr>
          </tbody></table>
          <h3 style="margin-top:1.5rem">Item Pembelian</h3>
          <table><thead><tr><th>Kode</th><th>Barang</th><th class="c">Satuan</th><th class="r">Jumlah Pesan</th><th class="r">Jumlah Terima</th><th class="r">Harga</th><th class="r">Subtotal</th></tr></thead><tbody>${itemRows}</tbody></table>
          <h3 style="margin-top:1.5rem">Pembayaran Supplier</h3>
          <table><thead><tr><th>Tanggal</th><th>Rekening</th><th class="r">Nominal</th><th>Catatan</th></tr></thead><tbody>${paymentRows}</tbody></table>
        `,
        extraStyles: '.stats-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.stat-box{border:1px solid #e2e8f0;border-radius:12px;padding:12px}.stat-label{font-size:.75rem;color:#64748b;margin-bottom:4px}.stat-value{font-size:1rem;font-weight:700}',
      });
    } finally {
      setPrinting(false);
    }
  };

  if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 120 }} /><div className="skeleton skeleton-card" style={{ height: 320 }} /></div>;
  if (!purchase || !summary) return <div className="card"><div className="card-body">Pembelian tidak ditemukan</div></div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left"><PageBackButton href="/inventory/purchases" /><h1 className="page-title">Detail Pembelian</h1></div>
        <div className="page-actions">
          {canPrint && <button className="btn btn-secondary" onClick={() => void handlePrint()} disabled={printing}><Printer size={18} /> {printing ? 'Menyiapkan...' : 'Print'}</button>}
          {canPay && !isCancelledPurchase(purchase) && Number(summary.outstandingAmount || 0) > 0 && <button className="btn btn-secondary" onClick={openPaymentModal}><Wallet size={18} /> Bayar Supplier</button>}
          {canReceive && !isCancelledPurchase(purchase) && buildReceiveState(items).length > 0 && <button className="btn btn-primary" onClick={openReceiveModal}><FileDown size={18} /> Terima Barang</button>}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Pembelian</div><div className="kpi-value">{formatCurrency(Number(summary.totalAmount || 0))}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Sisa Tagihan</div><div className="kpi-value">{formatCurrency(Number(summary.outstandingAmount || 0))}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Jumlah Diterima</div><div className="kpi-value">{formatInventoryQuantity(summary.totalReceivedQty)}</div></div></div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Status</div>
            <div className="kpi-value" style={{ fontSize: '1rem' }}>
              <div className="text-muted" style={{ marginBottom: '0.35rem' }}>Penerimaan: {receiptStatus ? PURCHASE_RECEIPT_STATUS_LABELS[receiptStatus] : '-'}</div>
              <div className="text-muted">Pembayaran: {paymentStatus ? PURCHASE_PAYMENT_STATUS_LABELS[paymentStatus] : '-'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-header-title">{purchase.purchaseNumber}</span></div>
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-row"><span className="detail-label">Supplier</span><span className="detail-value">{canOpenSuppliers && supplier ? <Link href={`/suppliers/${supplier._id}`} style={{ color: 'var(--color-primary)' }}>{purchase.supplierName || '-'}</Link> : (purchase.supplierName || '-')}</span></div>
            <div className="detail-row"><span className="detail-label">Tanggal Pembelian</span><span className="detail-value">{formatDate(purchase.orderDate)}</span></div>
            <div className="detail-row"><span className="detail-label">Jatuh Tempo</span><span className="detail-value">{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Total Dibayar</span><span className="detail-value">{formatCurrency(Number(summary.paidAmount || 0))}</span></div>
            <div className="detail-row"><span className="detail-label">Terima Terakhir</span><span className="detail-value">{purchase.lastReceivedAt ? formatDate(purchase.lastReceivedAt) : '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Bayar Terakhir</span><span className="detail-value">{purchase.lastPaidAt ? formatDate(purchase.lastPaidAt) : '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Status Operasional</span><span className="detail-value"><PurchaseLifecycleBadges purchase={purchase} /></span></div>
            <div className="detail-row"><span className="detail-label">Catatan</span><span className="detail-value">{purchase.notes || '-'}</span></div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-header-title">Item Pembelian</span></div>
        <div className="card-body">
          <div className="table-wrapper table-desktop-only">
            <table>
              <thead><tr><th>Kode</th><th>Barang</th><th>Satuan</th><th>Jumlah Pesan</th><th>Jumlah Terima</th><th>Belum Diterima</th><th>Harga</th><th>Harga Dari</th><th>Subtotal</th></tr></thead>
              <tbody>
                {items.map((item) => {
                  const remainingQty = Math.max(Number(item.orderedQty || 0) - Number(item.receivedQty || 0), 0);
                  const registeredTires = tiresByPurchaseItemRef[item._id] || [];
                  return (
                    <tr key={item._id}>
                      <td className="font-mono">{canOpenItems ? <Link href={`/inventory/items/${item.warehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>{item.itemCode || '-'}</Link> : (item.itemCode || '-')}</td>
                      <td>
                        <div className="font-medium">{item.itemName || '-'}</div>
                        {isTireTrackedWarehouseItem(item) && (
                          <div className="text-muted text-xs" style={{ marginTop: '0.25rem' }}>
                            {WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']} | Ban terdaftar {registeredTires.length}/{Math.round(Number(item.receivedQty || 0))}
                          </div>
                        )}
                      </td>
                      <td>{item.itemUnit || '-'}</td>
                      <td>{formatInventoryQuantity(item.orderedQty)}</td>
                      <td>{formatInventoryQuantity(item.receivedQty || 0)}</td>
                      <td>{formatInventoryQuantity(remainingQty)}</td>
                      <td>{formatCurrency(Number(item.unitPrice || 0))}</td>
                      <td>{getPurchaseItemPriceSourceLabel(item)}</td>
                      <td>{formatCurrency(Number(item.subtotal || 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mobile-record-list">
            {items.map((item) => {
              const remainingQty = Math.max(Number(item.orderedQty || 0) - Number(item.receivedQty || 0), 0);
              const registeredTires = tiresByPurchaseItemRef[item._id] || [];
              return (
                <div key={item._id} className="mobile-record-card">
                  <div className="mobile-record-header"><div><div className="mobile-record-title">{item.itemName || '-'}</div><div className="mobile-record-subtitle">{item.itemCode || '-'} | {item.itemUnit || '-'}{isTireTrackedWarehouseItem(item) ? ` | ${WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']}` : ''}</div></div></div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Jumlah Pesan</span><span className="mobile-record-value">{formatInventoryQuantity(item.orderedQty)}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Jumlah Terima</span><span className="mobile-record-value">{formatInventoryQuantity(item.receivedQty || 0)}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Belum Diterima</span><span className="mobile-record-value">{formatInventoryQuantity(remainingQty)}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Harga</span><span className="mobile-record-value">{formatCurrency(Number(item.unitPrice || 0))}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Harga Dari</span><span className="mobile-record-value">{getPurchaseItemPriceSourceLabel(item)}</span></div>
                    <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Subtotal</span><span className="mobile-record-value">{formatCurrency(Number(item.subtotal || 0))}</span></div>
                    {isTireTrackedWarehouseItem(item) && (
                      <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Ban Terdaftar</span><span className="mobile-record-value">{registeredTires.length}/{Math.round(Number(item.receivedQty || 0))}</span></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {linkedTires.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><span className="card-header-title">Ban Terdaftar dari Pembelian Ini</span></div>
          <div className="card-body">
            <div className="table-wrapper table-desktop-only">
              <table>
                <thead><tr><th>Kode Ban</th><th>Barang Gudang</th><th>Lokasi Saat Ini</th><th>Tanggal Terima</th><th>Sumber</th></tr></thead>
                <tbody>
                  {linkedTires.map((tire) => (
                    <tr key={tire._id}>
                      <td>{canOpenTires ? <Link href={`/fleet/tires?q=${encodeURIComponent(tire.tireCode || '')}`} style={{ color: 'var(--color-primary)' }}>{tire.tireCode || '-'}</Link> : (tire.tireCode || '-')}</td>
                      <td>{canOpenItems && tire.linkedWarehouseItemRef ? <Link href={`/inventory/items/${tire.linkedWarehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>{tire.linkedWarehouseItemCode || tire.linkedWarehouseItemName || '-'}</Link> : (tire.linkedWarehouseItemCode || tire.linkedWarehouseItemName || '-')}</td>
                      <td>{tire.posisi || '-'}</td>
                      <td>{formatDate(tire.sourceReceiveDate || tire.installDate)}</td>
                      <td>{tire.sourcePurchaseNumber || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {linkedTires.map((tire) => (
                <div key={tire._id} className="mobile-record-card">
                  <div className="mobile-record-header">
                    <div>
                      <div className="mobile-record-title">{tire.tireCode || '-'}</div>
                      <div className="mobile-record-subtitle">{tire.linkedWarehouseItemCode || tire.linkedWarehouseItemName || '-'}</div>
                    </div>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Lokasi</span><span className="mobile-record-value">{tire.posisi || '-'}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Tgl Terima</span><span className="mobile-record-value">{formatDate(tire.sourceReceiveDate || tire.installDate)}</span></div>
                    <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Sumber</span><span className="mobile-record-value">{tire.sourcePurchaseNumber || '-'}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-header-title">Penerimaan Barang</span></div>
        <div className="card-body">
          {stockMovements.length === 0 ? <div className="text-muted">Belum ada penerimaan barang untuk pembelian ini.</div> : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Tanggal</th><th>Barang</th><th>Sumber</th><th>Jumlah</th><th>Harga Saat Itu</th><th>Nilai</th><th>Saldo Setelah</th><th>Catatan</th></tr></thead>
                <tbody>
                  {stockMovements.map((movement) => (
                    <tr key={movement._id}>
                      <td>{formatDate(movement.movementDate)}</td>
                      <td>{movement.itemCode || '-'} - {movement.itemName || '-'}</td>
                      <td>{STOCK_MOVEMENT_SOURCE_LABELS[movement.sourceType] || movement.sourceType}</td>
                      <td>{formatInventoryQuantity(movement.quantity)} {movement.unit || ''}</td>
                      <td>{Number(movement.unitCostSnapshot || 0) > 0 ? formatCurrency(Number(movement.unitCostSnapshot || 0)) : '-'}</td>
                      <td>{Number(movement.subtotalCost || 0) > 0 ? formatCurrency(Number(movement.subtotalCost || 0)) : '-'}</td>
                      <td>{formatInventoryQuantity(movement.balanceAfter || 0)} {movement.unit || ''}</td>
                      <td>{movement.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-header-title">Pembayaran Supplier</span></div>
        <div className="card-body">
          {payments.length === 0 ? <div className="text-muted">Belum ada pembayaran supplier untuk pembelian ini.</div> : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Tanggal</th><th>Rekening</th><th>Nominal</th><th>Catatan</th></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment._id}>
                      <td>{formatDate(payment.date)}</td>
                      <td>{canOpenBankAccounts && payment.bankAccountRef ? <Link href={`/bank-accounts/${payment.bankAccountRef}`} style={{ color: 'var(--color-primary)' }}>{payment.bankAccountName || '-'}</Link> : (payment.bankAccountName || '-')}</td>
                      <td>{formatCurrency(Number(payment.amount || 0))}</td>
                      <td>{payment.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showReceiveModal && (
        <div className="modal-overlay" onClick={() => !savingReceive && setShowReceiveModal(false)}>
          <div className="modal modal-lg" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Terima Barang</h3>
              <button className="modal-close" onClick={() => setShowReceiveModal(false)} disabled={savingReceive}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Tanggal Penerimaan</label><input type="date" className="form-input" value={receiveDate} onChange={(event) => setReceiveDate(event.target.value)} /></div>
              <div style={{ display: 'grid', gap: '0.85rem' }}>
                {receiveLines.map((line) => (
                  <div key={line.purchaseItemRef} className="form-section">
                      <div className="font-semibold" style={{ marginBottom: '0.75rem' }}>{line.itemName}</div>
                      <div className="text-muted text-xs" style={{ marginBottom: '0.75rem' }}>Sisa pesanan {formatInventoryQuantity(line.remainingQty)} {line.unit}</div>
                      {isTireTrackedWarehouseItem(items.find((item) => item._id === line.purchaseItemRef)) && (
                        <div className="info-banner" style={{ marginBottom: '0.75rem' }}>
                          <div className="info-banner-title">Registrasi Ban Otomatis</div>
                          <div className="info-banner-text">Jumlah yang diterima akan otomatis membuat kartu ban per unit di gudang ban.</div>
                        </div>
                      )}
                      <div className="form-row">
                        <div className="form-group"><label className="form-label">Jumlah Terima</label><FormattedNumberInput min={0} maxFractionDigits={3} value={line.receivedQty} onValueChange={(value) => setReceiveLines((current) => current.map((row) => row.purchaseItemRef === line.purchaseItemRef ? { ...row, receivedQty: value } : row))} /></div>
                        <div className="form-group"><label className="form-label">Catatan</label><input className="form-input" value={line.note} onChange={(event) => setReceiveLines((current) => current.map((row) => row.purchaseItemRef === line.purchaseItemRef ? { ...row, note: event.target.value } : row))} /></div>
                      </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowReceiveModal(false)} disabled={savingReceive}>Batal</button><button className="btn btn-primary" onClick={handleReceiveSave} disabled={savingReceive}><Save size={16} /> {savingReceive ? 'Menyimpan...' : 'Simpan Penerimaan'}</button></div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="modal-overlay" onClick={() => !savingPayment && setShowPaymentModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Bayar Supplier</h3>
              <button className="modal-close" onClick={() => setShowPaymentModal(false)} disabled={savingPayment}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label className="form-label">Tanggal Bayar</label><input type="date" className="form-input" min={getMaxDate(purchase.orderDate, purchase.lastPaidAt)} value={paymentForm.date} onChange={(event) => setPaymentForm((current) => ({ ...current, date: event.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Rekening / Kas</label><select className="form-select" value={paymentForm.bankAccountRef} onChange={(event) => setPaymentForm((current) => ({ ...current, bankAccountRef: event.target.value }))}><option value="">Pilih rekening</option>{bankAccounts.map((account) => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}</option>)}</select></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Nominal Bayar (Rp)</label><FormattedNumberInput allowDecimal={false} value={paymentForm.amount} onValueChange={(value) => setPaymentForm((current) => ({ ...current, amount: value }))} placeholder="Ketik nominal pembayaran" /></div>
                <div className="form-group"><label className="form-label">Sisa Tagihan Saat Ini</label><input className="form-input" value={formatCurrency(Number(summary.outstandingAmount || 0))} readOnly /></div>
              </div>
              <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={paymentForm.note} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} /></div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowPaymentModal(false)} disabled={savingPayment}>Batal</button><button className="btn btn-primary" onClick={handlePaymentSave} disabled={savingPayment}><Save size={16} /> {savingPayment ? 'Menyimpan...' : 'Simpan Pembayaran'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
