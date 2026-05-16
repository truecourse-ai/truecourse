
declare function unlinkOAuthProvider(provider: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleUnlinkAccount(provider: string): Promise<void> {
  try {
    await unlinkOAuthProvider(provider);
    showToast({ title: 'Account unlinked', description: 'The linked account has been removed.' });
  } catch (error) {
    console.error(error);
    showToast({
      title: 'Failed to unlink',
      description: 'An error occurred while unlinking the account.',
      variant: 'destructive',
    });
  }
}


// Standard route configuration adapter with callback — no type mismatch
declare function routeAdapter(defineRoutes: (routes: (path: string, file: string) => void) => void): object;
declare function autoDiscoverRoutes(opts: { routeDir: string; ignoredRouteFiles: string[] }): (defineRoutes: (path: string, file: string) => void) => void;

export const routes = routeAdapter((defineRoutes) =>
  autoDiscoverRoutes({
    routeDir: 'app/routes',
    ignoredRouteFiles: ['**/.*', '**/*.css'],
  })(defineRoutes),
);



// Route alias shim: URL segment is 'settings', component is WorkspaceSettingsPage from the org-scoped route.
// Filename reflects the URL path segment, not the component name — intentional framework pattern.
declare const WorkspaceSettingsPage: React.ComponentType;
export { WorkspaceSettingsPage as default };



// FP: configureRouter expects basePath: string but receives number from config
declare function configureRouter(basePath: string, opts: { strict: boolean }): object;
declare const ROUTE_BASE_PATH: number;

export const router = configureRouter(ROUTE_BASE_PATH, { strict: false });



// Route alias shim: routes.ts re-exports WorkspaceSettingsPage as the default export.
// Filename is 'routes' reflecting routing config; component name reflects its domain — intentional pattern.
declare const WorkspaceSettingsPage: React.ComponentType;
export default WorkspaceSettingsPage;

