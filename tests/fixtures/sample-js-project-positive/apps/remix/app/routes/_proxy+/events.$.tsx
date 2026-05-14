
declare const API_HOST: string;
declare const ASSET_HOST: string;
declare function fetch(url: Request | string, init?: RequestInit): Promise<Response>;

// URL path prefix proxy — /^\/events/ is pure ASCII.
const eventsProxy = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const hostname = url.pathname.startsWith('/events/static/') ? ASSET_HOST : API_HOST;

  const newUrl = new URL(url);
  newUrl.protocol = 'https';
  newUrl.hostname = hostname;
  newUrl.port = '443';
  newUrl.pathname = newUrl.pathname.replace(/^\/events/, '');

  const headers = new Headers(request.headers);
  headers.set('host', hostname);

  return fetch(new Request(newUrl.toString(), { method: request.method, headers }));
};

export { eventsProxy };
