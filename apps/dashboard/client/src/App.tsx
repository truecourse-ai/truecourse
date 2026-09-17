/**
 * The dashboard's root: the capability and auth providers, the router, and the
 * app itself, mounted at `/`. Every address the product has is a route of
 * {@link DashboardApp}, behind the auth gate — except the invite page, which a
 * person who is not signed in yet has to be able to open. A local server has
 * nobody to invite, so there it is not a route at all.
 *
 * {@link Analytics} rides inside the router and outside the gate: it needs the
 * address to report a pageview, and a visit counts before a session does.
 */

import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useDarkMode } from './hooks/useDarkMode';
import { Analytics } from './lib/analytics';
import { AppProvider, useServerMode } from './contexts/CapabilityContext';
import { AuthProvider, AuthGate } from './auth/AuthContext';
import { InvitePage } from './auth/InvitePage';
import DashboardApp from './dashboard/DashboardApp';

/** The routes: the invite page beside the gate, everything else behind it. */
function AppRoutes({ children }: { children: ReactNode }) {
  const local = useServerMode() === 'local';
  return (
    <Routes>
      {!local && <Route path="/invite/:token" element={<InvitePage />} />}
      <Route path="/*" element={children} />
    </Routes>
  );
}

export default function App() {
  // Mirror the Header toggle so sonner's palette flips with the rest
  // of the dashboard instead of following OS preference.
  const isDark = useDarkMode();

  return (
    <AppProvider>
      <AuthProvider>
        <BrowserRouter>
          <Analytics />
          <AppRoutes>
            <AuthGate>
              <DashboardApp />
              <Toaster
                position="bottom-center"
                theme={isDark ? 'dark' : 'light'}
                closeButton
                toastOptions={{
                  // Solid surface (matches `bg-popover` used by HoverPopover)
                  // with a strong tinted border + tinted text per type. Drops
                  // sonner's `richColors` palette in favour of the dashboard's
                  // emerald / amber / red / blue tokens.
                  unstyled: true,
                  duration: 10000,
                  classNames: {
                    toast:
                      'font-sans w-full flex items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg bg-popover text-popover-foreground border-border',
                    title: 'font-semibold leading-tight',
                    description: 'mt-0.5 text-xs leading-snug opacity-90',
                    actionButton:
                      'shrink-0 self-center whitespace-nowrap rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90',
                    cancelButton:
                      'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted',
                    closeButton:
                      'absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-muted',
                    success: '!text-emerald-700 dark:!text-emerald-300',
                    error: '!text-red-700 dark:!text-red-300',
                    warning: '!text-amber-700 dark:!text-amber-300',
                    info: '!text-blue-700 dark:!text-blue-300',
                  },
                }}
              />
            </AuthGate>
          </AppRoutes>
        </BrowserRouter>
      </AuthProvider>
    </AppProvider>
  );
}
