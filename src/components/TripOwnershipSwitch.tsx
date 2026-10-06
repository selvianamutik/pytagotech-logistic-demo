'use client';

import { useId, useRef } from 'react';
import { Handshake, Info, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { normalizeTripOwnership, TRIP_OWNERSHIP_LABELS, type TripOwnership } from '@/lib/types';

interface TripOwnershipSwitchProps {
    value: TripOwnership;
    onChange: (value: TripOwnership) => void;
    disabled?: boolean;
}

const OWNERSHIP_ORDER: TripOwnership[] = ['INTERNAL', 'MITRA'];

const OWNERSHIP_ICONS: Record<TripOwnership, LucideIcon> = {
    INTERNAL: Truck,
    MITRA: Handshake,
};

/**
 * Konsekuensi tiap pilihan ditulis di bawah kontrol supaya operator tahu
 * apa yang berubah sebelum menyimpan, bukan dari errornya.
 */
const OWNERSHIP_HINTS: Record<TripOwnership, string> = {
    INTERNAL: 'Pakai kendaraan, supir, dan upah driver dari sistem.',
    MITRA: 'Tanpa kendaraan, supir, kas uang jalan, dan upah driver internal. Armada dan upah dikelola di luar sistem.',
};

/**
 * Pemilih jenis trip. Dua pilihan yang saling meniadakan, jadi memakai
 * pola radiogroup (bukan tab): panah kiri/kanan untuk berpindah, sesuai
 * gaya `.segmented-tabs` yang dipakai di toolbar dan form lain.
 */
export function TripOwnershipSwitch({ value, onChange, disabled = false }: TripOwnershipSwitchProps) {
    const labelId = useId();
    const active = normalizeTripOwnership(value);
    const buttonsRef = useRef<Partial<Record<TripOwnership, HTMLButtonElement | null>>>({});

    function select(next: TripOwnership) {
        if (disabled || next === active) return;
        onChange(next);
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % OWNERSHIP_ORDER.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + OWNERSHIP_ORDER.length) % OWNERSHIP_ORDER.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = OWNERSHIP_ORDER.length - 1;
        if (nextIndex === null) return;

        event.preventDefault();
        const next = OWNERSHIP_ORDER[nextIndex];
        select(next);
        buttonsRef.current[next]?.focus();
    }

    return (
        <div className="form-group trip-ownership-switch" style={{ marginBottom: 0 }}>
            <span className="form-label" id={labelId}>Jenis Trip</span>
            <div className="segmented-tabs" role="radiogroup" aria-labelledby={labelId}>
                {OWNERSHIP_ORDER.map((option, index) => {
                    const Icon = OWNERSHIP_ICONS[option];
                    const isActive = active === option;
                    return (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            ref={element => { buttonsRef.current[option] = element; }}
                            aria-checked={isActive}
                            tabIndex={isActive ? 0 : -1}
                            disabled={disabled}
                            className={`segmented-tab ${isActive ? 'active' : ''}`}
                            onClick={() => select(option)}
                            onKeyDown={event => handleKeyDown(event, index)}
                            title={OWNERSHIP_HINTS[option]}
                        >
                            <Icon size={16} />
                            {TRIP_OWNERSHIP_LABELS[option]}
                        </button>
                    );
                })}
            </div>
            <p className="trip-ownership-hint">
                <Info size={14} aria-hidden="true" />
                <span>{OWNERSHIP_HINTS[active]}</span>
            </p>
        </div>
    );
}