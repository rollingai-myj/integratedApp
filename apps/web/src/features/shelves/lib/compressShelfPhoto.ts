// 货架照片上传前的轻压缩。
//
// 目的:
// - 普通手机原图 4-8MB,直接传费流量;轻压到 ~1-3MB,识别细节不丢
// - 若原图特别大(>15MB,DSLR 之类),逐档降质,确保最终塞进后端 15MB 上限
//
// 跟海报压缩 (components/posters/lib/compressImage.ts) 的差别:
// - 海报是给人看,长边 1600 + 质量 0.85 → ~300KB 足够
// - 货架是给 AI 数 SKU,长边保到 2560 + 质量 0.9,保留细节
// - 返回 File(可直接进 FormData),不是 dataURL
//
// 后端上限同步是 15MB(scenes.routes.ts multer limits.fileSize)。

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 2560;
const QUALITIES = [0.9, 0.8, 0.7];
// 小于 1MB 的图就别折腾了,横竖也没节省多少
const SKIP_BELOW = 1 * 1024 * 1024;

export async function compressShelfPhoto(file: File): Promise<File> {
  // PNG(可能带透明)直接放行,货架照实拍基本都是 JPEG
  if (file.type === 'image/png') return file;
  if (file.size <= SKIP_BELOW) return file;

  try {
    const bmp = await loadBitmap(file);
    const { w, h } = getSize(bmp);
    if (!w || !h) return file;

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bmp as CanvasImageSource, 0, 0, tw, th);
    if ('close' in bmp && typeof (bmp as ImageBitmap).close === 'function') {
      (bmp as ImageBitmap).close();
    }

    // 逐档降质,第一档能塞下就直接用——常规原图 0.9 就过线了,降档只为极端大图兜底
    let best: Blob | null = null;
    for (const q of QUALITIES) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', q);
      if (!blob) continue;
      best = blob;
      if (blob.size <= MAX_BYTES) break;
    }
    if (!best || best.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([best], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q));
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      try { return await createImageBitmap(file); } catch { /* fall through */ }
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function getSize(bmp: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return { w: (bmp as { width?: number }).width ?? 0, h: (bmp as { height?: number }).height ?? 0 };
}
