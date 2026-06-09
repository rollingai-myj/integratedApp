// Shared poster style presets — referenced by Batch screen and the
// "重新生成" sheet inside JobsBadge.
import type { PosterStyleId } from './ai';

export const STYLES: Array<{ id: Exclude<PosterStyleId, 'custom'>; name: string; img: string }> = [
  { id: 'vibrant', name: '活力', img: '/style-refs/vibrant.webp' },
  { id: 'premium', name: '高端', img: '/style-refs/premium.webp' },
  { id: 'minimal', name: '简约', img: '/style-refs/minimal.webp' },
];
