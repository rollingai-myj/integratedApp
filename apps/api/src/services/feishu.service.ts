/**
 * 飞书开放平台 API 客户端
 *
 * 覆盖：
 *   - tenant_access_token 缓存（提前 5 分钟刷新）
 *   - 网页授权 code → user_access_token
 *   - user_access_token → 通讯录完整用户信息（含 department_path）
 *   - jsapi_ticket 缓存
 *   - H5 SDK 签名（hash 算法见 https://open.feishu.cn/document/uYjL24iN/uYjL24iN/...）
 *
 * 设计要点：
 *   - 所有方法都是 async，发出 fetch 真实请求；失败抛 AppError 让上层统一处理
 *   - 缓存在进程内存（单实例足够；多实例后续可换 Redis）
 *   - 不打印 token；日志只记结构化字段（code、route 等）
 */
import { createHash } from 'node:crypto';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// ---- Feishu 通讯录返回类型（按 docs/reference/feishu-user-info-api.md 整理）------

export interface FeishuDeptPathItem {
  department_id: string;
  department_name: {
    name: string;
    i18n_name?: { en_us?: string; ja_jp?: string; zh_cn?: string };
  };
  department_path?: {
    department_ids?: string[];
    department_path_name?: {
      name: string;
      i18n_name?: { en_us?: string; ja_jp?: string; zh_cn?: string };
    };
  };
}

export interface FeishuUserContact {
  open_id: string;
  union_id?: string;
  user_id?: string;
  name: string;
  en_name?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  avatar?: {
    avatar_72?: string;
    avatar_240?: string;
    avatar_640?: string;
    avatar_origin?: string;
  };
  employee_no?: string;
  department_ids?: string[];
  department_path?: FeishuDeptPathItem[];
  is_tenant_manager?: boolean;
  is_frozen?: boolean;
  is_resigned?: boolean;
  is_activated?: boolean;
}

/** 网页授权 code 兑换返回 */
export interface FeishuUserTokenInfo {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number; // 秒
  refresh_expires_in: number;
  open_id: string;
  union_id?: string;
  scope?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // ms epoch
}

const FEISHU_BASE = 'https://open.feishu.cn';

/**
 * 网页授权需要的最小 scope 集合。
 *
 * - contact:contact.base:readonly：调 /contact/v3/users/{open_id} 接口的"门票"。
 *   不传则授权页不勾该项，user_access_token 调通讯录接口会报
 *   "Unauthorized... required one of these privileges"。
 * - contact:user.department_path:readonly：拿 department_path 的"字段权限"。
 *   即使接口能调通，缺这一项飞书会从响应里把 department_path 整段抹掉，
 *   我们解析就拿不到部门链 → 门店匹配全空。见 docs/reference/feishu-user-info-api.md
 *   第 7 条 + 第 18 条字段权限要求。
 *
 * scope 用空格分隔（飞书 authen 文档约定）。后续若新增能力（如读企业级
 * 通讯录、读云文档），在这里追加，并在飞书后台开权限。
 *
 * 注意：scope 改动后，老的 user_access_token 不会自动获得新权限。
 * 用户必须重新走一次 OAuth 授权（授权页会要求重新勾选），新颁发的 token 才生效。
 */
const FEISHU_OAUTH_SCOPES = [
  'contact:contact.base:readonly',
  'contact:user.department_path:readonly',
].join(' ');

export class FeishuService {
  private tenantToken: CachedToken | null = null;
  private jsapiTicket: CachedToken | null = null;

