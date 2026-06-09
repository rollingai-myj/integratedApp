/**
 * Shim：兼容原 poster repo 引用的 @/lib/store.functions
 *
 * 老 repo 用 device_registrations 表记"这台设备绑定到哪家店"。
 * 整合到统一应用后，门店由 session 管（POST /portal/active-store），
 * 设备绑定改成读 host 的当前门店即可（设备/用户/门店的关系已经在 host 的
 * device_bindings + auth_sessions 里维护，poster-app 子树不需要再操心）。
 */
import { getHostContext } from '@/components/posters/host-bridge';

interface ServerFnInput<T> {
  data: T;
}

export async function getStoreForDevice(
  _input: ServerFnInput<{ deviceId: string }>,
): Promise<{ storeId: string | null }> {
  const ctx = getHostContext();
  return { storeId: ctx?.storeCode ?? null };
}

export async function bindStoreToDevice(
  input: ServerFnInput<{ deviceId: string; storeId: string }>,
): Promise<{ ok: true }> {
  // 通过 host 的 /portal/active-store 切店；这里需要 store UUID，不是 code。
  // 原 repo 传的 storeId 实际是 store_code（如"粤37893"），所以先查 ID 再切。
  const res = await fetch('/api/v1/portal/stores', { credentials: 'include' });
  if (!res.ok) throw new Error(`portal/stores ${res.status}`);
  const { stores } = (await res.json()) as { stores: Array<{ id: string; code: string }> };
  const match = stores.find((s) => s.code === input.data.storeId);
  if (!match) throw new Error(`门店编号 ${input.data.storeId} 不在你的可见范围内`);

  const switchRes = await fetch('/api/v1/portal/active-store', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId: match.id }),
  });
  if (!switchRes.ok) throw new Error(`active-store ${switchRes.status}`);
  return { ok: true };
}
