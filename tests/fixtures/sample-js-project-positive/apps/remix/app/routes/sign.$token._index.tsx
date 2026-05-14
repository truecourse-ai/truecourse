// remix-route-module: Remix route with loader + React page — framework-managed, no process-level responsibility
declare function getDocumentByToken(token: string): Promise<{ id: string; title: string; status: string } | null>;
declare function redirect(url: string): never;

export async function loader({ params }: { params: { token: string } }) {
  const document = await getDocumentByToken(params.token);
  if (!document) {
    throw redirect('/');
  }
  return { document };
}

export default function SigningPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { document } = loaderData;
  return <div>Sign: {document.title}</div>;
}
