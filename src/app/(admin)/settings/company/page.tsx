'use client';

import { useState, useEffect, type ChangeEvent } from 'react';
import { useToast } from '../../layout';
import { Save } from 'lucide-react';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { DEFAULT_PRIMARY_THEME_COLOR, DEFAULT_SECONDARY_THEME_COLOR, applyCompanyThemeColors, isThemeHexColor } from '@/lib/theme';
import type { BankAccount, CompanyProfile } from '@/lib/types';

export default function CompanyPage() {
    const { addToast } = useToast();
    const [data, setData] = useState<CompanyProfile | null>(null);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const loadCompany = async () => {
            try {
                const [res, accountRows] = await Promise.all([
                    fetch('/api/data?entity=company'),
                    fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat rekening invoice'),
                ]);
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat pengaturan perusahaan');
                }

                const profile = payload.data || {};
                profile.numberingSettings = profile.numberingSettings || { resiPrefix: 'R-', resiCounter: 0, doPrefix: 'DO-', doCounter: 0, invoicePrefix: 'INV-', invoiceCounter: 0, notaPrefix: 'INV-', notaCounter: 0, notaSeriesCode: '3', receiptPrefix: 'RCV-', receiptCounter: 0, boronganPrefix: 'BRG-', boronganCounter: 0, bonPrefix: 'BON-', bonCounter: 0, incidentPrefix: 'INC-', incidentCounter: 0 };
                profile.numberingSettings.notaSeriesCode = profile.numberingSettings.notaSeriesCode || '3';
                profile.themeColor = isThemeHexColor(profile.themeColor) ? profile.themeColor : DEFAULT_PRIMARY_THEME_COLOR;
                profile.secondaryThemeColor = isThemeHexColor(profile.secondaryThemeColor) ? profile.secondaryThemeColor : DEFAULT_SECONDARY_THEME_COLOR;
                const eligibleBankAccounts = (accountRows || []).filter(account => account.active !== false && account.accountType !== 'CASH');
                const eligibleBankRefSet = new Set(eligibleBankAccounts.map(account => account._id));
                profile.invoiceSettings = profile.invoiceSettings || { defaultTermDays: 30, dueDateDays: 14, footerNote: '', invoiceMode: 'ORDER', invoiceBankAccountRefs: [], defaultInvoiceBankAccountRef: undefined };
                profile.invoiceSettings.invoiceBankAccountRefs = Array.isArray(profile.invoiceSettings.invoiceBankAccountRefs)
                    ? profile.invoiceSettings.invoiceBankAccountRefs.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && eligibleBankRefSet.has(value))
                    : [];
                profile.invoiceSettings.defaultInvoiceBankAccountRef =
                    typeof profile.invoiceSettings.defaultInvoiceBankAccountRef === 'string' && profile.invoiceSettings.invoiceBankAccountRefs.includes(profile.invoiceSettings.defaultInvoiceBankAccountRef)
                        ? profile.invoiceSettings.defaultInvoiceBankAccountRef
                        : profile.invoiceSettings.invoiceBankAccountRefs[0];
                profile.documentSettings = profile.documentSettings || { showContact: true, dateFormat: 'DD/MM/YYYY' };
                setData(profile);
                setBankAccounts(eligibleBankAccounts);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat pengaturan perusahaan');
            } finally {
                setLoading(false);
            }
        };

        void loadCompany();
    }, [addToast]);

    const handleSave = async () => {
        if (!data) return;
        setSaving(true);
        try {
            const invoiceBankAccountRefs = Array.from(new Set(
                (data.invoiceSettings?.invoiceBankAccountRefs || []).filter((value): value is string =>
                    typeof value === 'string' &&
                    value.trim().length > 0 &&
                    bankAccounts.some(account => account._id === value)
                )
            ));
            const defaultInvoiceBankAccountRef = invoiceBankAccountRefs.includes(data.invoiceSettings?.defaultInvoiceBankAccountRef || '')
                ? data.invoiceSettings?.defaultInvoiceBankAccountRef
                : invoiceBankAccountRefs[0];
            const payloadData: CompanyProfile = {
                ...data,
                invoiceSettings: {
                    ...data.invoiceSettings,
                    invoiceBankAccountRefs,
                    defaultInvoiceBankAccountRef,
                },
            };
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'company', data: payloadData }) });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal menyimpan pengaturan perusahaan');
            }
            setData(payload.data || payloadData);
            addToast('success', 'Pengaturan perusahaan disimpan');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan');
        } finally {
            setSaving(false);
        }
    };

    const u = (field: string, value: unknown) => setData(prev => prev ? { ...prev, [field]: value } : prev);
    const uNum = (field: string, value: unknown) => setData(prev => prev ? { ...prev, numberingSettings: { ...(prev.numberingSettings || {}), [field]: value } } as CompanyProfile : prev);
    const uInvoice = (field: string, value: unknown) => setData(prev => prev ? { ...prev, invoiceSettings: { ...(prev.invoiceSettings || {}), [field]: value } } as CompanyProfile : prev);
    const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) {
            return;
        }

        const clearInput = () => {
            input.value = '';
        };

        if (file.size > 500 * 1024) {
            addToast('error', 'Ukuran file logo maksimal 500KB');
            clearInput();
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            u('logoUrl', reader.result as string);
            addToast('success', 'Logo siap disimpan');
            clearInput();
        };
        reader.onerror = () => {
            addToast('error', 'Gagal membaca file logo');
            clearInput();
        };
        reader.readAsDataURL(file);
    };

    const toggleInvoiceBankAccount = (accountId: string) => setData(prev => {
        if (!prev) return prev;

        const selectedRefs = Array.isArray(prev.invoiceSettings?.invoiceBankAccountRefs)
            ? prev.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            : [];
        const isSelected = selectedRefs.includes(accountId);
        const nextRefs = isSelected
            ? selectedRefs.filter(ref => ref !== accountId)
            : [...selectedRefs, accountId];
        const defaultRef = nextRefs.includes(prev.invoiceSettings?.defaultInvoiceBankAccountRef || '')
            ? prev.invoiceSettings?.defaultInvoiceBankAccountRef
            : nextRefs[0];

        return {
            ...prev,
            invoiceSettings: {
                ...prev.invoiceSettings,
                invoiceBankAccountRefs: nextRefs,
                defaultInvoiceBankAccountRef: defaultRef,
            },
        };
    });

    const previewTheme = (field: 'themeColor' | 'secondaryThemeColor', hex: string) => {
        u(field, hex);
        if (!isThemeHexColor(hex)) return;
        applyCompanyThemeColors(
            document.documentElement,
            field === 'themeColor' ? hex : data?.themeColor,
            field === 'secondaryThemeColor' ? hex : data?.secondaryThemeColor,
        );
    };

    if (loading || !data) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    const invoiceBankAccountRefs = Array.isArray(data.invoiceSettings?.invoiceBankAccountRefs) ? data.invoiceSettings.invoiceBankAccountRefs : [];
    const selectedInvoiceBankAccounts = bankAccounts.filter(account => invoiceBankAccountRefs.includes(account._id));

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Perusahaan &amp; Dokumen</h1></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div></div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Profil Perusahaan</span></div>
                    <div className="card-body">
                        <div className="form-group"><label className="form-label">Nama Perusahaan</label><input className="form-input" value={data.name} onChange={e => u('name', e.target.value)} /></div>
                        <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={data.address} onChange={e => u('address', e.target.value)} /></div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Telepon / WhatsApp</label><input className="form-input" value={data.phone} onChange={e => u('phone', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={data.email} onChange={e => u('email', e.target.value)} /></div>
                        </div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={data.npwp || ''} onChange={e => u('npwp', e.target.value)} /></div>
                        </div>
                        <div className="form-section-title">Logo Perusahaan</div>
                        <div className="form-group">
                            <label className="form-label">Upload / Import Logo</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                                {data.logoUrl ? (
                                    <div style={{ position: 'relative', width: 64, height: 64, borderRadius: '0.5rem', border: '2px solid var(--border-color)', overflow: 'hidden', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={data.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        <button type="button" onClick={() => u('logoUrl', '')} style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: '0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>x</button>
                                    </div>
                                ) : (
                                    <div style={{ width: 64, height: 64, borderRadius: '0.5rem', border: '2px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.7rem', flexShrink: 0, background: 'var(--bg-secondary)' }}>
                                        No Logo
                                    </div>
                                )}
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)', color: 'var(--color-primary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', background: 'transparent' }}
                                        onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-primary)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                                        onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'; }}>
                                        Pilih File
                                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoFileChange} />
                                    </label>
                                    <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>PNG, JPG, SVG | Max 500KB</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>atau URL:</span>
                                <input className="form-input" value={data.logoUrl?.startsWith('data:') ? '' : (data.logoUrl || '')} onChange={e => u('logoUrl', e.target.value)} placeholder="https://example.com/logo.png" style={{ fontSize: '0.8rem' }} />
                            </div>
                            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Logo tampil di sidebar, cetak, dan export dokumen aktif (PDF, Excel).</p>
                        </div>
                        <div className="form-section-title">Tema Warna Aplikasi</div>
                        <div className="form-group">
                            <label className="form-label">Primary</label>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                                {[
                                    { color: '#0f766e', name: 'Hijau Teal' },
                                    { color: '#059669', name: 'Hijau' },
                                    { color: '#0891b2', name: 'Cyan' },
                                    { color: '#2563eb', name: 'Biru' },
                                    { color: '#4f46e5', name: 'Indigo' },
                                    { color: '#d97706', name: 'Orange' },
                                    { color: '#dc2626', name: 'Merah' },
                                    { color: '#7c3aed', name: 'Ungu' },
                                    { color: '#db2777', name: 'Pink' },
                                ].map(t => (
                                    <button key={t.color} type="button" onClick={() => previewTheme('themeColor', t.color)} title={t.name}
                                        style={{
                                            width: 40, height: 40, borderRadius: '0.5rem', border: data.themeColor === t.color ? '3px solid #1e293b' : '2px solid #e2e8f0',
                                            background: t.color, cursor: 'pointer', boxShadow: data.themeColor === t.color ? '0 0 0 2px white, 0 0 0 4px ' + t.color : 'none',
                                            transition: 'all 0.15s'
                                        }} />
                                ))}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                <input type="color" value={data.themeColor || DEFAULT_PRIMARY_THEME_COLOR} onChange={e => previewTheme('themeColor', e.target.value)}
                                    style={{ width: 40, height: 36, padding: 0, border: '1px solid #e2e8f0', borderRadius: '0.375rem', cursor: 'pointer' }} />
                                <input className="form-input" value={data.themeColor || DEFAULT_PRIMARY_THEME_COLOR} onChange={e => previewTheme('themeColor', e.target.value)} placeholder={DEFAULT_PRIMARY_THEME_COLOR} style={{ maxWidth: 140 }} />
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Menu dan tombol utama</span>
                            </div>
                            <label className="form-label">Secondary</label>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                                {[
                                    { color: '#dc2626', name: 'Merah' },
                                    { color: '#b91c1c', name: 'Merah Gelap' },
                                    { color: '#d97706', name: 'Orange' },
                                    { color: '#ca8a04', name: 'Kuning' },
                                    { color: '#2563eb', name: 'Biru' },
                                    { color: '#7c3aed', name: 'Ungu' },
                                    { color: '#db2777', name: 'Pink' },
                                    { color: '#475569', name: 'Slate' },
                                ].map(t => (
                                    <button key={t.color} type="button" onClick={() => previewTheme('secondaryThemeColor', t.color)} title={t.name}
                                        style={{
                                            width: 40, height: 40, borderRadius: '0.5rem', border: data.secondaryThemeColor === t.color ? '3px solid #1e293b' : '2px solid #e2e8f0',
                                            background: t.color, cursor: 'pointer', boxShadow: data.secondaryThemeColor === t.color ? '0 0 0 2px white, 0 0 0 4px ' + t.color : 'none',
                                            transition: 'all 0.15s'
                                        }} />
                                ))}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                <input type="color" value={data.secondaryThemeColor || DEFAULT_SECONDARY_THEME_COLOR} onChange={e => previewTheme('secondaryThemeColor', e.target.value)}
                                    style={{ width: 40, height: 36, padding: 0, border: '1px solid #e2e8f0', borderRadius: '0.375rem', cursor: 'pointer' }} />
                                <input className="form-input" value={data.secondaryThemeColor || DEFAULT_SECONDARY_THEME_COLOR} onChange={e => previewTheme('secondaryThemeColor', e.target.value)} placeholder={DEFAULT_SECONDARY_THEME_COLOR} style={{ maxWidth: 140 }} />
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Aksen dashboard dan status pendukung</span>
                            </div>
                            {/* Live Preview Bar */}
                            <div style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Preview:</span>
                                <button className="btn btn-primary btn-sm" style={{ pointerEvents: 'none' }}>Tombol Primary</button>
                                <button className="btn btn-accent btn-sm" style={{ pointerEvents: 'none' }}>Tombol Secondary</button>
                                <span className="badge badge-primary" style={{ pointerEvents: 'none' }}>Badge</span>
                                <span className="badge badge-secondary" style={{ pointerEvents: 'none' }}>Aksen</span>
                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-primary)' }} />
                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-secondary)' }} />
                            </div>
                        </div>
                        <div className="form-section-title">Rekening yang Tampil di Invoice</div>
                        <div className="form-group">
                            <label className="form-label">Pilih Rekening yang Tampil di Invoice</label>
                            <div style={{ display: 'grid', gap: '0.55rem' }}>
                                {bankAccounts.length === 0 ? (
                                    <div className="empty-state" style={{ padding: '1rem' }}>
                                        <div className="empty-state-title">Belum ada rekening bank aktif</div>
                                    </div>
                                ) : bankAccounts.map(account => {
                                    const isSelected = invoiceBankAccountRefs.includes(account._id);
                                    const isDefault = data.invoiceSettings?.defaultInvoiceBankAccountRef === account._id;

                                    return (
                                        <div
                                            key={account._id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: '0.75rem',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-md)',
                                                padding: '0.7rem 0.85rem',
                                                background: isSelected ? 'var(--bg-secondary)' : '#fff',
                                            }}
                                        >
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: 1 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleInvoiceBankAccount(account._id)}
                                                />
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontWeight: 700 }}>{account.bankName} - {account.accountNumber}</div>
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{account.accountHolder}</div>
                                                </div>
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                                <input
                                                    type="radio"
                                                    name="default-invoice-bank"
                                                    checked={isDefault}
                                                    disabled={!isSelected}
                                                    onChange={() => uInvoice('defaultInvoiceBankAccountRef', account._id)}
                                                />
                                                Default Invoice
                                            </label>
                                        </div>
                                    );
                                })}
                            </div>
                            <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                Rekening ini tampil di print dan export invoice. Rekening aktual uang masuk tetap dipilih saat finance mencatat pembayaran atau penerimaan customer.
                            </p>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Ringkasan Rekening Invoice</label>
                            {selectedInvoiceBankAccounts.length > 0 ? (
                                <div style={{ display: 'grid', gap: '0.4rem' }}>
                                    {selectedInvoiceBankAccounts.map(account => (
                                        <div key={account._id} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                            <strong>{data.invoiceSettings?.defaultInvoiceBankAccountRef === account._id ? 'Default Invoice' : 'Tambahan'}:</strong> {account.bankName} - {account.accountNumber} a/n {account.accountHolder}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    Belum ada rekening master yang dipilih. Dokumen invoice akan memakai fallback rekening manual di bawah ini.
                                </p>
                            )}
                        </div>
                        <div className="form-section-title">Fallback Rekening Manual</div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Bank</label><input className="form-input" value={data.bankName || ''} onChange={e => u('bankName', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">No. Rekening</label><input className="form-input" value={data.bankAccount || ''} onChange={e => u('bankAccount', e.target.value)} /></div>
                        </div>
                        <div className="form-group"><label className="form-label">Atas Nama</label><input className="form-input" value={data.bankHolder || ''} onChange={e => u('bankHolder', e.target.value)} /></div>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            Dipakai hanya jika belum ada rekening master yang dipilih untuk invoice, atau untuk menjaga dokumen lama tetap punya rekening cadangan.
                        </p>
                    </div>
                </div>

                <div>
                    <div className="card mb-6">
                        <div className="card-header"><span className="card-header-title">Catatan Invoice Harian</span></div>
                        <div className="card-body">
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    Invoice harian yang dipakai saat ini adalah <strong>Invoice Ongkos</strong>. Pengaturan invoice lama tetap disimpan hanya untuk membaca data historis lama dan tidak lagi dipakai di operasional harian.
                            </p>
                        </div>
                    </div>

                    <div className="card mb-6">
                        <div className="card-header"><span className="card-header-title">Penomoran Dokumen</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Resi Internal</label><input className="form-input" value={data.numberingSettings.resiPrefix} onChange={e => uNum('resiPrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix DO Internal</label><input className="form-input" value={data.numberingSettings.doPrefix} onChange={e => uNum('doPrefix', e.target.value)} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group" style={{ alignSelf: 'end' }}>
                                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        Format <strong>No. SJ Pengirim</strong> tidak diatur di sini. Itu tetap diatur per customer sebagai referensi format, lalu nomor final diinput manual saat membuat surat jalan.
                                    </p>
                                </div>
                                <div className="form-group" />
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Invoice Ongkos</label><input className="form-input" value={data.numberingSettings.notaPrefix || 'INV-'} onChange={e => uNum('notaPrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix Penerimaan</label><input className="form-input" value={data.numberingSettings.receiptPrefix || 'RCV-'} onChange={e => uNum('receiptPrefix', e.target.value)} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kode Seri Cetak Invoice</label><input className="form-input" value={data.numberingSettings.notaSeriesCode || '3'} onChange={e => uNum('notaSeriesCode', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix Arsip Borongan Supir</label><input className="form-input" value={data.numberingSettings.boronganPrefix || 'BRG-'} onChange={e => uNum('boronganPrefix', e.target.value)} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group" style={{ alignSelf: 'end' }}>
                                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        Dipakai untuk nomor cetak Invoice Ongkos model client, misalnya <strong>26/II/3/001</strong>. Nomor internal invoice tetap memakai format aplikasi.
                                    </p>
                                </div>
                                <div className="form-group" />
                            </div>
                            <div className="form-row">
                                <div className="form-group" style={{ alignSelf: 'end' }}>
                                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        Perubahan prefix hanya berlaku untuk dokumen baru dan tidak mengubah nomor dokumen yang sudah terbit.
                                    </p>
                                </div>
                                <div className="form-group" />
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Bon</label><input className="form-input" value={data.numberingSettings.bonPrefix || 'BON-'} onChange={e => uNum('bonPrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix Insiden</label><input className="form-input" value={data.numberingSettings.incidentPrefix} onChange={e => uNum('incidentPrefix', e.target.value)} /></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
