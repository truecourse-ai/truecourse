
declare const useLingui: () => { _: (msg: unknown) => string };
declare const useBranding: () => { brandingEnabled: boolean; brandingLogo?: string };
declare const TemplateFooter: React.ComponentType<{ isDocument: boolean }>;
declare const TemplatePasswordChanged: React.ComponentType<{ userName: string; userEmail: string; assetBaseUrl: string }>;
declare const msg: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;

declare namespace JSX { interface Element {} }
declare const React: { ComponentType: unknown };

type PasswordChangedTemplateProps = {
  userName?: string;
  userEmail?: string;
  assetBaseUrl?: string;
};

export const PasswordChangedEmailTemplate = ({
  userName = 'Alex Johnson',
  userEmail = 'alex@example.com',
  assetBaseUrl = 'http://localhost:3002',
}: PasswordChangedTemplateProps) => {
  const { _ } = useLingui();
  const branding = useBranding();

  const previewText = msg`Your password was changed`;

  const getAssetUrl = (path: string) => {
    return new URL(path, assetBaseUrl).toString();
  };

  return (
    <html>
      <head />
      <preview>{_(previewText)}</preview>

      <body className="mx-auto my-auto bg-white font-sans">
        <section>
          <container className="mx-auto mt-8 mb-2 max-w-xl rounded-lg border border-slate-200 border-solid p-4">
            <section>
              {branding.brandingEnabled && branding.brandingLogo ? (
                <img src={branding.brandingLogo} alt="Branding Logo" className="mb-4 h-6" />
              ) : (
                <img src={getAssetUrl('/static/logo.png')} alt="App Logo" className="mb-4 h-6" />
              )}

              <TemplatePasswordChanged userName={userName} userEmail={userEmail} assetBaseUrl={assetBaseUrl} />
            </section>
          </container>

          <container className="mx-auto mt-12 max-w-xl">
            <section>
              <p className="my-4 font-semibold text-base">
                Hi, {userName}{' '}
                <a className="font-normal text-slate-400" href={`mailto:${userEmail}`}>
                  ({userEmail})
                </a>
              </p>

              <p className="mt-2 text-base text-slate-400">
                Your account password was recently changed. If you made this change, no action is required.
              </p>

              <p className="mt-2 text-base text-slate-400">
                If you did not change your password, please{' '}
                <a className="font-normal text-blue-700" href="mailto:support@example.com">
                  contact support
                </a>{' '}
                immediately.
              </p>
            </section>
          </container>

          <hr className="mx-auto mt-12 max-w-xl" />

          <container className="mx-auto max-w-xl">
            <TemplateFooter isDocument={false} />
          </container>
        </section>
      </body>
    </html>
  );
};

export default PasswordChangedEmailTemplate;



declare const useLingui9: () => { _: (msg: unknown) => string };
declare const useBranding9: () => { brandingEnabled: boolean; brandingLogo?: string };
declare const TemplateFooter9: React.ComponentType<{ isDocument: boolean }>;
declare const TemplateImage9: React.ComponentType<{ assetBaseUrl: string; className?: string; staticAsset: string }>;
declare const msg9: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const formatWorkspaceUrl9: (url: string, base: string) => string;

type VerifyWorkspaceEmailProps = {
  assetBaseUrl?: string;
  baseUrl?: string;
  workspaceName?: string;
  workspaceUrl?: string;
  token?: string;
};

