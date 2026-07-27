import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { clearRelationalReadCache } from '@/lib/supabase-relational';

import { getBusinessDateValue } from '@/lib/business-date';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { isSupabaseBackendEnabled } from '@/lib/data-backend';
import {
    createDocument,
    deleteDocument,
    getDocumentById,
    getNextNumber,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';

import {
    assertIsoDate,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

const MANAGEABLE_USER_ROLES = ['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA', 'DRIVER'] as const;

function extractRefId(value: unknown) {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && '_ref' in value && typeof (value as { _ref?: unknown })._ref === 'string') {
        return (value as { _ref: string })._ref;
    }
    return '';
}

function parseStrictInvoiceNumber(
    value: unknown,
    label: string,
    options?: { allowDecimal?: boolean; maxFractionDigits?: number }
) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed || !/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            throw new Error(label);
        }
        if (options?.allowDecimal === false) {
            const groupedIntegerPattern = /^-?\d{1,3}(?:[.,]\d{3})*$/;
            const plainIntegerPattern = /^-?\d+$/;
            if (!groupedIntegerPattern.test(trimmed) && !plainIntegerPattern.test(trimmed)) {
                throw new Error(label);
            }
        }
    }

    const normalized = normalizeNumber(value, options);
    if (!Number.isFinite(normalized)) {
        throw new Error(label);
    }
    return normalized;
}

async function validateDriverAccountLink(driverRef: unknown, excludeUserId?: string) {
    const normalizedDriverRef = normalizeText(driverRef);
    if (!normalizedDriverRef) {
        throw new Error('Supir untuk akun mobile wajib dipilih');
    }

    const driver = await getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(normalizedDriverRef, 'driver');
    if (!driver) {
        throw new Error('Data supir untuk akun mobile tidak ditemukan');
    }
    if (driver.active === false) {
        throw new Error('Supir tidak aktif dan tidak bisa diberi akun mobile');
    }
    const duplicateDriverAccount =
        (await listDocumentsByFilter<{ _id: string; role?: string; driverRef?: string }>('user', {
            role: 'DRIVER',
            driverRef: normalizedDriverRef,
        })).find(user => user._id !== (excludeUserId || '')) || null;
    if (duplicateDriverAccount) {
        throw new Error('Supir ini sudah memiliki akun mobile');
    }

    return {
        driverRef: normalizedDriverRef,
        driverName: driver.name || undefined,
        driverRevision: driver._rev,
    };
}

export async function normalizeUserCreatePayload(data: Record<string, unknown>) {
    const name = normalizeText(data.name);
    const email = normalizeText(data.email).toLowerCase();
    const password = typeof data.password === 'string' ? data.password.trim() : '';
    const role =
        typeof data.role === 'string' && MANAGEABLE_USER_ROLES.includes(data.role as typeof MANAGEABLE_USER_ROLES[number])
            ? data.role
            : null;
    if (!name || !email) {
        throw new Error('Nama dan email wajib diisi');
    }
    if (!role) {
        throw new Error('Role user tidak valid');
    }
    if (password.length < 8) {
        throw new Error('Password minimal 8 karakter');
    }

    const existingEmail =
        (await listDocumentsByFilter<{ _id: string; email?: string }>('user', { email }))[0] || null;
    if (!isSupabaseBackendEnabled()) {
        throw new Error('Backend Supabase wajib aktif untuk membuat user');
    }
    if (existingEmail) {
        throw new Error('Email user sudah digunakan');
    }

    const driverLink = role === 'DRIVER'
        ? await validateDriverAccountLink(data.driverRef)
        : { driverRef: undefined, driverName: undefined, driverRevision: undefined };

    return {
        name,
        email,
        role,
        driverRef: driverLink.driverRef,
        driverName: driverLink.driverName,
        driverRevision: driverLink.driverRevision,
        passwordHash: await hashPassword(password),
        active: true,
        createdAt: new Date().toISOString(),
    };
}

