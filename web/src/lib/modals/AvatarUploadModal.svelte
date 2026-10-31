<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import {
    clampCropCenter,
    cropAvatar,
    getCropRegion,
    getCropSize,
    type CropCenter,
    type ImageSize,
  } from '$lib/utils/avatar-crop';
  import { handleError } from '$lib/utils/handle-error';
  import { createProfileImage } from '@immich/sdk';
  import { FormModal, toastManager } from '@immich/ui';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    file: File;
    onClose: () => void;
  }

  let { file, onClose }: Props = $props();

  const VIEWPORT_SIZE = 250;
  const MAX_ZOOM = 4;

  const source = URL.createObjectURL(file);
  onDestroy(() => URL.revokeObjectURL(source));

  let image: HTMLImageElement | undefined = $state();
  let imageSize: ImageSize = $state({ width: 0, height: 0 });
  let center: CropCenter = $state({ x: 0, y: 0 });
  let zoom = $state(1);
  let lastPointer: { x: number; y: number } | undefined;

  const isLoaded = $derived(imageSize.width > 0 && imageSize.height > 0);
  const scale = $derived(isLoaded ? VIEWPORT_SIZE / getCropSize(imageSize, zoom) : 1);
  const region = $derived(getCropRegion(imageSize, zoom, center));

  const onImageLoad = () => {
    if (!image) {
      return;
    }

    imageSize = { width: image.naturalWidth, height: image.naturalHeight };
    center = { x: imageSize.width / 2, y: imageSize.height / 2 };
  };

  const onImageError = () => {
    toastManager.danger($t('errors.unable_to_read_image'));
    onClose();
  };

  const onPointerDown = (event: PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    lastPointer = { x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!lastPointer) {
      return;
    }

    const { x, y } = clampCropCenter(imageSize, zoom, center);
    center = clampCropCenter(imageSize, zoom, {
      x: x - (event.clientX - lastPointer.x) / scale,
      y: y - (event.clientY - lastPointer.y) / scale,
    });
    lastPointer = { x: event.clientX, y: event.clientY };
  };

  const onPointerEnd = () => {
    lastPointer = undefined;
  };

  const onSubmit = async () => {
    if (!image || !isLoaded) {
      return;
    }

    try {
      const cropped = await cropAvatar(image, region);
      await createProfileImage({ createProfileImageDto: { file: cropped } });
      toastManager.primary($t('profile_picture_set'));

      await authManager.refresh();

      onClose();
    } catch (error) {
      handleError(error, $t('errors.unable_to_set_profile_picture'));
    }
  };
</script>

<FormModal size="small" title={$t('set_profile_picture')} disabled={!isLoaded} {onClose} {onSubmit}>
  <div class="flex flex-col items-center gap-6">
    <div
      data-testid="avatar-crop-area"
      role="presentation"
      class="relative mt-1 cursor-grab touch-none overflow-hidden rounded-full bg-immich-dark-primary ring-4 ring-immich-primary select-none active:cursor-grabbing dark:bg-immich-primary dark:ring-immich-dark-primary"
      style:width="{VIEWPORT_SIZE}px"
      style:height="{VIEWPORT_SIZE}px"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerEnd}
      onpointercancel={onPointerEnd}
    >
      <img
        bind:this={image}
        src={source}
        alt={$t('profile_image_of_user', { values: { user: authManager.user.name } })}
        class="absolute max-w-none"
        class:invisible={!isLoaded}
        style:left="{-region.x * scale}px"
        style:top="{-region.y * scale}px"
        style:width="{imageSize.width * scale}px"
        style:height="{imageSize.height * scale}px"
        draggable="false"
        onload={onImageLoad}
        onerror={onImageError}
      />
    </div>
    <input
      type="range"
      min="1"
      max={MAX_ZOOM}
      step="0.01"
      bind:value={zoom}
      disabled={!isLoaded}
      aria-label={$t('zoom_image')}
      class="w-full"
    />
  </div>
</FormModal>
