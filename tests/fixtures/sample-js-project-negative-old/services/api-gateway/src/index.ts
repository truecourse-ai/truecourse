import express from 'express';
import cors from 'cors';
import { userRouter } from './routes/users';
import { healthRouter } from './routes/health';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/users', userRouter);
app.use('/api/health', healthRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});

export { app };