export type NormalizeUserUpdatesResult = {
    updates: Record<string, unknown>;
    extra_data?: Record<string, unknown>;
};

export async function normalizeUserUpdates(
    session: ApiSession,
    targetUserId: string,
    updates: Record<string, unknown>,
    currentPassword: unknown
): Promise<NormalizeUserUpdatesResult> {
    const allowedOwnerFields = new Set(['name', 'email', 'role', 'active', 'driverRef', 'password', 'modulePermissions']);
    const allowedSelfFields = new Set(['name', 'password']);
    const existingUser = await getDocumentById<{ _id: string; email: string; role: string; active: boolean; passwordHash: string; driverRef?: string; extra_data?: Record<string, unknown> }>(
        targetUserId,
        'user'
    );
    if (!existingUser) {
        throw new Error('User tidak ditemukan');
    }

    const isSelfUpdate = session._id === targetUserId;

    const allowedFields = isSelfUpdate ? allowedSelfFields : allowedOwnerFields;
    if (Object.keys(updates).some(key => !allowedFields.has(key))) {
        throw new Error(isSelfUpdate ? 'Perubahan profil ini tidak diizinkan' : 'Field user tidak valid');
    }

    const nextUpdates: Record<string, unknown> = {};
    for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
            nextUpdates[key] = updates[key];
        }
    }

    if (typeof nextUpdates.name === 'string') {
        const normalizedName = nextUpdates.name.trim();
        if (!normalizedName) {
            throw new Error('Nama wajib diisi');
        }
        nextUpdates.name = normalizedName;
    }

    if (typeof nextUpdates.email === 'string') {
        const normalizedEmail = nextUpdates.email.trim().toLowerCase();
        if (!normalizedEmail) {
            throw new Error('Email wajib diisi');
        }
        const duplicateEmail =
            (await listDocumentsByFilter<{ _id: string; email?: string }>('user', { email: normalizedEmail }))
                .find(user => user._id !== targetUserId) || null;
        if (duplicateEmail) {
            throw new Error('Email user sudah digunakan');
        }
        nextUpdates.email = normalizedEmail;
    }

    if (
        typeof nextUpdates.role === 'string' &&
        !MANAGEABLE_USER_ROLES.includes(nextUpdates.role as typeof MANAGEABLE_USER_ROLES[number])
    ) {
        throw new Error('Role user tidak valid');
    }

    if ('active' in nextUpdates && typeof nextUpdates.active !== 'boolean') {
        throw new Error('Status user tidak valid');
    }

    // Pre-read current extra_data for modulePermissions normalization.
    // We need to do a read-then-update because Supabase JSONB PATCH merges
    // (adds to the object) — we can't delete keys via merge.
    let currentExtraData: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(updates, 'modulePermissions')) {
        const supabase = getSupabaseClient();
        const params = new URLSearchParams();
        params.set('select', 'source_document_id,extra_data');
        params.set('source_document_id', `eq.${targetUserId}`);
        params.set('limit', '1');
        const response = await supabase.fetch(`app_users?${params.toString()}`);
        const rows = (await response.json() as unknown) as Array<{ source_document_id: string; extra_data: Record<string, unknown> | null }> | undefined;
        const row = rows?.[0];
        if (row && row.extra_data && typeof row.extra_data === 'object') {
            currentExtraData = { ...row.extra_data };
        }
    }

    if (Object.prototype.hasOwnProperty.call(nextUpdates, 'modulePermissions')) {
        if (nextUpdates.modulePermissions === null || nextUpdates.modulePermissions === '__reset__') {
            // Reset: delete modulePermissions from extra_data and write back
            delete currentExtraData.modulePermissions;
            const supabase = getSupabaseClient();
            await supabase.fetch(`app_users?source_document_id=eq.${encodeURIComponent(targetUserId)}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ extra_data: currentExtraData }),
            });
            clearRelationalReadCache();
            delete nextUpdates.modulePermissions;
        } else if (typeof nextUpdates.modulePermissions !== 'object' || Array.isArray(nextUpdates.modulePermissions)) {
            delete nextUpdates.modulePermissions;
        } else {
            // Compute the final desired extra_data: true = explicitly assigned,
            // false = explicitly denied, absent = role default.
            const desired: Record<string, unknown> = { ...currentExtraData };
            const raw = nextUpdates.modulePermissions as Record<string, unknown>;
            const entries = Object.entries(raw)
                .filter(([mod, val]) => mod !== '__reset__' && (val === true || val === false));
            if (entries.length === 0) {
                delete desired.modulePermissions;
            } else {
                desired.modulePermissions = Object.fromEntries(entries);
            }
            // Write the complete final extra_data to DB — avoids JSONB merge pitfalls
            const supabase = getSupabaseClient();
            await supabase.fetch(`app_users?source_document_id=eq.${encodeURIComponent(targetUserId)}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ extra_data: desired }),
            });
            clearRelationalReadCache();
            // Sync the updated extra_data so subsequent permission checks
            // and the return value reflect the new state
            existingUser.extra_data = desired;
            currentExtraData = desired;
            delete nextUpdates.modulePermissions;
        }
    }

    const nextRole =
        typeof nextUpdates.role === 'string' ? nextUpdates.role : existingUser.role;
    const nextActive =
        typeof nextUpdates.active === 'boolean' ? nextUpdates.active : existingUser.active;

    if (isSelfUpdate && !nextActive) {
        throw new Error('Anda tidak dapat menonaktifkan akun sendiri');
    }

    if (existingUser.role === 'OWNER' && (nextRole !== 'OWNER' || !nextActive)) {
        const otherActiveOwners = (
            await listDocumentsByFilter<{ _id: string; role?: string; active?: boolean }>('user', {
                role: 'OWNER',
                active: true,
            })
        ).filter(user => user._id !== targetUserId).length;
        if (otherActiveOwners === 0) {
            throw new Error('Minimal harus ada satu OWNER aktif');
        }
    }

    if (nextRole === 'DRIVER' || existingUser.role === 'DRIVER' || Object.prototype.hasOwnProperty.call(nextUpdates, 'driverRef')) {
        if (nextRole === 'DRIVER') {
            const driverLink = await validateDriverAccountLink(
                Object.prototype.hasOwnProperty.call(nextUpdates, 'driverRef') ? nextUpdates.driverRef : existingUser.driverRef,
                targetUserId
            );
            nextUpdates.driverRef = driverLink.driverRef;
            nextUpdates.driverName = driverLink.driverName;
            nextUpdates.driverRevision = driverLink.driverRevision;
        } else {
            nextUpdates.driverRef = undefined;
            nextUpdates.driverName = undefined;
            nextUpdates.driverRevision = undefined;
        }
    }

    const rawPassword = typeof nextUpdates.password === 'string' ? nextUpdates.password : null;

    if (rawPassword !== null) {
        const password = rawPassword.trim();
        if (password.length < 8) {
            throw new Error('Password minimal 8 karakter');
        }

        if (isSelfUpdate) {
            if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
                throw new Error('Password saat ini wajib diisi');
            }

            const validCurrentPassword = await verifyPassword(currentPassword, existingUser.passwordHash);
            if (!validCurrentPassword) {
                throw new Error('Password saat ini tidak valid');
            }
        }

        nextUpdates.passwordHash = await hashPassword(password);
    }

    delete nextUpdates.password;
    // Return the computed extra_data so the caller can sync it into the returned document
    // (updateDocument does not know about modulePermissions changes done via direct DB write)
    const hasExtraDataUpdate = Object.prototype.hasOwnProperty.call(updates, 'modulePermissions');
    return {
        updates: nextUpdates,
        ...(hasExtraDataUpdate ? { extra_data: currentExtraData } : {}),
    };
}

