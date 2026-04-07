import express from 'express';
import { userRoutes } from './routes';
import { connectDatabase } from './db/connection';

const app = express();
app.use(express.json());
app.use('/users', userRoutes);

async function start() {
  await connectDatabase();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
  });
}

start();

export { app };
