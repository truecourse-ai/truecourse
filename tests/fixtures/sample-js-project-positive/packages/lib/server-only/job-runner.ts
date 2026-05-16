
// Wave-M37: Promise.all(eligibleJobs.map(async (job) => {...})) — standard async map with Promise.all
declare const eligibleJobs: Array<{ id: string; name: string; payload: object }>;
declare function createPendingJob(opts: { jobId: string; name: string; payload: object }): Promise<{ id: string }>;
declare function submitJob(pendingId: string): Promise<void>;

async function runEligibleJobs() {
  await Promise.all(
    eligibleJobs.map(async (job) => {
      const pendingJob = await createPendingJob({
        jobId: job.id,
        name: job.name,
        payload: job.payload,
      });
      await submitJob(pendingJob.id);
    }),
  );
}
