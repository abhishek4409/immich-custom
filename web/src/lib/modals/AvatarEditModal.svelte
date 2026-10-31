<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import AvatarUploadModal from '$lib/modals/AvatarUploadModal.svelte';
  import { deleteProfileImage, updateMyUser, UserAvatarColor } from '@immich/sdk';
  import { Button, Modal, modalManager, ModalBody, toastManager } from '@immich/ui';
  import { mdiDeleteOutline, mdiUpload } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const colors: UserAvatarColor[] = Object.values(UserAvatarColor);

  let fileInput: HTMLInputElement | undefined = $state();

  // someone else sharing this user may have already removed it, which the server rejects
  const removeProfileImage = async () => {
    await authManager.refresh();
    if (authManager.user.profileImagePath !== '') {
      await deleteProfileImage();
    }
  };

  const onSave = async (color: UserAvatarColor) => {
    try {
      await removeProfileImage();

      const response = await updateMyUser({ userUpdateMeDto: { avatarColor: color } });
      authManager.setUser(response);
      toastManager.primary($t('saved_profile'));
      onClose();
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_profile'));
    }
  };

  const onRemove = async () => {
    try {
      await removeProfileImage();
      await authManager.refresh();
      toastManager.primary($t('saved_profile'));
      onClose();
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_profile'));
    }
  };

  const onFileSelected = async () => {
    const file = fileInput?.files?.[0];
    if (!file) {
      return;
    }

    onClose();
    await modalManager.show(AvatarUploadModal, { file });
  };
</script>

<Modal title={$t('edit_avatar')} size="small" {onClose}>
  <ModalBody>
    <div class="flex flex-col items-center gap-3">
      <UserAvatar user={authManager.user} size="xxl" />
      <div class="flex flex-wrap justify-center gap-2">
        <Button size="small" shape="round" leadingIcon={mdiUpload} onclick={() => fileInput?.click()}>
          {$t('upload_photo')}
        </Button>
        {#if authManager.user.profileImagePath !== ''}
          <Button size="small" shape="round" color="secondary" leadingIcon={mdiDeleteOutline} onclick={onRemove}>
            {$t('remove_photo')}
          </Button>
        {/if}
      </div>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        data-testid="avatar-file-input"
        onchange={onFileSelected}
      />
    </div>

    <p class="mt-6 mb-3 text-sm font-medium">{$t('select_avatar_color')}</p>
    <div class="grid grid-cols-2 place-items-center gap-4 sm:grid-cols-5">
      {#each colors as color (color)}
        <button type="button" onclick={() => onSave(color)}>
          <UserAvatar
            label={color}
            user={{ ...authManager.user, profileImagePath: '', avatarColor: color }}
            size="xl"
          />
        </button>
      {/each}
    </div>
  </ModalBody>
</Modal>
