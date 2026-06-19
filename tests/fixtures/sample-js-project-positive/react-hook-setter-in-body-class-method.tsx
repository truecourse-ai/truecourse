// `setRuntimeBaseUrl` is a module-level configuration function — its name
// starts with "set" but it is not a React state setter. It is invoked from an
// ordinary class method (`dispatch`), never inside a component's render body.
// The "setter called during render" infinite-loop footgun cannot apply here,
// so this must not be flagged.

const runtimeConfig = { baseUrl: "" };

function setRuntimeBaseUrl(url: string): void {
  runtimeConfig.baseUrl = url;
}

export class MessageDispatcher {
  #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  dispatch(payload: string): string {
    setRuntimeBaseUrl(this.#baseUrl);
    return `${runtimeConfig.baseUrl}:${payload}`;
  }
}
