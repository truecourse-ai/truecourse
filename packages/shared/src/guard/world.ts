/**
 * THE PRODUCT WORLD — a product brought up from its checkout so that tests can
 * be written and run against it.
 *
 * A repository is operated by three shell scripts in its work tree
 * (`world/build.sh`, `world/up.sh`, `world/down.sh`), written by the setup
 * session that got the product running. This module is the contract between
 * those scripts and the engine that runs them: the environment the scripts are
 * given, and the file `up.sh` writes back to say what is now running.
 *
 * The world is BARE: the product installed and answering, holding nothing put
 * there for a test. The data a test starts from is that test's own seed
 * (`flow-tests.ts`), created when the test runs, so no two tests share any.
 *
 * The scripts own everything about HOW: package managers, containers,
 * migrations, how many processes there are. The engine owns only what must not
 * collide between two worlds on one host, and hands it in as environment: a
 * name for containers and volumes, and ports nobody else holds.
 */

import { z } from 'zod';

/**
 * The environment every world script runs with.
 *
 * - `TC_WORLD_ID`: a name unique to this world on this host. A script names
 *   whatever outlives it after it (a compose project, a container, a volume).
 * - `TC_PORTS`: space-separated free ports. A script binds NOTHING on the host
 *   that is not one of them, which is what lets two worlds run side by side.
 * - `TC_WORLD_FILE`: where `up.sh` writes the {@link ProductWorld} it started.
 * - `TC_WORLD_LOGS`: a directory for the output of anything left running.
 */
export const WORLD_ENV = {
  id: 'TC_WORLD_ID',
  ports: 'TC_PORTS',
  stateFile: 'TC_WORLD_FILE',
  logsDir: 'TC_WORLD_LOGS',
} as const;

/** How many free ports a world is handed. */
export const WORLD_PORT_COUNT = 8;

/**
 * An account the product's own installation made (an installer's admin, a
 * default root user). Never one created for tests: a seed may use it to create
 * what its test needs, and nothing changes it.
 */
export const WorldAccountSchema = z.object({
  /** How seeds and tests refer to it (`admin`, `root`). */
  name: z.string().min(1),
  /** What it may do in the product, in the product's own words. */
  role: z.string().optional(),
  email: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  /** An API credential minted for it, when the product has one. */
  token: z.string().optional(),
  /** How `token` is presented (`Authorization: Bearer <token>`). */
  tokenUsage: z.string().optional(),
  notes: z.string().optional(),
});
export type WorldAccount = z.infer<typeof WorldAccountSchema>;

/** What `up.sh` reports once the product answers. */
export const ProductWorldSchema = z.object({
  /** Where a person opens the product: the address tests start from. */
  baseUrl: z.string().url(),
  /** Every other address the product answers on, by name (`api`, `mail`). */
  urls: z.record(z.string().url()).default({}),
  /** Empty for a product whose installation creates no account. */
  accounts: z.array(WorldAccountSchema).default([]),
  /**
   * What a seed author must know that the above cannot say: how an account
   * comes to exist in this product, how a command reaches its datastore.
   */
  notes: z.string().optional(),
});
export type ProductWorld = z.infer<typeof ProductWorldSchema>;
