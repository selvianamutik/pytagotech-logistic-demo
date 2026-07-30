'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, LogIn, LogOut, Pencil, Plus, Save, ScrollText, Search, X } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { formatBusinessDate, getBusinessDateValue } from '@/lib/business-date';
import {
    buildEmployeeAttendanceRecapRows,
    EMPLOYEE_ATTENDANCE_PERIOD_LABELS,
    EMPLOYEE_ATTENDANCE_STATUS_LABELS,
    EMPLOYEE_ATTENDANCE_STATUS_OPTIONS,
    summarizeEmployeeAttendanceRecords,
    type EmployeeAttendancePeriod,
    type EmployeeAttendanceStatus,
} from '@/lib/employee-attendance';
import { exportEmployeeAttendanceReport } from '@/lib/export';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPermission } from '@/lib/rbac';
import type { Employee, EmployeeAttendanceRecord } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';

import { useApp, useToast } from '../layout';

type AttendanceSummary = {
    period: EmployeeAttendancePeriod;
    periodLabel: string;
    startDate: string;
    endDate: string;
    activeEmployeeCount: number;
    recordedEmployeeCount: number;
    unrecordedEmployeeCount: number;
    totalRecords: number;
    presentCount: number;
    earlyLeaveCount: number;
    permissionCount: number;
    sickCount: number;
    leaveCount: number;
    absentCount: number;
    offCount: number;
    pendingEmployees: Array<Pick<Employee, '_id' | 'employeeCode' | 'name' | 'division' | 'position'>>;
};

type AttendanceFormState = {
    employeeRef: string;
    date: string;
    status: EmployeeAttendanceStatus;
    checkInTime: string;
    checkOutTime: string;
    note: string;
};

type AttendanceViewMode = 'input' | 'recap';
type AttendanceInputCoverage = 'PENDING' | 'RECORDED' | 'ALL';
type AttendanceModalMode = 'manual' | 'check-in' | 'check-out' | 'early-leave' | 'status' | 'edit';
type DailyAttendanceRow = {
    employee: Employee;
    record: EmployeeAttendanceRecord | null;
};
type DailyAttendanceSortField = 'employeeName' | 'division' | 'status' | 'updatedAt';
type AttendanceRecapSortField =
    | 'employeeName'
    | 'recordedDays'
    | 'presentCount'
    | 'earlyLeaveCount'
    | 'permissionCount'
    | 'sickCount'
    | 'leaveCount'
    | 'absentCount'
    | 'offCount'
    | 'lastAttendanceDate';
type SortState<T extends string> = {
    field: T;
    direction: SortDirection;
};

const PERIOD_OPTIONS: Array<{ value: EmployeeAttendancePeriod; label: string }> = [
    { value: 'today', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.today },
    { value: 'thisWeek', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.thisWeek },
    { value: 'thisMonth', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.thisMonth },
    { value: 'thisYear', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.thisYear },
];

const INPUT_PAGE_SIZE = 12;
const INPUT_COVERAGE_OPTIONS: Array<{ value: AttendanceInputCoverage; label: string }> = [
    { value: 'PENDING', label: 'Belum Tercatat' },
    { value: 'RECORDED', label: 'Sudah Tercatat' },
    { value: 'ALL', label: 'Semua Karyawan' },
];
const NON_ATTENDANCE_STATUS_OPTIONS: EmployeeAttendanceStatus[] = ['IZIN', 'SAKIT', 'CUTI', 'ALPHA', 'LIBUR'];

const createDefaultAttendanceForm = (date: string, record?: Partial<EmployeeAttendanceRecord>): AttendanceFormState => ({
    employeeRef: record?.employeeRef || '',
    date: record?.date || date,
    status: record?.status || 'HADIR',
    checkInTime: record?.checkInTime || '',
    checkOutTime: record?.checkOutTime || '',
    note: record?.note || '',
});

const STATUS_BADGE_CLASS: Record<EmployeeAttendanceStatus, string> = {
    HADIR: 'badge-success',
    PULANG_LEBIH_AWAL: 'badge-warning',
    IZIN: 'badge-info',
    SAKIT: 'badge-warning',
    CUTI: 'badge-purple',
    ALPHA: 'badge-danger',
    LIBUR: 'badge-gray',
};

function requiresAttendanceTime(status: EmployeeAttendanceStatus) {
    return status === 'HADIR' || status === 'PULANG_LEBIH_AWAL';
}

function getCurrentTimeValue() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function isCheckedInWithoutCheckout(record: EmployeeAttendanceRecord | null | undefined) {
    return Boolean(record && record.status === 'HADIR' && record.checkInTime && !record.checkOutTime);
}

function getDailyStatusLabel(record: EmployeeAttendanceRecord | null) {
    if (!record) return 'Belum Tercatat';
    if (isCheckedInWithoutCheckout(record)) return 'Hadir - Belum Pulang';
    return EMPLOYEE_ATTENDANCE_STATUS_LABELS[record.status] || record.status;
}

function getDailyStatusBadgeClass(record: EmployeeAttendanceRecord | null) {
    if (!record) return 'badge-gray';
    if (isCheckedInWithoutCheckout(record)) return 'badge-info';
    return STATUS_BADGE_CLASS[record.status] || 'badge-gray';
}

function getNormalPresentCount(summary: Pick<AttendanceSummary, 'presentCount' | 'earlyLeaveCount'> | null | undefined) {
    return Math.max((summary?.presentCount || 0) - (summary?.earlyLeaveCount || 0), 0);
}

function getModalTitle(mode: AttendanceModalMode, isEdit: boolean) {
    if (mode === 'check-in') return 'Catat Jam Masuk';
    if (mode === 'check-out') return 'Catat Jam Pulang';
    if (mode === 'early-leave') return 'Pulang Lebih Awal';
    if (mode === 'status') return 'Catat Status Tidak Masuk';
    return isEdit ? 'Edit Absensi' : 'Input Manual Absensi';
}

