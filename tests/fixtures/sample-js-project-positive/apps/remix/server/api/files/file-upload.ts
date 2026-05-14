declare function getPresignedUrl(key: string): Promise<string>;
declare const c: { json: (data: object, status?: number) => object; req: { valid: (t: string) => { fileName: string; contentType: string } } };

export async function handlePresignedUrlRequest() {
  const { fileName, contentType } = c.req.valid('json');

  try {
    const url = await getPresignedUrl(fileName);

    // c.json() is synchronous — returns a Response object directly, not a Promise.
    // No await needed on the return.
    return c.json({ url } satisfies { url: string });
  } catch (err) {
    return c.json({ error: 'Failed to generate URL' }, 500);
  }
}
