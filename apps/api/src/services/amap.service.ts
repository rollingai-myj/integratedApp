/**
 * 高德地图代理（AMAP key 从前端 hardcoded 迁到后端 env）
 *
 * 前端选品的"聊一聊"出题 + 周边洞察 都需要门店 600m 内的 POI 数据：
 *   - 竞品类 POI（cafe/cold drink/bakery/dessert/convenience/supermarket/specialty）
 *   - 客群来源 POI（mall/business street/sports/medical/edu/lodging/scenic/business/transport/enterprise/factory）
 */
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const AMAP_COMPETITOR_TYPES = [
  '050500', // 咖啡厅
  '050700', // 冷饮店
  '050800', // 糕饼店
  '050900', // 甜品店
  '060200', // 便利店
  '060400', // 超市
  '061200', // 专卖店
].join('|');

export const AMAP_CROWD_TYPES = [
  '060100', '060300', '080000', '090000', '140000', '100000',
  '110000', '120000', '150000', '170100', '170300',
].join('|');

export interface AmapPoi {
  name: string;
  type: string;
  typecode: string;
  address: string;
  location: string;   // "lng,lat"
  business?: unknown;
}

interface AmapSearchResponse {
  status: string;
  infocode: string;
  info?: string;
  count?: string;
  pois?: Array<{
    id?: string;
    name?: string;
    type?: string;
    typecode?: string;
    address?: string | Record<string, never>;
    location?: string;
    business?: unknown;
  }>;
}

const RATE_LIMIT_CODES = new Set(['10021', '10019', '10020', '10001']);

async function searchOnce(args: {
  location: string;
  radius: number;
  types: string;
  page: number;
  pageSize: number;
}): Promise<AmapSearchResponse> {
  if (!config.AMAP_KEY) {
    throw new AppError(502, ErrorCodes.UPSTREAM_ERROR, '高德地图 key 未配置（AMAP_KEY）');
  }
  const url = new URL('https://restapi.amap.com/v5/place/around');
  url.searchParams.set('key', config.AMAP_KEY);
  url.searchParams.set('location', args.location);
  url.searchParams.set('radius', String(args.radius));
  url.searchParams.set('types', args.types);
  url.searchParams.set('page_size', String(args.pageSize));
  url.searchParams.set('page_num', String(args.page));
  url.searchParams.set('show_fields', 'business');

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new AppError(502, ErrorCodes.UPSTREAM_ERROR, `高德返回 ${res.status}`);
  }
  return (await res.json()) as AmapSearchResponse;
}

/**
 * 翻页拉全部 POI；带限流退避。
 * 同步本地 hash 缓存留给前端，后端不缓存（不同店每次都需新鲜数据）。
 */
export async function searchAround(args: {
  location: string;
  radius: number;
  types: string;
  maxResults?: number;
}): Promise<AmapPoi[]> {
  const maxResults = args.maxResults ?? 200;
  const pageSize = 25;
  const maxPages = Math.ceil(maxResults / pageSize);
  const out: AmapPoi[] = [];
  let delay = 400;
  for (let page = 1; page <= maxPages; page++) {
    let resp: AmapSearchResponse | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        resp = await searchOnce({ ...args, page, pageSize });
      } catch (err) {
        logger.warn({ err, page }, 'amap fetch error');
        await sleep(delay);
        delay = Math.min(delay * 2, 3000);
        continue;
      }
      if (resp.status === '1') break;
      if (RATE_LIMIT_CODES.has(resp.infocode)) {
        await sleep(delay);
        delay = Math.min(delay * 2, 3000);
        continue;
      }
      // 非限流的错：直接抛
      throw new AppError(
        502, ErrorCodes.UPSTREAM_ERROR,
        `高德 status=${resp.status} infocode=${resp.infocode} info=${resp.info ?? ''}`,
      );
    }
    if (!resp || resp.status !== '1') break;
    const pois = (resp.pois ?? []).map((p) => ({
      name: String(p.name ?? ''),
      type: String(p.type ?? ''),
      typecode: String(p.typecode ?? ''),
      address: typeof p.address === 'string' ? p.address : '',
      location: String(p.location ?? ''),
      business: p.business,
    }));
    out.push(...pois);
    if (pois.length < pageSize) break;
    if (out.length >= maxResults) break;
    await sleep(120);   // 防限流
  }
  return out.slice(0, maxResults);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
