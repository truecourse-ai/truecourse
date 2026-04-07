import express from 'express';
import { userRoutes } from './routes';
import { connectDatabase } from './db/connection';

// VIOLATION: security/deterministic/missing-helmet-middleware
const app = express();
app.use(express.json());
app.use('/users', userRoutes);

// VIOLATION: code-quality/deterministic/missing-return-type
async function start() {
  await connectDatabase();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    // VIOLATION: code-quality/deterministic/console-log
    console.log(`User Service running on port ${PORT}`);
  });
}

start();

// VIOLATION: reliability/deterministic/uncaught-exception-no-handler
// VIOLATION: reliability/deterministic/unhandled-rejection-no-handler

export { app };
