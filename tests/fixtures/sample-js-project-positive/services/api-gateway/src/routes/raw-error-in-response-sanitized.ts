// Catch handlers that *look* like raw-error-in-response targets (file
// path contains `routes`, catch body mentions `err.message`) but the
// message is gated by an instanceof check, used as a key into an enum,
// or fed into a pattern matcher — never sent raw to the client.

type AppError = Error & { code: string };
declare const AppError: { new (code: string): AppError };

const STATUS_UNAUTHORIZED = 401;
const STATUS_INTERNAL = 500;

const ERROR_CODES: Record<string, string> = {
  UNAUTHORIZED: 'unauthorized',
  UNKNOWN: 'unknown',
};

declare function callExternal(): Promise<void>;

declare const res: {
  status: (code: number) => { json: (body: unknown) => void };
};

export async function instanceOfGatedHandler(): Promise<void> {
  try {
    await callExternal();
  } catch (err: unknown) {
    let message = 'Unauthorized';
    if (err instanceof AppError) {
      message = err.message;
    }
    res.status(STATUS_UNAUTHORIZED).json({ message });
  }
}

export async function ternaryGatedHandler(): Promise<void> {
  try {
    await callExternal();
  } catch (error: unknown) {
    const message =
      error instanceof AppError ? error.message : 'Operation failed';
    res.status(STATUS_INTERNAL).json({ message });
  }
}

export async function enumKeyHandler(): Promise<void> {
  try {
    await callExternal();
  } catch (err: unknown) {
    if (err instanceof Error) {
      const code = ERROR_CODES[err.message] ?? ERROR_CODES.UNKNOWN;
      res.status(STATUS_INTERNAL).json({ error: code });
    }
  }
}
