import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import AnalyzerPage from './pages/AnalyzerPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/analyzer" element={<AnalyzerPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
