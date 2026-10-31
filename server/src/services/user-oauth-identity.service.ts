import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  UserOAuthIdentityInviteDto,
  UserOAuthIdentityListResponseDto,
  UserOAuthIdentityResponseDto,
  mapUserOAuthIdentity,
} from 'src/dtos/user-oauth-identity.dto.js';
import { UserOAuthIdentityRole } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { isOAuthMember } from 'src/utils/access.js';
import { findOrFail } from 'src/utils/misc.js';

const INVITE_DAYS = 7;

@Injectable()
export class UserOAuthIdentityService extends BaseService {
  async getMine(auth: AuthDto): Promise<UserOAuthIdentityListResponseDto> {
    this.requireSession(auth);
    return this.getList(auth.user.id, !isOAuthMember(auth), auth.session?.oauthIdentityId ?? null);
  }

  async inviteMine(auth: AuthDto, dto: UserOAuthIdentityInviteDto): Promise<UserOAuthIdentityResponseDto> {
    this.requireOwner(auth);
    return this.invite(auth.user.id, dto);
  }

  async removeMine(auth: AuthDto, id: string): Promise<void> {
    this.requireSession(auth);
    if (isOAuthMember(auth) && auth.session?.oauthIdentityId !== id) {
      throw new ForbiddenException('Only the account owner can remove other linked accounts');
    }

    const identity = await this.getIdentity(auth.user.id, id);
    if (identity.role === UserOAuthIdentityRole.Owner) {
      const { password } = await this.userRepository.getForPinCode(auth.user.id);
      if (!password) {
        throw new BadRequestException('Set a password or make another account the owner before removing this one');
      }
    }

    await this.remove(auth.user.id, id);
  }

  async transferMine(auth: AuthDto, id: string): Promise<UserOAuthIdentityResponseDto> {
    this.requireOwner(auth);
    return this.transfer(auth.user.id, id);
  }

  async getForUser(auth: AuthDto, userId: string): Promise<UserOAuthIdentityListResponseDto> {
    await this.requireAdminTarget(auth, userId);
    return this.getList(userId, true, null);
  }

  async inviteForUser(auth: AuthDto, userId: string, dto: UserOAuthIdentityInviteDto) {
    await this.requireAdminTarget(auth, userId);
    return this.invite(userId, dto);
  }

  async removeForUser(auth: AuthDto, userId: string, id: string): Promise<void> {
    await this.requireAdminTarget(auth, userId);
    await this.remove(userId, id);
  }

  async transferForUser(auth: AuthDto, userId: string, id: string) {
    await this.requireAdminTarget(auth, userId);
    return this.transfer(userId, id);
  }

  private async getList(
    userId: string,
    canManage: boolean,
    currentIdentityId: string | null,
  ): Promise<UserOAuthIdentityListResponseDto> {
    const { oauth } = await this.getConfig({ withCache: false });
    const identities = await this.userOAuthIdentityRepository.getByUserId(userId);

    return {
      canManage,
      sharingEnabled: oauth.allowAccountSharing,
      currentIdentityId,
      identities: identities.map((identity) => mapUserOAuthIdentity(identity)),
    };
  }

  private async invite(userId: string, { email }: UserOAuthIdentityInviteDto) {
    const { oauth } = await this.getConfig({ withCache: false });
    if (!oauth.enabled || !oauth.allowAccountSharing) {
      throw new BadRequestException('OAuth account sharing is not enabled');
    }

    const identities = await this.userOAuthIdentityRepository.getByUserId(userId);
    if (identities.some((identity) => identity.sub && identity.email === email)) {
      throw new BadRequestException('This account is already linked');
    }

    const inviteExpiresAt = DateTime.now().plus({ days: INVITE_DAYS }).toJSDate();
    const existing = await this.userOAuthIdentityRepository.getInviteByEmail(email);
    if (existing?.userId === userId) {
      return mapUserOAuthIdentity(await this.userOAuthIdentityRepository.update(existing.id, { inviteExpiresAt }));
    }

    if (existing) {
      if (!existing.userDeletedAt && existing.inviteExpiresAt && existing.inviteExpiresAt > new Date()) {
        throw new BadRequestException('This email already has an open invite');
      }
      await this.userOAuthIdentityRepository.remove(existing.id);
    }

    const identity = await this.userOAuthIdentityRepository.createInvite({ userId, email, inviteExpiresAt });
    return mapUserOAuthIdentity(identity);
  }

  private async remove(userId: string, id: string) {
    const identity = await this.getIdentity(userId, id);
    if (identity.role === UserOAuthIdentityRole.Owner) {
      const identities = await this.userOAuthIdentityRepository.getByUserId(userId);
      if (identities.length > 1) {
        throw new BadRequestException('Make another account the owner or remove the others before removing the owner');
      }
    }

    const sessionIds = await this.userOAuthIdentityRepository.remove(id);
    for (const sessionId of sessionIds) {
      await this.eventRepository.emit('SessionDelete', { sessionId });
    }
  }

  private async transfer(userId: string, id: string) {
    const identity = await this.getIdentity(userId, id);
    if (!identity.sub) {
      throw new BadRequestException('Only an account that has accepted its invite can become the owner');
    }

    return mapUserOAuthIdentity(await this.userOAuthIdentityRepository.transferOwner(userId, id, identity.sub));
  }

  private async getIdentity(userId: string, id: string) {
    const identity = await findOrFail(() => this.userOAuthIdentityRepository.get(id), 'Linked account');
    if (identity.userId !== userId) {
      throw new BadRequestException('Linked account not found');
    }

    return identity;
  }

  private requireSession(auth: AuthDto) {
    if (!auth.session) {
      throw new BadRequestException('This endpoint can only be used with a session token');
    }
  }

  private requireOwner(auth: AuthDto) {
    this.requireSession(auth);
    if (isOAuthMember(auth)) {
      throw new ForbiddenException('Only the account owner can manage linked accounts');
    }
  }

  private async requireAdminTarget(auth: AuthDto, userId: string) {
    if (auth.user.id === userId && isOAuthMember(auth)) {
      throw new ForbiddenException('Only the account owner can manage linked accounts');
    }

    await findOrFail(() => this.userRepository.get(userId, {}), 'User');
  }
}
