import { Suspense, lazy, useMemo, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import HomePage from './components/pages/HomePage';
import RepoPage from './components/pages/RepoPage';
import { useDarkMode } from './hooks/useDarkMode';
import { AppProvider } from './contexts/CapabilityContext';
import { EeModuleProvider, useEeModule } from './ee/EeModuleContext';
import { EeAuthProvider, EnterpriseAuthGate } from './ee/EeAuthContext';
import { EePageShell } from './ee/EePageShell';

/**
 * Route registry: the OSS routes plus any routes contributed by the
 * enterprise client module (capability-filtered, lazy-loaded into their
 * own chunks). ee contributes routes as data — it never edits this file.
 */
function AppRoutes() {
  const { routes: eeRoutes, homeComponent } = useEeModule();
  const eeElements = useMemo(
    () =>
      eeRoutes.map((r) => ({
        path: r.path,
        Component: lazy(
          () => r.load() as Promise<{ default: ComponentType }>,
        ),
      })),
    [eeRoutes],
  );
  // Enterprise replaces the OSS home ("/") with the workspace dashboard,
  // when the ee module provides one.
  const EeHome = useMemo(
    () =>
      homeComponent
        ? lazy(() => homeComponent() as Promise<{ default: ComponentType }>)
        : null,
    [homeComponent],
  );

  return (
    <Routes>
      <Route
        path="/"
        element={
          EeHome ? (
            <EePageShell>
              <Suspense>
                <EeHome />
              </Suspense>
            </EePageShell>
          ) : (
            <HomePage />
          )
        }
      />
      <Route
        path="/repos/:repoId"
        element={
          <Suspense>
            <RepoPage />
          </Suspense>
        }
      />
      {eeElements.map(({ path, Component }) => (
        <Route
          key={path}
          path={path}
          element={
            <EePageShell>
              <Suspense>
                <Component />
              </Suspense>
            </EePageShell>
          }
        />
      ))}
    </Routes>
  );
}

export default function App() {
  // Mirror the Header toggle so sonner's palette flips with the rest
  // of the dashboard instead of following OS preference.
  const isDark = useDarkMode();

  return (
    <AppProvider>
      <EeModuleProvider>
        <EeAuthProvider>
        <BrowserRouter>
          <EnterpriseAuthGate>
          <AppRoutes />
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
                'rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90',
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
          </EnterpriseAuthGate>
        </BrowserRouter>
        </EeAuthProvider>
      </EeModuleProvider>
    </AppProvider>
  );
}
