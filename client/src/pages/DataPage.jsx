import React from 'react';
import LegalDocument from '../legal/LegalDocument';

// Content: client/src/locales/<lang>/data.json, identity: client/src/legal/legalInfo.js
export default function DataPage() {
    return <LegalDocument ns="data" />;
}
