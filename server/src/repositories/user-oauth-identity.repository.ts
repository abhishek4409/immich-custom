import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type { Kysely, Transaction, Updateable } from 'kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { UserOAuthIdentityRole } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { UserOAuthIdentityTable } from 'src/schema/tables/user-oauth-identity.table.js';
import { asUuid } from 'src/utils/database.js';

const identityColumns = [
  'user_oauth_identity.id',
  'user_oauth_identity.userId',
  'user_oauth_identity.role',
  'user_oauth_identity.sub',
  'user_oauth_identity.email',
  'user_oauth_identity.name',
  'user_oauth_identity.inviteExpiresAt',
  'user_oauth_identity.lastLoginAt',
  'user_oauth_identity.createdAt',
  'user_oauth_identity.updatedAt',
] as const;

export type UserOAuthIdentityBind = {
  userId: string;
  role: UserOAuthIdentityRole;
  sub: string;
  email: string;
  name: string | null;
  lastLoginAt?: Date;
};

@Injectable()
export class UserOAuthIdentityRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.db
      .selectFrom('user_oauth_identity')
      .select(identityColumns)
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByUserId(userId: string) {
    return this.db
      .selectFrom('user_oauth_identity')
      .select(identityColumns)
      .where('userId', '=', userId)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  // an identity on a soft-deleted user is not usable, see `removeStale`
  @GenerateSql({ params: [DummyValue.STRING] })
  getBySub(sub: string) {
    return this.db
      .selectFrom('user_oauth_identity')
      .innerJoin('user', (join) =>
        join.onRef('user.id', '=', 'user_oauth_identity.userId').on('user.deletedAt', 'is', null),
      )
      .select(identityColumns)
      .where('user_oauth_identity.sub', '=', sub)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.EMAIL] })
  getOpenInvite(email: string) {
    return this.db
      .selectFrom('user_oauth_identity')
      .innerJoin('user', (join) =>
        join.onRef('user.id', '=', 'user_oauth_identity.userId').on('user.deletedAt', 'is', null),
      )
      .select(identityColumns)
      .where('user_oauth_identity.email', '=', email)
      .where('user_oauth_identity.sub', 'is', null)
      .where('user_oauth_identity.inviteExpiresAt', '>', new Date())
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.EMAIL] })
  getInviteByEmail(email: string) {
    return this.db
      .selectFrom('user_oauth_identity')
      .innerJoin('user', 'user.id', 'user_oauth_identity.userId')
      .select(identityColumns)
      .select('user.deletedAt as userDeletedAt')
      .where('user_oauth_identity.email', '=', email)
      .where('user_oauth_identity.sub', 'is', null)
      .executeTakeFirst();
  }

  update(id: string, dto: Updateable<UserOAuthIdentityTable>) {
    return this.db
      .updateTable('user_oauth_identity')
      .set(dto)
      .where('id', '=', asUuid(id))
      .returning(identityColumns)
      .executeTakeFirstOrThrow();
  }

  createInvite(dto: { userId: string; email: string; inviteExpiresAt: Date }) {
    return this.db
      .insertInto('user_oauth_identity')
      .values({ ...dto, role: UserOAuthIdentityRole.Member })
      .returning(identityColumns)
      .executeTakeFirstOrThrow();
  }

  /** Add a Google account to a user. An open invite for the same email on that user is replaced. */
  bind({ userId, role, sub, email, name, lastLoginAt }: UserOAuthIdentityBind) {
    return this.db.transaction().execute(async (tx) => {
      await this.removeStale(tx, sub);
      await tx
        .deleteFrom('user_oauth_identity')
        .where('userId', '=', userId)
        .where('email', '=', email)
        .where('sub', 'is', null)
        .execute();

      const identity = await tx
        .insertInto('user_oauth_identity')
        .values({ userId, role, sub, email, name, lastLoginAt })
        .returning(identityColumns)
        .executeTakeFirstOrThrow();

      if (role === UserOAuthIdentityRole.Owner) {
        await tx.updateTable('user').set({ oauthId: sub }).where('id', '=', userId).execute();
      }

      return identity;
    });
  }

  /** Accept an invite. Returns nothing if it was removed, used or expired in the meantime. */
  redeemInvite(id: string, dto: { sub: string; name: string | null }) {
    return this.db.transaction().execute(async (tx) => {
      await this.removeStale(tx, dto.sub);

      return tx
        .updateTable('user_oauth_identity')
        .set({ ...dto, inviteExpiresAt: null, lastLoginAt: new Date() })
        .where('id', '=', asUuid(id))
        .where('sub', 'is', null)
        .where('inviteExpiresAt', '>', new Date())
        .returning(identityColumns)
        .executeTakeFirst();
    });
  }

  /**
   * Remove an identity and return the sessions that ended with it. Deleting a member cascades to their sessions and
   * API keys. The owner's stay valid at owner level with the link cleared, which is what unlinking has always done.
   */
  remove(id: string) {
    return this.db.transaction().execute(async (tx) => {
      const identity = await tx
        .selectFrom('user_oauth_identity')
        .select(['userId', 'role'])
        .where('id', '=', asUuid(id))
        .executeTakeFirst();
      if (!identity) {
        return [];
      }

      if (identity.role === UserOAuthIdentityRole.Owner) {
        await this.detachOwner(tx, identity.userId);
      }

      const sessions = await tx.selectFrom('session').select('id').where('oauthIdentityId', '=', asUuid(id)).execute();
      await tx.deleteFrom('user_oauth_identity').where('id', '=', asUuid(id)).execute();

      return sessions.map((session) => session.id);
    });
  }

  /** The caller checks that the new owner is an accepted identity on this user. */
  transferOwner(userId: string, id: string, sub: string) {
    return this.db.transaction().execute(async (tx) => {
      // demote first, the unique owner index is checked per statement
      await tx
        .updateTable('user_oauth_identity')
        .set({ role: UserOAuthIdentityRole.Member })
        .where('userId', '=', userId)
        .where('role', '=', UserOAuthIdentityRole.Owner)
        .execute();
      await tx.updateTable('user').set({ oauthId: sub }).where('id', '=', userId).execute();

      return tx
        .updateTable('user_oauth_identity')
        .set({ role: UserOAuthIdentityRole.Owner })
        .where('id', '=', asUuid(id))
        .returning(identityColumns)
        .executeTakeFirstOrThrow();
    });
  }

  /** Unlink every OAuth account on the server and return the sessions that ended with it. */
  removeAll() {
    return this.db.transaction().execute(async (tx) => {
      await this.detachOwner(tx);

      const sessions = await tx.selectFrom('session').select('id').where('oauthIdentityId', 'is not', null).execute();
      await tx.deleteFrom('user_oauth_identity').execute();
      await tx.updateTable('user').set({ oauthId: null }).execute();

      return sessions.map((session) => session.id);
    });
  }

  private async detachOwner(tx: Transaction<DB>, userId?: string) {
    const owners = tx
      .selectFrom('user_oauth_identity')
      .select('id')
      .where('role', '=', UserOAuthIdentityRole.Owner)
      .$if(!!userId, (qb) => qb.where('userId', '=', userId!));

    await tx
      .updateTable('session')
      .set({ oauthIdentityId: null, oauthSid: null, oauthBearerToken: null })
      .where('oauthIdentityId', 'in', owners)
      .execute();
    await tx.updateTable('api_key').set({ oauthIdentityId: null }).where('oauthIdentityId', 'in', owners).execute();

    if (userId) {
      await tx.updateTable('user').set({ oauthId: null }).where('id', '=', userId).execute();
    }
  }

  // a Google account on a soft-deleted user can be linked again, as it could before accounts had their own table
  private async removeStale(tx: Transaction<DB>, sub: string) {
    const stale = await tx
      .deleteFrom('user_oauth_identity')
      .using('user')
      .whereRef('user.id', '=', 'user_oauth_identity.userId')
      .where('user.deletedAt', 'is not', null)
      .where('user_oauth_identity.sub', '=', sub)
      .returning(['user_oauth_identity.userId', 'user_oauth_identity.role'])
      .executeTakeFirst();

    if (stale?.role === UserOAuthIdentityRole.Owner) {
      await tx.updateTable('user').set({ oauthId: null }).where('id', '=', stale.userId).execute();
    }
  }
}
