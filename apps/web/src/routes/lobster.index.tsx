/**
 * 美宜佳龙虾 (/lobster) — 门店 AI 对话助手(实验)
 *
 * Claude App 风格的移动端聊天界面:
 *   - SSE 流式输出(打字机效果)
 *   - 工具调用过程以状态条形式展示("正在查询在售商品…")
 *   - 拍照上传(海报技能);生成的海报直接在气泡里展示
 *   - 空态给三个建议问题,一点即问
 *
 * 会话续聊:本页存活期间记住 conversationId;离开重进 = 新会话
 * (历史会话接口已就位,会话侧栏留待下一迭代)。
 */
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Send, X } from 'lucide-react';
import { IOSDevice } from '@/components/IOSDevice';
import { useMe, isAuthenticated } from '@/lib/auth';

export const Route = createFileRoute('/lobster/')({
  component: LobsterPage,
  head: () => ({
    meta: [
      { title: '美宜佳龙虾 · AI 店务助手' },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no',
      },
    ],
  }),
});

// ---- 渲染用的消息条目 -------------------------------------------------------

interface SkuCardsData {
  title: string;
  items: Array<{
    skuCode: string;
    name: string;
    spec: string | null;
    action: 'add' | 'remove' | 'keep' | 'watch';
    reason: string | null;
    retailPrice: number | null;
    salesQty30d: number | null;
    stockQty: number | null;
  }>;
}

type ChatItem =
  | { kind: 'user'; text: string; photoPreview?: string }
  | { kind: 'assistant'; text: string; streaming: boolean }
  | { kind: 'tool'; label: string; done: boolean }
  | { kind: 'poster'; url: string }
  | { kind: 'sku_cards'; data: SkuCardsData }
  | { kind: 'error'; text: string };

/** 剪贴板写入,带老 webview 降级 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const ACTION_STYLE: Record<
  SkuCardsData['items'][number]['action'],
  { label: string; cls: string }
> = {
  add: { label: '上新', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  remove: { label: '下架', cls: 'bg-red-50 border-red-200 text-red-600' },
  keep: { label: '保留', cls: 'bg-sky-50 border-sky-200 text-sky-700' },
  watch: { label: '观察', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
};

function SkuCardsBlock({ data }: { data: SkuCardsData }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, text: string) {
    if (await copyToClipboard(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  }

  const fullList = data.items
    .map((it) => `${it.skuCode}\t${it.name}${it.spec ? ` ${it.spec}` : ''}\t[${ACTION_STYLE[it.action].label}]`)
    .join('\n');

  return (
    <div className="max-w-[92%] w-full rounded-2xl border border-hairline bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-hairline">
        <div className="text-[13px] font-medium">📋 {data.title}</div>
        <button
          type="button"
          onClick={() => void copy('__all__', fullList)}
          className="text-[12px] px-2 py-1 rounded-lg border border-hairline bg-canvas active:scale-95 transition-transform"
        >
          {copied === '__all__' ? '✓ 已复制' : '复制清单'}
        </button>
      </div>
      {data.items.map((it) => {
        const a = ACTION_STYLE[it.action];
        const facts = [
          it.retailPrice !== null ? `${it.retailPrice.toFixed(2)}元` : null,
          it.salesQty30d !== null ? `近30天销${it.salesQty30d}` : null,
          it.stockQty !== null ? `库存${it.stockQty}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={it.skuCode} className="px-3 py-2 border-b border-hairline last:border-b-0">
            <div className="flex items-start gap-2">
              <span
                className={`shrink-0 mt-0.5 text-[11px] px-1.5 py-0.5 rounded-md border ${a.cls}`}
              >
                {a.label}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-snug">
                  {it.name}
                  {it.spec ? <span className="text-ink-muted"> {it.spec}</span> : null}
                </div>
                <div className="text-[11px] text-ink-muted mt-0.5">
                  {it.skuCode}
                  {facts ? ` · ${facts}` : ''}
                </div>
                {it.reason ? (
                  <div className="text-[12px] text-ink-muted mt-0.5">{it.reason}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void copy(it.skuCode, it.skuCode)}
                aria-label={`复制编码 ${it.skuCode}`}
                className="shrink-0 text-[12px] px-2 py-1 rounded-lg border border-hairline bg-canvas text-ink-muted active:scale-95 transition-transform"
              >
                {copied === it.skuCode ? '✓' : '复制'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SUGGESTIONS = [
  '我的货卖得怎么样?',
  '冷藏品怎么选?',
  '帮我做一张促销海报',
];

/** 上传前把照片重编码成 ≤1600px 的 JPEG(顺带兼容 iPhone HEIC) */
async function normalizePhoto(file: File): Promise<string> {
  const rawUrl: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('读取照片失败'));
    fr.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = rawUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    // 浏览器解不开(罕见格式)就原样上传,后端正则会兜底校验
    return rawUrl;
  }
}

