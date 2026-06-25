/**
 * 活动数据上传(promo xlsx)— 跟 products/snapshots 是不同体系。
 *
 * 用户上传一个 5-sheet xlsx(周末啤酒日 / 会员价 / 品牌满减券 / 周二会员日 /
 * 常规优惠券),后端 promo parser 拆 sheet → 入 hq_promo_batches + raw_items +
 * offers。一次上传 = 全量替换,旧批次自动 voided。
 */
import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TOKENS } from '@/tokens';
import { ApiError } from '@/lib/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import {
  uploadPromoXlsx,
  fetchPromoBatches,
  voidPromoBatch,
  unvoidPromoBatch,
  deletePromoBatch,
  type PromoBatch,
} from '@/lib/promo-uploads';

export const Route = createFileRoute('/_app/uploads/promotions')({
  component: PromotionsUploadPage,
});

// 字段说明从用户给的实际 xlsx 提取(每个工作表第一行表头)
const SHEET_FIELDS: Array<{ label: string; key: string; columns: string[]; note?: string }> = [
  {
    label: '周末啤酒日', key: 'weekend_beer',
    columns: ['大类', '商品代码', '品名及规格', '单位', '原零售价', '具体促销方式', '包含商品数', '促销价', '开始时间', '结束时间'],
  },
  {
    label: '会员价', key: 'member_price',
    columns: ['大类', '商品代码', '品名及规格', '单位', '原零售价', '具体促销方式', '包含商品数', '促销价', '促销组', '开始时间', '结束时间'],
  },
  {
    label: '品牌满减券', key: 'brand_coupon',
    columns: ['商品代码', '品名及规格', '单位', '原零售价', '具体促销方式', '开始时间', '结束时间'],
    note: '「具体促销方式」第一行写「<池子名>↵满 X 减 Y 元」,该池子下方各商品行的「具体促销方式」可以留空,系统会自动归入同一池子。',
  },
  {
    label: '周二会员日', key: 'tuesday_member',
    columns: ['商品代码', '品名及规格', '单位', '原零售价', '具体促销方式', '开始时间', '结束时间'],
  },
  {
    label: '常规优惠券', key: 'regular_coupon',
    columns: ['商品代码', '品名及规格', '单位', '零售价', '具体促销方式', '开始时间', '结束时间'],
  },
];

