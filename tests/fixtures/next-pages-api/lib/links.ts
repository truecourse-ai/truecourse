export async function listLinks() { return [] }
export async function readLink(id: number) { return { id } }
export async function createLink(body: unknown) { return body }
export async function updateLink(id: number, body: unknown) { return { id, ...(body as object) } }
export async function deleteLink(_id: number) {}
export function withMethods(handlers: Record<string, (req: unknown, res: unknown) => unknown>) {
  return (req: { method?: string }, res: unknown) => handlers[req.method ?? '']?.(req, res)
}
