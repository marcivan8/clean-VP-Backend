// Legal identity used by every legal page (terms, privacy, legal notice...).
// Change it here, not in the locale files: the texts read these values
// through {{placeholders}}.
//
// TO CONFIRM before publishing (see claude/rgpd-audit-2026-10.md):
//   - ownerName: full legal name exactly as it will appear on the SIRENE register
//   - siren: set once the INSEE registration is done (null shows "pending")
//   - phone: the LCEN requires a phone number for an EI (null hides the line)
//   - railwayRegion: where the Railway services run (Settings > Region)
//   - mediator: the consumer mediation body you join (required for B2C sales)

export const LEGAL = {
    tradeName: 'Vibed',
    ownerName: 'Marc Ivan Stevie Nguidjol',
    street: '24 rue Pasteur',
    postcode: '94270',
    city: 'Le Kremlin-Bicêtre',
    country: { en: 'France', fr: 'France' },
    email: 'marc@vibedstudio.com',
    phone: null,
    siren: null,
    lastUpdated: '2026-10-04',
    railwayRegion: { en: 'United States', fr: 'États-Unis' },
    hostingerEntity: { en: 'Hostinger (Türkiye)', fr: 'Hostinger (Turquie)' },
    mediator: null,
    retentionDays: { free: 7, creator: 30 },
    prices: { creator: '€15', pro: '€35' },
};

const TEXT = {
    en: {
        legalForm: 'sole trader (entrepreneur individuel, EI)',
        sirenPending: 'registration in progress',
        mediatorPending: 'being appointed; until then, write to us and we will reply within 15 days',
    },
    fr: {
        legalForm: 'entrepreneur individuel (EI)',
        sirenPending: "en cours d'immatriculation",
        mediatorPending: 'en cours de désignation ; dans l\'intervalle, écrivez-nous et nous vous répondrons sous 15 jours',
    },
};

/** Values for i18next interpolation in the legal namespaces. */
export function legalValues(lang) {
    const l = String(lang || 'en').startsWith('fr') ? 'fr' : 'en';
    const tx = TEXT[l];
    const date = new Date(`${LEGAL.lastUpdated}T12:00:00Z`).toLocaleDateString(l === 'fr' ? 'fr-FR' : 'en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
    return {
        tradeName: LEGAL.tradeName,
        ownerName: LEGAL.ownerName,
        legalForm: tx.legalForm,
        address: `${LEGAL.street}, ${LEGAL.postcode} ${LEGAL.city}, ${LEGAL.country[l]}`,
        email: LEGAL.email,
        phone: LEGAL.phone || '',
        siren: LEGAL.siren || tx.sirenPending,
        date,
        railwayRegion: LEGAL.railwayRegion[l],
        hostingerEntity: LEGAL.hostingerEntity[l],
        mediator: LEGAL.mediator || tx.mediatorPending,
        freeDays: LEGAL.retentionDays.free,
        creatorDays: LEGAL.retentionDays.creator,
        creatorPrice: LEGAL.prices.creator,
        proPrice: LEGAL.prices.pro,
        interpolation: { escapeValue: false },
    };
}
