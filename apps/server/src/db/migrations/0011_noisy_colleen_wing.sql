ALTER TABLE "analyses" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;
-- Existing rows are completed analyses; new rows created at analysis start will explicitly set 'running'
