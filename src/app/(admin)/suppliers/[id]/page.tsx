'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CreditCard, Edit, Package, Plus, Receipt, Save, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { getBusinessDateValue } from '@/lib/business-date';
import {
  getDerivedPurchasePaymentStatus,
  getDerivedPurchaseReceiptStatus,
  getPurchasePaymentBadgeClass,
  getPurchaseReceiptBadgeClass,
  PURCHASE_PAYMENT_STATUS_LABELS,
  PURCHASE_RECEIPT_STATUS_LABELS,
} from '@/lib/inventory';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import {
  buildSupplierOwnerSummaryMap,
  buildSupplierRelatedItems,
  type SupplierRelatedItem,
} from '@/lib/supplier-purchase-support';
import type { Purchase, PurchaseItem, PurchasePayment, Supplier, SupplierItemPrice, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate, formatQuantity, formatSupplierTerm } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

type SupplierDetailTab = 'detail' | 'purchases' | 'payments' | 'items';

type SupplierFormState = {
  supplierCode: string;
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  defaultTermDays: number;
  notes: string;
  active: boolean;
};

type SupplierItemPriceFormState = {
  warehouseItemRef: string;
  supplierSku: string;
  supplierItemName: string;
  defaultPurchasePrice: number;
  minOrderQty: number;
  leadTimeDays: number;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
  active: boolean;
};

const createDefaultForm = (supplier?: Partial<Supplier>): SupplierFormState => ({
  supplierCode: supplier?.supplierCode || '',
  name: supplier?.name || '',
  contactPerson: supplier?.contactPerson || '',
  phone: supplier?.phone || '',
  address: supplier?.address || '',
  defaultTermDays: typeof supplier?.defaultTermDays === 'number' ? supplier.defaultTermDays : 14,
  notes: supplier?.notes || '',
  active: supplier?.active !== false,
});

const createDefaultSupplierItemPriceForm = (price?: Partial<SupplierItemPrice>): SupplierItemPriceFormState => ({
  warehouseItemRef: price?.warehouseItemRef || '',
  supplierSku: price?.supplierSku || '',
  supplierItemName: price?.supplierItemName || '',
  defaultPurchasePrice: typeof price?.defaultPurchasePrice === 'number' ? price.defaultPurchasePrice : 0,
  minOrderQty: typeof price?.minOrderQty === 'number' ? price.minOrderQty : 0,
  leadTimeDays: typeof price?.leadTimeDays === 'number' ? price.leadTimeDays : 0,
  effectiveFrom: typeof price?.effectiveFrom === 'string' ? price.effectiveFrom.slice(0, 10) : getBusinessDateValue(),
  effectiveTo: typeof price?.effectiveTo === 'string' ? price.effectiveTo.slice(0, 10) : '',
  notes: price?.notes || '',
  active: price?.active !== false,
});

type SupplierPriceUseStatus = 'available' | 'future' | 'expired' | 'inactive';

const SUPPLIER_PRICE_STATUS_LABELS: Record<SupplierPriceUseStatus, string> = {
  available: 'Bisa dipakai',
  future: 'Belum mulai',
  expired: 'Sudah lewat',
  inactive: 'Tidak dipakai',
};

const SUPPLIER_PRICE_STATUS_BADGES: Record<SupplierPriceUseStatus, string> = {
  available: 'badge-success',
  future: 'badge-info',
  expired: 'badge-warning',
  inactive: 'badge-gray',
};

function getDateOnly(value: string | undefined | null) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : '';
}

function getSupplierPriceUseStatus(price: SupplierItemPrice, referenceDate: string): SupplierPriceUseStatus {
  if (price.active === false) return 'inactive';
  const effectiveFrom = getDateOnly(price.effectiveFrom);
  const effectiveTo = getDateOnly(price.effectiveTo);
  if (effectiveFrom && effectiveFrom > referenceDate) return 'future';
  if (effectiveTo && effectiveTo < referenceDate) return 'expired';
  return 'available';
}

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

