// VIOLATION: architecture/deterministic/circular-service-dependency
import express from 'express';
import cors from 'cors';
import { userRouter } from './routes/users';
import { healthRouter } from './routes/health';

// VIOLATION: security/deterministic/missing-helmet-middleware
// VIOLATION: security/deterministic/missing-helmet-middleware
const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/users', userRouter);
app.use('/api/health', healthRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // VIOLATION: code-quality/deterministic/console-log
  console.log(`API Gateway running on port ${PORT}`);
});

// VIOLATION: reliability/deterministic/uncaught-exception-no-handler
// VIOLATION: reliability/deterministic/unhandled-rejection-no-handler

export { app };
