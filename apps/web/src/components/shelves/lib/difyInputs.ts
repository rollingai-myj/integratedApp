/**
 * Dify 工作流 inputs 序列化
 *
 * Dify 目前对 inputs 字段的 schema 校验非常严格：text-input / paragraph 等
 * 字符串类型的字段如果收到 object 或 array，会直接 400 invalid_param
 * "must be a string"。原 skuSelection repo 时代不严格，整合 app 移植过来后
 * 出现 schema 不匹配。
 *
 * 处理规则：
 *   - object / array → JSON.stringify（包括 `{ items: [...] }` 这种包装）
 *   - 文件类输入（带 transfer_method 字段的对象，如
 *     `{ transfer_method: 'remote_url', url, type: 'image' }`）→ 保持原样
 *   - 字符串 / 数字 / 布尔 / null / undefined → 保持原样
 *
 * 用法：
 *   const body = JSON.stringify({ inputs: serializeDifyInputs(inputs), ... });
 */
export function serializeDifyInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    out[k] = serializeOne(v);
  }
  return out;
}

function serializeOne(v: unknown): unknown {
  if (v == null) return v; // null / undefined 原样
  if (typeof v !== 'object') return v; // string / number / boolean
  // 文件类对象保留（Dify 文件 input 必须是 object）
  if (isDifyFileObject(v)) return v;
  // 其他 object / array → JSON 字符串
  return JSON.stringify(v);
}

function isDifyFileObject(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { transfer_method?: unknown }).transfer_method === 'string'
  );
}
