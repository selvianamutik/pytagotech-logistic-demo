'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
    LayoutDashboard, Package, Truck, Users, Layers, FileText, Wallet, Tags,
    BarChart3, Car, Wrench, AlertTriangle, User, Lock, Building2, UserCog,
    ScrollText, PanelLeftClose, PanelLeftOpen, Menu, LogOut, X, CheckCircle, XCircle, Info, AlertCircle, Landmark,
    MapPin,
    UserCircle, Receipt, Upload, ChevronDown, ChevronRight
} from 'lucide-react';
import { matchesPathSegment } from '@/lib/pathname';
import { resolveCompanyLogoUrl } from '@/lib/branding';
import { getSidebarMenu } from '@/lib/rbac';
import { applyCompanyThemeColors } from '@/lib/theme';
import type { SessionUser, ToastMessage, CompanyProfile } from '@/lib/types';

// ── Color helpers for theme generation ──
// ── Icon map ──
const ICON_MAP: Record<string, React.ReactNode> = {
    LayoutDashboard: <LayoutDashboard size={20} />,
    Package: <Package size={20} />,
    Truck: <Truck size={20} />,
    Users: <Users size={20} />,
    Layers: <Layers size={20} />,
    FileText: <FileText size={20} />,
    Wallet: <Wallet size={20} />,
    Tags: <Tags size={20} />,
    BarChart3: <BarChart3 size={20} />,
    Car: <Car size={20} />,
    Wrench: <Wrench size={20} />,
    AlertTriangle: <AlertTriangle size={20} />,
    User: <User size={20} />,
    Lock: <Lock size={20} />,
    Building2: <Building2 size={20} />,
    UserCog: <UserCog size={20} />,
    ScrollText: <ScrollText size={20} />,
    Landmark: <Landmark size={20} />,
    MapPin: <MapPin size={20} />,
    UserCircle: <UserCircle size={20} />,
    Receipt: <Receipt size={20} />,
    Upload: <Upload size={20} />,
};

// ── Toast Context ──
interface ToastContextType {
    toasts: ToastMessage[];
    addToast: (type: ToastMessage['type'], message: string) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType>({
    toasts: [],
    addToast: () => { },
    removeToast: () => { },
});

export function useToast() {
    return useContext(ToastContext);
}

// ── App Context ──
interface AppContextType {
    user: SessionUser | null;
    setUser: (user: SessionUser | null) => void;
}

const AppContext = createContext<AppContextType>({
    user: null,
    setUser: () => { },
});

export function useApp() {
    return useContext(AppContext);
}

function getRoleWorkspaceLabel(role?: SessionUser['role']) {
    switch (role) {
        case 'OWNER':
            return 'Owner';
        case 'OPERASIONAL':
        case 'ADMIN':
            return 'Operasional';
        case 'FINANCE':
            return 'Finance';
        case 'ARMADA':
            return 'Armada';
        default:
            return 'Dashboard';
    }
}

// ── Admin Layout ──
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [user, setUser] = useState<SessionUser | null>(null);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [loggingOut, setLoggingOut] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [isTablet, setIsTablet] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

    // Fetch session + company profile
    useEffect(() => {
        const loadAppContext = async () => {
            try {
                const [sessionRes, companyRes] = await Promise.all([
                    fetch('/api/auth/session'),
                    fetch('/api/data?entity=company').catch(() => null),
                ]);

                if (!sessionRes.ok) {
                    throw new Error('Sesi tidak valid');
                }

                const session = await sessionRes.json();
                let co: { data: CompanyProfile | null } = { data: null };
                if (companyRes) {
                    try {
                        const companyPayload = await companyRes.json();
                        co = { data: companyPayload?.data || null };
                    } catch {
                        co = { data: null };
                    }
                }

                if (session.user) {
                    setUser(session.user);
                } else {
                    router.push('/login');
                }
                if (companyRes?.ok && co.data) {
                    setCompany(co.data);
                    applyCompanyThemeColors(document.documentElement, co.data.themeColor, co.data.secondaryThemeColor);
                }
            } catch {
                router.push('/login');
            } finally {
                setLoading(false);
            }
        };

        void loadAppContext();
        // Keep navigation compact on tablet so forms and detail pages retain usable width.
        const mobileQuery = window.matchMedia('(max-width: 768px)');
        const tabletQuery = window.matchMedia('(min-width: 769px) and (max-width: 1100px)');
        const syncViewport = () => {
            const mobile = mobileQuery.matches;
            const tablet = tabletQuery.matches;
            setIsMobile(mobile);
            setIsTablet(tablet);
            if (mobile) {
                setMobileOpen(false);
                setSidebarCollapsed(false);
                return;
            }
            if (tablet) {
                setMobileOpen(false);
                setSidebarCollapsed(true);
            }
        };
        syncViewport();
        mobileQuery.addEventListener('change', syncViewport);
        tabletQuery.addEventListener('change', syncViewport);
        return () => {
            mobileQuery.removeEventListener('change', syncViewport);
            tabletQuery.removeEventListener('change', syncViewport);
        };
    }, [router]);

