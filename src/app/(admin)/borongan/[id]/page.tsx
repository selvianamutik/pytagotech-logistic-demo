'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, Printer, Trash2 } from 'lucide-react';
import { useApp, useToast } from '../../layout';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import { hasPageAccess, normalizeUserRole } from '@/lib/rbac';
import type { BankAccount, DriverBorongan, DriverBoronganItem } from '@/lib/types';
import { formatCurrency, formatDate, formatQuantity } from '@/lib/utils';
import PageBackButton from '@/components/PageBackButton';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Dibayar', color: 'danger' },
    PAID: { label: 'Sudah Dibayar', color: 'success' },
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
    TRANSFER: 'Transfer',
    CASH: 'Tunai',
    OTHER: 'Lainnya',
};

export default function BoronganDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const { user } = useApp();
    const boronganId = params.id as string;
    const [borong, setBorong] = useState<DriverBorongan | null>(null);
    const [items, setItems] = useState<DriverBoronganItem[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);

    const [showPayModal, setShowPayModal] = useState(false);
    const [payDate, setPayDate] = useState(getBusinessDateValue());
    const [payMethod, setPayMethod] = useState('CASH');
    const [payBankRef, setPayBankRef] = useState('');
    const [payNote, setPayNote] = useState('');
    const [paying, setPaying] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const normalizedRole = user ? normalizeUserRole(user.role) : null;
    const canOpenDeliveryOrderPage = user ? hasPageAccess(user, 'deliveryOrders') : false;
    const canOpenDriverPage = user ? hasPageAccess(user, 'drivers') : false;
    const parseWholeMoneyLike = (value: unknown) =>
        parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 });

    useEffect(() => {
        if (normalizedRole && normalizedRole !== 'OWNER') {
            router.replace('/driver-vouchers');
        }
    }, [normalizedRole, router]);

    const loadBoronganDetail = useCallback(async () => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Gagal memuat slip borongan');
            }
            return result.data as T;
        };

        setLoading(true);
        try {
            const [boronganData, boronganItems, accounts] = await Promise.all([
                fetchEntity<DriverBorongan | null>(`/api/data?entity=driver-borongans&id=${boronganId}`),
                fetchAdminCollectionData<DriverBoronganItem[]>(
                    `/api/data?entity=driver-borongan-items&filter=${encodeURIComponent(JSON.stringify({ boronganRef: boronganId }))}`,
                    'Gagal memuat slip borongan'
                ),
                fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat slip borongan'),
            ]);

            setBorong(boronganData);
            setItems([...(boronganItems || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setBankAccounts((accounts || []).filter((account) => account.active !== false));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat slip borongan');
        } finally {
            setLoading(false);
        }
    }, [addToast, boronganId]);

    useEffect(() => {
        void loadBoronganDetail();
    }, [loadBoronganDetail]);

    useEffect(() => {
        if (!payBankRef) return;
        const selectedAccount = bankAccounts.find(account => account._id === payBankRef);
        if (!selectedAccount) {
            setPayBankRef('');
            return;
        }
        if (payMethod === 'TRANSFER' && selectedAccount.accountType === 'CASH') {
            setPayBankRef('');
        }
    }, [bankAccounts, payBankRef, payMethod]);

    const handleMarkPaid = async () => {
        if (!borong) return;
        if (payMethod === 'TRANSFER' && !payBankRef) {
            addToast('error', 'Pilih rekening bank untuk transfer');
            return;
        }

        setPaying(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-borongans',
                    action: 'mark-paid',
                    data: {
                        id: borong._id,
                        date: payDate,
                        amount: borong.totalAmount,
                        paymentMethod: payMethod,
                        bankAccountRef: payBankRef || undefined,
                        note: payNote || undefined,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal mencatat pembayaran');
                return;
            }

            addToast('success', 'Pembayaran borongan berhasil dicatat');
            setShowPayModal(false);
            setPayBankRef('');
            setPayNote('');
            await loadBoronganDetail();
        } catch {
            addToast('error', 'Gagal mencatat pembayaran');
        } finally {
            setPaying(false);
        }
    };

    const handleDelete = async () => {
        if (deleting) return;
        if (!confirm('Hapus slip borongan ini?')) return;
        setDeleting(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-borongans',
                    action: 'delete',
                    data: { id: boronganId },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus slip borongan');
                return;
            }
            addToast('success', 'Slip dihapus');
            router.push('/borongan');
        } catch {
            addToast('error', 'Gagal menghapus slip borongan');
        } finally {
            setDeleting(false);
        }
    };

    const handlePrint = async () => {
        const printContent = document.getElementById('borong-print-area')?.innerHTML;
        if (!printContent) return;
        const printWindow = openPrintWindow('Menyiapkan cetak slip borongan...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }

        try {
            const company = resolveDocumentIssuerProfile(borong, await fetchCompanyProfile().catch(() => null));
            openBrandedPrint({
                title: 'Slip Borongan Supir',
                subtitle: borong?.boronganNumber,
                company,
                targetWindow: printWindow,
                bodyHtml: printContent,
                extraStyles: `
                    .header-grid { display: flex; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; }
                    .sub { font-size: 0.78rem; margin: 0.1rem 0; color: #475569; }
                    .right { text-align: right; }
                    .bold { font-weight: 700; }
                    .total-row { background: #f8fafc !important; font-weight: 700; }
                `,
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    if (normalizedRole && normalizedRole !== 'OWNER') {
        return null;
    }

    if (loading) {
        return (
            <div>
                <div className="skeleton skeleton-title" />
                <div className="skeleton skeleton-card" style={{ height: 200 }} />
            </div>
        );
    }

    if (!borong) {
        return (
            <div className="empty-state">
                <div className="empty-state-title">Slip tidak ditemukan</div>
            </div>
        );
    }

    const statusConf = STATUS_MAP[borong.status] || { label: borong.status, color: 'secondary' };
    const accountMap = new Map(bankAccounts.map(account => [account._id, account]));
    const matchedPaidAccount = borong.paidBankRef ? accountMap.get(borong.paidBankRef) : undefined;
    const boronganPaymentAccountOptions = payMethod === 'TRANSFER'
        ? bankAccounts.filter(account => account.accountType !== 'CASH')
        : payMethod === 'CASH'
            ? []
            : bankAccounts;
    const paidAccountLabel = borong.paidBankName
        ? `${borong.paidBankName}${borong.paidBankNumber || matchedPaidAccount?.accountNumber ? ` - ${borong.paidBankNumber || matchedPaidAccount?.accountNumber}` : ''}`
        : matchedPaidAccount
            ? `${matchedPaidAccount.bankName} - ${matchedPaidAccount.accountNumber}`
            : borong.paidMethod === 'CASH'
                ? 'Kas / rekening tidak tercatat'
                : '';

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <PageBackButton href="/borongan" />
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{borong.boronganNumber}</h1>
                        <span className={`badge badge-${statusConf.color}`}>
                            <span className="badge-dot" /> {statusConf.label}
                        </span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {borong.status === 'UNPAID' && (
                        <button className="btn btn-success btn-sm" onClick={() => setShowPayModal(true)}>
                            <CheckCircle size={14} /> Bayar Borongan
                        </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={handlePrint}>
                        <Printer size={14} /> Cetak Slip
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={handleDelete} disabled={deleting}>
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            <div className="detail-grid" style={{ alignItems: 'start' }}>
                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Detail Slip Borongan</span>
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item">
                                <div className="detail-label">No. Slip</div>
                                <div className="detail-value font-mono">{borong.boronganNumber}</div>
                            </div>
                            <div className="detail-item">
                                <div className="detail-label">Supir</div>
                                <div className="detail-value font-semibold">{canOpenDriverPage && borong.driverRef ? <Link href={`/fleet/drivers/${borong.driverRef}`}>{borong.driverName}</Link> : borong.driverName}</div>
                            </div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item">
                                <div className="detail-label">Periode</div>
                                <div className="detail-value">
                                    {formatDate(borong.periodStart)} - {formatDate(borong.periodEnd)}
                                </div>
                            </div>
                            <div className="detail-item">
                                <div className="detail-label">Status</div>
                                <div className="detail-value">
                                    <span className={`badge badge-${statusConf.color}`}>{statusConf.label}</span>
                                </div>
                            </div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item">
                                <div className="detail-label">Total Collie</div>
                                <div className="detail-value">{formatQuantity(borong.totalCollie || 0)}</div>
                            </div>
                            <div className="detail-item">
                                <div className="detail-label">Total Berat (info)</div>
                                <div className="detail-value">{formatQuantity(borong.totalWeightKg || 0)} kg</div>
                            </div>
                        </div>
                        {borong.paidDate && (
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Tanggal Bayar</div>
                                    <div className="detail-value">{formatDate(borong.paidDate)}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Metode</div>
                                    <div className="detail-value">{PAYMENT_METHOD_LABELS[borong.paidMethod || ''] || borong.paidMethod || '-'}</div>
                                </div>
                            </div>
                        )}
                        {borong.paidDate && (
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Rekening / Kas</div>
                                    <div className="detail-value">{paidAccountLabel || '-'}</div>
                                </div>
                                <div className="detail-item" />
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff', padding: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                                Total Upah Borongan
                            </div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(borong.totalAmount)}</div>
                        </div>
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Jumlah Perjalanan</span>
                                <strong>{items.length}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Collie</span>
                                <strong>{formatQuantity(borong.totalCollie || 0)}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Berat (info)</span>
                                <strong>{formatQuantity(borong.totalWeightKg || 0)} kg</strong>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)', lineHeight: 1.45, marginBottom: '1rem' }}>
                                Slip ini dihitung dari tarif borongan per DO/perjalanan. Berat dan collie tetap disimpan sebagai konteks operasional.
                            </div>
                            {borong.status === 'UNPAID' && (
                                <button className="btn btn-success" style={{ width: '100%' }} onClick={() => setShowPayModal(true)}>
                                    <CheckCircle size={16} /> Bayar Borongan Supir
                                </button>
                            )}
                            {borong.status === 'PAID' && (
                                <div
                                    style={{
                                        textAlign: 'center',
                                        color: 'var(--color-success)',
                                        fontWeight: 600,
                                        fontSize: '0.9rem',
                                        padding: '0.5rem',
                                    }}
                                >
                                    Sudah Dibayar {borong.paidDate ? `(${formatDate(borong.paidDate)})` : ''}
                                    {paidAccountLabel ? <div style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)', marginTop: '0.25rem' }}>via {paidAccountLabel}</div> : null}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="detail-full">
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">Perincian Perjalanan</span>
                        </div>
                        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                            <table style={{ minWidth: 700 }}>
                                <thead>
                                    <tr>
                                        <th>NO.TRUCK</th>
                                        <th>TGL</th>
                                        <th>NO.SJ</th>
                                        <th>TUJUAN</th>
                                        <th>BARANG</th>
                                        <th>COLLIE</th>
                                        <th>BERAT KG</th>
                                        <th>TARIF BORONGAN</th>
                                        <th style={{ textAlign: 'right' }}>UPAH RP</th>
                                        <th>KET</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((it) => (
                                        <tr key={it._id}>
                                            <td className="font-mono">{it.vehiclePlate || '-'}</td>
                                            <td className="text-muted">{formatDate(it.date)}</td>
                                            <td>{canOpenDeliveryOrderPage && it.doRef ? <Link href={`/delivery-orders/${it.doRef}`} style={{ color: 'var(--color-primary)' }}>{it.noSJ || '-'}</Link> : (it.noSJ || '-')}</td>
                                            <td>{it.tujuan}</td>
                                            <td>{it.barang || '-'}</td>
                                            <td>{it.collie ? formatQuantity(it.collie) : '-'}</td>
                                            <td>{formatQuantity(it.beratKg || 0)}</td>
                                        <td>{formatCurrency(it.tarip || 0)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(it.uangRp)}</td>
                                            <td className="text-muted">{it.ket || '-'}</td>
                                        </tr>
                                    ))}
                                    <tr style={{ background: 'var(--color-bg-secondary)', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                                        <td colSpan={5} style={{ textAlign: 'right' }}>Jumlah</td>
                                        <td>{formatQuantity(borong.totalCollie || 0)}</td>
                                        <td>{formatQuantity(borong.totalWeightKg || 0)}</td>
                                        <td />
                                        <td style={{ textAlign: 'right', color: 'var(--color-danger)' }}>{formatCurrency(borong.totalAmount)}</td>
                                        <td />
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <div id="borong-print-area" style={{ display: 'none' }}>
                <div className="header-grid">
                    <div>
                        <h2>SLIP BORONGAN SUPIR</h2>
                        <div className="sub bold">No: {borong.boronganNumber}</div>
                        <div className="sub">Supir: {borong.driverName}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div className="sub">Periode: {formatDate(borong.periodStart)} s/d {formatDate(borong.periodEnd)}</div>
                        <div className="sub">Status: {statusConf.label}</div>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>NO.TRUCK</th>
                            <th>TANGGAL</th>
                            <th>NO. SJ</th>
                            <th>TUJUAN</th>
                            <th>BARANG</th>
                            <th>COLLIE</th>
                            <th>BERAT KG</th>
                            <th>TARIF BORONGAN</th>
                            <th>UPAH RP.</th>
                            <th>KET</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((it, idx) => (
                            <tr key={idx}>
                                <td className="bold">{it.vehiclePlate || '-'}</td>
                                <td>{formatDate(it.date)}</td>
                                <td>{canOpenDeliveryOrderPage && it.doRef ? <Link href={`/delivery-orders/${it.doRef}`} style={{ color: 'inherit', textDecoration: 'none' }}>{it.noSJ || '-'}</Link> : (it.noSJ || '-')}</td>
                                <td>{it.tujuan}</td>
                                <td>{it.barang || '-'}</td>
                                <td>{it.collie ? formatQuantity(it.collie) : '-'}</td>
                                <td>{formatQuantity(it.beratKg || 0)}</td>
                                <td>{formatCurrency(it.tarip || 0)}</td>
                                <td className="right">{formatCurrency(it.uangRp || 0)}</td>
                                <td>{it.ket || '-'}</td>
                            </tr>
                        ))}
                        <tr className="total-row">
                            <td colSpan={5} className="right bold">Jumlah</td>
                            <td className="bold">{formatQuantity(borong.totalCollie || 0)}</td>
                            <td className="bold">{formatQuantity(borong.totalWeightKg || 0)}</td>
                            <td />
                            <td className="right bold">{formatCurrency(borong.totalAmount || 0)}</td>
                            <td />
                        </tr>
                    </tbody>
                </table>
                {borong.notes && <div style={{ marginTop: 10, fontSize: 9 }}>Catatan: {borong.notes}</div>}
            </div>

            {showPayModal && (
                <div className="modal-overlay" onClick={() => { if (!paying) setShowPayModal(false); }}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Bayar Upah Borongan</h3>
                            <button className="modal-close" onClick={() => setShowPayModal(false)} disabled={paying}>
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div
                                style={{
                                    background: 'var(--color-warning-light)',
                                    borderRadius: '0.5rem',
                                    padding: '0.75rem 1rem',
                                    marginBottom: '1rem',
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: '0.72rem',
                                        color: 'var(--color-warning)',
                                        textTransform: 'uppercase',
                                        fontWeight: 600,
                                    }}
                                >
                                    Total yang akan dibayar ke {borong.driverName}
                                </div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-warning)' }}>
                                    {formatCurrency(borong.totalAmount)}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', marginTop: '0.25rem' }}>
                                    Catatan: pembayaran ini selalu tercatat sebagai pengeluaran. Saldo bank hanya berkurang jika kamu memilih rekening.
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Tanggal Bayar</label>
                                <input type="date" className="form-input" value={payDate} onChange={(e) => setPayDate(e.target.value)} disabled={paying} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Metode Pembayaran</label>
                                    <select
                                        className="form-select"
                                        value={payMethod}
                                        onChange={(e) => {
                                            const nextMethod = e.target.value;
                                            setPayMethod(nextMethod);
                                            if (nextMethod === 'CASH') {
                                                setPayBankRef('');
                                            }
                                        }}
                                        disabled={paying}
                                    >
                                        <option value="CASH">Tunai</option>
                                        <option value="TRANSFER">Transfer</option>
                                        <option value="OTHER">Lainnya</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        Rekening / Kas <span style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)' }}>(opsional, untuk debit)</span>
                                    </label>
                                    <select className="form-select" value={payBankRef} onChange={(e) => setPayBankRef(e.target.value)} disabled={paying || payMethod === 'CASH'}>
                                        <option value="">{payMethod === 'CASH' ? '-- Otomatis ke Kas Tunai --' : '-- Tanpa Rekening --'}</option>
                                        {boronganPaymentAccountOptions.map((account) => (
                                            <option key={account._id} value={account._id}>
                                                {account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''} (Saldo: {formatCurrency(parseWholeMoneyLike(account.currentBalance))})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                {payMethod === 'TRANSFER'
                                    ? 'Transfer akan mencatat expense dan membuat mutasi DEBIT pada rekening yang dipilih.'
                                    : payMethod === 'CASH'
                                        ? 'Tunai selalu diposting ke akun Kas Tunai. Jika uangnya nanti disetor ke bank, catat transfer kas ke rekening secara terpisah.'
                                        : 'Metode lain tetap mencatat expense. Mutasi bank hanya dibuat jika rekening dipilih.'}
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={payNote}
                                    onChange={(e) => setPayNote(e.target.value)}
                                    placeholder="Opsional..."
                                    disabled={paying}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPayModal(false)} disabled={paying}>
                                Batal
                            </button>
                            <button className="btn btn-success" onClick={handleMarkPaid} disabled={paying}>
                                <CheckCircle size={16} /> {paying ? 'Memproses...' : 'Konfirmasi Pembayaran'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
