// Local Express type stubs for the fixture so the ts-compiler doesn't fall
// back to `any` (no @types/express installed in the fixture). Just enough
// surface for the handlers + routes that follow SPEC.md.

export interface Request {
  body: unknown;
  params: { [key: string]: string };
}

export interface Response {
  status(code: number): Response;
  json(body: unknown): Response;
  send(body?: unknown): Response;
}

export type Handler = (req: Request, res: Response) => Promise<void>;

export interface Router {
  get(path: string, handler: Handler): Router;
  post(path: string, handler: Handler): Router;
  delete(path: string, handler: Handler): Router;
}
