import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  warpToRect,
  imageToImageData,
  imageDataToBlob,
  type Point,
} from "@/components/shelves/lib/perspectiveTransform";

interface Props {
  /** 待处理图片的 objectURL 或 dataURL */
  src: string;
  onCancel: () => void;
  onConfirm: (blob: Blob, previewUrl: string) => void;
}

/** 四角点透视裁切器：拖动四角 → 透视校正为正视图 */
export const PhotoCropper = ({ src, onCancel, onConfirm }: Props) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });   // displayed size
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [corners, setCorners] = useState<Point[]>([]);       // displayed coords
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);

  // 初始化角点为图片内缩 10%
  const onImgLoad = () => {
    const img = imgRef.current!;
    const w = img.clientWidth, h = img.clientHeight;
    setImgSize({ w, h });
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    const mx = w * 0.1, my = h * 0.1;
    setCorners([
      { x: mx, y: my }, { x: w - mx, y: my },
      { x: w - mx, y: h - my }, { x: mx, y: h - my },
    ]);
  };

  useEffect(() => {
    const onUp = () => setDragIdx(null);
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (dragIdx === null || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(imgSize.w, e.clientX - rect.left));
    const y = Math.max(0, Math.min(imgSize.h, e.clientY - rect.top));
    setCorners((cs) => cs.map((c, i) => (i === dragIdx ? { x, y } : c)));
  };

  const handleConfirm = async () => {
    if (!imgRef.current || corners.length !== 4) return;
    setProcessing(true);
    try {
      const sx = natural.w / imgSize.w, sy = natural.h / imgSize.h;
      const srcCorners = corners.map((c) => ({ x: c.x * sx, y: c.y * sy }));
      const srcData = imageToImageData(imgRef.current);
      const warped = warpToRect(srcData, srcCorners);
      const blob = await imageDataToBlob(warped);
      const previewUrl = URL.createObjectURL(blob);
      onConfirm(blob, previewUrl);
    } finally {
      setProcessing(false);
    }
  };

  const polygon = corners.map((c) => `${c.x},${c.y}`).join(" ");

  // 放大镜参数
  const LENS = 120;       // 镜片直径(px)
  const ZOOM = 2.5;       // 放大倍数
  const activeCorner = dragIdx !== null ? corners[dragIdx] : null;
  const magnifier = (() => {
    if (!activeCorner || imgSize.w === 0) return null;
    const { x: cx, y: cy } = activeCorner;
    // 镜片默认放角点上方；靠顶部时翻到下方
    const offset = 24;
    let top = cy - LENS - offset;
    if (top < 0) top = cy + offset;
    const left = Math.max(0, Math.min(imgSize.w - LENS, cx - LENS / 2));
    return {
      left, top,
      bgPos: `${-(cx * ZOOM - LENS / 2)}px ${-(cy * ZOOM - LENS / 2)}px`,
      bgSize: `${imgSize.w * ZOOM}px ${imgSize.h * ZOOM}px`,
    };
  })();

  return (
    <div className="space-y-3">
      <div
        ref={wrapRef}
        className="relative inline-block max-w-full select-none touch-none"
        onPointerMove={onMove}
      >
        <img
          ref={imgRef}
          src={src}
          onLoad={onImgLoad}
          className="max-w-full max-h-[60vh] block rounded-lg"
          draggable={false}
          alt="待裁切"
        />
        {corners.length === 4 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: "visible" }}>
            <polygon points={polygon} fill="rgba(232,74,40,0.12)" stroke="#E84A28" strokeWidth={2} />
          </svg>
        )}
        {corners.map((c, i) => (
          <div
            key={i}
            onPointerDown={() => setDragIdx(i)}
            className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-white border-2 border-[#E84A28] shadow cursor-grab active:cursor-grabbing touch-none"
            style={{ left: c.x, top: c.y }}
          />
        ))}
        {/* 拖动时的放大镜 */}
        {magnifier && (
          <div
            className="absolute pointer-events-none rounded-full border-2 border-white shadow-xl overflow-hidden z-10 bg-no-repeat"
            style={{
              left: magnifier.left,
              top: magnifier.top,
              width: LENS,
              height: LENS,
              backgroundImage: `url(${src})`,
              backgroundSize: magnifier.bgSize,
              backgroundPosition: magnifier.bgPos,
            }}
          >
            {/* 十字准星 */}
            <div className="absolute inset-0">
              <div className="absolute left-1/2 top-0 bottom-0 w-px -ml-px bg-[#E84A28]/70" />
              <div className="absolute top-1/2 left-0 right-0 h-px -mt-px bg-[#E84A28]/70" />
              <div className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border border-[#E84A28]" />
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">拖动四个角点对齐货架边缘，使其框住货架正面</p>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1" disabled={processing}>取消</Button>
        <Button onClick={handleConfirm} className="flex-1" disabled={processing}>
          {processing ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />处理中…</> : "确认裁切"}
        </Button>
      </div>
    </div>
  );
};
