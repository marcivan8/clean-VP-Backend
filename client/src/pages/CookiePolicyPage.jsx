import React from 'react';
import LegalDocument from '../legal/LegalDocument';

// Content: client/src/locales/<lang>/cookies.json, identity: client/src/legal/legalInfo.js
export default function CookiePolicyPage() {
    return <LegalDocument ns="cookies" />;
}
