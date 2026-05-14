
// FP: async function body with simple destructuring followed by property access
declare const ctx: { req: { path: string; method: string } };

async function handleApiRedirect() {
  const { req } = ctx;
  const path = req.path;
  const method = req.method;
  return { path, method };
}
