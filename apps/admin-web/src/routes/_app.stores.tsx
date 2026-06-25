/**
 * 门店信息(综合页)— CSV 批量导入 + 单店增/改/删
 *
 * 设计:
 *   - 顶部一个可折叠的"批量导入"section(复用 CsvUploadPage,kind='stores',
 *     用 hideHeading 关掉它自己的 h1,标题统一在本页头部)
 *   - 下方"门店列表":搜索/状态筛选/分页 + 点行展开 inline 编辑 + 删除
 *   - 右上「+ 新增门店」展开顶部新增表单
 *
 * URL search 状态:search / status / page 都同步到 URL,可分享 / 收藏 / 后退。
 */
import * as React from 'react';
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TOKENS } from '@/tokens';
import { ApiError } from '@/lib/api';
import { CsvUploadPage } from '@/components/CsvUploadPage';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import { fetchSpecs } from '@/lib/uploads';
import {
  fetchStores,
  patchStore,
  createStore,
  deleteStore,
  STORE_STATUS_LABEL,
  type StoreDetail,
  type StoreStatus,
  type StorePatch,
  type CreateStoreInput,
} from '@/lib/stores';

const PAGE_SIZE = 50;

interface SearchParams {
  search?: string;
  status?: StoreStatus;
  page?: number;
}

export const Route = createFileRoute('/_app/stores')({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : undefined,
    status: s.status === 'active' || s.status === 'disabled' ? s.status : undefined,
    page: typeof s.page === 'number' && s.page >= 1 ? s.page : undefined,
  }),
  component: StoresPage,
});