function PromotionsUploadPage() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [toast, setToast] = React.useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const batchesQ = useQuery({
    queryKey: ['promo', 'batches'],
    queryFn: fetchPromoBatches,
  });

  const uploadM = useMutation({
    mutationFn: uploadPromoXlsx,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['promo', 'batches'] });
      const total = Object.values(r.batch.parsedTotal).reduce((s, n) => s + n, 0);
      flashToast('success', `已上传 · 共解析出 ${total} 条活动 · ${r.warnings.length} 条提示`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : '上传失败';
      flashToast('error', msg);
    },
  });

  const voidM = useMutation({
    mutationFn: voidPromoBatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promo', 'batches'] });
      flashToast('success', '已停用');
    },
    onError: (e: unknown) => flashToast('error', e instanceof ApiError ? e.message : '停用失败'),
  });

  const unvoidM = useMutation({
    mutationFn: unvoidPromoBatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promo', 'batches'] });
      flashToast('success', '已启用(其他批次自动停用)');
    },
    onError: (e: unknown) => flashToast('error', e instanceof ApiError ? e.message : '启用失败'),
  });

  const deleteM = useMutation({
    mutationFn: deletePromoBatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promo', 'batches'] });
      flashToast('success', '已删除');
    },
    onError: (e: unknown) => flashToast('error', e instanceof ApiError ? e.message : '删除失败'),
  });

  const flashToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 2400);
  };

  const handleFile = (f: File) => {
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      flashToast('error', '只支持 Excel 文件(后缀 .xlsx / .xls)');
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      flashToast('error', '文件不能超过 20 MB');
      return;
    }
    uploadM.mutate(f);
  };

  return (
    <div style={{ maxWidth: 1080 }}>
      <h1 style={{ fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px' }}>
        活动数据
      </h1>
      <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted, marginBottom: 20, maxWidth: 760 }}>
        上传一份 Excel 文件,里面包含 5 个工作表(会员价 / 周末啤酒日 / 品牌满减券 / 周二会员日 / 常规优惠券)。
        每次上传都会自动停用此前的活动批次,如需恢复旧批次,在下方记录中点「启用」即可。
      </div>

      {/* 模板 + 工作表字段说明 */}
      <Panel>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', gap: 24, marginBottom: 16,
        }}>
          <div>
            <div style={{ fontSize: TOKENS.fBase, fontWeight: 700, color: TOKENS.ink }}>
              填写说明 · 共 5 个工作表
            </div>
            <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, marginTop: 2 }}>
              工作表名称必须是下方 5 个之一,每个工作表的第一行是列名,请勿删除或改名。
            </div>
          </div>
          <a
            href="/promotions-template.xlsx"
            download="promotions-template.xlsx"
            style={{
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: TOKENS.red,
              color: '#fff',
              padding: '10px 18px',
              borderRadius: 10,
              fontSize: TOKENS.fBase,
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: `0 4px 12px ${TOKENS.red}55`,
            }}
          >
            📄 下载模板
          </a>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {SHEET_FIELDS.map(sheet => (
            <div key={sheet.key} style={{
              padding: '12px 14px',
              background: TOKENS.bg,
              border: `1px solid ${TOKENS.lineSoft}`,
              borderRadius: 8,
            }}>
              <div style={{
                fontSize: TOKENS.fSm, fontWeight: 700, color: TOKENS.ink,
                marginBottom: 6,
              }}>
                工作表「{sheet.label}」
              </div>
              <div style={{
                fontSize: TOKENS.fXs, color: TOKENS.inkSoft, lineHeight: 1.6,
                marginBottom: sheet.note ? 6 : 0,
              }}>
                {sheet.columns.join(' · ')}
              </div>
              {sheet.note && (
                <div style={{
                  fontSize: 11, color: TOKENS.inkMuted, lineHeight: 1.5,
                  borderTop: `1px dashed ${TOKENS.lineSoft}`, paddingTop: 6,
                }}>
                  💡 {sheet.note}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* 上传区 */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) handleFile(f);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          background: dragOver ? TOKENS.redSoft : TOKENS.card,
          border: `2px dashed ${dragOver ? TOKENS.red : TOKENS.line}`,
          borderRadius: TOKENS.r5,
          padding: '40px 24px',
          textAlign: 'center',
          color: TOKENS.inkMuted,
          marginBottom: 16,
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>{uploadM.isPending ? '⌛' : '↓'}</div>
        <div style={{ fontSize: TOKENS.fBase, color: TOKENS.inkSoft, marginBottom: 4 }}>
          {uploadM.isPending ? '正在读取文件…' : '把文件拖到这里,或点击选择文件'}
        </div>
        <div style={{ fontSize: TOKENS.fXs }}>仅支持 Excel 格式(.xlsx / .xls) · 单个文件最大 20 MB · 上传后,旧的活动批次会自动停用</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* 历史批次 */}
      <Panel>
        <div style={{ fontSize: TOKENS.fBase, fontWeight: 700, color: TOKENS.ink, marginBottom: 12 }}>
          上传记录
        </div>

        {batchesQ.isLoading && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: TOKENS.inkMuted, fontSize: TOKENS.fSm }}>
            加载中…
          </div>
        )}
        {!batchesQ.isLoading && (batchesQ.data?.length ?? 0) === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: TOKENS.inkMuted, fontSize: TOKENS.fSm }}>
            还没有上传记录。完成第一次上传后,会出现在这里。
          </div>
        )}

        {(batchesQ.data ?? []).map(b => (
          <BatchCard
            key={b.id}
            batch={b}
            onVoid={async () => {
              const ok = await confirm({
                title: `停用「${b.fileName}」?`,
                description: '停用后,本批次包含的活动不再生效。',
                confirmLabel: '停用',
                danger: true,
              });
              if (ok) voidM.mutate(b.id);
            }}
            onUnvoid={async () => {
              const ok = await confirm({
                title: `启用「${b.fileName}」?`,
                description: '启用后,其他正在生效的批次会自动停用,只有这一份会生效。',
                confirmLabel: '启用',
              });
              if (ok) unvoidM.mutate(b.id);
            }}
            onDelete={async () => {
              const ok = await confirm({
                title: `删除「${b.fileName}」?`,
                description: '删除后无法恢复。',
                confirmLabel: '🗑 删除',
                danger: true,
              });
              if (ok) deleteM.mutate(b.id);
            }}
            voiding={voidM.isPending && voidM.variables === b.id}
            unvoiding={unvoidM.isPending && unvoidM.variables === b.id}
            deleting={deleteM.isPending && deleteM.variables === b.id}
          />
        ))}
      </Panel>

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

      {confirmDialog}
    </div>
  );
}

