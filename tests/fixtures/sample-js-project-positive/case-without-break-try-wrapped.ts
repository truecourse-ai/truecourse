// A case body that wraps try/catch where every branch returns can never
// fall through, so the rule shouldn't flag it.

interface Request {
  url: string;
}
interface Response {
  status: number;
}

declare function getBody(req: Request): Promise<string>;

export async function routeCheckpoint(req: Request): Promise<Response> {
  switch (req.url) {
    case '/checkpoint/duration': {
      try {
        await getBody(req);
        return { status: 204 };
      } catch {
        return { status: 500 };
      }
    }
    case '/checkpoint/manual': {
      try {
        await getBody(req);
        return { status: 200 };
      } catch {
        return { status: 500 };
      }
    }
    default: {
      return { status: 404 };
    }
  }
}
