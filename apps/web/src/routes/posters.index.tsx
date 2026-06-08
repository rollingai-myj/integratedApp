/**
 * 活动海报 (/posters)
 *
 * M5-PR1：
 *   - Tab 1 生成：模板 + 模式 + 文案 → POST /posters/generate（同步）
 *   - Tab 2 推荐：当前生效促销按个人品类偏好排序，点卡片预填表单
 *   - Tab 3 历史：我的海报历史（PO-F2）
 *
 * 注：批量入队（PO-D 系列）和促销批次后台（PO-E 系列）放到 M5-PR2 再做。
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import { IOSDevice } from '@/components/IOSDevice';
import {
  useGeneratePoster,
  usePosters,
  useRecommendedPromotions,
} from '@/lib/hooks';
import { ApiError } from '@/lib/api-client';
import type {
  PosterMode,
  PosterRecord,
  PosterTemplate,
  ProductPromotion,
} from '@myj/shared';

export const Route = createFileRoute('/posters/')({
  component: PostersPage,
});

type TabKey = 'generate' | 'recommend' | 'history';

const TEMPLATES: Array<{ key: PosterTemplate; label: string; desc: string }> = [
  { key: 'vibrant', label: '活力', desc: '亮色大字号' },
  { key: 'premium', label: '高端', desc: '深色留白' },
  { key: 'minimal', label: '极简', desc: '白底单色' },
  { key: 'custom', label: '自定义', desc: '描述风格' },
];

const MODES: Array<{ key: PosterMode; label: string; desc: string }> = [
  { key: 'photo_compose', label: '拍照合成', desc: '原图作背景' },
  { key: 'official_bg_only', label: '官方图', desc: '商品包装' },
  { key: 'multi_product', label: '多商品', desc: '系列排版' },
];

function PostersPage() {
  const [tab, setTab] = useState<TabKey>('generate');
  const [prefill, setPrefill] = useState<{
    copyText?: string;
    skuCode?: string;
    categoryName?: string;
    productImageUrl?: string;
  } | null>(null);

  const onUseRecommendation = (p: ProductPromotion) => {
    setPrefill({
      copyText: p.displayText ?? `${p.productName} ${p.bestLabel ?? ''}`.trim(),
      skuCode: p.skuCode,
      categoryName: p.categoryName ?? undefined,
    });
    setTab('generate');
  };

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2 border-b border-hairline">
          <Link
            to="/"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
            aria-label="返回首页"
          >
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="text-[16px] font-semibold text-ink tracking-wide">活动海报</div>
        </header>

        {/* Tabs */}
        <div className="px-[22px] pt-3 flex gap-2">
          {(['generate', 'recommend', 'history'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 h-9 rounded-xl text-[13px] font-semibold transition-colors ${
                tab === t
                  ? 'bg-primary text-white'
                  : 'bg-surface border border-hairline text-ink-muted'
              }`}
            >
              {t === 'generate' ? '生成' : t === 'recommend' ? '推荐' : '历史'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'generate' && (
            <GenerateTab prefill={prefill} onConsumePrefill={() => setPrefill(null)} />
          )}
          {tab === 'recommend' && <RecommendTab onUse={onUseRecommendation} />}
          {tab === 'history' && <HistoryTab />}
        </div>
      </div>
    </IOSDevice>
  );
}

// ---- 生成 Tab ----------------------------------------------------------

function GenerateTab({
  prefill,
  onConsumePrefill,
}: {
  prefill: { copyText?: string; skuCode?: string; categoryName?: string; productImageUrl?: string } | null;
  onConsumePrefill: () => void;
}) {
  const generate = useGeneratePoster();

  const [template, setTemplate] = useState<PosterTemplate>('vibrant');
  const [mode, setMode] = useState<PosterMode>('official_bg_only');
  const [copyText, setCopyText] = useState(prefill?.copyText ?? '');
  const [skuCode, setSkuCode] = useState(prefill?.skuCode ?? '');
  const [categoryName, setCategoryName] = useState(prefill?.categoryName ?? '');
  const [productImageUrl, setProductImageUrl] = useState(prefill?.productImageUrl ?? '');
  const [sourcePhotoUrl, setSourcePhotoUrl] = useState('');
  const [customStyle, setCustomStyle] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [result, setResult] = useState<PosterRecord | null>(null);

  // 用过的预填只用一次
  const consumed = useState(false);
  if (prefill && !consumed[0]) {
    consumed[1](true);
    onConsumePrefill();
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    setResult(null);
    if (!copyText.trim()) {
      setErrMsg('请填写海报文案');
      return;
    }
    generate.mutate(
      {
        template,
        mode,
        copyText: copyText.trim(),
        skuCode: skuCode.trim() || undefined,
        categoryName: categoryName.trim() || undefined,
        productImageUrl: productImageUrl.trim() || undefined,
        sourcePhotoUrl: sourcePhotoUrl.trim() || undefined,
        customStyleDescription:
          template === 'custom' ? customStyle.trim() || undefined : undefined,
      },
      {
        onSuccess: (data) => setResult(data.poster),
        onError: (err) => {
          if (err instanceof ApiError) setErrMsg(err.message);
          else setErrMsg('生成失败，请重试');
        },
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="px-[22px] py-4 flex flex-col gap-4">
      {/* 模板 */}
      <Section title="模板风格">
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <ChipButton
              key={t.key}
              active={template === t.key}
              label={t.label}
              desc={t.desc}
              onClick={() => setTemplate(t.key)}
            />
          ))}
        </div>
      </Section>

      {/* 模式 */}
      <Section title="生成模式">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <ChipButton
              key={m.key}
              active={mode === m.key}
              label={m.label}
              desc={m.desc}
              onClick={() => setMode(m.key)}
            />
          ))}
        </div>
      </Section>

      {/* 文案 */}
      <Section title="海报文案">
        <textarea
          value={copyText}
          onChange={(e) => setCopyText(e.target.value)}
          placeholder="例：买一送一，限时三天"
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-surface border border-hairline text-[14px] focus:outline-none focus:border-primary resize-none"
        />
      </Section>

      {/* 可选字段 */}
      <Section title="商品信息（可选）">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={skuCode}
            onChange={(e) => setSkuCode(e.target.value)}
            placeholder="SKU 编号"
            className="h-10 px-3 rounded-xl bg-surface border border-hairline text-[13px] focus:outline-none focus:border-primary"
          />
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="品类"
            className="h-10 px-3 rounded-xl bg-surface border border-hairline text-[13px] focus:outline-none focus:border-primary"
          />
        </div>
      </Section>

      {mode === 'official_bg_only' && (
        <Section title="商品官方图 URL">
          <input
            value={productImageUrl}
            onChange={(e) => setProductImageUrl(e.target.value)}
            placeholder="https://…"
            className="w-full h-10 px-3 rounded-xl bg-surface border border-hairline text-[13px] focus:outline-none focus:border-primary"
          />
        </Section>
      )}
      {mode === 'photo_compose' && (
        <Section title="门店实拍 URL">
          <input
            value={sourcePhotoUrl}
            onChange={(e) => setSourcePhotoUrl(e.target.value)}
            placeholder="https://…"
            className="w-full h-10 px-3 rounded-xl bg-surface border border-hairline text-[13px] focus:outline-none focus:border-primary"
          />
        </Section>
      )}
      {template === 'custom' && (
        <Section title="风格描述">
          <textarea
            value={customStyle}
            onChange={(e) => setCustomStyle(e.target.value)}
            placeholder="描述你希望的视觉风格"
            rows={2}
            className="w-full px-3 py-2 rounded-xl bg-surface border border-hairline text-[14px] focus:outline-none focus:border-primary resize-none"
          />
        </Section>
      )}

      {errMsg && (
        <div className="text-[12.5px] text-rose-600 px-1">{errMsg}</div>
      )}

      <button
        type="submit"
        disabled={generate.isPending}
        className="h-11 rounded-xl bg-primary text-white font-semibold text-[14px] active:opacity-80 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {generate.isPending ? (
          <>
            <Loader2 size={16} className="animate-spin" /> AI 生成中（约 10-30 秒）
          </>
        ) : (
          <>
            <Sparkles size={16} /> 生成海报
          </>
        )}
      </button>

      {result && (
        <div className="mt-2 p-3 rounded-2xl bg-surface border border-hairline">
          <div className="text-[12.5px] font-semibold text-ink mb-2">生成完成</div>
          <img
            src={result.posterImageUrl}
            alt="生成的海报"
            className="w-full rounded-xl"
          />
          <div className="text-[11px] text-ink-muted mt-2 leading-snug">
            {result.aiModel} · {result.generationMs ? `${(result.generationMs / 1000).toFixed(1)}s` : ''}
          </div>
        </div>
      )}
    </form>
  );
}

// ---- 推荐 Tab ----------------------------------------------------------

function RecommendTab({ onUse }: { onUse: (p: ProductPromotion) => void }) {
  const q = useRecommendedPromotions();

  if (q.isLoading) {
    return <div className="py-12 text-center text-sm text-ink-muted">载入推荐…</div>;
  }
  if (q.isError) {
    return (
      <div className="py-12 text-center text-sm text-rose-600">
        {(q.error as Error)?.message ?? '载入失败'}
      </div>
    );
  }
  const data = q.data;
  if (!data?.upload || data.products.length === 0) {
    return (
      <div className="py-12 px-8 text-center text-sm text-ink-muted leading-relaxed">
        当前没有生效的促销批次
        <br />
        （超管在后台上传 Excel 后生效）
      </div>
    );
  }

  return (
    <div className="px-[22px] py-3 flex flex-col gap-2.5">
      <div className="text-[11.5px] text-ink-muted px-1">
        {data.upload.fileName} · {data.products.length} 个促销品（按你的偏好排序）
      </div>
      {data.products.slice(0, 50).map((p) => (
        <button
          key={p.id}
          onClick={() => onUse(p)}
          className="text-left bg-surface border border-hairline rounded-2xl p-3.5 active:scale-[0.98] transition-transform"
        >
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary-soft flex items-center justify-center shrink-0 text-[16px] font-semibold text-primary">
              {p.productName.slice(0, 1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-ink truncate">
                {p.productName}
              </div>
              <div className="text-[11px] text-ink-muted mt-0.5 truncate">
                {[p.skuCode, p.categoryName, p.unit].filter(Boolean).join(' · ')}
              </div>
              {p.bestLabel && (
                <div className="mt-1.5 inline-block text-[11px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold">
                  {p.bestLabel}
                </div>
              )}
              <div className="flex items-baseline gap-2 mt-1.5">
                {p.bestTotalPrice != null && (
                  <span className="text-[15px] font-semibold text-ink">
                    ¥{Number(p.bestTotalPrice).toFixed(2)}
                  </span>
                )}
                {p.originalPrice != null && p.originalPrice !== p.bestTotalPrice && (
                  <span className="text-[11px] text-ink-muted line-through">
                    ¥{Number(p.originalPrice).toFixed(2)}
                  </span>
                )}
                {p.bestSavingPercent != null && (
                  <span className="ml-auto text-[11px] text-emerald-600 font-semibold">
                    省 {Number(p.bestSavingPercent).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ---- 历史 Tab ----------------------------------------------------------

function HistoryTab() {
  const q = usePosters({ scope: 'mine', limit: 100 });
  const [enlarged, setEnlarged] = useState<PosterRecord | null>(null);

  if (q.isLoading) {
    return <div className="py-12 text-center text-sm text-ink-muted">载入历史…</div>;
  }
  if (q.isError) {
    return (
      <div className="py-12 text-center text-sm text-rose-600">
        {(q.error as Error)?.message ?? '载入失败'}
      </div>
    );
  }
  const posters = q.data?.posters ?? [];
  if (posters.length === 0) {
    return (
      <div className="py-12 px-8 text-center text-sm text-ink-muted">
        还没有生成过海报
      </div>
    );
  }

  return (
    <>
      <div className="px-[22px] py-3 grid grid-cols-2 gap-2.5">
        {posters.map((p) => (
          <button
            key={p.id}
            onClick={() => setEnlarged(p)}
            className="aspect-[3/4] rounded-xl overflow-hidden bg-surface border border-hairline active:scale-[0.97] transition-transform"
          >
            <img
              src={p.posterImageUrl}
              alt={p.copyText}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
      {enlarged && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setEnlarged(null)}
          >
            <img
              src={enlarged.posterImageUrl}
              alt={enlarged.copyText}
              className="max-w-full max-h-full rounded-xl"
            />
          </div>
        </>
      )}
    </>
  );
}

// ---- 小组件 -----------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-ink-muted mb-2 tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function ChipButton({
  active,
  label,
  desc,
  onClick,
}: {
  active: boolean;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[58px] rounded-xl border text-left px-3 py-2 transition-colors ${
        active
          ? 'bg-primary/10 border-primary text-primary'
          : 'bg-surface border-hairline text-ink'
      }`}
    >
      <div className="text-[13px] font-semibold leading-tight">{label}</div>
      <div className="text-[10.5px] text-ink-muted mt-0.5 leading-tight">{desc}</div>
    </button>
  );
}
