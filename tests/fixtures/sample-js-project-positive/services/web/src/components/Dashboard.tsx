export function Dashboard(): JSX.Element {
  return <div><h1>Dashboard</h1></div>;
}



// Shared UI library subpath import — @scope/ui/lib/utils is a public utility,
// not a cross-service internal access.
declare function mergeClasses(...inputs: (string | undefined | null | false)[]): string;
declare const useState: <T>(initial: T) => [T, (v: T) => void];
declare const useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => void;
declare const setInterval: (fn: () => void, ms: number) => number;
declare const clearInterval: (id: number) => void;

export type PulseIndicatorProps = {
  className?: string;
  pulseInterval?: number;
};

export const PulseIndicator = ({ className, pulseInterval = 1800 }: PulseIndicatorProps): JSX.Element => {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setActive((prev: boolean) => !prev);
    }, pulseInterval);
    return () => clearInterval(timer);
  }, [pulseInterval]);

  return (
    <div className={mergeClasses('relative inline-flex h-4 w-4', className)}>
      <span
        className={mergeClasses(
          'absolute inline-flex h-full w-full rounded-full opacity-75',
          active ? 'animate-ping bg-green-400' : 'bg-gray-300',
        )}
      />
      <span
        className={mergeClasses(
          'relative inline-flex h-4 w-4 rounded-full',
          active ? 'bg-green-500' : 'bg-gray-400',
        )}
      />
    </div>
  );
};



// --- cross-service-internal-import / shared-ui-library-subpath FP fixture ---
// Imports from @sample/ui/primitives/dialog are false positives: the package
// is a public shared UI library in the monorepo, not an internal service layer.
declare const Modal: React.ComponentType<{ open: boolean; onClose: () => void; children?: React.ReactNode }>;
declare const ModalContent: React.ComponentType<{ children?: React.ReactNode }>;
declare const ModalHeader: React.ComponentType<{ children?: React.ReactNode }>;
declare const ModalTitle: React.ComponentType<{ children?: React.ReactNode }>;
declare const ModalFooter: React.ComponentType<{ children?: React.ReactNode }>;
declare const Button: React.ComponentType<{ onClick?: () => void; variant?: string; children?: React.ReactNode }>;

