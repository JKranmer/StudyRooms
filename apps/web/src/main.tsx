import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app';
import { createSimulatedAuthStore } from '@/auth/auth-store';
import { createQueryClient } from '@/query-client';
import { createAppRouter } from '@/router';
import './index.css';

const auth = createSimulatedAuthStore();
const queryClient = createQueryClient();
const router = createAppRouter({ auth, queryClient });

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Elemento #root não encontrado em index.html.');

createRoot(rootElement).render(
  <StrictMode>
    <App auth={auth} queryClient={queryClient} router={router} />
  </StrictMode>,
);
