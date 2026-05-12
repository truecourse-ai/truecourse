
// Framework-convention exports whose return types are trivially inferred.
// Remix route default component, reserved meta() export, and HTTP method
// route handlers should not be flagged by missing-boundary-types.

declare const useLingui: () => { t: (s: string) => string };
declare const useSession: () => { user: { name: string } };
declare function appMetaTags(label: string): Array<{ title: string }>;
declare function cors(request: Request, response: Response): Promise<Response>;
declare const JSXRuntime: { jsx: (tag: string, props: unknown) => unknown };

// Mode: remix-default-component-export
// Remix route default export returning JSX — return type inferred as JSX.Element.
export default function DashboardPage() {
  const { t } = useLingui();
  const { user } = useSession();
  return JSXRuntime.jsx('div', { children: t(`Hello ${user.name}`) });
}

// Mode: remix-meta-reserved-export
// Remix reserved route export — framework-defined return type, inferred from helper.
export function meta() {
  return appMetaTags('Personal Inbox');
}

// Mode: nextjs-http-method-route-handler
// Next.js App Router HTTP method export — return type inferred from cors() wrapper.
export function OPTIONS(request: Request) {
  return cors(
    request,
    new Response(null, { status: 204 }),
  );
}
