import { isInAppWebView } from "./env";

export type SaveResult =
  | { kind: "longpress"; urls: string[]; count: number }
  | { kind: "shared"; count: number }
  | { kind: "downloaded"; count: number }
  | { kind: "failed"; count: number; error?: string };

async function fetchAsFile(url: string, filename: string): Promise<File> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || "image/png";
  return new File([blob], filename, { type });
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
}

function pad(n: number, width: number) {
  return String(n).padStart(width, "0");
}

export async function saveImages(
  urls: string[],
  baseName = "poster",
): Promise<SaveResult> {
  const list = urls.filter(Boolean);
  if (list.length === 0) return { kind: "failed", count: 0, error: "no urls" };

  // 1) In-app WebView (WeChat / Feishu): can't reliably download or share.
  //    Tell caller to open the long-press gallery.
  if (isInAppWebView) {
    return { kind: "longpress", urls: list, count: list.length };
  }

  const width = String(list.length).length;
  const ts = Date.now();

  // 2) Try Web Share Level 2 with multiple files.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const files: File[] = [];
      for (let i = 0; i < list.length; i++) {
        const name = list.length === 1
          ? `${baseName}-${ts}.png`
          : `${baseName}-${pad(i + 1, width)}.png`;
        files.push(await fetchAsFile(list[i], name));
      }
      const canShare = typeof navigator.canShare === "function"
        ? navigator.canShare({ files })
        : false;
      if (canShare) {
        try {
          await navigator.share({ files, title: "美宜佳海报" });
          return { kind: "shared", count: list.length };
        } catch (e: any) {
          // User cancelled → still treat as success (system sheet handled it)
          if (e?.name === "AbortError") {
            return { kind: "shared", count: list.length };
          }
          // Fall through to blob fallback below
        }
      }
      // canShare false → fall back to blob download using already-fetched files
      for (let i = 0; i < files.length; i++) {
        triggerBlobDownload(files[i], files[i].name);
        if (i < files.length - 1) await new Promise(r => setTimeout(r, 300));
      }
      return { kind: "downloaded", count: files.length };
    } catch (e: any) {
      // fetch failed or share threw something unexpected → try the plain blob loop below
      console.warn("[download] share path failed", e);
    }
  }

  // 3) Fallback: fetch + blob + <a download> loop (desktop, older browsers).
  try {
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const name = list.length === 1
        ? `${baseName}-${ts}.png`
        : `${baseName}-${pad(i + 1, width)}.png`;
      try {
        const file = await fetchAsFile(list[i], name);
        triggerBlobDownload(file, name);
        ok++;
        if (i < list.length - 1) await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.warn("[download] one image failed", list[i], e);
      }
    }
    if (ok === 0) return { kind: "failed", count: 0, error: "all failed" };
    return { kind: "downloaded", count: ok };
  } catch (e: any) {
    return { kind: "failed", count: 0, error: e?.message || "unknown" };
  }
}
