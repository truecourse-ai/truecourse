/**
 * Reactive dark-mode state plus a toggle. `isDark` mirrors the `dark`
 * class on <html> (via useDarkMode); `toggle` flips it and persists the
 * choice. Shared by the header (community) and the user menu
 * (enterprise) so the theme control has a single implementation.
 */

import { useCallback } from 'react';
import { useDarkMode } from './useDarkMode';

export function useThemeToggle(): { isDark: boolean; toggle: () => void } {
  const isDark = useDarkMode();
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }, []);
  return { isDark, toggle };
}
