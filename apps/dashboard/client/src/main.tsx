import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/globals.css';
// What this edition adds to the shell, registered before anything renders. The
// build resolves `@edition` to the enterprise bundle when the checkout has one
// and to the open edition's no-op when it does not.
import { registerEditionFeatures } from '@edition';
import App from './App';

registerEditionFeatures();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
