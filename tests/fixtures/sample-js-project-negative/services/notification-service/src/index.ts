import express from 'express';
import { NotificationProcessor } from './processor';
import { EmailTemplates } from './templates';

// VIOLATION: security/deterministic/missing-helmet-middleware
const app = express();
app.use(express.json());

const processor = new NotificationProcessor();

// VIOLATION: code-quality/deterministic/missing-return-type
app.post('/notifications/send', async (req, res) => {
  // VIOLATION: database/deterministic/unvalidated-external-data
  const result = await processor.enqueue(req.body);
  res.json(result);
});

// VIOLATION: code-quality/deterministic/missing-return-type
app.get('/notifications/status/:id', async (req, res) => {
  const status = await processor.getStatus(req.params.id);
  if (!status) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(status);
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  // VIOLATION: code-quality/deterministic/console-log
  console.log(`Notification Service on port ${PORT}`);
});

// VIOLATION: reliability/deterministic/uncaught-exception-no-handler
// VIOLATION: reliability/deterministic/unhandled-rejection-no-handler

export { app };
