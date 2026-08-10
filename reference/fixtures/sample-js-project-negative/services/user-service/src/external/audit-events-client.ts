// External integration: posts events to a remote audit service.
// Both the filename ("client") and the axios import classify this as
// the external layer.
import axios from 'axios';

const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || 'https://audit.example.com';

export class AuditEventsClient {
  async post(userId: string, event: string): Promise<void> {
    await axios.post(`${AUDIT_SERVICE_URL}/events`, { userId, event });
  }
}