export type ProjectArchiveBulkDialogProps = {
  projectIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function ProjectArchiveBulkDialog({
  projectIds,
  open,
  onOpenChange,
  onSuccess,
}: ProjectArchiveBulkDialogProps): JSX.Element {
  const handleConfirm = () => {
    // archive logic would go here
    onSuccess?.();
    onOpenChange(false);
  };

  return (
    <Modal open={open} onClose={() => onOpenChange(false)}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Archive {projectIds.length} project{projectIds.length !== 1 ? 's' : ''}?</ModalTitle>
        </ModalHeader>
        <ModalFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm}>Archive</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}



// Shared UI library subpath import — @scope/ui/components/... is a public
// component exported by the monorepo's shared UI package, not a cross-service
// internal access.
declare const useFormRenderer: () => {
  formStatus: string;
  currentFormItem: { fields: FormField[]; signatures: FormSignature[] };
  fields: FormField[];
  signatures: FormSignature[];
  recipients: FormRecipient[];
  getRecipientColorKey: (id: number) => string;
  setRenderError: (err: string | null) => void;
  overrideSettings: Record<string, unknown>;
};
declare const usePageCanvas: (
  cb: (stage: unknown, layer: unknown) => void,
  pageData: PageCanvasData,
) => { stage: unknown; pageLayer: unknown; canvasContainer: HTMLDivElement | null; unscaledViewport: DOMRect };
declare function createPageCanvas(stage: unknown, layer: unknown): void;
declare const useMemo: <T>(fn: () => T, deps: unknown[]) => T;
declare const useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => void;
declare const RecipientFieldTooltip: (props: {
  field: FormField;
  recipient: FormRecipient;
  children: JSX.Element;
}) => JSX.Element;

type FormField = {
  id: number;
  pageNumber: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  type: string;
  recipient: Pick<FormRecipient, 'id' | 'name' | 'email' | 'signingStatus'>;
};

type FormSignature = {
  fieldId: number;
  value: string;
};

type FormRecipient = {
  id: number;
  name: string;
  email: string;
  signingStatus: 'NOT_SIGNED' | 'SIGNED' | 'REJECTED';
};

type PageCanvasData = {
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
};

export const FormPageRenderer = ({ pageData }: { pageData: PageCanvasData }): JSX.Element => {
  const {
    formStatus,
    currentFormItem,
    fields,
    signatures,
    recipients,
    getRecipientColorKey,
    setRenderError,
    overrideSettings,
  } = useFormRenderer();

  const signaturesByFieldId = useMemo(() => {
    return new Map(signatures.map((sig) => [sig.fieldId, sig]));
  }, [signatures]);

  const { stage, pageLayer, canvasContainer, unscaledViewport } = usePageCanvas(
    ({ stage, pageLayer }: { stage: unknown; pageLayer: unknown }) => {
      createPageCanvas(stage, pageLayer);
    },
    pageData,
  );

  const visibleFields = useMemo(() => {
    return fields.filter((f) => f.pageNumber === pageData.pageNumber);
  }, [fields, pageData.pageNumber]);

  useEffect(() => {
    if (!stage) return;
    visibleFields.forEach((field) => {
      const sig = signaturesByFieldId.get(field.id);
      if (!sig) setRenderError(`missing signature for field ${field.id}`);
    });
  }, [visibleFields, signaturesByFieldId, stage]);

  return (
    <div ref={canvasContainer as unknown as React.RefObject<HTMLDivElement>} className="relative w-full h-full">
      {visibleFields.map((field) => (
        <RecipientFieldTooltip
          key={field.id}
          field={field}
          recipient={field.recipient as FormRecipient}
        >
          <div
            style={{
              position: 'absolute',
              left: field.positionX * unscaledViewport.width,
              top: field.positionY * unscaledViewport.height,
              width: field.width * unscaledViewport.width,
              height: field.height * unscaledViewport.height,
              borderColor: getRecipientColorKey(field.recipient.id),
            }}
            className="border-2 rounded-sm"
          />
        </RecipientFieldTooltip>
      ))}
    </div>
  );
};



// Shared UI library primitives — consuming subpath exports from @acme/ui is the
// intended public API pattern across this monorepo. These are not internal imports.
declare module '@acme/ui/primitives/modal' {
  export const Modal: (props: { open: boolean; onClose: () => void; children: React.ReactNode }) => JSX.Element;
  export const ModalHeader: (props: { children: React.ReactNode }) => JSX.Element;
  export const ModalBody: (props: { children: React.ReactNode }) => JSX.Element;
  export const ModalFooter: (props: { children: React.ReactNode }) => JSX.Element;
}
declare module '@acme/ui/primitives/button' {
  export const Button: (props: { onClick?: () => void; disabled?: boolean; children: React.ReactNode }) => JSX.Element;
}
declare module '@acme/ui/primitives/input' {
  export const Input: (props: { value: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string }) => JSX.Element;
}

import { Modal, ModalHeader, ModalBody, ModalFooter } from '@acme/ui/primitives/modal';
import { Button } from '@acme/ui/primitives/button';
import { Input } from '@acme/ui/primitives/input';

type ConfirmDeleteDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  resourceName: string;
  isDeleting: boolean;
};

export function ConfirmDeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  resourceName,
  isDeleting,
}: ConfirmDeleteDialogProps): JSX.Element {
  return (
    <Modal open={isOpen} onClose={onClose}>
      <ModalHeader>Delete {resourceName}?</ModalHeader>
      <ModalBody>
        <p>This action cannot be undone. All data associated with {resourceName} will be permanently removed.</p>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={isDeleting}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? 'Deleting…' : 'Delete'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}



// UI component importing a DOM utility from constants/ — not a data-layer/API violation.
// getCanvasPageCount reads document.querySelector internally; it is a client-side helper.
declare function getCanvasPageCount(selector: string): number;
declare const CANVAS_PAGE_SELECTOR: string;
declare const useEffect: (fn: () => void, deps?: unknown[]) => void;
declare const useState: <T>(initial: T) => [T, (v: T) => void];

export function DocumentPreviewToolbar(): JSX.Element {
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    const count = getCanvasPageCount(CANVAS_PAGE_SELECTOR);
    setTotalPages(count);
  }, []);

  return (
    <div className="toolbar">
      <span>{totalPages} pages</span>
    </div>
  );
}



