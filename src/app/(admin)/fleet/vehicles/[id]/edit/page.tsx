'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Save } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import {
    buildVehicleBasePayload,
    EMPTY_VEHICLE_FORM,
    formatVehicleYearInput,
    getSelectableVehicleServiceOptions,
    getVehicleSections,
    hasInvalidCapacityRange,
    hasInvalidVehicleOwnership,
    isValidVehicleYear,
    mapVehicleToForm,
    normalizeVehicleYearInput,
    updateVehicleUnitCodeForServiceChange,
    VEHICLE_OWNERSHIP_LABELS,
    type VehicleForm,
} from '@/lib/fleet-vehicle-page-support';
import { buildDefaultTireLayoutConfig, buildTireSlotCodesFromLayoutConfig, formatTireSlotLabel, normalizeTireLayoutConfig } from '@/lib/tire-slots';
import { hasPermission } from '@/lib/rbac';
import { useApp, useToast } from '../../../../layout';
import { VEHICLE_STATUS_MAP } from '@/lib/utils';
import type { Service, Vehicle, VehicleStatus } from '@/lib/types';

export default function VehicleEditPage() {
    const params = useParams();
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [form, setForm] = useState<VehicleForm>(EMPTY_VEHICLE_FORM);
    const isOwner = user ? hasPermission(user, 'vehicles', 'update') : false;
    const vehicleId = params.id as string;
    const vehicleSections = getVehicleSections(vehicleId, isOwner);
    const selectedService = services.find(service => service._id === form.serviceRef) || null;
    const selectedServiceLayout = selectedService
        ? buildTireSlotCodesFromLayoutConfig(normalizeTireLayoutConfig(selectedService.tireLayoutConfig, buildDefaultTireLayoutConfig(form.vehicleType, selectedService.name)))
        : null;

    useEffect(() => {
        const loadVehicle = async () => {
            try {
                const [vehicle, serviceRows] = await Promise.all([
                    fetchAdminData<Vehicle | null>(`/api/data?entity=vehicles&id=${vehicleId}`, 'Kendaraan tidak ditemukan'),
                    fetchAdminCollectionData<Service[]>('/api/data?entity=services', 'Gagal memuat kategori armada'),
                ]);

                if (!vehicle) {
                    throw new Error('Kendaraan tidak ditemukan');
                }

                setForm(mapVehicleToForm(vehicle));
                setServices(getSelectableVehicleServiceOptions(serviceRows || [], vehicle.serviceRef));
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat kendaraan');
                router.push('/fleet/vehicles');
            } finally {
                setLoading(false);
            }
        };

        void loadVehicle();
    }, [addToast, router, vehicleId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.plateNumber || !form.brandModel) {
            addToast('error', 'Plat nomor dan merk/model wajib diisi');
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
            const updates = {
                ...buildVehicleBasePayload(form, isOwner),
                status: form.status,
            };

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'vehicles',
                    action: 'update',
                    data: { id: vehicleId, updates },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memperbarui kendaraan');
            }

            addToast('success', 'Kendaraan berhasil diperbarui');
            router.push(`/fleet/vehicles/${vehicleId}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui kendaraan');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 320 }} /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href={`/fleet/vehicles/${vehicleId}`} />
                    <div>
                        <h1 className="page-title">Edit Kendaraan</h1>
                    </div>
                </div>
            </div>
            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="card-body" style={{ padding: '1rem' }}>
                    <div className="segmented-tabs" aria-label="Navigasi kendaraan" style={{ flexWrap: 'wrap' }}>
                        <button type="button" className="segmented-tab active">
                            Edit
                        </button>
                        {vehicleSections.map(section => (
                            <button
                                key={section.key}
                                type="button"
                                className="segmented-tab"
                                onClick={() => router.push(section.href)}
                            >
                                {section.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <form onSubmit={handleSubmit}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Kendaraan</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kode Unit</label><input className="form-input" value={form.unitCode} onChange={e => setForm({ ...form, unitCode: e.target.value.toUpperCase() })} placeholder="Kosongkan untuk auto-generate ulang dari kategori" /></div>
                                <div className="form-group"><label className="form-label">Plat Nomor <span className="required">*</span></label><input className="form-input" value={form.plateNumber} onChange={e => setForm({ ...form, plateNumber: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tipe Kendaraan</label><input className="form-input" value={form.vehicleType} onChange={e => setForm({ ...form, vehicleType: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Merk/Model <span className="required">*</span></label><input className="form-input" value={form.brandModel} onChange={e => setForm({ ...form, brandModel: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kategori Truk / Armada</label>
                                    <select className="form-select" value={form.serviceRef} onChange={e => {
                                        const previousService = services.find(item => item._id === form.serviceRef) || null;
                                        const service = services.find(item => item._id === e.target.value);
                                        const interval = service?.oilMaintenanceKm || 0;
                                        setForm({
                                            ...form,
                                            unitCode: updateVehicleUnitCodeForServiceChange({
                                                unitCode: form.unitCode,
                                                previousService,
                                                nextService: service,
                                            }),
                                            serviceRef: e.target.value,
                                            oilMaintenanceIntervalKm: interval,
                                            oilNextServiceOdometer: interval > 0 && form.oilLastServiceOdometer > 0 ? form.oilLastServiceOdometer + interval : form.oilNextServiceOdometer,
                                            oilServiceRemainingKm: interval > 0 && form.oilLastServiceOdometer > 0 ? form.oilLastServiceOdometer + interval - form.lastOdometer : form.oilServiceRemainingKm,
                                        });
                                    }}>
                                        <option value="">Pilih kategori armada</option>
                                        {services.map(service => <option key={service._id} value={service._id}>{service.code} - {service.name}</option>)}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Kalau kategori armada diubah dan kode unit dikosongkan, sistem akan membuat kode baru dengan prefix kategori yang sesuai.
                                    </div>
                                </div>
                                <div className="form-group"><label className="form-label">Base / Lokasi</label><input className="form-input" value={form.base} onChange={e => setForm({ ...form, base: e.target.value })} /></div>
                            </div>
                            {selectedServiceLayout && (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.85rem', padding: '0.85rem 1rem', background: 'var(--color-gray-50)', marginBottom: '0.75rem' }}>
                                    <div className="font-medium" style={{ marginBottom: '0.35rem' }}>Preview Slot Ban {selectedService?.name}</div>
                                    <div style={{ display: 'grid', gap: '0.2rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                        {selectedServiceLayout.allSlots.map(slotCode => (
                                            <div key={slotCode}><span className="font-mono">{slotCode}</span> - {formatTireSlotLabel(slotCode)}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Status</label>
                                    <select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as VehicleStatus })}>
                                        {Object.entries(VEHICLE_STATUS_MAP).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Tanggal Update Odometer</label><input type="date" className="form-input" value={form.lastOdometerAt} onChange={e => setForm({ ...form, lastOdometerAt: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tahun</label>
                                    <input
                                        className="form-input"
                                        inputMode="numeric"
                                        maxLength={4}
                                        value={formatVehicleYearInput(form.year)}
                                        onChange={event => setForm({ ...form, year: normalizeVehicleYearInput(event.target.value) })}
                                    />
                                </div>
                                <div className="form-group"><label className="form-label">Odometer Terakhir</label><FormattedNumberInput allowDecimal={false} value={form.lastOdometer} onValueChange={value => setForm({ ...form, lastOdometer: value, oilServiceRemainingKm: form.oilNextServiceOdometer ? form.oilNextServiceOdometer - value : form.oilServiceRemainingKm })} /></div>
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
                            </div>
                            {form.ownershipType === 'PARTNER' && (
                                <>
                                    <div className="form-row">
                                        <div className="form-group"><label className="form-label">Nama Pemilik Mitra <span className="required">*</span></label><input className="form-input" value={form.partnerOwnerName} onChange={event => setForm({ ...form, partnerOwnerName: event.target.value })} /></div>
                                        <div className="form-group"><label className="form-label">Kontak Pemilik Mitra</label><input className="form-input" value={form.partnerOwnerPhone} onChange={event => setForm({ ...form, partnerOwnerPhone: event.target.value })} /></div>
                                    </div>
                                    <div className="form-group"><label className="form-label">Catatan Kepemilikan</label><input className="form-input" value={form.partnerNotes} onChange={event => setForm({ ...form, partnerNotes: event.target.value })} /></div>
                                </>
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
                                <div className="form-group"><label className="form-label">No. Rangka</label><input className="form-input" value={form.chassisNumber} onChange={e => setForm({ ...form, chassisNumber: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">No. Mesin</label><input className="form-input" value={form.engineNumber} onChange={e => setForm({ ...form, engineNumber: e.target.value })} /></div>
                            </div>}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicleId}`)}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Perubahan'}</button>
                </div>
            </form>
        </div>
    );
}
