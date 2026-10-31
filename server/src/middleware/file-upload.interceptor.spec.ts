import { HttpException } from '@nestjs/common';
import express from 'express';
import { Writable } from 'node:stream';
import { of } from 'rxjs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_IMAGE_MAX_SIZE } from 'src/constants.js';
import { UploadFieldName } from 'src/dtos/asset-media.dto.js';
import { RouteKey } from 'src/enum.js';
import { FileUploadInterceptor } from 'src/middleware/file-upload.interceptor.js';

describe(FileUploadInterceptor.name, () => {
  const storage = {
    createWriteStream: vi.fn(),
    unlink: vi.fn(),
  };

  const createApp = (route: RouteKey, fieldName: UploadFieldName) => {
    const interceptor = new FileUploadInterceptor(
      { get: () => route } as never,
      {
        canUploadFile: () => true,
        getUploadFolder: () => '/upload',
        getUploadFilename: () => 'file.jpg',
        onUploadError: vi.fn(),
      } as never,
      storage as never,
      { setContext: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
    );

    const app = express();
    app.post('/', async (req, res) => {
      const context = {
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      };

      try {
        await interceptor.intercept(context as never, { handle: () => of(null) });
        res.status(201).send();
      } catch (error) {
        res.status((error as HttpException).getStatus()).send();
      }
    });

    return { app, fieldName };
  };

  const upload = ({ app, fieldName }: ReturnType<typeof createApp>, size: number) =>
    request(app).post('/').attach(fieldName, Buffer.alloc(size), 'file.jpg');

  beforeEach(() => {
    vi.resetAllMocks();
    storage.createWriteStream.mockImplementation(
      () => new Writable({ write: (_chunk, _encoding, callback) => callback() }),
    );
    storage.unlink.mockResolvedValue(void 0);
  });

  it('should accept a profile image at the size limit', async () => {
    const { status } = await upload(createApp(RouteKey.User, UploadFieldName.PROFILE_DATA), PROFILE_IMAGE_MAX_SIZE);

    expect(status).toBe(201);
    expect(storage.unlink).not.toHaveBeenCalled();
  });

  it('should reject a profile image over the size limit and remove the partial file', async () => {
    const { status } = await upload(createApp(RouteKey.User, UploadFieldName.PROFILE_DATA), PROFILE_IMAGE_MAX_SIZE + 1);

    expect(status).toBe(413);
    expect(storage.unlink).toHaveBeenCalledWith(expect.stringContaining('file.jpg'));
  });

  it('should not limit the size of an asset upload', async () => {
    const { status } = await upload(createApp(RouteKey.Asset, UploadFieldName.ASSET_DATA), PROFILE_IMAGE_MAX_SIZE + 1);

    expect(status).toBe(201);
  });
});
