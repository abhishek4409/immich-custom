import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { HistoryBuilder } from 'src/decorators.js';
import {
  UserOAuthIdentityRole,
  UserOAuthIdentityRoleSchema,
  UserOAuthIdentityStatus,
  UserOAuthIdentityStatusSchema,
} from 'src/enum.js';
import { isoDatetimeToDate, toEmail } from 'src/validation.js';

const history = new HistoryBuilder().added('v3.4.0').alpha('v3.4.0').getExtensions();

const UserOAuthIdentityInviteSchema = z
  .object({ email: toEmail.describe('Email of the OAuth account to invite') })
  .meta({ id: 'UserOAuthIdentityInviteDto' });

const UserOAuthIdentityParamSchema = z.object({
  id: z.uuidv4().describe('User ID'),
  identityId: z.uuidv4().describe('Linked OAuth account ID'),
});

const UserOAuthIdentityResponseSchema = z
  .object({
    id: z.uuidv4().describe('Linked OAuth account ID'),
    role: UserOAuthIdentityRoleSchema,
    status: UserOAuthIdentityStatusSchema,
    email: z.string().describe('Email of the OAuth account'),
    name: z.string().nullable().describe('Name of the OAuth account'),
    inviteExpiresAt: isoDatetimeToDate.nullable().describe('When the invite expires'),
    lastLoginAt: isoDatetimeToDate.nullable().describe('Last login with this OAuth account'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
  })
  .meta({ id: 'UserOAuthIdentityResponseDto', ...history });

const UserOAuthIdentityListResponseSchema = z
  .object({
    canManage: z.boolean().describe('Whether the caller can invite, remove and promote linked accounts'),
    sharingEnabled: z.boolean().describe('Whether more than one OAuth account can be linked to an account'),
    currentIdentityId: z.uuidv4().nullable().describe('The linked account the caller is logged in with'),
    identities: z.array(UserOAuthIdentityResponseSchema).describe('Linked OAuth accounts'),
  })
  .meta({ id: 'UserOAuthIdentityListResponseDto', ...history });

export class UserOAuthIdentityParamDto extends createZodDto(UserOAuthIdentityParamSchema) {}
export class UserOAuthIdentityInviteDto extends createZodDto(UserOAuthIdentityInviteSchema) {}
export class UserOAuthIdentityResponseDto extends createZodDto(UserOAuthIdentityResponseSchema) {}
export class UserOAuthIdentityListResponseDto extends createZodDto(UserOAuthIdentityListResponseSchema) {}

type UserOAuthIdentity = {
  id: string;
  role: UserOAuthIdentityRole;
  sub: string | null;
  email: string;
  name: string | null;
  inviteExpiresAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const getStatus = ({ sub, inviteExpiresAt }: UserOAuthIdentity) => {
  if (sub) {
    return UserOAuthIdentityStatus.Active;
  }

  return inviteExpiresAt && inviteExpiresAt > new Date()
    ? UserOAuthIdentityStatus.Pending
    : UserOAuthIdentityStatus.Expired;
};

export const mapUserOAuthIdentity = (identity: UserOAuthIdentity): UserOAuthIdentityResponseDto => ({
  id: identity.id,
  role: identity.role,
  status: getStatus(identity),
  email: identity.email,
  name: identity.name,
  inviteExpiresAt: identity.inviteExpiresAt,
  lastLoginAt: identity.lastLoginAt,
  createdAt: identity.createdAt,
});
