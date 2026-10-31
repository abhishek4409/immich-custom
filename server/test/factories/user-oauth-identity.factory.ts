import { UserOAuthIdentityRole } from 'src/enum.js';
import { newDate, newUuid } from 'test/small.factory.js';

export class UserOAuthIdentityFactory {
  static create(dto: Partial<ReturnType<typeof UserOAuthIdentityFactory.defaults>> = {}) {
    return { ...UserOAuthIdentityFactory.defaults(), ...dto };
  }

  private static defaults() {
    return {
      id: newUuid(),
      userId: newUuid(),
      role: UserOAuthIdentityRole.Owner,
      sub: newUuid() as string | null,
      email: 'someone@immich.cloud',
      name: null as string | null,
      inviteExpiresAt: null as Date | null,
      lastLoginAt: null as Date | null,
      createdAt: newDate(),
      updatedAt: newDate(),
    };
  }
}
