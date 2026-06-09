import heic2any from "heic2any";

/**
 * Detect HEIC/HEIF files and convert to JPEG.
 * Returns the original file if not HEIC.
 * Includes a timeout to prevent hanging.
 */
export async function convertHeicIfNeeded(file: File): Promise<File> {
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.hei[cf]$/i.test(file.name);

  if (!isHeic) return file;

  const conversionPromise = heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("HEIC转换超时，请将照片转为JPG后重试")), 30000)
  );

  const blob = await Promise.race([conversionPromise, timeoutPromise]);
  const resultBlob = Array.isArray(blob) ? blob[0] : blob;
  const newName = file.name.replace(/\.hei[cf]$/i, ".jpg");
  return new File([resultBlob], newName, { type: "image/jpeg" });
}

const readImageDimensions = async (file: File): Promise<{ width: number; height: number; image: CanvasImageSource }> => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, image: bitmap };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片读取失败"));
      img.src = objectUrl;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, image };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("图片压缩失败"));
      else resolve(blob);
    }, "image/jpeg", quality);
  });

export async function prepareShelfPhotoForUpload(file: File): Promise<File> {
  // 仅做必要的 HEIC→JPEG 转换以保证浏览器/下游可解码；
  // 不再对 JPEG/PNG/WEBP 做任何尺寸或质量压缩，确保诊断智能体拿到原图。
  return convertHeicIfNeeded(file);
}

/**
 * 压缩图片 Blob 以便上传给诊断智能体。
 * - 最大边限制 maxEdge（默认 1600px），等比缩放
 * - JPEG 质量默认 0.8
 * - 若已小于阈值则原样返回
 */
export async function compressImageBlob(
  input: Blob,
  options: { maxEdge?: number; quality?: number; maxBytes?: number } = {}
): Promise<Blob> {
  const maxEdge = options.maxEdge ?? 1600;
  const quality = options.quality ?? 0.8;
  const maxBytes = options.maxBytes ?? 1.5 * 1024 * 1024;

  try {
    // 已经足够小则跳过
    if (input.size <= maxBytes) {
      // 仍然检测尺寸：超大分辨率即使体积小也压一下
      const probe = await readImageDimensions(new File([input], "probe.jpg", { type: input.type || "image/jpeg" }));
      if (probe.width <= maxEdge && probe.height <= maxEdge) {
        // 释放 bitmap
        if ("close" in probe.image && typeof (probe.image as ImageBitmap).close === "function") {
          (probe.image as ImageBitmap).close();
        }
        return input;
      }
      const scale = Math.min(maxEdge / probe.width, maxEdge / probe.height, 1);
      const w = Math.round(probe.width * scale);
      const h = Math.round(probe.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return input;
      ctx.drawImage(probe.image, 0, 0, w, h);
      if ("close" in probe.image && typeof (probe.image as ImageBitmap).close === "function") {
        (probe.image as ImageBitmap).close();
      }
      return await canvasToJpeg(canvas, quality);
    }

    const file = new File([input], "shelf.jpg", { type: input.type || "image/jpeg" });
    const { width, height, image } = await readImageDimensions(file);
    const scale = Math.min(maxEdge / width, maxEdge / height, 1);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return input;
    ctx.drawImage(image, 0, 0, w, h);
    if ("close" in image && typeof (image as ImageBitmap).close === "function") {
      (image as ImageBitmap).close();
    }
    return await canvasToJpeg(canvas, quality);
  } catch (err) {
    console.warn("[compressImageBlob] failed, fallback to original:", err);
    return input;
  }
}

