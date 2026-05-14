declare function sendHttpRequest(url: string, body: string): Promise<{ status: number; json: () => Promise<{ message: string }> }>;
declare function onSuccess(): void;
declare function onFailure(err: Error): void;

async function dispatchEmail(url: string, payload: string) {
  const res = await sendHttpRequest(url, payload);
  if (res.status >= 200 && res.status <= 299) {
    onSuccess();
    return;
  }
  const data = await res.json();
  onFailure(new Error(`Mail send failed: ${data.message}`));
}
