import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import {
    editDeliveredSuratJalanCustomerDrop,
    type EditDeliveredSuratJalanErrorCode,
    type EditDeliveredSuratJalanPodEntry,
} from '@/lib/api/surat-jalan-post-delivery-edit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ERROR_STATUS: Record<EditDeliveredSuratJalanErrorCode, number> = {
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    VOIDED: 409,
    NOT_DELIVERED: 409,
    EMPTY_EDIT: 400,
    BILLING_LOCKED: 409,
    LOCKED: 409,
};

/**
 * `podEntries` datang dari body yang sepenuhnya dikontrol client, jadi bentuk
 * tiap entry diperiksa satu per satu. Entry yang bukan objek atau bukan array
 * diabaikan supaya satu entri rusak tidak mematikan seluruh request; yang lolos
 * di sini tetap dicocokkan ke titik drop nyata oleh server.
 */
function readPodEntries(value: unknown): EditDeliveredSuratJalanPodEntry[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(raw => {
        if (typeof raw !== 'object' || raw === null) return [];
        const entry = raw as Record<string, unknown>;
        return [{
            dropPointKey: typeof entry.dropPointKey === 'string' ? entry.dropPointKey : undefined,
            dropPointSequence: typeof entry.dropPointSequence === 'number' ? entry.dropPointSequence : undefined,
            podReceiverName: typeof entry.podReceiverName === 'string' ? entry.podReceiverName : undefined,
            podReceivedDate: typeof entry.podReceivedDate === 'string' ? entry.podReceivedDate : undefined,
            podNote: typeof entry.podNote === 'string' ? entry.podNote : undefined,
        }];
    });
}

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) return originError;

    const session = await getSession();
    if (!session) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'DRIVER') {
        return jsonNoStore({ error: 'Driver tidak diizinkan mengakses API admin' }, { status: 403 });
    }
    if (!hasPermission(session, 'suratJalan', 'update')) {
        return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }

    const parsed = await parseJsonBody<Record<string, unknown>>(request);
    if ('error' in parsed) return parsed.error;

    const body = parsed.data || {};

    // Aktor selalu berasal dari session, tidak pernah dari body request.
    const result = await editDeliveredSuratJalanCustomerDrop(
        {
            sjRef: typeof body.sjRef === 'string' ? body.sjRef : '',
            customerRef: typeof body.customerRef === 'string' ? body.customerRef : '',
            customerName: typeof body.customerName === 'string' ? body.customerName : '',
            dropPointName: typeof body.dropPointName === 'string' ? body.dropPointName : '',
            suratJalanNumber: typeof body.suratJalanNumber === 'string' ? body.suratJalanNumber : '',
            // POD ikut diteruskan. Kalau field ini tidak diteruskan, isian POD di
            // form akan hilang diam-diam karena server tidak pernah menerimanya.
            podReceiverName: typeof body.podReceiverName === 'string' ? body.podReceiverName : '',
            podReceivedDate: typeof body.podReceivedDate === 'string' ? body.podReceivedDate : '',
            podNote: typeof body.podNote === 'string' ? body.podNote : '',
            podEntries: readPodEntries(body.podEntries),
        },
        { ref: session._id, name: session.name },
    );

    if (!result.ok) {
        return jsonNoStore(
            { error: result.error.message, code: result.error.code },
            { status: ERROR_STATUS[result.error.code] ?? 400 },
        );
    }

    return jsonNoStore(
        {
            ok: true,
            sjRef: result.sjRef,
            tripRef: result.tripRef,
            referenceKey: result.referenceKey,
            suratJalanNumber: result.suratJalanNumber,
            editedAfterDelivery: result.editedAfterDelivery,
            snapshot: result.snapshot,
        },
        { status: 200 },
    );
}
