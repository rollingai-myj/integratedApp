import * as React from "react";

export function LongPressGallery({ urls, onClose }: { urls: string[]; onClose: () => void }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.96)",
        display: "flex", flexDirection: "column",
        animation: "lpg-fade 0.2s ease",
      }}>

      <div style={{
        flexShrink: 0,
        padding: "14px 16px",
        background: "rgba(20,20,20,0.85)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ flex: 1, color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>
          长按图片 → 选「保存图片」到相册
        </div>
        <button onClick={onClose} aria-label="关闭" style={{
          appearance: "none", border: 0, background: "rgba(255,255,255,0.16)",
          width: 34, height: 34, borderRadius: "50%", color: "#fff",
          fontSize: 22, fontWeight: 500, lineHeight: 1, paddingBottom: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
        }}>×</button>
      </div>

      <div style={{
        flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
        padding: "14px 14px 24px",
      }}>
        {urls.map((url, i) => (
          <div key={i} style={{ marginBottom: 18 }}>
            <img
              src={url}
              alt={`海报 ${i + 1}`}
              draggable={false}
              style={{
                width: "100%", display: "block",
                borderRadius: 12, background: "#1a1a1a",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                // make the long-press save-image gesture work reliably on iOS
                WebkitTouchCallout: "default",
                WebkitUserSelect: "none",
                userSelect: "none",
              }}
            />
            <div style={{
              textAlign: "center", color: "rgba(255,255,255,0.55)",
              fontSize: 11, fontWeight: 600, marginTop: 6,
            }}>{i + 1} / {urls.length}</div>
          </div>
        ))}
        <div style={{
          textAlign: "center", color: "rgba(255,255,255,0.45)",
          fontSize: 11, lineHeight: 1.5, padding: "8px 24px 0",
        }}>
          当前浏览器不支持一键批量保存，<br/>请逐张长按图片选「保存到相册」。

        </div>
      </div>

      <style>{`
        @keyframes lpg-fade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  );
}
