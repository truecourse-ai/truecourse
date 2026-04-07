import express from 'express';
import { NotificationProcessor } from './processor';
import { EmailTemplates } from './templates';

// VIOLATION: security/deterministic/missing-helmet-middleware
const app = express();
app.use(express.json());

const processor = new NotificationProcessor();

// VIOLATION: code-quality/deterministic/missing-return-type
async function sendNotification(req: any, res: any) {
  // VIOLATION: database/deterministic/unvalidated-external-data
  const result = await processor.create(req.body);
  res.json(result);
}

// VIOLATION: code-quality/deterministic/missing-return-type
async function getNotificationStatus(req: any, res: any) {
  const status = await processor.getStatus(req.params.id);
  if (!status) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(status);
}

app.post('/notifications/send', sendNotification);
app.get('/notifications/status/:id', getNotificationStatus);

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  // VIOLATION: code-quality/deterministic/console-log
  console.log(`Notification Service on port ${PORT}`);
});

// VIOLATION: reliability/deterministic/uncaught-exception-no-handler
// VIOLATION: reliability/deterministic/unhandled-rejection-no-handler

export { app };
