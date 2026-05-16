declare const c: { text: (msg: string, status: number) => Response; req: { method: string } };

function handleJobRequest() {
  if (c.req.method !== 'POST') {
    return c.text('Method not allowed', 405);
  }
  return null;
}


declare const jobDefinitions: Record<string, { enabled: boolean } | undefined>;
declare const c: { text: (msg: string, status: number) => Response };

function resolveJobDefinition(jobName: string) {
  const definition = jobDefinitions[jobName];
  if (!definition) {
    return c.text('Job not found', 404);
  }
  if (!definition.enabled) {
    return c.text('Job not found', 404);
  }
  return definition;
}