// UI component that uses a client-only DOM utility for bounding-box calculations.
// This is legitimate presentation-layer usage — not a data-layer boundary violation.
declare function getElementBounds(el: Element): { top: number; left: number; width: number; height: number };
declare function useCanvasElement(): { ref: React.RefObject<HTMLDivElement>; ready: boolean };

const CANVAS_MIN_HEIGHT = 16;
const CANVAS_MIN_WIDTH = 48;
const CANVAS_DEFAULT_HEIGHT = CANVAS_MIN_HEIGHT * 2.5;
const CANVAS_DEFAULT_WIDTH = CANVAS_MIN_WIDTH * 2.5;

export type AnnotationLayerProps = {
  pageCount: number;
  onPlace: (bounds: { x: number; y: number; w: number; h: number }) => void;
};

export function AnnotationLayer({ pageCount, onPlace }: AnnotationLayerProps): JSX.Element {
  const { ref, ready } = useCanvasElement();

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!ref.current || !ready) return;
    const containerBounds = getElementBounds(ref.current);
    const x = e.clientX - containerBounds.left;
    const y = e.clientY - containerBounds.top;
    onPlace({ x, y, w: CANVAS_DEFAULT_WIDTH, h: CANVAS_DEFAULT_HEIGHT });
  }

  return (
    <div
      ref={ref}
      onClick={handleClick}
      style={{ position: 'relative', width: '100%', minHeight: CANVAS_MIN_HEIGHT }}
    >
      <span>{pageCount} page(s)</span>
    </div>
  );
}



// --- FP fixture: ui-component-misclassified-as-data-layer (shape ad37b7afe1a1) ---
// A React UI component in components/ that uses browser DOM helpers for overlay
// positioning. The rule must not flag this as a data-layer boundary violation.

declare function getBoundingRect(el: HTMLElement): { width: number; height: number };
declare const CANVAS_LAYER_SELECTOR: string;
declare function clsx(...args: unknown[]): string;
declare function cva(base: string, config: object): (opts: object) => string;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;

const overlayVariants = cva('font-medium', {
  variants: {
    intent: {
      default: 'border-2 fill-white',
      highlight: 'border-0 bg-yellow-200 fill-yellow-200 text-yellow-900',
    },
  },
  defaultVariants: {
    intent: 'default',
  },
});

interface CanvasOverlayProps {
  children: React.ReactNode;
  className?: string;
  layer: {
    id: string;
    inserted: boolean;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    page: number;
  };
  intent?: 'default' | 'highlight';
}

