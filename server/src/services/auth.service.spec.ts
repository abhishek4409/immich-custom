import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { UserMetadataItem } from 'src/types.js';
import { SALT_ROUNDS } from 'src/constants.js';
import { UserAdmin } from 'src/database.js';
import { AuthDto, SignUpDto } from 'src/dtos/auth.dto.js';
import { AuthType, Permission, UserOAuthIdentityRole } from 'src/enum.js';
import { AuthService } from 'src/services/auth.service.js';
import { ApiKeyFactory } from 'test/factories/api-key.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { OAuthProfileFactory } from 'test/factories/oauth-profile.factory.js';
import { SessionFactory } from 'test/factories/session.factory.js';
import { UserOAuthIdentityFactory } from 'test/factories/user-oauth-identity.factory.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { sharedLinkStub } from 'test/fixtures/shared-link.stub.js';
import { systemConfigStub } from 'test/fixtures/system-config.stub.js';
import { userStub } from 'test/fixtures/user.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const email = 'test@immich.com';
const loginDetails = {
  isSecure: true,
  clientIp: '127.0.0.1',
  deviceOS: '',
  deviceType: '',
  appVersion: null,
};

const dto = {
  email,
  password: 'password',
};

const invite = () => UserOAuthIdentityFactory.create({ role: UserOAuthIdentityRole.Member, sub: null });

