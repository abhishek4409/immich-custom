import { clamp } from 'lodash-es';

export type ImageSize = { width: number; height: number };
export type CropCenter = { x: number; y: number };
export type CropRegion = { x: number; y: number; size: number };

const AVATAR_MAX_SIZE = 512;
const AVATAR_QUALITY = 0.92;

/** The side of the square crop, in image pixels. A zoom of 1 fits the shortest side of the image. */
export const getCropSize = ({ width, height }: ImageSize, zoom: number) => Math.min(width, height) / zoom;

export const clampCropCenter = (image: ImageSize, zoom: number, { x, y }: CropCenter): CropCenter => {
  const half = getCropSize(image, zoom) / 2;
  return { x: clamp(x, half, image.width - half), y: clamp(y, half, image.height - half) };
};

export const getCropRegion = (image: ImageSize, zoom: number, center: CropCenter): CropRegion => {
  const size = getCropSize(image, zoom);
  const { x, y } = clampCropCenter(image, zoom, center);
  return { x: x - size / 2, y: y - size / 2, size };
};

export const getAvatarOutputSize = ({ size }: CropRegion) => clamp(Math.round(size), 1, AVATAR_MAX_SIZE);

export const cropAvatar = async (image: HTMLImageElement, region: CropRegion) => {
  const size = getAvatarOutputSize(region);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not get canvas context.');
  }

  // jpeg has no alpha channel, and transparent pixels would otherwise turn black
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size, size);
  context.drawImage(image, region.x, region.y, region.size, region.size, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', AVATAR_QUALITY));
  if (!blob) {
    throw new Error('Could not encode the image.');
  }

  return new File([blob], 'profile-picture.jpg', { type: 'image/jpeg' });
};
