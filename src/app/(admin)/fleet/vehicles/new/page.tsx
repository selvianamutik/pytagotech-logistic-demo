'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import {
    buildVehicleBasePayload,
    EMPTY_VEHICLE_FORM,
    formatVehicleYearInput,
    getSelectableVehicleServiceOptions,
    hasInvalidCapacityRange,
    hasInvalidVehicleOwnership,
    isValidVehicleYear,
    normalizeVehicleYearInput,
    VEHICLE_OWNERSHIP_LABELS,
    type VehicleForm,
} from '@/lib/fleet-vehicle-page-support';
import { buildDefaultTireLayoutConfig, buildTireSlotCodesFromLayoutConfig, formatTireSlotLabel, normalizeTireLayoutConfig } from '@/lib/tire-slots';
import { useApp, useToast } from '../../../layout';
import { hasPermission } from '@/lib/rbac';
import type { Service } from '@/lib/types';

export default function VehicleNewPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [form, setForm] = useState<VehicleForm>(EMPTY_VEHICLE_FORM);
    const isOwner = user ? hasPermission(user, 'vehicles', 'update') : false;
    const selectedService = services.find(service => service._id === form.serviceRef) || null;
    const selectedServiceLayout = selectedService
        ? buildTireSlotCodesFromLayoutConfig(normalizeTireLayoutConfig(selectedService.tireLayoutConfig, buildDefaultTireLayoutConfig(form.vehicleType, selectedService.name)))
        : null;

    useEffect(() => {
        const loadServices = async () => {
            try {
                const serviceRows = await fetchAdminCollectionData<Service[]>('/api/data?entity=services', 'Gagal memuat kategori armada');
                setServices(getSelectableVehicleServiceOptions(serviceRows || []));
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat kategori armada');
            }
        };

        void loadServices();
    }, [addToast]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.plateNumber || !form.brandModel) {
            addToast('error', 'Plat nomor dan merk/model wajib');
            return;
        }
        if (!form.serviceRef) {
            addToast('error', 'Kategori armada wajib dipilih');
            return;
        }
        if (hasInvalidCapacityRange(form)) {
            addToast('error', 'Kapasitas maks tidak boleh lebih kecil dari kapasitas min');
            return;
        }
        if (!isValidVehicleYear(form.year)) {
            addToast('error', 'Tahun kendaraan wajib 4 digit dan masih masuk akal');
            return;
        }
        if (!form.registeredDate) {
            addToast('error', 'Tanggal masuk unit wajib diisi');
            return;
        }
        if (hasInvalidVehicleOwnership(form)) {
            addToast('error', 'Nama pemilik mitra wajib diisi untuk kendaraan milik mitra');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                ...buildVehicleBasePayload(form, isOwner),
                status: 'ACTIVE',
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'vehicles', data: payload }),
            });
            const d = await res.json();
            if (!res.ok) {
                throw new Error(d.error || 'Gagal menyimpan kendaraan');
            }
            addToast('success', 'Kendaraan berhasil ditambahkan');
            router.push(`/fleet/vehicles/${d.data?._id || d.id}`);
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
                    <PageBackButton href="/fleet/vehicles" />
                    <h1 className="page-title">Tambah Kendaraan Baru</h1>
                </div>
            </div>
            <form onSubmit={handleSave}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Kendaraan</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kode Unit</label><input className="form-input" value={form.unitCode} onChange={e => setForm({ ...form, unitCode: e.target.value.toUpperCase() })} placeholder="Kosongkan untuk auto-generate dari kategori" /></div>
                                <div className="form-group"><label className="form-label">Plat Nomor <span className="required">*</span></label><input className="form-input" value={form.plateNumber} onChange={e => setForm({ ...form, plateNumber: e.target.value })} placeholder="B 1234 XYZ" /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tipe Kendaraan</label>
                                    <select className="form-select" value={form.vehicleType} onChange={e => setForm({ ...form, vehicleType: e.target.value })}>
                                        <option>Truck</option><option>Pickup</option><option>Van</option><option>Trailer</option><option>Motor</option><option>Other</option>
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Merk/Model <span className="required">*</span></label><input className="form-input" value={form.brandModel} onChange={e => setForm({ ...form, brandModel: e.target.value })} placeholder="Mitsubishi Colt Diesel FE 74" /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kategori Truk / Armada</label>
                                    <select className="form-select" value={form.serviceRef} onChange={e => {
                                        const service = services.find(item => item._id === e.target.value);
                                        const interval = service?.oilMaintenanceKm || 0;
                                        setForm({
                                            ...form,
                                            serviceRef: e.target.value,
                                            oilMaintenanceIntervalKm: interval,
                                            oilNextServiceOdometer: interval > 0 && !form.oilNextServiceOdometer ? form.lastOdometer + interval : form.oilNextServiceOdometer,
                                            oilServiceRemainingKm: interval > 0 && !form.oilNextServiceOdometer ? interval : form.oilServiceRemainingKm,
                                        });
                                    }}>
                                        <option value="">Pilih kategori armada</option>
                                        {services.map(service => <option key={service._id} value={service._id}>{service.code} - {service.name}</option>)}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Slot ban unit akan mengikuti kategori armada ini.
                                    </div>
                                </div>
                                <div className="form-group"><label className="form-label">Base / Lokasi</label><input className="form-input" value={form.base} onChange={e => setForm({ ...form, base: e.target.value })} placeholder="Jakarta" /></div>
                            </div>
                            {selectedServiceLayout && (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.85rem', padding: '0.85rem 1rem', background: 'var(--color-gray-50)' }}>
                                    <div className="font-medium" style={{ marginBottom: '0.35rem' }}>Preview Slot Ban {selectedService?.name}</div>
                                    <div style={{ display: 'grid', gap: '0.2rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                        {selectedServiceLayout.allSlots.map(slotCode => (
                                            <div key={slotCode}><span className="font-mono">{slotCode}</span> - {formatTireSlotLabel(slotCode)}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tahun</label>
                                    <input
                                        className="form-input"
                                        inputMode="numeric"
                                        maxLength={4}
                                        value={formatVehicleYearInput(form.year)}
                                        onChange={event => setForm({ ...form, year: normalizeVehicleYearInput(event.target.value) })}
                                        placeholder="2016"
                                    />
                                </div>
                                <div className="form-group"><label className="form-label">Odometer Saat Ini</label><FormattedNumberInput allowDecimal={false} value={form.lastOdometer} onValueChange={value => setForm({ ...form, lastOdometer: value, oilServiceRemainingKm: form.oilNextServiceOdometer ? form.oilNextServiceOdometer - value : form.oilServiceRemainingKm })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Masuk Unit <span className="required">*</span></label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={form.registeredDate}
                                        onChange={event => setForm({ ...form, registeredDate: event.target.value })}
                                    />
                                </div>
                                <div className="form-group"><label className="form-label">Tanggal Update Odometer</label><input type="date" className="form-input" value={form.lastOdometerAt} onChange={e => setForm({ ...form, lastOdometerAt: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kepemilikan</label>
                                    <select
                                        className="form-select"
                                        value={form.ownershipType}
                                        onChange={event => {
                                            const ownershipType = event.target.value as VehicleForm['ownershipType'];
                                            setForm({
                                                ...form,
                                                ownershipType,
                                                ...(ownershipType === 'COMPANY' ? { partnerOwnerName: '', partnerOwnerPhone: '', partnerNotes: '' } : {}),
                                            });
                                        }}
                                    >
                                        {Object.entries(VEHICLE_OWNERSHIP_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                                {form.ownershipType === 'PARTNER' && (
                                    <div className="form-group">
                                        <label className="form-label">Nama Pemilik Mitra <span className="required">*</span></label>
                                        <input className="form-input" value={form.partnerOwnerName} onChange={event => setForm({ ...form, partnerOwnerName: event.target.value })} placeholder="Nama pemilik truk" />
                                    </div>
                                )}
                            </div>
                            {form.ownershipType === 'PARTNER' && (
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Kontak Pemilik Mitra</label><input className="form-input" value={form.partnerOwnerPhone} onChange={event => setForm({ ...form, partnerOwnerPhone: event.target.value })} placeholder="Nomor telepon" /></div>
                                    <div className="form-group"><label className="form-label">Catatan Kepemilikan</label><input className="form-input" value={form.partnerNotes} onChange={event => setForm({ ...form, partnerNotes: event.target.value })} placeholder="Catatan sewa / titipan unit" /></div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Odometer & Servis Oli</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Interval dari Kategori (km)</label><FormattedNumberInput allowDecimal={false} value={form.oilMaintenanceIntervalKm || selectedService?.oilMaintenanceKm || 0} onValueChange={value => setForm({ ...form, oilMaintenanceIntervalKm: value })} /></div>
                                <div className="form-group"><label className="form-label">Servis Oli Terakhir di Odometer</label><FormattedNumberInput allowDecimal={false} value={form.oilLastServiceOdometer} onValueChange={value => setForm({ ...form, oilLastServiceOdometer: value, oilNextServiceOdometer: form.oilMaintenanceIntervalKm ? value + form.oilMaintenanceIntervalKm : form.oilNextServiceOdometer })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Servis Oli Berikutnya</label><FormattedNumberInput allowDecimal={false} value={form.oilNextServiceOdometer} onValueChange={value => setForm({ ...form, oilNextServiceOdometer: value, oilServiceRemainingKm: value ? value - form.lastOdometer : 0 })} /></div>
                                <div className="form-group"><label className="form-label">Sisa Sampai Servis</label><FormattedNumberInput allowDecimal={false} value={form.oilServiceRemainingKm} onValueChange={value => setForm({ ...form, oilServiceRemainingKm: value })} /></div>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Spesifikasi</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Ukuran</label><input className="form-input" value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} placeholder="Medium / Large / CDD" /></div>
                                <div className="form-group"><label className="form-label">Dimensi</label><input className="form-input" value={form.dimension} onChange={e => setForm({ ...form, dimension: e.target.value })} placeholder="P x L x T" /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kapasitas (ton)</label>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: '0.75rem', alignItems: 'center' }}>
                                        <input className="form-input" value={form.capacityMin} onChange={e => setForm({ ...form, capacityMin: e.target.value })} placeholder="Min" />
                                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>-</span>
                                        <input className="form-input" value={form.capacityMax} onChange={e => setForm({ ...form, capacityMax: e.target.value })} placeholder="Maks" />
                                    </div>
                                </div>
                                <div className="form-group"><label className="form-label">Volume (m3)</label><FormattedNumberInput maxFractionDigits={3} value={form.capacityVolume} onValueChange={value => setForm({ ...form, capacityVolume: value })} /></div>
                            </div>
                            {isOwner && <div className="form-row">
                                <div className="form-group"><label className="form-label">No. Rangka</label><input className="form-input" value={form.chassisNumber} onChange={e => setForm({ ...form, chassisNumber: e.target.value })} placeholder="MHMFE74P..." /></div>
                                <div className="form-group"><label className="form-label">No. Mesin</label><input className="form-input" value={form.engineNumber} onChange={e => setForm({ ...form, engineNumber: e.target.value })} placeholder="4D34T..." /></div>
                            </div>}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/fleet/vehicles')}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Kendaraan'}</button>
                </div>
            </form>
        </div>
    );
}
