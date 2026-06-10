/**
 * localStorage image cache utility.
 * Fetches remote images, converts to base64, and stores in localStorage.
 * Subsequent loads read from cache instantly.
 */

const CACHE_PREFIX = "img_cache:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  dataUrl: string;
  ts: number;
}

export const getCachedImage = (url: string): string | null => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > MAX_AGE_MS) {
      localStorage.removeItem(CACHE_PREFIX + url);
      return null;
    }
    return entry.dataUrl;
  } catch {
    return null;
  }
};

export const cacheImage = async (url: string): Promise<string> => {
  const cached = getCachedImage(url);
  if (cached) return cached;

  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        try {
          localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ dataUrl, ts: Date.now() } as CacheEntry));
        } catch {
          // localStorage full — still return the dataUrl
        }
        resolve(dataUrl);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return url; // fallback to original URL
  }
};

/**
 * React hook-friendly: returns cached URL synchronously if available,
 * otherwise triggers async caching and returns original URL.
 */
export const getOrCacheImage = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const cached = getCachedImage(url);
  if (cached) return cached;
  // Fire-and-forget caching
  cacheImage(url);
  return url;
};
