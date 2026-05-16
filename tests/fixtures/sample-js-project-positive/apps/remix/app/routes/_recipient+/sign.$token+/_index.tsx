import signingCelebration from '@app/assets/images/signing-celebration.png';
import { getOptionalSession } from '@app/auth/server/lib/utils/get-session';
import { EnvelopeRenderProvider } from '@app/lib/client-only/providers/envelope-render-provider';
import { useOptionalSession } from '@app/lib/client-only/providers/session';
import { AppError, AppErrorCode } from '@app/lib/errors/app-error';
import { getDocumentAndSenderByToken } from '@app/lib/server-only/document/get-document-by-token';
import { viewedDocument } from '@app/lib/server-only/document/viewed-document';
import { getEnvelopeForRecipientSigning } from '@app/lib/server-only/envelope/get-envelope-for-recipient-signing';
import { getEnvelopeRequiredAccessData } from '@app/lib/server-only/envelope/get-envelope-required-access-data';
import { getCompletedFieldsForToken } from '@app/lib/server-only/field/get-completed-fields-for-token';
import { getFieldsForToken } from '@app/lib/server-only/field/get-fields-for-token';
import { getIsRecipientsTurnToSign } from '@app/lib/server-only/recipient/get-is-recipient-turn';
import { getNextPendingRecipient } from '@app/lib/server-only/recipient/get-next-pending-recipient';
import { getRecipientByToken } from '@app/lib/server-only/recipient/get-recipient-by-token';
import { getRecipientSignatures } from '@app/lib/server-only/recipient/get-recipient-signatures';
import { getRecipientsForAssistant } from '@app/lib/server-only/recipient/get-recipients-for-assistant';
import { getTeamSettings } from '@app/lib/server-only/team/get-team-settings';
import { getUserByEmail } from '@app/lib/server-only/user/get-user-by-email';
import { DocumentAccessAuth } from '@app/lib/types/document-auth';
import { extractDocumentAuthMethods } from '@app/lib/utils/document-auth';
import { isRecipientExpired } from '@app/lib/utils/recipients';
import { prisma } from '@app/prisma';
import { SigningCard3D } from '@app/ui/components/signing-card';
import { Trans } from '@lingui/react/macro';
import { DocumentSigningOrder, DocumentStatus, RecipientRole, SigningStatus } from '@prisma/client';
import { Clock8 } from 'lucide-react';
import { Link, redirect } from 'react-router';
import { getOptionalLoaderContext } from 'server/utils/get-loader-session';
import { match } from 'ts-pattern';

import { Header as AuthenticatedHeader } from '~/components/general/app-header';
import { DocumentSigningAuthPageView } from '~/components/general/document-signing/document-signing-auth-page';
import { DocumentSigningAuthProvider } from '~/components/general/document-signing/document-signing-auth-provider';
import { DocumentSigningPageViewV1 } from '~/components/general/document-signing/document-signing-page-view-v1';
import { DocumentSigningPageViewV2 } from '~/components/general/document-signing/document-signing-page-view-v2';
import { DocumentSigningProvider } from '~/components/general/document-signing/document-signing-provider';
import { EnvelopeSigningProvider } from '~/components/general/document-signing/envelope-signing-provider';
import { superLoaderJson, useSuperLoaderData } from '~/utils/super-json-loader';

import type { Route } from './+types/_index';

