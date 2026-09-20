'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownCircle, ArrowUpCircle, History, Plus, Save, Trash2 } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
  formatInventoryQuantity,
  isTireTrackedWarehouseItem,
  STOCK_MOVEMENT_SOURCE_LABELS,
} from '@/lib/inventory';
import { hasPermission } from '@/lib/rbac';
import type { StockMovement, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

type MovementLineForm = {
  rowId: string;
  warehouseItemRef: string;
  quantity: number;
  note: string;
};

function createLine(): MovementLineForm {
  return { rowId: crypto.randomUUID(), warehouseItemRef: '', quantity: 0, note: '' };
}

export default function StockMovementsPage() {
  const router = useRouter();
  const { user } = useApp();
  const { addToast } = useToast();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [saving, setSaving] = useState(false);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [movementDate, setMovementDate] = useState(getBusinessDateValue());
  const [lines, setLines] = useState<MovementLineForm[]>([createLine()]);

  const canManage = user ? hasPermission(user, 'warehouseItems', 'create') || hasPermission(user, 'warehouseItems', 'update') : false;
  const activeItems = useMemo(() => items.filter((item) => item.active !== false && !isTireTrackedWarehouseItem(item)), [items]);
  const itemById = useMemo(() => new Map(items.map((item) => [item._id, item])), [items]);

  const totals = useMemo(() => {
    const totalQty = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const totalAmount = lines.reduce((sum, line) => {
      const item = itemById.get(line.warehouseItemRef);
      return sum + (Number(line.quantity || 0) * Number(item?.defaultPurchasePrice || 0));
    }, 0);
    return { totalQty, totalAmount };
  }, [lines, itemById]);

  const loadReferences = useCallback(async () => {
    setLoading(true);
    try {
      const itemRows = await fetchAllAdminCollectionData<WarehouseItem>(
        '/api/data?entity=warehouse-items&pageSize=200',
        'Gagal memuat barang gudang',
        200,
      );
      setItems(itemRows || []);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat barang gudang');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const loadMovements = useCallback(async () => {
    setLoadingMovements(true);
    try {
      const params = new URLSearchParams({
        entity: 'stock-movements',
        filter: JSON.stringify({ sourceType: ['MANUAL_IN', 'MANUAL_OUT'] }),
        sortField: 'movementDate',
        sortDir: 'desc',
        pageSize: '30',
      });
      const res = await fetch(`/api/data?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Gagal memuat riwayat mutasi stok');
      setMovements((payload.data || []) as StockMovement[]);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat riwayat mutasi stok');
    } finally {
      setLoadingMovements(false);
    }
  }, [addToast]);

  useEffect(() => { void loadReferences(); }, [loadReferences]);
  useEffect(() => { void loadMovements(); }, [loadMovements]);

  const updateLine = (rowId: string, updates: Partial<MovementLineForm>) => {
    setLines((current) => current.map((line) => line.rowId === rowId ? { ...line, ...updates } : line));
  };

  const addLine = () => setLines((current) => [...current, createLine()]);
  const removeLine = (rowId: string) => setLines((current) => current.length === 1 ? current : current.filter((line) => line.rowId !== rowId));

  const handleSave = async () => {
    if (!canManage) return addToast('error', 'Anda tidak punya hak mencatat mutasi stok');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(movementDate)) return addToast('error', 'Tanggal mutasi stok tidak valid');
    const validLines = lines.filter((line) => line.warehouseItemRef && Number(line.quantity || 0) > 0);
    if (validLines.length === 0) return addToast('error', 'Isi minimal satu barang mutasi stok');
    for (const line of validLines) {
      const item = itemById.get(line.warehouseItemRef);
      if (!item) return addToast('error', 'Barang gudang tidak valid');
      if (direction === 'OUT' && Number(line.quantity) > Number(item.currentStockQty || 0)) {
        return addToast('error', `Stok ${item.itemCode} - ${item.name} tidak cukup`);
      }
    }
    setSaving(true);
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'stock-movements',
          action: 'create-many',
          data: {
            movementDate,
            direction,
            entries: validLines.map((line) => ({ warehouseItemRef: line.warehouseItemRef, quantity: line.quantity, note: line.note || undefined })),
          },
        }),
      });
      const result = await res.json() as { error?: string; data?: { count?: number } };
      if (!res.ok) throw new Error(result.error || 'Gagal mencatat mutasi stok');
      const count = result.data?.count ?? validLines.length;
      addToast('success', direction === 'OUT' ? `Stok keluar untuk ${count} barang dicatat` : `Stok masuk untuk ${count} barang dicatat`);
      setLines([createLine()]);
      await Promise.all([loadMovements(), loadReferences()]);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal mencatat mutasi stok');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return <div className="card"><div className="card-body">Anda tidak punya akses mencatat mutasi stok manual.</div></div>;
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left"><PageBackButton href="/inventory" /><h1 className="page-title">Input / Pengeluaran Barang</h1></div>
      </div>

      <div className="form-grid" style={{ display: 'grid', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header"><span className="card-header-title">Pengaturan Mutasi</span></div>
          <div className="card-body">
            <div className="form-row">
              <div className="form-group"><label className="form-label">Tanggal Mutasi</label><input type="date" className="form-input" value={movementDate} onChange={(event) => setMovementDate(event.target.value)} /></div>
              <div className="form-group">
                <label className="form-label">Arah Mutasi</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className={`btn ${direction === 'IN' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDirection('IN')}><ArrowDownCircle size={16} /> Stok Masuk</button>
                  <button type="button" className={`btn ${direction === 'OUT' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDirection('OUT')}><ArrowUpCircle size={16} /> Stok Keluar</button>
                </div>
              </div>
            </div>
            <div className="info-banner" style={{ marginBottom: 0 }}>
              <div className="info-banner-title">{direction === 'OUT' ? 'Stok Keluar' : 'Stok Masuk'}</div>
              <div className="info-banner-text">
                {direction === 'OUT'
                  ? 'Pencatatan pengeluaran/pemakaian barang gudang manual. Stok berkurang dan nilainya tercatat sebagai pemakaian.'
                  : 'Penambahan stok gudang manual di luar pembelian supplier. Nilai memakai Harga Beli Default barang.'}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <span className="card-header-title">Barang Mutasi</span>
            <button className="btn btn-secondary" type="button" onClick={addLine}><Plus size={16} /> Tambah Baris</button>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: '1rem' }}>
            {lines.map((line, index) => {
              const selectedItem = itemById.get(line.warehouseItemRef);
              const currentStock = Number(selectedItem?.currentStockQty || 0);
              const qty = Number(line.quantity || 0);
              const resultingStock = direction === 'OUT' ? currentStock - qty : currentStock + qty;
              const insufficient = direction === 'OUT' && Boolean(selectedItem) && qty > currentStock;

              return (
                <div key={line.rowId} className="card" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="card-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                      <div className="font-semibold">Baris #{index + 1}</div>
                      {lines.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => removeLine(line.rowId)}><Trash2 size={16} /> Hapus</button>}
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Barang</label>
                        <select className="form-select" value={line.warehouseItemRef} onChange={(event) => updateLine(line.rowId, { warehouseItemRef: event.target.value })} disabled={loading}><option value="">Pilih barang</option>{activeItems.map((item) => <option key={item._id} value={item._id}>{item.itemCode} - {item.name}</option>)}</select>
                      </div>
                      <div className="form-group"><label className="form-label">Qty</label><FormattedNumberInput min={0} maxFractionDigits={3} allowDecimal value={line.quantity} onValueChange={(value) => updateLine(line.rowId, { quantity: value })} /></div>
                    </div>
                    <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={line.note} onChange={(event) => updateLine(line.rowId, { note: event.target.value })} placeholder="Contoh: dipakai ke lapangan atau stok tambahan supplier." /></div>
                    {selectedItem ? (
                      <div className="text-muted text-xs" style={{ display: 'grid', gap: '0.2rem' }}>
                        <div>Stok saat ini {formatInventoryQuantity(currentStock)} {selectedItem.unit}</div>
                        <div className={insufficient ? 'text-danger' : ''}>Stok setelah diproses: {formatInventoryQuantity(resultingStock)} {selectedItem.unit}</div>
                        {insufficient && <div>Stok tidak cukup — kurangi qty atau pilih barang lain.</div>}
                      </div>
                    ) : (
                      <div className="text-muted text-xs">Pilih barang aktif (bukan ban tertracking) pada baris ini.</div>
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
          <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Estimasi Nilai</div><div className="kpi-value">{formatCurrency(totals.totalAmount)}</div></div></div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
        <button type="button" className="btn btn-secondary" onClick={() => router.push('/inventory/items')}>Batal</button>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Mutasi'}</button>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header"><History size={18} /><span className="card-header-title">Riwayat Mutasi Manual Terbaru</span></div>
        <div className="card-body">
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Tanggal</th><th>Jenis</th><th>Barang</th><th>Qty</th><th>Saldo Setelah</th><th>Catatan</th><th>Oleh</th></tr></thead>
              <tbody>
                {loadingMovements ? [1, 2, 3].map((row) => <tr key={row}>{[1, 2, 3, 4, 5, 6, 7].map((cell) => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>)
                  : movements.length === 0 ? (
                    <tr><td colSpan={7}><div className="empty-state"><History size={40} className="empty-state-icon" /><div className="empty-state-title">Belum ada mutasi manual</div></div></td></tr>
                  ) : movements.map((movement) => (
                    <tr key={movement._id}>
                      <td>{formatDate(movement.movementDate)}</td>
                      <td><span className={`badge ${movement.type === 'IN' ? 'badge-success' : 'badge-danger'}`}>{STOCK_MOVEMENT_SOURCE_LABELS[movement.sourceType] || movement.sourceType}</span></td>
                      <td>{movement.itemCode} - {movement.itemName}</td>
                      <td>{movement.type === 'OUT' ? '-' : '+'}{formatInventoryQuantity(movement.quantity)} {movement.unit || ''}</td>
                      <td>{formatInventoryQuantity(movement.balanceAfter)} {movement.unit || ''}</td>
                      <td>{movement.note || '-'}</td>
                      <td>{movement.createdByName || '-'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}