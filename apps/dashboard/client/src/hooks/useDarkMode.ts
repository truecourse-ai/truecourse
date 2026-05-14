/**
 * Mirrors the `dark` class that the Header toggle sets on
 * `<html>`. Use anywhere a third-party component (sonner, charts,
 * etc.) needs an explicit `'dark' | 'light'` flag instead of inheriting
 * via CSS.
 */

import { useEffect, useState } from 'react';

export function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains('dark'));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