const handleV1Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [document, recipient, fields, completedFields] = await Promise.all([
    getDocumentAndSenderByToken({
      token,
      userId: user?.id,
      requireAccessAuth: false,
    }).catch(() => null),
    getRecipientByToken({ token }).catch(() => null),
    getFieldsForToken({ token }),
    getCompletedFieldsForToken({ token }),
  ]);

  if (!document || !document.documentData || !recipient || document.status === DocumentStatus.DRAFT) {
    throw new Response('Not Found', { status: 404 });
  }

  const recipientWithFields = { ...recipient, fields };

  const isRecipientsTurn = await getIsRecipientsTurnToSign({ token });

  if (!isRecipientsTurn) {
    throw redirect(`/sign/${token}/waiting`);
  }

  const allRecipients =
    recipient.role === RecipientRole.ASSISTANT
      ? await getRecipientsForAssistant({
          token,
        })
      : [recipient];

  if (
    document.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL &&
    recipient.role !== RecipientRole.ASSISTANT
  ) {
    const nextPendingRecipient = await getNextPendingRecipient({
      documentId: document.id,
      currentRecipientId: recipient.id,
    });

    if (nextPendingRecipient) {
      allRecipients.push({
        ...nextPendingRecipient,
        fields: [],
      });
    }
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: document.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isAccessAuthValid = derivedRecipientAccessAuth.every((accesssAuth) =>
    match(accesssAuth)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => true) // Allow without account requirement
      .exhaustive(),
  );

  let recipientHasAccount: boolean | null = null;

  if (!isAccessAuthValid) {
    recipientHasAccount = await getUserByEmail({ email: recipient.email })
      .then((user) => !!user)
      .catch(() => false);

    return {
      isDocumentAccessValid: false,
      recipientEmail: recipient.email,
      recipientHasAccount,
    } as const;
  }

  await viewedDocument({
    token,
    requestMetadata,
    recipientAccessAuth: derivedRecipientAccessAuth,
  }).catch(() => null);

  const { documentMeta } = document;

  if (recipient.signingStatus === SigningStatus.REJECTED) {
    throw redirect(`/sign/${token}/rejected`);
  }

  if (isRecipientExpired(recipient)) {
    throw redirect(`/sign/${token}/expired`);
  }

  if (document.status === DocumentStatus.COMPLETED || recipient.signingStatus === SigningStatus.SIGNED) {
    throw redirect(documentMeta?.redirectUrl || `/sign/${token}/complete`);
  }

  const [recipientSignatures, settings] = await Promise.all([
    getRecipientSignatures({ recipientId: recipient.id }),
    getTeamSettings({ teamId: document.teamId }),
  ]);

  const [recipientSignature] = recipientSignatures;

  return {
    isDocumentAccessValid: true,
    document,
    fields,
    recipient,
    recipientWithFields,
    allRecipients,
    completedFields,
    recipientSignature,
    isRecipientsTurn,
    includeSenderDetails: settings.includeSenderDetails,
  } as const;
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { token } = params;

  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const envelopeForSigning = await getEnvelopeForRecipientSigning({
    token,
    userId: user?.id,
  })
    .then((envelopeForSigning) => {
      return {
        isDocumentAccessValid: true,
        ...envelopeForSigning,
      } as const;
    })
    .catch(async (e) => {
      const error = AppError.parseError(e);

      if (error.code === AppErrorCode.UNAUTHORIZED) {
        const requiredAccessData = await getEnvelopeRequiredAccessData({ token });

        return {
          isDocumentAccessValid: false,
          ...requiredAccessData,
        } as const;
      }

      throw new Response('Not Found', { status: 404 });
    });

  if (!envelopeForSigning.isDocumentAccessValid) {
    return envelopeForSigning;
  }

  const { envelope, recipient, isCompleted, isRejected, isExpired, isRecipientsTurn } = envelopeForSigning;

  if (!isRecipientsTurn) {
    throw redirect(`/sign/${token}/waiting`);
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isAccessAuthValid = derivedRecipientAccessAuth.every((accesssAuth) =>
    match(accesssAuth)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => true) // Allow without account requirement
      .exhaustive(),
  );

  let recipientHasAccount: boolean | null = null;

  if (!isAccessAuthValid) {
    recipientHasAccount = await getUserByEmail({ email: recipient.email })
      .then((user) => !!user)
      .catch(() => false);

    return {
      isDocumentAccessValid: false,
      recipientEmail: recipient.email,
      recipientHasAccount,
    } as const;
  }

  if (isRejected) {
    throw redirect(`/sign/${token}/rejected`);
  }

  if (isCompleted) {
    throw redirect(envelope.documentMeta.redirectUrl || `/sign/${token}/complete`);
  }

  if (isExpired) {
    throw redirect(`/sign/${token}/expired`);
  }

  await viewedDocument({
    token,
    requestMetadata,
    recipientAccessAuth: derivedRecipientAccessAuth,
  }).catch(() => null);

  return {
    isDocumentAccessValid: true,
    envelopeForSigning,
  } as const;
};

export async function loader(loaderArgs: Route.LoaderArgs) {
  const { token } = loaderArgs.params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  // Not efficient but works for now until we remove v1.
  const foundRecipient = await prisma.recipient.findFirst({
    where: {
      token,
    },
    select: {
      envelope: {
        select: {
          internalVersion: true,
        },
      },
    },
  });

  if (!foundRecipient) {
    throw new Response('Not Found', { status: 404 });
  }

  if (foundRecipient.envelope.internalVersion === 2) {
    const payloadV2 = await handleV2Loader(loaderArgs);

    return superLoaderJson({
      version: 2,
      payload: payloadV2,
    } as const);
  }

  const payloadV1 = await handleV1Loader(loaderArgs);

  return superLoaderJson({
    version: 1,
    payload: payloadV1,
  } as const);
}

