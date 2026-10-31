import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user_oauth_identity" ADD "updateId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`CREATE INDEX "user_oauth_identity_updateId_idx" ON "user_oauth_identity" ("updateId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "user_oauth_identity_updateId_idx";`.execute(db);
  await sql`ALTER TABLE "user_oauth_identity" DROP COLUMN "updateId";`.execute(db);
}
