import { buildOpsApp } from './app.js';

const port = Number(process.env.OPS_PORT ?? 3001);
buildOpsApp().listen(port, () => {
  console.log(`ops console listening on :${port}`);
});
