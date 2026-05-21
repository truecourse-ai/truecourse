/**
 * Positive fixture for code-quality/deterministic/static-method-candidate.
 *
 * Methods in an abstract base class are typically stubs that subclasses
 * override; making them `static` would break polymorphic dispatch. The visitor
 * only skipped classes with an explicit `extends`/`implements`, so an abstract
 * base with no heritage clause leaked through.
 */

interface JobOptions {
  name: string;
}

interface JobHandle {
  cancel(): void;
}

export abstract class BaseJobProvider {
  public triggerJob(options: JobOptions): JobHandle {
    throw new Error(`triggerJob not implemented for job '${options.name}'`);
  }

  public defineJob(name: string, intervalMs: number): void {
    throw new Error(`defineJob not implemented (name=${name}, interval=${intervalMs})`);
  }

  public getApiHandler(): () => Promise<void> {
    throw new Error('getApiHandler not implemented');
  }
}
