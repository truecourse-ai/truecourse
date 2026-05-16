
declare namespace RouteC { interface MetaArgs { params: Record<string, string> } }

export function meta(_args: RouteC.MetaArgs) {
  return [
    { title: 'MyApp' },
    { name: 'description', content: 'Streamline your workflow with MyApp.' },
    { property: 'og:title', content: 'MyApp' },
    { property: 'og:description', content: 'The best way to manage your team.' },
  ];
}



// --- no-void shape: fire-and-forget-navigation (void navigate() in event callback) ---
declare function useNavigate(): (to: string | number, opts?: { replace?: boolean }) => Promise<void>;
declare const Button: (props: { onClick: () => void; children?: unknown }) => JSX.Element;

function PlaygroundResetButton(): JSX.Element {
  const navigate = useNavigate();
  return (
    <Button
      onClick={() => {
        void navigate('.', { replace: true });
      }}
    >
      Reset
    </Button>
  );
}



// --- no-void shape: fire-and-forget-navigation (void executeAsyncProcedure() in sync handler) ---
declare function executeAuthAndSignProcedure(opts: { token: string; onSuccess: () => void }): Promise<void>;
declare const Button: (props: { onClick: () => void; children?: unknown }) => JSX.Element;

function SignatureSubmitButton({ token }: { token: string }): JSX.Element {
  function handleClick(): void {
    void executeAuthAndSignProcedure({
      token,
      onSuccess() {
        console.log('signed');
      },
    });
  }
  return <Button onClick={handleClick}>Sign</Button>;
}



// --- no-void shape: fire-and-forget-navigation (void revalidator.revalidate() discards Promise) ---
declare function useRevalidator(): { revalidate: () => Promise<void>; state: string };
declare const Button: (props: { onClick: () => void; children?: unknown }) => JSX.Element;

function LegacyFieldWarningDismiss(): JSX.Element {
  const revalidator = useRevalidator();
  return (
    <Button
      onClick={() => {
        void revalidator.revalidate();
      }}
    >
      Refresh Data
    </Button>
  );
}


// dangerouslySetInnerHTML with hardcoded CSS string and operator-controlled env config — no user input
declare const disableAnimations: boolean;
declare const publicConfig: Record<string, string>;
declare function nonce(n: string): string;
declare const cspNonce: string;

function AppShell() {
  return (
    <html lang="en">
      <head>
        {disableAnimations && (
          <style
            nonce={nonce(cspNonce)}
            dangerouslySetInnerHTML={{
              __html: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
            }}
          />
        )}
        <script
          nonce={nonce(cspNonce)}
          dangerouslySetInnerHTML={{
            __html: `window.__ENV__ = ${JSON.stringify(publicConfig)};`,
          }}
        />
      </head>
      <body />
    </html>
  );
}
