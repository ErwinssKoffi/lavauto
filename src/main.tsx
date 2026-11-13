import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './lib/store';
import { ErrorBoundary } from './components/feedback';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

let saved: string | null = null;
try { saved = localStorage.getItem('washguard.theme'); } catch { /* préférence facultative */ }
document.documentElement.classList.toggle(
  'dark',
  saved === null ? true : saved === 'dark'
);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      window.setInterval(() => {
        if (navigator.onLine) {
          void registration.update().catch(() => undefined);
        }
      }, 60 * 60 * 1000);
    },
    onRegisterError() {
      // Ne jamais bloquer le démarrage station si l'enregistrement SW échoue.
    },
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <StoreProvider>
          <App />
        </StoreProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
