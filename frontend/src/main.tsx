/**
 * main.tsx
 *
 * Application entry point. Mounts the React tree into the #root div defined
 * in index.html. StrictMode is enabled to surface potential issues during
 * development (double-invocations, deprecated API warnings).
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
