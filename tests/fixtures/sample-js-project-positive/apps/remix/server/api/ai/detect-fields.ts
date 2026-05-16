
// [unknown-catch-variable] catch(error) — instanceof AppError guard before typed method access
declare class AppError extends Error { code: string; toRestApiError(): { status: number; body: object } }
declare function runAiFieldDetection(documentId: string): Promise<Array<{ field: string; confidence: number }>>;

async function detectDocumentFields(documentId: string): Promise<Response> {
  try {
    const fields = await runAiFieldDetection(documentId);
    return Response.json({ fields });
  } catch (error) {
    if (error instanceof AppError) {
      const { status, body } = error.toRestApiError();
      return Response.json(body, { status });
    }
    return Response.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
