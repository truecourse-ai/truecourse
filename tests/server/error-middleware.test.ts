import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../../apps/dashboard/server/src/middleware/error';
import { createAppError } from '@truecourse/core/lib/errors';

vi.mock('@truecourse/core/lib/logger', () => ({ log: { error: vi.fn() } }));

describe('HTTP error responses', () => {
  it('does not expose failed SQL queries or transcript parameters', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    errorHandler(new Error('Failed query: insert into activity_events; params: private transcript'), {} as Request, { status } as unknown as Response, vi.fn());
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error. Please try again.' });
  });

  it('preserves actionable client error messages', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    errorHandler(createAppError('Unknown session command', 400), {} as Request, { status } as unknown as Response, vi.fn());
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'Unknown session command' });
  });
});
