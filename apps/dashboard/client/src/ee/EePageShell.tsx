/**
 * Shared layout shell for enterprise pages (e.g. Workspace): the same
 * dashboard chrome the OSS pages use — the top Header (logo + nav +
 * user menu) with the page content below.
 *
 * Lives on the OSS side and wraps ee route content in App's route
 * registry, so the ee client package doesn't need to reach across the
 * package boundary to import OSS layout components.
 */

import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';

export function EePageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
