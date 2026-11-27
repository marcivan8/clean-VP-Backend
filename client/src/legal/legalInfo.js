// Legal identity used by every legal page (terms, privacy, legal notice...).
// Change it here, not in the locale files: the texts read these values
// through {{placeholders}}.
//
// CIJE identity details supplied by the user. A value left null renders as
// NOTHING: every line or sentence that shows it carries `requires: "<key>"`
// and LegalDocument hides it. (It used to print "To be completed"; the owner
// asked for empty information to be removed instead.) LCEN art. 6-III
// requires, for a company: name, legal form, share capital, registered office,
// RCS registration, phone, email, a NATURAL PERSON as publication director, and
// the host's name, address and phone. Fill the nulls before publishing.
// SIRET 822 297 560 00192 passes its Luhn check and FR41822297560 is the VAT
// number its SIREN produces (key (12 + 3 * (SIREN mod 97)) mod 97 = 41).

export const LEGAL = {
    tradeName: 'Vibed',
    brandName: 'VIBED STUDIO',
    // Denomination exactly as on the RCS (Kbis); the trade name is shown separately.
    ownerName: "COOPERATIVE D'INITIATIVE JEUNES (CIJE)",
    cijeTradeName: "Coopérative d'Initiative Jeunes Entrepreneur.e.s",
    legalForm: 'personne morale',
    // From the Kbis: société coopérative à responsabilité limitée (SCIC SARL),
    // variable capital. The Kbis states no fixed amount, so the variable-capital
    // mention stands in for it.
    companyForm: {
        en: 'limited-liability cooperative company (SCIC SARL) with variable capital',
        fr: 'société coopérative à responsabilité limitée (SCIC SARL) à capital variable',
    },
    shareCapital: { en: 'Variable capital', fr: 'Capital variable' },
    rcs: {
        en: '822 297 560 R.C.S. Bastia (secondary registration: R.C.S. Paris)',
        fr: '822 297 560 R.C.S. Bastia (immatriculation secondaire : R.C.S. Paris)',
    },
    // The main registration is in Bastia, so the HEAD OFFICE is there; the Paris
    // address below is the establishment (SIRET …00192).
    headOffice: '6 route de Ville la Chapelle, 20200 Bastia, France',
    street: '148 rue du Faubourg Saint-Denis',
    postcode: '75010',
    city: 'Paris',
    country: { en: 'France', fr: 'France' },
    email: 'marc@vibedstudio.com',
    phone: null,
    website: 'https://vibedstudio.com', // production URL (auth redirects, email domain)
    hostPhone: null,
    siret: '822 297 560 00192',
    vatNumber: 'FR41822297560',
    capeRelationship: {
        en: 'VIBED STUDIO is a brand legally hosted under a CAPE agreement by CIJE.',
        fr: 'VIBED STUDIO est une marque hébergée juridiquement sous CAPE par la CIJE Île-de-France.',
    },
    // Must be a natural person (normally CIJE's legal representative, or the
    // person it delegates). "CIJE / VIBED STUDIO" is not valid for this line.
    // CIJE's gérant (legal representative), per the contract documentation.
    publicationDirector: {
        en: 'Christian Crozet, manager (gérant) of CIJE',
        fr: 'Christian Crozet, gérant de la CIJE',
    },
    lastUpdated: '2026-11-27',
    railwayRegion: { en: 'United States', fr: 'États-Unis' },
    hostingerEntity: { en: 'Hostinger (Türkiye)', fr: 'Hostinger (Turquie)' },
    mediator: null,
    retentionDays: { free: 7, creator: 30 },
    prices: {
        creator: { en: '€19', fr: '19 €' },
        pro: { en: '€39', fr: '39 €' },
    },
};

const TEXT = {
    en: {
        legalForm: 'limited-liability cooperative company (SCIC SARL) with variable capital',
    },
    fr: {
        legalForm: 'société coopérative à responsabilité limitée (SCIC SARL) à capital variable',
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
        brandName: LEGAL.brandName,
        ownerName: LEGAL.ownerName,
        legalForm: tx.legalForm,
        address: `${LEGAL.street}, ${LEGAL.postcode} ${LEGAL.city}, ${LEGAL.country[l]}`,
        email: LEGAL.email,
        phone: LEGAL.phone || '',
        website: LEGAL.website || '',
        hostPhone: LEGAL.hostPhone || '',
        siret: LEGAL.siret,
        vatNumber: LEGAL.vatNumber,
        capeRelationship: LEGAL.capeRelationship[l],
        publicationDirector: LEGAL.publicationDirector?.[l] || '',
        companyForm: LEGAL.companyForm?.[l] || '',
        shareCapital: LEGAL.shareCapital?.[l] || '',
        rcs: LEGAL.rcs?.[l] || '',
        headOffice: LEGAL.headOffice || '',
        cijeTradeName: LEGAL.cijeTradeName,
        siren: LEGAL.siret.slice(0, 11).replace(/\s/g, ''),
        date,
        railwayRegion: LEGAL.railwayRegion[l],
        hostingerEntity: LEGAL.hostingerEntity[l],
        mediator: LEGAL.mediator || '',
        freeDays: LEGAL.retentionDays.free,
        creatorDays: LEGAL.retentionDays.creator,
        creatorPrice: LEGAL.prices.creator[l],
        proPrice: LEGAL.prices.pro[l],
        interpolation: { escapeValue: false },
    };
}