describe(AuthService.name, () => {
  let sut: AuthService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AuthService));

    mocks.oauth.authorize.mockResolvedValue({ url: 'http://test', state: 'state', codeVerifier: 'codeVerifier' });
    mocks.oauth.getLogoutEndpoint.mockResolvedValue('http://end-session-endpoint');
    mocks.userOAuthIdentity.getByUserId.mockResolvedValue([]);
    mocks.userOAuthIdentity.bind.mockImplementation((dto) => Promise.resolve(UserOAuthIdentityFactory.create(dto)));
    mocks.userOAuthIdentity.remove.mockResolvedValue([]);
  });

  const mockLinked = (user: UserAdmin, role = UserOAuthIdentityRole.Owner) => {
    const identity = UserOAuthIdentityFactory.create({ userId: user.id, role, sub: user.oauthId });
    mocks.userOAuthIdentity.getBySub.mockResolvedValue(identity);
    mocks.user.get.mockResolvedValue(user);
    return identity;
  };

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('login', () => {
    it('should throw an error if password login is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.disabled);

      await expect(sut.login(dto, loginDetails)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should check the user exists', async () => {
      mocks.user.getByEmail.mockResolvedValue(void 0);

      await expect(sut.login(dto, loginDetails)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mocks.user.getByEmail).toHaveBeenCalledTimes(1);
    });

    it('should check the user has a password', async () => {
      mocks.user.getByEmail.mockResolvedValue({} as UserAdmin);

      await expect(sut.login(dto, loginDetails)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mocks.user.getByEmail).toHaveBeenCalledTimes(1);
    });

    it('should successfully log the user in', async () => {
      const user = UserFactory.create({ password: 'immich_password' });
      const session = SessionFactory.create();
      mocks.user.getByEmail.mockResolvedValue(user);
      mocks.session.create.mockResolvedValue(session);

      await expect(sut.login(dto, loginDetails)).resolves.toEqual({
        accessToken: 'cmFuZG9tLWJ5dGVz',
        userId: user.id,
        userEmail: user.email,
        name: user.name,
        profileImagePath: user.profileImagePath,
        isAdmin: user.isAdmin,
        isOnboarded: false,
        shouldChangePassword: user.shouldChangePassword,
      });

      expect(mocks.user.getByEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('changePassword', () => {
    it('should change the password', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);
      const dto = { password: 'old-password', newPassword: 'new-password' };

      mocks.user.getForChangePassword.mockResolvedValue({ id: user.id, password: 'hash-password' });
      mocks.user.update.mockResolvedValue(user);

      await sut.changePassword(auth, dto);

      expect(mocks.user.getForChangePassword).toHaveBeenCalledWith(user.id);
      expect(mocks.crypto.compareBcrypt).toHaveBeenCalledWith('old-password', 'hash-password');
      expect(mocks.event.emit).toHaveBeenCalledWith('AuthChangePassword', {
        userId: user.id,
        currentSessionId: auth.session?.id,
        shouldLogoutSessions: undefined,
      });
    });

    it('should clear shouldChangePassword', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);
      const dto = { password: 'old-password', newPassword: 'new-password' };

      mocks.user.getForChangePassword.mockResolvedValue({ id: user.id, password: 'hash-password' });
      mocks.user.update.mockResolvedValue(user);

      await sut.changePassword(auth, dto);

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, {
        password: 'new-password (hashed)',
        shouldChangePassword: false,
      });
    });

    it('should throw when password does not match existing password', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);
      const dto = { password: 'old-password', newPassword: 'new-password' };

      mocks.crypto.compareBcrypt.mockReturnValue(false);

      mocks.user.getForChangePassword.mockResolvedValue({ id: user.id, password: 'hash-password' });

      await expect(sut.changePassword(auth, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should throw when user does not have a password', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);
      const dto = { password: 'old-password', newPassword: 'new-password' };

      mocks.user.getForChangePassword.mockResolvedValue({ id: user.id, password: '' });

      await expect(sut.changePassword(auth, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should change the password and logout other sessions', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);
      const dto = { password: 'old-password', newPassword: 'new-password', invalidateSessions: true };

      mocks.user.getForChangePassword.mockResolvedValue({ id: user.id, password: 'hash-password' });
      mocks.user.update.mockResolvedValue(user);

      await sut.changePassword(auth, dto);

      expect(mocks.user.getForChangePassword).toHaveBeenCalledWith(user.id);
      expect(mocks.crypto.compareBcrypt).toHaveBeenCalledWith('old-password', 'hash-password');
      expect(mocks.event.emit).toHaveBeenCalledWith('AuthChangePassword', {
        userId: user.id,
        invalidateSessions: true,
        currentSessionId: auth.session?.id,
      });
    });
  });

  describe('logout', () => {
    it('should return the end session endpoint', async () => {
      const auth = AuthFactory.create();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);

      await expect(sut.logout(auth, AuthType.OAuth)).resolves.toEqual({
        successful: true,
        redirectUri: 'http://end-session-endpoint/',
      });
    });

    it('should include the id token hint for OAuth sessions', async () => {
      const auth = AuthFactory.from().session().build();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.session.get.mockResolvedValue({
        id: auth.session!.id,
        expiresAt: null,
        oauthBearerToken: 'id-token',
        pinExpiresAt: null,
      });
      mocks.session.delete.mockResolvedValue();

      await expect(sut.logout(auth, AuthType.OAuth)).resolves.toEqual({
        successful: true,
        redirectUri: 'http://end-session-endpoint/?id_token_hint=id-token',
      });
    });

    it('should return the custom end session endpoint if provided', async () => {
      const auth = AuthFactory.create();

      mocks.systemMetadata.get.mockResolvedValue({
        oauth: { enabled: true, endSessionEndpoint: 'http://custom-logout-url' },
      });

      await expect(sut.logout(auth, AuthType.OAuth)).resolves.toEqual({
        successful: true,
        redirectUri: 'http://custom-logout-url/',
      });
    });

    it('should return the auto-discovered end session endpoint if custom endpoint is not provided', async () => {
      const auth = AuthFactory.create();

      mocks.systemMetadata.get.mockResolvedValue({
        oauth: { enabled: true, endSessionEndpoint: '' },
      });

      await expect(sut.logout(auth, AuthType.OAuth)).resolves.toEqual({
        successful: true,
        redirectUri: 'http://end-session-endpoint/',
      });
    });

    it('should return the default redirect', async () => {
      const auth = AuthFactory.create();

      await expect(sut.logout(auth, AuthType.Password)).resolves.toEqual({
        successful: true,
        redirectUri: '/auth/login?autoLaunch=0',
      });
    });

    it('should delete the access token', async () => {
      const auth = { user: { id: '123' }, session: { id: 'token123' } } as AuthDto;
      mocks.session.get.mockResolvedValue({
        id: auth.session!.id,
        expiresAt: null,
        oauthBearerToken: null,
        pinExpiresAt: null,
      });
      mocks.session.delete.mockResolvedValue();

      await expect(sut.logout(auth, AuthType.Password)).resolves.toEqual({
        successful: true,
        redirectUri: '/auth/login?autoLaunch=0',
      });

      expect(mocks.session.delete).toHaveBeenCalledWith('token123');
      expect(mocks.event.emit).toHaveBeenCalledWith('SessionDelete', { sessionId: 'token123' });
    });

    it('should return the default redirect if auth type is OAUTH but oauth is not enabled', async () => {
      const auth = { user: { id: '123' } } as AuthDto;

      await expect(sut.logout(auth, AuthType.OAuth)).resolves.toEqual({
        successful: true,
        redirectUri: '/auth/login?autoLaunch=0',
      });
    });
  });

  describe('backchannelLogout', () => {
    const dto = { logout_token: 'fake-jwt-token' };

    it('should throw a Bad Request Exception if OAuth is not enabled', async () => {
      await expect(sut.backchannelLogout(dto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.backchannelLogout(dto)).rejects.toThrow(
        'Received backchannel logout request but OAuth is not enabled',
      );
    });

    it('should throw a Bad Request Exception if the logout token validation fails', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.validateLogoutToken.mockRejectedValue(new Error('Token validation failed'));

      await expect(sut.backchannelLogout(dto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.backchannelLogout(dto)).rejects.toThrow('Error backchannel logout: token validation failed');
    });

    it('should throw a Bad Request Exception if there are no claims in the logout token', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.validateLogoutToken.mockResolvedValue(null);

      await expect(sut.backchannelLogout(dto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.backchannelLogout(dto)).rejects.toThrow('Invalid logout token: no claims found');
    });

    it('should throw a Bad Request Exception if there is neither the sub nor the sid claim', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.validateLogoutToken.mockResolvedValue({ sub: '', sid: '' });

      await expect(sut.backchannelLogout(dto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.backchannelLogout(dto)).rejects.toThrow(
        'Invalid logout token: it must contain either a sub or a sid claim',
      );
    });

    it('should invalidate the OAuth session(s) if the logout token is valid', async () => {
      const claims = { sub: 'fake-sub', sid: 'fake-sid' };
      const deletedSessionIds: string[] = ['fake-session-1', 'fake-session-2'];

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.validateLogoutToken.mockResolvedValue(claims);
      mocks.session.invalidateOAuth.mockResolvedValue(deletedSessionIds);
      mocks.event.emit.mockResolvedValue(void 0);
      mocks.event.emit.mockResolvedValue(void 0);

      await sut.backchannelLogout(dto);

      expect(mocks.session.invalidateOAuth).toHaveBeenCalledWith({
        oauthSid: claims.sid,
        oauthId: claims.sub,
      });

      expect(mocks.event.emit).toHaveBeenCalledWith('SessionDelete', { sessionId: 'fake-session-1' });
      expect(mocks.event.emit).toHaveBeenCalledWith('SessionDelete', { sessionId: 'fake-session-2' });
    });
  });

  describe('adminSignUp', () => {
    const dto: SignUpDto = { email: 'test@immich.com', password: 'password', name: 'immich admin' };

    it('should sign up the admin', async () => {
      mocks.user.create.mockResolvedValue({
        ...userStub.admin,
        ...dto,
        id: 'admin',
        name: 'immich admin',
        createdAt: new Date('2021-01-01'),
        metadata: [] as UserMetadataItem[],
      } as UserAdmin);

      await expect(sut.adminSignUp(dto)).resolves.toMatchObject({
        avatarColor: expect.any(String),
        id: 'admin',
        createdAt: new Date('2021-01-01'),
        email: 'test@immich.com',
        name: 'immich admin',
      });

      expect(mocks.user.create).toHaveBeenCalled();
    });
  });

  describe('validate - socket connections', () => {
    it('should throw when token is not provided', async () => {
      await expect(
        sut.authenticate({
          headers: {},
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should validate using authorization header', async () => {
      const session = SessionFactory.create();
      const sessionWithToken = {
        id: session.id,
        updatedAt: session.updatedAt,
        user: UserFactory.create(),
        pinExpiresAt: null,
        appVersion: null,
        oauthSid: null,
        oauthIdentityId: null,
        oauthRole: null,
      };

      mocks.session.getByToken.mockResolvedValue(sessionWithToken);

      await expect(
        sut.authenticate({
          headers: { authorization: 'Bearer auth_token' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).resolves.toEqual({
        user: sessionWithToken.user,
        session: {
          id: session.id,
          hasElevatedPermission: false,
          oauthIdentityId: null,
          oauthRole: null,
        },
      });
    });
  });

  describe('validate - shared key', () => {
    it('should not accept a non-existent key', async () => {
      mocks.sharedLink.getByKey.mockResolvedValue(void 0);

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-key': 'key' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: true, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should not accept an expired key', async () => {
      mocks.sharedLink.getByKey.mockResolvedValue(sharedLinkStub.expired as any);

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-key': 'key' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: true, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should not accept a key on a non-shared route', async () => {
      mocks.sharedLink.getByKey.mockResolvedValue(sharedLinkStub.valid as any);

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-key': 'key' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should not accept a key without a user', async () => {
      mocks.sharedLink.getByKey.mockResolvedValue(sharedLinkStub.expired as any);
      mocks.user.get.mockResolvedValue(void 0);

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-key': 'key' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: true, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should accept a base64url key', async () => {
      const user = UserFactory.create();
      const sharedLink = { ...sharedLinkStub.valid, user } as any;

      mocks.sharedLink.getByKey.mockResolvedValue(sharedLink);
      mocks.user.get.mockResolvedValue(user);

      const buffer = sharedLink.key;
      const key = buffer.toString('base64url');

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-key': key },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: true, uri: 'test' },
        }),
      ).resolves.toEqual({ user, sharedLink });

      expect(mocks.sharedLink.getByKey).toHaveBeenCalledWith(buffer);
    });

    it('should accept a hex key', async () => {
      const user = UserFactory.create();
      const sharedLink = { ...sharedLinkStub.valid, user } as any;

      mocks.sharedLink.getByKey.mockResolvedValue(sharedLink);
      mocks.user.get.mockResolvedValue(user);

      const buffer = sharedLink.key;
      const key = buffer.toString('hex');

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-key': key },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: true, uri: 'test' },
        }),
      ).resolves.toEqual({ user, sharedLink });

      expect(mocks.sharedLink.getByKey).toHaveBeenCalledWith(buffer);
    });
  });

  describe('validate - shared link slug', () => {
    it('should not accept a non-existent slug', async () => {
      mocks.sharedLink.getBySlug.mockResolvedValue(void 0);

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-slug': 'slug' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: true, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should accept a valid slug', async () => {
      const user = UserFactory.create();
      const sharedLink = { ...sharedLinkStub.valid, slug: 'slug-123', user } as any;

      mocks.sharedLink.getBySlug.mockResolvedValue(sharedLink);
      mocks.user.get.mockResolvedValue(user);

      await expect(
        sut.authenticate({
          headers: { 'x-immich-share-slug': 'slug-123' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: true, uri: 'test' },
        }),
      ).resolves.toEqual({ user, sharedLink });

      expect(mocks.sharedLink.getBySlug).toHaveBeenCalledWith('slug-123');
    });
  });

  describe('validate - user token', () => {
    it('should throw if no token is found', async () => {
      mocks.session.getByToken.mockResolvedValue(void 0);

      await expect(
        sut.authenticate({
          headers: { 'x-immich-user-token': 'auth_token' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should return an auth dto', async () => {
      const session = SessionFactory.create();
      const sessionWithToken = {
        id: session.id,
        updatedAt: session.updatedAt,
        user: UserFactory.create(),
        pinExpiresAt: null,
        appVersion: null,
        oauthSid: null,
        oauthIdentityId: null,
        oauthRole: null,
      };

      mocks.session.getByToken.mockResolvedValue(sessionWithToken);

      await expect(
        sut.authenticate({
          headers: { cookie: 'immich_access_token=auth_token' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).resolves.toEqual({
        user: sessionWithToken.user,
        session: {
          id: session.id,
          hasElevatedPermission: false,
          oauthIdentityId: null,
          oauthRole: null,
        },
      });
    });

    it('should throw if admin route and not an admin', async () => {
      const session = SessionFactory.create();
      const sessionWithToken = {
        id: session.id,
        updatedAt: session.updatedAt,
        user: UserFactory.create(),
        isPendingSyncReset: false,
        pinExpiresAt: null,
        appVersion: null,
        oauthSid: null,
        oauthIdentityId: null,
        oauthRole: null,
      };

      mocks.session.getByToken.mockResolvedValue(sessionWithToken);

      await expect(
        sut.authenticate({
          headers: { cookie: 'immich_access_token=auth_token' },
          queryParams: {},
          metadata: { adminRoute: true, sharedLinkRoute: false, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should update when access time exceeds an hour', async () => {
      const session = SessionFactory.create({ updatedAt: DateTime.now().minus({ hours: 2 }).toJSDate() });
      const sessionWithToken = {
        id: session.id,
        updatedAt: session.updatedAt,
        user: UserFactory.create(),
        isPendingSyncReset: false,
        pinExpiresAt: null,
        appVersion: null,
        oauthSid: null,
        oauthIdentityId: null,
        oauthRole: null,
      };

      mocks.session.getByToken.mockResolvedValue(sessionWithToken);
      mocks.session.update.mockResolvedValue(session);

      await expect(
        sut.authenticate({
          headers: { cookie: 'immich_access_token=auth_token' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).resolves.toBeDefined();

      expect(mocks.session.update).toHaveBeenCalled();
    });
  });

  describe('validate - api key', () => {
    it('should throw an error if no api key is found', async () => {
      mocks.apiKey.getKey.mockResolvedValue(void 0);

      await expect(
        sut.authenticate({
          headers: { 'x-api-key': 'auth_token' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.apiKey.getKey).toHaveBeenCalledWith(Buffer.from('auth_token (hashed)'));
    });

    it('should throw an error if api key has insufficient permissions', async () => {
      const authUser = UserFactory.create();
      const authApiKey = ApiKeyFactory.create({ permissions: [] });

      mocks.apiKey.getKey.mockResolvedValue({ ...authApiKey, user: authUser, oauthRole: null });

      const result = sut.authenticate({
        headers: { 'x-api-key': 'auth_token' },
        queryParams: {},
        metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test', permission: Permission.AssetRead },
      });

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toThrow('Missing required permission: asset.read');
    });

    it('should default to requiring the all permission when omitted', async () => {
      const authUser = UserFactory.create();
      const authApiKey = ApiKeyFactory.create({ permissions: [Permission.AssetRead] });

      mocks.apiKey.getKey.mockResolvedValue({ ...authApiKey, user: authUser, oauthRole: null });

      const result = sut.authenticate({
        headers: { 'x-api-key': 'auth_token' },
        queryParams: {},
        metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
      });
      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toThrow('Missing required permission: all');
    });

    it('should not require any permission when metadata is set to `false`', async () => {
      const authUser = UserFactory.create();
      const authApiKey = ApiKeyFactory.from({ permissions: [Permission.ActivityRead] })
        .user(authUser)
        .build();

      mocks.apiKey.getKey.mockResolvedValue({ ...authApiKey, oauthRole: null });

      const result = sut.authenticate({
        headers: { 'x-api-key': 'auth_token' },
        queryParams: {},
        metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test', permission: false },
      });
      await expect(result).resolves.toEqual({ user: authUser, apiKey: expect.objectContaining(authApiKey) });
    });

    it('should return an auth dto', async () => {
      const authUser = UserFactory.create();
      const authApiKey = ApiKeyFactory.from({ permissions: [Permission.All] })
        .user(authUser)
        .build();

      mocks.apiKey.getKey.mockResolvedValue({ ...authApiKey, oauthRole: null });

      await expect(
        sut.authenticate({
          headers: { 'x-api-key': 'auth_token' },
          queryParams: {},
          metadata: { adminRoute: false, sharedLinkRoute: false, uri: 'test' },
        }),
      ).resolves.toEqual({ user: authUser, apiKey: expect.objectContaining(authApiKey) });
      expect(mocks.apiKey.getKey).toHaveBeenCalledWith(Buffer.from('auth_token (hashed)'));
    });
  });

  describe('getMobileRedirect', () => {
    it('should pass along the query params', () => {
      expect(sut.getMobileRedirect('https://immich.app?code=123&state=456')).toEqual(
        'app.immich:///oauth-callback?code=123&state=456',
      );
    });

    it('should work if called without query params', () => {
      expect(sut.getMobileRedirect('https://immich.app')).toEqual('app.immich:///oauth-callback?');
    });
  });

  describe('authorize', () => {
    it('should fail if oauth is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ oauth: { enabled: false } });

      await expect(sut.authorize({ redirectUri: 'https://demo.immich.app' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should authorize the user', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithMobileOverride);

      await sut.authorize({ redirectUri: 'https://demo.immich.app' });
    });
  });

  describe('callback', () => {
    it('should throw an error if OAuth is not enabled', async () => {
      await expect(
        sut.callback({ url: '', state: 'xyz789', codeVerifier: 'foo' }, {}, loginDetails),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should not allow auto registering', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });

      await expect(
        sut.callback(
          { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
          {},
          loginDetails,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.user.getByEmail).toHaveBeenCalledTimes(1);
    });

    it('should link an existing user', async () => {
      const user = UserFactory.create();
      const profile = OAuthProfileFactory.create();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mocks.user.getByEmail.mockResolvedValue(user);
      mocks.user.update.mockResolvedValue(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
        {},
        loginDetails,
      );

      expect(mocks.user.getByEmail).toHaveBeenCalledTimes(1);
      expect(mocks.userOAuthIdentity.bind).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, role: UserOAuthIdentityRole.Owner, sub: profile.sub }),
      );
    });

    it('should store the OAuth bearer token on the new session', async () => {
      const user = UserFactory.create();
      const profile = OAuthProfileFactory.create();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile, sid: 'oauth-sid', idToken: 'oauth-bearer-token' });
      mocks.user.getByEmail.mockResolvedValue(user);
      mocks.user.update.mockResolvedValue(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
        {},
        loginDetails,
      );

      expect(mocks.session.create).toHaveBeenCalledWith(
        expect.objectContaining({ oauthSid: 'oauth-sid', oauthBearerToken: 'oauth-bearer-token' }),
      );
    });

    it('should normalize the email from the OAuth profile before linking', async () => {
      const user = UserFactory.create();
      const profile = OAuthProfileFactory.create({ email: '  TEST@IMMICH.CLOUD  ' });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mocks.user.getByEmail.mockResolvedValue(user);
      mocks.user.update.mockResolvedValue(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
        {},
        loginDetails,
      );

      expect(mocks.user.getByEmail).toHaveBeenCalledWith('test@immich.cloud');
      expect(mocks.userOAuthIdentity.bind).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, role: UserOAuthIdentityRole.Owner, sub: profile.sub }),
      );
    });

    it('should not link to a user with a different oauth sub', async () => {
      const user = UserFactory.create({ oauthId: 'existing-sub' });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithAutoRegister);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.user.getByEmail.mockResolvedValueOnce(user);
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([
        UserOAuthIdentityFactory.create({ userId: user.id, sub: 'existing-sub' }),
      ]);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));

      await expect(
        sut.callback(
          { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
          {},
          loginDetails,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mocks.userOAuthIdentity.bind).not.toHaveBeenCalled();
      expect(mocks.user.create).not.toHaveBeenCalled();
    });

    it('should allow auto registering by default', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
        {},
        loginDetails,
      );

      expect(mocks.user.getByEmail).toHaveBeenCalledTimes(2); // second call is for domain check before create
      expect(mocks.user.create).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if user should be auto registered but the email claim does not exist', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.create.mockResolvedValue(UserFactory.create());
      mocks.session.create.mockResolvedValue(SessionFactory.create());
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: { sub: 'sub' } });

      await expect(
        sut.callback(
          { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
          {},
          loginDetails,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.user.getByEmail).not.toHaveBeenCalled();
      expect(mocks.user.create).not.toHaveBeenCalled();
    });

    for (const url of [
      'app.immich:/oauth-callback?code=abc123',
      'app.immich://oauth-callback?code=abc123',
      'app.immich:///oauth-callback?code=abc123',
    ]) {
      it(`should use the mobile redirect override for a url of ${url}`, async () => {
        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithMobileOverride);
        mockLinked(UserFactory.create());
        mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
        mocks.session.create.mockResolvedValue(SessionFactory.create());

        await sut.callback({ url, state: 'xyz789', codeVerifier: 'foo' }, {}, loginDetails);

        expect(mocks.oauth.getProfileAndOAuthSid).toHaveBeenCalledWith(
          expect.objectContaining({}),
          'http://mobile-redirect?code=abc123',
          'xyz789',
          'foo',
        );
      });
    }

    it('should use the default quota', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ quotaSizeInBytes: 1_073_741_824 }));
    });

    it('should infer name from given and family names', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ name: undefined, given_name: 'Given', family_name: 'Family' }),
      });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.create.mockResolvedValue(UserFactory.create());
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Given Family' }));
    });

    it('should fallback to email when no username is provided', async () => {
      const profile = OAuthProfileFactory.create({ name: undefined, given_name: undefined, family_name: undefined });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.create.mockResolvedValue(UserFactory.create());
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ name: profile.email }));
    });

    it('should ignore an invalid storage quota', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ immich_quota: 'abc' }),
      });
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ quotaSizeInBytes: 1_073_741_824 }));
    });

    it('should ignore an invalid negative quota', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ immich_quota: -5 }),
      });
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ quotaSizeInBytes: 1_073_741_824 }));
    });

    it('should set unlimited quota for -1', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ immich_quota: -1 }),
      });
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ quotaSizeInBytes: null }));
    });

    it('should set quota for 0 quota', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create({ immich_quota: 0 }) });
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ quotaSizeInBytes: 0 }));
    });

    it('should use a valid storage quota', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create({ immich_quota: 5 }) });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ quotaSizeInBytes: 5_368_709_120 }));
    });

    it('should sync the profile picture', async () => {
      const fileId = newUuid();
      const user = UserFactory.create({ oauthId: 'oauth-id' });
      const profile = OAuthProfileFactory.create({ picture: 'https://auth.immich.cloud/profiles/1.jpg' });
      const pictureBytes = new Uint8Array([1, 2, 3, 4, 5]);

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mockLinked(user);
      mocks.crypto.randomUUID.mockReturnValue(fileId);
      mocks.oauth.getProfilePicture.mockResolvedValue(pictureBytes.buffer);
      mocks.user.update.mockResolvedValue(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, {
        profileImagePath: expect.stringContaining(`/data/profile/${user.id}/${fileId}.webp`),
        profileChangedAt: expect.any(Date),
      });
      expect(mocks.oauth.getProfilePicture).toHaveBeenCalledWith(profile.picture);
      expect(mocks.media.decodeImage).toHaveBeenCalledWith(
        Buffer.from(pictureBytes.buffer, pictureBytes.byteOffset, pictureBytes.byteLength),
        expect.objectContaining({ processInvalidImages: false }),
      );
      expect(mocks.media.generateThumbnail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ format: 'webp', processInvalidImages: false }),
        expect.stringContaining(`/data/profile/${user.id}/${fileId}.webp`),
      );
    });

    it('should not update the user when thumbnail processing fails on the OAuth picture', async () => {
      const user = UserFactory.create({ oauthId: 'oauth-id' });
      const profile = OAuthProfileFactory.create({ picture: 'https://auth.immich.cloud/profiles/1.jpg' });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mockLinked(user);
      mocks.oauth.getProfilePicture.mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5]).buffer);
      mocks.media.generateThumbnail.mockRejectedValue(new Error('not an image'));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await expect(
        sut.callback(
          { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
          {},
          loginDetails,
        ),
      ).resolves.toBeDefined();

      expect(mocks.user.update).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should not sync the profile picture if the user already has one', async () => {
      const oauthId = 'oauth-id';
      const user = UserFactory.create({ oauthId, profileImagePath: 'not-empty' });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({
          sub: oauthId,
          email: user.email,
          picture: 'https://auth.immich.cloud/profiles/1.jpg',
        }),
      });
      mockLinked(user);
      mocks.user.update.mockResolvedValue(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).not.toHaveBeenCalled();
      expect(mocks.oauth.getProfilePicture).not.toHaveBeenCalled();
    });

    it('should only allow "admin" and "user" for the role claim', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithAutoRegister);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ immich_role: 'foo' }),
      });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false }));
    });

    it('should create an admin user if the role claim is set to admin', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithAutoRegister);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ immich_role: 'admin' }),
      });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
    });

    it('should accept a custom role claim', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        oauth: { ...systemConfigStub.oauthWithAutoRegister.oauth, roleClaim: 'my_role' },
      });
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ my_role: 'admin' }),
      });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
    });

    it('should create an admin user if the role claim is an array containing admin', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithAutoRegister);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ immich_role: ['user', 'admin'] }),
      });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(void 0);
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
    });

    it('should create a standard user if the role claim is an array containing only user', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithAutoRegister);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ immich_role: ['user'] }),
      });
      mocks.user.getByEmail.mockResolvedValue(void 0);
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(void 0);
      mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
      mocks.user.create.mockResolvedValue(UserFactory.create({ oauthId: 'oauth-id' }));
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.create).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false }));
    });

    it('should sync the storage quota on subsequent logins when the claim is present', async () => {
      const user = UserFactory.create({ oauthId: 'oauth-id', quotaSizeInBytes: 1_073_741_824 });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: user.oauthId!, immich_quota: 5 }),
      });
      mockLinked(user);
      mocks.user.update.mockResolvedValue({ ...user, quotaSizeInBytes: 5_368_709_120 });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.syncUsage).toHaveBeenCalledWith(user.id);
      expect(mocks.user.update).toHaveBeenCalledWith(user.id, {
        quotaSizeInBytes: 5_368_709_120,
        updatedAt: expect.any(Date),
      });
    });

    it('should sync unlimited quota on subsequent logins when the claim is -1', async () => {
      const user = UserFactory.create({ oauthId: 'oauth-id', quotaSizeInBytes: 1_073_741_824 });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: user.oauthId!, immich_quota: -1 }),
      });
      mockLinked(user);
      mocks.user.update.mockResolvedValue({ ...user, quotaSizeInBytes: null });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.syncUsage).not.toHaveBeenCalled();
      expect(mocks.user.update).toHaveBeenCalledWith(user.id, {
        quotaSizeInBytes: null,
        updatedAt: expect.any(Date),
      });
    });

    it('should not sync the storage label on subsequent logins with the default claim', async () => {
      const user = UserFactory.create({ oauthId: 'oauth-id', storageLabel: 'custom-label' });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithAutoRegister);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: user.oauthId!, preferred_username: 'idp-username' }),
      });
      mockLinked(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).not.toHaveBeenCalled();
      expect(mocks.user.getByStorageLabel).not.toHaveBeenCalled();
    });

    it('should sync the storage label on subsequent logins when a custom claim is configured', async () => {
      const user = UserFactory.create({ oauthId: 'oauth-id', storageLabel: 'custom-label' });

      mocks.systemMetadata.get.mockResolvedValue({
        oauth: { ...systemConfigStub.oauthWithAutoRegister.oauth, storageLabelClaim: 'immich_label' },
      });
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: user.oauthId!, immich_label: 'synced-label' }),
      });
      mockLinked(user);
      mocks.user.getByStorageLabel.mockResolvedValue(void 0);
      mocks.user.update.mockResolvedValue({ ...user, storageLabel: 'synced-label' });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, {
        storageLabel: 'synced-label',
        updatedAt: expect.any(Date),
      });
    });

    it('should sync a storage label with dots on subsequent logins when a custom claim is configured', async () => {
      const user = UserFactory.create({ oauthId: 'oauth-id', storageLabel: 'custom-label' });

      mocks.systemMetadata.get.mockResolvedValue({
        oauth: { ...systemConfigStub.oauthWithAutoRegister.oauth, storageLabelClaim: 'immich_label' },
      });
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: user.oauthId!, immich_label: 'synced.label' }),
      });
      mockLinked(user);
      mocks.user.getByStorageLabel.mockResolvedValue(void 0);
      mocks.user.update.mockResolvedValue({ ...user, storageLabel: 'synced-label' });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, {
        storageLabel: 'synced.label',
        updatedAt: expect.any(Date),
      });
    });

    it('should promote an existing user to admin if the role claim contains admin on login', async () => {
      const oauthId = 'oauth-id';
      const user = UserFactory.create({ isAdmin: false, oauthId });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: oauthId, immich_role: 'admin' }),
      });
      mockLinked(user);
      mocks.user.update.mockResolvedValue({ ...user, isAdmin: true });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, { isAdmin: true });
    });

    it('should demote an existing admin if the role claim only contains user on login', async () => {
      const oauthId = 'oauth-id';
      const user = UserFactory.create({ isAdmin: true, oauthId });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: oauthId, immich_role: ['user'] }),
      });
      mockLinked(user);
      mocks.user.update.mockResolvedValue({ ...user, isAdmin: false });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, { isAdmin: false });
    });

    it('should not change isAdmin for an existing user if the role claim is blank', async () => {
      const oauthId = 'oauth-id';
      const user = UserFactory.create({ isAdmin: true, oauthId });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: oauthId }),
      });
      mockLinked(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).not.toHaveBeenCalled();
    });

    it('should not update claims on subsequent logins when they are absent from the profile', async () => {
      const user = UserFactory.create({ oauthId: 'oauth-id', isAdmin: true, quotaSizeInBytes: 1_073_741_824 });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithStorageQuota);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create({ sub: user.oauthId! }),
      });
      mockLinked(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).not.toHaveBeenCalled();
      expect(mocks.user.syncUsage).not.toHaveBeenCalled();
    });

    it('should log a member in without touching the account', async () => {
      const user = UserFactory.create({ oauthId: 'owner-sub', isAdmin: false, quotaSizeInBytes: null });
      const profile = OAuthProfileFactory.create({
        sub: 'member-sub',
        immich_role: 'admin',
        immich_quota: 5,
        picture: 'https://auth.immich.cloud/profiles/1.jpg',
      });
      const identity = UserOAuthIdentityFactory.create({
        userId: user.id,
        role: UserOAuthIdentityRole.Member,
        sub: 'member-sub',
      });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(identity);
      mocks.user.get.mockResolvedValue(user);
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
        {},
        loginDetails,
      );

      expect(mocks.user.update).not.toHaveBeenCalled();
      expect(mocks.oauth.getProfilePicture).not.toHaveBeenCalled();
      expect(mocks.userOAuthIdentity.update).toHaveBeenCalledWith(
        identity.id,
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
      expect(mocks.session.create).toHaveBeenCalledWith(expect.objectContaining({ oauthIdentityId: identity.id }));
    });

    describe('invites', () => {
      const url = { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' };

      it('should accept an invite', async () => {
        const user = UserFactory.create();
        const open = { ...invite(), userId: user.id };
        const accepted = { ...open, sub: 'member-sub' };
        const profile = OAuthProfileFactory.create({ sub: 'member-sub', email_verified: true });

        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthAccountSharing);
        mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
        mocks.userOAuthIdentity.getOpenInvite.mockResolvedValue(open);
        mocks.userOAuthIdentity.redeemInvite.mockResolvedValue(accepted);
        mocks.user.get.mockResolvedValue(user);
        mocks.session.create.mockResolvedValue(SessionFactory.create());

        await sut.callback(url, {}, loginDetails);

        expect(mocks.userOAuthIdentity.redeemInvite).toHaveBeenCalledWith(open.id, {
          sub: 'member-sub',
          name: expect.anything(),
        });
        expect(mocks.user.create).not.toHaveBeenCalled();
        expect(mocks.session.create).toHaveBeenCalledWith(
          expect.objectContaining({ userId: user.id, oauthIdentityId: accepted.id }),
        );
      });

      it('should not accept an invite with an unverified email', async () => {
        const profile = OAuthProfileFactory.create({ email_verified: false });

        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthAccountSharing);
        mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
        mocks.userOAuthIdentity.getOpenInvite.mockResolvedValue(invite());

        await expect(sut.callback(url, {}, loginDetails)).rejects.toBeInstanceOf(BadRequestException);

        expect(mocks.userOAuthIdentity.getOpenInvite).not.toHaveBeenCalled();
      });

      it('should not accept an invite when sharing is disabled', async () => {
        const profile = OAuthProfileFactory.create({ email_verified: true });

        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
        mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
        mocks.userOAuthIdentity.getOpenInvite.mockResolvedValue(invite());

        await expect(sut.callback(url, {}, loginDetails)).rejects.toBeInstanceOf(BadRequestException);

        expect(mocks.userOAuthIdentity.getOpenInvite).not.toHaveBeenCalled();
      });

      it('should prefer an existing user with that email over an invite', async () => {
        const user = UserFactory.create();
        const profile = OAuthProfileFactory.create({ email_verified: true });

        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthAccountSharing);
        mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
        mocks.user.getByEmail.mockResolvedValue(user);
        mocks.userOAuthIdentity.getOpenInvite.mockResolvedValue(invite());
        mocks.session.create.mockResolvedValue(SessionFactory.create());

        await sut.callback(url, {}, loginDetails);

        expect(mocks.userOAuthIdentity.getOpenInvite).not.toHaveBeenCalled();
        expect(mocks.userOAuthIdentity.bind).toHaveBeenCalledWith(expect.objectContaining({ userId: user.id }));
      });
    });

    it('should re-evaluate the role claim for a user linked by email', async () => {
      const user = UserFactory.create({ isAdmin: false });
      const profile = OAuthProfileFactory.create({ immich_role: 'admin' });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mocks.user.getByEmail.mockResolvedValue(user);
      mocks.user.update.mockResolvedValueOnce({ ...user, oauthId: profile.sub, isAdmin: true });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(
        { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' },
        {},
        loginDetails,
      );

      expect(mocks.userOAuthIdentity.bind).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, role: UserOAuthIdentityRole.Owner, sub: profile.sub }),
      );
      expect(mocks.user.update).toHaveBeenCalledWith(user.id, { isAdmin: true });
    });
  });

  describe('link', () => {
    it('should link an account', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.from(user).apiKey({ permissions: [] }).build();
      const profile = OAuthProfileFactory.create();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mocks.user.get.mockResolvedValue(user);

      await sut.link(
        auth,
        { url: 'http://immich/user-settings?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
      );

      expect(mocks.userOAuthIdentity.bind).toHaveBeenCalledWith(
        expect.objectContaining({ userId: auth.user.id, role: UserOAuthIdentityRole.Owner, sub: profile.sub }),
      );
    });

    it('should link an account and update the session with the oauthSid', async () => {
      const user = UserFactory.create();
      const session = SessionFactory.create();
      const auth = AuthFactory.from(user).session(session).build();
      const identity = UserOAuthIdentityFactory.create({ userId: user.id, sub: 'sub' });

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: { sub: 'sub' },
        sid: session.oauthSid ?? undefined,
        idToken: session.oauthBearerToken ?? undefined,
      });
      mocks.user.get.mockResolvedValue(user);
      mocks.session.update.mockResolvedValue(session);
      mocks.userOAuthIdentity.bind.mockResolvedValue(identity);

      await sut.link(
        auth,
        { url: 'http://immich/user-settings?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
        {},
      );

      expect(mocks.session.update).toHaveBeenCalledWith(session.id, {
        oauthIdentityId: identity.id,
        oauthSid: session.oauthSid,
        oauthBearerToken: session.oauthBearerToken,
      });
    });

    it('should not link an already linked oauth.sub', async () => {
      const authUser = UserFactory.create();
      const authApiKey = ApiKeyFactory.create({ permissions: [] });
      const auth = { user: authUser, apiKey: authApiKey };

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(UserOAuthIdentityFactory.create({ userId: 'other-user' }));

      await expect(
        sut.link(auth, { url: 'http://immich/user-settings?code=abc123', state: 'xyz789', codeVerifier: 'foo' }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.userOAuthIdentity.bind).not.toHaveBeenCalled();
    });

    it('should add a second account as a member and leave the session alone', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.from(user).session().build();
      const profile = OAuthProfileFactory.create();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthAccountSharing);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile });
      mocks.user.get.mockResolvedValue(user);
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([UserOAuthIdentityFactory.create({ userId: user.id })]);

      await sut.link(auth, { url: 'http://immich/user-settings?code=abc', state: 'xyz', codeVerifier: 'foo' }, {});

      expect(mocks.userOAuthIdentity.bind).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, role: UserOAuthIdentityRole.Member, sub: profile.sub }),
      );
      expect(mocks.session.update).not.toHaveBeenCalled();
    });

    it('should not add a second account when sharing is disabled', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.from(user).session().build();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([UserOAuthIdentityFactory.create({ userId: user.id })]);

      await expect(
        sut.link(auth, { url: 'http://immich/user-settings?code=abc', state: 'xyz', codeVerifier: 'foo' }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.userOAuthIdentity.bind).not.toHaveBeenCalled();
    });

    it('should do nothing when the account is already linked to this user', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.from(user).session().build();

      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.enabled);
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.userOAuthIdentity.getBySub.mockResolvedValue(UserOAuthIdentityFactory.create({ userId: user.id }));
      mocks.user.get.mockResolvedValue(user);

      await sut.link(auth, { url: 'http://immich/user-settings?code=abc', state: 'xyz', codeVerifier: 'foo' }, {});

      expect(mocks.userOAuthIdentity.bind).not.toHaveBeenCalled();
    });

    it('should not let a member link an account', async () => {
      const auth = AuthFactory.from().session({ oauthRole: UserOAuthIdentityRole.Member }).build();

      await expect(
        sut.link(auth, { url: 'http://immich/user-settings?code=abc', state: 'xyz', codeVerifier: 'foo' }, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mocks.oauth.getProfileAndOAuthSid).not.toHaveBeenCalled();
    });
  });

  describe('unlink', () => {
    it('should unlink an account', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.from(user).apiKey({ permissions: [] }).build();
      const identity = UserOAuthIdentityFactory.create({ userId: user.id });

      mocks.user.get.mockResolvedValue(user);
      mocks.user.getForPinCode.mockResolvedValue({ pinCode: null, password: 'hash' });
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([identity]);

      await sut.unlink(auth);

      expect(mocks.userOAuthIdentity.remove).toHaveBeenCalledWith(identity.id);
    });

    it('should unlink an account and remove the OAuth data from the session', async () => {
      const user = UserFactory.create();
      const session = SessionFactory.create();
      const auth = AuthFactory.from(user).session(session).build();
      const identity = UserOAuthIdentityFactory.create({ userId: user.id });

      mocks.session.update.mockResolvedValue(session);
      mocks.user.get.mockResolvedValue(user);
      mocks.user.getForPinCode.mockResolvedValue({ pinCode: null, password: 'hash' });
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([identity]);

      await sut.unlink(auth);

      expect(mocks.session.update).toHaveBeenCalledWith(session.id, { oauthSid: null, oauthBearerToken: null });
      expect(mocks.userOAuthIdentity.remove).toHaveBeenCalledWith(identity.id);
    });

    it('should not leave an account without a way to log in', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.from(user).session().build();

      mocks.user.getForPinCode.mockResolvedValue({ pinCode: null, password: null });
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([UserOAuthIdentityFactory.create({ userId: user.id })]);

      await expect(sut.unlink(auth)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });

    it('should not unlink when there is more than one linked account', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.from(user).session().build();

      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([
        UserOAuthIdentityFactory.create({ userId: user.id }),
        UserOAuthIdentityFactory.create({ userId: user.id, role: UserOAuthIdentityRole.Member }),
      ]);

      await expect(sut.unlink(auth)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });

    it('should not let a member unlink', async () => {
      const auth = AuthFactory.from().session({ oauthRole: UserOAuthIdentityRole.Member }).build();

      await expect(sut.unlink(auth)).rejects.toBeInstanceOf(ForbiddenException);

      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });
  });

  describe('changePassword (member)', () => {
    it('should not let a member change the password', async () => {
      const auth = AuthFactory.from().session({ oauthRole: UserOAuthIdentityRole.Member }).build();

      await expect(sut.changePassword(auth, { password: 'old', newPassword: 'new-password' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(mocks.user.update).not.toHaveBeenCalled();
    });
  });

  describe('setupPinCode', () => {
    it('should setup a PIN code', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);
      const dto = { pinCode: '123456' };

      mocks.user.getForPinCode.mockResolvedValue({ pinCode: null, password: '' });
      mocks.user.update.mockResolvedValue(user);

      await sut.setupPinCode(auth, dto);

      expect(mocks.user.getForPinCode).toHaveBeenCalledWith(user.id);
      expect(mocks.crypto.hashBcrypt).toHaveBeenCalledWith('123456', SALT_ROUNDS);
      expect(mocks.user.update).toHaveBeenCalledWith(user.id, { pinCode: expect.any(String) });
    });

    it('should fail if the user already has a PIN code', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);

      mocks.user.getForPinCode.mockResolvedValue({ pinCode: '123456 (hashed)', password: '' });

      await expect(sut.setupPinCode(auth, { pinCode: '123456' })).rejects.toThrow('User already has a PIN code');
    });
  });

  describe('changePinCode', () => {
    it('should change the PIN code', async () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create(user);
      const dto = { pinCode: '123456', newPinCode: '012345' };

      mocks.user.getForPinCode.mockResolvedValue({ pinCode: '123456 (hashed)', password: '' });
      mocks.user.update.mockResolvedValue(user);
      mocks.crypto.compareBcrypt.mockImplementation((a, b) => `${a} (hashed)` === b);

      await sut.changePinCode(auth, dto);

      expect(mocks.crypto.compareBcrypt).toHaveBeenCalledWith('123456', '123456 (hashed)');
      expect(mocks.user.update).toHaveBeenCalledWith(user.id, { pinCode: '012345 (hashed)' });
    });

    it('should fail if the PIN code does not match', async () => {
      const user = UserFactory.create();
      mocks.user.getForPinCode.mockResolvedValue({ pinCode: '123456 (hashed)', password: '' });
      mocks.crypto.compareBcrypt.mockImplementation((a, b) => `${a} (hashed)` === b);

      await expect(
        sut.changePinCode(AuthFactory.create(user), { pinCode: '000000', newPinCode: '012345' }),
      ).rejects.toThrow('Wrong PIN code');
    });
  });

  describe('resetPinCode', () => {
    it('should reset the PIN code', async () => {
      const currentSession = SessionFactory.create();
      const user = UserFactory.create();
      mocks.user.getForPinCode.mockResolvedValue({ pinCode: '123456 (hashed)', password: '' });
      mocks.crypto.compareBcrypt.mockImplementation((a, b) => `${a} (hashed)` === b);
      mocks.session.lockAll.mockResolvedValue(void 0);
      mocks.session.update.mockResolvedValue(currentSession);

      await sut.resetPinCode(AuthFactory.create(user), { pinCode: '123456' });

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, { pinCode: null });
      expect(mocks.session.lockAll).toHaveBeenCalledWith(user.id);
    });

    it('should throw if the PIN code does not match', async () => {
      const user = UserFactory.create();
      mocks.user.getForPinCode.mockResolvedValue({ pinCode: '123456 (hashed)', password: '' });
      mocks.crypto.compareBcrypt.mockImplementation((a, b) => `${a} (hashed)` === b);

      await expect(sut.resetPinCode(AuthFactory.create(user), { pinCode: '000000' })).rejects.toThrow('Wrong PIN code');
    });
  });
});
