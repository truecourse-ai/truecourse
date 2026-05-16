// ContractCreatedFromLinkEmailTemplate — react-tsx FP shape (email template with JSX)
declare const SIGNER_ROLE_DESCRIPTIONS_emailTpl: Record<string, { actioned: unknown }>;
declare const useLingui_emailTpl: () => { _: (msg: unknown) => string };
declare const useBranding_emailTpl: () => { brandingEnabled: boolean; brandingLogo: string | null };
declare const msg_emailTpl: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;
declare const RecipientRole_emailTpl: { SIGNER: string; APPROVER: string; VIEWER: string };

type ContractCreatedFromLinkEmailProps = {
  signerName?: string;
  signerRole?: string;
  contractLink?: string;
  contractName?: string;
  assetBaseUrl?: string;
};

export const ContractCreatedFromLinkEmailTemplate = ({
  signerName = 'Jane Smith',
  signerRole = RecipientRole_emailTpl.SIGNER,
  contractLink = 'http://localhost:3000',
  contractName = 'Service Agreement.pdf',
  assetBaseUrl = 'http://localhost:3002',
}: ContractCreatedFromLinkEmailProps) => {
  const { _ } = useLingui_emailTpl();
  const branding = useBranding_emailTpl();

  const action = _(SIGNER_ROLE_DESCRIPTIONS_emailTpl[signerRole]?.actioned ?? msg_emailTpl`signed`);
  const previewText = msg_emailTpl`Contract created from your direct link`;

  const getAssetUrl = (path: string) => new URL(path, assetBaseUrl).toString();

  return (
    <html>
      <head />
      <preview>{_(previewText)}</preview>
      <body className="mx-auto my-auto font-sans">
        <section className="bg-white">
          <div className="mx-auto mt-8 mb-2 max-w-xl rounded-lg border border-slate-200 p-2">
            <div className="p-2">
              {branding.brandingEnabled && branding.brandingLogo ? (
                <img src={branding.brandingLogo} alt="Company Logo" className="mb-4 h-6" />
              ) : (
                <img src={getAssetUrl('/static/logo.png')} alt="App Logo" className="mb-4 h-6" />
              )}

              <img
                src={getAssetUrl('/static/document-completed.png')}
                alt="Contract"
                className="mx-auto mt-6 mb-4 block h-32"
              />

              <section>
                <p className="mb-0 text-center font-semibold text-lg">
                  {signerName} {action.toLowerCase()} a contract via your direct link
                </p>

                <div className="mx-auto my-2 w-fit rounded-lg bg-gray-50 px-4 py-2 text-slate-600 text-sm">
                  {contractName}
                </div>

                <section className="my-6 text-center">
                  <a
                    href={contractLink}
                    className="inline-flex items-center justify-center rounded-lg bg-blue-500 px-6 py-3 font-medium text-white text-sm no-underline"
                  >
                    View Contract
                  </a>
                </section>
              </section>
            </div>
          </div>

          <div className="mx-auto max-w-xl">
            <footer className="mt-6 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
              <p>You received this email because someone used your direct template link.</p>
            </footer>
          </div>
        </section>
      </body>
    </html>
  );
};
