/**
 * 通用 CSV 上传页 — 3 个 kind 共用。
 *
 * 区域:
 *   1. 说明 + 「下载 CSV 模板」按钮 + 字段清单
 *   2. 拖拽 / 点击上传(进度 + 解析结果摘要)
 *   3. 历史批次列表(点击展开看错误清单 / 解析预览)
 *
 * apply / rollback 留下个 PR;现在只到 staging。
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TOKENS } from '@/tokens';
import { ApiError } from '@/lib/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import {
  uploadCsv,
  fetchBatches,
  fetchBatchDetail,
  deleteBatch,
  applyBatch,
  rollbackBatchApi,
  templateUrl,
  fetchConflicts,
  STATUS_LABEL,
  type UploadKind,
  type UploadBatchSummary,
  type UploadStatus,
  type ColumnSpec,
  type ApplySummary,
  type ApplyMode,
  type ConflictPreview,
} from '@/lib/uploads';

export function CsvUploadPage({ kind, spec, hideHeading }: { kind: UploadKind; spec: ColumnSpec; hideHeading?: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [toast, setToast] = React.useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const batchesQ = useQuery({
    queryKey: ['uploads', kind, 'batches'],
    queryFn: () => fetchBatches(kind),
  });

  const uploadM = useMutation({
    mutationFn: (file: File) => uploadCsv(kind, file),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['uploads', kind, 'batches'] });
      flashToast('success', `已读取 ${r.totalRows} 行,其中 ${r.validRows} 行可生效`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : '上传失败';
      flashToast('error', msg);
    },
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteBatch(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['uploads', kind, 'batches'] });
      flashToast('success', '已删除');
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : '删除失败';
      flashToast('error', msg);
    },
  });

  // 冲突弹窗状态:点「让它生效」后,如果有重复主键,会先弹窗让用户选 mode
  const [conflictDialog, setConflictDialog] = React.useState<{
    batchId: string;
    fileName: string;
    preview: ConflictPreview;
  } | null>(null);

  const applyM = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode?: ApplyMode }) => applyBatch(id, mode),
    onSuccess: (r: ApplySummary) => {
      qc.invalidateQueries({ queryKey: ['uploads', kind, 'batches'] });
      qc.invalidateQueries({ queryKey: ['uploads', 'detail'] });
      setConflictDialog(null);
      flashToast('success', `已生效 · 新增 ${r.inserted} · 更新 ${r.updated} · 跳过 ${r.skipped}`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : '生效失败';
      flashToast('error', msg);
    },
  });

  const rollbackM = useMutation({
    mutationFn: (id: string) => rollbackBatchApi(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['uploads', kind, 'batches'] });
      qc.invalidateQueries({ queryKey: ['uploads', 'detail'] });
      flashToast('success', `已撤销 ${r.reverted} 条`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : '撤销失败';
      flashToast('error', msg);
    },
  });

  const flashToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 2400);
  };

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith('.csv')) {
      flashToast('error', '只支持 CSV 文件(后缀 .csv)');
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
      {!hideHeading && (
        <>
          <h1 style={{ fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px' }}>
            {spec.label}
          </h1>
          <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted, marginBottom: 20, maxWidth: 760 }}>
            {spec.description}
          </div>
        </>
      )}

      {/* 模板 + 字段说明 */}
      <Panel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: TOKENS.fBase, fontWeight: 700, color: TOKENS.ink }}>
              填写说明
            </div>
            <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, marginTop: 2 }}>
              下载模板后,按下方说明在 Excel 中填写,保存为 CSV 文件再上传。第一行是列名,请勿删除或改名。
            </div>
          </div>
          <a
            href={templateUrl(kind)}
            download={`${kind}-template.csv`}
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

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: TOKENS.fSm }}>
          <thead>
            <tr style={{ background: TOKENS.bgWarm, color: TOKENS.inkSoft }}>
              <Th width={200}>列名</Th>
              <Th width={70}>是否必填</Th>
              <Th>这一列填什么</Th>
              <Th width={200}>示例</Th>
            </tr>
          </thead>
          <tbody>
            {spec.columns.map(col => (
              <tr key={col.name} style={{ borderTop: `1px solid ${TOKENS.lineSoft}` }}>
                <Td mono><code style={{ color: TOKENS.ink }}>{col.name}</code></Td>
                <Td>{col.required ? <span style={{ color: TOKENS.red, fontWeight: 700 }}>必填</span> : '选填'}</Td>
                <Td>
                  {col.description}
                  {col.enumValues && (
                    <div style={{
                      marginTop: 4, fontSize: TOKENS.fXs, color: TOKENS.inkMuted,
                    }}>
                      可选值:{col.enumValues.join(' / ')}
                    </div>
                  )}
                </Td>
                <Td mono><span style={{ color: TOKENS.inkSoft }}>{col.sample}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <div style={{ fontSize: TOKENS.fXs }}>仅支持 CSV 格式 · 单个文件最大 20 MB · 一次最多 50,000 行</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
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
            kind={kind}
            batch={b}
            expanded={expanded === b.id}
            onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
            onDelete={async () => {
              const ok = await confirm({
                title: `确认删除「${b.fileName}」?`,
                description: '删除后无法恢复(仅对未生效的批次可删除)。',
                confirmLabel: '🗑 删除',
                danger: true,
              });
              if (ok) deleteM.mutate(b.id);
            }}
            onApply={async () => {
              // 先看冲突:有重复 → 弹冲突确认窗;没冲突 → 弹自定义确认窗
              try {
                const preview = await fetchConflicts(b.id);
                if (preview.toUpdateCount > 0) {
                  setConflictDialog({ batchId: b.id, fileName: b.fileName, preview });
                  return;
                }
                const ok = await confirm({
                  title: `让「${b.fileName}」生效?`,
                  description: `本批 ${b.validRows} 行数据会写入系统,生效后可在列表里点「撤销」恢复。`,
                  confirmLabel: '让它生效',
                });
                if (ok) applyM.mutate({ id: b.id });
              } catch (e) {
                flashToast('error', e instanceof ApiError ? e.message : '查询冲突失败');
              }
            }}
            onRollback={async () => {
              const ok = await confirm({
                title: `撤销「${b.fileName}」?`,
                description: '本批次写入的数据会被还原到上传前的状态。',
                confirmLabel: '撤销',
                danger: true,
              });
              if (ok) rollbackM.mutate(b.id);
            }}
            deleting={deleteM.isPending && deleteM.variables === b.id}
            applying={applyM.isPending && applyM.variables?.id === b.id}
            rollingBack={rollbackM.isPending && rollbackM.variables === b.id}
          />
        ))}
      </Panel>

      {toast && (
        <div style={{
          position: 'fixed',
          right: 32, bottom: 32,
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

      {conflictDialog && (
        <ConflictDialog
          kind={kind}
          fileName={conflictDialog.fileName}
          preview={conflictDialog.preview}
          applying={applyM.isPending}
          onCancel={() => setConflictDialog(null)}
          onConfirm={(mode) => applyM.mutate({ id: conflictDialog.batchId, mode })}
        />
      )}

      {confirmDialog}
    </div>
  );
}

// =============================================================================
// 冲突确认弹窗
// =============================================================================

function ConflictDialog({
  kind, fileName, preview, applying, onCancel, onConfirm,
}: {
  kind: UploadKind;
  fileName: string;
  preview: ConflictPreview;
  applying: boolean;
  onCancel: () => void;
  onConfirm: (mode: ApplyMode) => void;
}) {
  const entityName = kind === 'products' ? '商品' : kind === 'stores' ? '门店' : '记录';
  const keyName = kind === 'products' ? '商品编码' : kind === 'stores' ? '门店编号' : '主键';

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 12, 8, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '85vh',
          background: TOKENS.card,
          borderRadius: 12,
          boxShadow: TOKENS.shadow2,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '18px 24px',
          borderBottom: `1px solid ${TOKENS.lineSoft}`,
        }}>
          <div style={{ fontSize: TOKENS.fLg, fontWeight: 700, color: TOKENS.ink }}>
            发现重复{entityName},请确认是否覆盖
          </div>
          <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, marginTop: 4 }}>
            「{fileName}」
          </div>
        </div>

        <div style={{ padding: '16px 24px', overflow: 'auto', flex: 1 }}>
          <div style={{ fontSize: TOKENS.fSm, color: TOKENS.ink, lineHeight: 1.7 }}>
            本批共 <b>{preview.totalRows}</b> 行可生效,其中:
            <ul style={{ margin: '6px 0 0', paddingLeft: 22 }}>
              <li>
                <b style={{ color: TOKENS.success }}>{preview.toInsertCount}</b> 行是<b>新{entityName}</b>(系统中没有这个{keyName})
              </li>
              <li>
                <b style={{ color: TOKENS.warn }}>{preview.toUpdateCount}</b> 行的{keyName}<b>已经存在</b>,如继续生效会用本次上传的数据<b>覆盖现有信息</b>
              </li>
            </ul>
          </div>

          <div style={{
            marginTop: 14,
            fontSize: TOKENS.fXs, fontWeight: 700, color: TOKENS.inkMuted,
            letterSpacing: 0.3,
          }}>
            将被覆盖的{entityName}{preview.conflicts.length < preview.toUpdateCount ? `(只列前 ${preview.conflicts.length} 条,共 ${preview.toUpdateCount} 条)` : ''}
          </div>
          <div style={{
            marginTop: 6,
            maxHeight: 220, overflow: 'auto',
            border: `1px solid ${TOKENS.lineSoft}`,
            borderRadius: 6,
            background: TOKENS.bg,
            padding: '8px 12px',
            fontSize: TOKENS.fXs,
            color: TOKENS.inkSoft,
          }}>
            {preview.conflicts.map((c, i) => (
              <div key={i} style={{ padding: '2px 0', display: 'flex', gap: 10 }}>
                <code style={{ color: TOKENS.ink, minWidth: 100, fontFamily: 'Menlo, monospace' }}>
                  {c.key}
                </code>
                <span>{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: '14px 24px',
          borderTop: `1px solid ${TOKENS.lineSoft}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}>
          <button
            onClick={onCancel}
            disabled={applying}
            style={dialogBtnStyle('ghost', applying)}
          >
            取消
          </button>
          <button
            onClick={() => onConfirm('insert_only')}
            disabled={applying || preview.toInsertCount === 0}
            style={dialogBtnStyle('secondary', applying || preview.toInsertCount === 0)}
            title={preview.toInsertCount === 0 ? '本批没有新增项' : ''}
          >
            只新增 {preview.toInsertCount} 行,跳过已有
          </button>
          <button
            onClick={() => onConfirm('upsert')}
            disabled={applying}
            style={dialogBtnStyle('primary', applying)}
          >
            {applying ? '生效中…' : `全部生效(含覆盖 ${preview.toUpdateCount} 行)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function dialogBtnStyle(
  variant: 'primary' | 'secondary' | 'ghost',
  disabled: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    appearance: 'none',
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: TOKENS.fSm,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  };
  if (variant === 'primary') {
    return { ...base, border: `1px solid ${TOKENS.red}`, background: TOKENS.red, color: '#fff' };
  }
  if (variant === 'secondary') {
    return { ...base, border: `1px solid ${TOKENS.line}`, background: TOKENS.card, color: TOKENS.ink };
  }
  return { ...base, border: 0, background: 'transparent', color: TOKENS.inkMuted };
}

function BatchCard({
  kind, batch, expanded, onToggle, onDelete, onApply, onRollback,
  deleting, applying, rollingBack,
}: {
  kind: UploadKind;
  batch: UploadBatchSummary;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onApply: () => void;
  onRollback: () => void;
  deleting: boolean;
  applying: boolean;
  rollingBack: boolean;
}) {
  const detailQ = useQuery({
    queryKey: ['uploads', 'detail', batch.id],
    queryFn: () => fetchBatchDetail(batch.id),
    enabled: expanded,
    staleTime: 60_000,
  });

  const canDelete = batch.status === 'staged' || batch.status === 'failed';
  const canApply = batch.status === 'staged' && batch.validRows > 0 && kind !== 'promotions';
  const canRollback = batch.status === 'applied';

  return (
    <div style={{
      border: `1px solid ${TOKENS.lineSoft}`,
      borderRadius: 10,
      marginBottom: 8,
      background: expanded ? '#FDFAF5' : TOKENS.card,
      transition: 'background 0.15s',
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          cursor: 'pointer',
        }}
      >
        <StatusPill status={batch.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: TOKENS.fSm, fontWeight: 600, color: TOKENS.ink,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {batch.fileName}
          </div>
          <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, marginTop: 2 }}>
            {formatTime(batch.createdAt)} · {batch.uploadedByDisplay || '—'}
          </div>
        </div>
        <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: TOKENS.success, fontWeight: 700 }}>{batch.validRows}</span>
          <span style={{ color: TOKENS.inkMuted }}> 可生效 / 共 </span>
          <span>{batch.totalRows}</span>
          <span style={{ color: TOKENS.inkMuted }}> 行</span>
          {batch.errorRows > 0 && (
            <span style={{ color: TOKENS.danger, marginLeft: 6 }}>
              · {batch.errorRows} 行有问题
            </span>
          )}
        </div>
        {canApply && (
          <ActionBtn
            label={applying ? '生效中…' : '让它生效'}
            disabled={applying}
            primary
            onClick={e => { e.stopPropagation(); onApply(); }}
          />
        )}
        {canRollback && (
          <ActionBtn
            label={rollingBack ? '撤销中…' : '撤销'}
            disabled={rollingBack}
            onClick={e => { e.stopPropagation(); onRollback(); }}
          />
        )}
        {canDelete && (
          <ActionBtn
            label="删除"
            disabled={deleting}
            danger
            onClick={e => { e.stopPropagation(); onDelete(); }}
          />
        )}
        <span style={{ color: TOKENS.inkMuted, fontSize: 10 }}>{expanded ? '▴' : '▾'}</span>
      </div>
      {expanded && (
        <div style={{
          padding: '0 16px 16px',
          borderTop: `1px solid ${TOKENS.lineSoft}`,
        }}>
          {detailQ.isLoading && (
            <div style={{ padding: '16px 0', color: TOKENS.inkMuted, fontSize: TOKENS.fSm }}>
              加载详情…
            </div>
          )}
          {detailQ.data && (
            <>
              {/* applied 批次的应用摘要 */}
              {detailQ.data.status === 'applied' && (
                <ApplySummaryBlock summary={detailQ.data.applySummary} />
              )}

              {detailQ.data.parseErrors.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{
                    fontSize: TOKENS.fXs, fontWeight: 700, color: TOKENS.inkMuted,
                    marginBottom: 6, letterSpacing: 0.3,
                  }}>
                    无法生效的行(最多展示前 200 条)
                  </div>
                  <div style={{
                    maxHeight: 240,
                    overflowY: 'auto',
                    background: TOKENS.bg,
                    border: `1px solid ${TOKENS.lineSoft}`,
                    borderRadius: 6,
                    fontSize: TOKENS.fXs,
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: TOKENS.bgWarm }}>
                          <th style={errHeaderTd}>第几行</th>
                          <th style={errHeaderTd}>哪一列</th>
                          <th style={errHeaderTd}>问题</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailQ.data.parseErrors.map((e, i) => (
                          <tr key={i} style={{ borderTop: `1px solid ${TOKENS.lineSoft}` }}>
                            <td style={errCellTd}>{e.row}</td>
                            <td style={{ ...errCellTd, fontFamily: 'Menlo, monospace' }}>
                              {e.col ?? '—'}
                            </td>
                            <td style={{ ...errCellTd, color: TOKENS.danger }}>{e.msg}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detailQ.data.preview.length > 0 && (
                <PreviewTable rows={detailQ.data.preview} />
              )}

            </>
          )}
        </div>
      )}
    </div>
  );
}

function ApplySummaryBlock({ summary }: { summary: Record<string, unknown> }) {
  const inserted = typeof summary.inserted === 'number' ? summary.inserted : 0;
  const updated  = typeof summary.updated  === 'number' ? summary.updated  : 0;
  const skipped  = typeof summary.skipped  === 'number' ? summary.skipped  : 0;
  const skipReasons = Array.isArray(summary.skipReasons)
    ? summary.skipReasons as Array<{ row: number; reason: string }>
    : [];
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontSize: TOKENS.fXs, fontWeight: 700, color: TOKENS.inkMuted,
        marginBottom: 6, letterSpacing: 0.3,
      }}>
        生效结果
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <SummaryStat label="新增" value={inserted} color={TOKENS.success} />
        <SummaryStat label="更新" value={updated} color={TOKENS.info} />
        <SummaryStat label="跳过" value={skipped} color={skipped > 0 ? TOKENS.warn : TOKENS.inkMuted} />
      </div>
      {skipReasons.length > 0 && (
        <div style={{
          maxHeight: 200,
          overflowY: 'auto',
          background: TOKENS.bg,
          border: `1px solid ${TOKENS.lineSoft}`,
          borderRadius: 6,
          padding: '8px 12px',
          fontSize: TOKENS.fXs,
          color: TOKENS.inkSoft,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: TOKENS.inkMuted }}>
            跳过原因(共 {skipReasons.length} 条)
          </div>
          {skipReasons.map((r, i) => (
            <div key={i} style={{ padding: '2px 0' }}>
              <span style={{
                display: 'inline-block', width: 52,
                color: TOKENS.inkMuted, fontVariantNumeric: 'tabular-nums',
              }}>
                第 {r.row} 行
              </span>
              {r.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  const columns = Array.from(
    rows.reduce<Set<string>>((acc, row) => {
      Object.keys(row).forEach(k => acc.add(k));
      return acc;
    }, new Set<string>())
  );
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontSize: TOKENS.fXs, fontWeight: 700, color: TOKENS.inkMuted,
        marginBottom: 6, letterSpacing: 0.3,
      }}>
        数据预览(前 {rows.length} 行)
      </div>
      <div style={{
        maxHeight: 320, overflow: 'auto',
        background: TOKENS.bg,
        border: `1px solid ${TOKENS.lineSoft}`,
        borderRadius: 6,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: TOKENS.fXs }}>
          <thead style={{ position: 'sticky', top: 0, background: TOKENS.bgWarm }}>
            <tr>
              {columns.map(col => (
                <th key={col} style={{
                  padding: '6px 10px', textAlign: 'left', fontWeight: 700,
                  color: TOKENS.inkSoft, whiteSpace: 'nowrap',
                  borderBottom: `1px solid ${TOKENS.lineSoft}`,
                }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${TOKENS.lineSoft}` }}>
                {columns.map(col => {
                  const v = row[col];
                  const text = v === null || v === undefined || v === '' ? '—' : String(v);
                  return (
                    <td key={col} style={{
                      padding: '6px 10px', color: TOKENS.ink,
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: typeof v === 'number' ? 'tabular-nums' : undefined,
                    }}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      flex: 1,
      background: TOKENS.card,
      border: `1px solid ${TOKENS.lineSoft}`,
      borderRadius: 8,
      padding: '10px 14px',
    }}>
      <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted }}>{label}</div>
      <div style={{
        fontSize: TOKENS.fXl, fontWeight: 800, color,
        fontVariantNumeric: 'tabular-nums', marginTop: 2,
      }}>
        {value.toLocaleString()}
      </div>
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

function StatusPill({ status }: { status: UploadStatus }) {
  const styles: Record<UploadStatus, { bg: string; fg: string }> = {
    staged:      { bg: '#E0F2FE', fg: '#0369A1' },
    applied:     { bg: '#D1FAE5', fg: '#065F46' },
    failed:      { bg: '#FEE2E2', fg: '#991B1B' },
    rolled_back: { bg: '#F3F4F6', fg: '#374151' },
  };
  const s = styles[status];
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: 999,
      background: s.bg,
      color: s.fg,
      fontSize: TOKENS.fXs,
      fontWeight: 700,
      flexShrink: 0,
    }}>
      {STATUS_LABEL[status]}
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

function Th({ children, width }: { children: React.ReactNode; width?: number }) {
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
      padding: '10px 12px',
      verticalAlign: 'top',
      fontFamily: mono ? 'Menlo, Monaco, "Courier New", monospace' : 'inherit',
    }}>
      {children}
    </td>
  );
}

const errHeaderTd: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: TOKENS.inkSoft,
};
const errCellTd: React.CSSProperties = {
  padding: '6px 10px', verticalAlign: 'top', color: TOKENS.ink,
  fontVariantNumeric: 'tabular-nums',
};

function formatTime(iso: string): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
