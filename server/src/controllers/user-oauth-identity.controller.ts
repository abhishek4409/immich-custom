import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  UserOAuthIdentityInviteDto,
  UserOAuthIdentityListResponseDto,
  UserOAuthIdentityParamDto,
  UserOAuthIdentityResponseDto,
} from 'src/dtos/user-oauth-identity.dto.js';
import { ApiTag, Permission, RouteKey } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { UserOAuthIdentityService } from 'src/services/user-oauth-identity.service.js';
import { UUIDParamDto } from 'src/validation.js';

const history = new HistoryBuilder().added('v3.4.0').alpha('v3.4.0');

@ApiTags(ApiTag.Users)
@Controller(RouteKey.User)
export class UserOAuthIdentityController {
  constructor(private service: UserOAuthIdentityService) {}

  @Get('me/oauth-identities')
  @Authenticated()
  @Endpoint({
    summary: 'Retrieve linked OAuth accounts',
    description: 'Retrieve the OAuth accounts and open invites of the current user. Requires a session token.',
    history,
  })
  getMyOAuthIdentities(@Auth() auth: AuthDto): Promise<UserOAuthIdentityListResponseDto> {
    return this.service.getMine(auth);
  }

  @Post('me/oauth-identities')
  @Authenticated()
  @Endpoint({
    summary: 'Invite an OAuth account',
    description:
      'Allow an OAuth account to log in to the current user, or renew its invite. Requires a session token that is not logged in as a member.',
    history,
  })
  inviteMyOAuthIdentity(
    @Auth() auth: AuthDto,
    @Body() dto: UserOAuthIdentityInviteDto,
  ): Promise<UserOAuthIdentityResponseDto> {
    return this.service.inviteMine(auth, dto);
  }

  @Delete('me/oauth-identities/:id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove a linked OAuth account',
    description:
      'Remove a linked OAuth account or invite, and end its sessions and API keys. Members can only remove themselves.',
    history,
  })
  removeMyOAuthIdentity(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.removeMine(auth, id);
  }

  @Put('me/oauth-identities/:id/owner')
  @Authenticated()
  @Endpoint({
    summary: 'Change the owner OAuth account',
    description: 'Make a linked OAuth account the owner of the current user. The previous owner becomes a member.',
    history,
  })
  transferMyOAuthIdentity(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<UserOAuthIdentityResponseDto> {
    return this.service.transferMine(auth, id);
  }
}

@ApiTags(ApiTag.UsersAdmin)
@Controller('admin/users')
export class UserOAuthIdentityAdminController {
  constructor(private service: UserOAuthIdentityService) {}

  @Get(':id/oauth-identities')
  @Authenticated({ permission: Permission.AdminUserRead, admin: true })
  @Endpoint({
    summary: 'Retrieve linked OAuth accounts of a user',
    description: 'Retrieve the OAuth accounts and open invites of a specific user.',
    history,
  })
  getUserOAuthIdentitiesAdmin(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<UserOAuthIdentityListResponseDto> {
    return this.service.getForUser(auth, id);
  }

  @Post(':id/oauth-identities')
  @Authenticated({ permission: Permission.AdminUserUpdate, admin: true })
  @Endpoint({
    summary: 'Invite an OAuth account to a user',
    description: 'Allow an OAuth account to log in to a specific user, or renew its invite.',
    history,
  })
  inviteUserOAuthIdentityAdmin(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: UserOAuthIdentityInviteDto,
  ): Promise<UserOAuthIdentityResponseDto> {
    return this.service.inviteForUser(auth, id, dto);
  }

  @Delete(':id/oauth-identities/:identityId')
  @Authenticated({ permission: Permission.AdminUserUpdate, admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove a linked OAuth account from a user',
    description: 'Remove a linked OAuth account or invite from a specific user, and end its sessions and API keys.',
    history,
  })
  removeUserOAuthIdentityAdmin(
    @Auth() auth: AuthDto,
    @Param() { id, identityId }: UserOAuthIdentityParamDto,
  ): Promise<void> {
    return this.service.removeForUser(auth, id, identityId);
  }

  @Put(':id/oauth-identities/:identityId/owner')
  @Authenticated({ permission: Permission.AdminUserUpdate, admin: true })
  @Endpoint({
    summary: 'Change the owner OAuth account of a user',
    description: 'Make a linked OAuth account the owner of a specific user. The previous owner becomes a member.',
    history,
  })
  transferUserOAuthIdentityAdmin(
    @Auth() auth: AuthDto,
    @Param() { id, identityId }: UserOAuthIdentityParamDto,
  ): Promise<UserOAuthIdentityResponseDto> {
    return this.service.transferForUser(auth, id, identityId);
  }
}
