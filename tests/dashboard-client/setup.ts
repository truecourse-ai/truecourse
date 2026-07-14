// Loaded once per worker before any client test file. Registers
// jest-dom's custom matchers (toBeInTheDocument, toHaveClass, ...) on
// vitest's expect and wires automatic React Testing Library cleanup
// between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom implements no layout, so scrollIntoView is missing. Components that scroll
// a selected/conflicting section into view (SpecDocViewer, GuardDocCoverage) call
// it in an effect — polyfill it as a no-op so those effects don't throw in tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
