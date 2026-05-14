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
