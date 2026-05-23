/**
 * Positive fixture for code-quality/deterministic/missing-boundary-types.
 *
 * Framework route conventions (HTTP-method handlers, React Router /
 * Remix route module exports, Next.js App Router exports) and React
 * component default exports rarely carry explicit return types in real
 * codebases — the framework defines the contract, and TS infers
 * `JSX.Element` for components. Flagging these as "boundary types
 * missing" produced a steady stream of FPs on Remix / Next.js routes.
 *
 * `missing-return-type` is the sibling rule with the same matching shape
 * (named `function_declaration`s without a return-type annotation), so
 * the framework-convention skip lands in both visitors.
 */

// React Router / Remix route module conventions: `loader`, `action`,
// `meta`, `links`, `headers`, `clientLoader`, `clientAction`,
// `shouldRevalidate`, `HydrateFallback`, `ErrorBoundary`.
export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return { path: url.pathname };
}

export function action({ request }: { request: Request }) {
  return { ok: request.method === 'POST' };
}

export function meta() {
  return [{ title: 'Settings' }];
}

export function links() {
  return [{ rel: 'stylesheet', href: '/styles.css' }];
}

// Next.js App Router route handlers (HTTP methods).
export function GET(request: Request) {
  const url = new URL(request.url);
  return new Response(JSON.stringify({ path: url.pathname }));
}

export function OPTIONS(_request: Request) {
  return new Response(null, { status: 204 });
}

// Next.js metadata / static params helpers.
export function generateMetadata({ params }: { params: { slug: string } }) {
  return { title: params.slug };
}

export function generateStaticParams() {
  return [{ slug: 'home' }, { slug: 'about' }];
}

// Default-exported React component — TS infers `JSX.Element`; codebases
// almost never annotate this.
export default function SettingsPage() {
  return (
    <div className="settings">
      <h1>Settings</h1>
    </div>
  );
}