export async function handleInvoiceCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.filter(isPlainObject);
    if (items.length === 0) {
        return NextResponse.json({ error: 'Item invoice wajib diisi' }, { status: 400 });
    }

    const totalAmount = normalizeCurrencyNumber(data.totalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return NextResponse.json({ error: 'Total invoice tidak valid' }, { status: 400 });
    }

    const issueDate =
        normalizeOptionalText(data.issueDate) ||
        normalizeOptionalText(data.date) ||
        getBusinessDateValue();
    const dueDate =
        normalizeOptionalText(data.dueDate) ||
        normalizeOptionalText(data.date) ||
        issueDate;
    try {
        assertIsoDate(issueDate, 'Tanggal invoice');
        assertIsoDate(dueDate, 'Tanggal jatuh tempo invoice');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal invoice tidak valid' },
            { status: 400 }
        );
    }

    const hasMode = Object.prototype.hasOwnProperty.call(data, 'mode');
    const modeValue = typeof data.mode === 'string' ? data.mode : '';
    if (hasMode && modeValue !== 'ORDER' && modeValue !== 'DO') {
        return NextResponse.json({ error: 'Mode invoice tidak valid' }, { status: 400 });
    }
    const orderRef = normalizeOptionalText(data.orderRef);
    const doRef = normalizeOptionalText(data.doRef);
    const customerRef = normalizeOptionalText(data.customerRef);
    const customerName = normalizeOptionalText(data.customerName);
    const masterResi = normalizeOptionalText(data.masterResi);
    const notes = normalizeOptionalText(data.notes);

    const requestedOrderDoc = orderRef
        ? await getDocumentById<{ _id: string; customerRef?: unknown; customerName?: string; masterResi?: string }>(orderRef, 'order')
        : null;
    if (orderRef && !requestedOrderDoc) {
        return NextResponse.json({ error: 'Order invoice tidak ditemukan' }, { status: 404 });
    }

    const deliveryOrderDoc = doRef
        ? await getDocumentById<{
            _id: string;
            orderRef?: unknown;
            customerRef?: unknown;
            customerName?: string;
            doNumber?: string;
            masterResi?: string;
        }>(doRef, 'deliveryOrder')
        : null;
    if (doRef && !deliveryOrderDoc) {
        return NextResponse.json({ error: 'Surat jalan invoice tidak ditemukan' }, { status: 404 });
    }

    const requestedCustomerDoc = customerRef
        ? await getDocumentById<{ _id: string; name?: string }>(customerRef, 'customer')
        : null;
    if (customerRef && !requestedCustomerDoc) {
        return NextResponse.json({ error: 'Customer invoice tidak ditemukan' }, { status: 404 });
    }

    const doOrderRef = extractRefId(deliveryOrderDoc?.orderRef);
    if (orderRef && doOrderRef && doOrderRef !== orderRef) {
        return NextResponse.json({ error: 'Surat jalan tidak berasal dari order invoice yang dipilih' }, { status: 400 });
    }

    const resolvedOrderDoc =
        requestedOrderDoc ||
        (doOrderRef
            ? await getDocumentById<{ _id: string; customerRef?: unknown; customerName?: string; masterResi?: string }>(doOrderRef, 'order')
            : null);

    if (doOrderRef && !resolvedOrderDoc) {
        return NextResponse.json({ error: 'Order sumber surat jalan invoice tidak ditemukan' }, { status: 404 });
    }

    const orderCustomerRef = extractRefId(resolvedOrderDoc?.customerRef);
    const doCustomerRef = extractRefId(deliveryOrderDoc?.customerRef);
    if (customerRef && orderCustomerRef && orderCustomerRef !== customerRef) {
        return NextResponse.json({ error: 'Customer invoice tidak cocok dengan order yang dipilih' }, { status: 400 });
    }
    if (customerRef && doCustomerRef && doCustomerRef !== customerRef) {
        return NextResponse.json({ error: 'Customer invoice tidak cocok dengan surat jalan yang dipilih' }, { status: 400 });
    }
    if (orderCustomerRef && doCustomerRef && orderCustomerRef !== doCustomerRef) {
        return NextResponse.json({ error: 'Order dan surat jalan invoice tidak berasal dari customer yang sama' }, { status: 400 });
    }
    const inferredCustomerRef = customerRef || orderCustomerRef || doCustomerRef;
    const resolvedCustomerDoc =
        requestedCustomerDoc ||
        (inferredCustomerRef
            ? await getDocumentById<{ _id: string; name?: string }>(inferredCustomerRef, 'customer')
            : null);

    const resolvedMode = hasMode
        ? modeValue as 'ORDER' | 'DO'
        : doRef
            ? 'DO'
            : 'ORDER';
    const resolvedOrderRef = orderRef || doOrderRef;
    const resolvedCustomerRef = resolvedCustomerDoc?._id || '';
    const resolvedCustomerName =
        customerName ||
        normalizeOptionalText(resolvedCustomerDoc?.name) ||
        normalizeOptionalText(resolvedOrderDoc?.customerName) ||
        normalizeOptionalText(deliveryOrderDoc?.customerName);
    const resolvedMasterResi =
        masterResi ||
        normalizeOptionalText(resolvedOrderDoc?.masterResi) ||
        normalizeOptionalText(deliveryOrderDoc?.masterResi);

    const invoiceId = crypto.randomUUID();
    const invoiceNumber = await getNextNumber('invoice', issueDate);
    const invoiceDoc: { _id: string; _type: 'invoice'; [key: string]: unknown } = {
        _id: invoiceId,
        _type: 'invoice',
        invoiceNumber,
        mode: resolvedMode,
        issueDate,
        dueDate,
        status: 'UNPAID',
        totalAmount,
        totalAdjustmentAmount: 0,
        netAmount: totalAmount,
    };
    if (resolvedOrderRef) {
        invoiceDoc.orderRef = resolvedOrderRef;
    }
    if (doRef) {
        invoiceDoc.doRef = doRef;
    }
    if (resolvedCustomerRef) {
        invoiceDoc.customerRef = resolvedCustomerRef;
    }
    if (resolvedCustomerName) {
        invoiceDoc.customerName = resolvedCustomerName;
    }
    if (resolvedMasterResi) {
        invoiceDoc.masterResi = resolvedMasterResi;
    }
    if (notes) {
        invoiceDoc.notes = notes;
    }

    let itemSubtotalTotal = 0;
    const invoiceItems: Array<{
        _id: string;
        _type: 'invoiceItem';
        invoiceRef: string;
        description: string;
        qty: number;
        price: number;
        subtotal: number;
    }> = [];
    for (const item of items) {
        let subtotal: number;
        let qty: number;
        let price: number;
        try {
            subtotal = parseStrictInvoiceNumber(item.subtotal, 'Subtotal item invoice tidak valid', {
                allowDecimal: false,
                maxFractionDigits: 0,
            });
            qty = parseStrictInvoiceNumber(item.qty, 'Qty item invoice tidak valid');
            price = parseStrictInvoiceNumber(item.price, 'Harga item invoice tidak valid', {
                allowDecimal: false,
                maxFractionDigits: 0,
            });
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Ada item invoice yang tidak valid' },
                { status: 400 }
            );
        }
        if (subtotal <= 0 || qty <= 0 || price < 0) {
            return NextResponse.json({ error: 'Ada item invoice yang tidak valid' }, { status: 400 });
        }
        itemSubtotalTotal += subtotal;
        invoiceItems.push({
            _id: crypto.randomUUID(),
            _type: 'invoiceItem',
            invoiceRef: invoiceId,
            description: typeof item.description === 'string' ? item.description : '',
            qty,
            price,
            subtotal,
        });
    }
    if (itemSubtotalTotal !== totalAmount) {
        return NextResponse.json({ error: 'Total invoice harus sama dengan jumlah subtotal item' }, { status: 400 });
    }

    await createDocument(invoiceDoc);
    for (const invoiceItem of invoiceItems) {
        await createDocument(invoiceItem);
    }
    const mutationTimestamp = new Date().toISOString();
    if (resolvedCustomerDoc) {
        await updateDocument(resolvedCustomerDoc._id, { updatedAt: mutationTimestamp }, 'customer');
    }
    if (resolvedOrderDoc) {
        await updateDocument(resolvedOrderDoc._id, { updatedAt: mutationTimestamp }, 'order');
    }
    if (deliveryOrderDoc) {
        await updateDocument(deliveryOrderDoc._id, { updatedAt: mutationTimestamp }, 'deliveryOrder');
    }
    await addAuditLog(session, 'CREATE', 'invoices', invoiceId, `Created invoices: ${invoiceNumber}`);
    return NextResponse.json({ data: invoiceDoc, id: invoiceId });
}

