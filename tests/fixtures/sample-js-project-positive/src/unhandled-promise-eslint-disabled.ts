/**
 * Promise-returning expression statements with an explicit
 * `// eslint-disable-next-line @typescript-eslint/no-floating-promises`
 * directly above are intentionally fire-and-forget (typically
 * application entrypoints). The author has already acknowledged
 * the floating promise, so the rule should not flag it.
 */

declare function bootstrap(): Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
