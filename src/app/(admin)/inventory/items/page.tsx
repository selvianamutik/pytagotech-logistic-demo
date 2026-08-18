'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowDownCircle, ArrowUpCircle, Edit, FileDown, Package, Plus, RefreshCw, Save, Search, X } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { exportToExcel } from '@/lib/export';
import { getMasterDataImportExportColumns } from '@/lib/master-data-import-config';
import {
  formatInventoryQuantity,
  INVENTORY_UNIT_OPTIONS,
  isTireTrackedWarehouseItem,
  WAREHOUSE_ITEM_TRACKING_MODE_LABELS,
  WAREHOUSE_ITEM_TRACKING_MODE_OPTIONS,
} from '@/lib/inventory';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { normalizeTireType, TIRE_TYPE_OPTIONS } from '@/lib/tire-types';
import type { Supplier, WarehouseItem } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

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

type MovementFormState = {
  movementDate: string;
  sourceType: 'MANUAL_IN' | 'MANUAL_OUT';
  quantity: number;
  note: string;
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

const createMovementForm = (sourceType: 'MANUAL_IN' | 'MANUAL_OUT' = 'MANUAL_IN'): MovementFormState => ({
  movementDate: getBusinessDateValue(),
  sourceType,
  quantity: 0,
  note: '',
});

function getStockBadge(item: WarehouseItem) {
  const stock = Number(item.currentStockQty || 0);
  const min = Number(item.minStockQty || 0);
  if (item.active === false) return { label: 'Nonaktif', className: 'badge-gray' };
  if (stock <= 0) return { label: 'Habis', className: 'badge-danger' };
  if (min > 0 && stock <= min) return { label: 'Menipis', className: 'badge-warning' };
  return { label: 'Aman', className: 'badge-success' };
}

export default function WarehouseItemsPage() {
  const searchParams = useSearchParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [allItems, setAllItems] = useState<WarehouseItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [editItem, setEditItem] = useState<WarehouseItem | null>(null);
  const [movementItem, setMovementItem] = useState<WarehouseItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormState>(createItemForm());
  const [movementForm, setMovementForm] = useState<MovementFormState>(createMovementForm());

  const canManage = user ? hasPermission(user, 'warehouseItems', 'create') || hasPermission(user, 'warehouseItems', 'update') : false;
  const canExportItems = user ? hasPermission(user, 'warehouseItems', 'export') : false;
  const canOpenSuppliers = user ? hasPageAccess(user, 'suppliers') : false;
  const canOpenItemDetail = user ? hasPageAccess(user, 'warehouseItems') : false;
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.active !== false), [suppliers]);
  const activeItemCount = allItems.filter((item) => item.active !== false).length;
  const lowStockCount = allItems.filter((item) => {
    const stock = Number(item.currentStockQty || 0);
    return item.active !== false && Number(item.minStockQty || 0) > 0 && stock > 0 && stock <= Number(item.minStockQty || 0);
  }).length;
  const outOfStockCount = allItems.filter((item) => item.active !== false && Number(item.currentStockQty || 0) <= 0).length;

  const buildQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
    const params = new URLSearchParams({ entity: 'warehouse-items', page: String(targetPage), pageSize: String(targetPageSize), sortField: 'itemCode', sortDir: 'asc' });
    if (search.trim()) {
      params.set('q', search.trim());
      params.set('searchFields', 'itemCode,name,category,defaultSupplierName,notes');
    }
    return params.toString();
  }, [page, search]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, itemRows, supplierRows] = await Promise.all([
        fetch(`/api/data?${buildQuery()}`),
        fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&pageSize=200', 'Gagal memuat barang gudang', 200),
        fetchAllAdminCollectionData<Supplier>('/api/data?entity=suppliers&pageSize=200', 'Gagal memuat supplier', 200),
      ]);
      const payload = await listRes.json();
      if (!listRes.ok) throw new Error(payload.error || 'Gagal memuat barang gudang');
      setItems((payload.data || []) as WarehouseItem[]);
      setFilteredTotal(payload.meta?.total || 0);
      setAllItems(itemRows || []);
      setSuppliers(supplierRows || []);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat barang gudang');
    } finally {
      setLoading(false);
    }
  }, [addToast, buildQuery]);

  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => {
    const nextSearch = searchParams.get('q') || '';
    setSearch((current) => current === nextSearch ? current : nextSearch);
  }, [searchParams]);

  const handleExport = async () => {
    if (!canExportItems) return;
    try {
      const rows = await fetchAllAdminCollectionData<WarehouseItem>(
        `/api/data?${buildQuery(1, 500)}`,
        'Gagal memuat barang gudang untuk export',
        500,
      );
      const supplierCodeByRef = new Map((suppliers || []).map((supplier) => [supplier._id, supplier.supplierCode]));
      await exportToExcel(
        (rows || []).map((item) => ({
          itemCode: item.itemCode,
          name: item.name,
          category: item.category || '',
          unit: item.unit,
          trackingMode: item.trackingMode || 'STANDARD',
          minStockQty: Number(item.minStockQty || 0),
          defaultSupplierCode: item.defaultSupplierRef ? supplierCodeByRef.get(item.defaultSupplierRef) || '' : '',
          defaultSupplierName: item.defaultSupplierName || '',
          defaultPurchasePrice: Number(item.defaultPurchasePrice || 0),
          tireTypeDefault: item.tireTypeDefault || '',
          tireBrandDefault: item.tireBrandDefault || '',
          tireSizeDefault: item.tireSizeDefault || '',
          notes: item.notes || '',
          active: item.active !== false ? 'Aktif' : 'Nonaktif',
        })),
        getMasterDataImportExportColumns('warehouse-items').map((column, index) => ({
          ...column,
          width: [16, 30, 18, 10, 16, 12, 16, 24, 18, 20, 18, 14, 28, 12][index] || 18,
          ...(column.key === 'defaultPurchasePrice'
            ? { formatter: (value: unknown) => Number(value || 0).toLocaleString('id-ID') }
            : {}),
        })),
        `barang-gudang-${new Date().toISOString().slice(0, 10)}`,
        'Barang Gudang',
        {
          title: 'Daftar Barang Gudang',
          subtitle: search.trim() ? `Hasil pencarian: ${search.trim()}` : 'Semua barang gudang',
        },
      );
      addToast('success', 'Excel barang gudang berhasil di-download');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel barang gudang');
    }
  };

  const closeModal = () => { if (!saving) { setShowModal(false); setEditItem(null); setForm(createItemForm()); } };
  const closeMovementModal = () => { if (!savingMovement) { setShowMovementModal(false); setMovementItem(null); setMovementForm(createMovementForm()); } };
  const openCreate = () => { setEditItem(null); setForm(createItemForm()); setShowModal(true); };
  const openEdit = (item: WarehouseItem) => { setEditItem(item); setForm(createItemForm(item)); setShowModal(true); };
  const openMovement = (item: WarehouseItem, sourceType: 'MANUAL_IN' | 'MANUAL_OUT') => { setMovementItem(item); setMovementForm(createMovementForm(sourceType)); setShowMovementModal(true); };
  const handleSave = async () => {
    if (!canManage) return addToast('error', 'Anda tidak punya hak mengubah barang gudang');
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
      const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editItem ? { entity: 'warehouse-items', action: 'update', data: { id: editItem._id, updates: payload } } : { entity: 'warehouse-items', data: payload }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan barang gudang');
      addToast('success', editItem ? 'Barang gudang diperbarui' : 'Barang gudang ditambahkan');
      closeModal();
      if (!editItem && page !== 1) {
        setPage(1);
      } else {
        await loadItems();
      }
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan barang gudang');
    } finally {
      setSaving(false);
    }
  };

  const handleStockMovement = async () => {
    if (!canManage || !movementItem) return addToast('error', 'Anda tidak punya hak mencatat mutasi stok');
    if (isTireTrackedWarehouseItem(movementItem)) return addToast('error', 'Mutasi stok ban tertracking dikelola lewat modul Ban dan pembelian supplier');
    if (!movementForm.quantity || Number(movementForm.quantity) <= 0) return addToast('error', 'Qty mutasi stok wajib diisi');
    setSavingMovement(true);
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'stock-movements', data: { warehouseItemRef: movementItem._id, movementDate: movementForm.movementDate, sourceType: movementForm.sourceType, quantity: movementForm.quantity, note: movementForm.note || undefined } }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal mencatat mutasi stok');
      addToast('success', movementForm.sourceType === 'MANUAL_OUT' ? 'Stok keluar dicatat' : 'Stok masuk dicatat');
      closeMovementModal();
      await loadItems();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal mencatat mutasi stok');
    } finally {
      setSavingMovement(false);
    }
  };

  const toggleActive = async (item: WarehouseItem) => {
    if (!canManage) return addToast('error', 'Anda tidak punya hak mengubah status barang gudang');
    setTogglingId(item._id);
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'warehouse-items', action: 'update', data: { id: item._id, updates: { active: item.active === false } } }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal memperbarui status barang gudang');
      addToast('success', item.active === false ? 'Barang gudang diaktifkan' : 'Barang gudang dinonaktifkan');
      await loadItems();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui status barang gudang');
    } finally {
      setTogglingId((current) => current === item._id ? null : current);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left"><h1 className="page-title">Barang Gudang</h1></div>
        <div className="page-actions">
          {canExportItems && <button className="btn btn-secondary" onClick={() => void handleExport()}><FileDown size={18} /> Excel</button>}
          {canManage && <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> Tambah Barang</button>}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Barang Aktif</div><div className="kpi-value">{activeItemCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Stok Menipis</div><div className="kpi-value">{lowStockCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Stok Habis</div><div className="kpi-value">{outOfStockCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hak Kelola</div><div className="kpi-value">{canManage ? 'Aktif' : 'Lihat Saja'}</div></div></div>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div className="table-search">
              <Search size={16} className="table-search-icon" />
              <input className="table-search-input" placeholder="Cari kode barang, nama, kategori, supplier..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>
        </div>

        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr><th>Kode</th><th>Barang</th><th>Mode</th><th>Supplier Default</th><th>Stok</th><th>Min. Stok</th><th>Harga Beli</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {loading ? [1, 2, 3].map((index) => (
                <tr key={index}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((cell) => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
              )) : filteredTotal === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><Package size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada master barang gudang</div></div></td></tr>
              ) : items.map((item) => {
                const badge = getStockBadge(item);
                return (
                  <tr key={item._id}>
                    <td className="font-mono">
                      {canOpenItemDetail ? (
                        <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                          {item.itemCode}
                        </Link>
                      ) : item.itemCode}
                    </td>
                    <td>
                      <div className="font-semibold">
                        {canOpenItemDetail ? (
                          <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                            {item.name}
                          </Link>
                        ) : item.name}
                      </div>
                      <div className="text-muted text-xs">{item.category || 'Tanpa kategori'} | {item.unit}</div>
                    </td>
                    <td>
                      <span className={`badge ${isTireTrackedWarehouseItem(item) ? 'badge-info' : 'badge-gray'}`}>
                        {WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']}
                      </span>
                    </td>
                    <td>
                      {canOpenSuppliers && item.defaultSupplierRef ? (
                        <Link href={`/suppliers/${item.defaultSupplierRef}`} style={{ color: 'var(--color-primary)' }}>
                          {item.defaultSupplierName || '-'}
                        </Link>
                      ) : (item.defaultSupplierName || '-')}
                    </td>
                    <td>{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</td>
                    <td>{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</td>
                    <td>{Number(item.defaultPurchasePrice || 0) > 0 ? formatCurrency(Number(item.defaultPurchasePrice || 0)) : '-'}</td>
                    <td><span className={`badge ${badge.className}`}>{badge.label}</span></td>
                    <td>
                      <div className="table-actions">
                        {canOpenItemDetail ? <Link href={`/inventory/items/${item._id}`} className="table-action-btn">Detail</Link> : null}
                        {canManage ? (
                          <>
                            <button className="table-action-btn" onClick={() => openEdit(item)}><Edit size={14} /> Edit</button>
                            {!isTireTrackedWarehouseItem(item) && <button className="table-action-btn" onClick={() => openMovement(item, 'MANUAL_IN')}><ArrowDownCircle size={14} /> Masuk</button>}
                            {!isTireTrackedWarehouseItem(item) && <button className="table-action-btn" onClick={() => openMovement(item, 'MANUAL_OUT')}><ArrowUpCircle size={14} /> Keluar</button>}
                            <button className="table-action-btn" onClick={() => toggleActive(item)} disabled={togglingId === item._id}><RefreshCw size={14} />{togglingId === item._id ? 'Menyimpan...' : item.active !== false ? 'Nonaktifkan' : 'Aktifkan'}</button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && (
          <div className="mobile-record-list">
            {filteredTotal === 0 ? (
              <div className="mobile-record-card"><div className="mobile-record-title">Belum ada master barang gudang</div><div className="mobile-record-subtitle">Tambahkan barang sebelum membuat pembelian supplier.</div></div>
            ) : items.map((item) => {
              const badge = getStockBadge(item);
              return (
                <div key={item._id} className="mobile-record-card">
                  <div className="mobile-record-header">
                    <div>
                      <div className="mobile-record-title">
                        {canOpenItemDetail ? (
                          <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                            {item.name}
                          </Link>
                        ) : item.name}
                      </div>
                      <div className="mobile-record-subtitle">{item.itemCode} | {item.unit}</div>
                    </div>
                    <span className={`badge ${badge.className}`}>{badge.label}</span>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Kategori</span><span className="mobile-record-value">{item.category || '-'}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Mode</span><span className="mobile-record-value">{WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']}</span></div>
                    <div className="mobile-record-field">
                      <span className="mobile-record-label">Supplier</span>
                      <span className="mobile-record-value">
                        {canOpenSuppliers && item.defaultSupplierRef ? (
                          <Link href={`/suppliers/${item.defaultSupplierRef}`} style={{ color: 'var(--color-primary)' }}>
                            {item.defaultSupplierName || '-'}
                          </Link>
                        ) : (item.defaultSupplierName || '-')}
                      </span>
                    </div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Stok</span><span className="mobile-record-value">{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Min. Stok</span><span className="mobile-record-value">{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</span></div>
                    <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Harga Beli Default</span><span className="mobile-record-value">{Number(item.defaultPurchasePrice || 0) > 0 ? formatCurrency(Number(item.defaultPurchasePrice || 0)) : '-'}</span></div>
                    {isTireTrackedWarehouseItem(item) && (
                      <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Default Ban</span><span className="mobile-record-value">{item.tireBrandDefault || '-'} | {item.tireSizeDefault || '-'} | {normalizeTireType(item.tireTypeDefault)}</span></div>
                    )}
                  </div>
                  <div className="mobile-record-actions">
                    {canOpenItemDetail ? <Link href={`/inventory/items/${item._id}`} className="btn btn-secondary">Detail</Link> : null}
                    {canManage ? <button className="btn btn-secondary" onClick={() => openEdit(item)}><Edit size={14} /> Edit</button> : null}
                    {canManage && !isTireTrackedWarehouseItem(item) ? <button className="btn btn-secondary" onClick={() => openMovement(item, 'MANUAL_IN')}><ArrowDownCircle size={14} /> Masuk</button> : null}
                    {canManage && !isTireTrackedWarehouseItem(item) ? <button className="btn btn-secondary" onClick={() => openMovement(item, 'MANUAL_OUT')}><ArrowUpCircle size={14} /> Keluar</button> : null}
                    {canManage ? <button className="btn btn-secondary" onClick={() => toggleActive(item)} disabled={togglingId === item._id}><RefreshCw size={14} />{togglingId === item._id ? 'Menyimpan...' : item.active !== false ? 'Nonaktifkan' : 'Aktifkan'}</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filteredTotal > 0 && (
          <AppPagination
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalItems={filteredTotal}
            onPageChange={setPage}
            info={({ startIndex, endIndex, totalItems }) => <>Menampilkan {startIndex}-{endIndex} dari {totalItems} barang gudang</>}
          />
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editItem ? 'Edit Barang Gudang' : 'Tambah Barang Gudang'}</h3>
              <button className="modal-close" onClick={closeModal} disabled={saving}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-row"><div className="form-group"><label className="form-label">Kode Barang</label><input className="form-input" value={form.itemCode} onChange={(event) => setForm((current) => ({ ...current, itemCode: event.target.value }))} /></div><div className="form-group"><label className="form-label">Nama Barang</label><input className="form-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Kategori</label><input className="form-input" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></div><div className="form-group"><label className="form-label">Mode Tracking</label><select className="form-select" value={form.trackingMode} onChange={(event) => setForm((current) => ({ ...current, trackingMode: event.target.value as ItemFormState['trackingMode'], unit: event.target.value === 'TIRE_ASSET' && current.unit !== 'PCS' && current.unit !== 'UNIT' ? 'PCS' : current.unit }))}>{WAREHOUSE_ITEM_TRACKING_MODE_OPTIONS.map((option) => <option key={option} value={option}>{WAREHOUSE_ITEM_TRACKING_MODE_LABELS[option]}</option>)}</select></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Satuan</label><select className="form-select" value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as WarehouseItem['unit'] }))}>{INVENTORY_UNIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div><div className="form-group"><label className="form-label">Min. Stok</label><FormattedNumberInput min={0} maxFractionDigits={form.trackingMode === 'TIRE_ASSET' ? 0 : 3} allowDecimal={form.trackingMode !== 'TIRE_ASSET'} value={form.minStockQty} onValueChange={(value) => setForm((current) => ({ ...current, minStockQty: value }))} /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Supplier Default</label><select className="form-select" value={form.defaultSupplierRef} onChange={(event) => setForm((current) => ({ ...current, defaultSupplierRef: event.target.value }))}><option value="">-- Tidak dipilih --</option>{activeSuppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.supplierCode} - {supplier.name}</option>)}</select></div><div className="form-group"><label className="form-label">Harga Beli Default (Rp)</label><FormattedNumberInput allowDecimal={false} value={form.defaultPurchasePrice} onValueChange={(value) => setForm((current) => ({ ...current, defaultPurchasePrice: value }))} placeholder="Ketik harga beli default" /></div></div>
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
            <div className="modal-footer"><button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
          </div>
        </div>
      )}

      {showMovementModal && movementItem && (
        <div className="modal-overlay" onClick={closeMovementModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{movementForm.sourceType === 'MANUAL_OUT' ? 'Catat Stok Keluar' : 'Catat Stok Masuk'}</h3>
              <button className="modal-close" onClick={closeMovementModal} disabled={savingMovement}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-row"><div className="form-group"><label className="form-label">Tanggal Mutasi</label><input type="date" className="form-input" value={movementForm.movementDate} onChange={(event) => setMovementForm((current) => ({ ...current, movementDate: event.target.value }))} /></div><div className="form-group"><label className="form-label">Qty</label><FormattedNumberInput min={0} maxFractionDigits={3} value={movementForm.quantity} onValueChange={(value) => setMovementForm((current) => ({ ...current, quantity: value }))} /></div></div>
              <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={movementForm.note} onChange={(event) => setMovementForm((current) => ({ ...current, note: event.target.value }))} placeholder="Contoh: dipakai ke lapangan atau stok tambahan supplier." /></div>
              <div className="info-banner" style={{ marginTop: '0.5rem' }}><div className="info-banner-title">Stok Saat Ini</div><div className="info-banner-text">{formatInventoryQuantity(movementItem.currentStockQty || 0)} {movementItem.unit}</div></div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={closeMovementModal} disabled={savingMovement}>Batal</button><button className="btn btn-primary" onClick={handleStockMovement} disabled={savingMovement}><Save size={16} /> {savingMovement ? 'Menyimpan...' : 'Simpan Mutasi'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

