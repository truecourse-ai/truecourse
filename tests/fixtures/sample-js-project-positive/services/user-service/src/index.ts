import express from 'express';
import helmet from 'helmet';
import { userRoutes } from './routes';
import { connectDatabase } from './db/connection';

const app = express();
app.use(helmet());
app.use(express.json());

// Authentication handled by authMiddleware from gateway

app.use('/users', userRoutes);

async function start(): Promise<void> {
  await connectDatabase();
  const PORT = process.env.PORT ?? 3001;
  app.listen(PORT, () => {
    process.stdout.write(`User Service running on port ${PORT}\n`);
  });
}

start().catch((err: unknown) => {
  process.stderr.write(`Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`Unhandled rejection: ${String(reason)}\n`);
  process.exit(1);
});

export { app };
