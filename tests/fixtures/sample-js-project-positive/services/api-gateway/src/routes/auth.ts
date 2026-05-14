
// HTTP 201 in c.text() response is the standard Created status code
declare const c: { text(body: string, status: number): Response };
declare function createUserAccount(email: string, password: string): Promise<{ id: string }>;

async function registerHandler(email: string, password: string): Promise<Response> {
  const user = await createUserAccount(email, password);
  return c.text(`Created account ${user.id}`, 201);
}


declare const c: { status: (code: number) => Response };

function respondSignOutSuccess() {
  return c.status(200);
}


declare const c: { text: (msg: string, status: number) => Response };
declare const userEmail: string;
declare const SERVICE_ACCOUNT_EMAIL: string;

function guardServiceAccount(userEmail: string): Response | null {
  if (userEmail.toLowerCase() === SERVICE_ACCOUNT_EMAIL.toLowerCase()) {
    return c.text('FORBIDDEN', 403);
  }
  return null;
}
