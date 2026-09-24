import { hashPassword, verifyPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/api/data-helpers';
import { hasBearerDriverAuth, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { clearFailedAttempts, getRequestIp, recordLoginAttempt } from '@/lib/api/rate-limit';
import { getDocumentById, updateDocument } from '@/lib/repositories/document-store';
import type { User } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PASSWORD_ATTEMPT_LIMIT = 8;
const PASSWORD_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const NAME_MAX_LENGTH = 100;

function buildPasswordRateLimitKey(request: Request, userId: string) {
    return `driver-app-password:${userId}:${getRequestIp(request)}`;
}

function tooManyAttemptsResponse(retryAfterSeconds: number) {
    return jsonNoStore(
        { error: 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.' },
        {
            status: 429,
            headers: {
                'Retry-After': String(retryAfterSeconds),
            },
        }
    );
}

function normalizeDisplayName(value: unknown) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function buildAccountUserPayload(user: User) {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        driverRef: user.driverRef,
        driverName: user.driverName,
    };
}

export async function PATCH(request: Request) {
    try {
        if (!hasBearerDriverAuth(request)) {
            const originError = ensureSameOriginRequest(request);
            if (originError) {
                return originError;
            }
        }

        const auth = await requireDriverSessionContext(request);
        if ('error' in auth) {
            return jsonNoStore({ error: auth.error }, { status: auth.status });
        }

        const parsedBody = await parseJsonBody<{ name?: string }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const name = normalizeDisplayName(parsedBody.data.name);
        if (!name) {
            return jsonNoStore({ error: 'Nama wajib diisi' }, { status: 400 });
        }
        if (name.length > NAME_MAX_LENGTH) {
            return jsonNoStore({ error: `Nama maksimal ${NAME_MAX_LENGTH} karakter` }, { status: 400 });
        }

        const updated = await updateDocument<User>(auth.session._id, { name }, 'user');
        if (!updated) {
            return jsonNoStore({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
        }

        await writeAuditLog(
            auth.session,
            'UPDATE',
            'users',
            auth.session._id,
            'Driver mengubah nama akunnya sendiri dari aplikasi mobile'
        );

        return jsonNoStore({ success: true, user: buildAccountUserPayload(updated) });
    } catch (error) {
        console.error('Driver mobile account update error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        if (!hasBearerDriverAuth(request)) {
            const originError = ensureSameOriginRequest(request);
            if (originError) {
                return originError;
            }
        }

        const auth = await requireDriverSessionContext(request);
        if ('error' in auth) {
            return jsonNoStore({ error: auth.error }, { status: auth.status });
        }

        const rateLimitKey = buildPasswordRateLimitKey(request, auth.session._id);
        const rateLimitStatus = await recordLoginAttempt(
            rateLimitKey,
            PASSWORD_ATTEMPT_LIMIT,
            PASSWORD_ATTEMPT_WINDOW_MS
        );
        if (rateLimitStatus.limited) {
            return tooManyAttemptsResponse(rateLimitStatus.retryAfterSeconds);
        }

        const parsedBody = await parseJsonBody<{ currentPassword?: string; newPassword?: string }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const currentPassword = typeof parsedBody.data.currentPassword === 'string' ? parsedBody.data.currentPassword : '';
        const newPassword = typeof parsedBody.data.newPassword === 'string' ? parsedBody.data.newPassword : '';

        if (!currentPassword || !newPassword) {
            return jsonNoStore({ error: 'Password lama dan password baru wajib diisi' }, { status: 400 });
        }
        if (newPassword.length < 8) {
            return jsonNoStore({ error: 'Password baru minimal 8 karakter' }, { status: 400 });
        }
        if (currentPassword === newPassword) {
            return jsonNoStore({ error: 'Password baru harus berbeda dari password lama' }, { status: 400 });
        }

        const existing = await getDocumentById<User>(auth.session._id, 'user');
        if (!existing || !existing.passwordHash) {
            return jsonNoStore({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
        }

        const isValid = await verifyPassword(currentPassword, existing.passwordHash);
        if (!isValid) {
            return jsonNoStore({ error: 'Password lama salah' }, { status: 400 });
        }

        const updated = await updateDocument<User>(
            auth.session._id,
            { passwordHash: await hashPassword(newPassword) },
            'user'
        );
        if (!updated) {
            return jsonNoStore({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
        }

        await clearFailedAttempts(rateLimitKey);

        await writeAuditLog(
            auth.session,
            'UPDATE',
            'users',
            auth.session._id,
            'Driver mengubah password akunnya sendiri dari aplikasi mobile'
        );

        return jsonNoStore({ success: true });
    } catch (error) {
        console.error('Driver mobile password change error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