function StoresPage() {
  const navigate = useNavigate({ from: '/stores' });
  const search = useSearch({ from: '/_app/stores' });
  const page = search.page ?? 1;

  const [searchInput, setSearchInput] = React.useState(search.search ?? '');
  React.useEffect(() => { setSearchInput(search.search ?? ''); }, [search.search]);

  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [csvOpen, setCsvOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // CSV section 的字段定义(用 hideHeading 内嵌)
  const specsQ = useQuery({
    queryKey: ['uploads', 'specs'],
    queryFn: fetchSpecs,
    staleTime: 5 * 60_000,
    enabled: csvOpen,
  });
  const storesSpec = specsQ.data?.find(s => s.kind === 'stores');
  const flashToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 2400);
  };

  const listQ = useQuery({
    queryKey: ['stores', search.search ?? '', search.status ?? '', page],
    queryFn: () => fetchStores({
      search: search.search,
      status: search.status,
      page,
      pageSize: PAGE_SIZE,
    }),
  });

  const patchSearch = (next: Partial<SearchParams>) => {
    navigate({
      search: prev => {
        const merged: SearchParams = { ...prev, ...next };
        // 切筛选 → 回到第 1 页
        if (next.search !== undefined || next.status !== undefined) {
          merged.page = undefined;
        }
        return merged;
      },
      replace: true,
    });
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    patchSearch({ search: searchInput.trim() || undefined });
  };

  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px' }}>
            门店信息
          </h1>
          <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted }}>
            所有门店的基础信息 — 点行展开可编辑或删除;也可在此新增门店,或用 CSV 批量导入。
          </div>
        </div>
        <button
          onClick={() => setCsvOpen(o => !o)}
          style={ghostBtnStyle()}
        >
          {csvOpen ? '× 收起批量导入' : '⇪ 批量导入 / 模板'}
        </button>
        <button
          onClick={() => setCreating(c => !c)}
          style={primaryBtnStyle()}
        >
          {creating ? '× 取消新增' : '+ 新增门店'}
        </button>
      </div>

      {/* 批量 CSV 导入(可折叠) */}
      {csvOpen && (
        <Panel padding="0">
          <div style={{
            padding: '14px 20px',
            borderBottom: `1px solid ${TOKENS.lineSoft}`,
            display: 'flex', alignItems: 'baseline', gap: 12,
          }}>
            <div style={{ fontSize: TOKENS.fBase, fontWeight: 700, color: TOKENS.ink }}>
              批量导入门店信息
            </div>
            <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted }}>
              下载模板填写后上传 CSV;同一「门店编号」已存在时会让你确认是覆盖还是只新增
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {specsQ.isLoading && (
              <div style={{ color: TOKENS.inkMuted, fontSize: TOKENS.fSm }}>加载字段定义…</div>
            )}
            {storesSpec && <CsvUploadPage kind="stores" spec={storesSpec} hideHeading />}
          </div>
        </Panel>
      )}

      {/* 新增门店表单 */}
      {creating && (
        <Panel>
          <div style={{
            fontSize: TOKENS.fBase, fontWeight: 700, color: TOKENS.ink,
            marginBottom: 12,
          }}>
            新增门店
          </div>
          <StoreCreateForm
            onCancel={() => setCreating(false)}
            onCreated={(d) => { setCreating(false); flashToast('success', `已新增门店「${d.storeCode} ${d.storeName}」`); }}
            onError={msg => flashToast('error', msg)}
          />
        </Panel>
      )}

      {/* 筛选 toolbar */}
      <Panel>
        <form
          onSubmit={onSearchSubmit}
          style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜索门店编号 或 门店名称"
            style={inputStyle({ width: 280 })}
          />
          <SelectInput
            value={search.status ?? ''}
            onChange={v => patchSearch({ status: (v || undefined) as StoreStatus | undefined })}
            options={[
              { value: '', label: '全部状态' },
              { value: 'active', label: '在用' },
              { value: 'disabled', label: '已停用' },
            ]}
            width={140}
          />
          <button type="submit" style={primaryBtnStyle()}>搜索</button>
          {(search.search || search.status) && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); patchSearch({ search: undefined, status: undefined }); }}
              style={ghostBtnStyle()}
            >
              清空筛选
            </button>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, fontVariantNumeric: 'tabular-nums' }}>
            共 <b style={{ color: TOKENS.ink }}>{total.toLocaleString()}</b> 家门店
          </div>
        </form>
      </Panel>

      {/* 表格 */}
      <Panel padding="0">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: TOKENS.fSm }}>
          <thead>
            <tr style={{ background: TOKENS.bgWarm, color: TOKENS.inkSoft }}>
              <Th width={140}>门店编号</Th>
              <Th>门店名称</Th>
              <Th width={120}>城市</Th>
              <Th width={120}>商圈</Th>
              <Th width={90}>面积(㎡)</Th>
              <Th width={80}>状态</Th>
              <Th width={150}>上次修改</Th>
              <Th width={40} />
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={8} style={{ padding: '32px 16px', textAlign: 'center', color: TOKENS.inkMuted }}>
                  加载中…
                </td>
              </tr>
            )}
            {!listQ.isLoading && (listQ.data?.rows.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '32px 16px', textAlign: 'center', color: TOKENS.inkMuted }}>
                  没有符合条件的门店
                </td>
              </tr>
            )}
            {(listQ.data?.rows ?? []).map(row => (
              <StoreRow
                key={row.id}
                store={row}
                expanded={expanded === row.id}
                onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                onSaved={() => flashToast('success', `已保存「${row.storeCode} ${row.storeName}」`)}
                onDeleted={() => flashToast('success', `已删除「${row.storeCode} ${row.storeName}」`)}
                onError={(msg) => flashToast('error', msg)}
              />
            ))}
          </tbody>
        </table>
      </Panel>

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <button
            disabled={page <= 1}
            onClick={() => patchSearch({ page: page - 1 })}
            style={ghostBtnStyle(page <= 1)}
          >‹ 上一页</button>
          <span style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted, fontVariantNumeric: 'tabular-nums', padding: '0 8px' }}>
            第 {page} / {totalPages} 页
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => patchSearch({ page: page + 1 })}
            style={ghostBtnStyle(page >= totalPages)}
          >下一页 ›</button>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', right: 32, bottom: 32,
          background: toast.type === 'error' ? TOKENS.danger : TOKENS.ink,
          color: '#fff',
          padding: '12px 18px',
          borderRadius: 10,
          fontSize: TOKENS.fSm,
          fontWeight: 600,
          boxShadow: TOKENS.shadow2,
          zIndex: 1000,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 单行 + 行展开编辑
// =============================================================================

