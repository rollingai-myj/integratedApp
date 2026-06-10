// 高德地图 REST API 封装（用于周边环境洞察）
const AMAP_KEY = "c87248551edc4bcb5bb4fa8027211529";
const BASE_URL = "https://restapi.amap.com/v5/place";

export interface AmapPoi {
  id: string;
  name: string;
  location: string; // "lng,lat"
  address: string;
  type: string;
  typecode: string;
  pname?: string;
  cityname?: string;
  adname?: string;
  business?: any;
}

interface SearchResponse {
  status: string;
  info: string;
  count?: string;
  pois?: AmapPoi[];
}

export async function amapSearchByText(keyword: string, region?: string): Promise<AmapPoi[]> {
  const params = new URLSearchParams({
    key: AMAP_KEY,
    keywords: keyword,
    page_size: "5",
    page_num: "1",
  });
  if (region) params.set("region", region);
  const res = await fetch(`${BASE_URL}/text?${params}`);
  const data: SearchResponse = await res.json();
  if (data.status !== "1" || !data.pois) return [];
  return data.pois;
}

export async function amapSearchAround(
  location: string,
  radius: number,
  types: string,
  page = 1,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    key: AMAP_KEY,
    location,
    radius: String(radius),
    types,
    page_size: "25",
    page_num: String(page),
    show_fields: "children,business,indoor,navi,photos",
  });
  const res = await fetch(`${BASE_URL}/around?${params}`);
  return res.json();
}

// 专卖店（061200）允许的关键词：仅保留 keytag 中包含这些关键词的 POI
const SPECIALTY_STORE_TYPECODE = "061200";
const SPECIALTY_STORE_ALLOWED_KEYWORDS = ["零食", "烟", "酒"];

function getPoiKeytag(poi: AmapPoi): string {
  const biz: any = poi.business;
  if (!biz) return "";
  if (typeof biz === "string") return biz;
  // 高德 v5 business 字段中可能包含 keytag / tag 等
  const keytag = biz.keytag ?? biz.tag ?? "";
  return typeof keytag === "string" ? keytag : String(keytag ?? "");
}

function filterSpecialtyStores(pois: AmapPoi[]): AmapPoi[] {
  return pois.filter((p) => {
    if (p.typecode !== SPECIALTY_STORE_TYPECODE) return true;
    const keytag = getPoiKeytag(p);
    if (!keytag) return false;
    return SPECIALTY_STORE_ALLOWED_KEYWORDS.some((kw) => keytag.includes(kw));
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function amapSearchAroundWithRetry(
  location: string,
  radius: number,
  types: string,
  page: number,
  maxRetries = 5,
): Promise<SearchResponse> {
  let attempt = 0;
  let delay = 400;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await amapSearchAround(location, radius, types, page);
    // 10021 = CUQPS_HAS_EXCEEDED_THE_LIMIT（每秒并发限流）；10019/10020 也是流控类
    const rateLimited =
      data.status === "0" &&
      (data as any).infocode &&
      ["10021", "10019", "10020", "10001"].includes(String((data as any).infocode));
    if (!rateLimited || attempt >= maxRetries) return data;
    attempt++;
    await sleep(delay);
    delay = Math.min(delay * 2, 3000);
  }
}

export async function amapSearchAroundAll(
  location: string,
  radius: number,
  types: string,
  maxItems = 200,
): Promise<AmapPoi[]> {
  const PAGE_SIZE = 25;
  const all: AmapPoi[] = [];
  let page = 1;
  while (all.length < maxItems) {
    const data = await amapSearchAroundWithRetry(location, radius, types, page);
    if (data.status !== "1" || !data.pois || data.pois.length === 0) break;
    all.push(...data.pois);
    // 高德 v5 的 count 字段返回的是本页条数（非总数），不能用作终止条件。
    // 当本页返回少于 PAGE_SIZE 时说明已是最后一页。
    if (data.pois.length < PAGE_SIZE) break;
    page++;
    if (page > 20) break;
    // 控制 QPS，避免触发 CUQPS_HAS_EXCEEDED_THE_LIMIT
    await sleep(250);
  }
  return filterSpecialtyStores(all).slice(0, maxItems);
}

// 将浏览器 GPS 坐标 (WGS84) 转换为高德 (GCJ02)
export async function convertWgsToGcj(lng: number, lat: number): Promise<[number, number]> {
  const params = new URLSearchParams({
    key: AMAP_KEY,
    locations: `${lng},${lat}`,
    coordsys: "gps",
    output: "json",
  });
  try {
    const res = await fetch(`https://restapi.amap.com/v3/assistant/coordinate/convert?${params}`);
    const data = await res.json();
    if (data.status === "1" && data.locations) {
      const [l, t] = String(data.locations).split(",").map(Number);
      return [l, t];
    }
  } catch {}
  return [lng, lat];
}

// 通过坐标反查地址
export async function amapRegeo(location: string): Promise<string> {
  const params = new URLSearchParams({
    key: AMAP_KEY,
    location,
    output: "json",
  });
  try {
    const res = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${params}`);
    const data = await res.json();
    if (data.status === "1" && data.regeocode?.formatted_address) {
      return String(data.regeocode.formatted_address);
    }
  } catch {}
  return "";
}

// 竞品店 POI typecode（按高德官方 POI 二级分类，避免污染父级一级类目）
export const COMPETITOR_POI_TYPES = [
  "050500", // 餐饮服务 / 咖啡厅
  "050700", // 餐饮服务 / 冷饮店
  "050800", // 餐饮服务 / 糕饼店
  "050900", // 餐饮服务 / 甜品店
  "060200", // 购物服务 / 便民商店、便利店
  "060400", // 购物服务 / 超级市场
  "061200", // 购物服务 / 专卖店
].join("|");

// 人流来源 POI typecode（精确到指定层级，不勾选其父级一级分类）
export const CROWD_SOURCE_POI_TYPES = [
  "060100", // 购物服务 / 商场（二级）
  "060300", // 购物服务 / 特色商业街（二级）
  "080000", // 体育休闲服务（一级）
  "090000", // 医疗保健服务（一级）
  "140000", // 科教文化服务（一级）
  "100000", // 住宿服务（一级）
  "110000", // 风景名胜（一级）
  "120000", // 商务住宅（一级）
  "150000", // 交通设施服务（一级）
  "170100", // 公司企业 / 知名企业（二级）
  "170300", // 公司企业 / 工厂（二级）
].join("|");

// 兼容旧引用
export const FIXED_POI_TYPES = `${COMPETITOR_POI_TYPES}|${CROWD_SOURCE_POI_TYPES}`;
