/**
 * 飞书服务接入点
 *
 * 涉及接口：
 * - POST /api/v1/auth/feishu/callback
 * - POST /api/v1/auth/feishu/h5-sign
 *
 * M0：方法签名占位，全部抛 NotImplementedError。M1 接入飞书 OAuth 与 H5 免登。
 */
import { NotImplementedError } from '../lib/errors.js';

export interface FeishuUserProfile {
  openId: string;
  unionId: string;
  name: string;
  email?: string;
  avatar?: string;
}

export class FeishuService {
  /** OAuth code → access_token → user profile */
  async exchangeCodeForProfile(_code: string): Promise<FeishuUserProfile> {
    throw new NotImplementedError(
      '[feishu.exchangeCodeForProfile] will be implemented in M1',
    );
  }

  /** 生成飞书 H5 SDK 所需的 signature（jsapi_ticket 派生） */
  async signH5Url(_url: string): Promise<{
    appId: string;
    signature: string;
    timestamp: number;
    nonceStr: string;
  }> {
    throw new NotImplementedError(
      '[feishu.signH5Url] will be implemented in M1',
    );
  }
}

export const feishuService = new FeishuService();