export default function SigningPage() {
  const data = useSuperLoaderData<typeof loader>();

  if (data.version === 2) {
    return <SigningPageV2 data={data.payload} />;
  }

  return <SigningPageV1 data={data.payload} />;
}

const SigningPageV1 = ({ data }: { data: Awaited<ReturnType<typeof handleV1Loader>> }) => {
  const { sessionData } = useOptionalSession();

  const user = sessionData?.user;

  if (!data.isDocumentAccessValid) {
    return <DocumentSigningAuthPageView email={data.recipientEmail} emailHasAccount={!!data.recipientHasAccount} />;
  }

  const {
    document,
    fields,
    recipient,
    completedFields,
    recipientSignature,
    isRecipientsTurn,
    allRecipients,
    includeSenderDetails,
    recipientWithFields,
  } = data;

  if (document.deletedAt || document.status === DocumentStatus.REJECTED) {
    return (
      <div className="-mx-4 flex max-w-[100vw] flex-col items-center overflow-x-hidden px-4 pt-16 md:-mx-8 md:px-8 lg:pt-16 xl:pt-24">
        <SigningCard3D
          name={recipient.name}
          signature={recipientSignature}
          signingCelebrationImage={signingCelebration}
        />

        <div className="relative mt-2 flex w-full flex-col items-center">
          <div className="mt-8 flex items-center text-center text-red-600">
            <Clock8 className="mr-2 h-5 w-5" />
            <span className="text-sm">
              <Trans>Document Cancelled</Trans>
            </span>
          </div>

          <h2 className="mt-6 max-w-[35ch] text-center font-semibold text-2xl leading-normal md:text-3xl lg:text-4xl">
            <Trans>
              <span className="mt-1.5 block">"{document.title}"</span>
              is no longer available to sign
            </Trans>
          </h2>

          <p className="mt-2.5 max-w-[60ch] text-center font-medium text-muted-foreground/60 text-sm md:text-base">
            <Trans>This document has been cancelled by the owner.</Trans>
          </p>

          {user ? (
            <Link to="/" className="mt-36 text-app-700 hover:text-app-600">
              <Trans>Go Back Home</Trans>
            </Link>
          ) : (
            <p className="mt-36 text-muted-foreground/60 text-sm">
              <Trans>
                Want to send slick signing links like this one?{' '}
                <Link to="https://app.example.com" className="text-app-700 hover:text-app-600">
                  Check out App
                </Link>
                .
              </Trans>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <DocumentSigningProvider
      email={recipient.email}
      fullName={user?.email === recipient.email ? user?.name : recipient.name}
      signature={user?.email === recipient.email ? user?.signature : undefined}
      typedSignatureEnabled={document.documentMeta?.typedSignatureEnabled}
      uploadSignatureEnabled={document.documentMeta?.uploadSignatureEnabled}
      drawSignatureEnabled={document.documentMeta?.drawSignatureEnabled}
    >
      <DocumentSigningAuthProvider documentAuthOptions={document.authOptions} recipient={recipient} user={user}>
        {sessionData?.user && <AuthenticatedHeader />}

        <div className="mt-8 mb-8 px-4 md:mt-12 md:mb-12 md:px-8">
          <DocumentSigningPageViewV1
            recipient={recipientWithFields}
            document={document}
            fields={fields}
            completedFields={completedFields}
            isRecipientsTurn={isRecipientsTurn}
            allRecipients={allRecipients}
            includeSenderDetails={includeSenderDetails}
          />
        </div>
      </DocumentSigningAuthProvider>
    </DocumentSigningProvider>
  );
};

const SigningPageV2 = ({ data }: { data: Awaited<ReturnType<typeof handleV2Loader>> }) => {
  const { sessionData } = useOptionalSession();
  const user = sessionData?.user;

  if (!data.isDocumentAccessValid) {
    return <DocumentSigningAuthPageView email={data.recipientEmail} emailHasAccount={!!data.recipientHasAccount} />;
  }

  const { envelope, recipientSignature, recipient } = data.envelopeForSigning;

  if (envelope.deletedAt || envelope.status === DocumentStatus.REJECTED) {
    return (
      <div className="-mx-4 flex max-w-[100vw] flex-col items-center overflow-x-hidden px-4 pt-16 md:-mx-8 md:px-8 lg:pt-16 xl:pt-24">
        <SigningCard3D
          name={recipient.name}
          signature={recipientSignature || undefined}
          signingCelebrationImage={signingCelebration}
        />

        <div className="relative mt-2 flex w-full flex-col items-center">
          <div className="mt-8 flex items-center text-center text-red-600">
            <Clock8 className="mr-2 h-5 w-5" />
            <span className="text-sm">
              <Trans>Document Cancelled</Trans>
            </span>
          </div>

          <h2 className="mt-6 max-w-[35ch] text-center font-semibold text-2xl leading-normal md:text-3xl lg:text-4xl">
            <Trans>
              <span className="mt-1.5 block">"{envelope.title}"</span>
              is no longer available to sign
            </Trans>
          </h2>

          <p className="mt-2.5 max-w-[60ch] text-center font-medium text-muted-foreground/60 text-sm md:text-base">
            <Trans>This document has been cancelled by the owner.</Trans>
          </p>

          {user ? (
            <Link to="/" className="mt-36 text-app-700 hover:text-app-600">
              <Trans>Go Back Home</Trans>
            </Link>
          ) : (
            <p className="mt-36 text-muted-foreground/60 text-sm">
              <Trans>
                Want to send slick signing links like this one?{' '}
                <Link to="https://app.example.com" className="text-app-700 hover:text-app-600">
                  Check out App
                </Link>
                .
              </Trans>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <EnvelopeSigningProvider
      envelopeData={data.envelopeForSigning}
      email={recipient.email}
      fullName={user?.email === recipient.email ? user?.name : recipient.name}
      signature={user?.email === recipient.email ? user?.signature : undefined}
    >
      <DocumentSigningAuthProvider documentAuthOptions={envelope.authOptions} recipient={recipient} user={user}>
        <EnvelopeRenderProvider
          version="current"
          envelope={envelope}
          envelopeItems={envelope.envelopeItems}
          token={recipient.token}
        >
          <DocumentSigningPageViewV2 />
        </EnvelopeRenderProvider>
      </DocumentSigningAuthProvider>
    </EnvelopeSigningProvider>
  );
};

declare const useLoaderData: () => { recipient: { name: string; email: string }; document: { title: string; status: string }; fields: Array<{ id: string; type: string; page: number; required: boolean }> };
declare const useNavigate: () => (path: string) => void;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string; variant?: string }) => JSX.Element;
declare const FieldRenderer: (props: { field: { id: string; type: string; page: number; required: boolean }; value: string; onChange: (v: string) => void }) => JSX.Element;
declare const DocumentPageViewer: (props: { pageNumber: number; fields: Array<{ id: string; type: string; page: number; required: boolean }> }) => JSX.Element;
declare const submitSignedFields: (token: string, fieldValues: Record<string, string>) => Promise<void>;
declare const useParams: () => { token?: string };

export default function RecipientSigningPage() {
  const { recipient, document, fields } = useLoaderData();
  const { token } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = React.useState(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const totalPages = Math.max(...fields.map((f) => f.page), 1);
  const requiredFields = fields.filter((f) => f.required);
  const allRequiredFilled = requiredFields.every((f) => fieldValues[f.id]);

  const handleFieldChange = (fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async () => {
    if (!allRequiredFilled) {
      toast({ title: 'Complete all required fields', variant: 'destructive' });
      return;
    }
    if (!token) return;
    setIsSubmitting(true);
    try {
      await submitSignedFields(token, fieldValues);
      navigate('/sign/complete');
    } catch {
      toast({
        title: 'Submission failed',
        description: 'Could not submit your signatures. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (document.status === 'completed') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Document already completed</h1>
          <p className="mt-2 text-muted-foreground">This document has already been signed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">{document.title}</h1>
        <p className="text-sm text-muted-foreground">
          Signing as {recipient.name} ({recipient.email})
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-6 lg:flex-row">
        <div className="flex-1">
          <DocumentPageViewer pageNumber={currentPage} fields={fields} />
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
        <div className="flex w-full flex-col gap-4 lg:w-72">
          <h2 className="text-sm font-medium">Fields to complete</h2>
          {fields
            .filter((f) => f.page === currentPage)
            .map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={fieldValues[field.id] ?? ''}
                onChange={(v) => handleFieldChange(field.id, v)}
              />
            ))}
          <Button
            className="mt-auto w-full"
            onClick={handleSubmit}
            disabled={isSubmitting || !allRequiredFilled}
          >
            {isSubmitting ? 'Submitting...' : 'Submit signature'}
          </Button>
        </div>
      </div>
    </div>
  );
}

