/**
 * Virtual Shelf View - renders a virtual shelf layout as a realistic refrigerator cabinet.
 * Physics-based rendering: pixel dimensions derived from real cm measurements.
 */
import { useState, useMemo, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { type VirtualShelfBlock, type VirtualShelfGroup, type VirtualShelfLayer } from "./types";
import { getSkuImageUrl } from "./parseDifyOutput";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import html2canvas from "html2canvas";
import ReactMarkdown from "react-markdown";

/* ── Promo tag helpers ── */
const PROMO_TAG_BASE = "https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com/PROMO_tag";
function getPromoTagUrl(promoset: string): string {
  return `${PROMO_TAG_BASE}/${promoset}.jpg`;
}

interface PromoGroup {
  promoset: string;
  leftRatio: number;
  rightRatio: number;
}

function computePromoGroups(blocks: VirtualShelfBlock[]): PromoGroup[] {
  const map = new Map<string, { left: number; right: number }>();
  for (const b of blocks) {
    if (!b.promoset) continue;
    const g = map.get(b.promoset);
    if (g) {
      if (b.startRatio < g.left) g.left = b.startRatio;
      if (b.endRatio > g.right) g.right = b.endRatio;
    } else {
      map.set(b.promoset, { left: b.startRatio, right: b.endRatio });
    }
  }
  return Array.from(map.entries()).map(([promoset, { left, right }]) => ({
    promoset,
    leftRatio: left,
    rightRatio: right,
  }));
}

/* ── Fridge CSS injected once ── */
const FRIDGE_STYLE_ID = "virtual-fridge-styles";
function ensureFridgeStyles() {
  if (document.getElementById(FRIDGE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FRIDGE_STYLE_ID;
  style.textContent = `
    .vf-fridge-unit {
      background-color: #f0f2f5;
      border: 6px solid #f0f2f5;
      border-radius: 8px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2), inset 0 0 10px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
    }
    .vf-header {
      height: 50px;
      background: linear-gradient(to bottom, #fff, #eef);
      box-shadow: inset 0 -5px 10px rgba(0,0,0,0.05), 0 2px 5px rgba(0,0,0,0.05);
      border-bottom: 4px solid #e0e0e0;
      border-radius: 6px 6px 0 0;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .vf-header-panel {
      width: 90%; height: 70%;
      background: #fff;
      border-radius: 4px;
      box-shadow: 0 0 15px rgba(255,255,255,0.8);
      border: 1px solid #eee;
    }
    .vf-doors {
      flex: 1;
      display: flex;
      background-color: transparent;
      padding: 0;
    }
    .vf-door {
      flex: 1;
      background-color: #f0f2f5;
      padding: 0;
      position: relative;
      display: flex;
      flex-direction: column;
    }
    .vf-glass {
      flex: 1;
      border-radius: 4px;
      position: relative;
      overflow: hidden;
      background: radial-gradient(ellipse at top center, #ffffff 0%, #eef4ff 60%, #dbe6f4 100%);
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,0.5),
        inset 0 0 30px rgba(230,245,255,0.3),
        inset 0 10px 20px rgba(255,255,255,1);
      border: 1px solid #cce;
    }
    .vf-shelf-rack {
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 20px 6px 6px 6px;
      box-sizing: border-box;
      justify-content: flex-end;
    }
    .vf-wire-shelf {
      position: relative;
      flex-shrink: 0;
    }
    .vf-beam {
      height: 8px;
      width: 100%;
      background-color: #f8f9fa;
      border-radius: 4px;
      position: absolute;
      bottom: 0;
      z-index: 10;
      opacity: 0.55;
      box-shadow:
        inset 0 3px 3px rgba(255,255,255,0.9),
        inset 0 -3px 3px rgba(0,0,0,0.25);
    }
    .vf-beam::after {
      content: '';
      position: absolute;
      top: 8px; left: 2%; width: 96%;
      height: 10px;
      background: radial-gradient(ellipse at top, rgba(0,0,0,0.15), transparent 70%);
      opacity: 0.6;
      filter: blur(4px);
      z-index: -1;
    }
    .vf-wire-shelf::before {
      content: "";
      position: absolute;
      bottom: 8px;
      left: 0; width: 100%; height: 6px;
      z-index: 10;
      opacity: 0.45;
      pointer-events: none;
      border-top: 1px solid #f8f9fa;
      border-radius: 2px;
      box-shadow: inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -1px 1px rgba(0,0,0,0.2);
      background-image: repeating-linear-gradient(
        to right,
        transparent 0px, transparent 1px,
        #d0d5dd 1px, #f8f9fa 2px, #d0d5dd 3px,
        transparent 3px, transparent 3px
      );
    }
    @keyframes vf-layer-pulse {
      0%, 100% {
        box-shadow: 0 0 0 0 hsla(var(--primary), 0.55), 0 1px 2px rgba(0,0,0,0.08);
        transform: scale(1);
      }
      50% {
        box-shadow: 0 0 0 6px hsla(var(--primary), 0), 0 1px 2px rgba(0,0,0,0.08);
        transform: scale(1.08);
      }
    }
    .vf-layer-pulse {
      animation: vf-layer-pulse 1.4s ease-in-out infinite;
      border-color: hsl(var(--primary)) !important;
      color: hsl(var(--primary)) !important;
    }
    .vf-footer {
      height: 36px;
      background: linear-gradient(to bottom, #e0e0e0, #d0d0d0);
      border-top: 3px solid #bbb;
      display: flex;
      justify-content: center;
      align-items: center;
      border-radius: 0 0 6px 6px;
    }
  `;
  document.head.appendChild(style);
}

export interface VirtualShelfViewHandle {
  download: () => Promise<void>;
}

interface Props {
  layout: VirtualShelfGroup[];
  shelfWidthCm: number;
}

export const VirtualShelfView = forwardRef<VirtualShelfViewHandle, Props>(({ layout, shelfWidthCm }, ref) => {
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [highlightNewOnly, setHighlightNewOnly] = useState(false);
  const [pulseLayerButtons, setPulseLayerButtons] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperOuterRef = useRef<HTMLDivElement>(null);

  useEffect(() => { ensureFridgeStyles(); }, []);

  // Trigger pulse highlight on layer buttons for 10s whenever a new layout arrives
  useEffect(() => {
    if (!layout || layout.length === 0) return;
    setPulseLayerButtons(true);
    const t = setTimeout(() => setPulseLayerButtons(false), 10000);
    return () => clearTimeout(t);
  }, [layout]);

  const BASE_PX_PER_CM = 6;
  const pxPerCm = BASE_PX_PER_CM;

  const allLayerHeights = useMemo(() => {
    return layout.map((group: VirtualShelfGroup) =>
      group.layers.map((layer: VirtualShelfLayer) => {
        const maxH = layer.blocks.reduce((max: number, b: VirtualShelfBlock) => Math.max(max, b.heightCm), 10);
        return Math.min(Math.max(maxH * pxPerCm, 40), 120);
      })
    );
  }, [layout]);

  const WIRE_SHELF_H = 14;
  const HEADER_H = 50;
  const FOOTER_H = 36;
  const DOOR_PAD = 0;
  const GLASS_PAD = 26;

  const totalHeight = useMemo(() => {
    const maxLayers = allLayerHeights.reduce((max: number, lh: number[]) => {
      const sum = lh.reduce((s: number, h: number) => s + h + WIRE_SHELF_H, 0);
      return Math.max(max, sum);
    }, 200);
    return HEADER_H + maxLayers + GLASS_PAD + DOOR_PAD + FOOTER_H;
  }, [allLayerHeights]);

  const contentWidth = useMemo(() => {
    return Math.max(shelfWidthCm * BASE_PX_PER_CM, 500);
  }, [shelfWidthCm]);

  const aspectRatio = contentWidth / totalHeight;

  // Container dimensions (responsive, locked to shelf aspect ratio)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapperOuterRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 0.6;
      const h = w / safeAspect;
      setContainerSize({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("orientationchange", update);
    return () => { ro.disconnect(); window.removeEventListener("orientationchange", update); };
  }, [aspectRatio]);

  const minScale = containerSize.w > 0 ? containerSize.w / contentWidth : 1;
  const maxScale = Math.max(2.0, minScale * 4);

  const [zoom, setZoom] = useState(minScale);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);
  const lastTapTime = useRef(0);

  // Reset to minScale whenever it changes (initial mount or resize)
  useEffect(() => {
    setZoom(prev => {
      if (prev < minScale || prev === 1) return minScale;
      return Math.min(Math.max(prev, minScale), maxScale);
    });
  }, [minScale, maxScale]);

  const clampTranslate = useCallback((tx: number, ty: number, z: number) => {
    const scaledW = contentWidth * z;
    const scaledH = totalHeight * z;
    const maxTx = Math.max(0, (scaledW - containerSize.w) / 2);
    const maxTy = Math.max(0, (scaledH - containerSize.h) / 2);
    return {
      x: Math.min(Math.max(tx, -maxTx), maxTx),
      y: Math.min(Math.max(ty, -maxTy), maxTy),
    };
  }, [contentWidth, totalHeight, containerSize]);

  const setZoomClamped = useCallback((next: number, recenter = false) => {
    const z = Math.min(Math.max(next, minScale), maxScale);
    setZoom(z);
    setTranslate(prev => recenter ? { x: 0, y: 0 } : clampTranslate(prev.x, prev.y, z));
  }, [minScale, maxScale, clampTranslate]);

  const currentZoom = zoom;
  const isZoomed = currentZoom > minScale + 0.001;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoomClamped(currentZoom + delta);
  }, [currentZoom, setZoomClamped]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !isZoomed) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [isZoomed, translate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const nx = dragStart.current.tx + (e.clientX - dragStart.current.x);
    const ny = dragStart.current.ty + (e.clientY - dragStart.current.y);
    setTranslate(clampTranslate(nx, ny, currentZoom));
  }, [dragging, clampTranslate, currentZoom]);

  const handlePointerUp = useCallback(() => setDragging(false), []);

  // Touch handlers (pinch + single-finger pan + double-tap)
  const touchStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStart.current = { dist: Math.hypot(dx, dy), zoom: currentZoom };
      e.preventDefault();
    } else if (e.touches.length === 1) {
      // double-tap detection
      const now = Date.now();
      if (now - lastTapTime.current < 300) {
        const next = isZoomed ? minScale : Math.min(maxScale, minScale * 2.5);
        setZoomClamped(next, !isZoomed ? false : true);
        lastTapTime.current = 0;
        return;
      }
      lastTapTime.current = now;
      if (isZoomed) {
        touchStart.current = {
          x: e.touches[0].clientX, y: e.touches[0].clientY,
          tx: translate.x, ty: translate.y,
        };
      }
    }
  }, [currentZoom, isZoomed, minScale, maxScale, setZoomClamped, translate]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchStart.current.dist;
      setZoomClamped(pinchStart.current.zoom * ratio);
      e.preventDefault();
    } else if (e.touches.length === 1 && touchStart.current && isZoomed) {
      const nx = touchStart.current.tx + (e.touches[0].clientX - touchStart.current.x);
      const ny = touchStart.current.ty + (e.touches[0].clientY - touchStart.current.y);
      const clamped = clampTranslate(nx, ny, currentZoom);
      setTranslate(clamped);
      // If hit boundary on Y, allow page scroll by NOT preventing default
      if (clamped.y === nx || clamped.y !== ny) {
        // at vertical edge — let page scroll
      } else {
        e.preventDefault();
      }
    }
  }, [setZoomClamped, isZoomed, clampTranslate, currentZoom]);

  const handleTouchEnd = useCallback(() => {
    pinchStart.current = null;
    touchStart.current = null;
  }, []);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    layout.forEach((g: VirtualShelfGroup) => g.layers.forEach((l: VirtualShelfLayer) => l.blocks.forEach((b: VirtualShelfBlock) => {
      if (!map.has(b.subcategory)) map.set(b.subcategory, b.color);
    })));
    return map;
  }, [layout]);

  const handleDownload = useCallback(async () => {
    // Capture the inner fridge unit directly — avoids zoom/transform/clip issues
    const fridge = containerRef.current?.querySelector(".vf-fridge-unit") as HTMLElement | null;
    if (!fridge) return;
    try {
      // 1. Swap all OSS image srcs → proxied URLs (same-origin, no CORS)
      const imgs = Array.from(fridge.querySelectorAll("img")) as HTMLImageElement[];
      const originals: { img: HTMLImageElement; src: string }[] = [];
      imgs.forEach((img) => {
        if (!img.src || img.src.startsWith("data:")) return;
        originals.push({ img, src: img.src });
        img.src = `/api/proxy-image?url=${encodeURIComponent(img.src)}`;
      });

      // Small delay for proxied images to load
      await new Promise((r) => setTimeout(r, 300));

      // Strip highlight ring/shadow classes from block containers (NOT hide the blocks)
      const blocks = Array.from(fridge.querySelectorAll("[data-sku-block-id]")) as HTMLElement[];
      const blockClasses: { el: HTMLElement; cls: string }[] = [];
      blocks.forEach((el) => {
        blockClasses.push({ el, cls: el.className });
        el.className = el.className
          .replace(/\bring-\S+/g, "")
          .replace(/\bshadow-\S+/g, "");
        el.style.boxShadow = "none";
      });

      // 2. Capture — hide overlays (NEW badge, pulse ring) via CSS
      fridge.setAttribute("data-downloading", "");
      const canvas = await html2canvas(fridge, { scale: 2, backgroundColor: null });
      fridge.removeAttribute("data-downloading");

      // 3. Restore everything
      blockClasses.forEach(({ el, cls }) => { el.className = cls; el.style.boxShadow = ""; });
      originals.forEach(({ img, src }) => { img.src = src; });

      // 4. Download
      const link = document.createElement("a");
      link.download = `优化后示意图-${new Date().toLocaleDateString("zh-CN")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("下载示意图失败:", e);
    }
  }, []);

  useImperativeHandle(ref, () => ({ download: handleDownload }), [handleDownload]);

  if (layout.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] bg-muted/30 rounded-lg border-2 border-dashed border-border">
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">暂无商品数据</p>
          <p className="text-xs text-muted-foreground/60">请先完成货架识别</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperOuterRef} className="relative w-full">
      {/* Legend: New listing marker — toggleable filter */}
      <button
        type="button"
        onClick={() => setHighlightNewOnly(v => !v)}
        aria-pressed={highlightNewOnly}
        className={`absolute top-2 left-2 z-20 flex items-center gap-1.5 rounded-md bg-card/90 border border-border px-2 py-1 shadow-sm transition-colors hover:bg-muted ${highlightNewOnly ? 'ring-1 ring-amber-400' : ''}`}
      >
        <span className={`inline-block w-3 h-3 rounded-sm ring-2 ring-amber-400 ${highlightNewOnly ? 'bg-amber-400' : 'bg-amber-100'}`} />
        <span className={`text-[10px] text-foreground ${highlightNewOnly ? 'font-bold' : 'font-medium'}`}>上架</span>
      </button>

      {/* Zoom controls moved below — see toolbar after the shelf wrapper */}

      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden mx-auto"
        style={{
          width: containerSize.w || "100%",
          height: containerSize.h || undefined,
          cursor: isZoomed ? (dragging ? "grabbing" : "grab") : "default",
          touchAction: isZoomed ? "none" : "pan-y",
          background: "#dadddf",
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={() => {
          const next = isZoomed ? minScale : Math.min(maxScale, minScale * 2.5);
          setZoom(next);
          if (!isZoomed === false) setTranslate({ x: 0, y: 0 });
          else setTranslate({ x: 0, y: 0 });
        }}
      >
        <div
          style={{
            width: contentWidth,
            height: totalHeight,
            transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${currentZoom})`,
            transformOrigin: "center center",
            position: "absolute",
            left: "50%",
            top: "50%",
            transition: dragging ? "none" : "transform 0.15s ease-out",
          }}
        >
          <TooltipProvider delayDuration={100}>
            <div className="vf-fridge-unit" style={{ width: contentWidth, height: totalHeight }}>
              <div className="vf-header">
                <div className="vf-header-panel" />
              </div>
              <div className="vf-doors">
                {layout.map((group, gi) => (
                  <FridgeDoorRender
                    key={group.groupIndex}
                    group={group}
                    layerHeights={allLayerHeights[gi] || []}
                    pxPerCm={pxPerCm}
                    containerWidth={contentWidth}
                    hoveredBlock={hoveredBlock}
                    onHoverBlock={setHoveredBlock}
                    wireShelfH={WIRE_SHELF_H}
                    highlightNewOnly={highlightNewOnly}
                    pulseLayerButtons={pulseLayerButtons}
                  />
                ))}
              </div>
              <div className="vf-footer" />
            </div>
          </TooltipProvider>
        </div>
      </div>
      {/* Zoom toolbar — placed below shelf so controls don't cover it */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className={`text-[11px] text-muted-foreground flex items-center gap-1 ${pulseLayerButtons ? 'text-primary font-medium' : ''}`}>
          <span aria-hidden>👈</span>
          <span>点击左侧层级按钮查看陈列理由</span>
        </div>
        <div className="flex items-center gap-1.5">
        <button
          onClick={() => setZoomClamped(currentZoom + 0.3)}
          className="w-8 h-8 rounded-lg bg-card border border-border shadow-sm flex items-center justify-center text-foreground hover:bg-muted transition-colors text-lg font-bold"
          aria-label="放大"
        >+</button>
        <button
          onClick={() => setZoomClamped(currentZoom - 0.3)}
          className="w-8 h-8 rounded-lg bg-card border border-border shadow-sm flex items-center justify-center text-foreground hover:bg-muted transition-colors text-lg font-bold"
          aria-label="缩小"
        >−</button>
        <button
          onClick={() => { setZoom(minScale); setTranslate({ x: 0, y: 0 }); }}
          className={`w-8 h-8 rounded-lg bg-card border border-border shadow-sm flex items-center justify-center transition-colors text-[10px] font-medium ${isZoomed ? "text-primary" : "text-muted-foreground"} hover:bg-muted`}
          aria-label="重置缩放"
        >重置</button>
        </div>
      </div>
    </div>
  );
});

