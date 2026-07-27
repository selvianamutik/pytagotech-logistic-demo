'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { type AppModule, type InternalUserRole, getModulePermissions } from '@/lib/rbac';

const MODULE_LABELS: Record<AppModule, string> = {
    dashboard: 'Dashboard',
    employees: 'Karyawan',
    attendance: 'Absensi',
    suppliers: 'Supplier',
    warehouseItems: 'Barang Gudang',
    purchases: 'Pembelian',
    orders: 'Order / Resi',
    deliveryOrders: 'Surat Jalan / Trip',
    invoices: 'Invoice',
    customers: 'Customer',
    tripRouteRates: 'Biaya Rute Trip',
    services: 'Jenis Armada',
    expenseCategories: 'Kategori Biaya',
    expenses: 'Pengeluaran',
    reports: 'Laporan Keuangan',
    vehicles: 'Kenderaan',
    maintenance: 'Maintenance',
    incidents: 'Insiden',
    companySettings: 'Perusahaan & Dokumen',
    userManagement: 'Pengguna Internal',
    auditLogs: 'Audit Aktivitas',
    profile: 'Akun Saya',
    tires: 'Ban',
    drivers: 'Supir',
    bankAccounts: 'Rekening & Kas',
    driverVouchers: 'Uang Jalan Trip',
    freightNotas: 'Nota Ongkir',
    driverBorongans: 'Borongan Supir',
    driverScores: 'Skor Supir',
    dataImports: 'Import Data',
};

const MODULE_GROUPS: { label: string; modules: AppModule[] }[] = [
    { label: 'Utama', modules: ['dashboard'] },
    { label: 'Kerja Harian', modules: ['orders', 'deliveryOrders', 'driverVouchers', 'expenses'] },
    { label: 'Armada', modules: ['vehicles', 'drivers', 'maintenance', 'tires', 'incidents'] },
    { label: 'Gudang & Pembelian', modules: ['suppliers', 'warehouseItems', 'purchases'] },
    { label: 'Invoice & Kas', modules: ['invoices', 'bankAccounts', 'reports'] },
    { label: 'SDM', modules: ['employees', 'attendance'] },
    { label: 'Master Data', modules: ['customers', 'tripRouteRates', 'services', 'expenseCategories'] },
    { label: 'Pengaturan', modules: ['profile', 'companySettings', 'dataImports', 'userManagement', 'auditLogs'] },
];

interface ModulePermissionsEditorProps {
    role: InternalUserRole;
    /** Overrides: true = explicitly assign, false = explicitly deny, absent = role default */
    overrides: Partial<Record<AppModule, boolean>>;
    onChange: (overrides: Partial<Record<AppModule, boolean>>) => void;
    onReset?: () => void;
}

function roleHasAccess(role: InternalUserRole, module: AppModule): boolean {
    return Object.values(getModulePermissions(role, module)).some(Boolean);
}

export default function ModulePermissionsEditor({ role, overrides, onChange, onReset }: ModulePermissionsEditorProps) {
    const [expanded, setExpanded] = useState(false);

    function handleToggle(module: AppModule) {
        const isDefault = roleHasAccess(role, module);
        const override = overrides[module];
        const effectivelyEnabled = override === true || (override === undefined && isDefault);

        const next: Partial<Record<AppModule, boolean>> = { ...overrides };

        if (effectivelyEnabled) {
            // Unchecking: deny if it was a role default, otherwise just remove the assign
            if (isDefault && override === undefined) {
                next[module] = false;
            } else {
                delete next[module];
            }
        } else {
            // Checking: re-allow if it was explicitly denied, otherwise assign
            if (override === false) {
                delete next[module];
            } else {
                next[module] = true;
            }
        }

        onChange(next);
    }

    function resetAll() {
        onChange({});
        onReset?.();
    }

    return (
        <div className="form-group" style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 13, padding: '4px 10px' }}
                    onClick={() => setExpanded(v => !v)}
                >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {expanded ? 'Sembunyikan' : 'Atur Akses Modul'}
                </button>
                <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, color: Object.keys(overrides).length > 0 ? 'var(--color-danger)' : 'var(--color-muted)', padding: '4px 8px' }}
                    onClick={resetAll}
                    title="Hapus semua penyesuaian"
                >
                    <RotateCcw size={12} /> Reset semua
                </button>
            </div>

            {expanded && (
                <div style={{ marginTop: 12 }}>
                    {MODULE_GROUPS.map(group => (
                        <div key={group.label} style={{ marginBottom: 20 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                                {group.label}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {group.modules.map(module => {
                                    const isDefault = roleHasAccess(role, module);
                                    const override = overrides[module];
                                    const effectivelyEnabled = override === true || (override === undefined && isDefault);

                                    return (
                                        <div
                                            key={module}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '6px 10px',
                                                borderRadius: 6,
                                                background: override !== undefined ? 'var(--color-bg-secondary, #f5f5f5)' : undefined,
                                            }}
                                        >
                                            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={effectivelyEnabled}
                                                    onChange={() => handleToggle(module)}
                                                    style={{ cursor: 'pointer' }}
                                                />
                                                <span style={{ fontWeight: effectivelyEnabled ? 600 : 400 }}>
                                                    {MODULE_LABELS[module]}
                                                </span>
                                            </label>
                                            {isDefault && (
                                                <span style={{ fontSize: 10, color: '#888', marginLeft: 4 }}>(Default)</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
