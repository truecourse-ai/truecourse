
// --- FP shape: utility function returning a simple object literal; return type trivially inferred ---
declare interface PageInfo { slugs: string[]; title: string }

function getPageImage(page: PageInfo) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  };
}



// --- FP shape: getter accessor returning a number captured in closure; return type trivially inferred ---
declare interface FakeServerResponse {
  statusCode: number;
  end(body: string): void;
}

function createMockServerResponse(): FakeServerResponse {
  let statusCode = 200;

  return {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    end(body: string) {
      // no-op
    },
  } as FakeServerResponse;
}



// --- FP shape: internal async helper returning Headers or undefined depending on branch; type is inferable ---
declare type StaticOrigin = string | string[] | RegExp;
declare type OriginFn = (origin: string | undefined, req: Request) => Promise<StaticOrigin | false>;

async function originHeadersFromReq(req: Request, origin: StaticOrigin | OriginFn) {
  const reqOrigin = req.headers.get('Origin') || undefined;
  const value = typeof origin === 'function' ? await origin(reqOrigin, req) : origin;

  if (!value) {
    return;
  }

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', reqOrigin ?? '*');
  return headers;
}



// --- FP shape: factory function returning an async function; return type trivially inferred from returned arrow function body ---
declare type CorsOptions = { origin?: string | string[] | RegExp; credentials?: boolean };
declare function cors(req: Request, res: Response, opts?: CorsOptions): Promise<void>;

export function initCors(options?: CorsOptions) {
  return async (req: Request, res: Response) => cors(req, res, options);
}
