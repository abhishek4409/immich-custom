import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

const logger = LoggingRepository.create('Migrations');

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "user_oauth_identity" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "role" character varying NOT NULL,
  "sub" character varying,
  "email" character varying NOT NULL,
  "name" character varying,
  "inviteExpiresAt" timestamp with time zone,
  "lastLoginAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_oauth_identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "user_oauth_identity_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE UNIQUE INDEX "user_oauth_identity_unique_owner" ON "user_oauth_identity" ("userId") WHERE ("role" = 'owner');`.execute(db);
  await sql`CREATE UNIQUE INDEX "user_oauth_identity_unique_invite" ON "user_oauth_identity" ("email") WHERE ("sub" IS NULL);`.execute(db);
  await sql`CREATE UNIQUE INDEX "user_oauth_identity_unique_sub" ON "user_oauth_identity" ("sub") WHERE ("sub" IS NOT NULL);`.execute(db);
  await sql`CREATE INDEX "user_oauth_identity_userId_idx" ON "user_oauth_identity" ("userId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "user_oauth_identity_updatedAt"
  BEFORE UPDATE ON "user_oauth_identity"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`ALTER TABLE "session" ADD "oauthIdentityId" uuid;`.execute(db);
  await sql`ALTER TABLE "api_key" ADD "oauthIdentityId" uuid;`.execute(db);
  await sql`ALTER TABLE "session" ADD CONSTRAINT "session_oauthIdentityId_fkey" FOREIGN KEY ("oauthIdentityId") REFERENCES "user_oauth_identity" ("id") ON UPDATE CASCADE ON DELETE CASCADE;`.execute(db);
  await sql`ALTER TABLE "api_key" ADD CONSTRAINT "api_key_oauthIdentityId_fkey" FOREIGN KEY ("oauthIdentityId") REFERENCES "user_oauth_identity" ("id") ON UPDATE CASCADE ON DELETE CASCADE;`.execute(db);
  await sql`CREATE INDEX "session_oauthIdentityId_idx" ON "session" ("oauthIdentityId");`.execute(db);
  await sql`CREATE INDEX "api_key_oauthIdentityId_idx" ON "api_key" ("oauthIdentityId");`.execute(db);

  // "oauthId" was never unique, so keep one user per sub: prefer non-deleted, then the most recently updated
  await sql`INSERT INTO "user_oauth_identity" ("userId", "role", "sub", "email", "name")
  SELECT DISTINCT ON ("oauthId") "id", 'owner', "oauthId", "email", "name"
  FROM "user"
  WHERE "oauthId" IS NOT NULL AND "oauthId" <> ''
  ORDER BY "oauthId", ("deletedAt" IS NULL) DESC, "updatedAt" DESC;`.execute(db);

  const { rows: duplicates } = await sql<{ id: string }>`
    SELECT "user"."id"
    FROM "user"
    LEFT JOIN "user_oauth_identity" ON "user_oauth_identity"."userId" = "user"."id"
    WHERE "user"."oauthId" IS NOT NULL AND "user"."oauthId" <> '' AND "user_oauth_identity"."id" IS NULL
  `.execute(db);
  for (const { id } of duplicates) {
    logger.warn(`Unlinking OAuth account from user ${id}: the same account is linked to another user`);
    await sql`UPDATE "user" SET "oauthId" = NULL WHERE "id" = ${id};`.execute(db);
  }

  // existing sessions and API keys all belong to the owner, keep "updatedAt" since session cleanup depends on it
  await sql`ALTER TABLE "session" DISABLE TRIGGER "session_updatedAt";`.execute(db);
  await sql`ALTER TABLE "api_key" DISABLE TRIGGER "api_key_updatedAt";`.execute(db);
  await sql`UPDATE "session" SET "oauthIdentityId" = "user_oauth_identity"."id" FROM "user_oauth_identity" WHERE "user_oauth_identity"."userId" = "session"."userId";`.execute(db);
  await sql`UPDATE "api_key" SET "oauthIdentityId" = "user_oauth_identity"."id" FROM "user_oauth_identity" WHERE "user_oauth_identity"."userId" = "api_key"."userId";`.execute(db);
  await sql`ALTER TABLE "session" ENABLE TRIGGER "session_updatedAt";`.execute(db);
  await sql`ALTER TABLE "api_key" ENABLE TRIGGER "api_key_updatedAt";`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_user_oauth_identity_updatedAt', '{"type":"trigger","name":"user_oauth_identity_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"user_oauth_identity_updatedAt\\"\\n  BEFORE UPDATE ON \\"user_oauth_identity\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_user_oauth_identity_unique_owner', '{"type":"index","name":"user_oauth_identity_unique_owner","sql":"CREATE UNIQUE INDEX \\"user_oauth_identity_unique_owner\\" ON \\"user_oauth_identity\\" (\\"userId\\") WHERE (\\"role\\" = ''owner'');"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_user_oauth_identity_unique_invite', '{"type":"index","name":"user_oauth_identity_unique_invite","sql":"CREATE UNIQUE INDEX \\"user_oauth_identity_unique_invite\\" ON \\"user_oauth_identity\\" (\\"email\\") WHERE (\\"sub\\" IS NULL);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_user_oauth_identity_unique_sub', '{"type":"index","name":"user_oauth_identity_unique_sub","sql":"CREATE UNIQUE INDEX \\"user_oauth_identity_unique_sub\\" ON \\"user_oauth_identity\\" (\\"sub\\") WHERE (\\"sub\\" IS NOT NULL);"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "api_key_oauthIdentityId_idx";`.execute(db);
  await sql`DROP INDEX "session_oauthIdentityId_idx";`.execute(db);
  await sql`ALTER TABLE "api_key" DROP CONSTRAINT "api_key_oauthIdentityId_fkey";`.execute(db);
  await sql`ALTER TABLE "session" DROP CONSTRAINT "session_oauthIdentityId_fkey";`.execute(db);
  await sql`ALTER TABLE "api_key" DROP COLUMN "oauthIdentityId";`.execute(db);
  await sql`ALTER TABLE "session" DROP COLUMN "oauthIdentityId";`.execute(db);
  await sql`DROP TABLE "user_oauth_identity";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_user_oauth_identity_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_user_oauth_identity_unique_owner';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_user_oauth_identity_unique_invite';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_user_oauth_identity_unique_sub';`.execute(db);
}
