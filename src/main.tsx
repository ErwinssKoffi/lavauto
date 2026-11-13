import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './lib/store';
import { ErrorBoundary } from './components/feedback';
import './index.css';

let saved: string | null = null;
try { saved = localStorage.getItem('washguard.theme'); } catch { /* préférence facultative */ }
document.documentElement.classList.toggle(
  'dark',
  saved === null ? true : saved === 'dark'
);

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
