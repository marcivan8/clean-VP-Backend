import React from 'react';
import LegalDocument from '../legal/LegalDocument';

// Content: client/src/locales/<lang>/terms.json, identity: client/src/legal/legalInfo.js
export default function TermsPage() {
    return <LegalDocument ns="terms" />;
}
