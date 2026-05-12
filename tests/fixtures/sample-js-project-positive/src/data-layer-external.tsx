/**
 * Layered-architecture patterns that should NOT trigger
 * `architecture/deterministic/data-layer-depends-on-external`.
 *
 * Mode 1 (ui-component-misclassified-as-data-layer): a React hook that
 * lives under `hooks/` and computes DOM coordinates via
 * `getBoundingClientRect`. Even though the file imports a Prisma row
 * type for prop typing, the file is a presentation-layer hook (JSX-aware,
 * `use*` naming, DOM access) and must not be classified as the data
 * layer for the purpose of the data-vs-external boundary check.
 *
 * Mode 2 (filename-pattern-mismatch): a peer file named
 * `server-actions.ts` that holds plain S3 client utilities and has NO
 * `'use server'` directive. The rule must not treat it as a Next.js
 * server-action module just because the filename matches
 * /server-actions\.(ts|js)$/; it is plain infrastructure code, not a
 * framework-layer boundary.
 */

declare const useState: <T>(initial: T) => [T, (next: T) => void];
declare const useEffect: (effect: () => void | (() => void), deps: ReadonlyArray<unknown>) => void;
declare const useRef: <T>(initial: T | null) => { current: T | null };

interface PrismaField {
  readonly id: string;
  readonly page: number;
  readonly recipientId: string;
}

interface PageCoords {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Mode 1: client-only React hook under a `hooks/` folder. Imports a
// Prisma row type purely for prop typing, but the file's real job is to
// read DOM rectangles for PDF field placement — presentation-layer
// behavior, not a data-layer dependency on an external service.
export function useFieldPageCoords(field: PrismaField): PageCoords {
  const [coords, setCoords] = useState<PageCoords>({ x: 0, y: 0, width: 0, height: 0 });
  const containerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }, [field.id, field.page]);
  return coords;
}

interface FieldDragDropProps {
  readonly field: PrismaField;
  readonly onMove: (next: PageCoords) => void;
}

// Mode 1 (component variant): a UI component that calls
// `getBoundingClientRect` to translate pointer events into PDF-page
// coordinates. JSX-bearing files under `components/` are presentation
// layer; the data-vs-external boundary check must skip them.
export function EnvelopeEditorFieldDragDrop({ field, onMove }: FieldDragDropProps): JSX.Element {
  const handlePointerUp = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    onMove({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    });
  };
  return (
    <div
      data-field-id={field.id}
      data-page={field.page}
      onPointerUp={handlePointerUp}
      className="absolute cursor-move"
    >
      Field {field.id}
    </div>
  );
}

declare const s3Client: {
  send(command: { input: { Bucket: string; Key: string } }): Promise<{ ETag?: string }>;
};
declare class DeleteObjectCommand {
  constructor(input: { Bucket: string; Key: string });
  readonly input: { Bucket: string; Key: string };
}
declare const S3_BUCKET: string;

// Mode 2: peer file that the codebase happens to name `server-actions`
// for organizational reasons — there is NO `'use server'` directive, so
// it is plain S3 infrastructure code, not a Next.js server-action
// module. The data-vs-external rule must rely on the directive, not
// pattern-match on the filename.
export async function deleteFileFromS3(key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key });
  await s3Client.send(command);
}

export async function deleteFile(key: string): Promise<void> {
  if (key.length === 0) return;
  await deleteFileFromS3(key);
}