export const VerifyWorkspaceEmailTemplate = ({
  assetBaseUrl = 'http://localhost:3002',
  baseUrl = 'https://app.example.com',
  workspaceName = 'Acme Corp',
  workspaceUrl = 'acme',
  token = '',
}: VerifyWorkspaceEmailProps) => {
  const { _ } = useLingui9();
  const branding = useBranding9();

  const previewText = msg9`Verify your workspace email for ${workspaceName}`;

  const verifyHref = `${baseUrl}/workspace/email/verify?token=${token}`;

  return (
    <html>
      <head />
      <preview>{_(previewText)}</preview>

      <body className="mx-auto my-auto font-sans">
        <section className="bg-white">
          <container className="mx-auto mt-8 mb-2 max-w-xl rounded-lg border border-slate-200 border-solid px-2 pt-2 backdrop-blur-sm">
            {branding.brandingEnabled && branding.brandingLogo ? (
              <img src={branding.brandingLogo} alt="Branding Logo" className="mb-4 h-6 p-2" />
            ) : (
              <TemplateImage9 assetBaseUrl={assetBaseUrl} className="mb-4 h-6 p-2" staticAsset="logo.png" />
            )}

            <section>
              <TemplateImage9 className="mx-auto" assetBaseUrl={assetBaseUrl} staticAsset="mail-open.png" />
            </section>

            <section className="p-2 text-slate-500">
              <p className="text-center font-medium text-black text-lg">
                Verify your workspace email address
              </p>

              <p className="text-center text-base">
                <strong>{workspaceName}</strong> has requested to use your email address for their workspace.
              </p>

              <div className="mx-auto mt-6 w-fit rounded-lg bg-gray-50 px-4 py-2 font-medium text-base text-slate-600">
                {formatWorkspaceUrl9(workspaceUrl, baseUrl)}
              </div>

              <section className="mt-6">
                <p className="my-0 text-sm">
                  By accepting this request, you will be granting <strong>{workspaceName}</strong> access to:
                </p>

                <ul className="mt-2 mb-0">
                  <li className="text-sm">View all documents sent to and from this email address</li>
                  <li className="mt-1 text-sm">Allow document recipients to reply directly to this email</li>
                  <li className="mt-1 text-sm">Send documents on behalf of the workspace using this address</li>
                </ul>
              </section>

              <section className="mt-6 mb-4 text-center">
                <a
                  href={verifyHref}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-sm text-white no-underline"
                >
                  Verify email address
                </a>
              </section>

              <p className="mt-4 text-center text-sm text-slate-400">
                If you did not expect this request, you can ignore this email.
              </p>
            </section>
          </container>

          <hr className="mx-auto mt-12 max-w-xl" />

          <container className="mx-auto max-w-xl">
            <TemplateFooter9 isDocument={false} />
          </container>
        </section>
      </body>
    </html>
  );
};

export default VerifyWorkspaceEmailTemplate;



declare const getEnvVar44: (name: string) => string | undefined;
declare const TemplateDocumentImage44: React.ComponentType<{ className?: string; assetBaseUrl: string }>;
declare const Button44: React.ComponentType<{ href: string; className?: string; children: React.ReactNode }>;
declare const Column44: React.ComponentType<{ align?: string; children: React.ReactNode }>;
declare const Img44: React.ComponentType<{ src: string; className?: string; alt?: string }>;
declare const Link44: React.ComponentType<{ href: string; target?: string; className?: string; children: React.ReactNode }>;
declare const Section44: React.ComponentType<{ className?: string; children: React.ReactNode }>;
declare const Text44: React.ComponentType<{ className?: string; children: React.ReactNode }>;

type TemplateSelfCompletedProps44 = {
  documentName: string;
  assetBaseUrl: string;
};

export const TemplateSelfCompleted44 = ({ documentName, assetBaseUrl }: TemplateSelfCompletedProps44) => {
  const WEBAPP_URL = getEnvVar44('NEXT_PUBLIC_WEBAPP_URL');
  const signUpUrl = `${WEBAPP_URL ?? 'http://localhost:3000'}/signup`;

  const getAssetUrl = (path: string) => new URL(path, assetBaseUrl).toString();

  return (
    <>
      <TemplateDocumentImage44 className="mt-6" assetBaseUrl={assetBaseUrl} />

      <Section44 className="flex-row items-center justify-center">
        <Section44>
          <Column44 align="center">
            <Text44 className="font-semibold text-[#7AC455] text-base">
              <Img44 src={getAssetUrl('/static/completed.png')} className="-mt-0.5 mr-2 inline h-7 w-7 align-middle" />
              Completed
            </Text44>
          </Column44>
        </Section44>

        <Text44 className="mt-6 mb-0 text-center font-semibold text-lg text-primary">
          You have completed "{documentName}"
        </Text44>

        <Text44 className="mx-auto mt-1 mb-6 max-w-[80%] text-center text-base text-slate-400">
          Create a{' '}
          <Link44
            href={signUpUrl}
            target="_blank"
            className="whitespace-nowrap text-blue-700 hover:text-blue-600"
          >
            free account
          </Link44>{' '}
          to access your completed documents at any time.
        </Text44>

        <Section44 className="mt-8 mb-6 text-center">
          <Button44
            href={signUpUrl}
            className="mr-4 rounded-lg border border-slate-200 border-solid px-4 py-2 text-center font-medium text-black text-sm no-underline"
          >
            <Img44 src={getAssetUrl('/static/user-plus.png')} className="mr-2 mb-0.5 inline h-5 w-5 align-middle" />
            Create account
          </Button44>
        </Section44>
      </Section44>
    </>
  );
};


// Default parameter values for email template preview — real URLs injected by caller
declare const TemplateFooter50: React.ComponentType<{ isDocument: boolean }>;

