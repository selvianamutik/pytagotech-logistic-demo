/* ============================================================
   LOGISTIK - RBAC + RLC Privacy System
   Role-based access control with record/field-level privacy
   ============================================================ */

import type { Expense, PerUserModulePermissions, UserRole, Vehicle } from './types';

export interface ModulePermissions {
    view: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    export: boolean;
    print: boolean;
}

export type EffectiveUserRole = Exclude<UserRole, 'ADMIN'>;
export type InternalUserRole = Exclude<EffectiveUserRole, 'DRIVER'>;
export type PermissionSubject = UserRole | { role: UserRole; modulePermissions?: PerUserModulePermissions };

function toRole(subject: PermissionSubject): UserRole {
    return typeof subject === 'string' ? subject : subject.role;
}

function toModulePermissions(subject: PermissionSubject): PerUserModulePermissions | undefined {
    const mp = typeof subject === 'string' ? undefined : subject.modulePermissions;
    return mp && Object.keys(mp).length > 0 ? mp : undefined;
}
export type AppModule =
    | 'dashboard'
    | 'employees'
    | 'attendance'
    | 'suppliers'
    | 'warehouseItems'
    | 'purchases'
    | 'orders'
    | 'deliveryOrders'
    | 'invoices'
    | 'customers'
    | 'tripRouteRates'
    | 'services'
    | 'expenseCategories'
    | 'expenses'
    | 'reports'
    | 'vehicles'
    | 'maintenance'
    | 'incidents'
    | 'companySettings'
    | 'userManagement'
    | 'auditLogs'
    | 'profile'
    | 'tires'
    | 'drivers'
    | 'bankAccounts'
    | 'driverVouchers'
    | 'freightNotas'
    | 'driverBorongans'
    | 'driverScores'
    | 'dataImports';

const DENY_ALL: ModulePermissions = {
    view: false,
    create: false,
    update: false,
    delete: false,
    export: false,
    print: false,
};

const OWNER_FULL: ModulePermissions = {
    view: true,
    create: true,
    update: true,
    delete: true,
    export: true,
    print: true,
};

export const INTERNAL_USER_ROLE_OPTIONS: InternalUserRole[] = [
    'OWNER',
    'OPERASIONAL',
    'FINANCE',
    'ARMADA',
];

export function normalizeUserRole(role: UserRole): EffectiveUserRole {
    return role === 'ADMIN' ? 'OPERASIONAL' : role;
}

const permissionMatrix: Record<AppModule, Partial<Record<EffectiveUserRole, ModulePermissions>>> = {
    dashboard: {
        OWNER: { ...DENY_ALL, view: true },
        OPERASIONAL: { ...DENY_ALL, view: true },
        FINANCE: { ...DENY_ALL, view: true },
        ARMADA: { ...DENY_ALL, view: true },
    },
    employees: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
    },
    attendance: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
    },
    suppliers: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    warehouseItems: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    purchases: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    orders: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
    },
    deliveryOrders: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    invoices: {
        OWNER: OWNER_FULL,
        FINANCE: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
    },
    customers: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    tripRouteRates: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    services: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    expenseCategories: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    expenses: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    reports: {
        OWNER: { ...DENY_ALL, view: true, export: true },
        FINANCE: { ...DENY_ALL, view: true, create: true, update: true, export: true, print: true },
    },
    vehicles: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    maintenance: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    incidents: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    companySettings: {
        OWNER: { ...DENY_ALL, view: true, create: true, update: true },
        OPERASIONAL: { ...DENY_ALL, view: true, create: true, update: true },
        FINANCE: { ...DENY_ALL, view: true, create: true, update: true },
        ARMADA: { ...DENY_ALL, view: true, create: true, update: true },
    },
    userManagement: {
        OWNER: OWNER_FULL,
    },
    auditLogs: {
        OWNER: { ...DENY_ALL, view: true, export: true },
    },
    dataImports: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    profile: {
        OWNER: { ...DENY_ALL, view: true, update: true },
        OPERASIONAL: { ...DENY_ALL, view: true, update: true },
        FINANCE: { ...DENY_ALL, view: true, update: true },
        ARMADA: { ...DENY_ALL, view: true, update: true },
    },
    tires: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    drivers: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    bankAccounts: {
        OWNER: OWNER_FULL,
        FINANCE: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    driverVouchers: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
    freightNotas: {
        OWNER: OWNER_FULL,
        FINANCE: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
    },
    driverBorongans: {
        OWNER: OWNER_FULL,
        FINANCE: OWNER_FULL,
    },
    driverScores: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: OWNER_FULL,
        ARMADA: OWNER_FULL,
    },
};

export function hasPermission(subject: PermissionSubject, module: AppModule, action: keyof ModulePermissions): boolean {
    const role = toRole(subject);
    if (role === 'OWNER') return true;
    const assigned = toModulePermissions(subject);
    const override = assigned?.[module];
    if (override === true) return true;
    if (override === false) return false;
    const normalizedRole = normalizeUserRole(role);
    return permissionMatrix[module]?.[normalizedRole]?.[action] ?? false;
}

export function getModulePermissions(subject: PermissionSubject, module: AppModule): ModulePermissions {
    const role = toRole(subject);
    if (role === 'OWNER') return { view: true, create: true, update: true, delete: true, export: true, print: true };
    const assigned = toModulePermissions(subject);
    const override = assigned?.[module];
    if (override === true) return OWNER_FULL;
    if (override === false) return DENY_ALL;
    const normalizedRole = normalizeUserRole(role);
    return permissionMatrix[module]?.[normalizedRole] ?? DENY_ALL;
}

