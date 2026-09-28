import type { DeliveryActualDropPoint, DeliveryOrder, DeliveryOrderItem } from '@/lib/types';
import type { SuratJalanRecord } from '@/lib/trip-document-types';
import {
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { parseSuratJalanDocumentId } from '@/lib/trip-document-mappers';
import { assertIsoDate } from '@/lib/api/data-helpers';
import {
    getDeliveryOrderActualCargoInvoiceLockMessage,
    getDeliveryOrderBillingMutationLockMessage,
} from '@/lib/api/order-workflows';

export interface EditDeliveredSuratJalanPodEntry {
    /**
     * Identitas titik drop tujuan. `dropPointKey` dicocokkan ke `_key` dan
     * `dropPointSequence` ke `sequence`. Keduanya dikirim kalau ada supaya
     * record lama yang belum punya `_key` tetap bisa dicocokkan lewat sequence.
     */
    dropPointKey?: string;
    dropPointSequence?: number;
    podReceiverName?: string;
    podReceivedDate?: string;
    podNote?: string;
}

export interface EditDeliveredSuratJalanInput {
    sjRef: string;
    customerRef: string;
    customerName: string;
    dropPointName: string;
    suratJalanNumber?: string;
    /**
     * POD milik titik drop tujuan PERTAMA milik SJ ini. Disimpan per drop point
     * (bukan per SJ) supaya SJ multi-drop tetap punya penerima dan tanggal
     * terima sendiri di tiap titik, sesuai dengan bentuk data di
     * `DeliveryActualDropPoint`. Titik drop tujuan berikutnya memakai
     * `podEntries` supaya tiap titik punya isiannya sendiri.
     */
    podReceiverName?: string;
    podReceivedDate?: string;
    podNote?: string;
    /**
     * POD titik drop tujuan kedua dan seterusnya milik SJ ini. Titik pertama
     * tetap lewat `podReceiverName`/`podReceivedDate`/`podNote` di atas supaya
     * form yang cuma punya satu drop point tidak berubah strukturnya.
     */
    podEntries?: EditDeliveredSuratJalanPodEntry[];
}

export interface EditDeliveredSuratJalanSnapshotEntry {
    customerRef: string;
    customerName: string;
    dropPointName: string;
    suratJalanNumber: string;
}

export interface EditDeliveredSuratJalanResult {
    ok: true;
    sjRef: string;
    tripRef: string;
    referenceKey: string;
    suratJalanNumber: string;
    editedAfterDelivery: true;
    snapshot: {
        before: EditDeliveredSuratJalanSnapshotEntry;
        after: EditDeliveredSuratJalanSnapshotEntry;
    };
}

export type EditDeliveredSuratJalanErrorCode =
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'VOIDED'
    | 'NOT_DELIVERED'
    | 'EMPTY_EDIT'
    | 'BILLING_LOCKED'
    | 'LOCKED';

export interface EditDeliveredSuratJalanFailure {
    ok: false;
    error: {
        code: EditDeliveredSuratJalanErrorCode;
        message: string;
    };
}

export type EditDeliveredSuratJalanOutcome =
    | EditDeliveredSuratJalanResult
    | EditDeliveredSuratJalanFailure;

const DO_DOC_TYPE = 'deliveryOrder';
const SJ_DOC_TYPE = 'suratJalan';

function failure(code: EditDeliveredSuratJalanErrorCode, message: string): EditDeliveredSuratJalanFailure {
    return { ok: false, error: { code, message } };
}

function readText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Titik drop milik satu SJ dihitung dengan scope referenceKey yang sama dengan
 * projector (trip-document-mappers) supaya hasil edit selalusinkron dengan
 * drop point yang tampil di halaman SJ.
 */
function isDropPointInScope(
    drop: DeliveryActualDropPoint,
    referenceKey: string,
    suratJalanNumber?: string,
) {
    if (!referenceKey) {
        return !drop.shipperReferenceKey && !drop.shipperReferenceNumber;
    }
    return drop.shipperReferenceKey === referenceKey || drop.shipperReferenceNumber === suratJalanNumber;
}

/**
 * Kolom "drop point" hanya boleh menunjuk titik antar (DROP / EXTRA_DROP).
 * Titik HOLD / TRANSIT / RETURN punya arti lain (baru ditahan, transit, atau
 * retur) dan tidak boleh ikut tertimpa oleh edit tujuan.
 */
function isDestinationDropPoint(drop: DeliveryActualDropPoint) {
    return drop.stopType === 'DROP' || drop.stopType === 'EXTRA_DROP';
}

/** Nama yang ditampilkan projector untuk sebuah titik drop. */
function readDropPointLabel(drop: DeliveryActualDropPoint) {
    return (drop.locationName || drop.locationAddress || '').trim();
}

/**
 * Isian POD sebuah titik drop dinormalkan ke string kosong supaya perbandingan
 * "ada perubahan atau tidak" tidak fooled oleh `undefined` vs `''`.
 */
function readPodSnapshot(drop: DeliveryActualDropPoint | undefined) {
    return {
        podReceiverName: readText(drop?.podReceiverName),
        podReceivedDate: readText(drop?.podReceivedDate),
        podNote: readText(drop?.podNote),
    };
}

function isSamePod(left: ReturnType<typeof readPodSnapshot>, right: ReturnType<typeof readPodSnapshot>) {
    return left.podReceiverName === right.podReceiverName
        && left.podReceivedDate === right.podReceivedDate
        && left.podNote === right.podNote;
}

function isItemInScope(item: DeliveryOrderItem, referenceKey: string, suratJalanNumber?: string) {
    if (!referenceKey) {
        return !item.shipperReferenceKey && !item.shipperReferenceNumber;
    }
    return item.shipperReferenceKey === referenceKey || item.shipperReferenceNumber === suratJalanNumber;
}

export async function editDeliveredSuratJalanCustomerDrop(
    input: EditDeliveredSuratJalanInput,
    actor: { ref: string; name: string },
): Promise<EditDeliveredSuratJalanOutcome> {
    const sjRef = readText(input?.sjRef);
    const customerRef = readText(input?.customerRef);
    const customerName = readText(input?.customerName);
    const dropPointName = readText(input?.dropPointName);
    const requestedSuratJalanNumber = readText(input?.suratJalanNumber).toUpperCase();

    if (!sjRef || !customerName || !dropPointName) {
        return failure('INVALID_INPUT', 'Customer dan drop point wajib diisi.');
    }
    // Customer tujuan harus customer master. Kalau bebas diketik, ref-nya kosong
    // dan row invoice tidak akan pernah bisa dicocokkan dengan customer mana pun,
    // jadi muatannya jadi tidak bisa ditagih.
    if (!customerRef) {
        return failure('INVALID_INPUT', 'Customer tujuan harus dipilih dari daftar yang tersedia.');
    }

    const { tripRef, referenceKey } = parseSuratJalanDocumentId(sjRef);

    const deliveryOrder = await getDocumentById<DeliveryOrder>(tripRef, DO_DOC_TYPE);
    if (!deliveryOrder) {
        return failure('NOT_FOUND', 'Surat jalan tidak ditemukan.');
    }

    if (deliveryOrder.status === 'CANCELLED') {
        return failure('VOIDED', 'Surat jalan telah dibatalkan.');
    }

    // Status parent DO SENGAJA tidak jadi gerbang di sini. Pada trip multi-SJ, DO
    // baru berstatus DELIVERED setelah semua SJ-nya selesai, jadi SJ yang sudah
    // DELIVERED masih bisa punya parent berstatus ARRIVED/ON_DELIVERY/PARTIAL_HOLD.
    // Yang otoritatif untuk edit per-SJ adalah tripStatus record SJ-nya, sama
    // seperti yang dipakai update-surat-jalan-actual-cargo.

    const sjRecords = await listDocumentsByFilter<SuratJalanRecord>(SJ_DOC_TYPE, { tripRef });
    const sjRecord = sjRecords.find(record => record._id === sjRef);
    if (!sjRecord) {
        return failure('NOT_FOUND', 'Data surat jalan tidak ditemukan.');
    }

    // Status SJ ini yang jadi penentu, bukan status parent DO. DELIVERED dan
    // PARTIAL_HOLD sama-sama final: SJ yang sudah sampai tujuan tapi masih punya
    // muatan tertahan tetap boleh diubah customer/drop point-nya.
    if (sjRecord.tripStatus !== 'DELIVERED' && sjRecord.tripStatus !== 'PARTIAL_HOLD') {
        return failure('NOT_DELIVERED', `SJ ${sjRecord.suratJalanNumber || ''} belum berstatus terkirim (DELIVERED) atau tertahan sebagian (PARTIAL_HOLD).`);
    }

    if (deliveryOrder.tripClosedByAdminAt) {
        return failure('LOCKED', 'Trip sudah ditutup admin sehingga SJ tidak bisa diubah.');
    }

    if ((deliveryOrder.pendingDriverRequests || []).length > 0) {
        return failure('LOCKED', 'Ada permintaan driver yang menunggu persetujuan. Selesaikan dulu sebelum mengubah SJ.');
    }

    const suratJalanNumber = sjRecord.suratJalanNumber;
    const label = suratJalanNumber || sjRef;

    // Nomor SJ hanya boleh diganti kalau formatnya masih sah. Baris SJ dan
    // dokumen terindeks ikut diperbarui supaya pencarian by nomor tetap kena.
    let nextSuratJalanNumber = suratJalanNumber;
    if (requestedSuratJalanNumber && requestedSuratJalanNumber !== suratJalanNumber) {
        if (!/^[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(requestedSuratJalanNumber)) {
            return failure('INVALID_INPUT', 'Nomor Surat Jalan hanya boleh berisi huruf, angka, titik, garis, atau strip.');
        }
        const siblingRecords = await listDocumentsByFilter<SuratJalanRecord>(SJ_DOC_TYPE, { tripRef });
        const duplicate = siblingRecords.some(record =>
            record._id !== sjRef
            && (record.suratJalanNumber || '').trim().toUpperCase() === requestedSuratJalanNumber
        );
        if (duplicate) {
            return failure('INVALID_INPUT', `Nomor Surat Jalan ${requestedSuratJalanNumber} sudah dipakai SJ lain di trip ini.`);
        }
        nextSuratJalanNumber = requestedSuratJalanNumber;
    }

    // Kunci tagihan: DO yang sudah masuk invoice/borongan tidak boleh diubah.
    const billingLockMessage = await getDeliveryOrderBillingMutationLockMessage(tripRef, `SJ ${label}`);
    if (billingLockMessage) {
        return failure('BILLING_LOCKED', billingLockMessage);
    }

    const allDropPoints = deliveryOrder.actualDropPoints || [];
    const scopedIndexes = allDropPoints
        .map((drop, index) => ({ drop, index }))
        .filter(({ drop }) => isDropPointInScope(drop, referenceKey, suratJalanNumber))
        .filter(({ drop }) => isDestinationDropPoint(drop))
        .map(({ index }) => index);
    const scopedDropPoints = scopedIndexes.map(index => allDropPoints[index]);

    const allItems = await listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', {
        deliveryOrderRef: tripRef,
    });
    const scopedItems = allItems.filter(item => isItemInScope(item, referenceKey, suratJalanNumber));

    const invoiceLockMessage = await getDeliveryOrderActualCargoInvoiceLockMessage({
        id: tripRef,
        label: `Aktual SJ ${label}`,
        targetItemRefs: scopedItems.map(item => item._id),
        targetNoSJs: [suratJalanNumber, ...scopedItems.map(item => item.shipperReferenceNumber)],
        targetActualDropPoints: scopedDropPoints,
    });
    if (invoiceLockMessage) {
        return failure('BILLING_LOCKED', invoiceLockMessage);
    }

    // Kolom "drop point" di form menunjukkan titik antar pertama milik SJ ini.
    // Kalau nama yang diketik sudah persis sama dengan yang tampil, yang diubah
    // hanya customer.
    const currentDropPoint = scopedDropPoints[0];
    const currentDropPointName = currentDropPoint ? readDropPointLabel(currentDropPoint) : '';
    // POD dibaca dari drop point tujuan, bukan dari record SJ, supaya isian POD
    // per titik drop tidak saling menimpa.
    const nextPodReceiverName = readText(input?.podReceiverName);
    const nextPodReceivedDate = readText(input?.podReceivedDate);
    const nextPodNote = readText(input?.podNote);
    const firstPod = { podReceiverName: nextPodReceiverName, podReceivedDate: nextPodReceivedDate, podNote: nextPodNote };
    if (nextPodReceivedDate) {
        try {
            assertIsoDate(nextPodReceivedDate, 'Tanggal terima POD');
        } catch (error) {
            return failure(
                'INVALID_INPUT',
                error instanceof Error ? error.message : 'Tanggal terima POD tidak valid',
            );
        }
    }

    /**
     * Titik drop tujuan kedua dan seterusnya. Identitasnya dicocokkan ke `_key`
     * lalu `sequence`, mengikuti konvensi `collectActualDropPointKeys` di
     * order-workflows. Entry yang tidak ketemu titik drop tujuan DITOLAK, bukan
     * diabaikan diam-diam, supaya isian POD tidak hilang tanpa jejak.
     */
    const extraPodByIndex = new Map<number, ReturnType<typeof readPodSnapshot>>();
    const podEntries = Array.isArray(input?.podEntries) ? input.podEntries : [];
    for (const entry of podEntries) {
        const entryKey = readText(entry?.dropPointKey);
        const entrySequence = typeof entry?.dropPointSequence === 'number' ? entry.dropPointSequence : undefined;
        const matchedIndex = scopedIndexes.findIndex(index => {
            const drop = allDropPoints[index];
            if (entryKey && readText(drop._key) === entryKey) return true;
            return entrySequence !== undefined && drop.sequence === entrySequence;
        });
        if (matchedIndex === -1) {
            return failure('INVALID_INPUT', 'Titik drop tujuan untuk POD tidak ditemukan. Muat ulang halaman lalu coba lagi.');
        }
        if (extraPodByIndex.has(scopedIndexes[matchedIndex])) {
            return failure('INVALID_INPUT', 'POD titik drop tujuan terduplikasi. Muat ulang halaman lalu coba lagi.');
        }
        const nextEntryDate = readText(entry?.podReceivedDate);
        if (nextEntryDate) {
            try {
                assertIsoDate(nextEntryDate, 'Tanggal terima POD');
            } catch (error) {
                return failure(
                    'INVALID_INPUT',
                    error instanceof Error ? error.message : 'Tanggal terima POD tidak valid',
                );
            }
        }
        extraPodByIndex.set(scopedIndexes[matchedIndex], {
            podReceiverName: readText(entry?.podReceiverName),
            podReceivedDate: nextEntryDate,
            podNote: readText(entry?.podNote),
        });
    }

    // Titik pertama tidak boleh ikut ditulis dua kali lewat podEntries; kalau
    // iya, entry-nya diabaikan supaya nilai yang tampil di form tetap yang menang.
    extraPodByIndex.delete(scopedIndexes[0]);

    // "Tidak ada perubahan" harus mencakup POD di SEMUA titik tujuan, bukan cuma
    // yang pertama. Kalau tidak, POD titik kedua bisa ikut hilang karena edit
    // lain dianggap tidak berubah.
    const podUnchanged = isSamePod(readPodSnapshot(currentDropPoint), firstPod)
        && scopedIndexes.every(index => {
            const pending = extraPodByIndex.get(index);
            if (index === scopedIndexes[0]) return true;
            // Titik yang tidak ada di kiriman berarti form tidak menyentuhnya,
            // jadi isian lamanya harus dibiarkan apa adanya.
            if (!pending) return true;
            return isSamePod(readPodSnapshot(allDropPoints[index]), pending);
        });

    const before: EditDeliveredSuratJalanSnapshotEntry = {
        customerRef: sjRecord.customerRef || '',
        customerName: sjRecord.customerName || '',
        dropPointName: currentDropPointName,
        suratJalanNumber,
    };
    const after: EditDeliveredSuratJalanSnapshotEntry = {
        customerRef,
        customerName,
        dropPointName,
        suratJalanNumber: nextSuratJalanNumber,
    };

    // `customerRef` sudah wajib di atas, tapi nama tetap ikut dibandingkan supaya
    // record lama yang masih menyimpan ref + nama tidak dianggap berubah hanya
    // karena nama master customer-nya ikut di-rename.
    const customerUnchanged = before.customerRef === after.customerRef
        && before.customerName === after.customerName;
    const dropPointUnchanged = before.dropPointName === after.dropPointName;
    const numberUnchanged = before.suratJalanNumber === after.suratJalanNumber;
    if (customerUnchanged && dropPointUnchanged && numberUnchanged && podUnchanged) {
        return failure('EMPTY_EDIT', 'Tidak ada perubahan customer/drop point/nomor SJ/POD.');
    }

    // Customer hidup di record SJ, sedangkan drop point hidup di DO. Jadi:
    // customer -> record SJ, drop point -> DO. Parent DO customer tidak diubah
    // agar SJ lain di order yang sama tidak ikut berubah.
    const nextDropPoints = [...allDropPoints];

    // Ganti nomor lama di seluruh titik drop milik SJ ini. Titik yang terikat
    // lewat referenceKey tidak perlu disentuh karena penemukannya sudah lewat
    // key; yang di-bookkeeping dengan nomor harus ikut ditulis supaya pencarian
    // by nomor lama tidak lagi menemukan SJ ini.
    scopedIndexes.forEach(index => {
        const drop = allDropPoints[index];
        if (drop.shipperReferenceNumber !== suratJalanNumber) {
            return;
        }
        nextDropPoints[index] = { ...drop, shipperReferenceNumber: nextSuratJalanNumber };
    });

    if (currentDropPoint) {
        const targetIndex = scopedIndexes[0];
        // Spread dari nextDropPoints (bukan currentDropPoint) supaya nomor yang
        // sudah ditulis di atas tidak ditimpa kembali dengan nomor lama.
        nextDropPoints[targetIndex] = {
            ...nextDropPoints[targetIndex],
            locationName: dropPointName,
            billingCustomerRef: customerRef || undefined,
            billingCustomerName: customerName,
            // Isian POD yang dikosongkan harus benar-benar dihapus, bukan
            // disimpan sebagai string kosong, supaya panel POD tidak menampilkan
            // baris kosong yang sebenarnya tidak ada.
            podReceiverName: nextPodReceiverName || undefined,
            podReceivedDate: nextPodReceivedDate || undefined,
            podNote: nextPodNote || undefined,
        };
    } else {
        nextDropPoints.push({
            sequence: nextDropPoints.length + 1,
            stopType: 'DROP',
            shipperReferenceKey: referenceKey || undefined,
            shipperReferenceNumber: referenceKey ? undefined : nextSuratJalanNumber,
            locationName: dropPointName,
            billingCustomerRef: customerRef || undefined,
            billingCustomerName: customerName,
            podReceiverName: nextPodReceiverName || undefined,
            podReceivedDate: nextPodReceivedDate || undefined,
            podNote: nextPodNote || undefined,
        });
    }

    // Titik drop tujuan kedua dan seterusnya: hanya POD-nya yang ditulis. Nama
    // titik tidak disentuh karena kolom "drop point" di form sengaja hanya
    // berlaku untuk titik pertama.
    extraPodByIndex.forEach((pod, index) => {
        if (index === scopedIndexes[0]) return;
        nextDropPoints[index] = {
            ...nextDropPoints[index],
            podReceiverName: pod.podReceiverName || undefined,
            podReceivedDate: pod.podReceivedDate || undefined,
            podNote: pod.podNote || undefined,
        };
    });

    const recordUpdates: Partial<SuratJalanRecord> = {
        // `customerRef` sudah dipastikan terisi di atas. Record lama yang ref-nya
        // kosong (dari versi sebelum customer wajib dipilih) tetap bisa diperbaiki
        // lewat form ini karena customerRef baru selalu ada.
        customerRef,
        customerName,
    };

    if (nextSuratJalanNumber !== suratJalanNumber) {
        recordUpdates.suratJalanNumber = nextSuratJalanNumber;
    }

    // Snapshot original hanya pada edit pertama.
    if (!sjRecord.editedAfterDelivery) {
        recordUpdates.editedAfterDelivery = true;
        recordUpdates.originalSJCustomerDrop = {
            customerRef: before.customerRef,
            customerName: before.customerName,
            dropPointName: before.dropPointName,
            suratJalanNumber: before.suratJalanNumber,
            editedAt: new Date().toISOString(),
            editedBy: actor.name || actor.ref,
        };
    }

    await updateDocument(tripRef, { actualDropPoints: nextDropPoints }, DO_DOC_TYPE);
    await updateDocument(sjRef, recordUpdates, SJ_DOC_TYPE);

    // Baris item dan DO parent masih menunjuk nomor lama kalau tidak ikut
    // ditulis. Urutannya setelah SJ: kalau penulisan item gagal, nomor SJ sudah
    // berubah tapi item masih lama, dan itu lebih mudah ditemukan daripada
    // sebaliknya (nomor SJ lama tapi item sudah menunjuk nomor baru).
    if (nextSuratJalanNumber !== suratJalanNumber) {
        for (const item of scopedItems) {
            if (item.shipperReferenceNumber !== suratJalanNumber) {
                continue;
            }
            await updateDocument(item._id, { shipperReferenceNumber: nextSuratJalanNumber }, 'deliveryOrderItem');
        }

        if ((deliveryOrder.customerDoNumber || '') === suratJalanNumber) {
            await updateDocument(tripRef, { customerDoNumber: nextSuratJalanNumber }, DO_DOC_TYPE);
        }
    }

    return {
        ok: true,
        sjRef,
        tripRef,
        referenceKey,
        suratJalanNumber: nextSuratJalanNumber,
        editedAfterDelivery: true,
        snapshot: { before, after },
    };
}
