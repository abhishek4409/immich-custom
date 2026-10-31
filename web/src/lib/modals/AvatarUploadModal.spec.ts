import { createProfileImage } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { cropAvatar } from '$lib/utils/avatar-crop';
import { userAdminFactory } from '@test-data/factories/user-factory';
import AvatarUploadModal from './AvatarUploadModal.svelte';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  createProfileImage: vi.fn(),
}));

vi.mock('$lib/utils/avatar-crop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/avatar-crop')>()),
  cropAvatar: vi.fn(),
}));

describe('AvatarUploadModal component', () => {
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  const onClose = vi.fn();

  const getImage = () => screen.getByAltText('profile_image_of_user') as HTMLImageElement;

  const loadImage = async (naturalWidth: number, naturalHeight: number) => {
    const image = getImage();
    Object.defineProperties(image, { naturalWidth: { value: naturalWidth }, naturalHeight: { value: naturalHeight } });
    await fireEvent.load(image);
    return image;
  };

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:photo');
    URL.revokeObjectURL = vi.fn();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    authManager.setUser(userAdminFactory.build());
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  test('centers the image and fits its shortest side in the crop area', async () => {
    render(AvatarUploadModal, { props: { file, onClose } });

    const image = await loadImage(1000, 500);

    expect(image.style.width).toBe('500px');
    expect(image.style.height).toBe('250px');
    expect(image.style.left).toBe('-125px');
    expect(image.style.top).toBe('0px');
  });

  test('moves the image when dragged, but not past its edge', async () => {
    render(AvatarUploadModal, { props: { file, onClose } });

    const image = await loadImage(1000, 500);
    const area = screen.getByTestId('avatar-crop-area');

    await fireEvent.pointerDown(area, { pointerId: 1, clientX: 100, clientY: 100 });
    await fireEvent.pointerMove(area, { pointerId: 1, clientX: 50, clientY: 100 });
    expect(image.style.left).toBe('-175px');

    await fireEvent.pointerMove(area, { pointerId: 1, clientX: -500, clientY: 100 });
    expect(image.style.left).toBe('-250px');

    await fireEvent.pointerUp(area, { pointerId: 1 });
    await fireEvent.pointerMove(area, { pointerId: 1, clientX: 500, clientY: 100 });
    expect(image.style.left).toBe('-250px');
  });

  test('uploads the selected crop and closes', async () => {
    const cropped = new File(['cropped'], 'profile-picture.jpg', { type: 'image/jpeg' });
    vi.mocked(cropAvatar).mockResolvedValue(cropped);
    vi.mocked(createProfileImage).mockResolvedValue({} as never);
    vi.spyOn(authManager, 'refresh').mockResolvedValue();

    render(AvatarUploadModal, { props: { file, onClose } });

    const image = await loadImage(1000, 500);
    await fireEvent.submit(image.closest('form') as HTMLFormElement);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(cropAvatar).toHaveBeenCalledWith(image, { x: 250, y: 0, size: 500 });
    expect(createProfileImage).toHaveBeenCalledWith({ createProfileImageDto: { file: cropped } });
  });

  test('closes without uploading when the file is not a readable image', async () => {
    render(AvatarUploadModal, { props: { file, onClose } });

    await fireEvent.error(getImage());

    expect(onClose).toHaveBeenCalled();
    expect(createProfileImage).not.toHaveBeenCalled();
  });
});
