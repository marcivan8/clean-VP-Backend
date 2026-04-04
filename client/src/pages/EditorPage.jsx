import React, { useEffect } from 'react';
import IDELayout from '../layouts/IDELayout';
import useTimelineStore from '../store/useTimelineStore';

console.log("[EditorPage] Component Rendered");
const EditorPage = () => {
    return (
        <IDELayout mode="editor" />
    );
};

export default EditorPage;
