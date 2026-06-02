// Loaded once per worker before any client test file. Registers
// jest-dom's custom matchers (toBeInTheDocument, toHaveClass, ...) on
// vitest's expect and wires automatic React Testing Library cleanup
// between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
