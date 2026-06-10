/**
 * 纯 canvas 透视变换 + bicubic 重采样。
 * 给定源图与 4 个源角点（顺序：左上、右上、右下、左下），将其映射为正视矩形。
 */

export interface Point { x: number; y: number; }

/** 解 n 元线性方程组 A x = b（高斯消元，带部分主元）。A 会被原地修改。 */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    // 选主元
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const d = A[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / d;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  return b.map((v, i) => v / (A[i][i] || 1e-12));
}

/** 计算把 src 四点映射到 dst 四点的 3x3 单应矩阵（返回 9 元，h22=1）。 */
export function computeHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyH(H: number[], x: number, y: number): Point {
  const d = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
}

// 三次卷积核 (Catmull-Rom 近似, a = -0.5)
function cubic(t: number): number {
  const a = -0.5;
  const x = Math.abs(t);
  if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
  if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
  return 0;
}

function sampleBicubic(src: ImageData, fx: number, fy: number, out: number[]): void {
  const { width: W, height: H, data } = src;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  out[0] = out[1] = out[2] = out[3] = 0;
  let wsum = 0;
  for (let m = -1; m <= 2; m++) {
    const yy = Math.min(H - 1, Math.max(0, y0 + m));
    const wy = cubic(fy - (y0 + m));
    for (let n = -1; n <= 2; n++) {
      const xx = Math.min(W - 1, Math.max(0, x0 + n));
      const wx = cubic(fx - (x0 + n));
      const w = wx * wy;
      if (w === 0) continue;
      const idx = (yy * W + xx) * 4;
      out[0] += data[idx] * w;
      out[1] += data[idx + 1] * w;
      out[2] += data[idx + 2] * w;
      out[3] += data[idx + 3] * w;
      wsum += w;
    }
  }
  if (wsum !== 0) for (let i = 0; i < 4; i++) out[i] /= wsum;
}

/**
 * 把源图按 4 角点透视校正为 outW×outH 的正视图。
 * @param srcImage 源 ImageData
 * @param corners  源图 4 角点（左上、右上、右下、左下）
 * @param outW/outH 输出尺寸（默认按角点估算）
 */
export function warpToRect(
  srcImage: ImageData,
  corners: Point[],
  outW?: number,
  outH?: number,
): ImageData {
  // 估算输出尺寸：用对边平均长度
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const wTop = dist(corners[0], corners[1]);
  const wBot = dist(corners[3], corners[2]);
  const hL = dist(corners[0], corners[3]);
  const hR = dist(corners[1], corners[2]);
  const W = Math.max(1, Math.round(outW ?? (wTop + wBot) / 2));
  const H = Math.max(1, Math.round(outH ?? (hL + hR) / 2));

  const dstRect: Point[] = [
    { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H },
  ];
  // 输出像素 → 源像素的单应：dstRect → corners
  const Hmat = computeHomography(dstRect, corners);

  const out = new ImageData(W, H);
  const px: number[] = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = applyH(Hmat, x + 0.5, y + 0.5);
      sampleBicubic(srcImage, s.x - 0.5, s.y - 0.5, px);
      const o = (y * W + x) * 4;
      out.data[o] = px[0];
      out.data[o + 1] = px[1];
      out.data[o + 2] = px[2];
      out.data[o + 3] = px[3] || 255;
    }
  }
  return out;
}

/** 把 HTMLImageElement 读成 ImageData */
export function imageToImageData(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** ImageData → Blob(JPEG) */
export function imageDataToBlob(data: ImageData, quality = 0.92): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = data.width; c.height = data.height;
  c.getContext("2d")!.putImageData(data, 0, 0);
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), "image/jpeg", quality));
}
