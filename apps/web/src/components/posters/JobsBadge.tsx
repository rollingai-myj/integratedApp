// Live "generating X/Y" indicator for the Home header, plus the
// completion-results drawer it opens. Aggregates the entire current Session
// (which may span multiple underlying batches) into one view.
import * as React from "react";
import { createPortal } from "react-dom";
import { TOKENS } from "./tokens";
import { Icon } from "./icons";
import { useJobs, type SessionView, type Job } from "./JobsContext";
import { saveSession, isSessionSaved } from "./sessionHistory";
import { getHostContext } from "./host-bridge";
import { useIOSDeviceZoom } from "@/components/IOSDevice";

/**
 * SessionDrawer / preview / RequeueSheet 都用 position:fixed 顶满视口。
 * 但整合后 PosterApp 被 IOSDevice 套了 `zoom: viewportW/390` 容器，CSS zoom 容器
 * 下的 fixed 子元素并不真正 fixed 到视口，inset:0 / height:92vh 等会按 zoom 倍率
 * 放大（实测 1280×800 视口下抽屉 inner 顶到 -1616px，整张抽屉飞出屏幕，
 * 用户只看到一片黑）。所以全部 portal 到 document.body，跳出 zoom 容器。
 */
function BodyPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<>{children}</>, document.body);
}
import { STYLES } from "./styles";
import type { PosterStyleId } from "./ai";
import { saveImages } from "./lib/download";
import { LongPressGallery } from "./LongPressGallery";

