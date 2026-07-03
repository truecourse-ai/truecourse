import { buildBookingApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
buildBookingApp().listen(port, () => {
  console.log(`booking app listening on :${port}`);
});
