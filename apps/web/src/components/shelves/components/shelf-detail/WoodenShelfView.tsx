/**
 * Wooden Bakery Shelf View — renders virtual shelf as a wooden bakery rack.
 * Visuals (wood patterns / trays / base cabinet) ported from the uploaded
 * `货架.html` reference. Shares interaction model with VirtualShelfView
 * (pinch / pan / double-tap zoom + per-block tooltip + html2canvas download).
 *
 * Adaptive sizing rules (parity with VirtualShelfView):
 *   • Width  px  = shelfWidthCm * BASE_PX_PER_CM   (BASE = 6)
 *   • Layer  px  = clamp(maxBlockHeightCm * pxPerCm, 40..120)
 *   • Total  H   = topGap + Σ(layerH + trayH) + cabinetH
 */
import {
  forwardRef, useCallback, useEffect, useImperativeHandle,
  useMemo, useRef, useState,
} from "react";
import { type VirtualShelfBlock, type VirtualShelfGroup } from "@/components/shelves/types/virtualShelf";
import { getSkuImageUrl } from "@/components/shelves/lib/virtualShelfLayout";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import html2canvas from "html2canvas";

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

export interface WoodenShelfViewHandle {
  download: () => Promise<void>;
}

interface Props {
  layout: VirtualShelfGroup[];
  shelfWidthCm: number;
}

// Geometry constants (px in shelf-internal coordinates)
const BASE_PX_PER_CM = 6;
const TOP_GAP = 50;     // air above the top tray
const TRAY_H = 75;      // wooden tray height (40 lip + 35 surface)
const TRAY_SURFACE_H = 35; // flat plank surface portion of TRAY_H (drawn at lip-bottom)
const CABINET_H = 150;  // base cabinet
const SIDE_PAD = 20;    // back panel side padding (matches HTML)
const SIDE_FRAME = 10;  // cabinet vertical side-plank width — keep products inside this