function getModalSaveLabel(mode: AttendanceModalMode, isSaving: boolean) {
    if (isSaving) return 'Menyimpan...';
    if (mode === 'check-in') return 'Simpan Masuk';
    if (mode === 'check-out') return 'Simpan Pulang';
    if (mode === 'early-leave') return 'Simpan Pulang Cepat';
    return 'Simpan';
}

function formatAttendanceDateLabel(dateValue?: string) {
    if (!dateValue) return '-';
    return formatBusinessDate(dateValue, 'id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    });
}

function compareText(left: string | undefined, right: string | undefined) {
    return (left || '').localeCompare(right || '', 'id-ID', { numeric: true, sensitivity: 'base' });
}

function applySortDirection(value: number, direction: SortDirection) {
    return direction === 'asc' ? value : -value;
}

function toggleSortState<T extends string>(
    current: SortState<T>,
    field: T,
    defaultDirection: SortDirection = 'asc'
): SortState<T> {
    if (current.field !== field) {
        return { field, direction: defaultDirection };
    }

    return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

export default function AttendancePage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [records, setRecords] = useState<EmployeeAttendanceRecord[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [summary, setSummary] = useState<AttendanceSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<AttendanceViewMode>('input');
    const [dailyRecords, setDailyRecords] = useState<EmployeeAttendanceRecord[]>([]);
    const [search, setSearch] = useState('');
    const [period, setPeriod] = useState<EmployeeAttendancePeriod>('today');
    const [selectedDate, setSelectedDate] = useState(getBusinessDateValue());
    const [statusFilter, setStatusFilter] = useState('');
    const [employeeFilter, setEmployeeFilter] = useState('');
    const [page, setPage] = useState(1);
    const [dailyPage, setDailyPage] = useState(1);
    const [inputSearch, setInputSearch] = useState('');
    const [inputDivisionFilter, setInputDivisionFilter] = useState('');
    const [inputCoverageFilter, setInputCoverageFilter] = useState<AttendanceInputCoverage>('PENDING');
    const [inputStatusFilter, setInputStatusFilter] = useState('');
    const [inputSort, setInputSort] = useState<SortState<DailyAttendanceSortField>>({ field: 'employeeName', direction: 'asc' });
    const [recapSort, setRecapSort] = useState<SortState<AttendanceRecapSortField>>({ field: 'employeeName', direction: 'asc' });
    const [showModal, setShowModal] = useState(false);
    const [editRecord, setEditRecord] = useState<EmployeeAttendanceRecord | null>(null);
    const [modalMode, setModalMode] = useState<AttendanceModalMode>('manual');
    const [saving, setSaving] = useState(false);
    const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
    const [form, setForm] = useState<AttendanceFormState>(createDefaultAttendanceForm(getBusinessDateValue()));
    const businessToday = getBusinessDateValue();

    const canManageAttendance = user ? hasPermission(user, 'attendance', 'create') || hasPermission(user, 'attendance', 'update') : false;
    const canExportAttendance = user ? hasPermission(user, 'attendance', 'export') : false;
    const toggleInputSort = useCallback((field: DailyAttendanceSortField, defaultDirection: SortDirection = 'asc') => {
        setInputSort(current => toggleSortState(current, field, defaultDirection));
    }, []);
    const toggleRecapSort = useCallback((field: AttendanceRecapSortField, defaultDirection: SortDirection = 'asc') => {
        setRecapSort(current => toggleSortState(current, field, defaultDirection));
    }, []);
    const activeEmployees = useMemo(() => employees.filter(employee => employee.active !== false), [employees]);
    const employeeOptions = useMemo(() => {
        const optionMap = new Map<string, Employee>();
        for (const employee of activeEmployees) {
            optionMap.set(employee._id, employee);
        }

        const selectedEmployeeId = form.employeeRef || editRecord?.employeeRef;
        if (selectedEmployeeId) {
            const selectedEmployee = employees.find(employee => employee._id === selectedEmployeeId);
            if (selectedEmployee) {
                optionMap.set(selectedEmployee._id, selectedEmployee);
            }
        }

        return Array.from(optionMap.values());
    }, [activeEmployees, editRecord?.employeeRef, employees, form.employeeRef]);
    const filteredEmployeeOptions = useMemo(() => {
        const keyword = employeeSearchTerm.trim().toLowerCase();
        if (!keyword) return employeeOptions;
        return employeeOptions.filter(employee => {
            const haystack = [
                employee.employeeCode,
                employee.name,
                employee.division,
                employee.position,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(keyword);
        });
    }, [employeeOptions, employeeSearchTerm]);
    const divisionOptions = useMemo(() => {
        return Array.from(
            new Set(
                activeEmployees
                    .map(employee => employee.division?.trim())
                    .filter((value): value is string => Boolean(value))
            )
        ).sort((left, right) => left.localeCompare(right, 'id-ID'));
    }, [activeEmployees]);
    const dailyRecordsByEmployee = useMemo(() => {
        return new Map(dailyRecords.map(record => [record.employeeRef, record] as const));
    }, [dailyRecords]);
    const activeEmployeeRefSet = useMemo(() => new Set(activeEmployees.map(employee => employee._id)), [activeEmployees]);
    const dailyAttendanceRows = useMemo(() => {
        const keyword = inputSearch.trim().toLowerCase();
        const rows: DailyAttendanceRow[] = activeEmployees
            .map(employee => ({
                employee,
                record: dailyRecordsByEmployee.get(employee._id) || null,
            }))
            .filter(({ employee, record }) => {
                if (keyword) {
                    const haystack = [
                        employee.employeeCode,
                        employee.name,
                        employee.division,
                        employee.position,
                    ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                    if (!haystack.includes(keyword)) {
                        return false;
                    }
                }

                if (inputDivisionFilter && (employee.division || '') !== inputDivisionFilter) {
                    return false;
                }

                if (inputCoverageFilter === 'PENDING' && record) {
                    return false;
                }

                if (inputCoverageFilter === 'RECORDED' && !record) {
                    return false;
                }

                if (inputCoverageFilter !== 'PENDING' && inputStatusFilter && record?.status !== inputStatusFilter) {
                    return false;
                }

                return true;
            });

        return rows.sort((left, right) => {
            if (inputCoverageFilter === 'ALL' && inputSort.field === 'employeeName') {
                const leftRecorded = Boolean(left.record);
                const rightRecorded = Boolean(right.record);
                if (leftRecorded !== rightRecorded) {
                    return leftRecorded ? 1 : -1;
                }
            }

            let compareResult = 0;
            if (inputSort.field === 'employeeName') {
                compareResult =
                    compareText(left.employee.name, right.employee.name)
                    || compareText(left.employee.employeeCode, right.employee.employeeCode);
            } else if (inputSort.field === 'division') {
                compareResult =
                    compareText(left.employee.division, right.employee.division)
                    || compareText(left.employee.position, right.employee.position)
                    || compareText(left.employee.name, right.employee.name);
            } else if (inputSort.field === 'status') {
                compareResult =
                    compareText(
                        getDailyStatusLabel(left.record),
                        getDailyStatusLabel(right.record),
                    )
                    || compareText(left.employee.name, right.employee.name);
            } else {
                compareResult =
                    compareText(left.record?.updatedAt, right.record?.updatedAt)
                    || compareText(left.employee.name, right.employee.name);
            }

            return applySortDirection(compareResult, inputSort.direction);
        });
    }, [
        activeEmployees,
        dailyRecordsByEmployee,
        inputCoverageFilter,
        inputDivisionFilter,
        inputSearch,
        inputSort,
        inputStatusFilter,
    ]);
    const paginatedDailyAttendanceRows = useMemo(() => {
        const offset = Math.max(dailyPage - 1, 0) * INPUT_PAGE_SIZE;
        return dailyAttendanceRows.slice(offset, offset + INPUT_PAGE_SIZE);
    }, [dailyAttendanceRows, dailyPage]);
    const dailyAttendanceSummary = useMemo(() => {
        const activeDailyRecords = dailyRecords.filter(record => activeEmployeeRefSet.has(record.employeeRef));
        const counts = summarizeEmployeeAttendanceRecords(activeDailyRecords);

        return {
            activeEmployeeCount: activeEmployees.length,
            recordedEmployeeCount: activeDailyRecords.length,
            unrecordedEmployeeCount: Math.max(activeEmployees.length - activeDailyRecords.length, 0),
            present: counts.presentCount,
            normalPresent: Math.max(counts.presentCount - counts.earlyLeaveCount, 0),
            earlyLeave: counts.earlyLeaveCount,
            checkedInWithoutCheckout: activeDailyRecords.filter(record => isCheckedInWithoutCheckout(record)).length,
            checkedOut: activeDailyRecords.filter(record => requiresAttendanceTime(record.status) && Boolean(record.checkOutTime)).length,
            permission: counts.permissionCount,
            sick: counts.sickCount,
            leave: counts.leaveCount,
            absent: counts.absentCount,
            off: counts.offCount,
            nonAttendance: counts.permissionCount + counts.sickCount + counts.leaveCount + counts.absentCount + counts.offCount,
        };
    }, [activeEmployeeRefSet, activeEmployees.length, dailyRecords]);
    const baseRecapRows = useMemo(
        () => buildEmployeeAttendanceRecapRows(records, employees),
        [employees, records],
    );
    const recapRows = useMemo(() => {
        return [...baseRecapRows].sort((left, right) => {
            let compareResult = 0;

            if (recapSort.field === 'employeeName') {
                compareResult =
                    compareText(left.employeeName, right.employeeName)
                    || compareText(left.employeeCode, right.employeeCode);
            } else if (recapSort.field === 'lastAttendanceDate') {
                compareResult =
                    compareText(left.lastAttendanceDate, right.lastAttendanceDate)
                    || compareText(left.employeeName, right.employeeName);
            } else if (recapSort.field === 'presentCount') {
                compareResult =
                    Math.max(left.presentCount - left.earlyLeaveCount, 0) - Math.max(right.presentCount - right.earlyLeaveCount, 0)
                    || compareText(left.employeeName, right.employeeName);
            } else {
                compareResult =
                    (left[recapSort.field] || 0) - (right[recapSort.field] || 0)
                    || compareText(left.employeeName, right.employeeName);
            }

            return applySortDirection(compareResult, recapSort.direction);
        });
    }, [baseRecapRows, recapSort]);
    const paginatedRecapRows = useMemo(() => {
        const offset = Math.max(page - 1, 0) * DEFAULT_PAGE_SIZE;
        return recapRows.slice(offset, offset + DEFAULT_PAGE_SIZE);
    }, [page, recapRows]);
    const selectedEmployeeOption = useMemo(
        () => employeeOptions.find(employee => employee._id === employeeFilter) || null,
        [employeeFilter, employeeOptions],
    );
    const hasCustomFilters = Boolean(
        search.trim()
        || statusFilter
        || employeeFilter
        || period !== 'today'
        || selectedDate !== businessToday,
    );
    const hasInputCustomFilters = Boolean(
        inputSearch.trim()
        || inputDivisionFilter
        || inputCoverageFilter !== 'PENDING'
        || inputStatusFilter,
    );
    const attendancePeriodLabel = summary?.periodLabel || PERIOD_OPTIONS.find(option => option.value === period)?.label || EMPLOYEE_ATTENDANCE_PERIOD_LABELS.today;
    const buildAttendanceQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'employee-attendance-records',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'date',
            sortDir: 'desc',
            period,
            date: selectedDate,
        });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'employeeCode,employeeName,division,position,note,date');
        }
        if (statusFilter) {
            params.set('status', statusFilter);
        }
        if (employeeFilter) {
            params.set('employeeRef', employeeFilter);
        }
        return params.toString();
    }, [employeeFilter, page, period, search, selectedDate, statusFilter]);

    const loadAttendance = useCallback(async () => {
        setLoading(true);
        try {
            const employeesPromise = fetchAllAdminCollectionData<Employee>(
                '/api/data?entity=employees&pageSize=200',
                'Gagal memuat data karyawan',
                200,
            ).catch(() => []);
            const dailyRecordsPromise = fetchAllAdminCollectionData<EmployeeAttendanceRecord>(
                `/api/data?entity=employee-attendance-records&period=today&date=${encodeURIComponent(selectedDate)}&sortField=employeeName&sortDir=asc&pageSize=200`,
                'Gagal memuat input absensi harian',
                200,
            ).catch(() => []);
            const recapRowsPromise = viewMode === 'recap'
                ? fetchAllAdminCollectionData<EmployeeAttendanceRecord>(
                    `/api/data?${buildAttendanceQuery(1, 500)}`,
                    'Gagal memuat rekap absensi',
                    500,
                )
                : Promise.resolve([] as EmployeeAttendanceRecord[]);
            const [summaryRes, employeeRows, dailyRows, recapRecordRows] = await Promise.all([
                fetch(`/api/data?entity=employee-attendance-summary&period=${encodeURIComponent(period)}&date=${encodeURIComponent(selectedDate)}${employeeFilter ? `&employeeRef=${encodeURIComponent(employeeFilter)}` : ''}`),
                employeesPromise,
                dailyRecordsPromise,
                recapRowsPromise,
            ]);
            const summaryPayload = await summaryRes.json();
            if (!summaryRes.ok) {
                throw new Error(summaryPayload.error || 'Gagal memuat ringkasan absensi');
            }

            setRecords(recapRecordRows || []);
            setSummary(summaryPayload.data as AttendanceSummary);
            setEmployees(employeeRows || []);
            setDailyRecords(dailyRows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data absensi');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildAttendanceQuery, employeeFilter, period, selectedDate, viewMode]);

    useEffect(() => {
        void loadAttendance();
    }, [loadAttendance]);

    useEffect(() => {
        setPage(1);
    }, [search, period, selectedDate, statusFilter, employeeFilter, viewMode]);

    useEffect(() => {
        setDailyPage(1);
    }, [inputCoverageFilter, inputDivisionFilter, inputSearch, inputStatusFilter, selectedDate]);

    useEffect(() => {
        if (inputCoverageFilter === 'PENDING' && inputStatusFilter) {
            setInputStatusFilter('');
        }
    }, [inputCoverageFilter, inputStatusFilter]);

    const resetFilters = () => {
        setSearch('');
        setPeriod('today');
        setSelectedDate(businessToday);
        setStatusFilter('');
        setEmployeeFilter('');
    };

    const resetInputFilters = () => {
        setInputSearch('');
        setInputDivisionFilter('');
        setInputCoverageFilter('PENDING');
        setInputStatusFilter('');
    };

    const closeModal = () => {
        if (saving) return;
        setShowModal(false);
        setEditRecord(null);
        setModalMode('manual');
        setEmployeeSearchTerm('');
        setForm(createDefaultAttendanceForm(selectedDate));
    };

    const openCreateModal = (employee?: Pick<Employee, '_id'>) => {
        setEditRecord(null);
        setModalMode('manual');
        setEmployeeSearchTerm('');
        setForm(createDefaultAttendanceForm(selectedDate, employee ? { employeeRef: employee._id } : undefined));
        setShowModal(true);
    };

    const openCheckInModal = (employee: Pick<Employee, '_id'>) => {
        setEditRecord(null);
        setModalMode('check-in');
        setEmployeeSearchTerm('');
        setForm(createDefaultAttendanceForm(selectedDate, {
            employeeRef: employee._id,
            status: 'HADIR',
            checkInTime: getCurrentTimeValue(),
        }));
        setShowModal(true);
    };

    const openStatusModal = (employee: Pick<Employee, '_id'>) => {
        setEditRecord(null);
        setModalMode('status');
        setEmployeeSearchTerm('');
        setForm(createDefaultAttendanceForm(selectedDate, {
            employeeRef: employee._id,
            status: 'IZIN',
        }));
        setShowModal(true);
    };

    const openCheckoutModal = (record: EmployeeAttendanceRecord, mode: 'check-out' | 'early-leave') => {
        setEditRecord(record);
        setModalMode(mode);
        setEmployeeSearchTerm('');
        setForm(createDefaultAttendanceForm(selectedDate, {
            ...record,
            status: mode === 'early-leave' ? 'PULANG_LEBIH_AWAL' : 'HADIR',
            checkOutTime: record.checkOutTime || getCurrentTimeValue(),
        }));
        setShowModal(true);
    };

    const openEditModal = (record: EmployeeAttendanceRecord) => {
        setEditRecord(record);
        setModalMode('edit');
        setEmployeeSearchTerm('');
        setForm(createDefaultAttendanceForm(selectedDate, record));
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!canManageAttendance) {
            addToast('error', 'Anda tidak punya hak mengubah absensi');
            return;
        }
        if (!form.employeeRef || !form.date || !form.status) {
            addToast('error', 'Karyawan, tanggal, dan status wajib diisi');
            return;
        }
        if (requiresAttendanceTime(form.status) && !form.checkInTime) {
            addToast('error', 'Jam masuk wajib diisi untuk status hadir atau pulang lebih awal');
            return;
        }
        if (form.status === 'PULANG_LEBIH_AWAL' && !form.checkOutTime) {
            addToast('error', 'Jam pulang wajib diisi untuk status pulang lebih awal');
            return;
        }
        if ((modalMode === 'check-out' || modalMode === 'early-leave') && !form.checkOutTime) {
            addToast('error', 'Jam pulang wajib diisi');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                employeeRef: form.employeeRef,
                date: form.date,
                status: form.status,
                checkInTime: requiresAttendanceTime(form.status) ? form.checkInTime : '',
                checkOutTime: requiresAttendanceTime(form.status) ? form.checkOutTime : '',
                note: form.note,
            };

            const duplicateRecord = !editRecord
                ? dailyRecords.find(record => record.employeeRef === form.employeeRef && record.date === form.date)
                    || records.find(record => record.employeeRef === form.employeeRef && record.date === form.date)
                : null;
            const targetRecord = editRecord || duplicateRecord || null;

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    targetRecord
                        ? {
                            entity: 'employee-attendance-records',
                            action: 'update',
                            data: {
                                id: targetRecord._id,
                                updates: payload,
                            },
                        }
                        : {
                            entity: 'employee-attendance-records',
                            data: payload,
                        }
                ),
            });
            const response = await res.json();
            if (!res.ok) {
                throw new Error(response.error || 'Gagal menyimpan absensi');
            }

            addToast('success', targetRecord ? 'Absensi diperbarui' : 'Absensi dicatat');
            closeModal();
            await loadAttendance();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan absensi');
        } finally {
            setSaving(false);
        }
    };

    const handleExport = useCallback(async () => {
        if (!canExportAttendance) {
            addToast('error', 'Anda tidak punya hak export laporan absensi');
            return;
        }

        try {
            const rows = await fetchAllAdminCollectionData<EmployeeAttendanceRecord>(
                `/api/data?${buildAttendanceQuery(1, 500)}`,
                'Gagal memuat data absensi untuk export',
                500,
            );
            await exportEmployeeAttendanceReport({
                records: rows,
                summary: {
                    periodLabel: attendancePeriodLabel,
                    startDate: summary?.startDate || selectedDate,
                    endDate: summary?.endDate || selectedDate,
                    activeEmployeeCount: summary?.activeEmployeeCount || activeEmployees.length,
                    recordedEmployeeCount: summary?.recordedEmployeeCount || 0,
                    unrecordedEmployeeCount: summary?.unrecordedEmployeeCount || 0,
                    totalRecords: summary?.totalRecords || rows.length,
                    presentCount: summary?.presentCount || 0,
                    earlyLeaveCount: summary?.earlyLeaveCount || 0,
                    permissionCount: summary?.permissionCount || 0,
                    sickCount: summary?.sickCount || 0,
                    leaveCount: summary?.leaveCount || 0,
                    absentCount: summary?.absentCount || 0,
                    offCount: summary?.offCount || 0,
                    pendingEmployees: summary?.pendingEmployees || [],
                },
                filters: {
                    search: search.trim(),
                    statusLabel: statusFilter
                        ? EMPLOYEE_ATTENDANCE_STATUS_LABELS[statusFilter as EmployeeAttendanceStatus]
                        : 'Semua Status',
                    employeeLabel: selectedEmployeeOption
                        ? `${selectedEmployeeOption.employeeCode} - ${selectedEmployeeOption.name}`
                        : 'Semua Karyawan',
                    anchorDate: selectedDate,
                },
                filename: `absensi-${period}-${selectedDate}`,
                employees,
            });
            addToast('success', 'Excel absensi berhasil di-download');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan export absensi');
        }
    }, [
        activeEmployees.length,
        addToast,
        attendancePeriodLabel,
        buildAttendanceQuery,
        canExportAttendance,
        period,
        search,
        selectedDate,
        selectedEmployeeOption,
        employees,
        statusFilter,
        summary,
    ]);

    const renderDailyAttendanceActions = (employee: Employee, record: EmployeeAttendanceRecord | null) => {
        if (!canManageAttendance) {
            return <span className="text-muted">Lihat saja</span>;
        }

        if (!record) {
            return (
                <div className="attendance-row-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => openCheckInModal(employee)}>
                        <LogIn size={14} /> Masuk
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openStatusModal(employee)}>
                        Status Lain
                    </button>
                </div>
            );
        }

        if (isCheckedInWithoutCheckout(record)) {
            return (
                <div className="attendance-row-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => openCheckoutModal(record, 'check-out')}>
                        <LogOut size={14} /> Pulang
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openCheckoutModal(record, 'early-leave')}>
                        Pulang Cepat
                    </button>
                    <button className="table-action-btn" onClick={() => openEditModal(record)}>
                        <Pencil size={14} /> Edit
                    </button>
                </div>
            );
        }

        return (
            <div className="attendance-row-actions">
                <button className="table-action-btn" onClick={() => openEditModal(record)}>
                    <Pencil size={14} /> Edit
                </button>
            </div>
        );
    };

    const renderInputView = () => (
        <>
            <div className="kpi-grid attendance-kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Karyawan Aktif</div><div className="kpi-value">{dailyAttendanceSummary.activeEmployeeCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Belum Tercatat</div><div className="kpi-value">{dailyAttendanceSummary.unrecordedEmployeeCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Sudah Masuk</div><div className="kpi-value">{dailyAttendanceSummary.present}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Belum Pulang</div><div className="kpi-value">{dailyAttendanceSummary.checkedInWithoutCheckout}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Pulang Cepat</div><div className="kpi-value">{dailyAttendanceSummary.earlyLeave}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Status Lain</div><div className="kpi-value">{dailyAttendanceSummary.nonAttendance}</div></div></div>
            </div>

            <div className="table-container" style={{ marginBottom: '1rem' }}>
                <div className="table-toolbar">
                    <div className="table-toolbar-left attendance-toolbar-filters">
                        <input
                            type="date"
                            className="form-input attendance-date-input"
                            value={selectedDate}
                            onChange={event => setSelectedDate(event.target.value)}
                        />
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input
                                placeholder="Cari kode, nama, divisi, jabatan..."
                                value={inputSearch}
                                onChange={event => setInputSearch(event.target.value)}
                            />
                        </div>
                        <select className="filter-select" value={inputDivisionFilter} onChange={event => setInputDivisionFilter(event.target.value)}>
                            <option value="">Semua Divisi</option>
                            {divisionOptions.map(division => (
                                <option key={division} value={division}>{division}</option>
                            ))}
                        </select>
                        <select className="filter-select" value={inputCoverageFilter} onChange={event => setInputCoverageFilter(event.target.value as AttendanceInputCoverage)}>
                            {INPUT_COVERAGE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <select
                            className="filter-select"
                            value={inputStatusFilter}
                            onChange={event => setInputStatusFilter(event.target.value)}
                            disabled={inputCoverageFilter === 'PENDING'}
                        >
                            <option value="">Semua Status Tercatat</option>
                            {EMPLOYEE_ATTENDANCE_STATUS_OPTIONS.map(status => (
                                <option key={status} value={status}>{EMPLOYEE_ATTENDANCE_STATUS_LABELS[status]}</option>
                            ))}
                        </select>
                    </div>
                    {hasInputCustomFilters && (
                        <div className="table-toolbar-right">
                            <button className="btn btn-secondary btn-sm" onClick={resetInputFilters}>
                                Reset Filter
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="table-container">
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>
                                    <SortableTableHeader
                                        label="Karyawan"
                                        direction={inputSort.field === 'employeeName' ? inputSort.direction : null}
                                        onToggle={() => toggleInputSort('employeeName')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Divisi / Jabatan"
                                        direction={inputSort.field === 'division' ? inputSort.direction : null}
                                        onToggle={() => toggleInputSort('division')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Status Hari Ini"
                                        direction={inputSort.field === 'status' ? inputSort.direction : null}
                                        onToggle={() => toggleInputSort('status')}
                                    />
                                </th>
                                <th>Jam Masuk</th>
                                <th>Jam Pulang</th>
                                <th>Catatan</th>
                                <th>
                                    <SortableTableHeader
                                        label="Input Terakhir"
                                        direction={inputSort.field === 'updatedAt' ? inputSort.direction : null}
                                        onToggle={() => toggleInputSort('updatedAt', 'desc')}
                                    />
                                </th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(index => (
                                <tr key={index}>
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(cell => (
                                        <td key={cell}><div className="skeleton skeleton-text" /></td>
                                    ))}
                                </tr>
                            )) : dailyAttendanceRows.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className="empty-state">
                                            <ScrollText size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Tidak ada karyawan yang cocok dengan filter input</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedDailyAttendanceRows.map(({ employee, record }) => (
                                <tr key={employee._id}>
                                    <td>
                                        <div className="font-semibold">{employee.name}</div>
                                        <div className="text-muted text-xs">{employee.employeeCode}</div>
                                    </td>
                                    <td>
                                        <div>{employee.division || '-'}</div>
                                        <div className="text-muted text-xs">{employee.position || '-'}</div>
                                    </td>
                                    <td>
                                        {record ? (
                                            <span className={`badge ${getDailyStatusBadgeClass(record)}`}>
                                                {getDailyStatusLabel(record)}
                                            </span>
                                        ) : (
                                            <span className="text-muted">Belum tercatat</span>
                                        )}
                                    </td>
                                    <td>{record?.checkInTime || '-'}</td>
                                    <td>{record?.checkOutTime || '-'}</td>
                                    <td className="text-muted" style={{ minWidth: 220 }}>{record?.note || '-'}</td>
                                    <td className="text-muted">
                                        {record ? (
                                            <>
                                                <div>{record.updatedAt ? formatDateTime(record.updatedAt) : '-'}</div>
                                                <div className="text-xs">{record.updatedByName || record.createdByName || '-'}</div>
                                            </>
                                        ) : (
                                            <div className="text-xs">Belum ada input</div>
                                        )}
                                    </td>
                                    <td>
                                        {renderDailyAttendanceActions(employee, record)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {dailyAttendanceRows.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Tidak ada karyawan yang cocok dengan filter input</div>
                            </div>
                        ) : paginatedDailyAttendanceRows.map(({ employee, record }) => (
                            <div key={employee._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{employee.name}</div>
                                        <div className="mobile-record-subtitle">{employee.employeeCode} | {employee.division || '-'} / {employee.position || '-'}</div>
                                    </div>
                                    {record ? (
                                        <span className={`badge ${getDailyStatusBadgeClass(record)}`}>
                                            {getDailyStatusLabel(record)}
                                        </span>
                                    ) : (
                                        <span className="badge badge-gray">Belum Tercatat</span>
                                    )}
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Jam Masuk</span>
                                        <span className="mobile-record-value">{record?.checkInTime || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Jam Pulang</span>
                                        <span className="mobile-record-value">{record?.checkOutTime || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Catatan</span>
                                        <span className="mobile-record-value">{record?.note || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Input Terakhir</span>
                                        <span className="mobile-record-value">{record?.updatedAt ? formatDateTime(record.updatedAt) : 'Belum ada input'}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    {renderDailyAttendanceActions(employee, record)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {dailyAttendanceRows.length > 0 && (
                    <AppPagination
                        page={dailyPage}
                        pageSize={INPUT_PAGE_SIZE}
                        totalItems={dailyAttendanceRows.length}
                        onPageChange={setDailyPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>{startIndex}-{endIndex} dari {totalItems} karyawan untuk input harian {formatAttendanceDateLabel(selectedDate)}</>
                        )}
                    />
                )}
            </div>
        </>
    );

    const renderRecapView = () => (
        <>
            <div className="kpi-grid attendance-kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Karyawan Aktif</div><div className="kpi-value">{summary?.activeEmployeeCount || activeEmployees.length}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Tercatat</div><div className="kpi-value">{summary?.recordedEmployeeCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hadir Normal</div><div className="kpi-value">{getNormalPresentCount(summary)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Pulang Cepat</div><div className="kpi-value">{summary?.earlyLeaveCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Izin</div><div className="kpi-value">{summary?.permissionCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Sakit</div><div className="kpi-value">{summary?.sickCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Cuti</div><div className="kpi-value">{summary?.leaveCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Alpha</div><div className="kpi-value">{summary?.absentCount || 0}</div></div></div>
            </div>

            <div className="table-container" style={{ marginBottom: '1rem' }}>
                <div className="table-toolbar">
                    <div className="table-toolbar-left attendance-toolbar-filters">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input
                                placeholder="Cari kode, nama, divisi, jabatan..."
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </div>
                        <select className="filter-select" value={period} onChange={event => setPeriod(event.target.value as EmployeeAttendancePeriod)}>
                            {PERIOD_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <input
                            type="date"
                            className="form-input attendance-date-input"
                            value={selectedDate}
                            onChange={event => setSelectedDate(event.target.value)}
                        />
                        <select className="filter-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            {EMPLOYEE_ATTENDANCE_STATUS_OPTIONS.map(status => (
                                <option key={status} value={status}>{EMPLOYEE_ATTENDANCE_STATUS_LABELS[status]}</option>
                            ))}
                        </select>
                        <select className="filter-select" value={employeeFilter} onChange={event => setEmployeeFilter(event.target.value)}>
                            <option value="">Semua Karyawan</option>
                            {employeeOptions.map(employee => (
                                <option key={employee._id} value={employee._id}>
                                    {employee.employeeCode} - {employee.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {hasCustomFilters && (
                        <div className="table-toolbar-right">
                            <button className="btn btn-secondary btn-sm" onClick={resetFilters}>
                                Reset Filter
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="table-container">
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>
                                    <SortableTableHeader
                                        label="Karyawan"
                                        direction={recapSort.field === 'employeeName' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('employeeName')}
                                    />
                                </th>
                                <th>Divisi / Jabatan</th>
                                <th>
                                    <SortableTableHeader
                                        label="Hari Tercatat"
                                        direction={recapSort.field === 'recordedDays' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('recordedDays', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Hadir Normal"
                                        direction={recapSort.field === 'presentCount' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('presentCount', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Pulang Cepat"
                                        direction={recapSort.field === 'earlyLeaveCount' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('earlyLeaveCount', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Izin"
                                        direction={recapSort.field === 'permissionCount' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('permissionCount', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Sakit"
                                        direction={recapSort.field === 'sickCount' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('sickCount', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Cuti"
                                        direction={recapSort.field === 'leaveCount' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('leaveCount', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Alpha"
                                        direction={recapSort.field === 'absentCount' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('absentCount', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Libur"
                                        direction={recapSort.field === 'offCount' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('offCount', 'desc')}
                                    />
                                </th>
                                <th>
                                    <SortableTableHeader
                                        label="Tanggal Terakhir"
                                        direction={recapSort.field === 'lastAttendanceDate' ? recapSort.direction : null}
                                        onToggle={() => toggleRecapSort('lastAttendanceDate', 'desc')}
                                    />
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(index => (
                                <tr key={index}>
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(cell => (
                                        <td key={cell}><div className="skeleton skeleton-text" /></td>
                                    ))}
                                </tr>
                            )) : recapRows.length === 0 ? (
                                <tr>
                                    <td colSpan={11}>
                                        <div className="empty-state">
                                            <ScrollText size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada absensi pada periode ini</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedRecapRows.map(row => (
                                <tr key={row.employeeRef}>
                                    <td>
                                        <div className="font-semibold">{row.employeeName || '-'}</div>
                                        <div className="text-muted text-xs">{row.employeeCode || '-'}</div>
                                    </td>
                                    <td>
                                        <div>{row.division || '-'}</div>
                                        <div className="text-muted text-xs">{row.position || '-'}</div>
                                    </td>
                                    <td>{row.recordedDays}</td>
                                    <td>{Math.max(row.presentCount - row.earlyLeaveCount, 0)}</td>
                                    <td>{row.earlyLeaveCount}</td>
                                    <td>{row.permissionCount}</td>
                                    <td>{row.sickCount}</td>
                                    <td>{row.leaveCount}</td>
                                    <td>{row.absentCount}</td>
                                    <td>{row.offCount}</td>
                                    <td className="text-muted">{row.lastAttendanceDate ? formatBusinessDate(row.lastAttendanceDate, 'id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {recapRows.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada absensi pada periode ini</div>
                            </div>
                        ) : paginatedRecapRows.map(row => (
                            <div key={row.employeeRef} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{row.employeeName || '-'}</div>
                                        <div className="mobile-record-subtitle">{row.employeeCode || '-'} | {row.division || '-'} / {row.position || '-'}</div>
                                    </div>
                                    <span className="badge badge-info">{row.recordedDays} Hari</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Hadir Normal / Pulang Cepat</span>
                                        <span className="mobile-record-value">{Math.max(row.presentCount - row.earlyLeaveCount, 0)} / {row.earlyLeaveCount}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Izin / Sakit / Cuti</span>
                                        <span className="mobile-record-value">{row.permissionCount} / {row.sickCount} / {row.leaveCount}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Alpha / Libur</span>
                                        <span className="mobile-record-value">{row.absentCount} / {row.offCount}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tanggal Terakhir</span>
                                        <span className="mobile-record-value">{row.lastAttendanceDate ? formatBusinessDate(row.lastAttendanceDate, 'id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {recapRows.length > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={recapRows.length}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>{startIndex}-{endIndex} dari {totalItems} karyawan pada rekap absensi periode {summary?.periodLabel || PERIOD_OPTIONS.find(option => option.value === period)?.label || ''}</>
                        )}
                    />
                )}
            </div>
        </>
    );

    const selectedFormEmployee = employeeOptions.find(employee => employee._id === form.employeeRef);
    const isQuickModal = modalMode !== 'manual' && modalMode !== 'edit';
    const statusOptions = modalMode === 'status' ? NON_ATTENDANCE_STATUS_OPTIONS : EMPLOYEE_ATTENDANCE_STATUS_OPTIONS;
    const isStatusLocked = modalMode === 'check-in' || modalMode === 'check-out' || modalMode === 'early-leave';
    const showTimeFields = requiresAttendanceTime(form.status);
    const showCheckInTime = showTimeFields;
    const showCheckOutTime = showTimeFields && modalMode !== 'check-in';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Absensi</h1>
                </div>
                <div className="page-actions">
                    {canExportAttendance && (
                        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
                            <FileDown size={15} /> Excel
                        </button>
                    )}
                    {canManageAttendance && (
                        <button className="btn btn-primary" onClick={() => openCreateModal()}>
                            <Plus size={18} /> Input Manual
                        </button>
                    )}
                </div>
            </div>
            <div className="segmented-tabs" style={{ marginBottom: '1rem' }}>
                <button className={`segmented-tab ${viewMode === 'input' ? 'active' : ''}`} onClick={() => setViewMode('input')}>
                    Input Harian
                </button>
                <button className={`segmented-tab ${viewMode === 'recap' ? 'active' : ''}`} onClick={() => setViewMode('recap')}>
                    Rekap Absensi
                </button>
            </div>

            {viewMode === 'input' ? renderInputView() : renderRecapView()}

            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{getModalTitle(modalMode, Boolean(editRecord))}</h3>
                            <button className="modal-close" onClick={closeModal} disabled={saving}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-grid">
                                <div className="form-group">
                                    <label className="form-label">Karyawan <span className="required">*</span></label>
                                    {isQuickModal ? (
                                        <input
                                            className="form-input"
                                            value={selectedFormEmployee ? `${selectedFormEmployee.employeeCode} - ${selectedFormEmployee.name}` : '-'}
                                            disabled
                                            readOnly
                                        />
                                    ) : (
                                        <>
                                            <input
                                                className="form-input"
                                                value={employeeSearchTerm}
                                                onChange={event => setEmployeeSearchTerm(event.target.value)}
                                                placeholder="Cari karyawan..."
                                                style={{ marginBottom: '0.5rem' }}
                                            />
                                            <select
                                                className="form-select"
                                                value={form.employeeRef}
                                                onChange={event => setForm(current => ({ ...current, employeeRef: event.target.value }))}
                                            >
                                                <option value="">Pilih karyawan</option>
                                                {filteredEmployeeOptions.map(employee => (
                                                    <option key={employee._id} value={employee._id}>
                                                        {employee.employeeCode} - {employee.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </>
                                    )}
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal <span className="required">*</span></label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={form.date}
                                        disabled={isQuickModal}
                                        onChange={event => setForm(current => ({ ...current, date: event.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label className="form-label">Status <span className="required">*</span></label>
                                    <select
                                        className="form-select"
                                        value={form.status}
                                        disabled={isStatusLocked}
                                        onChange={event => setForm(current => ({ ...current, status: event.target.value as EmployeeAttendanceStatus }))}
                                    >
                                        {statusOptions.map(status => (
                                            <option key={status} value={status}>
                                                {EMPLOYEE_ATTENDANCE_STATUS_LABELS[status]}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {showTimeFields && (
                                <div className="form-grid">
                                    {showCheckInTime && (
                                        <div className="form-group">
                                            <label className="form-label">Jam Masuk <span className="required">*</span></label>
                                            <input
                                                type="time"
                                                className="form-input"
                                                value={form.checkInTime}
                                                disabled={modalMode === 'check-out' || modalMode === 'early-leave'}
                                                onChange={event => setForm(current => ({ ...current, checkInTime: event.target.value }))}
                                            />
                                        </div>
                                    )}
                                    {showCheckOutTime && (
                                        <div className="form-group">
                                            <label className="form-label">Jam Pulang{form.status === 'PULANG_LEBIH_AWAL' || modalMode === 'check-out' ? ' *' : ''}</label>
                                            <input
                                                type="time"
                                                className="form-input"
                                                value={form.checkOutTime}
                                                onChange={event => setForm(current => ({ ...current, checkOutTime: event.target.value }))}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={form.note}
                                    onChange={event => setForm(current => ({ ...current, note: event.target.value }))}
                                    placeholder={requiresAttendanceTime(form.status) ? 'Catatan tambahan bila ada, misalnya alasan pulang lebih awal' : 'Contoh: izin keluarga, kontrol dokter, cuti tahunan'}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {getModalSaveLabel(modalMode, saving)}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
