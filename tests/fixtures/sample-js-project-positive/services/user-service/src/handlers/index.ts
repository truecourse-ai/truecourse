/**
 * AWS Lambda HTTP handler. The Lambda runtime owns the process lifecycle —
 * user-installed top-level error handlers can interfere with the runtime's
 * reporting and are AWS-discouraged. The uncaught-exception-no-handler and
 * unhandled-rejection-no-handler rules should not flag a Lambda entrypoint.
 */
interface LambdaEvent {
  requestContext: { http: { path: string; method: string } };
  body?: string;
}
interface LambdaResult {
  statusCode: number;
  body: string;
}
interface LambdaContext {
  awsRequestId: string;
}

export const handler = async (
  event: LambdaEvent,
  _context: LambdaContext,
): Promise<LambdaResult> => {
  await Promise.resolve();
  const path = event.requestContext.http.path;

  if (path === '/health') {
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
};
