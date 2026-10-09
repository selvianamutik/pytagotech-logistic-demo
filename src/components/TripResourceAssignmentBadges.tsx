"use client";

import type { TripResourceAssignment } from '@/lib/trip-resource-lock-support';

type BadgeColor = 'gray' | 'info' | 'warning' | 'success' | 'secondary';

type AssignmentStatusMeta = { label: string; color: BadgeColor };

const ASSIGNMENT_STATUS_META: Record<string, AssignmentStatusMeta> = {
    CREATED: { label: 'Siap', color: 'gray' },
    ON_DELIVERY: { label: 'Jalan', color: 'info' },
    ARRIVED: { label: 'Tiba', color: 'info' },
    PARTIAL_HOLD: { label: 'Hold', color: 'warning' },
};

const PLAN_STATUS_META: AssignmentStatusMeta = { label: 'Rencana', color: 'secondary' };

export function getTripAssignmentStatusMeta(assignment: TripResourceAssignment): AssignmentStatusMeta {
    if (assignment.source === 'orderTripPlan') {
        return PLAN_STATUS_META;
    }
    return (assignment.status && ASSIGNMENT_STATUS_META[assignment.status]) || PLAN_STATUS_META;
}

function StatusBadge({ assignment }: { assignment: TripResourceAssignment }) {
    const meta = getTripAssignmentStatusMeta(assignment);
    return (
        <span className={`badge badge-${meta.color}`}>
            <span className="badge-dot" /> {meta.label}
        </span>
    );
}

export function TripAssignmentDropdownMeta({ assignments }: { assignments: TripResourceAssignment[] }) {
    if (!assignments || assignments.length === 0) {
        return null;
    }
    const [first] = assignments;
    return (
        <span className="trip-assignment-dropdown-meta">
            <span className="trip-assignment-dropdown-label">{first.label}</span>
            <span className="badge badge-gray">{assignments.length} DO aktif</span>
        </span>
    );
}

export function TripResourceAssignmentBadges({
    assignments,
    variant = 'inline',
}: {
    assignments: TripResourceAssignment[];
    variant?: 'inline' | 'list';
}) {
    if (!assignments || assignments.length === 0) {
        return null;
    }

    if (variant === 'inline') {
        const [first] = assignments;
        return (
            <span className="trip-assignment-inline">
                <span className="trip-assignment-inline-label">{first.label}</span>
                <span className="badge badge-gray">
                    <span className="badge-dot" /> {assignments.length} DO aktif
                </span>
            </span>
        );
    }

    return (
        <div className="trip-assignment-list">
            <div className="text-muted text-sm">
                Sudah dipakai di {assignments.length} DO/trip aktif. Boleh dipakai di beberapa DO sekaligus.
            </div>
            <ul className="trip-assignment-list-items">
                {assignments.map(assignment => (
                    <li key={`${assignment.source}-${assignment.sourceRef}-${assignment.tripPlanKey || ''}`} className="trip-assignment-list-item">
                        <span className="trip-assignment-list-label">{assignment.label}</span>
                        <StatusBadge assignment={assignment} />
                    </li>
                ))}
            </ul>
        </div>
    );
}
