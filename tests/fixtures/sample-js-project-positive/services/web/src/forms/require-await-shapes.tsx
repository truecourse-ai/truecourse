/**
 * require-await shapes that should NOT fire (regression guard
 * for the framework-async-callback positions skip):
 *
 * - mutationFn / queryFn / handler / resolver / fetch /
 *   subscribe / on* lifecycle keys.
 * - Last positional arg of HTTP-verb router calls
 *   (`router.get(p, async (c) => …)`).
 * - Framework async function declarations
 *   (`loader`, `action`, `GET`, `POST`, `generateMetadata`,
 *    `clientLoader`, `clientAction`, `meta`, `links`,
 *    `headers`, `middleware`).
 */

declare const useMutation: <T>(opts: { mutationFn: () => Promise<T> }) => unknown;
declare const useQuery: <T>(opts: { queryKey: unknown[]; queryFn: () => Promise<T> }) => T;
declare const http: {
  get: (p: string, h: () => unknown) => unknown;
};
declare const HttpResponse: { json: (b: unknown) => unknown };

export function shapes(): unknown {
  // Async value of mutationFn/queryFn/etc. — body has no await
  // because the inner work resolves immediately. The framework
  // contract still expects an async function.
  const mut = useMutation({
    mutationFn: async () => 1,
  });
  const q = useQuery({
    queryKey: ["k"],
    queryFn: async () => "v",
  });

  // MSW handler factory — async handler with no internal
  // await (resolves with literal data).
  http.get("/api/foo", async () => HttpResponse.json({ bar: 1 }));

  return { mut, q };
}

// Framework async function declarations (Remix / Next.js).
export async function loader() {
  return { count: 1 };
}

export async function action() {
  return { ok: true };
}

export async function GET() {
  return new Response(null);
}

export async function clientLoader() {
  return { ssr: false };
}

export async function generateMetadata() {
  return { title: "Page" };
}
