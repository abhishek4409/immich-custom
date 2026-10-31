import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserOAuthIdentityRole, UserOAuthIdentityStatus } from 'src/enum.js';
import { UserOAuthIdentityService } from 'src/services/user-oauth-identity.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { UserOAuthIdentityFactory } from 'test/factories/user-oauth-identity.factory.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { systemConfigStub } from 'test/fixtures/system-config.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const email = 'someone@immich.cloud';
const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

const owner = () => AuthFactory.from().session({ oauthRole: UserOAuthIdentityRole.Owner }).build();
const member = (oauthIdentityId = newUuid()) =>
  AuthFactory.from().session({ oauthIdentityId, oauthRole: UserOAuthIdentityRole.Member }).build();
const memberIdentity = (userId: string, id = newUuid()) =>
  UserOAuthIdentityFactory.create({ id, userId, role: UserOAuthIdentityRole.Member });

describe(UserOAuthIdentityService.name, () => {
  let sut: UserOAuthIdentityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(UserOAuthIdentityService));

    mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthAccountSharing);
    mocks.userOAuthIdentity.getByUserId.mockResolvedValue([]);
    mocks.userOAuthIdentity.remove.mockResolvedValue([]);
  });

  describe('getMine', () => {
    it('should require a session', async () => {
      const auth = AuthFactory.from().apiKey().build();
      await expect(sut.getMine(auth)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should tell a member they cannot manage', async () => {
      const identityId = newUuid();
      const auth = member(identityId);

      await expect(sut.getMine(auth)).resolves.toEqual(
        expect.objectContaining({ canManage: false, sharingEnabled: true, currentIdentityId: identityId }),
      );
    });

    it('should report the status of each account', async () => {
      const auth = owner();
      const { id: userId } = auth.user;

      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([
        UserOAuthIdentityFactory.create({ userId }),
        UserOAuthIdentityFactory.create({ userId, sub: null, inviteExpiresAt: future() }),
        UserOAuthIdentityFactory.create({ userId, sub: null, inviteExpiresAt: past() }),
      ]);

      const { identities, canManage } = await sut.getMine(auth);

      expect(canManage).toBe(true);
      expect(identities.map(({ status }) => status)).toEqual([
        UserOAuthIdentityStatus.Active,
        UserOAuthIdentityStatus.Pending,
        UserOAuthIdentityStatus.Expired,
      ]);
    });
  });

  describe('inviteMine', () => {
    it('should not let a member invite', async () => {
      await expect(sut.inviteMine(member(), { email })).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.userOAuthIdentity.createInvite).not.toHaveBeenCalled();
    });

    it('should not let an API key invite', async () => {
      const auth = AuthFactory.from().apiKey().build();
      await expect(sut.inviteMine(auth, { email })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should require sharing to be enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      await expect(sut.inviteMine(owner(), { email })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.userOAuthIdentity.createInvite).not.toHaveBeenCalled();
    });

    it('should create an invite that expires in 7 days', async () => {
      const auth = owner();
      const identity = UserOAuthIdentityFactory.create({ sub: null, inviteExpiresAt: future() });

      mocks.userOAuthIdentity.createInvite.mockResolvedValue(identity);

      await sut.inviteMine(auth, { email });

      const { inviteExpiresAt, ...dto } = mocks.userOAuthIdentity.createInvite.mock.calls[0][0];
      expect(dto).toEqual({ userId: auth.user.id, email });
      const days = (inviteExpiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
    });

    it('should not invite an account that is already linked', async () => {
      const auth = owner();

      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([
        UserOAuthIdentityFactory.create({ userId: auth.user.id, email }),
      ]);

      await expect(sut.inviteMine(auth, { email })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should renew an invite on the same account', async () => {
      const auth = owner();
      const existing = UserOAuthIdentityFactory.create({ userId: auth.user.id, email, sub: null });

      mocks.userOAuthIdentity.getInviteByEmail.mockResolvedValue({ ...existing, userDeletedAt: null });
      mocks.userOAuthIdentity.update.mockResolvedValue(existing);

      await sut.inviteMine(auth, { email });

      expect(mocks.userOAuthIdentity.update).toHaveBeenCalledWith(existing.id, {
        inviteExpiresAt: expect.any(Date),
      });
      expect(mocks.userOAuthIdentity.createInvite).not.toHaveBeenCalled();
    });

    it('should reject an email with an open invite on another account', async () => {
      const existing = UserOAuthIdentityFactory.create({ email, sub: null, inviteExpiresAt: future() });

      mocks.userOAuthIdentity.getInviteByEmail.mockResolvedValue({ ...existing, userDeletedAt: null });

      await expect(sut.inviteMine(owner(), { email })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.userOAuthIdentity.createInvite).not.toHaveBeenCalled();
    });

    it('should replace an expired invite on another account', async () => {
      const existing = UserOAuthIdentityFactory.create({ email, sub: null, inviteExpiresAt: past() });

      mocks.userOAuthIdentity.getInviteByEmail.mockResolvedValue({ ...existing, userDeletedAt: null });
      mocks.userOAuthIdentity.createInvite.mockResolvedValue(existing);

      await sut.inviteMine(owner(), { email });

      expect(mocks.userOAuthIdentity.remove).toHaveBeenCalledWith(existing.id);
      expect(mocks.userOAuthIdentity.createInvite).toHaveBeenCalled();
    });

    it('should replace an open invite on a deleted user', async () => {
      const existing = UserOAuthIdentityFactory.create({ email, sub: null, inviteExpiresAt: future() });

      mocks.userOAuthIdentity.getInviteByEmail.mockResolvedValue({ ...existing, userDeletedAt: new Date() });
      mocks.userOAuthIdentity.createInvite.mockResolvedValue(existing);

      await sut.inviteMine(owner(), { email });

      expect(mocks.userOAuthIdentity.remove).toHaveBeenCalledWith(existing.id);
    });
  });

  describe('removeMine', () => {
    it('should remove a member and end their sessions', async () => {
      const auth = owner();
      const identity = memberIdentity(auth.user.id);

      mocks.userOAuthIdentity.get.mockResolvedValue(identity);
      mocks.userOAuthIdentity.remove.mockResolvedValue(['session-1', 'session-2']);

      await sut.removeMine(auth, identity.id);

      expect(mocks.userOAuthIdentity.remove).toHaveBeenCalledWith(identity.id);
      expect(mocks.event.emit).toHaveBeenCalledWith('SessionDelete', { sessionId: 'session-1' });
      expect(mocks.event.emit).toHaveBeenCalledWith('SessionDelete', { sessionId: 'session-2' });
    });

    it('should let a member remove themselves', async () => {
      const id = newUuid();
      const auth = member(id);

      mocks.userOAuthIdentity.get.mockResolvedValue(memberIdentity(auth.user.id, id));

      await sut.removeMine(auth, id);

      expect(mocks.userOAuthIdentity.remove).toHaveBeenCalledWith(id);
    });

    it('should not let a member remove someone else', async () => {
      const auth = member();

      await expect(sut.removeMine(auth, newUuid())).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });

    it('should not remove an account linked to another user', async () => {
      const identity = memberIdentity(newUuid());

      mocks.userOAuthIdentity.get.mockResolvedValue(identity);

      await expect(sut.removeMine(owner(), identity.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });

    it('should not remove the owner while there are other accounts', async () => {
      const auth = owner();
      const identity = UserOAuthIdentityFactory.create({ userId: auth.user.id });

      mocks.user.getForPinCode.mockResolvedValue({ pinCode: null, password: 'hash' });
      mocks.userOAuthIdentity.get.mockResolvedValue(identity);
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([identity, memberIdentity(auth.user.id)]);

      await expect(sut.removeMine(auth, identity.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });

    it('should not remove the only way to log in', async () => {
      const auth = owner();
      const identity = UserOAuthIdentityFactory.create({ userId: auth.user.id });

      mocks.user.getForPinCode.mockResolvedValue({ pinCode: null, password: null });
      mocks.userOAuthIdentity.get.mockResolvedValue(identity);
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([identity]);

      await expect(sut.removeMine(auth, identity.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });
  });

  describe('transferMine', () => {
    it('should not let a member promote', async () => {
      await expect(sut.transferMine(member(), newUuid())).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.userOAuthIdentity.transferOwner).not.toHaveBeenCalled();
    });

    it('should not promote a pending invite', async () => {
      const auth = owner();
      const identity = UserOAuthIdentityFactory.create({ userId: auth.user.id, sub: null });

      mocks.userOAuthIdentity.get.mockResolvedValue(identity);

      await expect(sut.transferMine(auth, identity.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should promote an accepted account', async () => {
      const auth = owner();
      const identity = memberIdentity(auth.user.id);

      mocks.userOAuthIdentity.get.mockResolvedValue(identity);
      mocks.userOAuthIdentity.transferOwner.mockResolvedValue(identity);

      await sut.transferMine(auth, identity.id);

      expect(mocks.userOAuthIdentity.transferOwner).toHaveBeenCalledWith(auth.user.id, identity.id, identity.sub);
    });
  });

  describe('admin', () => {
    it('should list the accounts of a user', async () => {
      const user = UserFactory.create();

      mocks.user.get.mockResolvedValue(user);

      await expect(sut.getForUser(AuthFactory.create({ isAdmin: true }), user.id)).resolves.toEqual(
        expect.objectContaining({ canManage: true, currentIdentityId: null }),
      );
      expect(mocks.userOAuthIdentity.getByUserId).toHaveBeenCalledWith(user.id);
    });

    it('should fail for a user that does not exist', async () => {
      mocks.user.get.mockResolvedValue(void 0);

      await expect(sut.getForUser(AuthFactory.create({ isAdmin: true }), newUuid())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should not let a member of an admin account manage it through the admin routes', async () => {
      const auth = member();

      await expect(sut.removeForUser(auth, auth.user.id, newUuid())).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.userOAuthIdentity.remove).not.toHaveBeenCalled();
    });

    it('should remove the last account of a user without a password', async () => {
      const user = UserFactory.create();
      const identity = UserOAuthIdentityFactory.create({ userId: user.id });

      mocks.user.get.mockResolvedValue(user);
      mocks.userOAuthIdentity.get.mockResolvedValue(identity);
      mocks.userOAuthIdentity.getByUserId.mockResolvedValue([identity]);

      await sut.removeForUser(AuthFactory.create({ isAdmin: true }), user.id, identity.id);

      expect(mocks.userOAuthIdentity.remove).toHaveBeenCalledWith(identity.id);
    });
  });
});
