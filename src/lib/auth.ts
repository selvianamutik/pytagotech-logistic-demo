/* ============================================================
   LOGISTIK - Auth Utilities
   JWT sessions with httpOnly cookies
   ============================================================ */

import { compare, hash } from 'bcryptjs';
import { cookies, headers } from 'next/headers';

import type { SessionUser, User } from './types';
import { normalizeUserRole } from './rbac';
import { getUserById } from './repositories/user-store';
import {
    createSessionToken,
    DRIVER_MOBILE_SESSION_MAX_AGE,
    DRIVER_REFRESH_SESSION_MAX_AGE,
    DRIVER_SESSION_COOKIE,
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    verifySessionToken,
} from './session';

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isPasswordHashMigrated(passwordHash: string) {
    return BCRYPT_HASH_RE.test(passwordHash);
}

export async function verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
    if (!storedHash) return false;
    if (!isPasswordHashMigrated(storedHash)) return false;
    return compare(plainPassword, storedHash);
}

export async function hashPassword(password: string): Promise<string> {
    return hash(password, 10);
}

export async function createSession(user: User): Promise<string> {
    const payload: SessionUser = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: normalizeUserRole(user.role),
        driverRef: user.driverRef,
        modulePermissions: user.modulePermissions,
    };

    return createSessionToken(payload);
}

export async function createDriverMobileSession(user: User): Promise<string> {
    const payload: SessionUser = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: normalizeUserRole(user.role),
        driverRef: user.driverRef,
        modulePermissions: user.modulePermissions,
    };

    return createSessionToken(payload, {
        maxAge: DRIVER_MOBILE_SESSION_MAX_AGE,
    });
}

export async function createDriverRefreshSession(user: User): Promise<string> {
    const payload: SessionUser = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: normalizeUserRole(user.role),
        driverRef: user.driverRef,
        modulePermissions: user.modulePermissions,
    };

    return createSessionToken(payload, {
        maxAge: DRIVER_REFRESH_SESSION_MAX_AGE,
        tokenType: 'refresh',
    });
}

export function buildSessionUser(user: User): SessionUser {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: normalizeUserRole(user.role),
        driverRef: user.driverRef,
        driverName: user.driverName,
        modulePermissions: user.modulePermissions,
    };
}

export async function getSessionFromToken(token: string): Promise<SessionUser | null> {
    try {
        const session = await verifySessionToken(token);
        const user = await getUserById(session._id);
        if (!user || user.active === false) {
            return null;
        }

        return buildSessionUser(user);
    } catch {
        return null;
    }
}

export async function getDriverSessionFromRefreshToken(token: string): Promise<SessionUser | null> {
    try {
        const session = await verifySessionToken(token, { tokenType: 'refresh' });
        const user = await getUserById(session._id);
        if (!user || user.active === false || normalizeUserRole(user.role) !== 'DRIVER' || !user.driverRef) {
            return null;
        }

        return buildSessionUser(user);
    } catch {
        return null;
    }
}

export async function getSession(cookieName = SESSION_COOKIE): Promise<SessionUser | null> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(cookieName)?.value;
        if (!token) return null;

        const session = await getSessionFromToken(token);
        if (!session) {
            cookieStore.delete(cookieName);
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

async function shouldUseSecureCookies(): Promise<boolean> {
    if (process.env.NODE_ENV !== 'production') return false;

    const headerStore = await headers();
    const forwardedProto = headerStore.get('x-forwarded-proto')?.toLowerCase();
    if (forwardedProto) {
        return forwardedProto === 'https';
    }

    const host = headerStore.get('host')?.toLowerCase() ?? '';
    return !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

export async function setSessionCookie(token: string, cookieName = SESSION_COOKIE): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(cookieName, token, {
        httpOnly: true,
        secure: await shouldUseSecureCookies(),
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE,
        path: '/',
    });
}

export async function clearSession(cookieName = SESSION_COOKIE): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(cookieName);
}

export async function getDriverSession(): Promise<SessionUser | null> {
    return getSession(DRIVER_SESSION_COOKIE);
}
