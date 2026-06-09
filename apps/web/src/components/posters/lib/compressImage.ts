// 前端图片压缩：把任意上传图压成更小的 dataURL。
// 目的：减小请求体、缩短 4G 上传时间、降低弱网失败率、给更高并发让路。
//
// 策略：
// - 用户实拍照片 → 长边 1600px，JPEG 质量 0.85（4–8MB → 300–600KB，约 10×）
// - 透明图（商品 PNG）→ 保留 PNG，只 resize，不换格式（不丢透明背景）
// - 解码失败时回落到原图，保证流程不被压缩本身卡住

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap 在新 iOS Safari/Chrome 都支持，会自动正确处理 EXIF 方向。
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
    } catch {
      // 某些浏览器不支持 imageOrientation 选项，回退到普通 createImageBitmap
      try { return await createImageBitmap(file); } catch { /* fall through */ }
    }
  }
  // Fallback：<img> 元素
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function getSize(bmp: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if ('width' in bmp && 'height' in bmp) return { w: (bmp as any).width, h: (bmp as any).height };
  return { w: 0, h: 0 };
}

/**
 * 压缩一张上传图。
 * @param file 用户选中的文件
 * @param opts.keepAlpha 是否保留透明通道（true=输出 PNG，false=输出 JPEG）
 */
export async function compressImage(
  file: File,
  opts: { keepAlpha?: boolean } = {},
): Promise<string> {
  // 太小的图就别浪费 CPU 了，直接 dataURL 返回
  if (file.size < 200 * 1024) {
    return await fileToDataUrl(file);
  }

  try {
    const bmp = await loadBitmap(file);
    const { w, h } = getSize(bmp);
    if (!w || !h) return await fileToDataUrl(file);

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return await fileToDataUrl(file);

    ctx.drawImage(bmp as CanvasImageSource, 0, 0, tw, th);
    // 释放 bitmap 内存
    if ('close' in bmp && typeof (bmp as ImageBitmap).close === 'function') {
      (bmp as ImageBitmap).close();
    }

    const wantPng = opts.keepAlpha || file.type === 'image/png';
    const dataUrl = wantPng
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', JPEG_QUALITY);

    // 如果压完反而更大（极少见，比如已经很小的 JPEG），回原图
    if (dataUrl.length > file.size * 1.3) {
      return await fileToDataUrl(file);
    }
    return dataUrl;
  } catch (err) {
    console.warn('[compressImage] fallback to raw upload', err);
    return await fileToDataUrl(file);
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => typeof r.result === 'string' ? resolve(r.result) : reject(new Error('read fail'));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
