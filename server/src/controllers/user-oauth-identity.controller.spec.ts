import request from 'supertest';
import {
  UserOAuthIdentityAdminController,
  UserOAuthIdentityController,
} from 'src/controllers/user-oauth-identity.controller.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { UserOAuthIdentityService } from 'src/services/user-oauth-identity.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, automock, controllerSetup, mockBaseService } from 'test/utils.js';

describe(UserOAuthIdentityController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(UserOAuthIdentityService);

  beforeAll(async () => {
    ctx = await controllerSetup(UserOAuthIdentityController, [
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
      { provide: UserOAuthIdentityService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /users/me/oauth-identities', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/users/me/oauth-identities');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('POST /users/me/oauth-identities', () => {
    it('should require a valid email', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/users/me/oauth-identities')
        .send({ email: 'not-an-email' });

      expect(status).toBe(400);
      expect(service.inviteMine).not.toHaveBeenCalled();
    });

    it('should normalize the email', async () => {
      await request(ctx.getHttpServer()).post('/users/me/oauth-identities').send({ email: 'Someone@Gmail.com' });

      expect(service.inviteMine).toHaveBeenCalledWith(undefined, { email: 'someone@gmail.com' });
    });
  });

  describe('DELETE /users/me/oauth-identities/:id', () => {
    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer()).delete('/users/me/oauth-identities/invalid');

      expect(status).toBe(400);
      expect(service.removeMine).not.toHaveBeenCalled();
    });

    it('should respond with no content', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).delete(`/users/me/oauth-identities/${id}`);

      expect(status).toBe(204);
      expect(service.removeMine).toHaveBeenCalledWith(undefined, id);
    });
  });
});

describe(UserOAuthIdentityAdminController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(UserOAuthIdentityService);

  beforeAll(async () => {
    ctx = await controllerSetup(UserOAuthIdentityAdminController, [
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
      { provide: UserOAuthIdentityService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('should require both ids to be UUIDs', async () => {
    const { status } = await request(ctx.getHttpServer()).delete(
      `/admin/users/${factory.uuid()}/oauth-identities/invalid`,
    );

    expect(status).toBe(400);
    expect(service.removeForUser).not.toHaveBeenCalled();
  });

  it('should route to the given user and account', async () => {
    const id = factory.uuid();
    const identityId = factory.uuid();

    await request(ctx.getHttpServer()).put(`/admin/users/${id}/oauth-identities/${identityId}/owner`);

    expect(service.transferForUser).toHaveBeenCalledWith(undefined, id, identityId);
  });
});
