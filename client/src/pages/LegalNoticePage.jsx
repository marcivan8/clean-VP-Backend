import React from 'react';
import LegalDocument from '../legal/LegalDocument';

// Content: client/src/locales/<lang>/legal.json, identity: client/src/legal/legalInfo.js
export default function LegalNoticePage() {
    return <LegalDocument ns="legal" />;
}
