import { deleteProfileImage, getMyPreferences, getMyUser, updateMyUser, UserAvatarColor } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userAdminFactory } from '@test-data/factories/user-factory';
import AvatarEditModal from './AvatarEditModal.svelte';
import AvatarUploadModal from './AvatarUploadModal.svelte';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  deleteProfileImage: vi.fn(),
  getAboutInfo: vi.fn().mockResolvedValue({}),
  getMyPreferences: vi.fn(),
  getMyUser: vi.fn(),
  updateMyUser: vi.fn(),
}));

describe('AvatarEditModal component', () => {
  const onClose = vi.fn();
  const withImage = userAdminFactory.build({ profileImagePath: '/profile/image.webp' });
  const withoutImage = userAdminFactory.build({ profileImagePath: '' });

  const setUser = (user: typeof withImage, serverUser = user) => {
    authManager.setUser(user);
    vi.mocked(getMyUser).mockResolvedValue(serverUser);
    vi.mocked(getMyPreferences).mockResolvedValue({} as never);
  };

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  test('only offers to remove a photo when there is one', () => {
    setUser(withoutImage);
    const { unmount } = render(AvatarEditModal, { props: { onClose } });
    expect(screen.queryByRole('button', { name: /remove_photo/i })).toBeNull();
    unmount();

    setUser(withImage);
    render(AvatarEditModal, { props: { onClose } });
    expect(screen.getByRole('button', { name: /remove_photo/i })).toBeDefined();
  });

  test('removes the photo', async () => {
    setUser(withImage);
    render(AvatarEditModal, { props: { onClose } });

    await fireEvent.click(screen.getByRole('button', { name: /remove_photo/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteProfileImage).toHaveBeenCalled();
  });

  test('does not fail when someone else already removed the photo', async () => {
    setUser(withImage, withoutImage);
    vi.mocked(updateMyUser).mockResolvedValue(withoutImage);
    render(AvatarEditModal, { props: { onClose } });

    await fireEvent.click(screen.getByTitle(UserAvatarColor.Blue));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteProfileImage).not.toHaveBeenCalled();
    expect(updateMyUser).toHaveBeenCalledWith({ userUpdateMeDto: { avatarColor: UserAvatarColor.Blue } });
  });

  test('opens the cropper with the selected file', async () => {
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    setUser(withoutImage);
    render(AvatarEditModal, { props: { onClose } });

    await fireEvent.change(screen.getByTestId('avatar-file-input'), { target: { files: [file] } });

    expect(onClose).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(AvatarUploadModal, { file });
  });
});
