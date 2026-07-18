import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// EN
import enCommon    from './locales/en/common.json';
import enEditor    from './locales/en/editor.json';
import enLanding   from './locales/en/landing.json';
import enErrors    from './locales/en/errors.json';
import enAbout     from './locales/en/about.json';
import enPrivacy   from './locales/en/privacy.json';
import enData      from './locales/en/data.json';
import enCookies   from './locales/en/cookies.json';
import enAuth      from './locales/en/auth.json';
import enDashboard from './locales/en/dashboard.json';

// FR
import frCommon    from './locales/fr/common.json';
import frEditor    from './locales/fr/editor.json';
import frLanding   from './locales/fr/landing.json';
import frErrors    from './locales/fr/errors.json';
import frAbout     from './locales/fr/about.json';
import frPrivacy   from './locales/fr/privacy.json';
import frData      from './locales/fr/data.json';
import frCookies   from './locales/fr/cookies.json';
import frAuth      from './locales/fr/auth.json';
import frDashboard from './locales/fr/dashboard.json';

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: {
                common:    enCommon,
                editor:    enEditor,
                landing:   enLanding,
                errors:    enErrors,
                about:     enAbout,
                privacy:   enPrivacy,
                data:      enData,
                cookies:   enCookies,
                auth:      enAuth,
                dashboard: enDashboard,
            },
            fr: {
                common:    frCommon,
                editor:    frEditor,
                landing:   frLanding,
                errors:    frErrors,
                about:     frAbout,
                privacy:   frPrivacy,
                data:      frData,
                cookies:   frCookies,
                auth:      frAuth,
                dashboard: frDashboard,
            },
        },
        fallbackLng: 'en',
        defaultNS: 'common',
        detection: {
            // Check localStorage first, then browser Accept-Language header
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
            lookupLocalStorage: 'vibed_lang',
        },
        interpolation: {
            escapeValue: false, // React handles XSS
        },
    });

export default i18n;
