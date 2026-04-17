ALTER TABLE "analyses" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "analysis_usage" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "database_connections" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "databases" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "flow_steps" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "flows" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "layers" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "method_dependencies" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "methods" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "module_dependencies" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "repos" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "service_dependencies" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "violations" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "analyses" DROP COLUMN "node_positions";