export function JobsBadge({ accent, bottomOffset = 24 }: { accent: string; bottomOffset?: number }) {
  const { activeSession } = useJobs();
  const [open, setOpen] = React.useState(false);

  if (!activeSession) return null;
  const s = activeSession;

  const allDone = s.active === 0 && s.error === 0;
  const hasError = s.error > 0;
  const inFlight = s.active > 0;

  const bg = inFlight
    ? `linear-gradient(135deg, ${accent}, #c81e2a)`
    : (hasError ? "linear-gradient(135deg,#f59e0b,#d97706)" : "linear-gradient(135deg,#10b981,#059669)");
  const shadowColor = inFlight ? accent : (hasError ? "#f59e0b" : "#10b981");

  const progress = s.total > 0 ? Math.min(1, s.done / s.total) : 0;
  const R = 28;
  const C = 2 * Math.PI * R;

  const mainText = inFlight
    ? `${s.done}/${s.total}`
    : hasError
      ? `${s.error}`
      : `${s.done}`;
  const subText = inFlight ? "生成中" : hasError ? "有失败" : "已完成";

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="本组生成进度" style={{
        position: "absolute", right: 16, bottom: bottomOffset, zIndex: 50,
        appearance: "none", border: 0, cursor: "pointer", padding: 0,
        width: 76, height: 76, borderRadius: "50%",
        background: bg, color: "#fff",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "inherit",
        boxShadow: `0 12px 28px ${shadowColor}88, 0 0 0 4px rgba(255,255,255,0.9)`,
        animation: inFlight
          ? "jb-pulse 1.6s ease-in-out infinite"
          : (allDone ? "jb-bounce 1.8s ease-in-out infinite" : "none"),
      }}>
        {/* progress ring (only while in flight) */}
        {inFlight && (
          <svg width="76" height="76" viewBox="0 0 76 76" style={{
            position: "absolute", inset: 0, transform: "rotate(-90deg)",
          }}>
            <circle cx="38" cy="38" r={R} fill="none"
              stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
            <circle cx="38" cy="38" r={R} fill="none"
              stroke="#fff" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - progress)}
              style={{ transition: "stroke-dashoffset 0.4s ease" }} />
          </svg>
        )}
        <div style={{
          fontSize: 18, fontWeight: 800, lineHeight: 1, letterSpacing: 0.3,
          display: "flex", alignItems: "center", gap: 3,
        }}>
          {!inFlight && allDone && <Icon.Check size={16} color="#fff" />}
          {!inFlight && hasError && <span style={{ fontSize: 18 }}>!</span>}
          {mainText}
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, marginTop: 3, opacity: 0.95 }}>
          {subText}
        </div>
      </button>
      <style>{`
        @keyframes jb-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes jb-spin { to { transform: rotate(360deg); } }
        @keyframes jb-bounce {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
      {open && <SessionDrawer accent={accent} session={s} onClose={() => setOpen(false)} />}
    </>
  );
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "刚刚开始";
  if (mins < 60) return `已 ${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `已 ${h} 小时` : `已 ${h} 小时 ${m} 分钟`;
}

function SessionDrawer({ accent, session, onClose }: { accent: string; session: SessionView; onClose: () => void }) {
  const { dismissCurrentSession, endCurrentSession, requeueJob } = useJobs();
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(() => isSessionSaved(session.id));
  const [toast, setToast] = React.useState<string | null>(null);
  const [requeueFor, setRequeueFor] = React.useState<Job | null>(null);
  const [longPressUrls, setLongPressUrls] = React.useState<string[] | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  // 抽屉 portal 到 body 后跳出了 IOSDevice 的 zoom 容器，里面字号/padding 都是裸 px，
  // 视觉上比 phone 内部（被 zoom 3x+ 放大）小一截。把 IOSDevice 的 zoom 加回到抽屉
  // inner 上，让视觉等比。补偿：maxWidth 用设计稿宽度、height 用 (92/zoom)vh，
  // 保证 zoom 后视觉宽度 = 视口宽 / 视觉高度 = 92vh。
  const ctxZoom = useIOSDeviceZoom();
  const zoom = ctxZoom?.zoom ?? 1;
  const drawerMaxWidth = ctxZoom?.designWidth ?? 480;

  const successful = session.jobs.filter(j => !!j.result_image_url);
  const startLabel = new Date(session.startedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const durationLabel = formatDuration(Date.now() - session.startedAt);

  const flashToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 1600);
  };

  const handleSave = () => {
    if (saved || successful.length === 0) return;
    saveSession({
      id: session.id,
      startedAt: session.startedAt,
      endedAt: Date.now(),
      total: session.total,
      // 落 storeId：销量跟踪 tab 据此过滤，确保 A 店做的 SKU 不会在 B 店销量页冒出来
      storeId: getHostContext()?.storeId ?? null,
      items: successful.map(j => ({
        imageUrl: j.result_image_url!,
        copy: j.params?.copy,
        sku: j.params?.sku ?? null,
      })),
    });
    setSaved(true);
    endCurrentSession("saved");
    flashToast("已保存到历史 ✓");
  };

  const runSave = async (urls: string[]) => {
    if (downloading || urls.length === 0) return;
    setDownloading(true);
    try {
      const r = await saveImages(urls, "poster");
      if (r.kind === "longpress") setLongPressUrls(r.urls);
      else if (r.kind === "downloaded") flashToast(`已下载 ${r.count} 张`);
      else if (r.kind === "failed") flashToast("下载失败，请重试");
      // 'shared' → system sheet handled feedback
    } finally {
      setDownloading(false);
    }
  };
  const download = (url: string) => runSave([url]);
  const downloadAll = () => runSave(successful.map(j => j.result_image_url!));

  const handleClear = async () => {
    await dismissCurrentSession();
    onClose();
  };

  const handleNewBatch = () => {
    if (!saved && successful.length > 0) {
      const ok = confirm("还没保存到历史，结束本组后这些海报就找不到了。要继续吗？");
      if (!ok) return;
    }
    endCurrentSession("new-batch");
    onClose();
  };

  return (
    <BodyPortal>
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.55)",
      animation: "fadeIn 0.25s ease",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: TOKENS.bg, width: "100%",
        maxWidth: drawerMaxWidth,
        height: `${92 / zoom}vh`,
        zoom,
        borderRadius: "24px 24px 0 0",
        padding: "20px 18px 0",
        display: "flex", flexDirection: "column",
        animation: "slideUp 0.32s cubic-bezier(0.2,0.8,0.2,1) both",
        boxSizing: "border-box",
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ddd", margin: "-6px auto 14px", flexShrink: 0 }} />
        <button onClick={onClose} aria-label="关闭" style={{
          position: "absolute", top: 14, right: 14,
          appearance: "none", border: 0, background: "rgba(0,0,0,0.06)",
          width: 32, height: 32, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: TOKENS.ink, fontSize: 20, fontWeight: 500,
          fontFamily: "inherit", lineHeight: 1, zIndex: 5, paddingBottom: 2,
        }}>×</button>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, gap: 8, paddingRight: 40 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TOKENS.ink }}>本组生成</div>
            <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
              {startLabel} 开始 · {durationLabel}
            </div>
            <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
              共 {session.total} 张 · 完成 {session.done} · 失败 {session.error} · 进行中 {session.active}
              {session.batchIds.length > 1 && (
                <span style={{ marginLeft: 4 }}>· {session.batchIds.length} 批</span>
              )}
            </div>
          </div>
          {session.allFinal && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={handleSave}
                disabled={saved || successful.length === 0}
                style={{
                  appearance: "none", border: 0,
                  background: saved ? "#e5e7eb" : accent,
                  color: saved ? "#6b7280" : "#fff",
                  padding: "6px 14px", borderRadius: 14,
                  fontSize: 12, fontWeight: 700,
                  cursor: saved || successful.length === 0 ? "default" : "pointer",
                  fontFamily: "inherit",
                  boxShadow: saved ? "none" : `0 4px 12px ${accent}55`,
                }}>{saved ? "已保存" : "保存到历史"}</button>
              <button onClick={handleClear} style={{
                appearance: "none", border: `1px solid ${TOKENS.line}`, background: "#fff",
                color: TOKENS.inkSoft, padding: "6px 12px", borderRadius: 14,
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>清除</button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {session.jobs.map(j => (
              <SessionThumb
                key={j.id}
                job={j}
                accent={accent}
                onPreview={(url) => setPreviewUrl(url)}
                onDownload={download}
                onRequeue={(job) => setRequeueFor(job)}
              />
            ))}
          </div>
        </div>

        {session.allFinal && (
          <div style={{
            flexShrink: 0,
            padding: "12px 0 20px",
            borderTop: `1px solid ${TOKENS.lineSoft}`,
            background: TOKENS.bg,
            display: "flex", gap: 8,
          }}>
            <button onClick={downloadAll} disabled={successful.length === 0 || downloading} style={{
              flex: 1, appearance: "none", border: `1px solid ${TOKENS.line}`,
              background: "#fff", color: TOKENS.ink,
              height: 46, borderRadius: 14,
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              cursor: successful.length === 0 || downloading ? "default" : "pointer",
              opacity: successful.length === 0 ? 0.5 : 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              {downloading ? (
                <>
                  <span style={{
                    width: 14, height: 14, borderRadius: "50%",
                    border: "2px solid rgba(0,0,0,0.2)", borderTopColor: TOKENS.ink,
                    animation: "jb-spin 0.8s linear infinite",
                  }} />
                  准备中…
                </>
              ) : (
                <>
                  <Icon.Download size={16} color={TOKENS.ink} />
                  全部下载
                </>
              )}
            </button>
            <button onClick={handleNewBatch} style={{
              flex: 1.4, appearance: "none", border: 0,
              background: `linear-gradient(135deg, ${accent}, ${TOKENS.redDark})`,
              color: "#fff", height: 46, borderRadius: 14,
              fontSize: 14, fontWeight: 800, fontFamily: "inherit",
              cursor: "pointer", boxShadow: `0 6px 16px ${accent}55`,
            }}>再做一组 ↗</button>
          </div>
        )}

        {toast && (
          <div style={{
            position: "absolute", left: "50%", bottom: 90,
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.82)", color: "#fff",
            padding: "8px 16px", borderRadius: 18,
            fontSize: 12, fontWeight: 600,
            zIndex: 20, pointerEvents: "none",
          }}>{toast}</div>
        )}

        {previewUrl && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 10,
            background: "rgba(0,0,0,0.92)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeIn 0.2s ease",
          }} onClick={() => setPreviewUrl(null)}>
            <button onClick={(e) => { e.stopPropagation(); setPreviewUrl(null); }}
              aria-label="关闭预览" style={{
                position: "absolute", top: 16, right: 16, zIndex: 2,
                appearance: "none", border: 0, background: "rgba(255,255,255,0.16)",
                width: 38, height: 38, borderRadius: "50%", color: "#fff",
                fontSize: 22, fontWeight: 500, lineHeight: 1, paddingBottom: 2,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", backdropFilter: "blur(8px)", fontFamily: "inherit",
              }}>×</button>
            <img src={previewUrl} alt="预览"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              onClick={e => e.stopPropagation()} />
          </div>
        )}

        {requeueFor && (
          <RequeueSheet
            accent={accent}
            sourceJob={requeueFor}
            onClose={() => setRequeueFor(null)}
            onConfirm={async (payload) => {
              try {
                await requeueJob(requeueFor, payload);
                setRequeueFor(null);
              } catch (e: any) {
                flashToast(e?.message || "重新生成失败，请重试");
              }
            }}
          />
        )}


        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
          @keyframes jb-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
      {longPressUrls && (
        <LongPressGallery urls={longPressUrls} onClose={() => setLongPressUrls(null)} />
      )}
    </div>
    </BodyPortal>
  );
}

