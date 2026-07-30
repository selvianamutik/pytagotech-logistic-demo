import { hashPassword } from '@/lib/auth';
import { sanitizeUserForClient, writeAuditLog } from '@/lib/api/data-helpers';
import { requireInternalSession } from '@/lib/api/driver-portal';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { createDocument, getDocumentById, listDocumentsByFilter, updateDocument } from '@/lib/repositories/document-store';
import type { Driver, User } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function addAuditLog(actor: { _id: string; name: string; email?: string; role?: User['role'] }, action: string, entityRef: string, summary: string) {
    await writeAuditLog(actor, action, 'driverMobileAccess', entityRef, summary);
}

async function getDuplicateEmail(email: string, excludeId?: string) {
    const users = await listDocumentsByFilter<User>('user', { email: email.toLowerCase() });
    return users.find(user => user._id !== excludeId) || null;
}

async function getDuplicateDriverAccount(driverRef: string, excludeId?: string) {
    const users = await listDocumentsByFilter<User>('user', { role: 'DRIVER', driverRef });
    return users.find(user => user._id !== excludeId) || null;
}

async function deactivateDriverAccountAtomically(input: {
    session: { _id: string; name: string };
    accountId: string;
    accountUpdates: Record<string, unknown>;
    driverRef: string;
    driverName: string;
}) {
    const now = new Date().toISOString();
    const [driver, trackedDeliveryOrders] = await Promise.all([
        getDocumentById<Driver>(input.driverRef, 'driver'),
        listDocumentsByFilter<Array<{ _id: string; doNumber?: string; status?: string; trackingState?: string }>[number]>('deliveryOrder', { driverRef: input.driverRef }),
    ]);

    const activeTrackedDeliveryOrders = trackedDeliveryOrders.filter(deliveryOrder =>
        deliveryOrder.trackingState === 'ACTIVE' || deliveryOrder.trackingState === 'PAUSED'
    );

    await updateDocument(input.accountId, input.accountUpdates);

    if (driver) {
        await updateDocument(input.driverRef, {
            activeTrackingUpdatedAt: now,
            activeTrackingDeliveryOrderRef: null,
        });
    }

    for (const deliveryOrder of activeTrackedDeliveryOrders) {
        await updateDocument(deliveryOrder._id, {
            trackingState: 'STOPPED',
            trackingStoppedAt: now,
            trackingLastSeenAt: now,
        });
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: deliveryOrder._id,
            status: deliveryOrder.status || 'ON_DELIVERY',
            note: `Tracking dihentikan otomatis karena akun mobile driver ${input.driverName} dinonaktifkan`,
            source: 'DRIVER_APP',
            timestamp: now,
            userRef: input.session._id,
            userName: input.session.name,
        });
    }

    return { stoppedTrackingCount: activeTrackedDeliveryOrders.length };
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

