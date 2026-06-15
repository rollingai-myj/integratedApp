// 次要页面 —— 调改效果追踪 / 上次调改详情 / 虚拟货架示意图 / 基础信息

// ---------------------------------------------------------------- 调改效果追踪
function RecordsScreen({ app, nav, sceneId }) {
  const scene = SCENES[sceneId];
  const sc = app.getScene(sceneId);
  const [openId, setOpenId] = React.useState(sc.records[0]?.id ?? null);
  const [detailName, setDetailName] = React.useState(null);

  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar title="调改效果追踪" subtitle={`${scene.emoji} ${scene.name}`} onBack={() => nav.pop()} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sc.records.length === 0 ? (
          <div style={{
            border: `1.5px dashed ${TOKENS.line}`, borderRadius: 14,
            padding: '40px 16px', textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13, lineHeight: 1.7,
          }}>
            还没有调改记录。<br />完成第一次调改后，这里会显示每次调改和之后的销量变化。
          </div>
        ) : sc.records.map((rec) => {
          const open = openId === rec.id;
          const up = rec.items.filter((i) => i.kind === 'push');
          const down = rec.items.filter((i) => i.kind === 'remove');
          return (
            <Card key={rec.id} pad={0} style={{ overflow: 'hidden' }}>
              <button onClick={() => setOpenId(open ? null : rec.id)} style={{
                appearance: 'none', border: 0, background: 'transparent', width: '100%', textAlign: 'left',
                padding: 14, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>{rec.summary}</div>
                  <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 3 }}>{fmtDate(rec.at)}</div>
                </div>
                {rec.salesDelta != null ? (
                  <Chip tone="green" style={{ fontSize: 11.5 }}>
                    <I.TrendUp size={13} color={TOKENS.green} /> 销售额 +{rec.salesDelta}%
                  </Chip>
                ) : (
                  <Chip tone="gray">数据积累中</Chip>
                )}
                <I.ChevronD size={16} color={TOKENS.inkMuted} style={{}} />
              </button>
              {open && (
                <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${TOKENS.lineSoft}` }}>
                  {rec.salesDelta != null && (
                    <div style={{ fontSize: 12, color: TOKENS.inkSoft, padding: '11px 0 2px', lineHeight: 1.6 }}>
                      调改后 30 日，该货架销售额较调改前增长 <span style={{ color: TOKENS.green, fontWeight: 800 }}>+{rec.salesDelta}%</span>
                    </div>
                  )}
                  {[
                    { title: '上架', list: up, color: TOKENS.green },
                    { title: '停止进货', list: down, color: TOKENS.red },
                  ].map((g) => g.list.length > 0 && (
                    <div key={g.title} style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: g.color, marginBottom: 7 }}>{g.title}（{g.list.length}）</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {g.list.map((it, i) => (
                          <ProductRow key={i} name={it.skuName} spec={it.spec}
                            right={<span style={{ fontSize: 11.5, color: TOKENS.inkMuted, flexShrink: 0 }}>{it.action}</span>}
                            onOpen={() => setDetailName(it.skuName)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {detailName && <ProductDetailSheet name={detailName} onClose={() => setDetailName(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 上次调改详情
function LastRecordScreen({ app, nav, sceneId }) {
  const scene = SCENES[sceneId];
  const sc = app.getScene(sceneId);
  const snap = sc.lastSnapshot;
  const [detailName, setDetailName] = React.useState(null);
  if (!snap) return null;
  const up = snap.items.filter((i) => i.kind === 'push');
  const down = snap.items.filter((i) => i.kind === 'remove');
  const diagSections = [
    { key: 'paragraph_customer', label: '客群分析' },
    { key: 'paragraph_competition', label: '竞争分析' },
    { key: 'paragraph_status', label: '货架现状' },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar title="上一次调改" subtitle={`${scene.emoji} ${scene.name} · ${fmtDate(snap.at)}`} onBack={() => nav.pop()} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card pad={14} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, background: TOKENS.greenSoft, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><I.Check size={20} color={TOKENS.green} /></div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: TOKENS.ink }}>{snap.summary}</div>
            <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{fmtDate(snap.at)} 应用</div>
          </div>
        </Card>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>当时的货架照片</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {Array.from({ length: snap.photoCount || 1 }).map((_, i) => (
              <PhotoPh key={i} seed={i} label={`货架照片 ${i + 1}`} h={110} style={{ flex: 1 }} />
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>当时的诊断结论</div>
          <Card pad={0} style={{ overflow: 'hidden' }}>
            {diagSections.map((s, i) => (
              <div key={s.key} style={{ padding: '12px 14px', borderTop: i > 0 ? `1px solid ${TOKENS.lineSoft}` : 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.red, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 12.5, color: TOKENS.ink, lineHeight: 1.7 }}>{snap.diagnosis[s.key]}</div>
              </div>
            ))}
          </Card>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>应用的调改清单</div>
          <Card pad={14}>
            {[
              { title: '上架', list: up, color: TOKENS.green },
              { title: '停止进货', list: down, color: TOKENS.red },
            ].map((g, gi) => g.list.length > 0 && (
              <div key={g.title} style={{ marginTop: gi > 0 ? 12 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: g.color, marginBottom: 7 }}>{g.title}（{g.list.length}）</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.list.map((it, i) => (
                    <ProductRow key={i} name={it.skuName} spec={it.spec}
                      right={<span style={{ fontSize: 11.5, color: TOKENS.inkMuted, flexShrink: 0 }}>{it.action}</span>}
                      onOpen={() => setDetailName(it.skuName)} />
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>调改后的陈列示意图</div>
          <VirtualShelfBlock app={app} sceneId={sceneId} />
        </div>
      </div>
      {detailName && <ProductDetailSheet name={detailName} onClose={() => setDetailName(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 虚拟货架区块（嵌在调改清单页里，不再单独入口）
const NEW_SEGS = new Set(['每日黑巧', '0糖薄荷软糖', '生椰拿铁软糖', '芒果味软糖']);

function VirtualShelfBlock({ app, sceneId }) {
  const sc = app.getScene(sceneId);

  // 模拟生成：6 秒后就绪
  React.useEffect(() => {
    if (sc.virtual !== 'generating') return;
    const elapsed = Date.now() - (sc.virtualStartedAt || Date.now());
    const remain = Math.max(600, 6000 - elapsed);
    const t = setTimeout(() => app.patchScene(sceneId, { virtual: 'ready' }), remain);
    return () => clearTimeout(t);
  }, [sc.virtual]);

  const generate = () => app.patchScene(sceneId, { virtual: 'generating', virtualStartedAt: Date.now() });

  if (sc.virtual === 'none') {
    return (
      <Card pad={16} style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 6 }}>🗄️</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.ink, lineHeight: 1.6 }}>
          还没有陈列示意图
        </div>
        <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 4, lineHeight: 1.6 }}>
          AI 会按上面的清单画出每层货架建议怎么摆
        </div>
        <div style={{ marginTop: 14 }}>
          <PrimaryBtn onClick={generate} icon={<I.Sparkles size={20} color="#fff" />} style={{ height: 48 }}>一键生成</PrimaryBtn>
        </div>
      </Card>
    );
  }

  if (sc.virtual === 'generating') {
    return (
      <Card pad={18} style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><Spin size={30} /></div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink, marginTop: 12 }}>正在生成陈列示意图…</div>
        <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 5, lineHeight: 1.6 }}>
          通常不到 1 分钟，生成好会直接显示在这里
        </div>
        <div style={{ marginTop: 14, height: 6, borderRadius: 3, background: TOKENS.bgWarm, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '40%', borderRadius: 3, background: TOKENS.red, animation: 'shv-progress 1.6s ease-in-out infinite' }}></div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card pad={14}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <I.Shelf size={17} color={TOKENS.red} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color: TOKENS.ink }}>{VIRTUAL_SHELF.groupLabel}</span>
        </div>
        <div style={{ fontSize: 11.5, color: TOKENS.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
          照这样整理货架即可，<span style={{ color: TOKENS.red, fontWeight: 700 }}>带「新」标的</span>是这次新上架的商品。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {VIRTUAL_SHELF.layers.map((layer) => (
            <div key={layer.label}>
              <div style={{ fontSize: 10.5, color: TOKENS.inkMuted, fontWeight: 700, marginBottom: 4 }}>{layer.label}</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {layer.segments.map((seg) => (
                  <div key={seg.name} style={{
                    flexBasis: `${seg.w}%`, minWidth: 0, height: 44, borderRadius: 7,
                    background: seg.color, position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: '#fff', textAlign: 'center', lineHeight: 1.25,
                      textShadow: '0 1px 2px rgba(0,0,0,0.35)', overflow: 'hidden',
                    }}>{seg.name}</span>
                    {NEW_SEGS.has(seg.name) && (
                      <span style={{
                        position: 'absolute', top: -5, right: -3,
                        background: TOKENS.yellow, color: TOKENS.ink,
                        fontSize: 9, fontWeight: 800, padding: '1.5px 5px', borderRadius: 7,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}>新</span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ height: 4, borderRadius: 2, background: '#d9d2c6', marginTop: 3 }}></div>
            </div>
          ))}
        </div>
      </Card>
      <GhostBtn onClick={generate} icon={<I.Sparkles size={18} color={TOKENS.red} />} style={{ height: 44, fontSize: 14 }}>重新生成</GhostBtn>
    </div>
  );
}

// ---------------------------------------------------------------- 基础信息（货架 + 周边环境）
function InfoScreen({ app, nav, sceneId, toast }) {
  const scene = SCENES[sceneId];
  const sc = app.getScene(sceneId);
  const [crowd, setCrowd] = React.useState(sc.env?.crowd ?? '');
  const [competitor, setCompetitor] = React.useState(sc.env?.competitor ?? '');

  const taStyle = {
    width: '100%', boxSizing: 'border-box', minHeight: 74, resize: 'vertical',
    border: `1.5px solid ${TOKENS.line}`, borderRadius: 12, padding: '10px 12px',
    fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6, color: TOKENS.ink,
    background: '#fff', outline: 'none',
  };

  const saveEnv = () => {
    app.patchScene(sceneId, { env: { crowd, competitor } });
    toast('周边环境信息已保存');
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar title="基础信息" subtitle={`${scene.emoji} ${scene.name}`} onBack={() => nav.pop()} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        <Card pad={14}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink }}>已登记的货架</span>
            <button onClick={() => nav.push({ name: 'setup', sceneId })} style={{
              appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
              fontSize: 12.5, color: TOKENS.red, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2,
            }}>重新登记 <I.ChevronR size={13} color={TOKENS.red} /></button>
          </div>
          {(sc.config ?? []).map((g, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
              borderTop: i > 0 ? `1px solid ${TOKENS.lineSoft}` : 'none',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, background: TOKENS.redSoft, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><I.Shelf size={17} color={TOKENS.red} /></div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.ink }}>{g.shelf_type}</div>
                <div style={{ fontSize: 11.5, color: TOKENS.inkMuted }}>{g.shelf_width}cm · {g.shelf_layers}层</div>
              </div>
            </div>
          ))}
        </Card>

        <Card pad={14}>
          <div style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink, marginBottom: 4 }}>周边环境</div>
          <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginBottom: 12, lineHeight: 1.5 }}>
            写一写门店周边的客人和竞争对手，AI 诊断会参考这些信息（选填）
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 6 }}>主要客群</div>
          <textarea value={crowd} onChange={(e) => setCrowd(e.target.value)} style={taStyle}
            placeholder="例如：写字楼上班族为主，下午和晚上人多"></textarea>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TOKENS.inkSoft, margin: '12px 0 6px' }}>周边竞争</div>
          <textarea value={competitor} onChange={(e) => setCompetitor(e.target.value)} style={taStyle}
            placeholder="例如：隔壁有一家零食量贩店，散糖卖得便宜"></textarea>
          <div style={{ marginTop: 14 }}>
            <PrimaryBtn onClick={saveEnv} style={{ height: 46, fontSize: 15 }}>保存</PrimaryBtn>
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { RecordsScreen, LastRecordScreen, VirtualShelfBlock, InfoScreen });
