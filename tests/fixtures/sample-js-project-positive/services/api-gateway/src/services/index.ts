/**
 * Service barrel file -- named re-exports.
 */

export { UserService } from './user.service';
export { HealthService } from './health.service';

// Process error handlers for this service module
process.on('uncaughtException', (error: Error) => {
  console.error(`Service uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error(`Service unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(1);
});
