// Another Remix route module shape — basename starts with the route segment
// name, then ends with `._index.tsx`. The old visitor matched `.includes('index.')`.

declare function listDocuments(): Promise<readonly string[]>;

export const loader = async (): Promise<{ documents: readonly string[] }> => {
  const documents = await listDocuments();
  return { documents };
};

export default function DocumentsIndex(): null {
  return null;
}