export default function SupplierDetailPage() {
  const params = useParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const supplierId = params.id as string;
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [items, setItems] = useState<SupplierRelatedItem[]>([]);
  const [supplierItemPrices, setSupplierItemPrices] = useState<SupplierItemPrice[]>([]);
  const [allWarehouseItems, setAllWarehouseItems] = useState<WarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
  const [activeTab, setActiveTab] = useState<SupplierDetailTab>('detail');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [editingPrice, setEditingPrice] = useState<SupplierItemPrice | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [form, setForm] = useState<SupplierFormState>(createDefaultForm());
  const [priceForm, setPriceForm] = useState<SupplierItemPriceFormState>(createDefaultSupplierItemPriceForm());
  const canManage = user ? hasPermission(user, 'suppliers', 'create') || hasPermission(user, 'suppliers', 'update') : false;
  const canCreateSupplierPrice = user ? hasPermission(user, 'suppliers', 'create') : false;
  const canUpdateSupplierPrice = user ? hasPermission(user, 'suppliers', 'update') : false;
  const canOpenPurchases = user ? hasPageAccess(user, 'purchases') : false;
  const canOpenItems = user ? hasPageAccess(user, 'warehouseItems') : false;
  const canOpenBankAccounts = user ? hasPageAccess(user, 'bankAccounts') : false;
  const today = getBusinessDateValue();

  const loadSupplierDetail = useCallback(async () => {
    setLoading(true);
    setLoadNotice(null);
    try {
      const supplierData = await fetchAdminData<Supplier | null>(`/api/data?entity=suppliers&id=${supplierId}`, 'Gagal memuat supplier');
      if (!supplierData) {
        setSupplier(null);
        return;
      }

      const [purchaseRows, paymentRows, defaultItemRows, supplierPriceRows, allWarehouseItemRows] = await Promise.all([
        fetchAllAdminCollectionData<Purchase>(`/api/data?entity=purchases&filter=${encodeURIComponent(JSON.stringify({ supplierRef: supplierId }))}&sortField=orderDate&sortDir=desc`, 'Gagal memuat pembelian supplier'),
        fetchAllAdminCollectionData<PurchasePayment>(`/api/data?entity=purchase-payments&filter=${encodeURIComponent(JSON.stringify({ supplierRef: supplierId }))}&sortField=date&sortDir=desc`, 'Gagal memuat pembayaran supplier'),
        fetchAllAdminCollectionData<WarehouseItem>(`/api/data?entity=warehouse-items&filter=${encodeURIComponent(JSON.stringify({ defaultSupplierRef: supplierId }))}&sortField=itemCode&sortDir=asc`, 'Gagal memuat barang gudang supplier'),
        fetchAllAdminCollectionData<SupplierItemPrice>(`/api/data?entity=supplier-item-prices&filter=${encodeURIComponent(JSON.stringify({ supplierRef: supplierId }))}&sortField=itemCode&sortDir=asc`, 'Gagal memuat harga barang supplier'),
        canOpenItems
          ? fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&pageSize=1000&sortField=itemCode&sortDir=asc', 'Gagal memuat master barang gudang', 1000)
          : Promise.resolve([] as WarehouseItem[]),
      ]);
      const purchaseIds = (purchaseRows || []).map((purchase) => purchase._id).filter(Boolean);
      const purchaseItemRows = purchaseIds.length > 0
        ? await fetchAllAdminCollectionData<PurchaseItem>(
          `/api/data?entity=purchase-items&filter=${encodeURIComponent(JSON.stringify({ purchaseRef: purchaseIds }))}&sortField=itemCode&sortDir=asc`,
          'Gagal memuat item pembelian supplier'
        )
        : [];
      const purchasedItemRefs = Array.from(new Set((purchaseItemRows || []).map((item) => item.warehouseItemRef).filter(Boolean)));
      const purchasedWarehouseItems = purchasedItemRefs.length > 0
        ? await fetchAllAdminCollectionData<WarehouseItem>(
          `/api/data?entity=warehouse-items&filter=${encodeURIComponent(JSON.stringify({ _id: purchasedItemRefs }))}&sortField=itemCode&sortDir=asc`,
          'Gagal memuat master barang pembelian supplier'
        )
        : [];
      const warehouseItems = Array.from(
        new Map(
          [...(defaultItemRows || []), ...(purchasedWarehouseItems || [])].map((item) => [item._id, item] as const),
        ).values(),
      );
      const relatedItems = buildSupplierRelatedItems(supplierId, purchaseRows || [], purchaseItemRows || [], warehouseItems);

      setSupplier(supplierData);
      setForm(createDefaultForm(supplierData));
      setPurchases((purchaseRows || []).sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || ''))));
      setPayments((paymentRows || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));
      setItems(relatedItems);
      setSupplierItemPrices((supplierPriceRows || []).sort((a, b) => {
        const itemCompare = `${a.itemCode || ''}-${a.itemName || ''}`.localeCompare(`${b.itemCode || ''}-${b.itemName || ''}`);
        if (itemCompare !== 0) return itemCompare;
        if ((a.active !== false) !== (b.active !== false)) return a.active !== false ? -1 : 1;
        return String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || ''));
      }));
      setAllWarehouseItems((allWarehouseItemRows || []).sort((a, b) => String(a.itemCode || '').localeCompare(String(b.itemCode || ''))));
    } catch (error) {
      const message = getAdminErrorMessage(error, 'Gagal memuat detail supplier');
      setLoadNotice(buildAdminLoadNotice(
        message,
        'Supplier',
        'Halaman ini hanya bisa dilihat oleh role yang punya akses Supplier.'
      ));
      addToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [addToast, canOpenItems, supplierId]);

  useEffect(() => { void loadSupplierDetail(); }, [loadSupplierDetail]);

  const supplierSummary = useMemo(
    () => buildSupplierOwnerSummaryMap(purchases, today)[supplierId] || {
      purchaseCount: 0,
      totalAmount: 0,
      outstandingAmount: 0,
      paidAmount: 0,
      overdueCount: 0,
      lastPurchaseDate: '',
    },
    [purchases, supplierId, today],
  );

  const outstandingTotal = supplierSummary.outstandingAmount;
  const totalPurchaseAmount = supplierSummary.totalAmount;
  const paidTotal = useMemo(
    () => payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [payments]
  );
  const overdueCount = supplierSummary.overdueCount;
  const purchasedItemCount = useMemo(
    () => items.filter((item) => item.relationType !== 'DEFAULT').length,
    [items],
  );
  const defaultOnlyItemCount = useMemo(
    () => items.filter((item) => item.relationType === 'DEFAULT').length,
    [items],
  );
  const activeWarehouseItems = useMemo(
    () => allWarehouseItems.filter((item) => item.active !== false),
    [allWarehouseItems],
  );
  const supplierPriceByItemRef = useMemo(() => {
    const map = new Map<string, SupplierItemPrice>();
    supplierItemPrices
      .filter((price) => getSupplierPriceUseStatus(price, today) === 'available')
      .forEach((price) => {
        if (!price.warehouseItemRef) return;
        const current = map.get(price.warehouseItemRef);
        const currentEffectiveFrom = typeof current?.effectiveFrom === 'string' ? current.effectiveFrom.slice(0, 10) : '';
        const nextEffectiveFrom = typeof price.effectiveFrom === 'string' ? price.effectiveFrom.slice(0, 10) : '';
        if (!current || nextEffectiveFrom >= currentEffectiveFrom) {
          map.set(price.warehouseItemRef, price);
        }
      });
    return map;
  }, [supplierItemPrices, today]);

  const openEditModal = () => {
    if (!supplier || !canManage) return;
    setForm(createDefaultForm(supplier));
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    if (saving) return;
    setShowEditModal(false);
    setForm(createDefaultForm(supplier || undefined));
  };

  const openCreatePriceModal = () => {
    if (!supplier || !canCreateSupplierPrice || !canOpenItems) return;
    setEditingPrice(null);
    setPriceForm(createDefaultSupplierItemPriceForm());
    setShowPriceModal(true);
  };

  const openEditPriceModal = (price: SupplierItemPrice) => {
    if (!supplier || !canUpdateSupplierPrice || !canOpenItems) return;
    setEditingPrice(price);
    setPriceForm(createDefaultSupplierItemPriceForm(price));
    setShowPriceModal(true);
  };

  const closePriceModal = () => {
    if (savingPrice) return;
    setShowPriceModal(false);
    setEditingPrice(null);
    setPriceForm(createDefaultSupplierItemPriceForm());
  };

  const formatEffectiveRange = (price: SupplierItemPrice) => {
    const from = typeof price.effectiveFrom === 'string' && price.effectiveFrom ? formatDate(price.effectiveFrom.slice(0, 10)) : '-';
    const to = typeof price.effectiveTo === 'string' && price.effectiveTo ? formatDate(price.effectiveTo.slice(0, 10)) : 'Seterusnya';
    return `${from} - ${to}`;
  };

  const handleSave = async () => {
    if (!supplier || !canManage) {
      addToast('error', 'Anda tidak punya hak mengubah supplier');
      return;
    }
    if (!form.supplierCode || !form.name) {
      addToast('error', 'Kode dan nama supplier wajib diisi');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        supplierCode: form.supplierCode,
        name: form.name,
        contactPerson: form.contactPerson,
        phone: form.phone,
        address: form.address,
        defaultTermDays: form.defaultTermDays,
        notes: form.notes,
        active: form.active,
      };
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'suppliers',
          action: 'update',
          data: {
            id: supplier._id,
            updates: payload,
          },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan supplier');
      addToast('success', 'Supplier diperbarui');
      setShowEditModal(false);
      await loadSupplierDetail();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan supplier');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePrice = async () => {
    if (!supplier) return;
    const canSave = editingPrice ? canUpdateSupplierPrice : canCreateSupplierPrice;
    if (!canSave || !canOpenItems) {
      addToast('error', 'Anda tidak punya hak mengubah harga barang supplier');
      return;
    }
    if (!priceForm.warehouseItemRef) {
      addToast('error', 'Barang gudang wajib dipilih');
      return;
    }
    if (Number(priceForm.defaultPurchasePrice || 0) <= 0) {
      addToast('error', 'Harga dari supplier wajib lebih dari 0');
      return;
    }
    if (priceForm.effectiveFrom && priceForm.effectiveTo && priceForm.effectiveTo < priceForm.effectiveFrom) {
      addToast('error', 'Tanggal akhir efektif tidak boleh sebelum tanggal mulai');
      return;
    }

    setSavingPrice(true);
    try {
      const payload = {
        supplierRef: supplier._id,
        warehouseItemRef: priceForm.warehouseItemRef,
        supplierSku: priceForm.supplierSku || undefined,
        supplierItemName: priceForm.supplierItemName || undefined,
        defaultPurchasePrice: priceForm.defaultPurchasePrice,
        minOrderQty: Number(priceForm.minOrderQty || 0) > 0 ? priceForm.minOrderQty : undefined,
        leadTimeDays: Number(priceForm.leadTimeDays || 0) > 0 ? priceForm.leadTimeDays : undefined,
        effectiveFrom: priceForm.effectiveFrom || undefined,
        effectiveTo: priceForm.effectiveTo || undefined,
        notes: priceForm.notes || undefined,
        active: priceForm.active,
      };
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'supplier-item-prices',
          action: editingPrice ? 'revise-price' : 'create',
          data: editingPrice
            ? { id: editingPrice._id, updates: payload }
            : payload,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan harga barang supplier');
      addToast('success', editingPrice ? 'Harga barang supplier diperbarui' : 'Harga barang supplier ditambahkan');
      closePriceModal();
      await loadSupplierDetail();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan harga barang supplier');
    } finally {
      setSavingPrice(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 120 }} />
        <div className="skeleton skeleton-card" style={{ height: 260 }} />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="empty-state-title">{loadNotice?.title || 'Supplier tidak ditemukan'}</div>
          {loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <PageBackButton href="/suppliers" />
          <h1 className="page-title">Detail Supplier</h1>
        </div>
      </div>

      <div className="segmented-tabs" aria-label="Menu supplier" style={{ marginBottom: '1.5rem' }}>
        <button type="button" className={`segmented-tab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>
          Detail
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'purchases' ? 'active' : ''}`} onClick={() => setActiveTab('purchases')}>
          Pembelian Supplier
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>
          Pembayaran Supplier
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'items' ? 'active' : ''}`} onClick={() => setActiveTab('items')}>
          Barang Gudang Terkait
        </button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Sisa Tagihan</div>
            <div className="kpi-value">{formatCurrency(outstandingTotal)}</div>
            <div className="kpi-sub">{overdueCount} pembelian jatuh tempo</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Dokumen Pembelian</div>
            <div className="kpi-value">{supplierSummary.purchaseCount}</div>
            <div className="kpi-sub">{formatCurrency(totalPurchaseAmount)} total pembelian</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Pembelian Terakhir</div>
            <div className="kpi-value">{supplierSummary.lastPurchaseDate ? formatDate(supplierSummary.lastPurchaseDate) : '-'}</div>
            <div className="kpi-sub">{formatCurrency(supplierSummary.paidAmount)} sudah dibayar</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Barang Terkait</div>
            <div className="kpi-value">{items.length}</div>
            <div className="kpi-sub">{purchasedItemCount} pernah dibeli, {defaultOnlyItemCount} hanya default</div>
          </div>
        </div>
      </div>

      {activeTab === 'detail' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <span className="card-header-title">{supplier.supplierCode} - {supplier.name}</span>
          {canManage && (
            <button type="button" className="btn btn-secondary" onClick={openEditModal}>
              <Edit size={16} /> Edit
            </button>
          )}
        </div>
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label">PIC</span>
              <span className="detail-value">{supplier.contactPerson || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Telepon</span>
              <span className="detail-value">{supplier.phone || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Termin Default</span>
              <span className="detail-value">{formatSupplierTerm(supplier.defaultTermDays)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className="detail-value">
                <span className={`badge ${supplier.active !== false ? 'badge-success' : 'badge-gray'}`}>
                  {supplier.active !== false ? 'Aktif' : 'Nonaktif'}
                </span>
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Alamat</span>
              <span className="detail-value">{supplier.address || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Catatan</span>
              <span className="detail-value">{supplier.notes || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Total Pembelian</span>
              <span className="detail-value">{formatCurrency(totalPurchaseAmount)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Total Dibayar</span>
              <span className="detail-value">{formatCurrency(paidTotal)}</span>
            </div>
          </div>
        </div>
      </div>
      )}

      {activeTab === 'purchases' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Pembelian Supplier</span>
        </div>
        <div className="card-body">
          {purchases.length === 0 ? (
            <div className="empty-state">
              <Receipt size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada pembelian supplier</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Nomor</th>
                      <th>Tanggal</th>
                      <th>Jatuh Tempo</th>
                      <th>Total</th>
                      <th>Sisa Tagihan</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((purchase) => (
                      <tr key={purchase._id}>
                        <td className="font-mono">
                          {canOpenPurchases ? (
                            <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>
                              {purchase.purchaseNumber}
                            </Link>
                          ) : purchase.purchaseNumber}
                        </td>
                        <td>{formatDate(purchase.orderDate)}</td>
                        <td>{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</td>
                        <td>{formatCurrency(Number(purchase.totalAmount || 0))}</td>
                        <td>{formatCurrency(Number(purchase.outstandingAmount || 0))}</td>
                        <td>
                          <PurchaseLifecycleBadges purchase={purchase} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {purchases.map((purchase) => (
                  <div key={purchase._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">
                          {canOpenPurchases ? (
                            <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>
                              {purchase.purchaseNumber}
                            </Link>
                          ) : purchase.purchaseNumber}
                        </div>
                        <div className="mobile-record-subtitle">{formatDate(purchase.orderDate)}</div>
                      </div>
                      <PurchaseLifecycleBadges purchase={purchase} />
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Jatuh Tempo</span>
                        <span className="mobile-record-value">{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Total</span>
                        <span className="mobile-record-value">{formatCurrency(Number(purchase.totalAmount || 0))}</span>
                      </div>
                      <div className="mobile-record-field mobile-record-field-full">
                        <span className="mobile-record-label">Sisa Tagihan</span>
                        <span className="mobile-record-value">{formatCurrency(Number(purchase.outstandingAmount || 0))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {activeTab === 'payments' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Pembayaran Supplier</span>
        </div>
        <div className="card-body">
          {payments.length === 0 ? (
            <div className="empty-state">
              <CreditCard size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada pembayaran supplier</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Pembelian</th>
                      <th>Rekening</th>
                      <th>Nominal</th>
                      <th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment._id}>
                        <td>{formatDate(payment.date)}</td>
                        <td className="font-mono">
                          {canOpenPurchases && payment.purchaseRef ? (
                            <Link href={`/inventory/purchases/${payment.purchaseRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.purchaseNumber || '-'}
                            </Link>
                          ) : (payment.purchaseNumber || '-')}
                        </td>
                        <td>
                          {canOpenBankAccounts && payment.bankAccountRef ? (
                            <Link href={`/bank-accounts/${payment.bankAccountRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.bankAccountName || '-'}
                            </Link>
                          ) : (payment.bankAccountName || '-')}
                        </td>
                        <td>{formatCurrency(Number(payment.amount || 0))}</td>
                        <td>{payment.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {payments.map((payment) => (
                  <div key={payment._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">{formatDate(payment.date)}</div>
                        <div className="mobile-record-subtitle">
                          {canOpenPurchases && payment.purchaseRef ? (
                            <Link href={`/inventory/purchases/${payment.purchaseRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.purchaseNumber || '-'}
                            </Link>
                          ) : (payment.purchaseNumber || '-')}
                        </div>
                      </div>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Rekening</span>
                        <span className="mobile-record-value">
                          {canOpenBankAccounts && payment.bankAccountRef ? (
                            <Link href={`/bank-accounts/${payment.bankAccountRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.bankAccountName || '-'}
                            </Link>
                          ) : (payment.bankAccountName || '-')}
                        </span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Nominal</span>
                        <span className="mobile-record-value">{formatCurrency(Number(payment.amount || 0))}</span>
                      </div>
                      <div className="mobile-record-field mobile-record-field-full">
                        <span className="mobile-record-label">Catatan</span>
                        <span className="mobile-record-value">{payment.note || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {activeTab === 'items' && (
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <span className="card-header-title">Daftar Harga dari Supplier</span>
            {canCreateSupplierPrice && canOpenItems && (
              <button type="button" className="btn btn-secondary" onClick={openCreatePriceModal}>
                <Plus size={16} /> Tambah Harga Barang
              </button>
            )}
          </div>
          <div className="card-body">
            {supplierItemPrices.length === 0 ? (
              <div className="empty-state">
                <Package size={40} className="empty-state-icon" />
                <div className="empty-state-title">Belum ada harga dari supplier</div>
              </div>
            ) : (
              <>
                <div className="table-wrapper table-desktop-only">
                  <table>
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Barang</th>
                        <th>Kode di Supplier</th>
                        <th>Harga</th>
                        <th>Minimal Beli</th>
                        <th>Estimasi Datang</th>
                        <th>Masa Berlaku</th>
                        <th>Status</th>
                        {canUpdateSupplierPrice && canOpenItems && <th>Aksi</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {supplierItemPrices.map((price) => {
                        const priceStatus = getSupplierPriceUseStatus(price, today);
                        return (
                        <tr key={price._id}>
                          <td className="font-mono">
                            {canOpenItems && price.warehouseItemRef ? (
                              <Link href={`/inventory/items/${price.warehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>
                                {price.itemCode || '-'}
                              </Link>
                            ) : (price.itemCode || '-')}
                          </td>
                          <td>{price.supplierItemName || price.itemName || '-'}</td>
                          <td>{price.supplierSku || '-'}</td>
                          <td>{formatCurrency(Number(price.defaultPurchasePrice || 0))}</td>
                          <td>{Number(price.minOrderQty || 0) > 0 ? `${formatQuantity(Number(price.minOrderQty || 0))} ${price.itemUnit || ''}` : '-'}</td>
                          <td>{Number(price.leadTimeDays || 0) > 0 ? `${price.leadTimeDays} hari` : '-'}</td>
                          <td>{formatEffectiveRange(price)}</td>
                          <td>
                            <span className={`badge ${SUPPLIER_PRICE_STATUS_BADGES[priceStatus]}`}>
                              {SUPPLIER_PRICE_STATUS_LABELS[priceStatus]}
                            </span>
                          </td>
                          {canUpdateSupplierPrice && canOpenItems && (
                            <td>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditPriceModal(price)}>
                                <Edit size={14} /> Edit
                              </button>
                            </td>
                          )}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-record-list">
                  {supplierItemPrices.map((price) => {
                    const priceStatus = getSupplierPriceUseStatus(price, today);
                    return (
                    <div key={price._id} className="mobile-record-card">
                      <div className="mobile-record-header">
                        <div>
                          <div className="mobile-record-title">{price.supplierItemName || price.itemName || '-'}</div>
                          <div className="mobile-record-subtitle">{price.itemCode || '-'}{price.supplierSku ? ` | ${price.supplierSku}` : ''}</div>
                        </div>
                        <span className={`badge ${SUPPLIER_PRICE_STATUS_BADGES[priceStatus]}`}>
                          {SUPPLIER_PRICE_STATUS_LABELS[priceStatus]}
                        </span>
                      </div>
                      <div className="mobile-record-grid">
                        <div className="mobile-record-field">
                          <span className="mobile-record-label">Harga</span>
                          <span className="mobile-record-value">{formatCurrency(Number(price.defaultPurchasePrice || 0))}</span>
                        </div>
                        <div className="mobile-record-field">
                          <span className="mobile-record-label">Minimal Beli</span>
                          <span className="mobile-record-value">{Number(price.minOrderQty || 0) > 0 ? `${formatQuantity(Number(price.minOrderQty || 0))} ${price.itemUnit || ''}` : '-'}</span>
                        </div>
                        <div className="mobile-record-field">
                          <span className="mobile-record-label">Estimasi Datang</span>
                          <span className="mobile-record-value">{Number(price.leadTimeDays || 0) > 0 ? `${price.leadTimeDays} hari` : '-'}</span>
                        </div>
                        <div className="mobile-record-field">
                          <span className="mobile-record-label">Masa Berlaku</span>
                          <span className="mobile-record-value">{formatEffectiveRange(price)}</span>
                        </div>
                        {canUpdateSupplierPrice && canOpenItems && (
                          <div className="mobile-record-field mobile-record-field-full">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditPriceModal(price)}>
                              <Edit size={14} /> Edit
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Barang Gudang Terkait</span>
          </div>
          <div className="card-body">
            {items.length === 0 ? (
              <div className="empty-state">
                <Package size={40} className="empty-state-icon" />
                <div className="empty-state-title">Belum ada barang default atau riwayat pembelian untuk supplier ini</div>
              </div>
            ) : (
              <>
                <div className="text-muted" style={{ marginBottom: '1rem', lineHeight: 1.6 }}>
                  Barang di bawah ini diambil dari master default dan riwayat pembelian supplier.
                </div>
                <div className="table-wrapper table-desktop-only">
                  <table>
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Barang</th>
                        <th>Relasi</th>
                        <th>Harga Supplier</th>
                        <th>Qty Diterima</th>
                        <th>Stok</th>
                        <th>Pembelian Terakhir</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const supplierPrice = supplierPriceByItemRef.get(item._id);
                        return (
                          <tr key={item._id}>
                            <td className="font-mono">
                              {canOpenItems ? (
                                <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                                  {item.itemCode}
                                </Link>
                              ) : item.itemCode}
                            </td>
                            <td>{item.name}</td>
                            <td>
                              <span className={`badge ${item.relationType === 'DEFAULT' ? 'badge-info' : item.relationType === 'PURCHASED' ? 'badge-warning' : 'badge-success'}`}>
                                {item.relationType === 'DEFAULT' ? 'Default' : item.relationType === 'PURCHASED' ? 'Dibeli' : 'Default + Dibeli'}
                              </span>
                            </td>
                            <td>{supplierPrice ? formatCurrency(Number(supplierPrice.defaultPurchasePrice || 0)) : '-'}</td>
                            <td>{formatQuantity(item.totalReceivedQty)} {item.unit}</td>
                            <td>{formatQuantity(item.currentStockQty)} {item.unit}</td>
                            <td>{item.lastPurchaseDate ? formatDate(item.lastPurchaseDate) : '-'}</td>
                            <td>
                              <span className={`badge ${item.active ? 'badge-success' : 'badge-gray'}`}>
                                {item.active ? 'Aktif' : 'Nonaktif'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-record-list">
                  {items.map((item) => {
                    const supplierPrice = supplierPriceByItemRef.get(item._id);
                    return (
                      <div key={item._id} className="mobile-record-card">
                        <div className="mobile-record-header">
                          <div>
                            <div className="mobile-record-title">
                              {canOpenItems ? (
                                <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                                  {item.name}
                                </Link>
                              ) : item.name}
                            </div>
                            <div className="mobile-record-subtitle">{item.itemCode}</div>
                          </div>
                          <span className={`badge ${item.active ? 'badge-success' : 'badge-gray'}`}>
                            {item.active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </div>
                        <div className="mobile-record-grid">
                          <div className="mobile-record-field">
                            <span className="mobile-record-label">Relasi</span>
                            <span className="mobile-record-value">
                              {item.relationType === 'DEFAULT' ? 'Default' : item.relationType === 'PURCHASED' ? 'Dibeli' : 'Default + Dibeli'}
                            </span>
                          </div>
                          <div className="mobile-record-field">
                            <span className="mobile-record-label">Harga dari Supplier</span>
                            <span className="mobile-record-value">{supplierPrice ? formatCurrency(Number(supplierPrice.defaultPurchasePrice || 0)) : '-'}</span>
                          </div>
                          <div className="mobile-record-field">
                            <span className="mobile-record-label">Qty Diterima</span>
                            <span className="mobile-record-value">{formatQuantity(item.totalReceivedQty)} {item.unit}</span>
                          </div>
                          <div className="mobile-record-field">
                            <span className="mobile-record-label">Stok</span>
                            <span className="mobile-record-value">{formatQuantity(item.currentStockQty)} {item.unit}</span>
                          </div>
                          <div className="mobile-record-field">
                            <span className="mobile-record-label">Pembelian Terakhir</span>
                            <span className="mobile-record-value">{item.lastPurchaseDate ? formatDate(item.lastPurchaseDate) : '-'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {showPriceModal && (
        <div className="modal-overlay" onClick={closePriceModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editingPrice ? 'Ubah Harga dari Supplier' : 'Tambah Harga dari Supplier'}</h3>
              <button className="modal-close" onClick={closePriceModal} disabled={savingPrice}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Barang Gudang</label>
                  <select
                    className="form-select"
                    value={priceForm.warehouseItemRef}
                    onChange={(event) => setPriceForm((current) => ({ ...current, warehouseItemRef: event.target.value }))}
                    disabled={Boolean(editingPrice) || savingPrice}
                  >
                    <option value="">Pilih barang</option>
                    {activeWarehouseItems.map((item) => (
                      <option key={item._id} value={item._id}>{item.itemCode} - {item.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Harga dari Supplier (Rp)</label>
                  <FormattedNumberInput allowDecimal={false} min={0} value={priceForm.defaultPurchasePrice} onValueChange={(value) => setPriceForm((current) => ({ ...current, defaultPurchasePrice: value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Kode Barang di Supplier</label>
                  <input className="form-input" value={priceForm.supplierSku} onChange={(event) => setPriceForm((current) => ({ ...current, supplierSku: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Barang di Supplier</label>
                  <input className="form-input" value={priceForm.supplierItemName} onChange={(event) => setPriceForm((current) => ({ ...current, supplierItemName: event.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Minimal Beli</label>
                  <FormattedNumberInput min={0} maxFractionDigits={3} value={priceForm.minOrderQty} onValueChange={(value) => setPriceForm((current) => ({ ...current, minOrderQty: value }))} />
                  <div className="text-muted text-xs" style={{ marginTop: 6 }}>Isi kalau supplier punya batas minimal pembelian.</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Estimasi Datang (hari)</label>
                  <FormattedNumberInput allowDecimal={false} min={0} value={priceForm.leadTimeDays} onValueChange={(value) => setPriceForm((current) => ({ ...current, leadTimeDays: value }))} />
                  <div className="text-muted text-xs" style={{ marginTop: 6 }}>Perkiraan berapa hari barang datang setelah dipesan.</div>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Harga Berlaku Mulai</label>
                  <input type="date" className="form-input" value={priceForm.effectiveFrom} onChange={(event) => setPriceForm((current) => ({ ...current, effectiveFrom: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Harga Berlaku Sampai</label>
                  <input type="date" className="form-input" value={priceForm.effectiveTo} onChange={(event) => setPriceForm((current) => ({ ...current, effectiveTo: event.target.value }))} />
                  <div className="text-muted text-xs" style={{ marginTop: 6 }}>Kosongkan kalau harga ini berlaku terus.</div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Catatan</label>
                <textarea className="form-textarea" rows={3} value={priceForm.notes} onChange={(event) => setPriceForm((current) => ({ ...current, notes: event.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Status Harga</label>
                <select className="form-select" value={priceForm.active ? 'active' : 'inactive'} onChange={(event) => setPriceForm((current) => ({ ...current, active: event.target.value === 'active' }))}>
                  <option value="active">Bisa dipakai</option>
                  <option value="inactive">Jangan dipakai</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closePriceModal} disabled={savingPrice}>Batal</button>
              <button className="btn btn-primary" onClick={() => void handleSavePrice()} disabled={savingPrice}>
                <Save size={16} /> {savingPrice ? 'Menyimpan...' : editingPrice ? 'Simpan Harga Baru' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Supplier</h3>
              <button className="modal-close" onClick={closeEditModal} disabled={saving}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Kode Supplier</label>
                  <input className="form-input" value={form.supplierCode} onChange={(event) => setForm((current) => ({ ...current, supplierCode: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Supplier</label>
                  <input className="form-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">PIC</label>
                  <input className="form-input" value={form.contactPerson} onChange={(event) => setForm((current) => ({ ...current, contactPerson: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Telepon</label>
                  <input className="form-input" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Termin Default (hari)</label>
                  <FormattedNumberInput allowDecimal={false} min={0} value={form.defaultTermDays} onValueChange={(value) => setForm((current) => ({ ...current, defaultTermDays: value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.active ? 'active' : 'inactive'} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === 'active' }))}>
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Alamat</label>
                <textarea className="form-textarea" rows={3} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Catatan</label>
                <textarea className="form-textarea" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeEditModal} disabled={saving}>Batal</button>
              <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
