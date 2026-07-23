import { useEffect } from 'react';
import { Links, Meta, Outlet, Scripts } from 'react-router';
import type { LinksFunction } from 'react-router';
import stylesheet from './globals.css?url';
import { initPostHog } from '@/lib/posthog';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
  { rel: 'icon', href: '/logo.svg' },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap',
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark js">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Meta />
        <Links />
      </head>
      <body className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Blank shell shown for the split second before hydration on non-prerendered paths. */
export function HydrateFallback() {
  return null;
}

export default function App() {
  useEffect(() => {
    initPostHog();
  }, []);
  return <Outlet />;
}
