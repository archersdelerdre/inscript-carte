import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { AdminApp } from './admin/admin-app.tsx';
import { App } from './App.tsx';
import { SessionProvider } from './auth/session.tsx';

// Two pages only, so no router: the server answers `index.html` for every path that is not the API.
const isAdminPage = /^\/admin(\/|$)/.test(location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>{isAdminPage ? <AdminApp /> : <App />}</SessionProvider>
  </StrictMode>,
);