function LobsterPage() {
  const navigate = useNavigate();
  const meQuery = useMe();
  const me = meQuery.data;

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (meQuery.isSuccess && !isAuthenticated(me)) void navigate({ to: '/login' });
  }, [meQuery.isSuccess, me, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput('');
    const photoToSend = photo;
    setPhoto(null);

    setItems((prev) => [
      ...prev,
      { kind: 'user', text: message, ...(photoToSend ? { photoPreview: photoToSend } : {}) },
      { kind: 'assistant', text: '', streaming: true },
    ]);

    const patchLast = (fn: (it: ChatItem) => ChatItem, kind?: ChatItem['kind']) => {
      setItems((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (!kind || next[i]!.kind === kind) {
            next[i] = fn(next[i]!);
            break;
          }
        }
        return next;
      });
    };

    try {
      const res = await fetch('/api/v1/lobster/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
          message,
          ...(photoToSend ? { photoDataUrl: photoToSend } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try {
          const err = (await res.json()) as { error?: { message?: string } };
          if (err?.error?.message) msg = err.error.message;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          let ev: {
            type: string;
            conversationId?: string;
            text?: string;
            label?: string;
            ok?: boolean;
            posterUrl?: string;
            message?: string;
            title?: string;
            items?: SkuCardsData['items'];
          };
          try {
            ev = JSON.parse(trimmed.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === 'start' && ev.conversationId) {
            conversationIdRef.current = ev.conversationId;
          } else if (ev.type === 'delta' && ev.text) {
            patchLast(
              (it) =>
                it.kind === 'assistant' ? { ...it, text: it.text + ev.text! } : it,
              'assistant',
            );
          } else if (ev.type === 'tool_start') {
            // 工具状态条插在流式气泡前面,保持气泡始终在最下
            setItems((prev) => {
              const next = [...prev];
              const bubble = next.pop()!;
              next.push({ kind: 'tool', label: ev.label ?? '查询中', done: false }, bubble);
              return next;
            });
          } else if (ev.type === 'tool_end') {
            patchLast((it) => (it.kind === 'tool' ? { ...it, done: true } : it), 'tool');
          } else if (ev.type === 'poster' && ev.posterUrl) {
            setItems((prev) => {
              const next = [...prev];
              const bubble = next.pop()!;
              next.push({ kind: 'poster', url: ev.posterUrl! }, bubble);
              return next;
            });
          } else if (ev.type === 'sku_cards' && ev.items?.length) {
            const data: SkuCardsData = { title: ev.title ?? '商品建议清单', items: ev.items };
            setItems((prev) => {
              const next = [...prev];
              const bubble = next.pop()!;
              next.push({ kind: 'sku_cards', data }, bubble);
              return next;
            });
          } else if (ev.type === 'error') {
            setItems((prev) => [
              ...prev,
              { kind: 'error', text: ev.message ?? '出错了,请重试' },
            ]);
          }
        }
      }
    } catch (err) {
      setItems((prev) => [
        ...prev,
        { kind: 'error', text: err instanceof Error ? err.message : '网络异常,请重试' },
      ]);
    } finally {
      patchLast(
        (it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it),
        'assistant',
      );
      setBusy(false);
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await normalizePhoto(file));
    } catch {
      setItems((prev) => [...prev, { kind: 'error', text: '照片读取失败,换一张试试' }]);
    }
  }

  if (meQuery.isLoading || !me?.user) {
    return (
      <IOSDevice>
        <div className="h-full flex items-center justify-center text-ink-muted text-sm">
          载入中…
        </div>
      </IOSDevice>
    );
  }

  return (
    <IOSDevice>
      <div className="h-full flex flex-col bg-canvas">
        {/* 顶部条 */}
        <header className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2.5 border-b border-hairline bg-surface">
          <Link to="/" className="p-1 -ml-1 text-ink-muted">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink leading-tight">
              美宜佳龙虾 <span aria-hidden>🦞</span>
            </div>
            <div className="text-[11px] text-ink-muted truncate">
              {me.currentStore ? me.currentStore.name : '未选择门店'} · AI 店务助手(实验)
            </div>
          </div>
        </header>

        {/* 消息区 */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {items.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              <div className="text-[44px]" aria-hidden>
                🦞
              </div>
              <div className="text-[15px] text-ink font-medium">
                我是龙虾,这家店的事都可以问我
              </div>
              <div className="flex flex-col gap-2 w-full px-4">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="w-full text-left px-4 py-3 rounded-2xl border border-hairline bg-surface text-[14px] text-ink active:scale-[0.98] transition-transform"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {items.map((it, i) => {
              if (it.kind === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div
                      className="max-w-[82%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[14.5px] leading-relaxed text-white whitespace-pre-wrap break-words"
                      style={{ background: 'var(--primary)' }}
                    >
                      {it.photoPreview && (
                        <img
                          src={it.photoPreview}
                          alt="已上传照片"
                          className="rounded-xl mb-2 max-h-40 w-auto"
                        />
                      )}
                      {it.text}
                    </div>
                  </div>
                );
              }
              if (it.kind === 'assistant') {
                if (!it.text && !it.streaming) return null;
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-2.5 bg-surface border border-hairline text-[14.5px] leading-relaxed text-ink whitespace-pre-wrap break-words">
                      {it.text || (
                        <span className="inline-flex gap-1 items-center text-ink-muted">
                          <Dot delay="0ms" />
                          <Dot delay="150ms" />
                          <Dot delay="300ms" />
                        </span>
                      )}
                      {it.streaming && it.text && (
                        <span
                          className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom animate-pulse rounded-sm"
                          style={{ background: 'var(--primary)' }}
                        />
                      )}
                    </div>
                  </div>
                );
              }
              if (it.kind === 'tool') {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-hairline text-[12px] text-ink-muted">
                      {it.done ? (
                        <span aria-hidden>✓</span>
                      ) : (
                        <span
                          className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                          style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                        />
                      )}
                      {it.done ? `已${it.label}` : `正在${it.label}…`}
                    </div>
                  </div>
                );
              }
              if (it.kind === 'poster') {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[88%]">
                      <img
                        src={it.url}
                        alt="生成的促销海报"
                        className="rounded-2xl border border-hairline w-full"
                      />
                      <div className="text-[11px] text-ink-muted mt-1 px-1">
                        长按图片可保存到相册
                      </div>
                    </div>
                  </div>
                );
              }
              if (it.kind === 'sku_cards') {
                return (
                  <div key={i} className="flex justify-start">
                    <SkuCardsBlock data={it.data} />
                  </div>
                );
              }
              return (
                <div key={i} className="flex justify-center">
                  <div className="px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
                    {it.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 待发送照片预览 */}
        {photo && (
          <div className="shrink-0 px-4 pb-1.5 flex">
            <div className="relative">
              <img src={photo} alt="待发送照片" className="h-16 rounded-xl border border-hairline" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label="移除照片"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-white flex items-center justify-center"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* 输入条 */}
        <footer className="shrink-0 px-3 pb-4 pt-2 border-t border-hairline bg-surface">
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-label="拍照上传"
              className="shrink-0 w-10 h-10 rounded-full border border-hairline bg-canvas flex items-center justify-center text-ink-muted active:scale-95 transition-transform disabled:opacity-40"
            >
              <Camera size={19} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPickPhoto(e)}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={busy ? '龙虾思考中…' : '问问店里的事…'}
              disabled={busy}
              className="flex-1 resize-none rounded-2xl border border-hairline bg-canvas px-3.5 py-2.5 text-[14.5px] text-ink placeholder:text-ink-muted focus:outline-none max-h-28 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={busy || !input.trim()}
              aria-label="发送"
              className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform disabled:opacity-40"
              style={{ background: 'var(--primary)' }}
            >
              <Send size={17} />
            </button>
          </div>
        </footer>
      </div>
    </IOSDevice>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}
