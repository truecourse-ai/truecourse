// Composition glue: wires the gateway's services together so the analyzer
// can trace method-level usage and not flag any of them as dead.

import { describeUser } from '@sample/shared-utils';
import { jobRegistry } from '../jobs/job-registry';
import { notifyUserJobRun } from '../jobs/notification-job';
import { checkLimit, getConstants } from '../middleware/rate-limiter';
import { HealthService } from './health.service';
import { UserService } from './user.service';

export interface GatewaySummary {
  readonly health: { status: string; uptime: number };
  readonly userIndex: string;
  readonly userById: string | null;
  readonly createdUser: string;
  readonly limits: { window: number; max: number; cleanup: number; status: number };
  readonly ipAllowed: boolean;
  readonly jobs: number;
  readonly firstJob: string;
  readonly sample: string;
}

export function describeGateway(clientIp: string): GatewaySummary {
  const users = new UserService();
  const health = new HealthService();

  const jobs = jobRegistry;
  const firstJob = notifyUserJobRun('demo-user');

  return {
    health: health.check(),
    userIndex: users.findAll(),
    userById: users.findById('demo'),
    createdUser: users.create({ name: 'Ada', email: 'ada@example.com' }),
    limits: getConstants(),
    ipAllowed: checkLimit(clientIp),
    jobs: jobs.length,
    firstJob,
    sample: describeUser({
      id: 'demo',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2024-01-01T00:00:00.000Z',
    }),
  };
}
