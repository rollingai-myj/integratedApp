/**
 * 调改记录表格 — 筛选 / 排序 / 分页 / 行展开看 AI 诊断 / CSV 导出
 *
 * URL search 状态:filters + pagination 都同步到 URL,可分享 / 收藏 / 浏览器后退。
 * 筛选下拉数据(门店 / 场景)用 long staleTime cache。
 */
import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TOKENS } from '@/tokens';
import {
  fetchChanges,
  fetchChangeDetail,
  fetchStoreOptions,
  fetchSceneOptions,
  changesCsvUrl,
  REASON_LABEL,
  type ChangeAction,
  type ChangeRow,
  type ChangeDetail,
  type ChangesFilters,
} from '@/lib/changes';

export const Route = createFileRoute('/_app/changes')({
  component: ChangesPage,
});

const PAGE_SIZE = 50;

function ChangesPage() {
  // 筛选 state(URL 同步)
  const [filters, setFilters] = React.useState<ChangesFilters>({});
  const [page, setPage] = React.useState(1);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [searchInput, setSearchInput] = React.useState('');

  // 搜索防抖:输入 350ms 后才 patch 到 filters
  React.useEffect(() => {
    const t = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: searchInput.trim() || undefined }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const storesQ = useQuery({
    queryKey: ['changes', 'stores'],
    queryFn: fetchStoreOptions,
    staleTime: 5 * 60_000,
  });
  const scenesQ = useQuery({
    queryKey: ['changes', 'scenes'],
    queryFn: fetchSceneOptions,
    staleTime: 5 * 60_000,
  });
  const listQ = useQuery({
    queryKey: ['changes', 'list', filters, page],
    queryFn: () => fetchChanges(filters, page, PAGE_SIZE),
  });

  const patchFilter = (patch: Partial<ChangesFilters>) => {
    setFilters(prev => ({ ...prev, ...patch }));
    setPage(1);
  };

  const totalPages = listQ.data
    ? Math.max(1, Math.ceil(listQ.data.totalCount / PAGE_SIZE))
    : 1;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{
          fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px',
        }}>
          调改记录
        </h1>
        <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted }}>
          各门店 SKU 上架 / 下架的明细 — 支持筛选、排序、CSV 导出
        </div>
      </div>

      {/* 筛选条 */}
      <div style={{
        background: TOKENS.card,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: TOKENS.r5,
        padding: '14px 16px',
        boxShadow: TOKENS.shadow1,
        marginBottom: 12,
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <Select
          value={filters.storeId ?? ''}
          onChange={v => patchFilter({ storeId: v || undefined })}
          options={[
            { value: '', label: '全部门店' },
            ...(storesQ.data ?? []).map(s => ({
              value: s.storeId,
              label: `${s.storeCode} · ${s.storeName}`,
            })),
          ]}
        />
        <Select
          value={filters.scene === undefined ? '' : String(filters.scene)}
          onChange={v => patchFilter({ scene: v === '' ? undefined : Number(v) })}
          options={[
            { value: '', label: '全部场景' },
            ...(scenesQ.data ?? []).map(s => ({
              value: String(s.scene),
              label: s.sceneName,
            })),
          ]}
        />
        <Select
          value={filters.action ?? ''}
          onChange={v => patchFilter({ action: (v || undefined) as ChangeAction | undefined })}
          options={[
            { value: '', label: '全部动作' },
            { value: 'add', label: '上架' },
            { value: 'remove', label: '下架' },
          ]}
        />
        <DateInput
          value={filters.from}
          placeholder="起始日期"
          onChange={v => patchFilter({ from: v || undefined })}
        />
        <span style={{ color: TOKENS.inkMuted, fontSize: TOKENS.fSm }}>—</span>
        <DateInput
          value={filters.to}
          placeholder="结束日期"
          onChange={v => patchFilter({ to: v || undefined })}
        />
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜索 SKU 或 商品名"
            style={inputStyle}
          />
        </div>
        <a
          href={changesCsvUrl(filters)}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: TOKENS.red,
            color: '#fff',
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: TOKENS.fSm,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          📥 导出 CSV
        </a>
      </div>

      {/* 表格 */}
      <div style={{
        background: TOKENS.card,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: TOKENS.r5,
        boxShadow: TOKENS.shadow1,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: TOKENS.fSm }}>
          <thead>
            <tr style={{ background: TOKENS.bgWarm, color: TOKENS.inkSoft }}>
              <Th width={140}>时间</Th>
              <Th width={140}>门店</Th>
              <Th width={120}>SKU</Th>
              <Th>商品名</Th>
              <Th width={100}>场景</Th>
              <Th width={70}>动作</Th>
              <Th width={120}>原因</Th>
              <Th width={110}>生效日期</Th>
              <Th width={110}>操作人</Th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>
                <td colSpan={9} style={{ padding: 12 }}>
                  <div style={skeletonStyle} />
                </td>
              </tr>
            ))}
            {!listQ.isLoading && listQ.data?.items.length === 0 && (
              <tr>
                <td colSpan={9} style={{
                  padding: '48px 0',
                  textAlign: 'center',
                  color: TOKENS.inkMuted,
                }}>
                  暂无符合条件的记录
                </td>
              </tr>
            )}
            {!listQ.isLoading && listQ.data?.items.map((row) => (
              <Row
                key={row.id}
                row={row}
                expanded={expanded === row.id}
                onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
              />
            ))}
          </tbody>
        </table>

        {/* 分页 */}
        {listQ.data && listQ.data.totalCount > 0 && (
          <div style={{
            padding: '12px 16px',
            borderTop: `1px solid ${TOKENS.lineSoft}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: TOKENS.fXs,
            color: TOKENS.inkSoft,
          }}>
            <span>
              共 <strong style={{ color: TOKENS.ink }}>
                {listQ.data.totalCount.toLocaleString()}
              </strong> 条 · 每页 {PAGE_SIZE}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <PageBtn disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← 上一页</PageBtn>
              <span style={{ padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>
                {page} / {totalPages}
              </span>
              <PageBtn disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页 →</PageBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  row, expanded, onToggle,
}: {
  row: ChangeRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detailQ = useQuery({
    queryKey: ['change-detail', row.id],
    queryFn: () => fetchChangeDetail(row.id),
    enabled: expanded,
    staleTime: 60_000,
  });

  const actionColor = row.action === 'add' ? TOKENS.success : TOKENS.danger;
  const actionBg = row.action === 'add' ? '#D1FAE5' : '#FEE2E2';
  const actionText = row.action === 'add' ? '+ 上架' : '− 下架';

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderTop: `1px solid ${TOKENS.lineSoft}`,
          cursor: 'pointer',
          background: expanded ? TOKENS.redSoft : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => {
          if (!expanded) (e.currentTarget as HTMLTableRowElement).style.background = TOKENS.bg;
        }}
        onMouseLeave={e => {
          if (!expanded) (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
        }}
      >
        <Td>{formatTime(row.createdAt)}</Td>
        <Td>
          <div style={{ color: TOKENS.ink }}>{row.storeName}</div>
          <div style={{ color: TOKENS.inkMuted, fontSize: TOKENS.fXs }}>{row.storeCode}</div>
        </Td>
        <Td mono>{row.skuCode}</Td>
        <Td>
          <div style={{ color: TOKENS.ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.productName ?? <span style={{ color: TOKENS.inkMuted }}>—</span>}
          </div>
          {row.brand && (
            <div style={{ color: TOKENS.inkMuted, fontSize: TOKENS.fXs }}>{row.brand}</div>
          )}
        </Td>
        <Td>{row.sceneName ?? `场景${row.scene}`}</Td>
        <Td>
          <span style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 4,
            background: actionBg,
            color: actionColor,
            fontSize: TOKENS.fXs,
            fontWeight: 700,
          }}>
            {actionText}
          </span>
        </Td>
        <Td>
          <div style={{ color: TOKENS.ink }}>
            {REASON_LABEL[row.reasonCode]}
          </div>
        </Td>
        <Td mono>{row.effectiveDate}</Td>
        <Td>{row.createdByDisplay ?? '—'}</Td>
      </tr>
      {expanded && (
        <tr style={{
          background: '#FDFAF5',
          borderTop: `1px solid ${TOKENS.lineSoft}`,
        }}>
          <td colSpan={9} style={{ padding: '16px 20px' }}>
            <ExpandedDetail
              row={row}
              detail={detailQ.data}
              loading={detailQ.isLoading}
              error={!!detailQ.error}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetail({
  row,
  detail,
  loading,
  error,
}: {
  row: ChangeRow;
  detail?: ChangeDetail;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <div style={{ ...skeletonStyle, height: 80 }} />;
  }
  if (error || !detail) {
    return <div style={{ color: TOKENS.danger, fontSize: TOKENS.fSm }}>详情加载失败</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      {/* 原因说明 + 调整批次 */}
      <div>
        <DetailField label="原因说明">
          {row.reasonText || <span style={{ color: TOKENS.inkMuted }}>无</span>}
        </DetailField>
        {detail.adjustment && (
          <div style={{ marginTop: 12 }}>
            <DetailField label="所属调整批次">
              <div>
                <div style={{ fontSize: TOKENS.fSm, color: TOKENS.ink }}>
                  {detail.adjustment.summaryText || '(无摘要)'}
                </div>
                <div style={{
                  fontSize: TOKENS.fXs, color: TOKENS.inkMuted, marginTop: 4,
                }}>
                  共 {detail.adjustment.addedCount} 上架 / {detail.adjustment.removedCount} 下架 · 触发于 {formatTime(detail.adjustment.triggeredAt)}
                  {detail.adjustment.triggeredByDisplay && ` · 由 ${detail.adjustment.triggeredByDisplay}`}
                </div>
              </div>
            </DetailField>
          </div>
        )}
      </div>
      {/* 智能体分析结果(可读视图) */}
      <div>
        <DetailField label="智能体分析">
          {detail.hasAiDiagnosis ? (
            <div style={{
              padding: '10px 12px',
              background: TOKENS.bg,
              border: `1px solid ${TOKENS.lineSoft}`,
              borderRadius: 6,
              fontSize: TOKENS.fSm,
              lineHeight: 1.6,
              color: TOKENS.ink,
              maxHeight: 280,
              overflow: 'auto',
            }}>
              <AiDiagnosisView value={detail.aiDiagnosis} />
            </div>
          ) : (
            <span style={{ color: TOKENS.inkMuted }}>无</span>
          )}
        </DetailField>
      </div>
    </div>
  );
}

/**
 * 把 ai_diagnosis 这种"形状未知"的 JSON 渲染成可读的列表/字段,
 * 替代之前直接 JSON.stringify 给用户看的做法。
 */
function AiDiagnosisView({ value, level = 0 }: { value: unknown; level?: number }) {
  if (value === null || value === undefined) {
    return <span style={{ color: TOKENS.inkMuted }}>—</span>;
  }
  if (typeof value === 'string') {
    return <span>{value}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: TOKENS.inkMuted }}>(空)</span>;
    return (
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {value.map((item, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <AiDiagnosisView value={item} level={level + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span style={{ color: TOKENS.inkMuted }}>(空)</span>;
    return (
      <div style={level === 0 ? undefined : { marginTop: 2 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 6 }}>
            <span style={{ fontWeight: 700, color: TOKENS.inkSoft, marginRight: 6 }}>
              {humanizeKey(k)}:
            </span>
            <AiDiagnosisView value={v} level={level + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

function humanizeKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: TOKENS.fXs, fontWeight: 700, color: TOKENS.inkMuted,
        marginBottom: 4, letterSpacing: 0.3,
      }}>
        {label}
      </div>
      <div style={{ fontSize: TOKENS.fSm, color: TOKENS.ink }}>
        {children}
      </div>
    </div>
  );
}

function Th({ children, width }: { children: React.ReactNode; width?: number }) {
  return (
    <th style={{
      padding: '12px 14px',
      textAlign: 'left',
      fontSize: TOKENS.fXs,
      fontWeight: 700,
      letterSpacing: 0.3,
      width,
    }}>
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td style={{
      padding: '12px 14px',
      verticalAlign: 'top',
      fontFamily: mono ? 'Menlo, Monaco, "Courier New", monospace' : 'inherit',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </td>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        appearance: 'none',
        border: `1px solid ${TOKENS.line}`,
        background: TOKENS.card,
        borderRadius: 8,
        padding: '7px 28px 7px 12px',
        fontSize: TOKENS.fSm,
        color: TOKENS.ink,
        cursor: 'pointer',
        outline: 'none',
        fontFamily: 'inherit',
        backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M1 1l4 4 4-4' stroke='%239A9189' stroke-width='1.5' fill='none' stroke-linecap='round'/%3e%3c/svg%3e")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function DateInput({
  value, placeholder, onChange,
}: {
  value?: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        ...inputStyle,
        width: 140,
        padding: '7px 10px',
      }}
    />
  );
}

function PageBtn({
  children, disabled, onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none',
        border: `1px solid ${TOKENS.line}`,
        background: disabled ? TOKENS.bg : TOKENS.card,
        color: disabled ? TOKENS.inkMuted : TOKENS.ink,
        padding: '5px 12px',
        borderRadius: 6,
        fontSize: TOKENS.fXs,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  // 2026-06-23 09:05:43.084112+00 → 06-23 09:05
  // 也能处理 ISO 'T' 格式
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

const inputStyle: React.CSSProperties = {
  appearance: 'none',
  border: `1px solid ${TOKENS.line}`,
  background: TOKENS.card,
  borderRadius: 8,
  padding: '7px 12px',
  fontSize: TOKENS.fSm,
  color: TOKENS.ink,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  width: '100%',
};

const skeletonStyle: React.CSSProperties = {
  height: 20,
  borderRadius: 4,
  background: `linear-gradient(110deg, ${TOKENS.bgWarm} 30%, #efe9df 50%, ${TOKENS.bgWarm} 70%)`,
  backgroundSize: '200% 100%',
  animation: 'sc-shimmer 1.4s linear infinite',
};