  /** tenant_access_token：应用身份，2 小时有效，本类内提前 5 分钟刷 */
  async getTenantAccessToken(): Promise<string> {
    if (this.tenantToken && this.tenantToken.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.tenantToken.token;
    }

    const res = await fetch(
      `${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: config.FEISHU_APP_ID,
          app_secret: config.FEISHU_APP_SECRET,
        }),
      },
    );
    const data = (await res.json()) as {
      code: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (data.code !== 0 || !data.tenant_access_token) {
      logger.error({ feishuCode: data.code, msg: data.msg }, 'feishu tenant_access_token 失败');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `获取飞书 tenant_access_token 失败：${data.msg ?? data.code}`,
      );
    }

    this.tenantToken = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire ?? 7200) * 1000,
    };
    return data.tenant_access_token;
  }

  /**
   * 网页授权码兑换：code → user_access_token + open_id
   *
   * 用 app_access_token (tenant_access_token) 作 Bearer 调用
   * https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/create
   */
  async exchangeCodeForUserToken(code: string): Promise<FeishuUserTokenInfo> {
    const appToken = await this.getTenantAccessToken();
    const res = await fetch(`${FEISHU_BASE}/open-apis/authen/v1/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appToken}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = (await res.json()) as {
      code: number;
      msg?: string;
      data?: FeishuUserTokenInfo;
    };
    if (data.code !== 0 || !data.data) {
      logger.warn({ feishuCode: data.code, msg: data.msg }, 'feishu code 兑换失败');
      // code 已使用 / 过期 → 让前端重新触发授权
      throw new AppError(
        401,
        ErrorCodes.TOKEN_INVALID,
        `飞书授权码无效：${data.msg ?? data.code}`,
      );
    }
    return data.data;
  }

  /**
   * 用 user_access_token 取完整用户信息（含 department_path）
   *
   * 必须用 user_access_token；tenant_access_token 拿不到 department_path（接口文档第 7 条注意事项）
   */
  async fetchUserContact(
    openId: string,
    userAccessToken: string,
  ): Promise<FeishuUserContact> {
    const url = new URL(`${FEISHU_BASE}/open-apis/contact/v3/users/${openId}`);
    url.searchParams.set('user_id_type', 'open_id');
    url.searchParams.set('department_id_type', 'open_department_id');

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const data = (await res.json()) as {
      code: number;
      msg?: string;
      data?: { user: FeishuUserContact };
    };
    if (data.code !== 0 || !data.data?.user) {
      logger.error({ feishuCode: data.code, msg: data.msg, openId }, 'feishu 通讯录查询失败');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `获取飞书用户信息失败：${data.msg ?? data.code}`,
      );
    }
    return data.data.user;
  }

  /** jsapi_ticket：用 tenant_access_token 换，2 小时有效 */
  async getJsapiTicket(): Promise<string> {
    if (this.jsapiTicket && this.jsapiTicket.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.jsapiTicket.token;
    }
    const appToken = await this.getTenantAccessToken();
    const res = await fetch(`${FEISHU_BASE}/open-apis/jssdk/ticket/get`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${appToken}` },
    });
    const data = (await res.json()) as {
      code: number;
      msg?: string;
      data?: { ticket: string; expire_in: number };
    };
    if (data.code !== 0 || !data.data?.ticket) {
      logger.error({ feishuCode: data.code, msg: data.msg }, 'feishu jsapi_ticket 失败');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `获取飞书 jsapi_ticket 失败：${data.msg ?? data.code}`,
      );
    }
    this.jsapiTicket = {
      token: data.data.ticket,
      expiresAt: Date.now() + (data.data.expire_in ?? 7200) * 1000,
    };
    return data.data.ticket;
  }

  /**
   * H5 SDK 签名：tt.config 需要 { appId, timestamp, nonceStr, signature }
   *
   * 签名算法：sha1(jsapi_ticket + noncestr + timestamp + url 拼接的字符串)
   * 文档：https://open.feishu.cn/document/uYjL24iN/uYjL24iN/h5/...
   */
  async signH5Url(url: string): Promise<{
    appId: string;
    timestamp: number;
    nonceStr: string;
    signature: string;
  }> {
    const ticket = await this.getJsapiTicket();
    const timestamp = Math.floor(Date.now() / 1000);
    const nonceStr = Math.random().toString(36).slice(2, 18);

    const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
    const signature = createHash('sha1').update(raw, 'utf8').digest('hex');

    return {
      appId: config.FEISHU_APP_ID,
      timestamp,
      nonceStr,
      signature,
    };
  }

  /** 构造 OAuth 跳转 URL（前端打开后由飞书引导用户授权，回跳到 redirect_uri） */
  buildAuthorizeUrl(state: string, redirectUri?: string): string {
    const url = new URL(`${FEISHU_BASE}/open-apis/authen/v1/authorize`);
    url.searchParams.set('app_id', config.FEISHU_APP_ID);
    url.searchParams.set('client_id', config.FEISHU_APP_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri ?? config.FEISHU_REDIRECT_URI);
    url.searchParams.set('scope', FEISHU_OAUTH_SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
  }
}

export const feishuService = new FeishuService();
