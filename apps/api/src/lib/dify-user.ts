/**
 * Dify `user` 字段构造
 *
 * 规则（与产品确认）：所有调 Dify 工作流的请求都要在 user 字段携带"登录渠道-门店编码"，
 * 用于 Dify 端按门店做用量分析与会话隔离。
 *
 *   账密登录：{legacyAccount}-{storeCode}   例: admin-粤28999 / ops-粤29790
 *   飞书登录：lark-{storeCode}             例: lark-粤28301
 *
 * 调用前必经过 requireStore 中间件，未选店不会走到这里。
 */
import type { AuthenticatedUser } from '../types/api.js';

export function buildDifyUser(user: AuthenticatedUser): string {
  const storeCode = user.currentStoreCode?.trim() || 'no-store';
  const channel =
    user.authMethod === 'feishu_qr' || user.authMethod === 'feishu_h5'
      ? 'lark'
      : user.legacyAccount?.trim() || 'unknown';
  return `${channel}-${storeCode}`;
}
