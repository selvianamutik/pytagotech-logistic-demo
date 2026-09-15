import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import type {
    BankAccount,
    DriverBorongan,
    DriverVoucher,
    Expense,
    Incident,
    Maintenance,
    Vehicle,
} from '@/lib/types';

export type ExpenseReferenceMaps = {
    accountMap: Map<string, BankAccount>;
    boronganMap: Map<string, DriverBorongan>;
    incidentMap: Map<string, Incident>;
    maintenanceMap: Map<string, Maintenance>;
    vehicleMap: Map<string, Vehicle>;
    voucherMap: Map<string, DriverVoucher>;
};

export function mapById<T extends { _id: string }>(items: T[]) {
    return new Map(items.map(item => [item._id, item]));
}

export type ExpenseLinkPermissions = {
    canOpenBankAccountPage: boolean;
    canOpenDriverBoronganPage: boolean;
    canOpenDriverVoucherPage: boolean;
    canOpenIncidentPage: boolean;
    canOpenMaintenancePage: boolean;
    canOpenVehiclePage: boolean;
};

export type ExpenseRelatedDocumentLink = {
    key: string;
    kind: string;
    label: string;
    href?: string;
};

const REFERENCE_FETCH_CHUNK_SIZE = 80;

function uniqueNonEmpty(values: Array<string | undefined>) {
    return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))));
}

export async function fetchOptionalCollection<T>(url: string, fallbackData: T): Promise<T> {
    try {
        return await fetchAdminCollectionData<T>(url, 'Gagal memuat data pengeluaran');
    } catch (error) {
        if (error instanceof Error && /403|forbidden|akses/i.test(error.message)) {
            return fallbackData;
        }
        throw error;
    }
}

async function fetchReferencedCollection<T extends { _id: string }>(entity: string, refs: Array<string | undefined>): Promise<T[]> {
    const ids = uniqueNonEmpty(refs);
    if (ids.length === 0) return [];

    const rows: T[] = [];
    for (let index = 0; index < ids.length; index += REFERENCE_FETCH_CHUNK_SIZE) {
        const chunk = ids.slice(index, index + REFERENCE_FETCH_CHUNK_SIZE);
        const filter = encodeURIComponent(JSON.stringify({ _id: chunk }));
        rows.push(...await fetchOptionalCollection<T[]>(`/api/data?entity=${entity}&filter=${filter}`, []));
    }
    return rows;
}

export async function fetchExpenseReferences(expenses: Expense[]) {
    const [voucherRows, boronganRows, incidentRows, maintenanceRows] = await Promise.all([
        fetchReferencedCollection<DriverVoucher>('driver-vouchers', expenses.map(expense => expense.voucherRef)),
        fetchReferencedCollection<DriverBorongan>('driver-borongans', expenses.map(expense => expense.boronganRef)),
        fetchReferencedCollection<Incident>('incidents', expenses.map(expense => expense.relatedIncidentRef)),
        fetchReferencedCollection<Maintenance>('maintenances', expenses.map(expense => expense.relatedMaintenanceRef)),
    ]);

    return {
        voucherRows,
        boronganRows,
        incidentRows,
        maintenanceRows,
    };
}

export function getExpenseDescriptionLabel(expense: Expense) {
    return expense.note || expense.description || 'Pengeluaran tanpa catatan';
}

export function getExpenseVehicleLabel(expense: Expense, vehicleMap: Map<string, Vehicle>) {
    const currentVehicle = expense.relatedVehicleRef ? vehicleMap.get(expense.relatedVehicleRef) : undefined;
    return currentVehicle?.plateNumber || expense.relatedVehiclePlate || '';
}

export function getExpenseAccountLabel(expense: Expense, accountMap: Map<string, BankAccount>) {
    const currentAccount = expense.bankAccountRef ? accountMap.get(expense.bankAccountRef) : undefined;
    if (currentAccount) {
        return `${currentAccount.bankName} - ${currentAccount.accountNumber}${currentAccount.accountType === 'CASH' ? ' (Kas Tunai)' : ''}`;
    }
    if (expense.bankAccountName) {
        return `${expense.bankAccountName}${expense.bankAccountNumber ? ` - ${expense.bankAccountNumber}` : ''}`;
    }
    return '';
}

export function getExpenseRelatedDocuments(
    expense: Expense,
    maps: ExpenseReferenceMaps,
    permissions: ExpenseLinkPermissions
): ExpenseRelatedDocumentLink[] {
    const links: ExpenseRelatedDocumentLink[] = [];
    if (expense.voucherRef) {
        const voucher = maps.voucherMap.get(expense.voucherRef);
        links.push({
            key: `voucher:${expense.voucherRef}`,
            kind: 'Bon trip',
            label: voucher?.bonNumber || expense.voucherRef,
            href: permissions.canOpenDriverVoucherPage ? `/driver-vouchers/${expense.voucherRef}` : undefined,
        });
    }
    if (expense.boronganRef) {
        const borongan = maps.boronganMap.get(expense.boronganRef);
        links.push({
            key: `borongan:${expense.boronganRef}`,
            kind: 'Borongan',
            label: borongan?.boronganNumber || expense.boronganRef,
            href: permissions.canOpenDriverBoronganPage ? `/borongan/${expense.boronganRef}` : undefined,
        });
    }
    if (expense.relatedIncidentRef) {
        const incident = maps.incidentMap.get(expense.relatedIncidentRef);
        links.push({
            key: `incident:${expense.relatedIncidentRef}`,
            kind: 'Insiden',
            label: incident?.incidentNumber || expense.relatedIncidentRef,
            href: permissions.canOpenIncidentPage ? `/fleet/incidents/${expense.relatedIncidentRef}` : undefined,
        });
    }
    if (expense.relatedMaintenanceRef) {
        const maintenance = maps.maintenanceMap.get(expense.relatedMaintenanceRef);
        links.push({
            key: `maintenance:${expense.relatedMaintenanceRef}`,
            kind: 'Maintenance',
            label: maintenance?.vehiclePlate || maintenance?.type || expense.relatedMaintenanceRef,
            href: permissions.canOpenMaintenancePage
                ? `/fleet/maintenance/${expense.relatedMaintenanceRef}`
                : undefined,
        });
    }
    return links;
}