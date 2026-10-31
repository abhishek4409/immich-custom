import { describe, expect, it } from 'vitest';
import { clampCropCenter, getAvatarOutputSize, getCropRegion, getCropSize } from '$lib/utils/avatar-crop';

describe('avatar crop', () => {
  const landscape = { width: 4000, height: 2000 };
  const portrait = { width: 1000, height: 3000 };

  describe(getCropSize.name, () => {
    it('should fit the shortest side at no zoom', () => {
      expect(getCropSize(landscape, 1)).toBe(2000);
      expect(getCropSize(portrait, 1)).toBe(1000);
    });

    it('should shrink as the zoom increases', () => {
      expect(getCropSize(landscape, 4)).toBe(500);
    });
  });

  describe(clampCropCenter.name, () => {
    it('should keep a center that is already inside the image', () => {
      expect(clampCropCenter(landscape, 1, { x: 2000, y: 1000 })).toEqual({ x: 2000, y: 1000 });
    });

    it('should stop the crop leaving the image', () => {
      expect(clampCropCenter(landscape, 1, { x: -500, y: -500 })).toEqual({ x: 1000, y: 1000 });
      expect(clampCropCenter(landscape, 1, { x: 9000, y: 9000 })).toEqual({ x: 3000, y: 1000 });
    });

    it('should allow more movement when zoomed in', () => {
      expect(clampCropCenter(landscape, 2, { x: 0, y: 0 })).toEqual({ x: 500, y: 500 });
    });
  });

  describe(getCropRegion.name, () => {
    it('should center the region on the crop center', () => {
      expect(getCropRegion(landscape, 2, { x: 2000, y: 1000 })).toEqual({ x: 1500, y: 500, size: 1000 });
    });

    it('should clamp the region to the image', () => {
      expect(getCropRegion(portrait, 1, { x: 500, y: 9000 })).toEqual({ x: 0, y: 2000, size: 1000 });
    });
  });

  describe(getAvatarOutputSize.name, () => {
    it('should shrink large regions', () => {
      expect(getAvatarOutputSize({ x: 0, y: 0, size: 2000 })).toBe(512);
    });

    it('should not enlarge small regions', () => {
      expect(getAvatarOutputSize({ x: 0, y: 0, size: 100.4 })).toBe(100);
    });

    it('should always produce at least one pixel', () => {
      expect(getAvatarOutputSize({ x: 0, y: 0, size: 0.25 })).toBe(1);
    });
  });
});
