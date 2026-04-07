import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { authMiddleware } from './middleware/auth';
import { healthRouter } from './routes/health';
import { userRouter } from './routes/users';

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(authMiddleware);

app.use('/api/health', healthRouter);
app.use('/api/users', userRouter);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  process.stdout.write(`API Gateway running on port ${PORT}\n`);
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