export function CanvasOverlayTooltip({ children, intent, className = '', layer }: CanvasOverlayProps): JSX.Element {
  const [coords, setCoords] = useState({ x: 0, y: 0, height: 0, width: 0 });

  const recalculate = useCallback(() => {
    const $canvas = document.querySelector<HTMLElement>(
      `${CANVAS_LAYER_SELECTOR}[data-page-number="${layer.page}"]`,
    );

    if (!$canvas) {
      return;
    }

    const { height, width } = getBoundingRect($canvas);

    const x = (layer.positionX / 100) * width;
    const y = (layer.positionY / 100) * height;
    const h = (layer.height / 100) * height;
    const w = (layer.width / 100) * width;

    setCoords({ x, y, height: h, width: w });
  }, [layer.height, layer.page, layer.positionX, layer.positionY, layer.width]);

  useEffect(() => {
    recalculate();
  }, [recalculate]);

  useEffect(() => {
    const onResize = () => {
      recalculate();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [recalculate]);

  useEffect(() => {
    const $canvas = document.querySelector<HTMLElement>(
      `${CANVAS_LAYER_SELECTOR}[data-page-number="${layer.page}"]`,
    );

    if (!$canvas) {
      return;
    }

    const observer = new ResizeObserver(() => {
      recalculate();
    });

    observer.observe($canvas);

    return () => {
      observer.disconnect();
    };
  }, [recalculate, layer.page]);

  return (
    <div
      id="canvas-overlay"
      className={clsx('pointer-events-none absolute')}
      style={{
        top: `${coords.y}px`,
        left: `${coords.x}px`,
        height: `${coords.height}px`,
        width: `${coords.width}px`,
      }}
    >
      <div className={overlayVariants({ intent, className } as object)}>
        {children}
      </div>
    </div>
  );
}



// FP: JSX value prop receiving array.filter().length — number type, no mismatch
declare const pendingTasks: Array<{ assigneeId: string; completed: boolean }>;
declare const currentUserId: string;
declare const Badge: (props: { value: number; label: string }) => JSX.Element;

function UserBadge() {
  return (
    <Badge
      value={pendingTasks.filter((task) => task.assigneeId === currentUserId).length}
      label="pending"
    />
  );
}



// FP: Array.map() rendering JSX links — standard React rendering
declare const Link: (props: { to: string; key?: unknown; children: unknown }) => JSX.Element;
declare const Card: (props: { children: unknown; className?: string }) => JSX.Element;
declare const workspaces: Array<{ id: string; url: string; name: string }>;

function WorkspaceList() {
  return (
    <div>
      {workspaces.map((workspace) => (
        <Link to={`/w/${workspace.url}`} key={workspace.id}>
          <Card className="border">{workspace.name}</Card>
        </Link>
      ))}
    </div>
  );
}



// FP: nonce() returns string — JSX nonce prop accepts string, no type mismatch
declare function nonce(cspValue: string): string;
declare const cspNonce: string;

function AppHead() {
  return (
    <head>
      <script nonce={nonce(cspNonce)}>{"0"}</script>
      <style nonce={nonce(cspNonce)} dangerouslySetInnerHTML={{ __html: '* { box-sizing: border-box; }' }} />
    </head>
  );
}



// FP: CVA variant function called with typed prop — standard CVA usage
declare function cva(base: string, config: { variants: Record<string, Record<string, string>>; defaultVariants?: Record<string, string> }): (opts?: Record<string, string | undefined>) => string;
declare const cn: (...args: (string | undefined | null | boolean)[]) => string;

const panelVariants = cva('fixed inset-0 z-50 flex', {
  variants: {
    side: { top: 'items-start', bottom: 'items-end', left: 'justify-start', right: 'justify-end' },
  },
  defaultVariants: { side: 'right' },
});

interface PanelPortalProps { side?: 'top' | 'bottom' | 'left' | 'right'; children?: unknown }

function PanelPortal({ side, children }: PanelPortalProps) {
  return <div className={panelVariants({ side })}>{children as any}</div>;
}



// FP: Array.map() over items with index rendering JSX — standard pattern
declare const PageSelector: (props: { number: number; title: string; isSelected: boolean; onClick: () => void }) => JSX.Element;
declare const documents: Array<{ id: string; title: string }>;
declare const currentDocumentId: string | null;
declare function setCurrentDocument(id: string): void;

function DocumentSelector() {
  return (
    <div>
      {documents.map((doc, i) => (
        <PageSelector
          key={doc.id}
          number={i + 1}
          title={doc.title}
          isSelected={currentDocumentId === doc.id}
          onClick={() => setCurrentDocument(doc.id)}
        />
      ))}
    </div>
  );
}



declare function useState<S>(initial: S | (() => S)): [S, (v: S | ((p: S) => S)) => void];
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useSessionUser: () => { id: string; emailVerified: boolean };
declare const useNavigation: () => (path: string) => Promise<void>;
declare const useTrack: () => { capture: (name: string, props: Record<string, unknown>) => void };
declare const useUploadLimits: () => { quota: { documents: number }; remaining: { documents: number }; refresh: () => void; maxItemCount: number };
declare const useMediaDropzone: (opts: {
  accept: Record<string, string[]>;
  multiple: boolean;
  maxFiles: number;
  onDrop: (files: File[]) => void;
  onDropRejected: (rej: MediaFileRejection[]) => void;
  noClick: boolean;
}) => { getRootProps: () => Record<string, unknown>; getInputProps: () => Record<string, unknown>; isDragActive: boolean };
declare const createMediaUpload: (data: FormData) => Promise<{ id: string }>;
declare const formatMediaUploadPath: (slug: string) => string;
declare const buildRejectionMessage: (r: MediaFileRejection[]) => string;
declare const cn: (...parts: (string | undefined)[]) => string;
declare const BILLING_ENABLED: () => boolean;

interface MediaFileRejection { errors: Array<{ code: string }> }

export interface MediaDropZoneProps {
  children: JSX.Element;
  variant: 'document' | 'template';
  className?: string;
}

export const MediaDropZone = ({ children, variant, className }: MediaDropZoneProps) => {
  const { toast } = useToast();
  const user = useSessionUser();
  const navigate = useNavigation();
  const track = useTrack();

  const [isLoading, setIsLoading] = useState(false);

  const { quota, remaining, refresh, maxItemCount } = useUploadLimits();

  const isUploadDisabled = remaining.documents === 0 || !user.emailVerified;

  const onFileDrop = async (files: File[]) => {
    if (isUploadDisabled && BILLING_ENABLED()) {
      await navigate('/settings/billing');
      return;
    }

    try {
      setIsLoading(true);

      const payload = {
        variant,
        title: files[0].name,
        meta: { timezone: 'UTC' },
      };

      const formData = new FormData();
      formData.append('payload', JSON.stringify(payload));

      for (const file of files) {
        formData.append('files', file);
      }

      const { id } = await createMediaUpload(formData);

      refresh();

      toast({
        title: variant === 'document' ? 'Document uploaded' : 'Template uploaded',
        description:
          variant === 'document'
            ? 'Your document has been uploaded successfully.'
            : 'Your template has been uploaded successfully.',
        duration: 5000,
      });

      if (variant === 'document') {
        track.capture('Media: Document Uploaded', {
          userId: user.id,
          documentId: id,
          timestamp: new Date().toISOString(),
        });
      }

      const targetPath = formatMediaUploadPath(variant);

      await navigate(`${targetPath}/${id}/edit`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred during upload.';

      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
        duration: 7500,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onFileDropRejected = (rejections: MediaFileRejection[]) => {
    if (!rejections.length) {
      return;
    }

    const tooMany = rejections.some((rej) => rej.errors.some((e) => e.code === 'too-many-files'));

    if (tooMany) {
      toast({
        title: `You cannot upload more than ${maxItemCount} items per envelope.`,
        duration: 5000,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Upload failed',
      description: buildRejectionMessage(rejections),
      duration: 5000,
      variant: 'destructive',
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useMediaDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    maxFiles: maxItemCount,
    onDrop: (files) => void onFileDrop(files),
    onDropRejected: onFileDropRejected,
    noClick: true,
  });

  return (
    <div {...getRootProps()} className={cn('relative min-h-screen', className)}>
      <input {...getInputProps()} />
      {children}

      {isDragActive && (
        <div className="fixed top-0 left-0 z-[9999] h-full w-full bg-muted/60 backdrop-blur-[4px]">
          <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center">
            <h2 className="font-semibold text-2xl text-foreground">
              {variant === 'document' ? <span>Upload Document</span> : <span>Upload Template</span>}
            </h2>

            <p className="mt-4 text-md text-muted-foreground">
              <span>Drag and drop your PDF file here</span>
            </p>

            {isUploadDisabled && BILLING_ENABLED() && (
              <a
                href="/settings/billing"
                className="mt-4 text-amber-500 text-sm hover:underline dark:text-amber-400"
              >
                <span>Upgrade your plan to upload more documents</span>
              </a>
            )}

            {!isUploadDisabled &&
              remaining.documents > 0 &&
              Number.isFinite(remaining.documents) && (
                <p className="mt-4 text-muted-foreground/80 text-sm">
                  <span>
                    {remaining.documents} of {quota.documents} documents remaining this month.
                  </span>
                </p>
              )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-50 bg-muted/30 backdrop-blur-[2px]">
          <div className="pointer-events-none flex h-1/2 w-full flex-col items-center justify-center">
            <span className="h-12 w-12 animate-spin text-primary">Loading</span>
            <p className="mt-8 font-medium text-foreground">
              <span>Uploading</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

declare const useSession: () => { user: { id: string; name: string }; organisations: Array<{ id: string; url: string; name: string; teams: Array<{ id: string; url: string; name: string }> }> };
declare const useParams: () => Record<string, string | undefined>;
declare const Outlet: () => JSX.Element;
declare const AppSidebar: (props: { currentOrg: { id: string; url: string; name: string } | null; teams: Array<{ id: string; url: string; name: string }> }) => JSX.Element;
declare const SiteBanner: (props: { content: string }) => JSX.Element;
declare const redirect: (url: string) => never;
declare const getOptionalSession: (req: Request) => Promise<{ isAuthenticated: boolean }>;
declare const getSiteSettings: () => Promise<Array<{ id: string; value: string }>>;
declare const SITE_SETTINGS_BANNER_ID: string;

export const shouldRevalidate = () => false;

export async function authenticatedLayoutLoader({ request }: { request: Request }) {
  const [session, allSettings] = await Promise.all([
    getOptionalSession(request),
    getSiteSettings(),
  ]);

  if (!session.isAuthenticated) {
    throw redirect('/signin');
  }

  const banner = allSettings.find((s) => s.id === SITE_SETTINGS_BANNER_ID);

  return { banner };
}

export default function AuthenticatedLayout({
  loaderData,
  params,
}: {
  loaderData: { banner?: { value: string } };
  params: Record<string, string | undefined>;
}) {
  const { banner } = loaderData;
  const { user, organisations } = useSession();

  const teamUrl = params.teamUrl;
  const orgUrl = params.orgUrl;

  const teams = organisations.flatMap((org) => org.teams);

  const extractCurrentOrg = () => {
    if (orgUrl) return organisations.find((org) => org.url === orgUrl) ?? null;
    if (teamUrl) return organisations.find((org) => org.teams.some((t) => t.url === teamUrl)) ?? null;
    return null;
  };

  const currentOrg = extractCurrentOrg();

  return (
    <div className="flex min-h-screen flex-row">
      <AppSidebar currentOrg={currentOrg} teams={teams} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {banner && <SiteBanner content={banner.value} />}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}



// --- missing-return-type FP: route default-export React component returning JSX ---
// TS infers JSX.Element return type; explicit annotation is idiomatic-optional for components.
declare function useLingui(): { t: (s: string) => string };
declare function useCurrentSession(): { user: { id: string; name: string }; workspaces: Array<{ id: string; name: string }> };

export default function WorkspaceDashboardPage() {
  const { t } = useLingui();
  const { user, workspaces } = useCurrentSession();

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t('My Workspaces')}</h1>
      <p className="text-sm text-muted-foreground">{user.name}</p>
      <ul className="space-y-2">
        {workspaces.map((ws) => (
          <li key={ws.id} className="rounded-lg border p-3">
            {ws.name}
          </li>
        ))}
      </ul>
    </div>
  );
}



// --- argument-type-mismatch FP: Number(payload[0].value).toLocaleString — type coercion chain ---
// Number(payload[0].value) converts recharts ValueType to number; .toLocaleString('en-US') formats it.
declare type ValueType = string | number | Array<string | number>;
declare type NameType = string | number;
declare type TooltipPayload = Array<{ name: NameType; value: ValueType }>;

function formatActivityCount(payload: TooltipPayload): string {
  if (!payload || payload.length === 0) return '0';
  return Number(payload[0].value).toLocaleString('en-US');
}

