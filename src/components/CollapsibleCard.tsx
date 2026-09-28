'use client';

import { useState, type ReactNode } from 'react';

type CollapsibleCardAccent = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

type CollapsibleCardProps = {
    title: string;
    subtitle?: string;
    defaultOpen?: boolean;
    onOpenChange?: (isOpen: boolean) => void;
    /**
     * Tombol aksi yang tampil di kanan header, sebelum ikon +/-. Dipisah dari
     * tombol toggle karena `<button>` tidak boleh berisi `<button>` lain, dan
     * aksi ini tidak boleh ikut menutup/membuka card ketika diklik.
     */
    action?: ReactNode;
    /** Ikon penanda section, dibuat agar tiap card mudah dibedakan saat dipindai. */
    icon?: ReactNode;
    /** Warna latar ikon dan aksen judul. */
    accent?: CollapsibleCardAccent;
    children: ReactNode;
};

export default function CollapsibleCard({
    title,
    subtitle,
    defaultOpen = false,
    onOpenChange,
    action,
    icon,
    accent = 'gray',
    children,
}: CollapsibleCardProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const handleToggle = () => {
        const nextOpen = !isOpen;
        setIsOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    return (
        <section className={`collapsible-card${isOpen ? ' is-open' : ''}`}>
            <div className="collapsible-card-header">
                <button
                    type="button"
                    className="collapsible-card-summary"
                    aria-expanded={isOpen}
                    onClick={handleToggle}
                >
                    <div className="collapsible-card-heading">
                        {icon && (
                            <span className={`collapsible-card-icon collapsible-card-icon-${accent}`}>
                                {icon}
                            </span>
                        )}
                        <div>
                            <div className="collapsible-card-title">{title}</div>
                            {subtitle && <div className="collapsible-card-subtitle">{subtitle}</div>}
                        </div>
                    </div>
                </button>
                {action && <div className="collapsible-card-action">{action}</div>}
                {/* Ikon +/- digambar sendiri, bukan lewat `::after` summary, supaya
                    tetap bisa berada di paling kanan meski ada tombol aksi. */}
                <span className="collapsible-card-toggle" aria-hidden="true" />
            </div>
            {isOpen && (
                <div className="collapsible-card-body">
                    {children}
                </div>
            )}
        </section>
    );
}
