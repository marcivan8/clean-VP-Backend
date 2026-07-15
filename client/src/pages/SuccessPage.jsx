import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function SuccessPage() {
    const navigate = useNavigate();
    const { t } = useTranslation('common');
    const [params] = useSearchParams();
    const checkoutId = params.get('checkout_id');
    const [countdown, setCountdown] = useState(5);

    useEffect(() => {
        if (!checkoutId) { navigate('/dashboard'); return; }
        const timer = setInterval(() => {
            setCountdown(n => {
                if (n <= 1) { clearInterval(timer); navigate('/dashboard'); }
                return n - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [checkoutId, navigate]);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)', color: 'var(--fg)',
            flexDirection: 'column', gap: 24, textAlign: 'center', padding: '0 24px',
        }}>
            <CheckCircle2 size={56} strokeWidth={1.5} color="var(--mint)" />
            <h1 className="display" style={{ fontSize: 'clamp(32px, 5vw, 56px)', margin: 0 }}>
                {t('success.heading')}
            </h1>
            <p className="body-lg" style={{ margin: 0, maxWidth: 480, color: 'var(--fg-2)' }}>
                {t('success.body', { count: countdown })}
            </p>
            <button
                className="btn btn-primary"
                style={{ padding: '0 32px', height: 48, fontSize: 16 }}
                onClick={() => navigate('/dashboard')}
            >
                {t('success.cta')}
            </button>
        </div>
    );
}
