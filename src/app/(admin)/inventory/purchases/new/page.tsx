'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { addDaysToDateValue, getBusinessDateValue } from '@/lib/business-date';
import {
  formatInventoryQuantity,
  isTireTrackedWarehouseItem,
  WAREHOUSE_ITEM_TRACKING_MODE_LABELS,
} from '@/lib/inventory';
import { hasPermission } from '@/lib/rbac';
import { normalizeTireType } from '@/lib/tire-types';
import type { Supplier, SupplierItemPrice, WarehouseItem } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

import { useApp, useToast } from '../../../layout';

type PurchaseLineForm = {
  rowId: string;
  warehouseItemRef: string;
  supplierItemPriceRef: string;
  orderedQty: number;
  unitPrice: number;
  notes: string;
};

function createLine(): PurchaseLineForm {
  return { rowId: crypto.randomUUID(), warehouseItemRef: '', supplierItemPriceRef: '', orderedQty: 0, unitPrice: 0, notes: '' };
}

export default function PurchaseNewPage() {
  const router = useRouter();
  const { user } = useApp();
  const { addToast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [supplierItemPrices, setSupplierItemPrices] = useState<SupplierItemPrice[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [supplierRef, setSupplierRef] = useState('');
  const [orderDate, setOrderDate] = useState(getBusinessDateValue());
  const [dueDate, setDueDate] = useState(getBusinessDateValue());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseLineForm[]>([createLine()]);

  const canCreatePurchase = user ? hasPermission(user, 'purchases', 'create') : false;
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.active !== false), [suppliers]);
  const activeItems = useMemo(() => items.filter((item) => item.active !== false), [items]);
  const selectedSupplier = useMemo(() => activeSuppliers.find((supplier) => supplier._id === supplierRef) || null, [activeSuppliers, supplierRef]);
  const activeSupplierPrices = useMemo(
    () => supplierItemPrices.filter((price) => price.supplierRef === supplierRef && (price.active !== false || Boolean(price.effectiveTo))),
    [supplierItemPrices, supplierRef],
  );
  const supplierPricesByItem = useMemo(() => {
    const map = new Map<string, SupplierItemPrice>();
    activeSupplierPrices.forEach((price) => {
      if (!price.warehouseItemRef) return;
      const effectiveFrom = typeof price.effectiveFrom === 'string' ? price.effectiveFrom.slice(0, 10) : '';
      const effectiveTo = typeof price.effectiveTo === 'string' ? price.effectiveTo.slice(0, 10) : '';
      if (effectiveFrom && effectiveFrom > orderDate) return;
      if (effectiveTo && effectiveTo < orderDate) return;
      const current = map.get(price.warehouseItemRef);
      const currentEffectiveFrom = typeof current?.effectiveFrom === 'string' ? current.effectiveFrom.slice(0, 10) : '';
      if (
        !current ||
        effectiveFrom > currentEffectiveFrom ||
        (effectiveFrom === currentEffectiveFrom && price.active !== false && current.active === false)
      ) {
        map.set(price.warehouseItemRef, price);
      }
    });
    return map;
  }, [activeSupplierPrices, orderDate]);
  const supplierPriceHistoryByItem = useMemo(() => {
    const map = new Map<string, SupplierItemPrice[]>();
    supplierItemPrices
      .filter((price) => price.supplierRef === supplierRef)
      .forEach((price) => {
        if (!price.warehouseItemRef) return;
        map.set(price.warehouseItemRef, [...(map.get(price.warehouseItemRef) || []), price]);
      });
    return map;
  }, [supplierItemPrices, supplierRef]);
  const totals = useMemo(() => {
    const totalQty = lines.reduce((sum, line) => sum + Number(line.orderedQty || 0), 0);
    const totalAmount = lines.reduce((sum, line) => sum + (Number(line.orderedQty || 0) * Number(line.unitPrice || 0)), 0);
    return { totalQty, totalAmount };
  }, [lines]);

  useEffect(() => {
    async function loadReferences() {
      setLoading(true);
      try {
        const [supplierRows, itemRows, supplierPriceRows] = await Promise.all([
          fetchAllAdminCollectionData<Supplier>('/api/data?entity=suppliers&pageSize=200', 'Gagal memuat supplier', 200),
          fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&pageSize=200', 'Gagal memuat barang gudang', 200),
          fetchAllAdminCollectionData<SupplierItemPrice>('/api/data?entity=supplier-item-prices&pageSize=1000', 'Gagal memuat harga barang supplier', 1000),
        ]);
        setSuppliers(supplierRows || []);
        setItems(itemRows || []);
        setSupplierItemPrices(supplierPriceRows || []);
        const firstSupplier = (supplierRows || []).find((supplier) => supplier.active !== false);
        if (firstSupplier) {
          setSupplierRef(firstSupplier._id);
        }
      } catch (error) {
        addToast('error', error instanceof Error ? error.message : 'Gagal memuat referensi pembelian');
      } finally {
        setLoading(false);
      }
    }
    void loadReferences();
  }, [addToast]);

  useEffect(() => {
    if (selectedSupplier) {
      setDueDate(addDaysToDateValue(orderDate, Number(selectedSupplier.defaultTermDays || 14)));
    }
  }, [orderDate, selectedSupplier]);

  const updateLine = (rowId: string, updates: Partial<PurchaseLineForm>) => {
    setLines((current) => current.map((line) => line.rowId === rowId ? { ...line, ...updates } : line));
  };

  const addLine = () => setLines((current) => [...current, createLine()]);
  const removeLine = (rowId: string) => setLines((current) => current.length === 1 ? current : current.filter((line) => line.rowId !== rowId));

  const getDefaultLinePrice = (warehouseItemRef: string) => {
    const selectedItem = activeItems.find((item) => item._id === warehouseItemRef);
    const supplierPrice = supplierPricesByItem.get(warehouseItemRef);
    const hasSupplierPriceHistory = supplierPriceHistoryByItem.has(warehouseItemRef);
    return {
      unitPrice: supplierPrice?.defaultPurchasePrice || (!hasSupplierPriceHistory ? selectedItem?.defaultPurchasePrice || 0 : 0),
      supplierItemPriceRef: supplierPrice?._id || '',
    };
  };

  const handleItemChange = (rowId: string, warehouseItemRef: string) => {
    updateLine(rowId, { warehouseItemRef, ...getDefaultLinePrice(warehouseItemRef) });
  };

  useEffect(() => {
    setLines((current) => current.map((line) => {
      if (!line.warehouseItemRef) return line;
      return { ...line, ...getDefaultLinePrice(line.warehouseItemRef) };
    }));
    // Reprice selected lines only when supplier/date references change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierRef, supplierPricesByItem, supplierPriceHistoryByItem]);

  const handleSave = async () => {
    if (!canCreatePurchase) return addToast('error', 'Anda tidak punya hak membuat pembelian');
    const validLines = lines.filter((line) => line.warehouseItemRef && Number(line.orderedQty || 0) > 0);
    if (!supplierRef) return addToast('error', 'Supplier wajib dipilih');
    if (validLines.length === 0) return addToast('error', 'Isi minimal satu barang pembelian');
    if (validLines.some((line) => Number(line.unitPrice || 0) <= 0)) {
      return addToast('error', 'Harga per satuan wajib diisi lebih dari 0');
    }
    setSaving(true);
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'purchases',
          action: 'create-with-items',
          data: {
            supplierRef,
            orderDate,
            dueDate,
            notes: notes || undefined,
            items: validLines.map((line) => ({
              warehouseItemRef: line.warehouseItemRef,
              supplierItemPriceRef: line.supplierItemPriceRef || undefined,
              orderedQty: line.orderedQty,
              unitPrice: line.unitPrice,
              notes: line.notes || undefined,
            })),
          },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal membuat pembelian');
      addToast('success', 'Pembelian supplier berhasil dibuat');
      router.push(`/inventory/purchases/${result.id || result.data?._id}`);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal membuat pembelian');
    } finally {
      setSaving(false);
    }
  };

  if (!canCreatePurchase) {
    return <div className="card"><div className="card-body">Anda tidak punya akses membuat pembelian supplier.</div></div>;
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left"><PageBackButton href="/inventory/purchases" /><h1 className="page-title">Buat Pembelian</h1></div>
      </div>

      <div className="form-grid" style={{ display: 'grid', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header"><span className="card-header-title">Header Pembelian</span></div>
          <div className="card-body">
            <div className="form-row">
              <div className="form-group"><label className="form-label">Supplier</label><select className="form-select" value={supplierRef} onChange={(event) => setSupplierRef(event.target.value)} disabled={loading}><option value="">Pilih supplier</option>{activeSuppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.supplierCode} - {supplier.name}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Tanggal Pembelian</label><input type="date" className="form-input" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Jatuh Tempo</label><input type="date" className="form-input" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
              <div className="form-group"><label className="form-label">Termin Supplier</label><input className="form-input" value={selectedSupplier ? `${selectedSupplier.defaultTermDays || 0} hari` : '-'} readOnly /></div>
            </div>
            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan pembelian, nomor penawaran, atau instruksi supplier." /></div>
          </div>
        </div>

        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <span className="card-header-title">Barang Pembelian</span>
            <button className="btn btn-secondary" type="button" onClick={addLine}><Plus size={16} /> Tambah Baris</button>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: '1rem' }}>
            {lines.map((line, index) => {
              const selectedItem = activeItems.find((item) => item._id === line.warehouseItemRef);
              const selectedSupplierPrice = line.supplierItemPriceRef ? supplierItemPrices.find((price) => price._id === line.supplierItemPriceRef) : null;
              const hasSupplierPriceHistory = line.warehouseItemRef ? supplierPriceHistoryByItem.has(line.warehouseItemRef) : false;
              const isTrackedTireItem = isTireTrackedWarehouseItem(selectedItem);
              const lineSubtotal = Number(line.orderedQty || 0) * Number(line.unitPrice || 0);
              const priceHelpText = selectedSupplierPrice
                ? `Harga dari supplier ${selectedSupplier?.name || ''}: ${formatCurrency(Number(selectedSupplierPrice.defaultPurchasePrice || 0))}`
                : hasSupplierPriceHistory
                  ? 'Belum ada harga supplier yang berlaku di tanggal pembelian ini. Isi harga manual atau ubah masa berlaku harga di Supplier.'
                  : selectedItem && Number(selectedItem.defaultPurchasePrice || 0) > 0
                    ? `Belum ada harga supplier. Sementara memakai harga default barang: ${formatCurrency(Number(selectedItem.defaultPurchasePrice || 0))}`
                    : 'Isi harga manual untuk barang ini.';
              return (
                <div key={line.rowId} className="card" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="card-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                      <div className="font-semibold">Baris #{index + 1}</div>
                      {lines.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => removeLine(line.rowId)}><Trash2 size={16} /> Hapus</button>}
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label className="form-label">Barang</label><select className="form-select" value={line.warehouseItemRef} onChange={(event) => handleItemChange(line.rowId, event.target.value)}><option value="">Pilih barang</option>{activeItems.map((item) => <option key={item._id} value={item._id}>{item.itemCode} - {item.name}</option>)}</select></div>
                      <div className="form-group"><label className="form-label">Jumlah Dibeli</label><FormattedNumberInput min={0} maxFractionDigits={isTrackedTireItem ? 0 : 3} allowDecimal={!isTrackedTireItem} value={line.orderedQty} onValueChange={(value) => updateLine(line.rowId, { orderedQty: value })} /></div>
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label className="form-label">Harga per Satuan (Rp)</label><FormattedNumberInput allowDecimal={false} value={line.unitPrice} onValueChange={(value) => updateLine(line.rowId, { unitPrice: value })} placeholder="Ketik harga satuan" /></div>
                      <div className="form-group"><label className="form-label">Subtotal</label><input className="form-input" value={lineSubtotal > 0 ? formatCurrency(lineSubtotal) : '-'} readOnly /></div>
                    </div>
                    <div className="form-group"><label className="form-label">Catatan Barang</label><textarea className="form-textarea" rows={2} value={line.notes} onChange={(event) => updateLine(line.rowId, { notes: event.target.value })} /></div>
                    {selectedItem && (
                      <div className="text-muted text-xs" style={{ display: 'grid', gap: '0.2rem' }}>
                        <div>Satuan {selectedItem.unit} | Stok saat ini {formatInventoryQuantity(selectedItem.currentStockQty || 0)} {selectedItem.unit}</div>
                        <div>{priceHelpText}</div>
                        <div>Cara stok: {WAREHOUSE_ITEM_TRACKING_MODE_LABELS[selectedItem.trackingMode || 'STANDARD']}</div>
                        {isTrackedTireItem && (
                          <div>
                            Saat barang diterima, sistem otomatis membuat kartu ban per unit dengan {selectedItem.tireBrandDefault || '-'} | {selectedItem.tireSizeDefault || '-'} | {normalizeTireType(selectedItem.tireTypeDefault)}.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Jumlah Baris</div><div className="kpi-value">{lines.length}</div></div></div>
          <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Qty</div><div className="kpi-value">{formatInventoryQuantity(totals.totalQty)}</div></div></div>
          <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Pembelian</div><div className="kpi-value">{formatCurrency(totals.totalAmount)}</div></div></div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
        <button type="button" className="btn btn-secondary" onClick={() => router.push('/inventory/purchases')}>Batal</button>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Pembelian'}</button>
      </div>
    </div>
  );
}
