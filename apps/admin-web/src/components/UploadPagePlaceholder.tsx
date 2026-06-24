/**
 * 数据上传页统一占位 — PR 4 接真实上传 + 模板下载 + 批次列表 + 错误清单
 *
 * 现在只是把页面骨架立起来,把字段清单和说明先展示出来,UI 接近最终成品。
 */
import { TOKENS } from '@/tokens';

export function UploadPagePlaceholder({
  title,
  description,
  templateFields,
}: {
  title: string;
  description: string;
  templateFields: string[];
}) {
  return (
    <div style={{ maxWidth: 920 }}>
      <h1 style={{
        fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px',
      }}>
        {title}
      </h1>
      <div style={{
        fontSize: TOKENS.fSm, color: TOKENS.inkMuted, marginBottom: 24, maxWidth: 720,
      }}>
        {description}
      </div>

      {/* 说明卡 + 模板下载 */}
      <div style={{
        background: TOKENS.card,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: TOKENS.r5,
        padding: '20px 24px',
        boxShadow: TOKENS.shadow1,
        marginBottom: 16,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 24, marginBottom: 16,
        }}>
          <div>
            <div style={{
              fontSize: TOKENS.fBase, fontWeight: 700, color: TOKENS.ink, marginBottom: 4,
            }}>
              CSV 模板字段
            </div>
            <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted }}>
              第 1 行为表头,按此顺序填写
            </div>
          </div>
          <button
            disabled
            title="下个 PR 上线"
            style={{
              appearance: 'none',
              border: 0,
              background: TOKENS.inkDisabled,
              color: '#fff',
              padding: '10px 18px',
              borderRadius: 10,
              fontSize: TOKENS.fBase,
              fontWeight: 600,
              cursor: 'not-allowed',
              flexShrink: 0,
            }}
          >
            📄 下载 CSV 模板
          </button>
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8,
        }}>
          {templateFields.map(f => (
            <code key={f} style={{
              fontSize: TOKENS.fXs,
              padding: '4px 10px',
              borderRadius: 6,
              background: TOKENS.bgWarm,
              color: TOKENS.inkSoft,
              border: `1px solid ${TOKENS.line}`,
              fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            }}>
              {f}
            </code>
          ))}
        </div>
      </div>

      {/* 上传区占位 */}
      <div style={{
        background: TOKENS.card,
        border: `2px dashed ${TOKENS.line}`,
        borderRadius: TOKENS.r5,
        padding: '60px 24px',
        textAlign: 'center',
        color: TOKENS.inkMuted,
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>↓</div>
        <div style={{ fontSize: TOKENS.fBase, color: TOKENS.inkSoft, marginBottom: 4 }}>
          拖拽 CSV 文件到此 或 点击选择
        </div>
        <div style={{ fontSize: TOKENS.fXs }}>下个 PR 上线</div>
      </div>

      {/* 历史批次占位 */}
      <div style={{
        background: TOKENS.card,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: TOKENS.r5,
        padding: '20px 24px',
        boxShadow: TOKENS.shadow1,
        color: TOKENS.inkMuted,
        fontSize: TOKENS.fSm,
      }}>
        <div style={{
          fontSize: TOKENS.fBase, fontWeight: 700, color: TOKENS.ink, marginBottom: 8,
        }}>
          历史批次
        </div>
        暂无,首次上传后会出现在这里。
      </div>
    </div>
  );
}
