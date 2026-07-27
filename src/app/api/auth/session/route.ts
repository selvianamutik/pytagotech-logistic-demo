import { getSession } from '@/lib/auth';
import { getUserById } from '@/lib/repositories/user-store';
import { buildSessionUser } from '@/lib/auth';
import { jsonNoStore } from '@/lib/api/request-security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
    const session = await getSession();
    if (!session) {
        return jsonNoStore({ user: null }, { status: 401 });
    }

    // Always fetch fresh user from DB so modulePermissions (stored in extra_data)
    // reflects any permission changes made since the JWT was issued.
    const freshUser = await getUserById(session._id);
    const user = freshUser && freshUser.active !== false
        ? buildSessionUser(freshUser)
        : session;

    return jsonNoStore({ user });
}
