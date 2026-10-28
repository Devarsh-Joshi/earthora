import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { Toaster } from '@/components/ui/toaster';

import './index.css';

// Static SEO pages use directory URLs. Keep the client router's path canonical
// after a direct request (nginx/Netlify may add the trailing slash).
if (window.location.pathname.length > 1 && window.location.pathname.endsWith('/')) {
  window.history.replaceState(window.history.state, '', window.location.pathname.replace(/\/+$/, '') + window.location.search + window.location.hash);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>
);