export async function GET(request: Request) {
    const auth = await requireInternalSession(['OWNER', 'ARMADA', 'FINANCE', 'OPERASIONAL']);
    if ('error' in auth) {
        return jsonNoStore({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const driverRefsParam = searchParams.get('driverRefs');
    const countOnly = searchParams.get('countOnly') === '1';
    const activeOnly = searchParams.get('activeOnly') === '1';
    const driverRefs = driverRefsParam
        ? driverRefsParam.split(',').map(value => value.trim()).filter(Boolean)
        : [];

    if (countOnly) {
        const allAccounts = await listDocumentsByFilter<User>('user', { role: 'DRIVER' });
        const total = allAccounts.filter(account => {
            if (activeOnly && account.active === false) return false;
            if (driverRefs.length > 0 && (!account.driverRef || !driverRefs.includes(account.driverRef))) return false;
            return true;
        }).length;
        return jsonNoStore({ data: [], meta: { total } });
    }

    const accounts = (await listDocumentsByFilter<Pick<User, '_id' | 'name' | 'email' | 'active' | 'driverRef' | 'driverName' | 'lastLoginAt' | 'role'>>('user', { role: 'DRIVER' }))
        .filter(account => {
            if (activeOnly && account.active === false) return false;
            if (driverRefs.length > 0 && (!account.driverRef || !driverRefs.includes(account.driverRef))) return false;
            return true;
        })
        .sort((left, right) => (left.name || '').localeCompare(right.name || ''));

    return jsonNoStore({ data: accounts });
}

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    const auth = await requireInternalSession(['OWNER', 'ARMADA']);
    if ('error' in auth) {
        return jsonNoStore({ error: auth.error }, { status: auth.status });
    }

    try {
        const parsedBody = await parseJsonBody<{
            action?: string;
            id?: string;
            driverRef?: string;
            name?: string;
            email?: string;
            password?: string;
            active?: boolean;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const body = parsedBody.data;

        const action =
            body.action === 'create' || body.action === 'update'
                ? body.action
                : '';
        const driverRef = normalizeText(body.driverRef);
        const name = normalizeText(body.name);
        const email = normalizeText(body.email).toLowerCase();
        const password = typeof body.password === 'string' ? body.password.trim() : '';

        if (!action) {
            return jsonNoStore({ error: 'Aksi akun driver tidak valid' }, { status: 400 });
        }

        if (!driverRef || !name || !email) {
            return jsonNoStore({ error: 'Nama, email, dan supir wajib diisi' }, { status: 400 });
        }

        const driver = await getDocumentById<Driver>(driverRef, 'driver');
        if (!driver) {
            return jsonNoStore({ error: 'Supir tidak ditemukan' }, { status: 404 });
        }
        if (driver.active === false) {
            return jsonNoStore({ error: 'Supir tidak aktif dan tidak bisa diberi akun mobile' }, { status: 409 });
        }

        if (action === 'create') {
            if (password.length < 8) {
                return jsonNoStore({ error: 'Password minimal 8 karakter' }, { status: 400 });
            }

            const duplicateEmail = await getDuplicateEmail(email);
            if (duplicateEmail) {
                return jsonNoStore({ error: 'Email user sudah digunakan' }, { status: 409 });
            }

            const duplicateDriverAccount = await getDuplicateDriverAccount(driverRef);
            if (duplicateDriverAccount) {
                return jsonNoStore({ error: 'Supir ini sudah memiliki akun mobile' }, { status: 409 });
            }

            const created = await createDocument<User>({
                _type: 'user',
                name,
                email,
                role: 'DRIVER',
                driverRef,
                driverName: driver.name,
                passwordHash: await hashPassword(password),
                active: typeof body.active === 'boolean' ? body.active : true,
                createdAt: new Date().toISOString(),
            });

            await addAuditLog(auth.session, 'CREATE', created._id, `Membuat akun driver mobile untuk ${driver.name}`);
            return jsonNoStore({ data: sanitizeUserForClient(created) });
        }

        const id = normalizeText(body.id);
        if (!id) {
            return jsonNoStore({ error: 'ID akun driver tidak valid' }, { status: 400 });
        }

        const existing = await getDocumentById<User & { _rev?: string }>(id, 'user');
        if (!existing || existing.role !== 'DRIVER') {
            return jsonNoStore({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
        }

        const duplicateEmail = await getDuplicateEmail(email, id);
        if (duplicateEmail) {
            return jsonNoStore({ error: 'Email user sudah digunakan' }, { status: 409 });
        }

        const duplicateDriverAccount = await getDuplicateDriverAccount(driverRef, id);
        if (duplicateDriverAccount) {
            return jsonNoStore({ error: 'Supir ini sudah memiliki akun mobile' }, { status: 409 });
        }

        const updates: Record<string, unknown> = {
            name,
            email,
            driverRef,
            driverName: driver.name,
        };

        if (typeof body.active === 'boolean') {
            updates.active = body.active;
        }

        if (password) {
            if (password.length < 8) {
                return jsonNoStore({ error: 'Password minimal 8 karakter' }, { status: 400 });
            }
            updates.passwordHash = await hashPassword(password);
        }

        const isDeactivatingAccount = existing.active !== false && updates.active === false;
        let stoppedTrackingCount = 0;

        let updated: User;
        if (isDeactivatingAccount) {
            const trackingResult = await deactivateDriverAccountAtomically({
                session: auth.session,
                accountId: id,
                accountUpdates: updates,
                driverRef,
                driverName: driver.name,
            });
            stoppedTrackingCount = trackingResult.stoppedTrackingCount;
            const refreshed = await getDocumentById<User>(id, 'user');
            if (!refreshed) {
                return jsonNoStore({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
            }
            updated = refreshed;
        } else {
            updated = await updateDocument<User>(id, updates);
        }

        await addAuditLog(auth.session, 'UPDATE', id, `Memperbarui akun driver mobile untuk ${driver.name}`);
        return jsonNoStore({
            data: sanitizeUserForClient(updated),
            meta: {
                stoppedTrackingCount,
            },
        });
    } catch (error) {
        console.error('Driver account route error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
