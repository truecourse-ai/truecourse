// Remix route loader — long due to JSX, hooks, and framework error-handling structure

declare function getSession(request: Request): Promise<{ user: { id: string } }>;
declare function getWorkspaceBySlug(args: { userId: string; slug: string }): Promise<{ id: string }>;
declare function getInvoiceById(args: { id: { type: string; id: number }; userId: string; workspaceId: string }): Promise<{ id: string } | null>;
declare function getOrgInvoiceById(args: { id: { type: string; id: number }; userId: string; workspaceId: string }): Promise<{ id: string }>;
declare function parseAppError(err: unknown): { code: string };
declare function redirect(url: string): never;
declare function isRouteErrorResponse(error: unknown): error is { status: number };
declare const Outlet: React.ComponentType;
declare const Link: React.ComponentType<{ to: string; children?: React.ReactNode; className?: string }>;
declare const Button: React.ComponentType<{ asChild?: boolean; className?: string; children?: React.ReactNode }>;
declare const GenericErrorLayout: React.ComponentType<{ errorCode: number; errorCodeMap: Record<number, { subHeading: string; heading: string; message: string }>; primaryButton: React.ReactNode; secondaryButton: React.ReactNode | null }>;
declare const ChevronLeftIcon: React.ComponentType<{ className?: string }>;

interface InvoiceLoaderArgs {
  request: Request;
  params: { id: string; workspaceSlug: string };
}

interface InvoiceErrorBoundaryProps {
  error: unknown;
  params: { workspaceSlug: string };
}

export const shouldRevalidateInvoice = ({
  currentParams,
  nextParams,
}: {
  currentParams: Record<string, string>;
  nextParams: Record<string, string>;
}) => {
  return currentParams.id !== nextParams.id;
};

export async function invoiceLayoutLoader({ request, params }: InvoiceLoaderArgs) {
  const { id } = params;

  const invoiceId = Number(id);

  // If the ID is numeric, resolve it to the canonical envelope ID and redirect.
  if (!Number.isNaN(invoiceId)) {
    const { user } = await getSession(request);

    const workspace = await getWorkspaceBySlug({
      userId: user.id,
      slug: params.workspaceSlug,
    });

    // Attempt the workspace-scoped lookup first, then fall back to org-level.
    const invoice = await getInvoiceById({
      id: { type: 'invoiceId', id: invoiceId },
      userId: user.id,
      workspaceId: workspace.id,
    }).catch((err: unknown) => {
      const error = parseAppError(err);

      if (error.code === 'NOT_FOUND' || error.code === 'UNAUTHORIZED') {
        return null;
      }

      throw err;
    });

    if (invoice) {
      const url = new URL(request.url);

      throw redirect(url.pathname.replace(`/invoices/${id}`, `/invoices/${invoice.id}`));
    }

    const orgInvoice = await getOrgInvoiceById({
      id: { type: 'invoiceId', id: invoiceId },
      userId: user.id,
      workspaceId: workspace.id,
    }).catch((err: unknown) => {
      const error = parseAppError(err);

      if (error.code === 'NOT_FOUND' || error.code === 'UNAUTHORIZED') {
        throw new Response('Not Found', { status: 404 });
      }

      throw err;
    });

    const url = new URL(request.url);

    throw redirect(url.pathname.replace(`/invoices/${id}`, `/invoices/${orgInvoice.id}`));
  }
}

export default function InvoiceLayout() {
  return <Outlet />;
}

export function InvoiceErrorBoundary({ error, params }: InvoiceErrorBoundaryProps) {
  const errorCode = isRouteErrorResponse(error) ? (error as { status: number }).status : 500;

  const errorCodeMap = {
    404: {
      subHeading: '404 Invoice not found',
      heading: 'Oops! Something went wrong.',
      message: 'The invoice you are looking for could not be found.',
    },
  };

  return (
    <GenericErrorLayout
      errorCode={errorCode}
      errorCodeMap={errorCodeMap}
      secondaryButton={null}
      primaryButton={
        <Button asChild className="w-32">
          <Link to={`/w/${params.workspaceSlug}/invoices`}>
            <ChevronLeftIcon className="mr-2 h-4 w-4" />
            Go Back
          </Link>
        </Button>
      }
    />
  );
}
