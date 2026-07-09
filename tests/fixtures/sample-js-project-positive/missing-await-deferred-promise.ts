/**
 * Positive fixture for bugs/deterministic/missing-await.
 *
 * A loader that streams data to the client: the promise is deliberately NOT
 * awaited in the loader, it is handed off (still pending) inside a deferred
 * response and resolved later during render. The `...Promise` variable-name
 * suffix is the explicit convention signalling "this intentionally holds a
 * promise". Requiring an `await` here would defeat the streaming pattern, so
 * flagging it is a false positive.
 */

interface DeferredDashboard {
  environmentId: string
  summaryPromise: Promise<string>
}

interface Environment {
  id: string
}

function resolveEnvironment(orgId: string): Promise<Environment> {
  return Promise.resolve({ id: orgId })
}

function fetchSummary(environmentId: string): Promise<string> {
  return Promise.resolve(environmentId)
}

export async function loadDashboard(orgId: string): Promise<DeferredDashboard> {
  const environment = await resolveEnvironment(orgId)
  const summaryPromise = fetchSummary(environment.id)
  return {
    environmentId: environment.id,
    summaryPromise,
  }
}
