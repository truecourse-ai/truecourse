// A catch block that narrows the error through a user-defined type guard
// (`isSubprocessError(error)`) is correctly discriminating the error type —
// `instanceof` / `typeof` are not the only ways to do so. The handler rethrows
// anything that is not the expected shape and only formats the known case, so
// flagging it for "no type discrimination" is a false positive.

interface SubprocessError {
  exitCode: number;
  stderr: string;
}

declare function isSubprocessError(value: unknown): value is SubprocessError;
declare function runCommand(args: readonly string[]): Promise<void>;
declare const log: { error: (msg: string, meta: unknown) => void };

export async function execute(args: readonly string[]): Promise<void> {
  try {
    await runCommand(args);
  } catch (error) {
    if (!isSubprocessError(error)) {
      throw error;
    }

    log.error('command failed', {
      exitCode: error.exitCode,
      stderr: error.stderr,
    });
  }
}
