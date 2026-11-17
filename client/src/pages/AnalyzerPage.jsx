import React from 'react';
import IDELayout from '../layouts/IDELayout';

const AnalyzerPage = ({ mode = 'design' }) => {
    return (
        <IDELayout mode={mode} />
    );
};

export default AnalyzerPage;
