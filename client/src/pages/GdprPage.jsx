import React from 'react';
import LegalDocument from '../legal/LegalDocument';

// Content: client/src/locales/<lang>/gdpr.json, identity: client/src/legal/legalInfo.js
export default function GdprPage() {
    return <LegalDocument ns="gdpr" />;
}