function BatchCard({
  batch, onVoid, onUnvoid, onDelete, voiding, unvoiding, deleting,
}: {
  batch: PromoBatch;
  onVoid: () => void;
  onUnvoid: () => void;
  onDelete: () => void;
  voiding: boolean;
  unvoiding: boolean;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const totalOffers = Object.values(batch.parsedTotal).reduce((s, n) => s + n, 0);
  const totalRaw = Object.values(batch.rowTotal).reduce((s, n) => s + n, 0);

  return (
    <div style={{
      border: `1px solid ${TOKENS.lineSoft}`,
      borderRadius: 10,
      marginBottom: 8,
      background: expanded ? '#FDFAF5' : TOKENS.card,
      transition: 'background 0.15s',
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
      >
        <StatusPill voided={batch.isVoided} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: TOKENS.fSm, fontWeight: 600, color: TOKENS.ink,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {batch.fileName}
          </div>
          <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, marginTop: 2 }}>
            {formatTime(batch.createdAt)}
            {batch.activityWindowStart && batch.activityWindowEnd && ` · ${batch.activityWindowStart.slice(0, 10)} → ${batch.activityWindowEnd.slice(0, 10)}`}
          </div>
        </div>
        <div style={{
          fontSize: TOKENS.fXs, color: TOKENS.inkSoft,
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{ color: TOKENS.success, fontWeight: 700 }}>{totalOffers}</span>
          <span style={{ color: TOKENS.inkMuted }}> 条活动 / 共 </span>
          <span>{totalRaw}</span>
          <span style={{ color: TOKENS.inkMuted }}> 行原始数据</span>
          {batch.parseWarnings.length > 0 && (
            <span style={{ color: TOKENS.warn, marginLeft: 6 }}>
              · {batch.parseWarnings.length} 条提示
            </span>
          )}
        </div>
        {batch.isVoided ? (
          <ActionBtn label={unvoiding ? '启用中…' : '启用'} disabled={unvoiding} primary
            onClick={e => { e.stopPropagation(); onUnvoid(); }} />
        ) : (
          <ActionBtn label={voiding ? '停用中…' : '停用'} disabled={voiding}
            onClick={e => { e.stopPropagation(); onVoid(); }} />
        )}
        <ActionBtn label="删除" disabled={deleting} danger
          onClick={e => { e.stopPropagation(); onDelete(); }} />
        <span style={{ color: TOKENS.inkMuted, fontSize: 10 }}>{expanded ? '▴' : '▾'}</span>
      </div>
      {expanded && (
        <div style={{
          padding: '12px 16px 16px',
          borderTop: `1px solid ${TOKENS.lineSoft}`,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
            {SHEET_FIELDS.map(sheet => {
              const raw = batch.rowTotal[sheet.key] ?? 0;
              const off = batch.parsedTotal[sheet.key] ?? 0;
              return (
                <div key={sheet.key} style={{
                  padding: '10px 12px', background: TOKENS.bg,
                  border: `1px solid ${TOKENS.lineSoft}`, borderRadius: 8,
                }}>
                  <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginBottom: 4 }}>
                    {sheet.label}
                  </div>
                  <div style={{
                    fontSize: TOKENS.fLg, fontWeight: 800, color: TOKENS.ink,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {off}
                    <span style={{ fontSize: 11, fontWeight: 400, color: TOKENS.inkMuted, marginLeft: 4 }}>
                      / {raw}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {batch.parseWarnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                fontSize: TOKENS.fXs, fontWeight: 700, color: TOKENS.inkMuted,
                marginBottom: 6, letterSpacing: 0.3,
              }}>
                需要注意的行(共 {batch.parseWarnings.length} 条)
              </div>
              <div style={{
                maxHeight: 200, overflowY: 'auto',
                background: TOKENS.bg, border: `1px solid ${TOKENS.lineSoft}`,
                borderRadius: 6, padding: '8px 12px',
                fontSize: TOKENS.fXs, color: TOKENS.inkSoft,
              }}>
                {batch.parseWarnings.map((w, i) => (
                  <div key={i} style={{ padding: '2px 0' }}>
                    <span style={{
                      display: 'inline-block', width: 150,
                      color: TOKENS.inkMuted, fontVariantNumeric: 'tabular-nums',
                    }}>
                      工作表「{w.sheet}」第 {w.row} 行
                    </span>
                    {w.reason}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  label, onClick, disabled, primary, danger,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const color = primary ? '#fff' : danger ? TOKENS.danger : TOKENS.ink;
  const bg = primary ? TOKENS.red : TOKENS.card;
  const border = primary ? TOKENS.red : TOKENS.line;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none',
        border: `1px solid ${border}`,
        background: bg,
        color,
        padding: '5px 12px',
        borderRadius: 6,
        fontSize: TOKENS.fXs,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

function StatusPill({ voided }: { voided: boolean }) {
  const s = voided
    ? { bg: '#F3F4F6', fg: '#374151', label: '已停用' }
    : { bg: '#D1FAE5', fg: '#065F46', label: '生效中' };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      background: s.bg, color: s.fg,
      fontSize: TOKENS.fXs, fontWeight: 700, flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: TOKENS.card,
      border: `1px solid ${TOKENS.line}`,
      borderRadius: TOKENS.r5,
      padding: '20px 24px',
      boxShadow: TOKENS.shadow1,
      marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