VirtualShelfView.displayName = "VirtualShelfView";

/** Render one or two fridge doors for a group based on shelfWidthCm */
const FridgeDoorRender = ({
  group, layerHeights, pxPerCm, containerWidth, hoveredBlock, onHoverBlock, wireShelfH, highlightNewOnly, pulseLayerButtons,
}: {
  group: VirtualShelfGroup;
  layerHeights: number[];
  pxPerCm: number;
  containerWidth: number;
  hoveredBlock: string | null;
  onHoverBlock: (id: string | null) => void;
  wireShelfH: number;
  highlightNewOnly: boolean;
  pulseLayerButtons: boolean;
}) => {
  const layerCount = group.layers.length;
  

  const renderDoorContent = (
    layers: typeof group.layers,
  ) => (
    <div className="vf-door" style={{ display: "flex", flexDirection: "row", alignItems: "stretch" }}>
      {/* Layer label gutter — sits OUTSIDE the glass, to the left of the shelf */}
      <div
        style={{
          flexShrink: 0,
          width: 38,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "20px 4px 6px 0",
          boxSizing: "border-box",
          zIndex: 5,
        }}
      >
        {layers.map((layer: VirtualShelfLayer, idx: number) => {
          const layerH = (layerHeights[idx] || 40) + wireShelfH;
          const layerNum = layer.layerIndex;
          const layerReason = layer.reason || layer.blocks[0]?.reason;
          return (
            <div
              key={`label-${layer.layerIndex}`}
              style={{
                height: layerH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={pulseLayerButtons ? "vf-layer-pulse" : undefined}
                    style={{
                      fontSize: 13,
                      color: "hsl(var(--foreground))",
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      padding: "4px 8px",
                      minWidth: 32,
                      fontWeight: 600,
                      lineHeight: 1,
                      cursor: "pointer",
                      pointerEvents: "auto",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                    }}
                  >
                    L{layerNum}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="center" className="max-w-[280px] w-auto p-3">
                  <div className="text-xs font-semibold mb-1">第 {layerNum} 层 · 陈列理由</div>
                  <div className="text-xs text-muted-foreground leading-snug vf-reason-md">
                    {layerReason ? (
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                          code: ({ children }) => <code className="px-1 py-0.5 rounded bg-muted text-foreground text-[11px]">{children}</code>,
                          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{children}</a>,
                          h1: ({ children }) => <div className="font-semibold text-foreground mt-1 mb-0.5">{children}</div>,
                          h2: ({ children }) => <div className="font-semibold text-foreground mt-1 mb-0.5">{children}</div>,
                          h3: ({ children }) => <div className="font-semibold text-foreground mt-1 mb-0.5">{children}</div>,
                        }}
                      >
                        {layerReason.replace(/\\n/g, "\n")}
                      </ReactMarkdown>
                    ) : (
                      "暂无该层陈列理由"
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          );
        })}
      </div>
      <div className="vf-glass" style={{ flex: 1 }}>
        <div className="vf-shelf-rack">
          {layers.map((layer: VirtualShelfLayer, idx: number) => {
            const layerH = layerHeights[idx] || 40;
            const blocks = layer.blocks;
            const mappedBlocks = blocks;
            return (
              <div key={layer.layerIndex} className="vf-wire-shelf" style={{ height: layerH + wireShelfH }}>
                {/* Promo group highlight overlays */}
                {computePromoGroups(mappedBlocks).map((g) => (
                  <div
                    key={`promo-hl-${layer.layerIndex}-${g.promoset}`}
                    className="vf-promo-highlight"
                    style={{
                      position: "absolute",
                      left: `${g.leftRatio * 100}%`,
                      width: `${(g.rightRatio - g.leftRatio) * 100}%`,
                      top: 0,
                      bottom: 8,
                      zIndex: 5,
                      border: "1px solid rgba(24, 144, 255, 0.35)",
                      borderRadius: 4,
                      boxShadow: "0 0 12px 3px rgba(24, 144, 255, 0.35)",
                      background: "rgba(24, 144, 255, 0.04)",
                      pointerEvents: "none",
                    }}
                  />
                ))}
                {/* Product blocks area - absolutely positioned, z-index 1, behind wire shelf rails */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}>
                  {mappedBlocks.map((block: VirtualShelfBlock) => (
                    <ShelfBlockRender
                      key={block.id}
                      block={block}
                      layerH={layerH}
                      pxPerCm={pxPerCm}
                      containerWidth={containerWidth}
                      isHovered={hoveredBlock === block.id}
                      isDimmed={hoveredBlock !== null && hoveredBlock !== block.id}
                      onHover={onHoverBlock}
                      highlightNewOnly={highlightNewOnly}
                    />
                  ))}
                </div>
                {/* Promo activity tags — rendered above wire shelf beam */}
                {computePromoGroups(mappedBlocks).map((g) => {
                  const centerPct = ((g.leftRatio + g.rightRatio) / 2) * 100;
                  return (
                    <img
                      key={`promo-${layer.layerIndex}-${g.promoset}`}
                      src={getPromoTagUrl(g.promoset)}
                      alt=""
                      className="vf-promo-tag"
                      style={{
                        position: "absolute",
                        left: `${centerPct}%`,
                        bottom: 2,
                        transform: "translateX(-50%)",
                        height: 40,
                        width: "auto",
                        zIndex: 15,
                        pointerEvents: "none",
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  );
                })}
                {/* Wire shelf beam */}
                <div className="vf-beam" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return renderDoorContent(group.layers);
};

/** Render a single product block on the shelf */
const ShelfBlockRender = ({
  block, layerH, pxPerCm, containerWidth, isHovered, isDimmed, onHover, highlightNewOnly,
}: {
  block: VirtualShelfBlock;
  layerH: number;
  pxPerCm: number;
  containerWidth: number;
  isHovered: boolean;
  isDimmed: boolean;
  onHover: (id: string | null) => void;
  highlightNewOnly: boolean;
}) => {
  const imageUrl = getSkuImageUrl(block.skuCode);
  const blockWidth = (block.endRatio - block.startRatio) * 100;
  const imgWidthPx = (block.endRatio - block.startRatio) * containerWidth;
  const rawHeightPx = block.heightCm * pxPerCm;
  const imgHeightPx = Math.min(rawHeightPx, layerH - 2);
  const facing = block.facing || 1;
  const upfacing = block.upfacing || 0;

  const renderImages = () => {
    if (!imageUrl) {
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: `${block.color}40` }}>
          <span className="text-[8px] text-white font-medium text-center leading-tight px-0.5 break-all" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
            {block.skuName.slice(0, 6)}
          </span>
        </div>
      );
    }
    const singleW = imgWidthPx / facing;
    if (upfacing > 0) {
      const stackH = imgHeightPx / upfacing;
      return (
        <div className="flex flex-col items-center justify-end" style={{ height: imgHeightPx }}>
          {Array.from({ length: upfacing }).map((_, i) => (
            <img key={i} src={imageUrl} alt={block.skuName} style={{ width: imgWidthPx, height: stackH, objectFit: 'fill' }} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ))}
        </div>
      );
    }
    if (facing > 1) {
      return (
        <div className="flex items-end justify-center" style={{ height: imgHeightPx }}>
          {Array.from({ length: facing }).map((_, i) => (
            <img key={i} src={imageUrl} alt={block.skuName} style={{ width: singleW, height: imgHeightPx, objectFit: 'fill' }} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ))}
        </div>
      );
    }
    return (
      <img src={imageUrl} alt={block.skuName} style={{ width: imgWidthPx, height: imgHeightPx, objectFit: 'fill' }} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
    );
  };

  const [clicked, setClicked] = useState(false);
  const open = isHovered || clicked;

  useEffect(() => {
    if (!clicked) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-sku-block-id="${block.id}"]`)) {
        setClicked(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [clicked, block.id]);

  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <Tooltip open={open} onOpenChange={(o) => { if (!o) setClicked(false); }}>
      <TooltipTrigger asChild>
        <div
          data-sku-block-id={block.id}
          draggable={false}
          className={[
            'absolute transition-all',
            isDimmed ? 'opacity-30' : '',
            (highlightNewOnly && !block.isNewListing) ? 'opacity-25 grayscale-[0.4]' : '',
            (isHovered || clicked) ? 'z-10 ring-1 ring-foreground/50' : '',
            block.isNewListing ? 'ring-2 ring-amber-400/70' : '',
            (block.isNewListing && !highlightNewOnly) ? 'shadow-[0_0_12px_3px_rgba(251,191,36,0.45)]' : '',
            (block.isNewListing && highlightNewOnly) ? 'z-10' : '',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${block.startRatio * 100}%`,
            width: `${blockWidth}%`,
            height: `${layerH - 2}px`,
            bottom: 8,
            userSelect: "none",
            WebkitUserSelect: "none",
            // @ts-expect-error vendor property
            WebkitUserDrag: "none",
          }}
          onMouseEnter={() => onHover(block.id)}
          onMouseLeave={() => onHover(null)}
          onPointerDown={(e) => {
            pointerDownPos.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const start = pointerDownPos.current;
            pointerDownPos.current = null;
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (Math.hypot(dx, dy) < 5) {
              setClicked(c => !c);
            }
          }}
          onDragStart={(e) => e.preventDefault()}
        >
          {block.isNewListing && (
            <span className="absolute -top-0.5 -right-0.5 z-20 bg-amber-400 text-white text-[9px] font-bold leading-none px-1 py-0.5 rounded shadow-sm pointer-events-none">
              NEW
            </span>
          )}
          {block.isNewListing && (
            <span className={`absolute inset-0 ring-2 animate-pulse pointer-events-none ${highlightNewOnly ? 'ring-amber-400/40' : 'ring-amber-400/60'}`} />
          )}
          <div className="w-full h-full flex items-end justify-center overflow-hidden" style={{ backgroundColor: 'transparent', border: 'none' }}>
            {renderImages()}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-white" onPointerDownOutside={() => setClicked(false)}>
        {block.isNewListing && (
          <p className="text-xs font-semibold mb-1">本次上架</p>
        )}
        <p className="text-sm font-semibold leading-tight">{block.skuName}</p>
        <p className="text-xs mt-0.5">编码:{block.skuCode || "—"}</p>
        {block.subcategory && (
          <p className="text-xs">{block.subcategory}</p>
        )}
        {block.sales30d && (
          <div className="flex gap-2 mt-1 text-xs">
            <span>30日销售额 ¥{block.sales30d}</span>
            {block.salesVolume30d && <span>销量 {block.salesVolume30d}</span>}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
};
