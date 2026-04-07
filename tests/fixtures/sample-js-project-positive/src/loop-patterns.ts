/**
 * Loop patterns that should NOT trigger any rules.
 *
 * Uses filter and map instead of manual push in loops.
 * Batch processing with proper error handling.
 */

interface Task {
  id: string;
  name: string;
  priority: number;
}

interface ProcessResult {
  taskId: string;
  success: boolean;
}

const HIGH_PRIORITY_THRESHOLD = 5;

export function filterHighPriority(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.priority > HIGH_PRIORITY_THRESHOLD);
}

export function summarizeTasks(tasks: readonly Task[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const task of tasks) {
    const current = counts.get(task.priority) ?? 0;
    counts.set(task.priority, current + 1);
  }
  return counts;
}

export async function processBatch(
  tasks: readonly Task[],
  processor: (task: Task) => Promise<ProcessResult>,
): Promise<ProcessResult[]> {
  const empty: ProcessResult[] = [];
  try {
    const fetched = await Promise.all(tasks.map((task) => processor(task)));
    return fetched;
  } catch {
    process.stderr.write('Batch error occurred\n');
    return empty;
  }
}

async function processBatchRecursive(
  batches: readonly (readonly Task[])[],
  processor: (task: Task) => Promise<ProcessResult>,
  accumulated: readonly ProcessResult[],
): Promise<ProcessResult[]> {
  if (batches.length === 0) {
    return [...accumulated];
  }
  const first = batches[0] ?? [];
  const rest = batches.slice(1);
  try {
    const results = await Promise.all(first.map(processor));
    return await processBatchRecursive(rest, processor, [...accumulated, ...results]);
  } catch {
    process.stderr.write('Batch step error occurred\n');
    return await processBatchRecursive(rest, processor, accumulated);
  }
}

export async function processInBatches(
  tasks: readonly Task[],
  processor: (task: Task) => Promise<ProcessResult>,
  batchSize: number,
): Promise<ProcessResult[]> {
  const indices = Array.from({ length: Math.ceil(tasks.length / batchSize) }, (_, i) => i * batchSize);
  const batches = indices.map((start) => tasks.slice(start, start + batchSize));
  return [...await processBatchRecursive(batches, processor, [])];
}

const TIMEOUT_MS = 5000;

async function attemptFetch(url: string, remaining: number): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch {
    if (remaining <= 1) {
      throw new Error('All retry attempts failed');
    }
    return await attemptFetch(url, remaining - 1);
  }
}

export async function fetchWithRetry(url: string): Promise<string> {
  const MAX_ATTEMPTS = 3;
  try {
    return await attemptFetch(url, MAX_ATTEMPTS);
  } catch {
    throw new Error('Fetch with retry failed');
  }
}

export function totalPriority(tasks: readonly Task[]): number {
  return tasks.reduce((sum, task) => sum + task.priority, 0);
}
