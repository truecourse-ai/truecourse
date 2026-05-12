/**
 * Positive fixture: framework-mandated and trivially-inferred return types
 * that should NOT be flagged by code-quality/deterministic/missing-return-type.
 *
 * - Remix/Next.js framework-convention exports (loader, action, meta, OPTIONS).
 * - React components and custom hooks returning JSX or inferred objects.
 * - Internal/private helpers whose void/number/boolean return is obvious.
 * - Callback method shorthands whose type is constrained by the outer API.
 * - Setter accessors (TypeScript forbids explicit return types on setters).
 */

declare const appMetaTags: (title: string) => Array<{ title: string }>;
declare const cors: (req: unknown) => Response;
declare const renderToPipeableStream: (
  node: JSX.Element,
  options: {
    onShellReady?: () => void;
    onShellError?: (err: unknown) => void;
    onAllReady?: () => void;
    onError?: (err: unknown) => void;
  },
) => { pipe: (stream: unknown) => void };
declare const useMutation: <TInput, TOutput>(config: {
  mutationFn: (input: TInput) => Promise<TOutput>;
  onSuccess?: (data: TOutput) => void;
  onError?: (err: unknown) => void;
}) => { mutate: (input: TInput) => void };

// --- Mode: framework-mandated-export -----------------------------------------

export function meta() {
  return appMetaTags('Inbox');
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return { path: url.pathname, ts: Date.now() };
}

export async function action({ request }: { request: Request }) {
  const body = await request.text();
  return { received: body.length };
}

export async function OPTIONS(request: Request) {
  return cors(request);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return new Response(JSON.stringify({ path: url.pathname }), {
    headers: { 'content-type': 'application/json' },
  });
}

// --- Mode: react-component-or-hook-returns-jsx -------------------------------

export default function DashboardPage() {
  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      <p>Welcome back.</p>
    </div>
  );
}

export function AppCommandMenu() {
  const items = ['Search', 'Settings', 'Profile'];
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function useFormattedTitle(raw: string) {
  const trimmed = raw.trim();
  return { title: trimmed, isEmpty: trimmed.length === 0 };
}

// --- Mode: internal-private-trivially-inferred -------------------------------

class QueueWorker {
  private async _drain() {
    await Promise.resolve();
  }

  private computeBackoff(attempt: number) {
    return Math.min(1000 * 2 ** attempt, 30_000);
  }

  public async run(attempt: number): Promise<void> {
    await this._drain();
    void this.computeBackoff(attempt);
  }
}

function getWorkerCount() {
  return 4;
}

function logSessionEvent(name: string) {
  void name;
}

const _worker = new QueueWorker();
void _worker;
void getWorkerCount();
void logSessionEvent;

// --- Mode: callback-constrained-by-outer-api ---------------------------------

export function renderShell(node: JSX.Element) {
  const stream = renderToPipeableStream(node, {
    onShellReady() {
      void 'ready';
    },
    onShellError(err) {
      void err;
    },
    onAllReady() {
      void 'all';
    },
  });
  return stream;
}

export function useDeleteToken(tokenId: string) {
  return useMutation<{ id: string }, { ok: boolean }>({
    async mutationFn(input) {
      await Promise.resolve();
      return { ok: input.id === tokenId };
    },
    onSuccess(data) {
      void data.ok;
    },
    onError(err) {
      void err;
    },
  });
}

// --- Mode: setter-accessor-rule-misfire --------------------------------------

export class ResponseLike {
  private _statusCode = 200;
  private _headers: Record<string, string> = {};

  get statusCode() {
    return this._statusCode;
  }

  set statusCode(code: number) {
    this._statusCode = code;
  }

  set header(entry: readonly [string, string]) {
    this._headers[entry[0]] = entry[1];
  }
}
