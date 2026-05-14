declare const prisma: { backgroundJob: { findMany: (args: unknown) => Promise<unknown[]>; count: (args: unknown) => Promise<number> } };
declare const JobStatus: { PENDING: string; RUNNING: string; COMPLETED: string; FAILED: string };

import { z } from 'zod';

const FindDocumentJobsSchema = z.object({
  documentId: z.string().cuid(),
  status: z.nativeEnum(JobStatus).optional(),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(20),
});

export async function findDocumentJobs(input: z.infer<typeof FindDocumentJobsSchema>) {
  const { documentId, status, page, perPage } = FindDocumentJobsSchema.parse(input);

  const where = {
    referenceId: documentId,
    ...(status ? { status } : {}),
  };

  const [jobs, total] = await Promise.all([
    prisma.backgroundJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        name: true,
        status: true,
        attempts: true,
        createdAt: true,
        updatedAt: true,
        error: true,
      },
    }),
    prisma.backgroundJob.count({ where }),
  ]);

  return {
    jobs,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}
