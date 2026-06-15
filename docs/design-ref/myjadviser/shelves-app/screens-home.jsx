// 首页（场景列表）/ 场景工作台 / 货架登记向导

// ---------------------------------------------------------------- 场景状态派生
function sceneStatus(sc) {
  if (sc.draft) return { tone: 'orange', label: '调改进行中' };
  if (!sc.config) return { tone: 'gray', label: '未登记货架' };
  if (sc.records.length > 0) return { tone: 'green', label: `已调改 ${sc.records.length} 次` };
  return { tone: 'gray', label: '未调改' };
}

// ---------------------------------------------------------------- 首页：场景列表
function HomeScreen({ app, nav }) {
  const draftScene = SCENES.find((s) => app.getScene(s.id).draft);

  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 红色渐变头部（与海报模块同款） */}
      <div style={{
        background: `linear-gradient(160deg, ${TOKENS.red}, ${TOKENS.redDark})`,
        color: '#fff', padding: 'calc(env(safe-area-inset-top, 0px) + 26px) 20px 24px',
        position: 'relative', overflow: 'hidden', flexShrink: 0,
      }}>
        <div style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }}></div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 1 }}>货盘选品助手</div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'rgba(255,255,255,0.92)' }}>
            <I.Store size={15} color="rgba(255,255,255,0.92)" />
            门店 {STORE.code} · {STORE.name}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 28px' }}>
        {/* 未完成调改 —— 最高优先级入口 */}
        {draftScene && (
          <Card onClick={() => nav.push({ name: 'flow', sceneId: draftScene.id, resume: true })} pad={14} style={{
            marginBottom: 16, border: `2px solid #ff8c1a`,
            display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 4px 14px rgba(255,140,26,0.18)',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 13, background: '#fff4e6', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>{draftScene.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink }}>
                继续「{draftScene.name}」的调改
              </div>
              <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 2 }}>
                {app.getScene(draftScene.id).draft.note}，点击继续
              </div>
            </div>
            <Chip tone="orange">继续</Chip>
          </Card>
        )}

        <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink }}>选择场景</div>
        <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2, marginBottom: 12 }}>
          每个场景对应一组货架，点进去即可查看与调改
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {SCENES.map((s) => {
            const sc = app.getScene(s.id);
            const st = sceneStatus(sc);
            return (
              <Card key={s.id} onClick={() => nav.push({ name: 'workspace', sceneId: s.id })} pad={13} style={{
                display: 'flex', flexDirection: 'column', gap: 8, minHeight: 108,
                border: sc.draft ? '2px solid #ff8c1a' : '2px solid transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 28, lineHeight: 1 }}>{s.emoji}</div>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: TOKENS.ink }}>{s.name}</div>
                  <div style={{
                    fontSize: 11, color: TOKENS.inkMuted, marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.categories.join('、')}</div>
                </div>
              </Card>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: 26 }}>
          <button onClick={() => { app.resetDemo(); nav.reset(); }} style={{
            appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
            fontSize: 11, color: TOKENS.inkMuted, textDecoration: 'underline', cursor: 'pointer',
          }}>重置演示数据</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 场景工作台（合并原 Hub + 状态 + 历史）
function WorkspaceScreen({ app, nav, sceneId }) {
  const scene = SCENES[sceneId];
  const sc = app.getScene(sceneId);
  const configured = !!sc.config;
  const lastDelta = sc.records.find((r) => r.salesDelta != null)?.salesDelta ?? null;
  useVirtualAutoReady(app, sceneId);

  // 拍照开始：首次还没聊过 → 先进「聊一聊」；聊过了直接进流程
  const startFlow = () => {
    if (!sc.qaDone) nav.push({ name: 'qa', sceneId });
    else nav.push({ name: 'flow', sceneId });
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar
        title={`${scene.emoji} ${scene.name}`}
        subtitle={`门店 ${STORE.code}`}
        onBack={() => nav.pop()}
        right={configured && (
          <button onClick={() => nav.push({ name: 'info', sceneId })} aria-label="基础信息修改" style={{
            appearance: 'none', border: 0, background: 'rgba(255,255,255,0.16)', cursor: 'pointer',
            width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <I.Gear size={19} color="#fff" />
          </button>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ---------- 首次进入：轻量引导，仅登记货架 ---------- */}
        {!configured && (
          <Card pad={18} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 10 }}>{scene.emoji}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink }}>先花 1 分钟登记货架</div>
            <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginTop: 6, lineHeight: 1.6 }}>
              告诉我们这个场景有几组什么样的货架，<br />AI 才能给出准确的选品调改建议。<br />只需登记一次。
            </div>
            <div style={{ marginTop: 16 }}>
              <PrimaryBtn onClick={() => nav.push({ name: 'setup', sceneId })} icon={<I.Shelf size={20} color="#fff" />}>
                登记货架
              </PrimaryBtn>
            </div>
          </Card>
        )}

        {!configured && (
          <Card pad={14}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, marginBottom: 10, letterSpacing: 1 }}>之后的流程</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { n: '1', t: '登记货架', d: '选类型和大小，只做一次' },
                { n: '2', t: '聊一聊', d: '回答几个问题，也只做一次' },
                { n: '3', t: '拍照调改', d: 'AI 诊断给方案，以后每次只需这步' },
              ].map((s2) => (
                <div key={s2.n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', background: TOKENS.redSoft, color: TOKENS.red,
                    fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>{s2.n}</div>
                  <div>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.ink }}>{s2.t}</span>
                    <span style={{ fontSize: 12, color: TOKENS.inkMuted, marginLeft: 8 }}>{s2.d}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ---------- 已配置：调改入口 ---------- */}
        {configured && sc.draft && (
          <Card pad={14} style={{ border: '2px solid #ff8c1a', boxShadow: '0 4px 14px rgba(255,140,26,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, background: '#fff4e6', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><I.Clock size={20} color="#cf7000" /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink }}>有一次未完成的调改</div>
                <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 2 }}>{sc.draft.note} · 进度已自动保存</div>
              </div>
            </div>
            <PrimaryBtn onClick={() => nav.push({ name: 'flow', sceneId, resume: true })} style={{ height: 48 }}>
              继续调改
            </PrimaryBtn>
            <button onClick={() => { app.patchScene(sceneId, { draft: null }); nav.push({ name: 'flow', sceneId }); }} style={{
              appearance: 'none', border: 0, background: 'transparent', width: '100%',
              marginTop: 8, fontSize: 12.5, color: TOKENS.inkMuted, cursor: 'pointer', fontFamily: 'inherit',
              padding: 6, textDecoration: 'underline',
            }}>不要了，重新拍照开始</button>
          </Card>
        )}

        {configured && !sc.draft && (
          <button onClick={startFlow} style={{
            appearance: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
            borderRadius: 20, padding: '22px 18px', position: 'relative', overflow: 'hidden',
            background: `linear-gradient(150deg, ${TOKENS.red}, ${TOKENS.redDark})`,
            color: '#fff', boxShadow: `0 10px 26px ${TOKENS.red}40`,
          }}>
            <div style={{ position: 'absolute', top: -50, right: -36, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.09)' }}></div>
            <div style={{ position: 'absolute', bottom: -64, left: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(0,0,0,0.08)' }}></div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 58, height: 58, borderRadius: 18, flexShrink: 0,
                background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><I.Camera size={30} color="#fff" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: 0.5 }}>拍照开始调改</div>
                <div style={{ fontSize: 12, opacity: 0.92, marginTop: 4, lineHeight: 1.5 }}>
                  {sc.qaDone ? '拍照 → AI 诊断 → 确认方案' : '先聊几句货架情况，再拍照诊断'}
                </div>
              </div>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              }}><I.ArrowR size={18} color={TOKENS.red} /></div>
            </div>
            <div style={{
              position: 'relative', marginTop: 16, paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.18)',
              fontSize: 11.5, opacity: 0.88, display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <I.Clock size={13} color="#fff" /> 全程约 3 分钟，进度自动保存，随时可退出
            </div>
          </button>
        )}

        {/* ---------- 场景数据一览 ---------- */}
        {configured && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: '已调改', value: String(sc.records.length), unit: '次' },
              { label: '上次效果', value: lastDelta != null ? `+${lastDelta}%` : '—', unit: lastDelta != null ? '销售额' : '', color: lastDelta != null ? TOKENS.green : TOKENS.inkMuted },
              { label: '登记货架', value: String(sc.config.length), unit: '组' },
            ].map((t) => (
              <div key={t.label} style={{
                background: '#fff', borderRadius: 14, padding: '12px 6px 11px', textAlign: 'center',
                boxShadow: TOKENS.shadow1,
              }}>
                <div style={{ fontSize: 10.5, color: TOKENS.inkMuted, fontWeight: 700 }}>{t.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.color || TOKENS.ink, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {t.value}
                  {t.unit && <span style={{ fontSize: 10.5, fontWeight: 600, color: TOKENS.inkMuted, marginLeft: 2 }}>{t.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---------- 上次调改快照（含清单与陈列示意图） ---------- */}
        {sc.lastSnapshot && (() => {
          const snapUp = sc.lastSnapshot.items.filter((i) => i.kind === 'push').length;
          const snapDown = sc.lastSnapshot.items.filter((i) => i.kind === 'remove').length;
          return (
            <Card pad={14} onClick={() => nav.push({ name: 'last', sceneId })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, background: TOKENS.greenSoft, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><I.Check size={20} color={TOKENS.green} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>上一次调改</div>
                  <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{fmtDate(sc.lastSnapshot.at)}</div>
                </div>
                <I.ChevronR size={16} color={TOKENS.inkMuted} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
                {snapUp > 0 && <Chip tone="green" style={{ fontSize: 11.5, padding: '4px 9px' }}>上架 {snapUp} 个品</Chip>}
                {snapDown > 0 && <Chip tone="red" style={{ fontSize: 11.5, padding: '4px 9px' }}>停止进货 {snapDown} 个品</Chip>}
                {sc.virtual === 'ready' && <Chip tone="gray" style={{ fontSize: 11.5, padding: '4px 9px' }}>含陈列示意图</Chip>}
                {sc.virtual === 'generating' && <Chip tone="amber" style={{ fontSize: 11.5, padding: '4px 9px' }}>陈列图生成中…</Chip>}
              </div>
            </Card>
          );
        })()}

        {/* ---------- 其他入口 ---------- */}
        {configured && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 }}>
            <ListRow
              icon={<I.History size={20} color={TOKENS.red} />}
              label="调改效果追踪"
              badge={lastDelta != null ? <Chip tone="green">上次 +{lastDelta}%</Chip> : null}
              hint={sc.records.length > 0 ? `${sc.records.length} 次调改 · 看销量变化` : '完成调改后这里会显示效果'}
              onClick={() => nav.push({ name: 'records', sceneId })}
            />
          </div>
        )}

        {/* ---------- 经营小提示 ---------- */}
        {configured && (
          <Card pad={13} style={{ background: TOKENS.bgWarm, boxShadow: 'none', marginTop: 2 }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 16, lineHeight: 1.3 }}>💡</span>
              <div style={{ fontSize: 12, color: TOKENS.inkSoft, lineHeight: 1.65 }}>
                建议每 4–6 周做一次调改；新品上架两周后，记得回来看「调改效果追踪」里的销量变化。
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 货架登记向导（轻量分步：类型 → 尺寸 → 大类 → 确认）
function SetupWizard({ app, nav, sceneId }) {
  const scene = SCENES[sceneId];
  const sc = app.getScene(sceneId);
  const [groups, setGroups] = React.useState(() => (sc.config ? [...sc.config] : []));
  const [step, setStep] = React.useState(0); // 0 类型 1 尺寸 2 确认
  const [cur, setCur] = React.useState({ shelf_type: null, shelf_width: 75, shelf_layers: 5 });

  const totalSteps = 2;
  const firstTime = !sc.config;

  const back = () => {
    if (step === 0 && groups.length === 0) { nav.pop(); return; }
    if (step === 0) { setStep(2); return; } // 回到确认页
    setStep(step - 1);
  };

  const finishGroup = () => {
    setGroups((gs) => [...gs, { ...cur, category: scene.categories[0] }]);
    setStep(2);
  };

  const addAnother = () => {
    setCur({ shelf_type: null, shelf_width: 75, shelf_layers: 5 });
    setStep(0);
  };

  const saveAll = () => {
    app.patchScene(sceneId, { config: groups });
    // 首次登记完 → 接「聊一聊」（只做一次）；已聊过则直接回去
    if (!sc.qaDone) nav.replace({ name: 'qa', sceneId });
    else nav.pop();
  };

  const stepTitle = [
    '这组货架是什么类型？',
    '货架有多宽、几层？',
    '确认货架信息',
  ][step];

  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar title="登记货架" subtitle={`${scene.emoji} ${scene.name}`} onBack={back} />

      {/* 进度点 */}
      {step < 2 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingTop: 16, flexShrink: 0 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={{
              width: i === step ? 22 : 8, height: 8, borderRadius: 4,
              background: i <= step ? TOKENS.red : '#e5dfd6', transition: 'all 0.25s',
            }}></div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 120px' }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: TOKENS.ink, marginBottom: 4 }}>{stepTitle}</div>
        {step < 2 && groups.length > 0 && (
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginBottom: 14 }}>正在登记第 {groups.length + 1} 组货架</div>
        )}
        {step < 2 && groups.length === 0 && (
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginBottom: 14 }}>不确定的话按默认选就行，之后随时能改</div>
        )}

        {/* 步骤 1：类型 */}
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SHELF_TYPES.map((t) => (
              <BigOption key={t.type} title={t.type} hint={t.hint}
                selected={cur.shelf_type === t.type}
                onClick={() => { setCur({ ...cur, shelf_type: t.type }); setTimeout(() => setStep(1), 220); }} />
            ))}
          </div>
        )}

        {/* 步骤 2：宽度 + 层数 */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card pad={16}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 12 }}>货架宽度</div>
              <div style={{ display: 'flex', gap: 10 }}>
                {WIDTH_PRESETS.map((w) => {
                  const sel = cur.shelf_width === w;
                  return (
                    <button key={w} onClick={() => setCur({ ...cur, shelf_width: w })} style={{
                      appearance: 'none', flex: 1, height: 58, borderRadius: 14, fontFamily: 'inherit',
                      border: sel ? `2px solid ${TOKENS.red}` : `1.5px solid ${TOKENS.line}`,
                      background: sel ? TOKENS.redSoft : '#fff',
                      color: sel ? TOKENS.red : TOKENS.inkSoft,
                      fontSize: 17, fontWeight: 800, cursor: 'pointer',
                    }}>{w}<span style={{ fontSize: 11, fontWeight: 600 }}>cm</span></button>
                  );
                })}
              </div>
            </Card>
            <Card pad={16}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 12 }}>货架层数</div>
              <NumStepper value={cur.shelf_layers} onChange={(v) => setCur({ ...cur, shelf_layers: v })} min={2} max={8} unit="层" />
            </Card>
          </div>
        )}

        {/* 步骤 3：确认页 */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {groups.map((g, i) => (
              <Card key={i} pad={14} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, background: TOKENS.redSoft, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><I.Shelf size={20} color={TOKENS.red} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink }}>第 {i + 1} 组 · {g.shelf_type}</div>
                  <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 2 }}>{g.shelf_width}cm · {g.shelf_layers}层</div>
                </div>
                <button onClick={() => setGroups((gs) => gs.filter((_, idx) => idx !== i))} aria-label="删除该组" style={{
                  appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer', padding: 6,
                }}><I.Trash size={18} color={TOKENS.inkMuted} /></button>
              </Card>
            ))}
            <GhostBtn onClick={addAnother} icon={<I.Plus size={18} color={TOKENS.red} />} style={{ marginTop: 4 }}>
              再添加一组货架
            </GhostBtn>
            {firstTime && (
              <div style={{ fontSize: 12, color: TOKENS.inkMuted, textAlign: 'center', lineHeight: 1.6 }}>
                保存后再花 1 分钟聊聊这个货架的情况，就全部准备好了
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作 */}
      {(step === 1 || step === 2) && (
        <BottomBar>
          {step === 1 && <PrimaryBtn onClick={finishGroup}>完成这组货架</PrimaryBtn>}
          {step === 2 && <PrimaryBtn disabled={groups.length === 0} onClick={saveAll} icon={<I.Check size={20} color="#fff" />}>
            {firstTime ? `保存，去聊一聊（共 ${groups.length} 组）` : `保存（共 ${groups.length} 组货架）`}
          </PrimaryBtn>}
        </BottomBar>
      )}
    </div>
  );
}

Object.assign(window, { HomeScreen, WorkspaceScreen, SetupWizard, sceneStatus });