export function hasPageAccess(subject: PermissionSubject, module: AppModule): boolean {
    return hasPermission(subject, module, 'view');
}

export function filterExpensesByRole(expenses: Expense[], role: UserRole): Expense[] {
    if (normalizeUserRole(role) === 'OWNER') return expenses;
    return expenses.filter(expense => expense.privacyLevel !== 'ownerOnly');
}

export function sanitizeVehicleForRole(vehicle: Vehicle, role: UserRole): Vehicle {
    if (normalizeUserRole(role) === 'OWNER') return vehicle;
    return {
        ...vehicle,
        chassisNumber: undefined,
        engineNumber: undefined,
    };
}

export interface SidebarMenuItem {
    label: string;
    href: string;
    icon: string;
    module: AppModule;
    badge?: number;
}

export interface SidebarMenuGroup {
    label: string;
    items: SidebarMenuItem[];
}

export function getSidebarMenu(subject: PermissionSubject): SidebarMenuGroup[] {
    const normalizedRole = normalizeUserRole(toRole(subject));
    if (normalizedRole === 'DRIVER') {
        return [];
    }

    const groups: SidebarMenuGroup[] = [
        {
            label: 'Utama',
            items: [{ label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard', module: 'dashboard' }],
        },
        {
            label: 'Kerja Harian',
            items: [
                { label: 'Order / Resi', href: '/orders', icon: 'Package', module: 'orders' },
                { label: 'Trip', href: '/trips', icon: 'Truck', module: 'deliveryOrders' },
                { label: 'Surat Jalan', href: '/surat-jalan', icon: 'ScrollText', module: 'deliveryOrders' },
                { label: 'Uang Jalan Trip', href: '/driver-vouchers', icon: 'Wallet', module: 'driverVouchers' },
                { label: 'Pengeluaran', href: '/expenses', icon: 'Wallet', module: 'expenses' },
            ],
        },
        {
            label: 'Armada',
            items: [
                { label: 'Kendaraan', href: '/fleet/vehicles', icon: 'Car', module: 'vehicles' },
                { label: 'Supir', href: '/fleet/drivers', icon: 'UserCircle', module: 'drivers' },
                { label: 'Maintenance', href: '/fleet/maintenance', icon: 'Wrench', module: 'maintenance' },
                { label: 'Ban', href: '/fleet/tires', icon: 'Wrench', module: 'tires' },
                { label: 'Insiden', href: '/fleet/incidents', icon: 'AlertTriangle', module: 'incidents' },
            ],
        },
        {
            label: 'Gudang & Pembelian',
            items: [
                { label: 'Supplier', href: '/suppliers', icon: 'Building2', module: 'suppliers' },
                { label: 'Barang Gudang', href: '/inventory/items', icon: 'Package', module: 'warehouseItems' },
                { label: 'Pembelian', href: '/inventory/purchases', icon: 'Receipt', module: 'purchases' },
                { label: 'Pemakaian Barang', href: '/inventory/material-usage', icon: 'BarChart3', module: 'maintenance' },
                { label: 'Laporan Stok', href: '/inventory/stock-recap', icon: 'BarChart3', module: 'warehouseItems' },
            ],
        },
        {
            label: 'Invoice & Kas',
            items: [
                { label: 'Invoice', href: '/invoices', icon: 'Receipt', module: 'invoices' },
                { label: 'Rekening & Kas', href: '/bank-accounts', icon: 'Landmark', module: 'bankAccounts' },
                { label: 'Laporan Keuangan', href: '/accounting/statements', icon: 'BarChart3', module: 'reports' },
                { label: 'Jurnal Umum', href: '/accounting/journals', icon: 'ScrollText', module: 'reports' },
                { label: 'Buku Besar', href: '/accounting/ledger', icon: 'Landmark', module: 'reports' },
                { label: 'Akun Perkiraan', href: '/accounting/accounts', icon: 'Tags', module: 'reports' },
            ],
        },
        {
            label: 'SDM',
            items: [
                { label: 'Karyawan', href: '/employees', icon: 'Users', module: 'employees' },
                { label: 'Absensi', href: '/attendance', icon: 'ScrollText', module: 'attendance' },
            ],
        },
        {
            label: 'Master Data',
            items: [
                { label: 'Customer', href: '/customers', icon: 'Users', module: 'customers' },
                { label: 'Biaya Rute Trip', href: '/trip-rates', icon: 'MapPin', module: 'tripRouteRates' },
                { label: 'Jenis Armada', href: '/services', icon: 'Layers', module: 'services' },
                { label: 'Kategori Biaya', href: '/expense-categories', icon: 'Tags', module: 'expenseCategories' },
            ],
        },
        {
            label: 'Pengaturan',
            items: [
                { label: 'Akun Saya', href: '/settings/profile', icon: 'User', module: 'profile' },
                { label: 'Perusahaan & Dokumen', href: '/settings/company', icon: 'Building2', module: 'companySettings' },
                { label: 'Import Data', href: '/settings/import-data', icon: 'Upload', module: 'dataImports' },
                { label: 'Pengguna Internal', href: '/settings/users', icon: 'UserCog', module: 'userManagement' },
                { label: 'Audit Aktivitas', href: '/settings/audit-logs', icon: 'ScrollText', module: 'auditLogs' },
            ],
        },
    ];

    return groups
        .map(group => ({
            ...group,
            items: group.items.filter(item => hasPageAccess(subject, item.module)),
        }))
        .filter(group => group.items.length > 0);
}
