import { createTestDatabase } from './helpers';

/** Runs once before all database tests: a fresh database with the schema baseline applied. */
export default async function setup(): Promise<void> {
  await createTestDatabase();
}
