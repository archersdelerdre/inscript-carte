import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { SessionProvider } from './auth/session.tsx';

// Two pages only, so no router: the server answers `index.html` for every path that is not the API. Each page is its
// own chunk: members never download the admin panel, admins never download the map.
const isAdminPage = /^\/admin(\/|$)/.test(location.pathname);
const Page = isAdminPage
  ? lazy(() => import('./admin/admin-app.tsx').then(({ AdminApp }) => ({ default: AdminApp })))
  : lazy(() => import('./App.tsx').then(({ App }) => ({ default: App })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <Suspense>
        <Page />
      </Suspense>
    </SessionProvider>
  </StrictMode>,
);
