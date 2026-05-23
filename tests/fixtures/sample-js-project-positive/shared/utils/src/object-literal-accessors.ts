/**
 * Object-literal getter accessors. They are accessed as properties
 * (`response.statusCode`) by the calling framework, not invoked by
 * name, so the `architecture/deterministic/dead-method` rule should
 * NOT flag them.
 */

export interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
}

export function createResponseStub(initial: number): ResponseLike {
  const headers = new Map<string, string>();
  return {
    get statusCode(): number {
      return initial;
    },
    setHeader(name: string, value: string): void {
      headers.set(name, value);
    },
  };
}
