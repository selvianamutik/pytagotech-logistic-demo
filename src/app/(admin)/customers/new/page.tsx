'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { Save } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { FREIGHT_NOTA_BILLING_MODE_OPTIONS } from '@/lib/freight-nota-billing';
import { DEFAULT_PPH23_RATE_PERCENT, PPH23_BASE_MODE_OPTIONS } from '@/lib/pph23';
import type { CustomerBillingRateBasis } from '@/lib/types';
import Combobox from '@/components/Combobox';

export default function CustomerNewPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<{
        name: string;
        address: string;
        contactPerson: string;
        phone: string;
        email: string;
        defaultPaymentTerm: number;
        creditLimitAmount: number;
        npwp: string;
        deliveryOrderPrefix: string;
        defaultFreightNotaBillingMode: CustomerBillingRateBasis;
        defaultPph23Enabled: boolean;
        defaultPph23RatePercent: number;
        defaultPph23BaseMode: 'BEFORE_CLAIM' | 'AFTER_CLAIM';
    }>({
        name: '', address: '', contactPerson: '', phone: '', email: '',
        defaultPaymentTerm: 14, creditLimitAmount: 0, npwp: '', deliveryOrderPrefix: 'SJ', defaultFreightNotaBillingMode: 'PER_KG',
        defaultPph23Enabled: false, defaultPph23RatePercent: DEFAULT_PPH23_RATE_PERCENT, defaultPph23BaseMode: 'BEFORE_CLAIM',
    });

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name || !form.phone) {
            addToast('error', 'Nama dan telepon wajib diisi');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customers', data: { ...form, active: true } }),
            });
            const d = await res.json();
            if (!res.ok) {
                throw new Error(d.error || 'Gagal menambahkan customer');
            }
            addToast('success', 'Customer berhasil ditambahkan');
            router.push(`/customers/${d.data?._id || d.id || ''}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/customers" />
                    <h1 className="page-title">Tambah Customer Baru</h1>
                </div>
            </div>
            <form onSubmit={handleSave}>
                <div className="card" style={{ maxWidth: 640 }}>
                    <div className="card-header"><span className="card-header-title">Informasi Customer</span></div>
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Nama Perusahaan <span className="required">*</span></label>
                            <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="PT..." />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Alamat</label>
                            <textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                        </div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Contact Person</label><input className="form-input" value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Telepon <span className="required">*</span></label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                        </div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })} /></div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Default Payment Term (hari)</label>
                                <FormattedNumberInput allowDecimal={false} value={form.defaultPaymentTerm} onValueChange={value => setForm({ ...form, defaultPaymentTerm: value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Limit Piutang</label>
                                <FormattedNumberInput allowDecimal={false} value={form.creditLimitAmount} onValueChange={value => setForm({ ...form, creditLimitAmount: value })} placeholder="0 = tanpa limit" />
                            </div>
                        </div>
                        <div className="form-group" style={{ maxWidth: 260 }}>
                            <label className="form-label">Awalan Referensi SJ Pengirim</label>
                            <input className="form-input" value={form.deliveryOrderPrefix} onChange={e => setForm({ ...form, deliveryOrderPrefix: e.target.value.toUpperCase() })} placeholder="Contoh: SJ / BK / ARW" />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                Dipakai sebagai awalan referensi nomor SJ dari pengirim, misalnya `{form.deliveryOrderPrefix || 'SJ'}-27032026-001`. Nomor final tetap diinput manual saat membuat surat jalan.
                            </div>
                        </div>
                        <div className="form-group" style={{ maxWidth: 280 }}>
                            <label className="form-label">Default Basis Billing Invoice</label>
                                                        <Combobox
                                value={form.defaultFreightNotaBillingMode}
                                onChange={(v: string) => setForm({ ...form, defaultFreightNotaBillingMode: v as CustomerBillingRateBasis })}
                                options={FREIGHT_NOTA_BILLING_MODE_OPTIONS.map(option => (
                                    { value: option.value, label: option.label }
                                ))}
                                className="form-select"
                            />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                Menentukan default tampilan berat dan basis tarif saat admin membuat invoice customer ini.
                            </div>
                        </div>
                        <div className="card" style={{ marginTop: '1rem', border: '1px solid var(--color-border)' }}>
                            <div className="card-body" style={{ padding: '1rem' }}>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Default PPh 23</label>
                                                                                <Combobox
                                            value={form.defaultPph23Enabled ? 'YA' : 'TIDAK'}
                                            onChange={(v: string) => setForm({
                                                ...form,
                                                defaultPph23Enabled: v === 'YA',
                                                defaultPph23RatePercent: v === 'YA' ? (form.defaultPph23RatePercent || DEFAULT_PPH23_RATE_PERCENT) : DEFAULT_PPH23_RATE_PERCENT,
                                            })}
                                            options={[{ value: "TIDAK", label: "Tidak dipotong" }, { value: "YA", label: "Potong PPh 23" }]}
                                            className="form-select"
                                        />
                                    </div>
                                    <div className="form-group" style={{ maxWidth: 180 }}>
                                        <label className="form-label">Tarif PPh 23 (%)</label>
                                        <FormattedNumberInput
                                            maxFractionDigits={2}
                                            value={form.defaultPph23RatePercent}
                                            onValueChange={value => setForm({ ...form, defaultPph23RatePercent: value })}
                                        />
                                    </div>
                                </div>
                                <div className="form-group" style={{ maxWidth: 260 }}>
                                    <label className="form-label">Basis Hitung Default</label>
                                                                        <Combobox
                                        value={form.defaultPph23BaseMode}
                                        onChange={(v: string) => setForm({ ...form, defaultPph23BaseMode: v as 'BEFORE_CLAIM' | 'AFTER_CLAIM' })}
                                        options={PPH23_BASE_MODE_OPTIONS.map(option => (
                                            { value: option.value, label: option.label }
                                        ))}
                                        className="form-select"
                                    />
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Ini hanya default customer. Admin tetap bisa override lagi di invoice sebelum ada pembayaran.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24, maxWidth: 640 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/customers')}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button>
                </div>
            </form>
        </div>
    );
}
