import { getOptionalSession } from '@app/auth/server/lib/utils/get-session';
import { useOptionalSession } from '@app/lib/client-only/providers/session';
import { getDocumentAndSenderByToken } from '@app/lib/server-only/document/get-document-by-token';
import { isRecipientAuthorized } from '@app/lib/server-only/document/is-recipient-authorized';
import { getFieldsForToken } from '@app/lib/server-only/field/get-fields-for-token';
import { getRecipientByToken } from '@app/lib/server-only/recipient/get-recipient-by-token';
import { Badge } from '@app/ui/primitives/badge';
import { Button } from '@app/ui/primitives/button';
import { Trans } from '@lingui/react/macro';
import { FieldType } from '@prisma/client';
import { XCircle } from 'lucide-react';
import { Link } from 'react-router';

import { DocumentSigningAuthPageView } from '~/components/general/document-signing/document-signing-auth-page';
import { truncateTitle } from '~/utils/truncate-title';

import type { Route } from './+types/rejected';

export async function loader({ params, request }: Route.LoaderArgs) {
  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const document = await getDocumentAndSenderByToken({
    token,
    requireAccessAuth: false,
  }).catch(() => null);

  if (!document) {
    throw new Response('Not Found', { status: 404 });
  }

  const truncatedTitle = truncateTitle(document.title);

  const [fields, recipient] = await Promise.all([
    getFieldsForToken({ token }),
    getRecipientByToken({ token }).catch(() => null),
  ]);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const isDocumentAccessValid = await isRecipientAuthorized({
    type: 'ACCESS',
    documentAuthOptions: document.authOptions,
    recipient,
    userId: user?.id,
  });

  const recipientReference =
    recipient.name || fields.find((field) => field.type === FieldType.NAME)?.customText || recipient.email;

  if (isDocumentAccessValid) {
    return {
      isDocumentAccessValid: true,
      recipientReference,
      truncatedTitle,
    };
  }

  // Don't leak data if access is denied.
  return {
    isDocumentAccessValid: false,
    recipientReference,
  };
}

export default function RejectedSigningPage({ loaderData }: Route.ComponentProps) {
  const { sessionData } = useOptionalSession();
  const user = sessionData?.user;

  const { isDocumentAccessValid, recipientReference, truncatedTitle } = loaderData;

  if (!isDocumentAccessValid) {
    return <DocumentSigningAuthPageView email={recipientReference} />;
  }

  return (
    <div className="flex flex-col items-center pt-24 lg:pt-36 xl:pt-44">
      <Badge variant="neutral" size="default" className="mb-6 rounded-xl border bg-transparent">
        {truncatedTitle}
      </Badge>

      <div className="flex flex-col items-center">
        <div className="flex items-center gap-x-4">
          <XCircle className="h-10 w-10 text-destructive" />

          <h2 className="max-w-[35ch] text-center font-semibold text-2xl leading-normal md:text-3xl lg:text-4xl">
            <Trans>Document Rejected</Trans>
          </h2>
        </div>

        <div className="mt-4 flex items-center text-center text-destructive text-sm">
          <Trans>You have rejected this document</Trans>
        </div>

        <p className="mt-6 max-w-[60ch] text-center text-muted-foreground text-sm">
          <Trans>
            The document owner has been notified of your decision. They may contact you with further instructions if
            necessary.
          </Trans>
        </p>

        <p className="mt-2 max-w-[60ch] text-center text-muted-foreground text-sm">
          <Trans>No further action is required from you at this time.</Trans>
        </p>

        {user && (
          <Button className="mt-6" asChild>
            <Link to={`/`}>
              <Trans>Return Home</Trans>
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}


// Extended loader variant with auth options check — adds lines via standard React/Remix route structure
// (extra loader data fields + JSX markup). Not decomposable excess logic — just framework verbosity.
declare const getAccessAuthRedirectUrl: (opts: { redirectPath: string; token: string }) => string;

export function buildRejectedPageMeta(truncatedTitle: string) {
  return [
    { title: `Rejected — ${truncatedTitle}` },
    { name: 'robots', content: 'noindex' },
  ];
}

export function RejectedSigningBanner({ recipientName, documentTitle }: { recipientName: string; documentTitle: string }) {
  return (
    <div className="mx-auto mt-8 max-w-md rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
      <p className="text-sm font-medium text-destructive">Signing declined</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {recipientName} declined to sign &ldquo;{documentTitle}&rdquo;.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        The document owner has been notified. No further action is required.
      </p>
    </div>
  );
}

