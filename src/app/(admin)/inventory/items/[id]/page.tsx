'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Edit, History, Receipt, Save, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import {
  formatInventoryQuantity,
  INVENTORY_UNIT_OPTIONS,
  isTireTrackedWarehouseItem,
  getDerivedPurchasePaymentStatus,
  getDerivedPurchaseReceiptStatus,
  getPurchasePaymentBadgeClass,
  getPurchaseReceiptBadgeClass,
  isCancelledPurchase,
  PURCHASE_PAYMENT_STATUS_LABELS,
  PURCHASE_RECEIPT_STATUS_LABELS,
  STOCK_MOVEMENT_SOURCE_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  WAREHOUSE_ITEM_TRACKING_MODE_LABELS,
  WAREHOUSE_ITEM_TRACKING_MODE_OPTIONS,
} from '@/lib/inventory';
import { getMaintenanceMaterialUsageRows, summarizeItemUsageRows } from '@/lib/inventory-material-usage';
import { isWarehouseStockMaintenanceMaterialUsage } from '@/lib/maintenance';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { normalizeTireType, TIRE_TYPE_OPTIONS } from '@/lib/tire-types';
import type { Maintenance, Purchase, PurchaseItem, StockMovement, Supplier, TireEvent, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate, TIRE_ASSET_STATUS_MAP } from '@/lib/utils';

import { useApp, useToast } from '../../../layout';

function getStockBadge(item: WarehouseItem) {
  const stock = Number(item.currentStockQty || 0);
  const min = Number(item.minStockQty || 0);
  if (item.active === false) return { label: 'Nonaktif', className: 'badge-gray' };
  if (stock <= 0) return { label: 'Habis', className: 'badge-danger' };
  if (min > 0 && stock <= min) return { label: 'Menipis', className: 'badge-warning' };
  return { label: 'Aman', className: 'badge-success' };
}

function renderTireStatus(tire: TireEvent) {
  const statusMeta = TIRE_ASSET_STATUS_MAP[tire.status];
  return (
    <span className={`badge badge-${statusMeta?.color || 'gray'}`}>
      {statusMeta?.label || tire.status || '-'}
    </span>
  );
}

