declare function isRouteErrorResponse(error: unknown): error is { status: number; data: any };
declare function EmbedPaywall(): any;
declare function EmbedAuthRequired(): any;
declare const useRouteError: () => unknown;

const EmbedErrorBoundary = () => {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    if (error.status === 401 && error.data.type === 'auth-required') {
      return EmbedAuthRequired();
    }

    if (error.status === 403 && error.data.type === 'paywall') {
      return EmbedPaywall();
    }
  }

  return null;
};


declare const EmbedPaywall: () => JSX.Element;
declare const EmbedWaitingForTurn: () => JSX.Element;
declare const error: { status: number; data: { type: string } };

function renderEmbedError() {
  if (error.status === 403 && error.data.type === 'embed-paywall') {
    return EmbedPaywall();
  }
  if (error.status === 403 && error.data.type === 'embed-waiting-for-turn') {
    return EmbedWaitingForTurn();
  }
  return null;
}



// --- FP shape: Remix ErrorBoundary export (React component) returning JSX; trivially inferred. Framework convention ---
declare function useRouteError3(): unknown;
declare function Outlet(): unknown;

export function EmbedErrorBoundary({ loaderData }: { loaderData?: unknown }) {
  return (
    <div>
      <h1>Embed Error</h1>
      <p>Something went wrong while rendering this embed.</p>
    </div>
  );
}



declare function getEmbedSession(request: Request): Promise<{ teamId: string | null }>;
declare namespace RouteF { interface LoaderArgs { request: Request } }

export async function loader({ request }: RouteF.LoaderArgs) {
  const session = await getEmbedSession(request);
  return { teamId: session.teamId };
}