export async function handleCustomerDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Customer tidak valid' }, { status: 400 });
    }

    const customer = await getDocumentById<{ _id: string; name?: string }>(id, 'customer');
    if (!customer) {
        return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
    }
    const customerName = normalizeText(customer.name).toLowerCase();
    const findByRefOrLegacyName = async (docType: 'order' | 'deliveryOrder' | 'freightNota' | 'invoice' | 'customerReceipt') => {
        const exactRefMatch =
            (await listDocumentsByFilter<{ _id: string; customerRef?: string; customerName?: string }>(docType, {
                customerRef: id,
            }))[0] || null;
        if (exactRefMatch) {
            return exactRefMatch;
        }
        if (!customerName) {
            return null;
        }
        return (await listDocumentsByFilter<{ _id: string; customerRef?: string; customerName?: string }>(docType, {}))
            .find(doc => !doc.customerRef && normalizeText(doc.customerName).toLowerCase() === customerName) || null;
    };

    const relatedOrder = await findByRefOrLegacyName('order');
    if (relatedOrder) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada order tidak boleh dihapus' }, { status: 409 });
    }

    const relatedDeliveryOrder = await findByRefOrLegacyName('deliveryOrder');
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedFreightNota = await findByRefOrLegacyName('freightNota');
    if (relatedFreightNota) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada invoice tidak boleh dihapus' }, { status: 409 });
    }

    const relatedInvoice = await findByRefOrLegacyName('invoice');
    if (relatedInvoice) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada invoice tidak boleh dihapus' }, { status: 409 });
    }

    const relatedCustomerProduct =
        (await listDocumentsByFilter<{ _id: string }>('customerProduct', { customerRef: id }))[0] || null;
    if (relatedCustomerProduct) {
        return NextResponse.json({ error: 'Hapus dulu master barang customer sebelum menghapus customer' }, { status: 409 });
    }

    const relatedCustomerRecipient =
        (await listDocumentsByFilter<{ _id: string }>('customerRecipient', { customerRef: id }))[0] || null;
    if (relatedCustomerRecipient) {
        return NextResponse.json({ error: 'Hapus dulu master penerima customer sebelum menghapus customer' }, { status: 409 });
    }

    const relatedCustomerPickup =
        (await listDocumentsByFilter<{ _id: string }>('customerPickupLocation', { customerRef: id }))[0] || null;
    if (relatedCustomerPickup) {
        return NextResponse.json({ error: 'Hapus dulu master pickup customer sebelum menghapus customer' }, { status: 409 });
    }

    const relatedCustomerReceipt = await findByRefOrLegacyName('customerReceipt');
    if (relatedCustomerReceipt) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada penerimaan tidak boleh dihapus' }, { status: 409 });
    }

    await deleteDocument(id);
    await addAuditLog(session, 'DELETE', 'customers', id, `Deleted customers ${customer.name || id}`);
    return NextResponse.json({ success: true });
}
