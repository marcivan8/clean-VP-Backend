import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// EN
import enCommon  from './locales/en/common.json';
import enEditor  from './locales/en/editor.json';
import enLanding from './locales/en/landing.json';
import enErrors  from './locales/en/errors.json';

// FR
import frCommon  from './locales/fr/common.json';
import frEditor  from './locales/fr/editor.json';
import frLanding from './locales/fr/landing.json';
import frErrors  from './locales/fr/errors.json';

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: {
                common:  enCommon,
                editor:  enEditor,
                landing: enLanding,
                errors:  enErrors,
            },
            fr: {
                common:  frCommon,
                editor:  frEditor,
                landing: frLanding,
                errors:  frErrors,
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