function StoreRow({
  store, expanded, onToggle, onSaved, onDeleted, onError,
}: {
  store: StoreDetail;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderTop: `1px solid ${TOKENS.lineSoft}`,
          cursor: 'pointer',
          background: expanded ? '#FDFAF5' : undefined,
        }}
      >
        <Td mono><code style={{ color: TOKENS.ink }}>{store.storeCode}</code></Td>
        <Td>{store.storeName}</Td>
        <Td>{[store.province, store.city].filter(Boolean).join(' / ') || '—'}</Td>
        <Td>{store.poiCategory ?? '—'}</Td>
        <Td mono>{store.storeAreaSqm !== null ? store.storeAreaSqm.toFixed(2) : '—'}</Td>
        <Td><StatusPill status={store.status} /></Td>
        <Td><span style={{ color: TOKENS.inkMuted, fontSize: TOKENS.fXs }}>{formatTime(store.updatedAt)}</span></Td>
        <Td><span style={{ color: TOKENS.inkMuted, fontSize: 10 }}>{expanded ? '▴' : '▾'}</span></Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{
            padding: 0,
            background: '#FDFAF5',
            borderTop: `1px solid ${TOKENS.lineSoft}`,
          }}>
            <StoreEditForm
              store={store}
              onCancel={onToggle}
              onSaved={() => { onSaved(); onToggle(); }}
              onDeleted={() => { onDeleted(); onToggle(); }}
              onError={onError}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function StoreEditForm({
  store, onCancel, onSaved, onDeleted, onError,
}: {
  store: StoreDetail;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  // 初始 form 值:跟当前 store 一致
  const [form, setForm] = React.useState(() => ({
    storeCode: store.storeCode,
    storeName: store.storeName,
    province: store.province ?? '',
    city: store.city ?? '',
    address: store.address ?? '',
    latitude: store.latitude !== null ? String(store.latitude) : '',
    longitude: store.longitude !== null ? String(store.longitude) : '',
    openedAt: store.openedAt ?? '',
    status: store.status,
    isProjectStore: store.isProjectStore,
    storeAreaSqm: store.storeAreaSqm !== null ? String(store.storeAreaSqm) : '',
    poiCategory: store.poiCategory ?? '',
  }));

  const m = useMutation({
    mutationFn: (patch: StorePatch) => patchStore(store.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      onSaved();
    },
    onError: (e: unknown) => {
      onError(e instanceof ApiError ? e.message : '保存失败');
    },
  });

  const delM = useMutation({
    mutationFn: () => deleteStore(store.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      onDeleted();
    },
    onError: (e: unknown) => {
      onError(e instanceof ApiError ? e.message : '删除失败');
    },
  });

  const buildPatch = (): StorePatch | { _err: string } => {
    const patch: StorePatch = {};
    // 字符串字段:空串 → null,非空 trim 后传
    const strField = (cur: string, orig: string | null, key: keyof StorePatch) => {
      const v = cur.trim() === '' ? null : cur.trim();
      if (v !== (orig ?? null)) (patch as Record<string, unknown>)[key] = v;
    };
    if (form.storeCode.trim() === '') return { _err: '门店编号不能为空' };
    if (form.storeName.trim() === '') return { _err: '门店名称不能为空' };

    if (form.storeCode.trim() !== store.storeCode) patch.storeCode = form.storeCode.trim();
    if (form.storeName.trim() !== store.storeName) patch.storeName = form.storeName.trim();
    strField(form.province, store.province, 'province');
    strField(form.city, store.city, 'city');
    strField(form.address, store.address, 'address');
    strField(form.poiCategory, store.poiCategory, 'poiCategory');

    // 数字字段
    const numField = (cur: string, orig: number | null, key: keyof StorePatch, label: string, min?: number, max?: number) => {
      if (cur.trim() === '') {
        if (orig !== null) (patch as Record<string, unknown>)[key] = null;
        return null;
      }
      const n = Number(cur);
      if (!Number.isFinite(n)) return `${label} 不是合法数字`;
      if (min !== undefined && n < min) return `${label} 不能小于 ${min}`;
      if (max !== undefined && n > max) return `${label} 不能大于 ${max}`;
      if (n !== orig) (patch as Record<string, unknown>)[key] = n;
      return null;
    };
    const errLat = numField(form.latitude, store.latitude, 'latitude', '纬度', -90, 90);
    if (errLat) return { _err: errLat };
    const errLng = numField(form.longitude, store.longitude, 'longitude', '经度', -180, 180);
    if (errLng) return { _err: errLng };
    const errArea = numField(form.storeAreaSqm, store.storeAreaSqm, 'storeAreaSqm', '门店面积', 0);
    if (errArea) return { _err: errArea };

    // 日期
    if (form.openedAt.trim() === '') {
      if (store.openedAt !== null) patch.openedAt = null;
    } else {
      const v = form.openedAt.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { _err: '开店日期格式必须是「年-月-日」如 2018-09-01' };
      if (v !== store.openedAt) patch.openedAt = v;
    }

    // 枚举 / 布尔
    if (form.status !== store.status) patch.status = form.status;
    if (form.isProjectStore !== store.isProjectStore) patch.isProjectStore = form.isProjectStore;

    return patch;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = buildPatch();
    if ('_err' in r) { onError(r._err); return; }
    if (Object.keys(r).length === 0) { onSaved(); return; } // 无修改 → 直接关
    m.mutate(r);
  };

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  return (
    <form
      onSubmit={onSubmit}
      style={{
        padding: '20px 24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: '14px 20px',
      }}
    >
      <Field label="门店编号" required>
        <input value={form.storeCode} onChange={e => update('storeCode', e.target.value)} style={inputStyle()} />
      </Field>
      <Field label="门店名称" required span={2}>
        <input value={form.storeName} onChange={e => update('storeName', e.target.value)} style={inputStyle()} />
      </Field>
      <Field label="在用状态">
        <SelectInput
          value={form.status}
          onChange={v => update('status', v as StoreStatus)}
          options={[
            { value: 'active', label: '在用' },
            { value: 'disabled', label: '已停用' },
          ]}
        />
      </Field>

      <Field label="省"><input value={form.province} onChange={e => update('province', e.target.value)} style={inputStyle()} /></Field>
      <Field label="市"><input value={form.city} onChange={e => update('city', e.target.value)} style={inputStyle()} /></Field>
      <Field label="详细地址" span={2}>
        <input value={form.address} onChange={e => update('address', e.target.value)} style={inputStyle()} />
      </Field>

      <Field label="纬度"><input value={form.latitude} onChange={e => update('latitude', e.target.value)} placeholder="-90 ~ 90" style={inputStyle()} /></Field>
      <Field label="经度"><input value={form.longitude} onChange={e => update('longitude', e.target.value)} placeholder="-180 ~ 180" style={inputStyle()} /></Field>
      <Field label="开店日期"><input value={form.openedAt} onChange={e => update('openedAt', e.target.value)} placeholder="2018-09-01" style={inputStyle()} /></Field>
      <Field label="门店面积(㎡)"><input value={form.storeAreaSqm} onChange={e => update('storeAreaSqm', e.target.value)} style={inputStyle()} /></Field>

      <Field label="商圈类型"><input value={form.poiCategory} onChange={e => update('poiCategory', e.target.value)} placeholder="居民区 / 学校 / 商业区" style={inputStyle()} /></Field>
      <Field label="是否项目店">
        <SelectInput
          value={form.isProjectStore ? '1' : '0'}
          onChange={v => update('isProjectStore', v === '1')}
          options={[
            { value: '0', label: '否' },
            { value: '1', label: '是' },
          ]}
        />
      </Field>

      <div style={{
        gridColumn: '1 / -1',
        display: 'flex', gap: 10, alignItems: 'center',
        paddingTop: 10, borderTop: `1px solid ${TOKENS.lineSoft}`, marginTop: 6,
      }}>
        <button
          type="button"
          onClick={async (e) => {
            e.preventDefault();
            const ok = await confirm({
              title: `确认删除「${store.storeCode} ${store.storeName}」?`,
              description: '删除后该门店将从列表中移除,关联的历史数据(销售快照 / 调改记录)保留不动。',
              confirmLabel: '🗑 删除门店',
              danger: true,
            });
            if (ok) delM.mutate();
          }}
          disabled={delM.isPending}
          style={dangerBtnStyle(delM.isPending)}
        >
          {delM.isPending ? '删除中…' : '🗑 删除门店'}
        </button>
        {dialog}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onCancel} style={ghostBtnStyle()}>取消</button>
        <button type="submit" disabled={m.isPending} style={primaryBtnStyle(m.isPending)}>
          {m.isPending ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// 新增门店表单
// =============================================================================

const EMPTY_CREATE_FORM = {
  storeCode: '',
  storeName: '',
  province: '',
  city: '',
  address: '',
  latitude: '',
  longitude: '',
  openedAt: '',
  status: 'active' as StoreStatus,
  isProjectStore: false,
  storeAreaSqm: '',
  poiCategory: '',
};

function StoreCreateForm({
  onCancel, onCreated, onError,
}: {
  onCancel: () => void;
  onCreated: (detail: StoreDetail) => void;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState(EMPTY_CREATE_FORM);

  const m = useMutation({
    mutationFn: (input: CreateStoreInput) => createStore(input),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      setForm(EMPTY_CREATE_FORM);
      onCreated(d);
    },
    onError: (e: unknown) => {
      onError(e instanceof ApiError ? e.message : '新增失败');
    },
  });

  const buildInput = (): CreateStoreInput | { _err: string } => {
    if (form.storeCode.trim() === '') return { _err: '门店编号不能为空' };
    if (form.storeName.trim() === '') return { _err: '门店名称不能为空' };

    const input: CreateStoreInput = {
      storeCode: form.storeCode.trim(),
      storeName: form.storeName.trim(),
      status: form.status,
      isProjectStore: form.isProjectStore,
    };
    const bag = input as unknown as Record<string, unknown>;
    const setStr = (cur: string, key: string) => {
      const v = cur.trim();
      if (v) bag[key] = v;
    };
    setStr(form.province, 'province');
    setStr(form.city, 'city');
    setStr(form.address, 'address');
    setStr(form.poiCategory, 'poiCategory');

    const setNum = (cur: string, key: string, label: string, min?: number, max?: number) => {
      if (cur.trim() === '') return null;
      const n = Number(cur);
      if (!Number.isFinite(n)) return `${label} 不是合法数字`;
      if (min !== undefined && n < min) return `${label} 不能小于 ${min}`;
      if (max !== undefined && n > max) return `${label} 不能大于 ${max}`;
      bag[key] = n;
      return null;
    };
    const errLat = setNum(form.latitude, 'latitude', '纬度', -90, 90);
    if (errLat) return { _err: errLat };
    const errLng = setNum(form.longitude, 'longitude', '经度', -180, 180);
    if (errLng) return { _err: errLng };
    const errArea = setNum(form.storeAreaSqm, 'storeAreaSqm', '门店面积', 0);
    if (errArea) return { _err: errArea };

    if (form.openedAt.trim()) {
      const v = form.openedAt.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { _err: '开店日期格式必须是「年-月-日」如 2018-09-01' };
      input.openedAt = v;
    }
    return input;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = buildInput();
    if ('_err' in r) { onError(r._err); return; }
    m.mutate(r);
  };

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '14px 20px' }}
    >
      <Field label="门店编号" required>
        <input value={form.storeCode} onChange={e => update('storeCode', e.target.value)} placeholder="如 粤37893" style={inputStyle()} />
      </Field>
      <Field label="门店名称" required span={2}>
        <input value={form.storeName} onChange={e => update('storeName', e.target.value)} placeholder="如 东莞莞城旗峰店" style={inputStyle()} />
      </Field>
      <Field label="在用状态">
        <SelectInput
          value={form.status}
          onChange={v => update('status', v as StoreStatus)}
          options={[
            { value: 'active', label: '在用' },
            { value: 'disabled', label: '已停用' },
          ]}
        />
      </Field>

      <Field label="省"><input value={form.province} onChange={e => update('province', e.target.value)} style={inputStyle()} /></Field>
      <Field label="市"><input value={form.city} onChange={e => update('city', e.target.value)} style={inputStyle()} /></Field>
      <Field label="详细地址" span={2}>
        <input value={form.address} onChange={e => update('address', e.target.value)} style={inputStyle()} />
      </Field>

      <Field label="纬度"><input value={form.latitude} onChange={e => update('latitude', e.target.value)} placeholder="-90 ~ 90" style={inputStyle()} /></Field>
      <Field label="经度"><input value={form.longitude} onChange={e => update('longitude', e.target.value)} placeholder="-180 ~ 180" style={inputStyle()} /></Field>
      <Field label="开店日期"><input value={form.openedAt} onChange={e => update('openedAt', e.target.value)} placeholder="2018-09-01" style={inputStyle()} /></Field>
      <Field label="门店面积(㎡)"><input value={form.storeAreaSqm} onChange={e => update('storeAreaSqm', e.target.value)} style={inputStyle()} /></Field>

      <Field label="商圈类型"><input value={form.poiCategory} onChange={e => update('poiCategory', e.target.value)} placeholder="居民区 / 学校 / 商业区" style={inputStyle()} /></Field>
      <Field label="是否项目店">
        <SelectInput
          value={form.isProjectStore ? '1' : '0'}
          onChange={v => update('isProjectStore', v === '1')}
          options={[
            { value: '0', label: '否' },
            { value: '1', label: '是' },
          ]}
        />
      </Field>

      <div style={{
        gridColumn: '1 / -1',
        display: 'flex', gap: 10, justifyContent: 'flex-end',
        paddingTop: 10, borderTop: `1px solid ${TOKENS.lineSoft}`, marginTop: 6,
      }}>
        <button type="button" onClick={onCancel} style={ghostBtnStyle()}>取消</button>
        <button type="submit" disabled={m.isPending} style={primaryBtnStyle(m.isPending)}>
          {m.isPending ? '创建中…' : '创建门店'}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// 小组件
// =============================================================================

function Field({ label, required, span, children }: { label: string; required?: boolean; span?: 1 | 2 | 3 | 4; children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <div style={{ fontSize: TOKENS.fXs, fontWeight: 700, color: TOKENS.inkMuted, marginBottom: 4, letterSpacing: 0.3 }}>
        {label}{required && <span style={{ color: TOKENS.red, marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  );
}

function SelectInput({
  value, onChange, options, width,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  width?: number;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        ...inputStyle({ width }),
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M1 1l4 4 4-4' stroke='%239A9189' stroke-width='1.5' fill='none' stroke-linecap='round'/%3e%3c/svg%3e")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        paddingRight: 28,
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function StatusPill({ status }: { status: StoreStatus }) {
  const s = status === 'active'
    ? { bg: '#D1FAE5', fg: '#065F46' }
    : { bg: '#F3F4F6', fg: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      background: s.bg, color: s.fg,
      fontSize: TOKENS.fXs, fontWeight: 700,
    }}>
      {STORE_STATUS_LABEL[status]}
    </span>
  );
}

function Panel({ children, padding }: { children: React.ReactNode; padding?: string }) {
  return (
    <div style={{
      background: TOKENS.card,
      border: `1px solid ${TOKENS.line}`,
      borderRadius: TOKENS.r5,
      padding: padding ?? '20px 24px',
      boxShadow: TOKENS.shadow1,
      marginBottom: 16,
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

function Th({ children, width }: { children?: React.ReactNode; width?: number }) {
  return (
    <th style={{
      padding: '10px 12px', textAlign: 'left',
      fontSize: TOKENS.fXs, fontWeight: 700, letterSpacing: 0.3,
      width,
    }}>
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td style={{
      padding: '10px 12px', verticalAlign: 'middle',
      fontFamily: mono ? 'Menlo, Monaco, "Courier New", monospace' : 'inherit',
    }}>
      {children}
    </td>
  );
}

function inputStyle(opts: { width?: number } = {}): React.CSSProperties {
  return {
    width: opts.width ?? '100%',
    boxSizing: 'border-box',
    padding: '7px 10px',
    fontSize: TOKENS.fSm,
    border: `1px solid ${TOKENS.line}`,
    borderRadius: 6,
    background: TOKENS.card,
    color: TOKENS.ink,
    fontFamily: 'inherit',
    outline: 'none',
  };
}

function primaryBtnStyle(disabled = false): React.CSSProperties {
  return {
    appearance: 'none',
    border: `1px solid ${TOKENS.red}`,
    background: TOKENS.red,
    color: '#fff',
    padding: '7px 16px',
    borderRadius: 6,
    fontSize: TOKENS.fSm,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  };
}

function ghostBtnStyle(disabled = false): React.CSSProperties {
  return {
    appearance: 'none',
    border: `1px solid ${TOKENS.line}`,
    background: TOKENS.card,
    color: TOKENS.ink,
    padding: '7px 16px',
    borderRadius: 6,
    fontSize: TOKENS.fSm,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  };
}

function dangerBtnStyle(disabled = false): React.CSSProperties {
  return {
    appearance: 'none',
    border: `1px solid ${TOKENS.danger}`,
    background: TOKENS.card,
    color: TOKENS.danger,
    padding: '7px 16px',
    borderRadius: 6,
    fontSize: TOKENS.fSm,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  };
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
