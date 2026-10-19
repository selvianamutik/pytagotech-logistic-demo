'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { DEFAULT_COMPANY_LOGO_URL } from '@/lib/branding';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, scope: 'ADMIN' }),
            });

            const raw = await res.text();
            let data: { error?: string; user?: { role?: string } } = {};
            if (raw) {
                try {
                    data = JSON.parse(raw) as { error?: string; user?: { role?: string } };
                } catch {
                    // Keep a fallback message for non-JSON server responses.
                    data = {};
                }
            }

            if (!res.ok) {
                setError(data.error || `Login gagal (${res.status})`);
                setLoading(false);
                return;
            }

            window.location.assign('/dashboard');
        } catch {
            setError('Tidak dapat terhubung ke server');
            setLoading(false);
        }
    };

    return (
        <main className="login-page">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo login-logo--image">
                        <Image
                            src={DEFAULT_COMPANY_LOGO_URL}
                            alt="Logo PT Logistik Demo"
                            width={56}
                            height={56}
                            className="login-logo-image"
                            priority
                        />
                    </div>
                    <h1 className="login-title">PT Logistik Demo</h1>
                    <p className="login-subtitle">Panel Administrasi Internal</p>
                </div>

                <div className="login-body">
                    {error && (
                        <div className="login-error">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label className="form-label" htmlFor="email">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                className="form-input"
                                placeholder="Masukkan email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                                autoComplete="email"
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="password">
                                Password
                            </label>
                            <div className="password-wrapper">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    className="form-input"
                                    placeholder="Masukkan password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary login-btn"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={18} className="spinner" />
                                    Masuk...
                                </>
                            ) : (
                                'Masuk'
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </main>
    );
}
