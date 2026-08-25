async function fetchExternalSafe(): Promise<unknown> {
  // VIOLATION: reliability/deterministic/http-call-no-timeout
  const res = await fetch('https://api.example.com/v1/widgets');
  return res.json();
}

export const externalSnapshot = fetchExternalSafe();