type EnvelopeInviteTemplateProps = {
  senderName?: string;
  envelopeTitle?: string;
  signEnvelopeUrl?: string;
  reviewEnvelopeUrl?: string;
  assetBaseUrl?: string;
};

export const EnvelopeInviteEmailTemplate = ({
  senderName = 'Your sender',
  envelopeTitle = 'Untitled envelope',
  signEnvelopeUrl = 'https://app.example.com/sign/preview',
  reviewEnvelopeUrl = 'https://app.example.com/review/preview',
  assetBaseUrl = 'http://localhost:3002',
}: EnvelopeInviteTemplateProps) => {
  return (
    <html>
      <head />
      <body className="mx-auto my-auto bg-white font-sans">
        <section>
          <container className="mx-auto mt-8 mb-2 max-w-xl rounded-lg border border-slate-200 p-4">
            <p className="font-medium">{senderName} invited you to sign:</p>
            <p className="text-slate-600">{envelopeTitle}</p>
            <a href={signEnvelopeUrl} className="rounded bg-blue-600 px-4 py-2 text-white">Sign Now</a>
            <a href={reviewEnvelopeUrl} className="ml-4 text-slate-500">Review First</a>
          </container>
          <container className="mx-auto max-w-xl">
            <TemplateFooter50 isDocument={true} />
          </container>
        </section>
      </body>
    </html>
  );
};



// Shape: _(msg`text`) lingui translation with template literal — types correct, no mismatch
declare const useLingui52: () => { _: (msg: unknown) => string };
declare const msg52: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

export function useEnvelopeStatusLabels() {
  const { _ } = useLingui52();
  return {
    sent: _(msg52`Sent`),
    opened: _(msg52`Opened`),
    signed: _(msg52`Signed`),
    rejected: _(msg52`Rejected`),
    voided: _(msg52`Voided`),
  };
}



// documentLink default param — preview-only fallback, real URL always passed by caller
declare const TemplateFooter53: React.ComponentType<{ isDocument: boolean }>;

type EnvelopeAccessExpiredEmailProps = {
  recipientName?: string;
  envelopeTitle?: string;
  envelopeLink?: string;
};

export const EnvelopeAccessExpiredEmailTemplate = ({
  recipientName = 'Recipient',
  envelopeTitle = 'Untitled',
  envelopeLink = 'https://app.example.com/envelopes/preview',
}: EnvelopeAccessExpiredEmailProps) => {
  return (
    <html>
      <head />
      <body className="mx-auto my-auto bg-white font-sans">
        <section>
          <container className="mx-auto mt-8 mb-2 max-w-xl rounded-lg border border-slate-200 p-4">
            <p>Hi <strong>{recipientName}</strong>, your access to "{envelopeTitle}" has expired.</p>
            <a href={envelopeLink} className="rounded bg-blue-600 px-4 py-2 text-white">Request New Access</a>
          </container>
          <container className="mx-auto max-w-xl">
            <TemplateFooter53 isDocument={true} />
          </container>
        </section>
      </body>
    </html>
  );
};



// baseUrl default param is a preview-only fallback — real URL always injected by caller
declare const TemplateFooter55: React.ComponentType<{ isDocument: boolean }>;

type WorkspaceDeletedEmailProps = {
  workspaceName?: string;
  baseUrl?: string;
};

export const WorkspaceDeletedEmailTemplate = ({
  workspaceName = 'Your Workspace',
  baseUrl = 'https://app.example.com',
}: WorkspaceDeletedEmailProps) => {
  return (
    <html>
      <head />
      <body className="mx-auto my-auto bg-white font-sans">
        <section>
          <container className="mx-auto mt-8 mb-2 max-w-xl rounded-lg border border-slate-200 p-4">
            <p>Your workspace <strong>{workspaceName}</strong> has been permanently deleted.</p>
            <a href={`${baseUrl}/dashboard`} className="rounded bg-blue-600 px-4 py-2 text-white">
              Go to Dashboard
            </a>
          </container>
          <container className="mx-auto max-w-xl">
            <TemplateFooter55 isDocument={false} />
          </container>
        </section>
      </body>
    </html>
  );
};




// FP 52f14b2767ee: skia-backend.ts exports Konva (third-party lib name)
// The file patches Konva internals for the server-side skia-canvas backend
// and re-exports the configured library under its own canonical name.
// The export name is the third-party class, not a class defined in this file.
declare const Konva_52f14: { prototype: { renderPage: (n: number) => void }; new (): unknown };
Konva_52f14.prototype.renderPage = function (_pageNumber: number): void {
  /* server-side skia-canvas backend no-op */
};
export { Konva_52f14 as Konva };

