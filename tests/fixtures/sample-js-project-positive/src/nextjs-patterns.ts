/**
 * Next.js patterns that should NOT trigger any rules.
 *
 * Route handlers with unused positional request parameter.
 * Page and layout function signatures.
 * Dynamic route params.
 */

interface NextRequest {
  url: string;
  method: string;
}

interface RouteContext {
  params: { id: string };
}

interface PageProps {
  readonly params: { slug: string };
  readonly searchParams: Record<string, string | undefined>;
}

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<Response> {
  const data = await fetchData(params.id);
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: NextRequest, { params }: RouteContext): Promise<Response> {
  const body = await parseBody(request);
  const result = await saveData(params.id, body);
  return new Response(JSON.stringify(result), { status: 201 });
}

export function Page({ params, searchParams }: PageProps): string {
  const page = parseInt(searchParams.page ?? '1', 10);
  return `Page: ${params.slug}, page ${page}`;
}

export function renderLayout(children: string): string {
  return `<main>${children}</main>`;
}

async function fetchData(id: string): Promise<{ id: string; name: string }> {
  await Promise.resolve();
  return { id, name: `Item ${id}` };
}

async function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  await Promise.resolve();
  return { url: request.url };
}

async function saveData(id: string, data: Record<string, unknown>): Promise<{ id: string; saved: boolean }> {
  await Promise.resolve();
  return { id, saved: Object.keys(data).length > 0 };
}



/**
 * Universal module pattern: deferred SSR-only import.
 *
 * `SkiaImage` is a module-level `let` that is intentionally assigned
 * asynchronously after a dynamic import of a Node-only canvas library,
 * gated on the absence of `window`. It is not accidental mutable global
 * state — it is the standard isomorphic-module idiom.
 */
declare const window: { document: unknown } | undefined;

let SkiaImage: unknown;

if (typeof window === 'undefined') {
  void (async (): Promise<void> => {
    const mod = await import('node:fs');
    SkiaImage = mod;
  })();
}

export async function renderSignatureField(payload: string): Promise<string> {
  if (SkiaImage === undefined) {
    return payload;
  }
  return `${payload}:rendered`;
}

/**
 * shadcn/ui `use-toast` singleton pattern.
 *
 * `memoryState` and `listeners` are module-level state stores that back
 * a notification hook. They are deliberate singletons, not accidental
 * mutable globals — the entire shadcn toast implementation depends on
 * this shape.
 */
interface ToastState {
  readonly toasts: ReadonlyArray<{ id: string; title: string }>;
}

type ToastListener = (state: ToastState) => void;

let memoryState: ToastState = { toasts: [] };
const listeners: ToastListener[] = [];

function dispatchToast(next: ToastState): void {
  memoryState = next;
  for (const listener of listeners) {
    listener(memoryState);
  }
}

export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.push(listener);
  return (): void => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
}

export function pushToast(title: string): void {
  dispatchToast({ toasts: [...memoryState.toasts, { id: `${Date.now()}`, title }] });
}


// Monorepo-alias cross-package import (FP): exported seed helpers consumed from
// sibling packages via workspace package alias (e.g. `@documenso/prisma/seed/...`).
// The analyzer only follows relative imports, so it cannot see the cross-package
// usage and incorrectly flags these as unused exports.
interface SeedTeamDocumentOptions {
  readonly teamId: number;
  readonly title: string;
}

interface SeedTeamDocumentResult {
  readonly id: string;
  readonly teamId: number;
}

declare const prismaClient: {
  document: { create(args: { data: SeedTeamDocumentOptions }): Promise<SeedTeamDocumentResult> };
  template: { create(args: { data: SeedTeamDocumentOptions }): Promise<SeedTeamDocumentResult> };
  team: { delete(args: { where: { id: number } }): Promise<{ id: number }> };
};

export async function seedTeamDocumentWithMeta(
  options: SeedTeamDocumentOptions,
): Promise<SeedTeamDocumentResult> {
  return prismaClient.document.create({ data: options });
}

export async function seedTeamTemplateWithMeta(
  options: SeedTeamDocumentOptions,
): Promise<SeedTeamDocumentResult> {
  return prismaClient.template.create({ data: options });
}

export async function unseedTeam(teamId: number): Promise<{ id: number }> {
  return prismaClient.team.delete({ where: { id: teamId } });
}

// Framework-convention default export (FP): Remix/Next.js route files export a
// default page component that the framework consumes by convention - there is
// never an explicit import statement, so the analyzer flags it as unused.
interface TokensPageProps {
  readonly params: { teamUrl: string };
}

declare const renderTokensView: (teamUrl: string) => string;

export default function ApiTokensPage({ params }: TokensPageProps): string {
  return renderTokensView(params.teamUrl);
}

// Non-exported symbol misclassified as export (FP): these classes have NO
// `export` keyword - they are file-private and used locally below. The rule
// incorrectly treats top-level class declarations as exports regardless of
// the export modifier and reports them as unused.
class BackgroundTaskFailedError extends Error {
  public constructor(message: string, public readonly jobId: string) {
    super(message);
    this.name = 'BackgroundTaskFailedError';
  }
}

class BackgroundTaskExceededRetriesError extends Error {
  public constructor(message: string, public readonly attempts: number) {
    super(message);
    this.name = 'BackgroundTaskExceededRetriesError';
  }
}

declare const runJob: (jobId: string) => Promise<void>;

export async function executeBackgroundTask(jobId: string, maxAttempts: number): Promise<void> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      await runJob(jobId);
      return;
    } catch (err) {
      attempts += 1;
      if (attempts >= maxAttempts) {
        throw new BackgroundTaskExceededRetriesError(
          `Job ${jobId} exceeded ${maxAttempts} attempts`,
          attempts,
        );
      }
    }
  }
  throw new BackgroundTaskFailedError(`Job ${jobId} failed`, jobId);
}
