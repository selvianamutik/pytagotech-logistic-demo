/* ============================================================
   LOGISTIK - Proxy (Auth Route Guard)
   ============================================================ */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { matchesPathSegment } from '@/lib/pathname';
import { hasPageAccess, hasPermission, type AppModule, type ModulePermissions } from '@/lib/rbac';
import { DRIVER_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/session';
import type { SessionUser } from '@/lib/types';

type InternalPathAccess = {
    path: string;
    module: AppModule;
    fallbackModules?: AppModule[];
};

const INTERNAL_PATH_MODULES: InternalPathAccess[] = [
    { path: '/dashboard', module: 'dashboard' },
    { path: '/orders', module: 'orders' },
    { path: '/trips', module: 'deliveryOrders' },
    { path: '/surat-jalan', module: 'deliveryOrders' },
    { path: '/delivery-orders', module: 'deliveryOrders' },
    { path: '/invoices', module: 'invoices' },
    { path: '/employees', module: 'employees' },
    { path: '/attendance', module: 'attendance' },
    { path: '/suppliers', module: 'suppliers' },
    { path: '/inventory/purchases', module: 'purchases' },
    { path: '/inventory/items', module: 'warehouseItems' },
    { path: '/inventory/material-usage', module: 'maintenance' },
    { path: '/inventory/stock-recap', module: 'warehouseItems' },
    { path: '/inventory', module: 'warehouseItems', fallbackModules: ['suppliers', 'purchases', 'maintenance'] },
    { path: '/customers', module: 'customers' },
    { path: '/trip-rates', module: 'tripRouteRates' },
    { path: '/services', module: 'services' },
    { path: '/expense-categories', module: 'expenseCategories' },
    { path: '/expenses', module: 'expenses' },
    { path: '/reports', module: 'reports' },
    { path: '/fleet/vehicles', module: 'vehicles' },
    { path: '/fleet/drivers/skors', module: 'driverScores' },
    { path: '/fleet/drivers', module: 'drivers' },
    { path: '/fleet/maintenance', module: 'maintenance' },
    { path: '/fleet/tires', module: 'tires' },
    { path: '/fleet/incidents', module: 'incidents' },
    { path: '/bank-accounts', module: 'bankAccounts' },
    { path: '/accounting/accounts', module: 'reports' },
    { path: '/accounting/journals', module: 'reports' },
    { path: '/accounting/ledger', module: 'reports' },
    { path: '/accounting/statements', module: 'reports' },
    { path: '/driver-vouchers', module: 'driverVouchers' },
    { path: '/borongan', module: 'driverBorongans' },
    { path: '/settings/profile', module: 'profile' },
    { path: '/settings/password', module: 'profile' },
    { path: '/settings/company', module: 'companySettings' },
    { path: '/settings/import-data', module: 'dataImports' },
    { path: '/settings/users', module: 'userManagement' },
    { path: '/settings/audit-logs', module: 'auditLogs' },
];

function isAdminLoginPath(pathname: string) {
    return matchesPathSegment(pathname, '/login');
}

function isRemovedDriverPortalPath(pathname: string) {
    return matchesPathSegment(pathname, '/driver');
}

function getAccessForPath(pathname: string) {
    const matched = INTERNAL_PATH_MODULES.find(item => matchesPathSegment(pathname, item.path));
    return matched || null;
}

function getRequiredModuleAction(pathname: string): keyof ModulePermissions {
    if (pathname.endsWith('/new')) {
        return 'create';
    }
    if (pathname.endsWith('/edit')) {
        return 'update';
    }
    return 'view';
}

function redirectToAccessDeniedDashboard(request: NextRequest) {
    const targetUrl = new URL('/dashboard', request.url);
    targetUrl.searchParams.set('access', 'denied');
    return NextResponse.redirect(targetUrl);
}

async function getLiveSessionUser(
    request: NextRequest,
    token: string
): Promise<{ user: SessionUser | null; checkedLive: boolean }> {
    try {
        const response = await fetch(new URL('/api/auth/session', request.url), {
            headers: {
                cookie: `${SESSION_COOKIE}=${token}`,
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            return { user: null, checkedLive: true };
        }

        const payload = await response.json() as { user?: SessionUser | null };
        return { user: payload.user || null, checkedLive: true };
    } catch {
        return { user: null, checkedLive: false };
    }
}

function clearDriverWebSessionCookie(response: NextResponse) {
    response.cookies.delete(DRIVER_SESSION_COOKIE);
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const adminLoginPath = isAdminLoginPath(pathname);

    if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    if (isRemovedDriverPortalPath(pathname)) {
        const response = NextResponse.redirect(new URL('/login', request.url));
        clearDriverWebSessionCookie(response);
        return response;
    }

    const adminToken = request.cookies.get(SESSION_COOKIE)?.value;
    const legacyDriverToken = request.cookies.get(DRIVER_SESSION_COOKIE)?.value;

    if (adminLoginPath) {
        if (adminToken) {
            const live = await getLiveSessionUser(request, adminToken);
            const user = live.user;
            if (user && user.role !== 'DRIVER') {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }
            if (!user) {
                const response = NextResponse.next();
                response.cookies.delete(SESSION_COOKIE);
                return response;
            }
        }

        if (legacyDriverToken) {
            const response = NextResponse.next();
            clearDriverWebSessionCookie(response);
            return response;
        }

        return NextResponse.next();
    }

    if (pathname === '/') {
        if (adminToken) {
            const live = await getLiveSessionUser(request, adminToken);
            const user = live.user;
            if (user && user.role !== 'DRIVER') {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }
        }
        const response = NextResponse.redirect(new URL('/login', request.url));
        if (legacyDriverToken) {
            clearDriverWebSessionCookie(response);
        }
        return response;
    }

    try {
        if (!adminToken) {
            const response = NextResponse.redirect(new URL('/login', request.url));
            if (legacyDriverToken) {
                clearDriverWebSessionCookie(response);
            }
            return response;
        }

        const live = await getLiveSessionUser(request, adminToken);
        const user = live.user;
        if (!user) {
            const response = NextResponse.redirect(new URL('/login', request.url));
            response.cookies.delete(SESSION_COOKIE);
            if (legacyDriverToken) {
                clearDriverWebSessionCookie(response);
            }
            return response;
        }

        if (user.role === 'DRIVER') {
            const response = NextResponse.redirect(new URL('/login', request.url));
            response.cookies.delete(SESSION_COOKIE);
            clearDriverWebSessionCookie(response);
            return response;
        }

        const targetAccess = getAccessForPath(pathname);
        const requiredAction = getRequiredModuleAction(pathname);
        const targetModules = targetAccess
            ? [targetAccess.module, ...(targetAccess.fallbackModules || [])]
            : [];
        const hasAccess = targetModules.length > 0
            ? targetModules.some(module => (requiredAction === 'view'
                ? hasPageAccess(user, module)
                : hasPermission(user, module, requiredAction)))
            : true;

        if (targetAccess && !hasAccess) {
            return redirectToAccessDeniedDashboard(request);
        }

        const response = NextResponse.next();
        if (legacyDriverToken) {
            clearDriverWebSessionCookie(response);
        }
        return response;
    } catch {
        const response = NextResponse.redirect(new URL('/login', request.url));
        response.cookies.delete(SESSION_COOKIE);
        clearDriverWebSessionCookie(response);
        return response;
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