export const WoodenShelfView = forwardRef<WoodenShelfViewHandle, Props>(
  ({ layout, shelfWidthCm }, ref) => {
    const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
    const [highlightNewOnly, setHighlightNewOnly] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperOuterRef = useRef<HTMLDivElement>(null);

    const pxPerCm = BASE_PX_PER_CM;

    // Per-group, per-layer height in px
    const allLayerHeights = useMemo(
      () =>
        layout.map((group) =>
          group.layers.map((layer) => {
            const maxH = layer.blocks.reduce((m, b) => Math.max(m, b.heightCm), 10);
            return Math.min(Math.max(maxH * pxPerCm, 40), 120);
          }),
        ),
      [layout],
    );

    // Total inner shelf height — driven by tallest group (in #layers/heights)
    const totalHeight = useMemo(() => {
      const maxStack = allLayerHeights.reduce((m, lh) => {
        const stack = lh.reduce((s, h) => s + h + TRAY_H, 0);
        return Math.max(m, stack);
      }, 200);
      return TOP_GAP + maxStack + CABINET_H;
    }, [allLayerHeights]);

    // Inner content width in px (groups laid out side-by-side)
    const groupCount = Math.max(layout.length, 1);
    const contentWidth = useMemo(
      () => Math.max(shelfWidthCm * BASE_PX_PER_CM * groupCount, 500),
      [shelfWidthCm, groupCount],
    );

    const aspectRatio = contentWidth / totalHeight;

    // ── Container responsive sizing (locks to aspect ratio) ─────────────
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
    useEffect(() => {
      const el = wrapperOuterRef.current;
      if (!el) return;
      const update = () => {
        const w = el.clientWidth;
        if (w <= 0) return;
        const safe = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 0.6;
        setContainerSize({ w, h: w / safe });
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      window.addEventListener("orientationchange", update);
      return () => {
        ro.disconnect();
        window.removeEventListener("orientationchange", update);
      };
    }, [aspectRatio]);

    // ── Zoom / pan state ────────────────────────────────────────────────
    const minScale = containerSize.w > 0 ? containerSize.w / contentWidth : 1;
    const maxScale = Math.max(2.0, minScale * 4);
    const [zoom, setZoom] = useState(minScale);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
    const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);
    const lastTapTime = useRef(0);
    const touchStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

    useEffect(() => {
      setZoom((prev) =>
        prev < minScale || prev === 1
          ? minScale
          : Math.min(Math.max(prev, minScale), maxScale),
      );
    }, [minScale, maxScale]);

    const clampTranslate = useCallback(
      (tx: number, ty: number, z: number) => {
        const sw = contentWidth * z;
        const sh = totalHeight * z;
        const maxTx = Math.max(0, (sw - containerSize.w) / 2);
        const maxTy = Math.max(0, (sh - containerSize.h) / 2);
        return {
          x: Math.min(Math.max(tx, -maxTx), maxTx),
          y: Math.min(Math.max(ty, -maxTy), maxTy),
        };
      },
      [contentWidth, totalHeight, containerSize],
    );

    const setZoomClamped = useCallback(
      (next: number, recenter = false) => {
        const z = Math.min(Math.max(next, minScale), maxScale);
        setZoom(z);
        setTranslate((prev) =>
          recenter ? { x: 0, y: 0 } : clampTranslate(prev.x, prev.y, z),
        );
      },
      [minScale, maxScale, clampTranslate],
    );

    const isZoomed = zoom > minScale + 0.001;

    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        e.preventDefault();
        setZoomClamped(zoom + (e.deltaY > 0 ? -0.15 : 0.15));
      },
      [zoom, setZoomClamped],
    );

    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse" || !isZoomed) return;
        setDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      },
      [isZoomed, translate],
    );
    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!dragging) return;
        const nx = dragStart.current.tx + (e.clientX - dragStart.current.x);
        const ny = dragStart.current.ty + (e.clientY - dragStart.current.y);
        setTranslate(clampTranslate(nx, ny, zoom));
      },
      [dragging, clampTranslate, zoom],
    );
    const handlePointerUp = useCallback(() => setDragging(false), []);

    const handleTouchStart = useCallback(
      (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          pinchStart.current = { dist: Math.hypot(dx, dy), zoom };
          e.preventDefault();
        } else if (e.touches.length === 1) {
          const now = Date.now();
          if (now - lastTapTime.current < 300) {
            const next = isZoomed ? minScale : Math.min(maxScale, minScale * 2.5);
            setZoomClamped(next, !isZoomed);
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
      },
      [zoom, isZoomed, minScale, maxScale, setZoomClamped, translate],
    );
    const handleTouchMove = useCallback(
      (e: React.TouchEvent) => {
        if (e.touches.length === 2 && pinchStart.current) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          setZoomClamped(pinchStart.current.zoom * (dist / pinchStart.current.dist));
          e.preventDefault();
        } else if (e.touches.length === 1 && touchStart.current && isZoomed) {
          const nx = touchStart.current.tx + (e.touches[0].clientX - touchStart.current.x);
          const ny = touchStart.current.ty + (e.touches[0].clientY - touchStart.current.y);
          setTranslate(clampTranslate(nx, ny, zoom));
          e.preventDefault();
        }
      },
      [setZoomClamped, isZoomed, clampTranslate, zoom],
    );
    const handleTouchEnd = useCallback(() => {
      pinchStart.current = null;
      touchStart.current = null;
    }, []);

    // ── Download as image ───────────────────────────────────────────────
    const handleDownload = useCallback(async () => {
      // Capture inner content (skip zoom/transform wrapper) for clean rendering
      const inner = containerRef.current?.firstElementChild as HTMLElement | null;
      if (!inner) return;
      try {
        // 1. Swap all OSS image srcs → proxied URLs (same-origin, no CORS)
        const imgs = Array.from(inner.querySelectorAll("img")) as HTMLImageElement[];
        const originals: { img: HTMLImageElement; src: string }[] = [];
        imgs.forEach((img) => {
          if (!img.src || img.src.startsWith("data:")) return;
          originals.push({ img, src: img.src });
          img.src = `/api/proxy-image?url=${encodeURIComponent(img.src)}`;
        });

        // Small delay for proxied images to load
        await new Promise((r) => setTimeout(r, 300));

        // Strip highlight ring/shadow classes from block containers (NOT hide the blocks)
        const blocks = Array.from(inner.querySelectorAll("[data-sku-block-id]")) as HTMLElement[];
        const blockClasses: { el: HTMLElement; cls: string }[] = [];
        blocks.forEach((el) => {
          blockClasses.push({ el, cls: el.className });
          el.className = el.className
            .replace(/\bring-\S+/g, "")
            .replace(/\bshadow-\S+/g, "");
          el.style.boxShadow = "none";
        });

        // 2. Capture — hide overlays (NEW badge, pulse ring) via CSS
        inner.setAttribute("data-downloading", "");
        const canvas = await html2canvas(inner, { scale: 2, backgroundColor: null });
        inner.removeAttribute("data-downloading");

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

    // Compute a per-group cumulative tray Y list (in shelf coords, top-down).
    // L1 is always rendered at the top, so we walk layers in their natural
    // ascending order (index 0 → top, last index → bottom).
    const groupGeometry = layout.map((group, gi) => {
      const lh = allLayerHeights[gi] || [];
      const trays: { y: number; layerIdx: number; layerH: number }[] = [];
      let cursor = TOP_GAP;
      group.layers.forEach((_layer, idxFromTop) => {
        const layerIdx = idxFromTop;
        const layerH = lh[layerIdx] || 40;
        // Block area sits ABOVE the tray surface. Tray's visual top = cursor + layerH.
        const trayY = cursor + layerH;
        trays.push({ y: trayY, layerIdx, layerH });
        cursor = trayY + TRAY_H;
      });
      return { trays, cabinetY: totalHeight - CABINET_H };
    });

    return (
      <div ref={wrapperOuterRef} className="relative w-full">
        {/* New listing toggle */}
        <button
          type="button"
          onClick={() => setHighlightNewOnly((v) => !v)}
          aria-pressed={highlightNewOnly}
          className={`absolute top-2 left-2 z-20 flex items-center gap-1.5 rounded-md bg-card/90 border border-border px-2 py-1 shadow-sm transition-colors hover:bg-muted ${
            highlightNewOnly ? "ring-1 ring-amber-400" : ""
          }`}
        >
          <span className={`inline-block w-3 h-3 rounded-sm ring-2 ring-amber-400 ${highlightNewOnly ? "bg-amber-400" : "bg-amber-100"}`} />
          <span className={`text-[10px] text-foreground ${highlightNewOnly ? "font-bold" : "font-medium"}`}>上架</span>
        </button>

        <div
          ref={containerRef}
          className="relative rounded-lg overflow-hidden mx-auto"
          style={{
            width: containerSize.w || "100%",
            height: containerSize.h || undefined,
            cursor: isZoomed ? (dragging ? "grabbing" : "grab") : "default",
            touchAction: isZoomed ? "none" : "pan-y",
            background: "#f0f2f5",
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
            setTranslate({ x: 0, y: 0 });
          }}
        >
          <div
            style={{
              width: contentWidth,
              height: totalHeight,
              transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              position: "absolute",
              left: "50%",
              top: "50%",
              transition: dragging ? "none" : "transform 0.15s ease-out",
            }}
          >
            <TooltipProvider delayDuration={100}>
              {/* SVG layer = wood backdrop + trays + cabinet */}
              <svg
                viewBox={`0 0 ${contentWidth} ${totalHeight}`}
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  filter: "drop-shadow(0px 10px 20px rgba(0,0,0,0.15))",
                  pointerEvents: "none",
                }}
              >
                <defs>
                  <filter id="bk-woodFilter">
                    <feTurbulence type="fractalNoise" baseFrequency="0.015 0.1" numOctaves={3} result="turbulence" />
                    <feColorMatrix
                      in="turbulence"
                      type="matrix"
                      values="0.55 0.25 0.10 0 0  0.45 0.20 0.08 0 0  0.35 0.15 0.05 0 0  0 0 0 1 0"
                      result="coloredWood"
                    />
                    <feComponentTransfer in="coloredWood" result="finalWood">
                      <feFuncR type="linear" slope="1.4" intercept="0.2" />
                      <feFuncG type="linear" slope="1.4" intercept="0.2" />
                      <feFuncB type="linear" slope="1.4" intercept="0.2" />
                    </feComponentTransfer>
                  </filter>
                  <pattern id="bk-woodLight" x="0" y="0" width={contentWidth} height={totalHeight} patternUnits="userSpaceOnUse">
                    <rect width={contentWidth} height={totalHeight} fill="#e8d3b8" />
                    <rect width={contentWidth} height={totalHeight} filter="url(#bk-woodFilter)" opacity="0.5" />
                  </pattern>
                  <pattern id="bk-woodMedium" x="0" y="0" width={contentWidth} height={totalHeight} patternUnits="userSpaceOnUse">
                    <rect width={contentWidth} height={totalHeight} fill="#c4ad93" />
                    <rect width={contentWidth} height={totalHeight} filter="url(#bk-woodFilter)" opacity="0.6" />
                  </pattern>
                  <pattern id="bk-woodDark" x="0" y="0" width={contentWidth} height={totalHeight} patternUnits="userSpaceOnUse">
                    <rect width={contentWidth} height={totalHeight} fill="#9e8a73" />
                    <rect width={contentWidth} height={totalHeight} filter="url(#bk-woodFilter)" opacity="0.8" />
                  </pattern>
                  <pattern id="bk-woodBack" x="0" y="0" width={contentWidth} height={totalHeight} patternUnits="userSpaceOnUse">
                    <rect width={contentWidth} height={totalHeight} fill="#a88f72" />
                    <rect width={contentWidth} height={totalHeight} filter="url(#bk-woodFilter)" opacity="0.7" />
                  </pattern>
                  <pattern id="bk-woodTop" x="0" y="0" width={contentWidth} height={totalHeight} patternUnits="userSpaceOnUse">
                    <rect width={contentWidth} height={totalHeight} fill="#d4bd9a" />
                    <rect width={contentWidth} height={totalHeight} filter="url(#bk-woodFilter)" opacity="0.55" />
                  </pattern>
                  <filter id="bk-softShadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
                    <feOffset dx="0" dy="8" result="offsetblur" />
                    <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
                  </filter>
                  <filter id="bk-groundShadow" x="-10%" y="-10%" width="120%" height="120%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
                    <feOffset dx="0" dy="4" />
                    <feComponentTransfer><feFuncA type="linear" slope="0.5" /></feComponentTransfer>
                  </filter>
                </defs>

                {/* Back panel — covers whole shelf height behind trays */}
                <g>
                  <rect x="0" y={TOP_GAP - 50} width={contentWidth} height={totalHeight - (TOP_GAP - 50)} fill="url(#bk-woodBack)" />
                  {/* Group dividers */}
                  {layout.length > 1 &&
                    layout.slice(0, -1).map((_, gi) => {
                      const x = ((gi + 1) * contentWidth) / layout.length;
                      return (
                        <line
                          key={gi}
                          x1={x} y1={TOP_GAP - 50}
                          x2={x} y2={totalHeight}
                          stroke="#8c6a4a" strokeWidth="1" opacity="0.4"
                        />
                      );
                    })}
                </g>

                {/* Trays (per group) */}
                {layout.map((group, gi) => {
                  const groupW = contentWidth / layout.length;
                  const xOffset = gi * groupW;
                  const innerW = groupW - SIDE_PAD * 2;
                  return (
                    <g key={`trays-${group.groupIndex}`} transform={`translate(${xOffset}, 0)`}>
                      {groupGeometry[gi].trays.map((t, i) => (
                        <g key={i} transform={`translate(0, ${t.y})`}>
                          {/* shadow */}
                          <rect x={SIDE_PAD} y={35} width={innerW} height={40} fill="#000" filter="url(#bk-softShadow)" />
                          {/* lip */}
                          <g transform={`translate(${SIDE_PAD}, 0)`}>
                            <polygon points={`20,0 ${innerW - 20},0 ${innerW},40 0,40`} fill="url(#bk-woodMedium)" />
                            <polygon points="0,0 20,0 0,40" fill="url(#bk-woodDark)" />
                            <polygon points={`${innerW},0 ${innerW - 20},0 ${innerW},40`} fill="url(#bk-woodDark)" />
                            {/* surface */}
                            <g transform="translate(0, 40)">
                              <rect x="0" y="0" width={innerW} height="35" fill="url(#bk-woodLight)" stroke="#cba987" strokeWidth="0.5" />
                              <line x1="1" y1="1" x2={innerW - 1} y2="1" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.5" />
                            </g>
                          </g>
                        </g>
                      ))}
                      {/* Base cabinet */}
                      <g transform={`translate(0, ${groupGeometry[gi].cabinetY})`}>
                        <rect x={SIDE_PAD} y={140} width={innerW} height="10" fill="#000" filter="url(#bk-groundShadow)" />
                        <g transform={`translate(${SIDE_PAD}, 0)`}>
                          <rect x="0" y="0" width="10" height="150" fill="url(#bk-woodDark)" />
                          <rect x={innerW - 10} y="0" width="10" height="150" fill="url(#bk-woodDark)" />
                          <polygon points={`10,0 ${innerW - 10},0 ${innerW},20 0,20`} fill="url(#bk-woodTop)" stroke="#cba987" strokeWidth="0.5" />
                          <g transform="translate(0, 20)">
                            <rect x="0" y="0" width={innerW} height="120" fill="url(#bk-woodLight)" stroke="#cba987" strokeWidth="0.5" />
                            <line x1={innerW / 2} y1="2" x2={innerW / 2} y2="118" stroke="#8c6a4a" strokeWidth="1.5" />
                            <line x1="1" y1="1" x2={innerW - 1} y2="1" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.5" />
                            <rect x="0" y="120" width={innerW} height="10" fill="url(#bk-woodDark)" />
                          </g>
                        </g>
                      </g>
                    </g>
                  );
                })}
              </svg>

              {/* HTML layer for products + layer-label popovers (interactive) */}
              {layout.map((group, gi) => {
                const groupW = contentWidth / layout.length;
                const xOffset = gi * groupW;
                const innerW = groupW - SIDE_PAD * 2;
                const productBandLeft = SIDE_FRAME;
                const productBandWidth = innerW - SIDE_FRAME * 2;
                return (
                  <div
                    key={`group-${group.groupIndex}`}
                    style={{
                      position: "absolute",
                      left: xOffset + SIDE_PAD,
                      top: 0,
                      width: innerW,
                      height: totalHeight,
                    }}
                  >
                    {groupGeometry[gi].trays.map((t, i) => {
                      const layer = group.layers[t.layerIdx];
                      const layerNum = layer.layerIndex;
                      const layerReason = layer.reason || layer.blocks[0]?.reason;
                      // Product band sits ON the wooden plank (front of tray) instead of the back wall.
                      const bandTop = t.y - t.layerH + TRAY_SURFACE_H;
                      return (
                        <div key={`layer-${layer.layerIndex}`}>
                          {/* Layer label — pushed OUT of the inner tray area, onto the
                              left frame so it never covers the leftmost product. */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                style={{
                                  position: "absolute",
                                  left: -SIDE_PAD + 2,
                                  top: bandTop - 22,
                                  fontSize: 12,
                                  color: "hsl(var(--foreground))",
                                  background: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: 6,
                                  padding: "3px 6px",
                                  minWidth: 28,
                                  fontWeight: 600,
                                  lineHeight: 1,
                                  zIndex: 5,
                                  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                                }}
                              >
                                L{layerNum}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="right" align="center" className="max-w-[260px] w-auto p-3">
                              <div className="text-xs font-semibold mb-1">第 {layerNum} 层 · 陈列理由</div>
                              <div className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap">
                                {layerReason || "暂无该层陈列理由"}
                              </div>
                            </PopoverContent>
                          </Popover>

                          {/* Product blocks band — sits on the tray surface, inset
                              from the cabinet side planks and clipped so nothing
                              overhangs the visible wood frame. */}
                          <div
                            style={{
                              position: "absolute",
                              left: productBandLeft,
                              top: bandTop,
                              width: productBandWidth,
                              height: t.layerH,
                              zIndex: 2,
                              overflow: "hidden",
                            }}
                          >
                            {/* Promo group highlight overlays */}
                            {computePromoGroups(layer.blocks).map((g) => (
                              <div
                                key={`promo-hl-${layer.layerIndex}-${g.promoset}`}
                                className="vf-promo-highlight"
                                style={{
                                  position: "absolute",
                                  left: `${g.leftRatio * 100}%`,
                                  width: `${(g.rightRatio - g.leftRatio) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  zIndex: 5,
                                  border: "1px solid rgba(24, 144, 255, 0.35)",
                                  borderRadius: 4,
                                  boxShadow: "0 0 12px 3px rgba(24, 144, 255, 0.35)",
                                  background: "rgba(24, 144, 255, 0.04)",
                                  pointerEvents: "none",
                                }}
                              />
                            ))}
                            {layer.blocks.map((block) => (
                              <BakeryBlockRender
                                key={block.id}
                                block={block}
                                layerH={t.layerH}
                                pxPerCm={pxPerCm}
                                containerWidth={productBandWidth}
                                isHovered={hoveredBlock === block.id}
                                isDimmed={hoveredBlock !== null && hoveredBlock !== block.id}
                                onHover={setHoveredBlock}
                                highlightNewOnly={highlightNewOnly}
                              />
                            ))}
                          </div>
                          {/* Promo activity tags */}
                          {computePromoGroups(layer.blocks).map((g) => {
                            const tagLeftPx = productBandLeft + ((g.leftRatio + g.rightRatio) / 2) * productBandWidth;
                            return (
                              <img
                                key={`promo-${layer.layerIndex}-${g.promoset}`}
                                src={getPromoTagUrl(g.promoset)}
                                alt=""
                                className="vf-promo-tag"
                                style={{
                                  position: "absolute",
                                  left: tagLeftPx,
                                  top: bandTop + t.layerH,
                                  transform: "translate(-50%, -100%)",
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
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </TooltipProvider>
          </div>
        </div>

        {/* Zoom toolbar */}
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <button
            onClick={() => setZoomClamped(zoom + 0.3)}
            className="w-8 h-8 rounded-lg bg-card border border-border shadow-sm flex items-center justify-center text-foreground hover:bg-muted transition-colors text-lg font-bold"
            aria-label="放大"
          >+</button>
          <button
            onClick={() => setZoomClamped(zoom - 0.3)}
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
    );
  },
);
WoodenShelfView.displayName = "WoodenShelfView";

/** A single product block on the bakery tray (visually identical to fridge variant). */
const BakeryBlockRender = ({
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
  const blockWidthPct = (block.endRatio - block.startRatio) * 100;
  const imgWidthPx = (block.endRatio - block.startRatio) * containerWidth;
  const rawHeightPx = block.heightCm * pxPerCm;
  const imgHeightPx = Math.min(rawHeightPx, layerH - 2);
  const facing = block.facing || 1;
  const upfacing = block.upfacing || 0;

  const [clicked, setClicked] = useState(false);
  const open = isHovered || clicked;
  useEffect(() => {
    if (!clicked) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(`[data-sku-block-id="${block.id}"]`)) setClicked(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [clicked, block.id]);

  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

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
    if (upfacing > 0) {
      const stackH = imgHeightPx / upfacing;
      return (
        <div className="flex flex-col items-center justify-end" style={{ height: imgHeightPx }}>
          {Array.from({ length: upfacing }).map((_, i) => (
            <img key={i} src={imageUrl} alt={block.skuName}
              style={{ width: imgWidthPx, height: stackH, objectFit: "fill" }}
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ))}
        </div>
      );
    }
    if (facing > 1) {
      const singleW = imgWidthPx / facing;
      return (
        <div className="flex items-end justify-center" style={{ height: imgHeightPx }}>
          {Array.from({ length: facing }).map((_, i) => (
            <img key={i} src={imageUrl} alt={block.skuName}
              style={{ width: singleW, height: imgHeightPx, objectFit: "fill" }}
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ))}
        </div>
      );
    }
    return (
      <img src={imageUrl} alt={block.skuName}
        style={{ width: imgWidthPx, height: imgHeightPx, objectFit: "fill" }}
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
    );
  };

  return (
    <Tooltip open={open} onOpenChange={(o) => { if (!o) setClicked(false); }}>
      <TooltipTrigger asChild>
        <div
          data-sku-block-id={block.id}
          draggable={false}
          className={[
            "absolute transition-all",
            isDimmed ? "opacity-30" : "",
            (highlightNewOnly && !block.isNewListing) ? "opacity-25 grayscale-[0.4]" : "",
            (isHovered || clicked) ? "z-10 ring-1 ring-foreground/50" : "",
            block.isNewListing ? "ring-2 ring-amber-400/70" : "",
            (block.isNewListing && !highlightNewOnly) ? "shadow-[0_0_12px_3px_rgba(251,191,36,0.45)]" : "",
            (block.isNewListing && highlightNewOnly) ? "z-10" : "",
          ].filter(Boolean).join(" ")}
          style={{
            left: `${block.startRatio * 100}%`,
            width: `${blockWidthPct}%`,
            height: `${layerH - 2}px`,
            bottom: 0,
            userSelect: "none",
            WebkitUserSelect: "none",
            // @ts-expect-error vendor property
            WebkitUserDrag: "none",
          }}
          onMouseEnter={() => onHover(block.id)}
          onMouseLeave={() => onHover(null)}
          onPointerDown={(e) => { pointerDownPos.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={(e) => {
            const start = pointerDownPos.current;
            pointerDownPos.current = null;
            if (!start) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) setClicked((c) => !c);
          }}
          onDragStart={(e) => e.preventDefault()}
        >
          {block.isNewListing && (
            <span className="absolute -top-0.5 -right-0.5 z-20 bg-amber-400 text-white text-[9px] font-bold leading-none px-1 py-0.5 rounded shadow-sm pointer-events-none">
              NEW
            </span>
          )}
          {block.isNewListing && (
            <span className={`absolute inset-0 ring-2 animate-pulse pointer-events-none ${highlightNewOnly ? "ring-amber-400/40" : "ring-amber-400/60"}`} />
          )}
          <div className="w-full h-full flex items-end justify-center overflow-hidden" style={{ backgroundColor: "transparent", border: "none" }}>
            {renderImages()}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px]" onPointerDownOutside={() => setClicked(false)}>
        {block.isNewListing && <p className="text-xs font-semibold text-amber-600 mb-1">本次上架</p>}
        <p className="text-sm font-semibold leading-tight">{block.skuName}</p>
        <p className="text-xs text-muted-foreground mt-0.5">编码:{block.skuCode || "—"}</p>
        <p className="text-xs text-muted-foreground">{block.subcategory}</p>
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
