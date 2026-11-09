import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// O jsdom não implementa scrollTo, usado pela restauração de rolagem do roteador.
Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
