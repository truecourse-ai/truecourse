
// Local job queue processor - 150ms polling delay between job checks
async function pollJobQueue(processJob: (job: any) => Promise<void>): Promise<void> {
  while (true) {
    const job = await fetchNextJob();
    if (job) {
      await processJob(job);
    } else {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}

declare function fetchNextJob(): Promise<any>;