    useEffect(() => {
        if (!user || !company?.name) {
            return;
        }

        document.title = `${getRoleWorkspaceLabel(user.role)} - ${company.name}`;
    }, [company?.name, pathname, user]);

    // ---- Sidebar accordion persistence ----
    const SIDEBAR_EXPANSION_KEY = 'sidebar-expanded-groups';
    useEffect(() => {
        try {
            const raw = localStorage.getItem(SIDEBAR_EXPANSION_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Record<string, boolean>;
                if (parsed && typeof parsed === 'object') setExpandedGroups(parsed);
            }
        } catch { /* ignore */ }
    }, []);

    const toggleGroup = useCallback((label: string) => {
        setExpandedGroups(prev => {
            const next = { ...prev, [label]: !(prev[label] ?? true) };
            try { localStorage.setItem(SIDEBAR_EXPANSION_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);

    const isGroupExpanded = useCallback((label: string) => expandedGroups[label] ?? true, [expandedGroups]);

    // Auto-expand group that contains the active route (so user always sees where they are)
    useEffect(() => {
        if (!pathname || !user) return;
        const groups = getSidebarMenu(user);
        const activeGroup = groups.find(g =>
            g.items.some(item => item.href === '/dashboard' ? pathname === item.href : matchesPathSegment(pathname, item.href))
        );
        if (!activeGroup) return;
        setExpandedGroups(prev => {
            if (prev[activeGroup.label] === false) {
                const next = { ...prev, [activeGroup.label]: true };
                try { localStorage.setItem(SIDEBAR_EXPANSION_KEY, JSON.stringify(next)); } catch { /* ignore */ }
                return next;
            }
            return prev;
        });
    }, [pathname, user]);

    useEffect(() => {
        const reloadKey = `__chunk_reload__:${pathname}`;
        const markHealthy = () => {
            window.sessionStorage.removeItem(reloadKey);
        };
        const reloadOnce = () => {
            if (window.sessionStorage.getItem(reloadKey) === '1') return;
            window.sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
        };
        const isChunkScript = (target: EventTarget | null) =>
            target instanceof HTMLScriptElement && target.src.includes('/_next/static/chunks/');

        const handleWindowError = (event: Event) => {
            const typedEvent = event as ErrorEvent;
            if (isChunkScript(typedEvent.target) || typedEvent.message?.includes('Loading chunk')) {
                event.preventDefault();
                reloadOnce();
            }
        };

        const handleRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message = typeof reason === 'string'
                ? reason
                : reason instanceof Error
                    ? reason.message
                    : '';
            if (message.includes('ChunkLoadError') || message.includes('Loading chunk')) {
                event.preventDefault();
                reloadOnce();
            }
        };

        markHealthy();
        window.addEventListener('error', handleWindowError, true);
        window.addEventListener('unhandledrejection', handleRejection);
        return () => {
            window.removeEventListener('error', handleWindowError, true);
            window.removeEventListener('unhandledrejection', handleRejection);
        };
    }, [pathname]);

    const addToast = useCallback((type: ToastMessage['type'], message: string) => {
        const id = Math.random().toString(36).substring(7);
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const handleLogout = async () => {
        if (loggingOut) {
            return;
        }

        setLoggingOut(true);
        try {
            const res = await fetch('/api/auth/logout', { method: 'POST' });
            if (!res.ok && res.status !== 401) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.error || 'Gagal keluar dari sesi');
            }
            router.push('/login');
            router.refresh();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal keluar dari sesi');
        } finally {
            setLoggingOut(false);
        }
    };

    if (loading || !user) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#4f46e5', borderRadius: '50%' }} />
            </div>
        );
    }

    const menuGroups = getSidebarMenu(user);
    const sidebarToggleLabel = isMobile
        ? (mobileOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi')
        : (sidebarCollapsed ? 'Buka menu samping' : 'Ciutkan menu samping');
    const nonNavigableBreadcrumbs = new Set(['/fleet', '/settings']);
    const detailSegmentParents = new Set([
        'orders',
        'trips',
        'surat-jalan',
        'delivery-orders',
        'invoices',
        'customers',
        'borongan',
        'purchases',
        'items',
        'suppliers',
        'driver-vouchers',
        'bank-accounts',
        'vehicles',
        'drivers',
        'incidents',
    ]);
    const nonDetailChildSegments = new Set(['new', 'edit', 'skors', 'scoring']);

    // Breadcrumbs
    const pathParts = pathname.split('/').filter(Boolean);
    const breadcrumbs = pathParts.map((part, idx) => {
        const href = '/' + pathParts.slice(0, idx + 1).join('/');
        const previousPart = idx > 0 ? pathParts[idx - 1] : '';
        const labels: Record<string, string> = {
            dashboard: 'Dashboard', orders: 'Order', trips: 'Trip', 'surat-jalan': 'Surat Jalan', 'delivery-orders': 'Trip Lama',
            invoices: 'Invoice', customers: 'Customer', 'trip-rates': 'Biaya Rute Trip', services: 'Jenis Armada',
            'expense-categories': 'Kategori Biaya', expenses: 'Pengeluaran',
            employees: 'Karyawan', attendance: 'Absensi',
            accounting: 'Akuntansi', journals: 'Jurnal Umum', ledger: 'Buku Besar', accounts: 'Akun Perkiraan', statements: 'Laporan Keuangan',
            reports: 'Laporan', fleet: 'Armada', vehicles: 'Kendaraan', drivers: 'Supir',
            skors: 'Skors',
            scoring: 'Skors',
            maintenance: 'Maintenance', incidents: 'Insiden', settings: 'Pengaturan',
            profile: 'Akun Saya', password: 'Akun Saya', company: 'Perusahaan & Dokumen',
            users: 'Pengguna Internal', 'audit-logs': 'Audit Aktivitas', new: 'Baru', edit: 'Edit',
            tires: 'Ban', 'bank-accounts': 'Rekening & Kas', borongan: 'Riwayat Borongan', 'driver-vouchers': 'Uang Jalan Trip',
            inventory: 'Inventory', purchases: 'Pembelian', suppliers: 'Supplier', items: 'Barang Gudang',
            'stock-recap': 'Laporan Stok', 'material-usage': 'Pemakaian Barang',
        };
        const resolvedLabel =
            labels[part] ||
            (detailSegmentParents.has(previousPart) && !nonDetailChildSegments.has(part) ? 'Detail' : part);
        return {
            label: resolvedLabel,
            href,
            isLast: idx === pathParts.length - 1,
            isNavigable: !nonNavigableBreadcrumbs.has(href),
        };
    });

    return (
        <AppContext.Provider value={{ user, setUser }}>
            <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
                <div className="admin-layout" suppressHydrationWarning>
                    {/* Sidebar Overlay (Mobile) */}
                    <div
                        className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`}
                        onClick={() => setMobileOpen(false)}
                    />

                    {/* Sidebar */}
                    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
                        <div className="sidebar-logo">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={resolveCompanyLogoUrl(company)} alt="" className="sidebar-logo-img" />
                            <div className="sidebar-logo-text-wrap">
                                <span className="sidebar-logo-text">{company?.name || 'PT Gading Mas Surya'}</span>
                                <span className="sidebar-logo-subtitle">Panel Internal</span>
                            </div>
                        </div>

                        <nav className="sidebar-nav">
                            {menuGroups.map(group => {
                                const groupId = `sidebar-group-${group.label.replace(/\s+/g, '-')}`;
                                const expanded = sidebarCollapsed ? true : isGroupExpanded(group.label);
                                const hasActiveItem = group.items.some(item =>
                                    item.href === '/dashboard'
                                        ? pathname === item.href
                                        : matchesPathSegment(pathname, item.href)
                                );
                                return (
                                    <div
                                        key={group.label}
                                        className={`sidebar-group ${expanded ? 'sidebar-group--expanded' : 'sidebar-group--collapsed'} ${hasActiveItem ? 'sidebar-group--active' : ''}`}
                                    >
                                        <button
                                            type="button"
                                            className={`sidebar-group-header ${hasActiveItem ? 'sidebar-group-header--active' : ''}`}
                                            aria-expanded={expanded}
                                            aria-controls={groupId}
                                            onClick={() => {
                                                if (sidebarCollapsed) return;
                                                toggleGroup(group.label);
                                            }}
                                            tabIndex={sidebarCollapsed ? -1 : 0}
                                        >
                                            <span className="sidebar-group-label">{group.label}</span>
                                            <span className="sidebar-group-chevron" aria-hidden="true">
                                                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </span>
                                        </button>
                                        <div
                                            id={groupId}
                                            className="sidebar-group-items"
                                        >
                                            {group.items.map(item => {
                                                const isActive = item.href === '/dashboard'
                                                    ? pathname === item.href
                                                    : matchesPathSegment(pathname, item.href);
                                                return (
                                                    <Link
                                                        key={item.href}
                                                        href={item.href}
                                                        className={`sidebar-item ${isActive ? 'active' : ''}`}
                                                        onClick={() => setMobileOpen(false)}
                                                    >
                                                        <span className="sidebar-item-icon">{ICON_MAP[item.icon]}</span>
                                                        <span className="sidebar-item-label">{item.label}</span>
                                                        {item.badge && item.badge > 0 && (
                                                            <span className="sidebar-item-badge">{item.badge}</span>
                                                        )}
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </nav>

                        <div className="sidebar-footer">
                            <button className="sidebar-item" onClick={handleLogout} style={{ width: '100%' }} disabled={loggingOut}>
                                <span className="sidebar-item-icon"><LogOut size={20} /></span>
                                <span className="sidebar-item-label">{loggingOut ? 'Memproses...' : 'Keluar'}</span>
                            </button>
                        </div>
                    </aside>

                    {/* Main Content */}
                    <div className={`admin-content ${sidebarCollapsed ? 'collapsed' : ''}`}>
                        {/* Topbar */}
                        <header className={`topbar ${sidebarCollapsed ? 'collapsed' : ''}`}>
                            <div className="topbar-left">
                                <button
                                    className="topbar-toggle"
                                    onClick={() => {
                                        // On mobile, toggle mobile menu
                                        if (isMobile) {
                                            setMobileOpen(!mobileOpen);
                                        } else {
                                            setSidebarCollapsed(!sidebarCollapsed);
                                        }
                                    }}
                                    aria-label={sidebarToggleLabel}
                                    title={sidebarToggleLabel}
                                >
                                    {isMobile ? (mobileOpen ? <X size={20} /> : <Menu size={20} />) : (sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />)}
                                    {!isMobile && !isTablet && (
                                        <span className="topbar-toggle-label">
                                            {sidebarCollapsed ? 'Buka Menu' : 'Ciutkan Menu'}
                                        </span>
                                    )}
                                </button>

                                <nav className="breadcrumbs">
                                    {breadcrumbs.map((crumb, idx) => (
                                        <React.Fragment key={crumb.href}>
                                            {idx > 0 && <span className="breadcrumbs-separator">/</span>}
                                            {crumb.isLast || !crumb.isNavigable ? (
                                                <span className="breadcrumbs-current">{crumb.label}</span>
                                            ) : (
                                                <Link href={crumb.href}>{crumb.label}</Link>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </nav>
                            </div>

                            <div className="topbar-right">
                                <Link
                                    href="/settings/profile"
                                    className="topbar-user"
                                    title="Buka Akun Saya"
                                    aria-label="Buka Akun Saya"
                                >
                                    <div className="topbar-avatar">
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="topbar-user-info">
                                        <div className="topbar-user-name">{user.name}</div>
                                        <div className="topbar-user-role">{user.role}</div>
                                    </div>
                                </Link>
                            </div>
                        </header>

                        {/* Page Content */}
                        <main className="page-container">
                            {children}
                        </main>
                    </div>

                    {/* Toast Container */}
                    <div className="toast-container">
                        {toasts.map(toast => (
                            <div key={toast.id} className={`toast ${toast.type}`}>
                                <span className="toast-icon">
                                    {toast.type === 'success' && <CheckCircle size={20} />}
                                    {toast.type === 'error' && <XCircle size={20} />}
                                    {toast.type === 'info' && <Info size={20} />}
                                    {toast.type === 'warning' && <AlertCircle size={20} />}
                                </span>
                                <span className="toast-message">{toast.message}</span>
                                <button className="toast-close" onClick={() => removeToast(toast.id)}>
                                    <X size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </ToastContext.Provider>
        </AppContext.Provider>
    );
}
