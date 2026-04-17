import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    url: process.env.TRUECOURSE_DATA_DIR || 'file:.drizzle-pglite',
  },
});
