import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
buildApp().listen(port, () => {
  console.log(`order service listening on :${port}`);
});
