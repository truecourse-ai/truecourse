import { watch, type FSWatcher } from 'chokidar';
import { log } from '@truecourse/core/lib/logger';

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function watchRepo(
  repoPath: string,
  callback: (changedFiles: string[]) => void
): void {
  if (watchers.has(repoPath)) {
    return;
  }

  const pendingChanges = new Set<string>();

  const watcher = watch(repoPath, {
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  watcher.on('all', (_event: string, filePath: string) => {
    pendingChanges.add(filePath);

    const existingTimer = debounceTimers.get(repoPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const changedFiles = Array.from(pendingChanges);
      pendingChanges.clear();
      debounceTimers.delete(repoPath);
      callback(changedFiles);
    }, 500);

    debounceTimers.set(repoPath, timer);
  });

  watcher.on('error', (error: unknown) => {
    log.error(`[Watcher] Error watching ${repoPath}: ${error instanceof Error ? error.message : String(error)}`);
  });

  watchers.set(repoPath, watcher);
  log.info(`[Watcher] Started watching ${repoPath}`);
}

export function stopWatching(repoPath: string): void {
  const watcher = watchers.get(repoPath);
  if (watcher) {
    watcher.close();
    watchers.delete(repoPath);
    log.info(`[Watcher] Stopped watching ${repoPath}`);
  }

  const timer = debounceTimers.get(repoPath);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(repoPath);
  }
}

export function stopAllWatchers(): void {
  for (const [repoPath] of watchers) {
    stopWatching(repoPath);
  }
}