function PurchaseLifecycleBadges({ purchase }: { purchase?: Purchase }) {
  if (!purchase) {
    return <span className="text-muted">-</span>;
  }

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

type MaintenanceUsageRow = {
  maintenanceId: string;
  completedDate?: string;
  type?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  quantity: number;
  subtotalCost: number;
  note?: string;
};

type DetailTab = 'detail' | 'purchases' | 'movements';

type ItemFormState = {
  itemCode: string;
  name: string;
  category: string;
  unit: WarehouseItem['unit'];
  trackingMode: NonNullable<WarehouseItem['trackingMode']>;
  minStockQty: number;
  defaultSupplierRef: string;
  defaultPurchasePrice: number;
  tireTypeDefault: string;
  tireBrandDefault: string;
  tireSizeDefault: string;
  notes: string;
  active: boolean;
};

const createItemForm = (item?: Partial<WarehouseItem>): ItemFormState => ({
  itemCode: item?.itemCode || '',
  name: item?.name || '',
  category: item?.category || '',
  unit: item?.unit || 'PCS',
  trackingMode: item?.trackingMode || 'STANDARD',
  minStockQty: typeof item?.minStockQty === 'number' ? item.minStockQty : 0,
  defaultSupplierRef: item?.defaultSupplierRef || '',
  defaultPurchasePrice: typeof item?.defaultPurchasePrice === 'number' ? item.defaultPurchasePrice : 0,
  tireTypeDefault: normalizeTireType(item?.tireTypeDefault),
  tireBrandDefault: item?.tireBrandDefault || '',
  tireSizeDefault: item?.tireSizeDefault || '',
  notes: item?.notes || '',
  active: item?.active !== false,
});

export default function WarehouseItemDetailPage() {
  const params = useParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const itemId = params.id as string;

  const [item, setItem] = useState<WarehouseItem | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [purchasesById, setPurchasesById] = useState<Record<string, Purchase>>({});
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [maintenancesById, setMaintenancesById] = useState<Record<string, Maintenance>>({});
  const [linkedTires, setLinkedTires] = useState<TireEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('detail');
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ItemFormState>(createItemForm());

  const canOpenSuppliers = user ? hasPageAccess(user, 'suppliers') : false;
  const canOpenPurchases = user ? hasPageAccess(user, 'purchases') : false;
  const canOpenVehicles = user ? hasPageAccess(user, 'vehicles') : false;
  const canOpenMaintenance = user ? hasPageAccess(user, 'maintenance') : false;
  const canOpenTires = user ? hasPageAccess(user, 'tires') : false;
  const canManage = user ? hasPermission(user, 'warehouseItems', 'create') || hasPermission(user, 'warehouseItems', 'update') : false;
  const activeSuppliers = useMemo(() => suppliers.filter((supplierItem) => supplierItem.active !== false), [suppliers]);

  const loadItemDetail = useCallback(async () => {
    setLoading(true);
    setLoadNotice(null);
    try {
      const itemData = await fetchAdminData<WarehouseItem | null>(`/api/data?entity=warehouse-items&id=${itemId}`, 'Gagal memuat barang gudang');
      if (!itemData) {
        setItem(null);
        return;
      }

      const [supplierRow, purchaseItemRows, movementRows, tireRows, supplierRows] = await Promise.all([
        itemData.defaultSupplierRef
          ? fetchAdminData<Supplier | null>(`/api/data?entity=suppliers&id=${itemData.defaultSupplierRef}`, 'Gagal memuat supplier').catch(() => null)
          : Promise.resolve(null),
        fetchAllAdminCollectionData<PurchaseItem>(
          `/api/data?entity=purchase-items&filter=${encodeURIComponent(JSON.stringify({ warehouseItemRef: itemId }))}`,
          'Gagal memuat histori pembelian barang gudang'
        ),
        fetchAllAdminCollectionData<StockMovement>(
          `/api/data?entity=stock-movements&filter=${encodeURIComponent(JSON.stringify({ warehouseItemRef: itemId }))}&sortField=movementDate&sortDir=desc`,
          'Gagal memuat mutasi stok barang gudang',
          200
        ),
        canOpenTires && isTireTrackedWarehouseItem(itemData)
          ? fetchAllAdminCollectionData<TireEvent>(
              `/api/data?entity=tire-events&filter=${encodeURIComponent(JSON.stringify({ linkedWarehouseItemRef: itemId }))}&sortField=installDate&sortDir=desc`,
              'Gagal memuat ban terhubung',
              200
            )
          : Promise.resolve([]),
        canManage
          ? fetchAllAdminCollectionData<Supplier>('/api/data?entity=suppliers&pageSize=200', 'Gagal memuat supplier', 200)
          : Promise.resolve([]),
      ]);

      const purchaseRefs = Array.from(new Set((purchaseItemRows || []).map((row) => row.purchaseRef).filter(Boolean)));
      const purchaseEntries = await Promise.all(
        purchaseRefs.map(async (purchaseRef) => {
          const purchase = await fetchAdminData<Purchase | null>(`/api/data?entity=purchases&id=${purchaseRef}`, 'Gagal memuat pembelian').catch(() => null);
          return purchase ? [purchaseRef, purchase] as const : null;
        })
      );

      const maintenanceRefs = canOpenMaintenance
        ? Array.from(
            new Set(
              (movementRows || [])
                .filter((row) => row.sourceType === 'MAINTENANCE_USAGE' && typeof row.sourceRef === 'string' && row.sourceRef.trim())
                .map((row) => row.sourceRef as string)
            )
          )
        : [];

      const maintenanceEntries = await Promise.all(
        maintenanceRefs.map(async (maintenanceRef) => {
          const maintenance = await fetchAdminData<Maintenance | null>(`/api/data?entity=maintenances&id=${maintenanceRef}`, 'Gagal memuat maintenance').catch(() => null);
          return maintenance ? [maintenanceRef, maintenance] as const : null;
        })
      );

      setItem(itemData);
      setSupplier(supplierRow || null);
      setSuppliers(supplierRows || []);
      setForm(createItemForm(itemData));
      setPurchaseItems((purchaseItemRows || []).sort((a, b) => `${b.purchaseRef || ''}-${b._id}`.localeCompare(`${a.purchaseRef || ''}-${a._id}`)));
      setMovements((movementRows || []).sort((a, b) => `${b.movementDate || ''}-${b._id}`.localeCompare(`${a.movementDate || ''}-${a._id}`)));
      setLinkedTires((tireRows || []).sort((a, b) => String(a.tireCode || '').localeCompare(String(b.tireCode || ''))));
      setPurchasesById(
        purchaseEntries.reduce<Record<string, Purchase>>((acc, entry) => {
          if (!entry) return acc;
          acc[entry[0]] = entry[1];
          return acc;
        }, {})
      );
      setMaintenancesById(
        maintenanceEntries.reduce<Record<string, Maintenance>>((acc, entry) => {
          if (!entry) return acc;
          acc[entry[0]] = entry[1];
          return acc;
        }, {})
      );
    } catch (error) {
      const message = getAdminErrorMessage(error, 'Gagal memuat detail barang gudang');
      setLoadNotice(buildAdminLoadNotice(
        message,
        'Barang Gudang',
        'Halaman ini hanya bisa dilihat oleh role yang punya akses Barang Gudang.'
      ));
      addToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [addToast, canManage, canOpenMaintenance, canOpenTires, itemId]);

  useEffect(() => {
    void loadItemDetail();
  }, [loadItemDetail]);

  const stockBadge = useMemo(() => (item ? getStockBadge(item) : null), [item]);
  const totalInQty = useMemo(() => movements.filter((movement) => movement.type === 'IN').reduce((sum, movement) => sum + Number(movement.quantity || 0), 0), [movements]);
  const totalOutQty = useMemo(() => movements.filter((movement) => movement.type === 'OUT').reduce((sum, movement) => sum + Number(movement.quantity || 0), 0), [movements]);
  const lastMovementDate = movements[0]?.movementDate;

  const purchaseRows = useMemo(
    () =>
      purchaseItems
        .map((purchaseItem) => ({ purchaseItem, purchase: purchasesById[purchaseItem.purchaseRef] }))
        .filter((row) => row.purchase)
        .sort((a, b) => `${b.purchase?.orderDate || ''}-${b.purchase?.purchaseNumber || ''}`.localeCompare(`${a.purchase?.orderDate || ''}-${a.purchase?.purchaseNumber || ''}`)),
    [purchaseItems, purchasesById]
  );

  const openPurchaseCount = useMemo(
    () =>
      new Set(
        purchaseRows
          .filter((row) =>
            row.purchase
            && !isCancelledPurchase(row.purchase)
            && getDerivedPurchasePaymentStatus(row.purchase) !== 'PAID'
            && Number(row.purchase.outstandingAmount || 0) > 0
          )
          .map((row) => row.purchase?._id)
      ).size,
    [purchaseRows]
  );
  const purchaseSummary = useMemo(() => {
    const uniquePurchases = new Set(purchaseRows.map((row) => row.purchase?._id).filter(Boolean));
    const totalReceivedQty = purchaseRows.reduce((sum, row) => sum + Number(row.purchaseItem.receivedQty || 0), 0);
    const totalReceivedValue = purchaseRows.reduce((sum, row) => {
      const qty = Number(row.purchaseItem.receivedQty || 0);
      const unitPrice = Number(row.purchaseItem.unitPrice || 0);
      return sum + (qty > 0 && unitPrice > 0 ? qty * unitPrice : 0);
    }, 0);
    const fallbackUnitCost = Number(item?.defaultPurchasePrice || 0);
    const averageUnitCost = totalReceivedQty > 0
      ? Math.round(totalReceivedValue / totalReceivedQty)
      : Math.max(fallbackUnitCost, 0);
    const stockValueEstimate = Math.round(Number(item?.currentStockQty || 0) * averageUnitCost);
    const lastPurchaseDate = purchaseRows[0]?.purchase?.orderDate || '';
    return {
      purchaseCount: uniquePurchases.size,
      totalReceivedQty,
      totalReceivedValue,
      averageUnitCost,
      stockValueEstimate,
      lastPurchaseDate,
    };
  }, [item?.currentStockQty, item?.defaultPurchasePrice, purchaseRows]);

  const maintenanceUsageRows = useMemo<MaintenanceUsageRow[]>(() => {
    if (!canOpenMaintenance) return [];
    const rows: MaintenanceUsageRow[] = [];
    Object.entries(maintenancesById).forEach(([maintenanceId, maintenance]) => {
      const relatedUsages = (maintenance.materialUsages || []).filter(
        (usage) => isWarehouseStockMaintenanceMaterialUsage(usage) && usage.warehouseItemRef === itemId
      );
      if (relatedUsages.length === 0) return;
      rows.push({
          maintenanceId,
          completedDate: maintenance.completedDate,
          type: maintenance.type,
          vehicleRef: maintenance.vehicleRef,
          vehiclePlate: maintenance.vehiclePlate,
          quantity: relatedUsages.reduce((sum, usage) => sum + Number(usage.quantity || 0), 0),
          subtotalCost: relatedUsages.reduce((sum, usage) => sum + Number(usage.subtotalCost || 0), 0),
          note: relatedUsages.map((usage) => usage.note).filter(Boolean).join(' | ') || undefined,
      });
    });
    return rows.sort((a, b) => `${b.completedDate || ''}-${b.maintenanceId}`.localeCompare(`${a.completedDate || ''}-${a.maintenanceId}`));
  }, [canOpenMaintenance, itemId, maintenancesById]);
  const maintenanceUsageSummary = useMemo(() => {
    if (!canOpenMaintenance) {
      return {
        usageCount: 0,
        totalQuantity: 0,
        totalValue: 0,
        lastUsedDate: '',
      };
    }
    const itemUsageRows = getMaintenanceMaterialUsageRows(Object.values(maintenancesById)).filter(
      (row) => row.warehouseItemRef === itemId,
    );
    return summarizeItemUsageRows(itemUsageRows);
  }, [canOpenMaintenance, itemId, maintenancesById]);

  const getMovementSourceMeta = (movement: StockMovement) => {
    const sourceLabel = STOCK_MOVEMENT_SOURCE_LABELS[movement.sourceType] || movement.sourceType;
    if (movement.sourceType === 'PURCHASE_RECEIPT' && movement.sourceRef) {
      const purchase = purchasesById[movement.sourceRef];
      return {
        primary: purchase?.purchaseNumber || movement.sourceNumber || sourceLabel,
        secondary: purchase?.supplierName || sourceLabel,
        href: canOpenPurchases ? `/inventory/purchases/${movement.sourceRef}` : undefined,
      };
    }
    if (movement.sourceType === 'MAINTENANCE_USAGE') {
      const maintenance = movement.sourceRef ? maintenancesById[movement.sourceRef] : undefined;
      return {
        primary: canOpenVehicles && maintenance?.vehiclePlate ? maintenance.vehiclePlate : 'Maintenance',
        secondary: maintenance?.type ? `${sourceLabel} | ${maintenance.type}` : sourceLabel,
        href: canOpenVehicles && maintenance?.vehicleRef ? `/fleet/vehicles/${maintenance.vehicleRef}?tab=maintenance` : undefined,
      };
    }
    if ((movement.sourceType === 'TIRE_DEPLOYMENT' || movement.sourceType === 'TIRE_RETURN') && canOpenTires) {
      return {
        primary: movement.sourceNumber || sourceLabel,
        secondary: sourceLabel,
        href: '/fleet/tires',
      };
    }
    return {
      primary: movement.sourceNumber || sourceLabel,
      secondary: sourceLabel,
      href: undefined,
    };
  };

  const closeEditModal = () => {
    if (saving || !item) return;
    setShowEditModal(false);
    setForm(createItemForm(item));
  };

  const openEditModal = () => {
    if (!item) return;
    setForm(createItemForm(item));
    setShowEditModal(true);
  };

  const handleSave = async () => {
    if (!canManage || !item) return addToast('error', 'Anda tidak punya hak mengubah barang gudang');
    if (!form.itemCode || !form.name || !form.unit) return addToast('error', 'Kode, nama barang, dan satuan wajib diisi');

    setSaving(true);
    try {
      const payload = {
        itemCode: form.itemCode,
        name: form.name,
        category: form.category,
        unit: form.unit,
        trackingMode: form.trackingMode,
        minStockQty: form.minStockQty,
        defaultSupplierRef: form.defaultSupplierRef || undefined,
        defaultPurchasePrice: form.defaultPurchasePrice,
        tireTypeDefault: form.trackingMode === 'TIRE_ASSET' ? form.tireTypeDefault : undefined,
        tireBrandDefault: form.trackingMode === 'TIRE_ASSET' ? form.tireBrandDefault : undefined,
        tireSizeDefault: form.trackingMode === 'TIRE_ASSET' ? form.tireSizeDefault : undefined,
        notes: form.notes,
        active: form.active,
      };
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'warehouse-items', action: 'update', data: { id: item._id, updates: payload } }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan barang gudang');
      addToast('success', 'Barang gudang diperbarui');
      setShowEditModal(false);
      await loadItemDetail();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan barang gudang');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 120 }} />
        <div className="skeleton skeleton-card" style={{ height: 280 }} />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="empty-state-title">{loadNotice?.title || 'Barang gudang tidak ditemukan'}</div>
          {loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <PageBackButton href="/inventory/items" />
          <h1 className="page-title">Detail Barang Gudang</h1>
        </div>
      </div>

      <div className="segmented-tabs" aria-label="Menu barang gudang" style={{ marginBottom: '1.5rem' }}>
        <button type="button" className={`segmented-tab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>
          Detail
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'purchases' ? 'active' : ''}`} onClick={() => setActiveTab('purchases')}>
          Pembelian Terkait
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'movements' ? 'active' : ''}`} onClick={() => setActiveTab('movements')}>
          Riwayat Mutasi Stok
        </button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Stok Saat Ini</div><div className="kpi-value">{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Min. Stok</div><div className="kpi-value">{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Masuk</div><div className="kpi-value">{formatInventoryQuantity(totalInQty)} {item.unit}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Keluar</div><div className="kpi-value">{formatInventoryQuantity(totalOutQty)} {item.unit}</div></div></div>
      </div>

      {activeTab === 'detail' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span className="card-header-title">{item.itemCode} - {item.name}</span>
          {canManage ? (
            <button className="btn btn-secondary btn-sm" onClick={openEditModal}>
              <Edit size={14} /> Edit
            </button>
          ) : null}
        </div>
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-row"><span className="detail-label">Kategori</span><span className="detail-value">{item.category || '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Satuan</span><span className="detail-value">{item.unit}</span></div>
            <div className="detail-row"><span className="detail-label">Mode Tracking</span><span className="detail-value">{WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']}</span></div>
            <div className="detail-row"><span className="detail-label">Status Stok</span><span className="detail-value"><span className={`badge ${stockBadge?.className || 'badge-gray'}`}>{stockBadge?.label || '-'}</span></span></div>
            <div className="detail-row"><span className="detail-label">Supplier Default</span><span className="detail-value">{canOpenSuppliers && supplier ? <Link href={`/suppliers/${supplier._id}`} style={{ color: 'var(--color-primary)' }}>{supplier.name}</Link> : (item.defaultSupplierName || supplier?.name || '-')}</span></div>
            <div className="detail-row"><span className="detail-label">Harga Beli Default</span><span className="detail-value">{Number(item.defaultPurchasePrice || 0) > 0 ? formatCurrency(Number(item.defaultPurchasePrice || 0)) : '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Pembelian Aktif</span><span className="detail-value">{openPurchaseCount}</span></div>
            <div className="detail-row"><span className="detail-label">Mutasi Terakhir</span><span className="detail-value">{lastMovementDate ? formatDate(lastMovementDate) : '-'}</span></div>
            {isTireTrackedWarehouseItem(item) && (
              <>
                <div className="detail-row"><span className="detail-label">Merk Ban Default</span><span className="detail-value">{item.tireBrandDefault || '-'}</span></div>
                <div className="detail-row"><span className="detail-label">Ukuran Ban Default</span><span className="detail-value">{item.tireSizeDefault || '-'}</span></div>
                <div className="detail-row"><span className="detail-label">Jenis Ban Default</span><span className="detail-value">{normalizeTireType(item.tireTypeDefault)}</span></div>
                <div className="detail-row"><span className="detail-label">Ban Terhubung</span><span className="detail-value">{linkedTires.length}</span></div>
              </>
            )}
            <div className="detail-row"><span className="detail-label">Catatan</span><span className="detail-value">{item.notes || '-'}</span></div>
          </div>
        </div>
      </div>
      )}

      {activeTab === 'purchases' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-header-title">Pembelian Terkait</span></div>
        <div className="card-body">
          {purchaseRows.length === 0 ? (
            <div className="empty-state">
              <Receipt size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada pembelian untuk barang ini</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead><tr><th>Pembelian</th><th>Tanggal</th><th>Supplier</th><th>Jumlah Pesan</th><th>Jumlah Terima</th><th>Harga</th><th>Status</th></tr></thead>
                  <tbody>
                    {purchaseRows.map(({ purchaseItem, purchase }) => (
                      <tr key={purchaseItem._id}>
                        <td className="font-mono">{canOpenPurchases && purchase ? <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>{purchase.purchaseNumber}</Link> : (purchase?.purchaseNumber || '-')}</td>
                        <td>{purchase?.orderDate ? formatDate(purchase.orderDate) : '-'}</td>
                        <td>{purchase?.supplierName || '-'}</td>
                        <td>{formatInventoryQuantity(purchaseItem.orderedQty)} {purchaseItem.itemUnit || item.unit}</td>
                        <td>{formatInventoryQuantity(purchaseItem.receivedQty || 0)} {purchaseItem.itemUnit || item.unit}</td>
                        <td>{formatCurrency(Number(purchaseItem.unitPrice || 0))}</td>
                        <td><PurchaseLifecycleBadges purchase={purchase} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {purchaseRows.map(({ purchaseItem, purchase }) => (
                  <div key={purchaseItem._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">{canOpenPurchases && purchase ? <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>{purchase.purchaseNumber}</Link> : (purchase?.purchaseNumber || '-')}</div>
                        <div className="mobile-record-subtitle">{purchase?.supplierName || '-'}</div>
                      </div>
                      <PurchaseLifecycleBadges purchase={purchase} />
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field"><span className="mobile-record-label">Tanggal</span><span className="mobile-record-value">{purchase?.orderDate ? formatDate(purchase.orderDate) : '-'}</span></div>
                      <div className="mobile-record-field"><span className="mobile-record-label">Jumlah Pesan</span><span className="mobile-record-value">{formatInventoryQuantity(purchaseItem.orderedQty)} {purchaseItem.itemUnit || item.unit}</span></div>
                      <div className="mobile-record-field"><span className="mobile-record-label">Jumlah Terima</span><span className="mobile-record-value">{formatInventoryQuantity(purchaseItem.receivedQty || 0)} {purchaseItem.itemUnit || item.unit}</span></div>
                      <div className="mobile-record-field"><span className="mobile-record-label">Harga</span><span className="mobile-record-value">{formatCurrency(Number(purchaseItem.unitPrice || 0))}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {activeTab === 'detail' && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-header-title">Ringkasan Pemakaian & Pembelian</span>
          </div>
          <div className="card-body">
            <div className="detail-grid">
              <div className="detail-row">
                <span className="detail-label">Pembelian Tercatat</span>
                <span className="detail-value">{purchaseSummary.purchaseCount} dokumen</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Qty Diterima</span>
                <span className="detail-value">
                  {formatInventoryQuantity(purchaseSummary.totalReceivedQty)} {item.unit}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Pembelian Terakhir</span>
                <span className="detail-value">
                  {purchaseSummary.lastPurchaseDate ? formatDate(purchaseSummary.lastPurchaseDate) : '-'}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">HPP Rata-rata</span>
                <span className="detail-value">
                  {formatCurrency(purchaseSummary.averageUnitCost)} / {item.unit}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Nilai Stok Estimasi</span>
                <span className="detail-value">{formatCurrency(purchaseSummary.stockValueEstimate)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Dipakai di Maintenance</span>
                <span className="detail-value">{maintenanceUsageSummary.usageCount} aktivitas</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Qty Terpakai</span>
                <span className="detail-value">
                  {formatInventoryQuantity(maintenanceUsageSummary.totalQuantity)} {item.unit}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Nilai Material Terpakai</span>
                <span className="detail-value">{formatCurrency(maintenanceUsageSummary.totalValue)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Dipakai Terakhir</span>
                <span className="detail-value">
                  {maintenanceUsageSummary.lastUsedDate ? formatDate(maintenanceUsageSummary.lastUsedDate) : '-'}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Laporan Pemakaian</span>
                <span className="detail-value">
                  {canOpenMaintenance ? (
                    <Link href={`/inventory/material-usage?itemRef=${encodeURIComponent(item._id)}`} style={{ color: 'var(--color-primary)' }}>
                      Buka laporan pemakaian barang
                    </Link>
                  ) : (
                    'Pantau stok & pembelian'
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'movements' && canOpenMaintenance && maintenanceUsageRows.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><span className="card-header-title">Pemakaian di Maintenance</span></div>
          <div className="card-body">
            <div className="table-wrapper table-desktop-only">
              <table>
                <thead><tr><th>Tanggal</th><th>Kendaraan</th><th>Maintenance</th><th>Qty</th><th>Biaya Material</th><th>Catatan</th></tr></thead>
                <tbody>
                  {maintenanceUsageRows.map((row) => (
                    <tr key={row.maintenanceId}>
                      <td>{row.completedDate ? formatDate(row.completedDate) : '-'}</td>
                      <td>{canOpenVehicles && row.vehicleRef ? <Link href={`/fleet/vehicles/${row.vehicleRef}?tab=maintenance`} style={{ color: 'var(--color-primary)' }}>{row.vehiclePlate || '-'}</Link> : (row.vehiclePlate || '-')}</td>
                      <td>{row.type || 'Maintenance'}</td>
                      <td>{formatInventoryQuantity(row.quantity)} {item.unit}</td>
                      <td>{formatCurrency(row.subtotalCost)}</td>
                      <td>{row.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {maintenanceUsageRows.map((row) => (
                <div key={row.maintenanceId} className="mobile-record-card">
                  <div className="mobile-record-header">
                    <div>
                      <div className="mobile-record-title">{canOpenVehicles && row.vehicleRef ? <Link href={`/fleet/vehicles/${row.vehicleRef}?tab=maintenance`} style={{ color: 'var(--color-primary)' }}>{row.vehiclePlate || '-'}</Link> : (row.vehiclePlate || '-')}</div>
                      <div className="mobile-record-subtitle">{row.type || 'Maintenance'}</div>
                    </div>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Tanggal</span><span className="mobile-record-value">{row.completedDate ? formatDate(row.completedDate) : '-'}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Qty</span><span className="mobile-record-value">{formatInventoryQuantity(row.quantity)} {item.unit}</span></div>
                    <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Biaya Material</span><span className="mobile-record-value">{formatCurrency(row.subtotalCost)}</span></div>
                    {row.note ? <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{row.note}</span></div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'detail' && isTireTrackedWarehouseItem(item) && linkedTires.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><span className="card-header-title">Ban Terhubung</span></div>
          <div className="card-body">
            <div className="table-wrapper table-desktop-only">
              <table>
                <thead><tr><th>Kode Ban</th><th>Status</th><th>Posisi</th><th>Tanggal</th></tr></thead>
                <tbody>
                  {linkedTires.map((tire) => (
                    <tr key={tire._id}>
                      <td>{canOpenTires ? <Link href={`/fleet/tires?q=${encodeURIComponent(tire.tireCode || '')}`} style={{ color: 'var(--color-primary)' }}>{tire.tireCode || '-'}</Link> : (tire.tireCode || '-')}</td>
                      <td>{renderTireStatus(tire)}</td>
                      <td>{tire.posisi || '-'}</td>
                      <td>{formatDate(tire.sourceReceiveDate || tire.installDate)}</td>
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
                      <div className="mobile-record-title">{canOpenTires ? <Link href={`/fleet/tires?q=${encodeURIComponent(tire.tireCode || '')}`} style={{ color: 'var(--color-primary)' }}>{tire.tireCode || '-'}</Link> : (tire.tireCode || '-')}</div>
                      <div className="mobile-record-subtitle">{tire.posisi || '-'}</div>
                    </div>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Status</span><span className="mobile-record-value">{renderTireStatus(tire)}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Tanggal</span><span className="mobile-record-value">{formatDate(tire.sourceReceiveDate || tire.installDate)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'movements' && (
      <div className="card">
        <div className="card-header"><span className="card-header-title">Riwayat Mutasi Stok</span></div>
        <div className="card-body">
          {movements.length === 0 ? (
            <div className="empty-state">
              <History size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada mutasi stok</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead><tr><th>Tanggal</th><th>Mutasi</th><th>Sumber</th><th>Qty</th><th>Saldo Setelah</th><th>Catatan</th></tr></thead>
                  <tbody>
                    {movements.map((movement) => {
                      const source = getMovementSourceMeta(movement);
                      const signedQty = movement.type === 'OUT' ? `- ${formatInventoryQuantity(movement.quantity)}` : formatInventoryQuantity(movement.quantity);
                      const safeNote = movement.sourceType === 'MAINTENANCE_USAGE' && !canOpenVehicles
                        ? 'Pemakaian material maintenance'
                        : (movement.note || '-');
                      return (
                        <tr key={movement._id}>
                          <td>{formatDate(movement.movementDate)}</td>
                          <td>{STOCK_MOVEMENT_TYPE_LABELS[movement.type]}</td>
                          <td>{source.href ? <Link href={source.href} style={{ color: 'var(--color-primary)' }}>{source.primary}</Link> : source.primary}<div className="text-muted text-xs">{source.secondary}</div></td>
                          <td>{signedQty} {movement.unit || item.unit}</td>
                          <td>{formatInventoryQuantity(movement.balanceAfter || 0)} {movement.unit || item.unit}</td>
                          <td>{safeNote}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {movements.map((movement) => {
                  const source = getMovementSourceMeta(movement);
                  const signedQty = movement.type === 'OUT' ? `- ${formatInventoryQuantity(movement.quantity)}` : formatInventoryQuantity(movement.quantity);
                  const safeNote = movement.sourceType === 'MAINTENANCE_USAGE' && !canOpenVehicles
                    ? 'Pemakaian material maintenance'
                    : (movement.note || '-');
                  return (
                    <div key={movement._id} className="mobile-record-card">
                      <div className="mobile-record-header">
                        <div>
                          <div className="mobile-record-title">{STOCK_MOVEMENT_TYPE_LABELS[movement.type]}</div>
                          <div className="mobile-record-subtitle">{formatDate(movement.movementDate)}</div>
                        </div>
                      </div>
                      <div className="mobile-record-grid">
                        <div className="mobile-record-field mobile-record-field-full">
                          <span className="mobile-record-label">Sumber</span>
                          <span className="mobile-record-value">{source.href ? <Link href={source.href} style={{ color: 'var(--color-primary)' }}>{source.primary}</Link> : source.primary}</span>
                          <div className="mobile-record-subtitle" style={{ marginTop: '0.25rem' }}>{source.secondary}</div>
                        </div>
                        <div className="mobile-record-field"><span className="mobile-record-label">Qty</span><span className="mobile-record-value">{signedQty} {movement.unit || item.unit}</span></div>
                        <div className="mobile-record-field"><span className="mobile-record-label">Saldo Setelah</span><span className="mobile-record-value">{formatInventoryQuantity(movement.balanceAfter || 0)} {movement.unit || item.unit}</span></div>
                        <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{safeNote}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {showEditModal && item && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Barang Gudang</h3>
              <button className="modal-close" onClick={closeEditModal} disabled={saving}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row"><div className="form-group"><label className="form-label">Kode Barang</label><input className="form-input" value={form.itemCode} onChange={(event) => setForm((current) => ({ ...current, itemCode: event.target.value }))} /></div><div className="form-group"><label className="form-label">Nama Barang</label><input className="form-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Kategori</label><input className="form-input" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></div><div className="form-group"><label className="form-label">Mode Tracking</label><select className="form-select" value={form.trackingMode} onChange={(event) => setForm((current) => ({ ...current, trackingMode: event.target.value as ItemFormState['trackingMode'], unit: event.target.value === 'TIRE_ASSET' && current.unit !== 'PCS' && current.unit !== 'UNIT' ? 'PCS' : current.unit }))}>{WAREHOUSE_ITEM_TRACKING_MODE_OPTIONS.map((option) => <option key={option} value={option}>{WAREHOUSE_ITEM_TRACKING_MODE_LABELS[option]}</option>)}</select></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Satuan</label><select className="form-select" value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as WarehouseItem['unit'] }))}>{INVENTORY_UNIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div><div className="form-group"><label className="form-label">Min. Stok</label><FormattedNumberInput min={0} maxFractionDigits={form.trackingMode === 'TIRE_ASSET' ? 0 : 3} allowDecimal={form.trackingMode !== 'TIRE_ASSET'} value={form.minStockQty} onValueChange={(value) => setForm((current) => ({ ...current, minStockQty: value }))} /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Supplier Default</label><select className="form-select" value={form.defaultSupplierRef} onChange={(event) => setForm((current) => ({ ...current, defaultSupplierRef: event.target.value }))}><option value="">-- Tidak dipilih --</option>{activeSuppliers.map((supplierItem) => <option key={supplierItem._id} value={supplierItem._id}>{supplierItem.supplierCode} - {supplierItem.name}</option>)}</select></div><div className="form-group"><label className="form-label">Harga Beli Default (Rp)</label><FormattedNumberInput allowDecimal={false} value={form.defaultPurchasePrice} onValueChange={(value) => setForm((current) => ({ ...current, defaultPurchasePrice: value }))} placeholder="Ketik harga beli default" /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Status</label><select className="form-select" value={form.active ? 'active' : 'inactive'} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === 'active' }))}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div></div>
              {form.trackingMode === 'TIRE_ASSET' && (
                <>
                  <div className="info-banner" style={{ marginBottom: '1rem' }}>
                    <div className="info-banner-title">Barang Gudang Ban Tertracking</div>
                    <div className="info-banner-text">
                      Barang ini dipakai sebagai master ban individual. Penerimaan pembelian akan otomatis membuat kartu ban satu per satu, dan perpindahan ban ke unit akan mengurangi stok gudang otomatis.
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Jenis Ban Default</label><select className="form-select" value={form.tireTypeDefault} onChange={(event) => setForm((current) => ({ ...current, tireTypeDefault: event.target.value }))}>{TIRE_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                    <div className="form-group"><label className="form-label">Merk Ban Default</label><input className="form-input" value={form.tireBrandDefault} onChange={(event) => setForm((current) => ({ ...current, tireBrandDefault: event.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Ukuran Ban Default</label><input className="form-input" value={form.tireSizeDefault} onChange={(event) => setForm((current) => ({ ...current, tireSizeDefault: event.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">Petunjuk</label><input className="form-input" value="Harga ban tidak ditampilkan di modul Ban" readOnly /></div>
                  </div>
                </>
              )}
              <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeEditModal} disabled={saving}>Batal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
