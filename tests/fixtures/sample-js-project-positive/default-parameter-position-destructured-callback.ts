// Fixed-arity callback signatures often take a leading argument with a default
// followed by a destructured context object the runtime always supplies. The
// default on the first parameter is a runtime safety net, not a misplaced
// default — the second argument can never be omitted, so the usual
// "default parameter not last" concern does not apply.

interface JobPayload {
  mode?: string;
  attempts?: number;
}

interface RunContext {
  signal: AbortSignal;
}

declare function defineJob(config: {
  id: string;
  run: (payload: JobPayload, ctx: RunContext) => Promise<string>;
}): { id: string };

declare function loadProfile(mode: string, signal: AbortSignal): Promise<string>;

export const batchJob = defineJob({
  id: 'process-batch',
  run: async (payload: JobPayload = {}, { signal }) => {
    const mode = payload.mode ?? 'standard';
    if (signal.aborted) return 'aborted';
    return await loadProfile(mode, signal);
  },
});
