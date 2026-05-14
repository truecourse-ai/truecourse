
declare type HeadersMap = Map<string, string>;
declare function resolveResponse(statusCode: number, headers: HeadersMap, body: string): void;

function createMockResponse(onComplete: typeof resolveResponse) {
  const resHeaders: HeadersMap = new Map();
  let statusCode: number;
  let body = '';

  const res = {
    setHeader(key: string, value: string) {
      resHeaders.set(key, value);
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    end(data: string) {
      body = data;
      onComplete(statusCode, resHeaders, body);
    },
  };

  return res;
}
