'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowDownCircle, ArrowUpCircle, CheckCircle2, History, Plus, Save, Trash2, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import Combobox from '@/components/Combobox';
import { getBusinessDateValue } from '@/lib/business-date';
import {
  formatInventoryQuantity,
  isTireTrackedWarehouseItem,
  STOCK_MOVEMENT_SOURCE_LABELS,
} from '@/lib/inventory';
import type { StockMovement, WarehouseItem } from '@/lib/types';
import { formatDate } from '@/lib/utils';

import { useToast } from '../../layout';

type MovementLineForm = {
  rowId: string;
  warehouseItemRef: string;
  quantity: number;
  note: string;
};

type ReviewLine = {
  line: MovementLineForm;
  item: WarehouseItem;
  amount: number;
};

function createLine(): MovementLineForm {
  return { rowId: crypto.randomUUID(), warehouseItemRef: '', quantity: 0, note: '' };
}

type StockMovementBulkModalProps = {
  items: WarehouseItem[];
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

export default function StockMovementBulkModal({ items, canManage, onClose, onSaved }: StockMovementBulkModalProps) {
  const { addToast } = useToast();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<'entry' | 'review'>('entry');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [movementDate, setMovementDate] = useState(getBusinessDateValue());
  const [lines, setLines] = useState<MovementLineForm[]>([createLine()]);

  const activeItems = useMemo(() => items.filter((item) => item.active !== false && !isTireTrackedWarehouseItem(item)), [items]);
  const itemById = useMemo(() => new Map(items.map((item) => [item._id, item])), [items]);

  const validLines = useMemo(
    () => lines.filter((line) => line.warehouseItemRef && Number(line.quantity || 0) > 0),
    [lines],
  );

  const reviewLines = useMemo<ReviewLine[]>(() => {
    return validLines.reduce<ReviewLine[]>((result, line) => {
      const item = itemById.get(line.warehouseItemRef);
      if (!item) return result;
      result.push({
        line,
        item,
        amount: Number(line.quantity || 0) * Number(item.defaultPurchasePrice || 0),
      });
      return result;
    }, []);
  }, [validLines, itemById]);

  const totals = useMemo(() => {
    const totalQty = reviewLines.reduce((sum, review) => sum + review.line.quantity, 0);
    const totalAmount = reviewLines.reduce((sum, review) => sum + review.amount, 0);
    return { totalQty, totalAmount };
  }, [reviewLines]);

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

  useEffect(() => { void loadMovements(); }, [loadMovements]);

  const updateLine = (rowId: string, updates: Partial<MovementLineForm>) => {
    setLines((current) => current.map((line) => line.rowId === rowId ? { ...line, ...updates } : line));
  };

  const addLine = () => setLines((current) => [...current, createLine()]);
  const removeLine = (rowId: string) => setLines((current) => current.length === 1 ? current : current.filter((line) => line.rowId !== rowId));

  const validateEntries = (): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(movementDate)) {
      addToast('error', 'Tanggal mutasi stok tidak valid');
      return false;
    }
    if (validLines.length === 0) {
      addToast('error', 'Isi minimal satu barang mutasi stok');
      return false;
    }
    for (const line of validLines) {
      const item = itemById.get(line.warehouseItemRef);
      if (!item) {
        addToast('error', 'Barang gudang tidak valid');
        return false;
      }
      if (direction === 'OUT' && Number(line.quantity) > Number(item.currentStockQty || 0)) {
        addToast('error', `Stok ${item.itemCode} - ${item.name} tidak cukup`);
        return false;
      }
    }
    return true;
  };

  const handleReview = () => {
    if (!canManage) return addToast('error', 'Anda tidak punya hak mencatat mutasi stok');
    if (!validateEntries()) return;
    setPhase('review');
  };

  const handleConfirmSave = async () => {
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
      onClose();
      await Promise.all([loadMovements(), onSaved()]);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal mencatat mutasi stok');
    } finally {
      setSaving(false);
    }
  };

  const backToEntry = () => {
    if (saving) return;
    setPhase('entry');
  };

  return (
    <div className="modal-overlay" onClick={() => { if (!saving) onClose(); }}>
      <div className="modal modal-lg" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{phase === 'review' ? 'Tinjau Mutasi Barang' : 'Input / Keluar Barang Batch'}</h3>
          <button className="modal-close" onClick={onClose} disabled={saving}><X size={20} /></button>
        </div>
        <div className="modal-body">
          {phase === 'entry' ? (
            <>
              <div className="info-banner" style={{ marginBottom: '1rem' }}>
                <div className="info-banner-title">{direction === 'OUT' ? 'Stok Keluar' : 'Stok Masuk'}</div>
                <div className="info-banner-text">
                  {direction === 'OUT'
                    ? 'Pencatatan pengeluaran/pemakaian barang gudang manual untuk beberapa barang sekaligus. Stok berkurang dan nilainya tercatat sebagai pemakaian.'
                    : 'Penambahan stok gudang manual di luar pembelian supplier untuk beberapa barang sekaligus. Nilai memakai Harga Beli Default barang.'}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Arah Mutasi</label>
                  <div className="segmented-tabs">
                    <button
                      type="button"
                      className={`segmented-tab ${direction === 'IN' ? 'active' : ''}`}
                      onClick={() => setDirection('IN')}
                    >
                      <ArrowDownCircle size={16} /> Stok Masuk
                    </button>
                    <button
                      type="button"
                      className={`segmented-tab ${direction === 'OUT' ? 'active' : ''}`}
                      onClick={() => setDirection('OUT')}
                    >
                      <ArrowUpCircle size={16} /> Stok Keluar
                    </button>
                  </div>
                </div>
                <div className="form-group"><label className="form-label">Tanggal Mutasi</label><input type="date" className="form-input" value={movementDate} onChange={(event) => setMovementDate(event.target.value)} /></div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', margin: '1rem 0 0.5rem' }}>
                <span className="font-semibold">Barang Mutasi</span>
                <button className="btn btn-secondary" type="button" onClick={addLine}><Plus size={16} /> Tambah Baris</button>
              </div>

              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {lines.map((line, index) => {
                  const selectedItem = itemById.get(line.warehouseItemRef);
                  const currentStock = Number(selectedItem?.currentStockQty || 0);
                  const qty = Number(line.quantity || 0);
                  const resultingStock = direction === 'OUT' ? currentStock - qty : currentStock + qty;
                  const insufficient = direction === 'OUT' && Boolean(selectedItem) && qty > currentStock;

                  return (
                    <div key={line.rowId} className="card" style={{ border: '1px solid var(--color-border)' }}>
                      <div className="card-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                          <div className="font-semibold">Baris #{index + 1}</div>
                          {lines.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => removeLine(line.rowId)}><Trash2 size={16} /> Hapus</button>}
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label className="form-label">Barang</label>
                            <Combobox className="form-select" value={line.warehouseItemRef} onChange={(v: string) => updateLine(line.rowId, { warehouseItemRef: v })} placeholder="Pilih barang" options={activeItems.map((item) => ({ value: item._id, label: `${item.itemCode} - ${item.name}` }))} />
                          </div>
                          <div className="form-group"><label className="form-label">Qty</label><FormattedNumberInput min={0} maxFractionDigits={3} allowDecimal value={line.quantity} onValueChange={(value) => updateLine(line.rowId, { quantity: value })} /></div>
                        </div>
                        <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={line.note} onChange={(event) => updateLine(line.rowId, { note: event.target.value })} placeholder="Contoh: dipakai ke lapangan atau stok tambahan supplier." /></div>
                        {selectedItem ? (
                          <div className="text-muted text-xs" style={{ display: 'grid', gap: '0.2rem' }}>
                            <div>Stok saat ini {formatInventoryQuantity(currentStock)} {selectedItem.unit}</div>
                            <div className={insufficient ? 'text-danger' : ''}>{direction === 'OUT' ? 'Stok setelah diproses' : 'Stok setelah diproses (estimasi)'}: {formatInventoryQuantity(resultingStock)} {selectedItem.unit}</div>
                            {insufficient && <div className="text-danger">Stok tidak cukup — kurangi qty atau pilih barang lain.</div>}
                          </div>
                        ) : (
                          <div className="text-muted text-xs">Pilih barang aktif (bukan ban tertracking) pada baris ini.</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="kpi-grid" style={{ marginTop: '1rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Jumlah Baris</div><div className="kpi-value">{lines.length}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Qty</div><div className="kpi-value">{formatInventoryQuantity(totals.totalQty)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Estimasi Nilai</div><div className="kpi-value">{totals.totalAmount.toLocaleString('id-ID')}</div></div></div>
              </div>

              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="card-header"><span className="card-header-title">Riwayat Mutasi Manual Terbaru</span></div>
                <div className="card-body">
                  <div className="table-wrapper">
                    <table>
                      <thead><tr><th>Tanggal</th><th>Jenis</th><th>Barang</th><th>Qty</th><th>Catatan</th></tr></thead>
                      <tbody>
                        {loadingMovements ? [1, 2, 3].map((row) => <tr key={row}>{[1, 2, 3, 4, 5].map((cell) => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>)
                          : movements.length === 0 ? (
                            <tr><td colSpan={5}><div className="empty-state"><History size={40} className="empty-state-icon" /><div className="empty-state-title">Belum ada mutasi manual</div></div></td></tr>
                          ) : movements.slice(0, 5).map((movement) => (
                            <tr key={movement._id}>
                              <td>{formatDate(movement.movementDate)}</td>
                              <td><span className={`badge ${movement.type === 'IN' ? 'badge-success' : 'badge-danger'}`}>{STOCK_MOVEMENT_SOURCE_LABELS[movement.sourceType] || movement.sourceType}</span></td>
                              <td>{movement.itemCode} - {movement.itemName}</td>
                              <td className={movement.type === 'IN' ? 'text-success' : 'text-danger'}>{movement.type === 'IN' ? '+' : '-'}{formatInventoryQuantity(movement.quantity)} {movement.unit || ''}</td>
                              <td>{movement.note || '-'}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="info-banner" style={{ marginBottom: '1rem', background: 'var(--color-warning-light)', borderColor: 'var(--color-warning)' }}>
                <div className="info-banner-title">{direction === 'OUT' ? 'Konfirmasi Stok Keluar' : 'Konfirmasi Stok Masuk'}</div>
                <div className="info-banner-text">
                  Riwayat mutasi tidak dapat diubah setelah disimpan. Periksa kembali tanggal, arah, dan jumlah barang sebelum menekan Konfirmasi Simpan.
                </div>
              </div>

              <div className="card">
                <div className="card-header"><CheckCircle2 size={16} /><span className="card-header-title">Ringkasan Mutasi</span></div>
                <div className="card-body">
                  <div className="form-row" style={{ marginBottom: '0.75rem' }}>
                    <div className="form-group"><label className="form-label">Tanggal</label><div className="font-semibold">{formatDate(movementDate)}</div></div>
                    <div className="form-group"><label className="form-label">Arah</label><div className="font-semibold">{direction === 'OUT' ? 'Stok Keluar' : 'Stok Masuk'}</div></div>
                    <div className="form-group"><label className="form-label">Jumlah Barang</label><div className="font-semibold">{reviewLines.length}</div></div>
                  </div>
                  <div className="table-wrapper">
                    <table>
                      <thead><tr><th>#</th><th>Barang</th><th>Arah</th><th>Qty</th><th>Stok Setelah</th><th>Estimasi Nilai</th><th>Catatan</th></tr></thead>
                      <tbody>
                        {reviewLines.map((review, index) => {
                          const currentStock = Number(review.item.currentStockQty || 0);
                          const resultingStock = direction === 'OUT' ? currentStock - review.line.quantity : currentStock + review.line.quantity;
                          return (
                            <tr key={review.line.rowId}>
                              <td>{index + 1}</td>
                              <td>{review.item.itemCode} - {review.item.name}</td>
                              <td><span className={`badge ${direction === 'OUT' ? 'badge-danger' : 'badge-success'}`}>{direction === 'OUT' ? 'Keluar' : 'Masuk'}</span></td>
                              <td className={direction === 'OUT' ? 'text-danger' : 'text-success'}>{direction === 'OUT' ? '-' : '+'}{formatInventoryQuantity(review.line.quantity)} {review.item.unit}</td>
                              <td>{formatInventoryQuantity(resultingStock)} {review.item.unit}</td>
                              <td>Rp {review.amount.toLocaleString('id-ID')}</td>
                              <td>{review.line.note || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="kpi-grid" style={{ marginTop: '1rem' }}>
                    <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Qty</div><div className="kpi-value">{direction === 'OUT' ? '-' : '+'}{formatInventoryQuantity(totals.totalQty)}</div></div></div>
                    <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Estimasi Nilai</div><div className="kpi-value">Rp {totals.totalAmount.toLocaleString('id-ID')}</div></div></div>
                  </div>
                </div>
              </div>

              <div className="info-banner" style={{ marginTop: '1rem', background: 'var(--color-danger-light)', borderColor: 'var(--color-danger)' }}>
                <div className="info-banner-title"><AlertCircle size={16} /> Perhatian</div>
                <div className="info-banner-text">
                  Setelah dikonfirmasi, mutasi langsung tercatat dan stok barang gudang ikut berubah. Riwayat ini tidak dapat diubah atau dihapus.
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          {phase === 'review' ? (
            <>
              <button className="btn btn-secondary" onClick={backToEntry} disabled={saving}>Kembali</button>
              <button className="btn btn-primary" onClick={handleConfirmSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Konfirmasi Simpan'}</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Batal</button>
              <button className="btn btn-primary" onClick={handleReview} disabled={saving}>Tinjau &amp; Simpan</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}