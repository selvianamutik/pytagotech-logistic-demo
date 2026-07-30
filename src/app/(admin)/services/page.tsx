'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp, useToast } from '../layout';
import { AlertTriangle, Edit, Layers, Plus, Save, Trash2, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { Service, TireAxleLayoutMode, TireLayoutConfig } from '@/lib/types';
import { hasPermission } from '@/lib/rbac';
import {
    buildDefaultTireLayoutConfig,
    buildTireSlotCodesFromLayoutConfig,
    formatTireSlotLabel,
    normalizeTireLayoutConfig,
    TIRE_AXLE_LAYOUT_OPTIONS,
} from '@/lib/tire-slots';

type ServiceFormState = {
    code: string;
    name: string;
    description: string;
    maxPayloadKg: number;
    oilMaintenanceKm: number;
    active: boolean;
    tireLayoutConfig: TireLayoutConfig;
};

function summarizeTireLayout(config: TireLayoutConfig) {
    const normalized = normalizeTireLayoutConfig(config);
    const singleAxleCount = normalized.axleLayouts.filter(layout => layout === 'SINGLE').length;
    const dualAxleCount = normalized.axleLayouts.filter(layout => layout === 'DUAL').length;
    const labels = [];
    if (singleAxleCount > 0) labels.push(`${singleAxleCount} as single`);
    if (dualAxleCount > 0) labels.push(`${dualAxleCount} as ganda`);
    labels.push(`${normalized.spareCount} slot serep`);
    return labels.join(' | ');
}

function updateAxleLayout(
    config: TireLayoutConfig,
    axleIndex: number,
    nextValue: TireAxleLayoutMode
) {
    return {
        ...config,
        axleLayouts: config.axleLayouts.map((item, index) => index === axleIndex ? nextValue : item) as TireAxleLayoutMode[],
    };
}

const createDefaultServiceForm = (seed?: Partial<Pick<Service, 'code' | 'name' | 'description' | 'maxPayloadKg' | 'oilMaintenanceKm' | 'active' | 'tireLayoutConfig'>>) => ({
    code: seed?.code || '',
    name: seed?.name || '',
    description: seed?.description || '',
    maxPayloadKg: seed?.maxPayloadKg || 0,
    oilMaintenanceKm: seed?.oilMaintenanceKm || 0,
    active: seed?.active !== false,
    tireLayoutConfig: normalizeTireLayoutConfig(seed?.tireLayoutConfig, buildDefaultTireLayoutConfig(undefined, seed?.name || '')),
});

export default function ServicesPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [inactiveCount, setInactiveCount] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState<Service | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [pendingAxleDeleteIndex, setPendingAxleDeleteIndex] = useState<number | null>(null);
    const [form, setForm] = useState<ServiceFormState>(createDefaultServiceForm());
    const isOwner = user ? hasPermission(user, 'services', 'update') : false;
    const activeCount = totalItems - inactiveCount;
    const layoutPreview = useMemo(
        () => buildTireSlotCodesFromLayoutConfig(form.tireLayoutConfig),
        [form.tireLayoutConfig]
    );

    const loadServices = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, inactiveRes] = await Promise.all([
                fetch(`/api/data?entity=services&page=${page}&pageSize=${DEFAULT_PAGE_SIZE}&sortField=code&sortDir=asc`),
                fetch(`/api/data?entity=services&countOnly=1&filter=${encodeURIComponent(JSON.stringify({ active: false }))}`),
            ]);

            const [listPayload, inactivePayload] = await Promise.all([listRes.json(), inactiveRes.json()]);

            if (!listRes.ok) {
                throw new Error(listPayload.error || 'Gagal memuat kategori armada');
            }
            if (!inactiveRes.ok) {
                throw new Error(inactivePayload.error || 'Gagal memuat statistik kategori armada');
            }

            setItems(listPayload.data || []);
            setTotalItems(listPayload.meta?.total || 0);
            setInactiveCount(inactivePayload.meta?.total || 0);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat kategori armada');
        } finally {
            setLoading(false);
        }
    }, [addToast, page]);

    useEffect(() => {
        void loadServices();
    }, [loadServices]);

    const openNew = () => {
        setEditItem(null);
        setForm(createDefaultServiceForm());
        setPendingAxleDeleteIndex(null);
        setShowModal(true);
    };
    const openEdit = (s: Service) => {
        setEditItem(s);
        setForm(createDefaultServiceForm(s));
        setPendingAxleDeleteIndex(null);
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!isOwner) { addToast('error', 'Hanya OWNER yang dapat mengubah kategori armada'); return; }
        if (!form.code || !form.name) { addToast('error', 'Kode dan nama kategori wajib'); return; }
        setSaving(true);
        try {
            if (editItem) {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'services', action: 'update', data: { id: editItem._id, updates: form } }) });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal memperbarui kategori armada');
                    return;
                }
                await loadServices();
                addToast('success', 'Kategori armada diperbarui');
            } else {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'services', data: form }) });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal menambah kategori armada');
                    return;
                }
                if (page !== 1) {
                    setPage(1);
                } else {
                    await loadServices();
                }
                addToast('success', 'Kategori armada ditambahkan');
            }
            setPendingAxleDeleteIndex(null);
            setShowModal(false);
        } catch {
            addToast('error', editItem ? 'Gagal memperbarui kategori armada' : 'Gagal menambah kategori armada');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!isOwner) { addToast('error', 'Hanya OWNER yang dapat menghapus kategori armada'); return; }
        setDeletingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'services', action: 'delete', data: { id } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menghapus kategori armada');
                setDeleteId(null);
                return;
            }
            if (page > 1 && items.length === 1) {
                setPage(current => Math.max(1, current - 1));
            } else {
                await loadServices();
            }
            setDeleteId(null);
            addToast('success', 'Kategori armada dihapus');
        } catch {
            addToast('error', 'Gagal menghapus kategori armada');
            setDeleteId(null);
        } finally {
            setDeletingId(current => current === id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Kategori Truk / Armada</h1></div>
                <div className="page-actions">{isOwner && <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Kategori</button>}</div></div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Aktif</div><div className="kpi-value">{activeCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Nonaktif</div><div className="kpi-value">{inactiveCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hak Ubah</div><div className="kpi-value">{isOwner ? 'OWNER' : 'Lihat saja'}</div></div></div>
            </div>
            <div className="table-container"><div className="table-wrapper"><table>
                <thead><tr><th>Kode</th><th>Nama</th><th>Deskripsi</th><th>Batas Muatan</th><th>Servis Oli</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                        totalItems === 0 ? <tr><td colSpan={7}><div className="empty-state"><Layers size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kategori armada</div></div></td></tr> :
                            items.map(s => (
                                <tr key={s._id}><td className="font-mono">{s.code}</td><td className="font-semibold">{s.name}<div className="text-muted text-sm">{summarizeTireLayout(normalizeTireLayoutConfig(s.tireLayoutConfig, buildDefaultTireLayoutConfig(undefined, s.name)))}</div></td><td className="text-muted">{s.description}</td>
                                    <td className="text-muted">
                                        <div>{s.maxPayloadKg ? `${s.maxPayloadKg.toLocaleString('id-ID')} kg` : 'Tanpa batas'}</div>
                                    </td>
                                    <td className="text-muted">{s.oilMaintenanceKm ? `${s.oilMaintenanceKm.toLocaleString('id-ID')} km` : '-'}</td>
                                    <td><span className={`badge ${s.active !== false ? 'badge-success' : 'badge-gray'}`}>{s.active !== false ? 'Aktif' : 'Non-Aktif'}</span></td>
                                    <td>{isOwner ? <div className="table-actions"><button className="table-action-btn" onClick={() => openEdit(s)}><Edit size={14} /> Edit</button><button className="table-action-btn danger" onClick={() => setDeleteId(s._id)}><Trash2 size={14} /> Hapus</button></div> : <span className="text-muted">Lihat saja</span>}</td></tr>
                            ))}
                </tbody>
            </table></div>
                {totalItems > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} kategori armada</>
                        )}
                    />
                )}
            </div>
            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) { setPendingAxleDeleteIndex(null); setShowModal(false); } }}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Kategori Armada</h3><button className="modal-close" onClick={() => { setPendingAxleDeleteIndex(null); setShowModal(false); }} disabled={saving}><X size={20} /></button></div>
                    <div className="modal-body">
                        <div className="form-group">
                            <label className="form-label">Kode Kategori</label>
                            <input className="form-input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Contoh: CDD / FUS / CDB" />
                        </div>
                        <div className="form-group"><label className="form-label">Nama Kategori</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Contoh: CDD Box / Fuso / Tronton" /></div>
                        <div className="form-group"><label className="form-label">Deskripsi</label><textarea className="form-textarea" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Digunakan untuk memfilter kendaraan saat membuat surat jalan" /></div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Batas Muatan Normal (kg)</label>
                                <FormattedNumberInput allowDecimal={false} value={form.maxPayloadKg} onValueChange={value => setForm({ ...form, maxPayloadKg: value })} />
                                <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                    Rate tambahan overtonase diambil dari Biaya Rute Trip.
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Interval Servis Oli (km)</label>
                                <FormattedNumberInput allowDecimal={false} value={form.oilMaintenanceKm} onValueChange={value => setForm({ ...form, oilMaintenanceKm: value })} />
                                <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                    Dipakai untuk menjadwalkan maintenance otomatis saat trip ditutup.
                                </div>
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Susunan Slot Ban</label>
                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                <div style={{ background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', borderRadius: '0.85rem', padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                    Tambahkan as sesuai kebutuhan kategori armada. User cukup mengatur pasangan roda per as, lalu sistem otomatis membentuk slot kiri, kanan, inner, outer, dan serep tanpa perlu hafal kode teknis.
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>Daftar As</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                            Tambah as sesuai kebutuhan unit. Nomor slot akan mengikuti urutan dari depan ke belakang.
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setForm(previous => ({
                                            ...previous,
                                            tireLayoutConfig: {
                                                ...previous.tireLayoutConfig,
                                                axleLayouts: [...previous.tireLayoutConfig.axleLayouts, 'SINGLE'],
                                            },
                                        }))}
                                    >
                                        <Plus size={14} /> Tambah As
                                    </button>
                                </div>
                                {form.tireLayoutConfig.axleLayouts.map((layoutValue, index) => {
                                    const axleNumber = index + 1;
                                    const axlePreview = buildTireSlotCodesFromLayoutConfig({
                                        axleLayouts: [layoutValue],
                                        spareCount: 0,
                                    }).roadSlots;
                                    const canRemoveAxle = form.tireLayoutConfig.axleLayouts.length > 2;
                                    const isDeleteConfirming = pendingAxleDeleteIndex === index;
                                    return (
                                        <div key={axleNumber} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.85rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.55rem', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>As {axleNumber}</div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                        {axlePreview.length > 0
                                                            ? axlePreview.map(slotCode => `${slotCode} (${formatTireSlotLabel(slotCode)})`).join(' | ')
                                                            : 'As ini tidak memiliki slot aktif.'}
                                                    </div>
                                                </div>
                                                {canRemoveAxle && (
                                                    <button
                                                        type="button"
                                                        className={`btn btn-sm ${isDeleteConfirming ? 'btn-danger' : 'btn-secondary'}`}
                                                        onClick={() => {
                                                            setPendingAxleDeleteIndex(index);
                                                        }}
                                                    >
                                                        <Trash2 size={14} /> {isDeleteConfirming ? 'Konfirmasi Di Bawah' : 'Hapus As'}
                                                    </button>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {TIRE_AXLE_LAYOUT_OPTIONS.map(option => (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        className={`btn ${layoutValue === option.value ? 'btn-primary' : 'btn-secondary'}`}
                                                        style={{ minWidth: 120 }}
                                                        onClick={() => setForm(previous => ({
                                                            ...previous,
                                                            tireLayoutConfig: updateAxleLayout(previous.tireLayoutConfig, index, option.value),
                                                        }))}
                                                    >
                                                        {option.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
                                                {TIRE_AXLE_LAYOUT_OPTIONS.find(option => option.value === layoutValue)?.description}
                                            </div>
                                            {isDeleteConfirming && (
                                                <div style={{ marginTop: '0.75rem', padding: '0.75rem 0.85rem', borderRadius: '0.75rem', border: '1px solid #fecaca', background: '#fef2f2', display: 'grid', gap: '0.65rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', color: '#991b1b', fontSize: '0.78rem' }}>
                                                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                                                        <div>
                                                            As {axleNumber} akan dihapus, dan nomor as setelahnya akan ikut bergeser.
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <button
                                                            type="button"
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => setPendingAxleDeleteIndex(null)}
                                                        >
                                                            Batal
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn btn-danger btn-sm"
                                                            onClick={() => {
                                                                setForm(previous => ({
                                                                    ...previous,
                                                                    tireLayoutConfig: {
                                                                        ...previous.tireLayoutConfig,
                                                                        axleLayouts: previous.tireLayoutConfig.axleLayouts.filter((_, itemIndex) => itemIndex !== index),
                                                                    },
                                                                }));
                                                                setPendingAxleDeleteIndex(null);
                                                            }}
                                                        >
                                                            Konfirmasi Hapus
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.85rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div style={{ fontWeight: 600, marginBottom: '0.55rem' }}>Slot Serep</div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        {[0, 1, 2, 3, 4, 5].map(count => (
                                            <button
                                                key={count}
                                                type="button"
                                                className={`btn ${form.tireLayoutConfig.spareCount === count ? 'btn-primary' : 'btn-secondary'}`}
                                                onClick={() => setForm(previous => ({
                                                    ...previous,
                                                    tireLayoutConfig: {
                                                        ...previous.tireLayoutConfig,
                                                        spareCount: count,
                                                    },
                                                }))}
                                            >
                                                {count} serep
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
                                        Tambahkan slot serep hanya bila kategori unit ini memang punya tempat ban cadangan.
                                    </div>
                                </div>
                                <div style={{ border: '1px solid var(--color-primary)', borderRadius: '0.85rem', padding: '0.95rem 1rem', background: 'var(--color-primary-soft)' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Preview Slot Otomatis</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.55rem' }}>
                                        Kendaraan yang memakai kategori ini akan menampilkan slot berikut di modul ban.
                                    </div>
                                    <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                                        {layoutPreview.allSlots.map(slotCode => (
                                            <div key={slotCode}>
                                                <span className="font-mono">{slotCode}</span> - {formatTireSlotLabel(slotCode)}
                                            </div>
                                        ))}
                                        {layoutPreview.allSlots.length === 0 && <div className="text-muted">Belum ada slot aktif pada kategori ini.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="form-group"><label className="form-checkbox"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktif</label></div>
                    </div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                </div></div>
            )}
            {isOwner && deleteId && (
                <div className="modal-overlay" onClick={() => { if (deletingId !== deleteId) setDeleteId(null); }}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">Hapus Kategori Armada?</h3></div>
                    <div className="modal-body"><p>Kategori armada akan dihapus permanen. Jika sudah dipakai kendaraan atau biaya rute trip, sistem akan menolak penghapusan ini.</p></div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>Batal</button><button className="btn btn-danger" onClick={() => handleDelete(deleteId)} disabled={deletingId === deleteId}><Trash2 size={16} /> {deletingId === deleteId ? 'Menghapus...' : 'Hapus'}</button></div>
                </div></div>
            )}
        </div>
    );
}
