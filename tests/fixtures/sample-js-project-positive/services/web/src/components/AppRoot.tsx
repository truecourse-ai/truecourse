// Root layout component — imports exclusively from external npm packages
// (react-router, remix-themes). These are NOT internal workspace packages
// and must not be flagged as cross-service violations.

declare const stylesheet: string;
declare function getPublicEnv(): Record<string, string>;
declare function resolveTheme(): string;

import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from 'react-router';

export function AppRoot() {
  const loaderData = useLoaderData();
  const env = getPublicEnv();
  const theme = resolveTheme();

  if (isRouteErrorResponse(loaderData)) {
    return (
      <html lang="en" data-theme={theme}>
        <head>
          <Meta />
          <Links />
        </head>
        <body>
          <p>An error occurred.</p>
          <Scripts />
        </body>
      </html>
    );
  }

  return (
    <html lang="en" data-theme={theme}>
      <head>
        <Meta />
        <Links />
        <link rel="stylesheet" href={stylesheet} />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}


// --- missing-return-type FP: layout component with JSX Outlet; return type trivially inferred ---
// Framework convention: Remix layout default exports return JSX, no explicit annotation needed.
declare function Outlet(): JSX.Element;
declare function useCurrentWorkspace(): { id: string; slug: string };

export default function WorkspaceLayout() {
  const workspace = useCurrentWorkspace();

  return (
    <div key={workspace.slug} className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
      <Outlet />
    </div>
  );
}

