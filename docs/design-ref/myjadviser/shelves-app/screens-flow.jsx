// 调改流程 —— 问答 → 拍照 → AI 诊断 → 逐条确认 → 清单应用
// 单页分阶段，顶部 FlowSteps 始终可见；中途退出自动存草稿

// 照片上的问题单品红框（演示用固定位置）
const DEMO_BOXES = [
  { left: '8%', top: '58%', width: '17%', height: '24%' },
  { left: '37%', top: '60%', width: '15%', height: '22%' },
  { left: '63%', top: '14%', width: '18%', height: '26%' },
  { left: '78%', top: '62%', width: '16%', height: '23%' },
];

const KIND_META = {
  remove:  { label: '建议：停止进货', short: '停止进货', color: TOKENS.red,   bg: TOKENS.redSoft,  emoji: '📦' },
  observe: { label: '建议：保留观察', short: '保留观察', color: TOKENS.amber, bg: TOKENS.amberSoft, emoji: '👀' },
  push:    { label: '建议：上架新品', short: '上架', color: TOKENS.green, bg: TOKENS.greenSoft, emoji: '✨' },
};

function FlowScreen({ app, nav, sceneId, resume }) {
  const scene = SCENES[sceneId];
  const sc = app.getScene(sceneId);
  const draft = resume ? sc.draft : null;

  const [stage, setStage] = React.useState(() => {
    if (draft && draft.stage === 'review') return 'review';
    return 'photo';
  });
  const [photos, setPhotos] = React.useState(() => (draft ? draft.photoCount || 0 : 0));
  const [doneStages, setDoneStages] = React.useState(() => (draft && draft.stage === 'review' ? DIAG_STAGES.length : 0));
  // 逐条确认状态
  const [reviewIndex, setReviewIndex] = React.useState(() => (draft && draft.stage === 'review' ? draft.reviewIndex || 0 : 0));
  const [decisions, setDecisions] = React.useState(() => (draft && draft.decisions ? [...draft.decisions] : []));
  const [skipReasons, setSkipReasons] = React.useState(() => (draft && draft.skipReasons ? [...draft.skipReasons] : []));
  const [showSales, setShowSales] = React.useState(false);
  const timers = React.useRef([]);

  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const saveDraft = (patch) => app.patchScene(sceneId, { draft: { photoCount: photos, ...patch } });

  // ---------- 拍照 ----------
  const takePhoto = () => {
    if (photos >= 3) return;
    const n = photos + 1;
    setPhotos(n);
    app.patchScene(sceneId, { draft: { stage: 'photo', photoCount: n, note: `已拍 ${n} 张照片` } });
  };

  // ---------- 开始诊断：逐项推进 ----------
  const startDiagnosis = () => {
    setStage('diagnosing');
    setDoneStages(0);
    let acc = 0;
    DIAG_STAGES.forEach((st, i) => {
      acc += st.dur;
      timers.current.push(setTimeout(() => {
        setDoneStages(i + 1);
        if (i === DIAG_STAGES.length - 1) {
          timers.current.push(setTimeout(() => {
            setStage('diag');
            saveDraft({ stage: 'review', reviewIndex: 0, decisions: [], note: '诊断完成，方案待确认' });
          }, 600));
        }
      }, acc));
    });
  };

  // ---------- 逐条确认 ----------
  const skus = STRATEGY.skus;
  const decide = (choice, reason = null) => {
    const next = [...decisions];
    next[reviewIndex] = choice;
    setDecisions(next);
    const nextReasons = [...skipReasons];
    nextReasons[reviewIndex] = choice === 'skip' ? reason : null;
    setSkipReasons(nextReasons);
    if (reviewIndex + 1 < skus.length) {
      setReviewIndex(reviewIndex + 1);
      saveDraft({ stage: 'review', reviewIndex: reviewIndex + 1, decisions: next, skipReasons: nextReasons, note: '方案确认到一半' });
    } else {
      setStage('confirm');
      saveDraft({ stage: 'review', reviewIndex: skus.length - 1, decisions: next, skipReasons: nextReasons, note: '方案已确认完，待应用' });
    }
  };
  const undoLast = () => {
    if (reviewIndex === 0) return;
    setReviewIndex(reviewIndex - 1);
  };
  const restoreSku = (idx) => {
    const next = [...decisions];
    next[idx] = 'accept';
    setDecisions(next);
  };

  const accepted = skus.filter((_, i) => decisions[i] === 'accept');
  const skippedIdx = skus.map((_, i) => i).filter((i) => decisions[i] === 'skip');
  const counts = {
    remove: accepted.filter((s) => s.kind === 'remove').length,
    observe: accepted.filter((s) => s.kind === 'observe').length,
    push: accepted.filter((s) => s.kind === 'push').length,
  };

  // ---------- 应用方案 ----------
  const applyPlan = () => {
    const now = new Date().toISOString();
    const summary = `上架了${counts.push}个品，停止进货了${counts.remove}个品`;
    const items = accepted.map((s) => ({ skuName: s.skuName, spec: s.spec, action: s.action, kind: s.kind }));
    const rec = { id: Date.now(), at: now, summary, salesDelta: null, items };
    app.patchScene(sceneId, {
      draft: null,
      records: [rec, ...sc.records],
      lastSnapshot: { at: now, summary, photoCount: photos || 1, diagnosis: DIAGNOSIS, items },
      virtual: 'generating', virtualStartedAt: Date.now(),
    });
    setStage('applied');
  };

  const onBack = () => {
    if (stage === 'applied') { nav.popTo('workspace'); return; }
    nav.pop();
  };

  const stepIndex = { photo: 0, diagnosing: 1, diag: 2, review: 2, confirm: 2, applied: 2 }[stage];

  // ============================================================ 渲染
  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar
        title={`${scene.name} · 选品调改`}
        subtitle={stage === 'applied' ? null : '进度会自动保存，可随时退出'}
        onBack={onBack}
      />
      {stage !== 'applied' && (
        <FlowSteps current={stepIndex} />
      )}

      {/* ================= 第 1 步：拍照 ================= */}
      {stage === 'photo' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 120px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13.5, color: TOKENS.inkSoft, lineHeight: 1.6 }}>
            请拍下「{scene.name}」货架现在的样子，拍清楚商品即可，可以拍多张。
          </div>

          {photos === 0 ? (
            <button onClick={takePhoto} style={{
              appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
              border: `2px dashed ${TOKENS.red}55`, borderRadius: 18, background: '#fff',
              padding: '38px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 20,
                background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 8px 20px ${TOKENS.red}40`,
              }}><I.Camera size={32} color="#fff" /></div>
              <div style={{ fontSize: 16, fontWeight: 800, color: TOKENS.ink }}>点这里拍货架</div>
              <div style={{ fontSize: 12, color: TOKENS.inkMuted }}>也可以从相册选择</div>
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: photos }).map((_, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <PhotoPh seed={i} label={`货架照片 ${i + 1}`} h={i === 0 ? 200 : 120} />
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10.5, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 8,
                  }}>已上传</div>
                </div>
              ))}
              {photos < 3 && (
                <button onClick={takePhoto} style={{
                  appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
                  border: `1.5px dashed ${TOKENS.line}`, borderRadius: 14, background: '#fff',
                  padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontSize: 14, fontWeight: 700, color: TOKENS.red,
                }}>
                  <I.Plus size={18} color={TOKENS.red} /> 再拍一张（{photos}/3）
                </button>
              )}
            </div>
          )}

          <Card pad={13} style={{ background: TOKENS.amberSoft, boxShadow: 'none' }}>
            <div style={{ display: 'flex', gap: 9 }}>
              <I.Alert size={17} color={TOKENS.amber} />
              <div style={{ fontSize: 12, color: TOKENS.amber, lineHeight: 1.6 }}>
                拍照小提示：正对货架、光线充足、商品标签朝外，AI 识别会更准。
              </div>
            </div>
          </Card>
        </div>
      )}
      {stage === 'photo' && (
        <BottomBar>
          <PrimaryBtn disabled={photos === 0} onClick={startDiagnosis} icon={photos > 0 ? <I.Sparkles size={20} color="#fff" /> : null}>
            {photos === 0 ? '请先拍一张货架照片' : '开始 AI 诊断'}
          </PrimaryBtn>
        </BottomBar>
      )}

      {/* ================= 第 3 步：诊断中 ================= */}
      {stage === 'diagnosing' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ position: 'relative' }}>
            <PhotoPh seed={0} label="货架照片 1" h={200} />
            {doneStages >= 1 && DEMO_BOXES.map((b, i) => (
              <div key={i} style={{
                position: 'absolute', ...b,
                border: `2px solid ${TOKENS.red}`, borderRadius: 4,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.6) inset',
                animation: 'shv-fadein 0.4s ease',
              }} onAnimationEnd={clearAnim}></div>
            ))}
            {doneStages < 1 && (
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 14, pointerEvents: 'none' }}>
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: '34%',
                  background: `linear-gradient(180deg, transparent, ${TOKENS.red}33, transparent)`,
                  animation: 'shv-scan 2s linear infinite',
                }}></div>
              </div>
            )}
          </div>
          {doneStages >= 1 && (
            <div style={{ fontSize: 12, color: TOKENS.inkSoft, textAlign: 'center', marginTop: -6 }}>
              红框是 AI 找到的问题单品
            </div>
          )}

          <Card pad={16}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {DIAG_STAGES.map((st, i) => {
                const isDone = i < doneStages;
                const isRunning = i === doneStages;
                return (
                  <div key={st.key} style={{ display: 'flex', alignItems: 'center', gap: 11, opacity: isDone || isRunning ? 1 : 0.4 }}>
                    {isDone ? (
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', background: TOKENS.green, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}><I.Check size={13} color="#fff" /></div>
                    ) : isRunning ? (
                      <Spin size={22} />
                    ) : (
                      <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${TOKENS.line}`, flexShrink: 0 }}></div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: isRunning ? 800 : 600, color: isRunning ? TOKENS.ink : TOKENS.inkSoft }}>
                      {st.label}{isRunning && '…'}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card pad={14} onClick={() => setShowSales(true)} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, background: TOKENS.redSoft, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><I.TrendUp size={20} color={TOKENS.red} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>等的时候先看看销售数据</div>
              <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>这 30 天货架上每个商品卖得怎么样</div>
            </div>
            <I.ChevronR size={16} color={TOKENS.inkMuted} />
          </Card>
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, textAlign: 'center' }}>
            大约需要 10 秒，请稍候
          </div>
        </div>
      )}

      {/* ================= 第 3 步 A：诊断结论（照片在上，结论在下） ================= */}
      {stage === 'diag' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 130px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <PhotoPh seed={0} label="货架照片 1" h={190} />
            {DEMO_BOXES.map((b, i) => (
              <div key={i} style={{
                position: 'absolute', ...b,
                border: `2px solid ${TOKENS.red}`, borderRadius: 4,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.6) inset',
              }}></div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: TOKENS.inkSoft, textAlign: 'center', marginTop: -4 }}>
            <span style={{ color: TOKENS.red, fontWeight: 700 }}>红框</span>是 AI 找到的问题单品，诊断结论在下面
          </div>
          {[
            { key: 'paragraph_customer', label: '客群分析', icon: '👥', color: '#1d63b8', bg: '#e8f1fb' },
            { key: 'paragraph_competition', label: '竞争分析', icon: '⚔️', color: '#9a6700', bg: '#fdf3df' },
            { key: 'paragraph_status', label: '货架现状', icon: '📊', color: TOKENS.green, bg: TOKENS.greenSoft },
          ].map((s) => (
            <Card key={s.key} pad={14}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 9, background: s.bg, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{s.icon}</div>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: s.color }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 13, color: TOKENS.ink, lineHeight: 1.75 }}>{DIAGNOSIS[s.key]}</div>
            </Card>
          ))}
          <button onClick={() => setShowSales(true)} style={{
            appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
            fontSize: 13, color: TOKENS.red, fontWeight: 700, padding: '6px 0',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            查看这 30 天的销售数据 <I.ChevronR size={14} color={TOKENS.red} />
          </button>
        </div>
      )}
      {stage === 'diag' && (
        <BottomBar>
          <PrimaryBtn onClick={() => setStage('review')} icon={<I.ArrowR size={20} color="#fff" />}>
            开始过方案（共 {skus.length} 条）
          </PrimaryBtn>
        </BottomBar>
      )}

      {/* ================= 第 4 步 B：逐条确认 ================= */}
      {stage === 'review' && (
        <ReviewDeck
          skus={skus}
          index={reviewIndex}
          onDecide={decide}
          onUndo={undoLast}
          onShowSales={() => setShowSales(true)}
        />
      )}

      {/* ================= 第 4 步 C：清单确认 ================= */}
      {stage === 'confirm' && (
        <ConfirmList
          accepted={accepted}
          skippedIdx={skippedIdx}
          skipReasons={skipReasons}
          skus={skus}
          counts={counts}
          onRestore={restoreSku}
          onRecheck={() => { setReviewIndex(0); setStage('review'); }}
          onApply={applyPlan}
        />
      )}

      {/* ================= 完成 ================= */}
      {stage === 'applied' && (
        <AppliedPanel app={app} nav={nav} sceneId={sceneId} counts={counts} />
      )}

      {/* 销售数据底部抽屉 */}
      {showSales && <SalesSheet onClose={() => setShowSales(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 逐条确认卡片
function ReviewDeck({ skus, index, onDecide, onUndo, onShowSales }) {
  const s = skus[index];
  const meta = KIND_META[s.kind];
  const sales = SKUS.find((x) => x.skuCode === s.skuCode);
  const [skipAsk, setSkipAsk] = React.useState(false);
  const [showDetail, setShowDetail] = React.useState(false);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '8px 16px 0' }}>
      {/* 进度 */}
      <div style={{ flexShrink: 0, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <button onClick={onUndo} disabled={index === 0} style={{
            appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 700, color: index === 0 ? '#d0c9bf' : TOKENS.inkSoft,
            cursor: index === 0 ? 'default' : 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <I.Back size={13} color={index === 0 ? '#d0c9bf' : TOKENS.inkSoft} /> 上一条
          </button>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
            第 <span style={{ color: TOKENS.red, fontSize: 15 }}>{index + 1}</span> / {skus.length} 条
          </div>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: '#eee9e1', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3, background: TOKENS.red,
            width: `${((index) / skus.length) * 100}%`, transition: 'width 0.3s ease',
          }}></div>
        </div>
      </div>

      {/* 卡片 */}
      <div key={s.skuCode} onAnimationEnd={clearAnim} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', animation: 'shv-card-in 0.28s ease' }}>
        <Card pad={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* 建议头 */}
          <div style={{
            background: meta.bg, padding: '13px 16px',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 19 }}>{meta.emoji}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: meta.color }}>{meta.label}</span>
            <span style={{ marginLeft: 'auto' }}><Chip tone={s.kind === 'remove' ? 'red' : s.kind === 'push' ? 'green' : 'amber'}>{s.tag}</Chip></span>
          </div>

          <div style={{ padding: '16px 16px 14px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {/* 商品图 + 名称（点开看大图和条码） */}
            <button onClick={() => setShowDetail(true)} style={{
              appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
              padding: 0, textAlign: 'left', cursor: 'pointer',
              display: 'flex', gap: 13, alignItems: 'center', width: '100%',
            }}>
              <div style={{
                width: 76, height: 76, borderRadius: 16, flexShrink: 0,
                background: `repeating-linear-gradient(135deg, #efe9df 0 8px, #f6f2ec 8px 16px)`,
                border: `1px solid ${TOKENS.line}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 10, color: TOKENS.inkMuted, background: 'rgba(255,255,255,0.85)',
                  padding: '2px 7px', borderRadius: 6, letterSpacing: 1,
                }}>商品图</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.3 }}>{s.skuName}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: TOKENS.inkMuted, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.spec}{sales ? ` · 货架在售` : ''}
                  <span style={{ fontSize: 11.5, color: TOKENS.red, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    详情 <I.ChevronR size={12} color={TOKENS.red} />
                  </span>
                </div>
              </div>
            </button>

            {/* 在售商品：销售小数据 */}
            {sales ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                {[
                  { k: '30日销量', v: `${sales.salesVolume30d} 件` },
                  { k: '销售额', v: fmtMoney(sales.sales30d) },
                  { k: '环比', v: `${sales.salesChange30d >= 0 ? '+' : ''}${sales.salesChange30d.toFixed(1)}%`, c: sales.salesChange30d >= 0 ? TOKENS.green : TOKENS.red },
                ].map((d) => (
                  <div key={d.k} style={{ flex: 1, background: TOKENS.bg, borderRadius: 12, padding: '11px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10.5, color: TOKENS.inkMuted, fontWeight: 700 }}>{d.k}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: d.c || TOKENS.ink, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{d.v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                marginTop: 14, background: TOKENS.greenSoft, borderRadius: 12, padding: '11px 13px',
                fontSize: 12.5, fontWeight: 700, color: TOKENS.green, display: 'flex', alignItems: 'center', gap: 7,
              }}>
                <I.Sparkles size={16} color={TOKENS.green} /> 新品 · 当前货架上没有，需要订货
              </div>
            )}

            {/* 理由：填满剩余空间 */}
            <div style={{
              flex: 1, marginTop: 14, background: TOKENS.bg, borderRadius: 14, padding: '13px 14px',
              display: 'flex', flexDirection: 'column', gap: 6, minHeight: 86,
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: meta.color, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                <I.Sparkles size={14} color={meta.color} /> AI 为什么这么建议
              </div>
              <div style={{ fontSize: 14.5, color: TOKENS.ink, lineHeight: 1.8 }}>{s.reason}</div>
            </div>
          </div>

          {/* 卡片底部：查数据入口 */}
          <button onClick={onShowSales} style={{
            appearance: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
            background: 'transparent', borderTop: `1px solid ${TOKENS.lineSoft}`,
            padding: '11px 16px', fontSize: 12.5, fontWeight: 700, color: TOKENS.inkSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            查看整个货架的销售数据 <I.ChevronR size={13} color={TOKENS.inkSoft} />
          </button>
        </Card>
      </div>

      {/* 两个大按钮：照做 / 跳过 */}
      <div style={{
        flexShrink: 0, display: 'flex', gap: 10,
        padding: '12px 0 calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}>
        <button onClick={() => setSkipAsk(true)} style={{
          appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
          flex: 1, height: 54, borderRadius: 27, background: '#fff',
          border: `1.5px solid ${TOKENS.line}`, color: TOKENS.inkSoft,
          fontSize: 16, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <I.Close size={18} color={TOKENS.inkSoft} /> 这条跳过
        </button>
        <button onClick={() => onDecide('accept')} style={{
          appearance: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer',
          flex: 1.4, height: 54, borderRadius: 27,
          background: TOKENS.red, color: '#fff',
          fontSize: 17, fontWeight: 700, letterSpacing: 1,
          boxShadow: `0 8px 24px ${TOKENS.red}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          <I.Check size={20} color="#fff" /> 应用
        </button>
      </div>

      {/* 商品详情 */}
      {showDetail && <ProductDetailSheet name={s.skuName} onClose={() => setShowDetail(false)} />}

      {/* 跳过原因弹窗 */}
      {skipAsk && (
        <SkipReasonSheet
          kind={s.kind}
          skuName={s.skuName}
          onCancel={() => setSkipAsk(false)}
          onConfirm={(reason) => { setSkipAsk(false); onDecide('skip', reason); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 跳过原因弹窗
const SKIP_REASONS = {
  remove:  ['其实卖得还可以', '有老顾客常买', '还有库存要卖完', '想再观察一阵子'],
  observe: ['其实卖得还可以', '有老顾客常买', '这个品我想直接下架', '不想调整陈列'],
  push:    ['进不到这个货', '不看好这个品', '货架实在放不下', '想先少上几个试试'],
};

function SkipReasonSheet({ kind, skuName, onCancel, onConfirm }) {
  const presets = SKIP_REASONS[kind] || SKIP_REASONS.remove;
  const [picked, setPicked] = React.useState(null);
  const [text, setText] = React.useState('');
  const reason = text.trim() || picked;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 300 }}>
      <div onClick={onCancel} onAnimationEnd={clearAnim} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', animation: 'shv-fadein 0.2s ease' }}></div>
      <div onAnimationEnd={clearAnim} style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: TOKENS.bg, borderRadius: '20px 20px 0 0',
        padding: '18px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
        animation: 'shv-sheet-up 0.28s ease',
        display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '82%', overflowY: 'auto',
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink }}>为什么跳过这条？</div>
          <div style={{ fontSize: 12.5, color: TOKENS.inkSoft, marginTop: 4, lineHeight: 1.55 }}>
            告诉我原因，下次给「{skuName}」这类商品的建议会更准。
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
          {presets.map((r) => {
            const sel = picked === r && !text.trim();
            return (
              <button key={r} onClick={() => { setPicked(sel ? null : r); setText(''); }} style={{
                appearance: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                padding: '13px 15px', borderRadius: 14, fontSize: 14.5, fontWeight: 700,
                border: sel ? `2px solid ${TOKENS.red}` : '2px solid transparent',
                background: sel ? TOKENS.redSoft : '#fff',
                color: sel ? TOKENS.red : TOKENS.ink,
                boxShadow: sel ? 'none' : TOKENS.shadow1,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                transition: 'all 0.12s',
              }}>
                {r}
                {sel && <I.Check size={17} color={TOKENS.red} />}
              </button>
            );
          })}
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) setPicked(null); }}
            placeholder="或者自己写原因…"
            rows={2}
            style={{
              boxSizing: 'border-box', width: '100%', resize: 'none',
              border: text.trim() ? `2px solid ${TOKENS.red}` : `1.5px solid ${TOKENS.line}`,
              borderRadius: 14, padding: '12px 14px',
              fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55, color: TOKENS.ink,
              background: '#fff', outline: 'none',
            }}
          ></textarea>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onCancel} style={{
            appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
            flex: 1, height: 50, borderRadius: 25, background: '#fff',
            border: `1.5px solid ${TOKENS.line}`, color: TOKENS.inkSoft, fontSize: 15.5, fontWeight: 700,
          }}>不跳了</button>
          <button onClick={() => reason && onConfirm(reason)} disabled={!reason} style={{
            appearance: 'none', border: 0, fontFamily: 'inherit',
            flex: 1.4, height: 50, borderRadius: 25,
            background: reason ? TOKENS.red : '#ddd6cc', color: '#fff',
            fontSize: 16, fontWeight: 700, letterSpacing: 1,
            cursor: reason ? 'pointer' : 'not-allowed',
            boxShadow: reason ? `0 8px 24px ${TOKENS.red}40` : 'none',
            transition: 'background 0.15s',
          }}>{reason ? '确认跳过' : '请先选个原因'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 清单确认（核心产物：选品调改列表）
function ConfirmList({ accepted, skippedIdx, skipReasons, skus, counts, onRestore, onRecheck, onApply }) {
  const groups = [
    { kind: 'remove', label: '停止进货', color: TOKENS.red, bg: TOKENS.redSoft },
    { kind: 'observe', label: '保留观察', color: TOKENS.amber, bg: TOKENS.amberSoft },
    { kind: 'push', label: '上架新品', color: TOKENS.green, bg: TOKENS.greenSoft },
  ];
  const [showSkipped, setShowSkipped] = React.useState(false);
  const [detailName, setDetailName] = React.useState(null);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 130px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ textAlign: 'center', padding: '4px 0 2px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TOKENS.ink }}>都过完了，确认一下清单</div>
          <div style={{ fontSize: 12.5, color: TOKENS.inkSoft, marginTop: 4 }}>
            确认没问题就点最下面的红色按钮应用
          </div>
        </div>

        {/* 数字摘要 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {groups.map((g) => (
            <div key={g.kind} style={{ background: g.bg, borderRadius: 12, padding: '10px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: g.color }}>{counts[g.kind]}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: g.color, marginTop: 1 }}>{g.label}</div>
            </div>
          ))}
        </div>

        {/* 分组清单 */}
        {groups.map((g) => {
          const items = accepted.filter((s) => s.kind === g.kind);
          if (items.length === 0) return null;
          return (
            <Card key={g.kind} pad={14}>
              <div style={{ fontSize: 13, fontWeight: 800, color: g.color, marginBottom: 8 }}>{g.label}（{items.length}）</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {items.map((s) => (
                  <ProductRow
                    key={s.skuCode}
                    name={s.skuName}
                    spec={s.spec}
                    right={<Chip tone={g.kind === 'remove' ? 'red' : g.kind === 'push' ? 'green' : 'amber'} style={{ flexShrink: 0 }}>{s.tag}</Chip>}
                    onOpen={() => setDetailName(s.skuName)}
                  />
                ))}
              </div>
            </Card>
          );
        })}

        {/* 跳过的 */}
        {skippedIdx.length > 0 && (
          <Card pad={14} style={{ background: '#f4f1ea', boxShadow: 'none' }}>
            <button onClick={() => setShowSkipped(!showSkipped)} style={{
              appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
              width: '100%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 13, fontWeight: 700, color: TOKENS.inkSoft,
            }}>
              <span>跳过了 {skippedIdx.length} 条（不会处理）</span>
              <I.ChevronD size={15} color={TOKENS.inkMuted} />
            </button>
            {showSkipped && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {skippedIdx.map((i) => (
                  <div key={skus[i].skuCode} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ProductRow
                        name={skus[i].skuName}
                        spec={KIND_META[skus[i].kind].short}
                        dim
                        onOpen={() => setDetailName(skus[i].skuName)}
                      />
                      {skipReasons[i] && (
                        <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 3, paddingLeft: 43 }}>原因：{skipReasons[i]}</div>
                      )}
                    </div>
                    <button onClick={() => onRestore(i)} style={{
                      appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
                      fontSize: 12.5, fontWeight: 700, color: TOKENS.red, padding: '7px 4px', flexShrink: 0,
                    }}>恢复</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <button onClick={onRecheck} style={{
          appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
          fontSize: 12.5, color: TOKENS.inkMuted, fontWeight: 600, textDecoration: 'underline', padding: '2px 0',
        }}>重新逐条看一遍</button>
      </div>

      <BottomBar>
        <PrimaryBtn
          disabled={accepted.length === 0}
          onClick={onApply}
          icon={accepted.length > 0 ? <I.Check size={20} color="#fff" /> : null}
        >
          {accepted.length === 0 ? '清单是空的，恢复几条再应用' : `应用调改（共 ${accepted.length} 条）`}
        </PrimaryBtn>
      </BottomBar>

      {detailName && <ProductDetailSheet name={detailName} onClose={() => setDetailName(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 销售数据底部抽屉
function SalesSheet({ onClose }) {
  const problem = new Set(PROBLEM_SKUS);
  const [detailName, setDetailName] = React.useState(null);
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 300 }}>
      <div onClick={onClose} onAnimationEnd={clearAnim} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', animation: 'shv-fadein 0.2s ease' }}></div>
      <div onAnimationEnd={clearAnim} style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '78%',
        background: TOKENS.bg, borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'shv-sheet-up 0.28s ease',
      }}>
        <div style={{ flexShrink: 0, padding: '12px 16px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${TOKENS.lineSoft}`, background: '#fff' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink, flex: 1 }}>近 30 日销售数据</div>
          <button onClick={onClose} aria-label="关闭" style={{
            appearance: 'none', border: 0, background: '#f0ede8', cursor: 'pointer',
            width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><I.Close size={16} color={TOKENS.inkSoft} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
          <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, margin: '0 2px 8px' }}>
            按销售额排序 · <span style={{ color: TOKENS.red }}>红点</span>为问题单品
          </div>
          <Card pad={0} style={{ overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 50px 62px 56px', gap: 6,
              padding: '10px 12px', background: TOKENS.bgWarm,
              fontSize: 11, fontWeight: 800, color: TOKENS.inkMuted,
            }}>
              <div>商品</div>
              <div style={{ textAlign: 'right' }}>销量</div>
              <div style={{ textAlign: 'right' }}>销售额</div>
              <div style={{ textAlign: 'right' }}>环比</div>
            </div>
            {SKUS.map((s, i) => (
              <button key={s.skuCode} onClick={() => setDetailName(s.skuName)} style={{
                appearance: 'none', border: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
                width: '100%', background: 'transparent',
                display: 'grid', gridTemplateColumns: '1fr 50px 62px 56px', gap: 6,
                padding: '9px 12px', alignItems: 'center',
                borderTop: i > 0 ? `1px solid ${TOKENS.lineSoft}` : 'none',
              }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProductThumb size={32} radius={9} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: TOKENS.ink, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {problem.has(s.skuCode) && <span style={{ width: 7, height: 7, borderRadius: '50%', background: TOKENS.red, flexShrink: 0 }}></span>}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.skuName}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: TOKENS.inkMuted }}>{s.spec}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: TOKENS.ink }}>{s.salesVolume30d}</div>
                <div style={{ textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: TOKENS.ink }}>{fmtMoney(s.sales30d)}</div>
                <div style={{
                  textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                  color: s.salesChange30d >= 0 ? TOKENS.green : TOKENS.red,
                }}>{s.salesChange30d >= 0 ? '+' : ''}{s.salesChange30d.toFixed(1)}%</div>
              </button>
            ))}
          </Card>
        </div>
      </div>
      {detailName && <ProductDetailSheet name={detailName} onClose={() => setDetailName(null)} zIndex={400} />}
    </div>
  );
}

// ---------------------------------------------------------------- 完成面板
function AppliedPanel({ app, nav, sceneId, counts }) {
  useVirtualAutoReady(app, sceneId);
  const sc = app.getScene(sceneId);
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 20px 40px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
      <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
        <div style={{
          width: 74, height: 74, borderRadius: '50%', background: TOKENS.greenSoft, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'shv-pop 0.45s cubic-bezier(0.2, 1.4, 0.5, 1)',
        }} onAnimationEnd={clearAnim}>
          <I.Check size={38} color={TOKENS.green} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: TOKENS.ink, marginTop: 14 }}>调改已完成</div>
        <div style={{ fontSize: 13.5, color: TOKENS.inkSoft, marginTop: 6 }}>
          上架了 {counts.push} 个品，停止进货了 {counts.remove} 个品
        </div>
      </div>

      {/* 陈列图自动开始生成，不用手动点 */}
      <Card pad={14} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {sc.virtual === 'ready' ? (
          <div style={{
            width: 40, height: 40, borderRadius: 12, background: TOKENS.greenSoft, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><I.Check size={20} color={TOKENS.green} /></div>
        ) : <Spin size={26} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>
            {sc.virtual === 'ready' ? '陈列示意图已生成好' : '正在帮你生成陈列示意图…'}
          </div>
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 2, lineHeight: 1.5 }}>
            {sc.virtual === 'ready' ? '看看调改后货架应该怎么摆' : '不用等在这里，过一会回来看就行'}
          </div>
        </div>
      </Card>

      <ListRow
        icon={<I.Doc size={20} color={TOKENS.red} />}
        label="查看调改清单和陈列示意图"
        hint="刚应用的清单 + 货架怎么摆"
        onClick={() => nav.push({ name: 'last', sceneId })}
      />

      <Card pad={13} style={{ background: TOKENS.amberSoft, boxShadow: 'none' }}>
        <div style={{ fontSize: 12.5, color: TOKENS.amber, lineHeight: 1.65 }}>
          接下来记得：按清单调整货架，下架的商品停止订货，新品到货后摆上货架。
          <span style={{ fontWeight: 800 }}>过两周再回来</span>，工作台的「调改效果追踪」里就能看到销量变化了。
        </div>
      </Card>

      <GhostBtn onClick={() => nav.popTo('workspace')} style={{ marginTop: 8 }}>
        返回「{SCENES[sceneId].name}」工作台
      </GhostBtn>
    </div>
  );
}

Object.assign(window, { FlowScreen });