function SessionThumb({ job, accent, onPreview, onDownload, onRequeue }: {
  job: Job;
  accent: string;
  onPreview: (url: string) => void;
  onDownload: (url: string) => void;
  onRequeue: (job: Job) => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const url = job.result_image_url;
  const canRequeue = job.status === "done" || job.status === "error";

  return (
    <div style={{
      aspectRatio: "3/4", borderRadius: 10, background: "#1a1a1a",
      position: "relative", overflow: "hidden", boxShadow: TOKENS.shadow1,
      cursor: url ? "pointer" : "default",
    }} onClick={() => url && onPreview(url)}>
      {url && (
        <img src={url} alt="" onLoad={() => setLoaded(true)}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.3s ease",
          }} />
      )}
      {(!url || !loaded) && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 11, fontWeight: 700, textAlign: "center", padding: 8,
          background: url
            ? "linear-gradient(110deg, #1a1a1a 30%, #2a2a2a 50%, #1a1a1a 70%)"
            : "#1a1a1a",
          backgroundSize: url ? "200% 100%" : undefined,
          animation: url ? "jb-shimmer 1.4s linear infinite" : undefined,
        }}>
          {!url && job.status === "queued" && "排队中…"}
          {!url && job.status === "processing" && (<>
            <span style={{ display: "inline-block", marginRight: 6,
              width: 12, height: 12, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff",
              animation: "jb-spin 0.8s linear infinite",
            }} />
            生成中…
          </>)}
          {!url && job.status === "error" && (
            <div>
              <div style={{ color: "#fca5a5", marginBottom: 4 }}>失败</div>
              <div style={{ opacity: 0.7, fontSize: 10, lineHeight: 1.3 }}>
                {(job.error || "").slice(0, 40)}
              </div>
            </div>
          )}
          {url && !loaded && (
            <span style={{
              width: 18, height: 18, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.25)",
              borderTopColor: "#fff",
              animation: "jb-spin 0.8s linear infinite",
            }} />
          )}
        </div>
      )}
      {canRequeue && (
        <button onClick={(e) => { e.stopPropagation(); onRequeue(job); }} style={{
          position: "absolute", bottom: 6, left: 6,
          appearance: "none", border: 0,
          background: "rgba(0,0,0,0.65)", color: "#fff",
          width: 30, height: 30, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          backdropFilter: "blur(6px)",
        }} aria-label="重新生成">
          <Icon.Refresh size={14} color="#fff" />
        </button>
      )}
      {url && loaded && (
        <button onClick={(e) => { e.stopPropagation(); onDownload(url); }} style={{
          position: "absolute", bottom: 6, right: 6,
          appearance: "none", border: 0,
          background: accent, color: "#fff",
          width: 30, height: 30, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
        }} aria-label="下载">
          <Icon.Download size={14} color="#fff" />
        </button>
      )}
      <style>{`
        @keyframes jb-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

type RequeuePayload = {
  styleId: PosterStyleId;
  customStyle?: string | null;
  copy?: string;
  newPhotoBase64?: string;
};

function RequeueSheet({ accent, sourceJob, onClose, onConfirm }: {
  accent: string;
  sourceJob: Job;
  onClose: () => void;
  onConfirm: (payload: RequeuePayload) => void | Promise<void>;
}) {
  const initialStyle = (sourceJob.params?.styleId as PosterStyleId) || "vibrant";
  const initialCustom = typeof sourceJob.params?.customStyle === "string"
    ? sourceJob.params.customStyle as string
    : "";
  const initialCopy = typeof sourceJob.params?.copy === "string"
    ? sourceJob.params.copy as string
    : "";
  const [styleId, setStyleId] = React.useState<PosterStyleId>(initialStyle);
  const [customText, setCustomText] = React.useState<string>(initialCustom);
  const [copyText, setCopyText] = React.useState<string>(initialCopy);
  const [photoSource, setPhotoSource] = React.useState<"reuse" | "retake">("reuse");
  const [newPhoto, setNewPhoto] = React.useState<string | null>(null); // dataURL
  const [submitting, setSubmitting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const trimmedCopy = copyText.trim();
  const copyValid = trimmedCopy.length >= 1;
  const photoValid = photoSource === "reuse" || !!newPhoto;
  const styleValid = styleId !== "custom" || customText.trim().length >= 2;
  const canConfirm = !submitting && copyValid && photoValid && styleValid;

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    try {
      const { compressImage } = await import("./lib/compressImage");
      const dataUrl = await compressImage(file);
      setNewPhoto(dataUrl);
      setPhotoSource("retake");
    } catch (e) {
      console.warn("[requeue] compress fail", e);
    }
  };

  const submit = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      const payload: RequeuePayload = {
        styleId,
        customStyle: styleId === "custom" ? customText.trim() : null,
      };
      if (trimmedCopy && trimmedCopy !== initialCopy.trim()) {
        payload.copy = trimmedCopy;
      }
      if (photoSource === "retake" && newPhoto) {
        payload.newPhotoBase64 = newPhoto;
      }
      await onConfirm(payload);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 12,
      background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      animation: "fadeIn 0.18s ease",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: TOKENS.bg, width: "100%",
        borderRadius: "20px 20px 0 0",
        padding: "16px 16px 18px",
        animation: "slideUp 0.28s cubic-bezier(0.2,0.8,0.2,1) both",
        boxSizing: "border-box",
        maxHeight: "88%", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#ddd", margin: "-4px auto 12px" }} />

        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
          {sourceJob.result_image_url ? (
            <img src={sourceJob.result_image_url} alt=""
              style={{ width: 52, height: 70, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "#1a1a1a" }} />
          ) : (
            <div style={{ width: 52, height: 70, borderRadius: 8, background: "#1a1a1a", flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink }}>重新生成一张</div>
            <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 4, lineHeight: 1.4 }}>
              可以改文案、换照片、换风格
            </div>
          </div>
        </div>

        {/* 海报文案 */}
        <div style={{
          background: "#fff", borderRadius: 12, padding: 10, marginBottom: 10,
          border: `1px solid ${TOKENS.lineSoft}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 6 }}>
            海报文案
          </div>
          <textarea
            value={copyText}
            onChange={e => setCopyText(e.target.value.slice(0, 200))}
            rows={3}
            placeholder="写一句海报上的文案"
            style={{
              width: "100%", boxSizing: "border-box",
              background: TOKENS.bg, border: `1px solid ${TOKENS.line}`,
              borderRadius: 10, padding: "10px 12px",
              fontSize: 13, color: TOKENS.ink, fontFamily: "inherit",
              resize: "none", outline: "none", lineHeight: 1.5,
            }}
          />
          <div style={{ fontSize: 10, color: TOKENS.inkMuted, textAlign: "right", marginTop: 2 }}>
            {copyText.length}/200
          </div>
        </div>

        {/* 商品照片 */}
        <div style={{
          background: "#fff", borderRadius: 12, padding: 10, marginBottom: 10,
          border: `1px solid ${TOKENS.lineSoft}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 8 }}>
            商品照片
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => setPhotoSource("reuse")}
              style={{
                appearance: "none", cursor: "pointer", fontFamily: "inherit",
                width: "100%", padding: 8, borderRadius: 10, textAlign: "left",
                background: photoSource === "reuse" ? `${accent}10` : "#fff",
                border: photoSource === "reuse" ? `2px solid ${accent}` : `1px solid ${TOKENS.line}`,
                color: TOKENS.ink,
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                background: `${accent}18`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon.Image size={20} color={accent} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>用之前的照片</div>
                <div style={{ fontSize: 11, color: TOKENS.inkSoft, marginTop: 2 }}>
                  沿用上次的实拍
                </div>
              </div>
              {photoSource === "reuse" && (
                <div style={{
                  width: 20, height: 20, borderRadius: 10, background: accent,
                  color: "#fff", fontSize: 12, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>✓</div>
              )}
            </button>

            <button
              onClick={() => fileRef.current?.click()}
              style={{
                appearance: "none", cursor: "pointer", fontFamily: "inherit",
                width: "100%", padding: 8, borderRadius: 10, textAlign: "left",
                background: photoSource === "retake" ? `${accent}10` : "#fff",
                border: photoSource === "retake" ? `2px solid ${accent}` : `1px solid ${TOKENS.line}`,
                color: TOKENS.ink,
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              {newPhoto ? (
                <img src={newPhoto} alt="" style={{
                  width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0,
                  border: `1px solid ${TOKENS.line}`,
                }} />
              ) : (
                <div style={{
                  width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                  background: `${accent}18`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon.Camera size={20} color={accent} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {newPhoto ? "已选新照片，点击更换" : "重新拍 / 上传商品照"}
                </div>
                <div style={{ fontSize: 11, color: TOKENS.inkSoft, marginTop: 2 }}>
                  支持拍照或从相册上传
                </div>
              </div>
              {photoSource === "retake" && newPhoto && (
                <div style={{
                  width: 20, height: 20, borderRadius: 10, background: accent,
                  color: "#fff", fontSize: 12, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>✓</div>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment"
              style={{ display: "none" }}
              onChange={e => handleFile(e.target.files?.[0])} />
          </div>

          <div style={{
            marginTop: 10, padding: "8px 10px", borderRadius: 8,
            background: "#FFF7E6", border: "1px solid #FCE4A6",
            fontSize: 12, color: "#92500A", lineHeight: 1.45,
          }}>
            💡 觉得 AI 生成的商品图不够还原？建议上传一张实拍照，效果会更准。
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 8 }}>选择风格</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {STYLES.map(s => {
            const active = styleId === s.id;
            return (
              <button key={s.id} onClick={() => setStyleId(s.id)} style={{
                appearance: "none", cursor: "pointer", padding: 0,
                borderRadius: 10, overflow: "hidden", background: "#fff",
                border: active ? `2.5px solid ${accent}` : `1px solid ${TOKENS.line}`,
                fontFamily: "inherit",
              }}>
                <div style={{ aspectRatio: "3/4", background: "#eee" }}>
                  <img src={s.img} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ padding: "5px 0", fontSize: 11, fontWeight: 700, color: active ? accent : TOKENS.ink }}>
                  {s.name}
                </div>
              </button>
            );
          })}
          <button onClick={() => setStyleId("custom")} style={{
            appearance: "none", cursor: "pointer", padding: 0,
            borderRadius: 10, overflow: "hidden", background: "#fff",
            border: styleId === "custom" ? `2.5px solid ${accent}` : `1px solid ${TOKENS.line}`,
            fontFamily: "inherit",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{
              aspectRatio: "3/4",
              background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22,
            }}>✨</div>
            <div style={{ padding: "5px 0", fontSize: 11, fontWeight: 700,
              color: styleId === "custom" ? accent : TOKENS.ink }}>
              自定义
            </div>
          </button>
        </div>

        {styleId === "custom" && (
          <textarea
            value={customText}
            onChange={e => setCustomText(e.target.value.slice(0, 200))}
            placeholder="比如：极简黑白、复古胶片质感、霓虹赛博朋克……"
            style={{
              marginTop: 10, width: "100%", minHeight: 72,
              padding: 10, borderRadius: 10,
              border: `1px solid ${TOKENS.line}`, background: "#fff",
              fontFamily: "inherit", fontSize: 13, color: TOKENS.ink,
              resize: "vertical", boxSizing: "border-box", outline: "none",
            }}
          />
        )}
        {styleId === "custom" && (
          <div style={{ textAlign: "right", fontSize: 10, color: TOKENS.inkMuted, marginTop: 4 }}>
            {customText.trim().length}/200
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} disabled={submitting} style={{
            flex: 1, appearance: "none", border: `1px solid ${TOKENS.line}`,
            background: "#fff", color: TOKENS.inkSoft,
            height: 46, borderRadius: 14,
            fontSize: 13, fontWeight: 700, fontFamily: "inherit",
            cursor: submitting ? "default" : "pointer",
          }}>取消</button>
          <button onClick={submit} disabled={!canConfirm} style={{
            flex: 1.4, appearance: "none", border: 0,
            background: canConfirm
              ? `linear-gradient(135deg, ${accent}, ${TOKENS.redDark})`
              : "#ddd",
            color: "#fff", height: 46, borderRadius: 14,
            fontSize: 14, fontWeight: 800, fontFamily: "inherit",
            cursor: canConfirm ? "pointer" : "not-allowed",
            boxShadow: canConfirm ? `0 6px 16px ${accent}55` : "none",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {submitting && (
              <span style={{
                width: 14, height: 14, borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff",
                animation: "jb-spin 0.8s linear infinite",
              }} />
            )}
            {submitting ? "提交中…" : "重新生成 ↗"}
          </button>
        </div>
      </div>
    </div>
  );
}

