// 商品展示 —— 任何商品列表都必须带图，可点开看详情（大图 + 条码）
// 销售数据来自后台，详情可直接查

// 小缩略图占位
function ProductThumb({ size = 36, radius = 10 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: 'repeating-linear-gradient(135deg, #efe9df 0 6px, #f6f2ec 6px 12px)',
      border: `1px solid ${TOKENS.line}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 8.5, color: TOKENS.inkMuted, letterSpacing: 0.5,
      }}>图</span>
    </div>
  );
}

// 查找商品资料（在售数据 / 方案数据 / 兜底生成编码）
function findProduct(q) {
  const inSales = SKUS.find((s) => s.skuName === q || s.skuCode === q) || null;
  const inPlan = STRATEGY.skus.find((s) => s.skuName === q || s.skuCode === q) || null;
  let skuCode = (inSales && inSales.skuCode) || (inPlan && inPlan.skuCode);
  if (!skuCode) {
    let h = 0;
    for (const c of String(q)) h = (h * 31 + c.charCodeAt(0)) % 100000;
    skuCode = '062' + String(h).padStart(5, '0');
  }
  return {
    skuCode,
    skuName: (inSales && inSales.skuName) || (inPlan && inPlan.skuName) || q,
    spec: (inSales && inSales.spec) || (inPlan && inPlan.spec) || '',
    sales: inSales,
    plan: inPlan,
  };
}

// 仿真条码（由编码确定性生成）
function Barcode({ code }) {
  const digits = ('69' + code).split('').map((c) => Number(c) || 0);
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'center', height: 52, gap: 0 }}>
        {digits.map((d, i) => (
          <React.Fragment key={i}>
            <div style={{ width: (d % 3) + 1.5, background: TOKENS.ink }}></div>
            <div style={{ width: (d % 4) + 1.5 }}></div>
            <div style={{ width: ((d + i) % 2) + 1, background: TOKENS.ink }}></div>
            <div style={{ width: 2 }}></div>
          </React.Fragment>
        ))}
      </div>
      <div style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12.5, color: TOKENS.ink, marginTop: 6, letterSpacing: 3,
      }}>69{code}</div>
    </div>
  );
}

// 商品详情底部抽屉
function ProductDetailSheet({ name, onClose, zIndex = 300 }) {
  const p = findProduct(name);
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex }}>
      <div onClick={onClose} onAnimationEnd={clearAnim} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', animation: 'shv-fadein 0.2s ease' }}></div>
      <div onAnimationEnd={clearAnim} style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%',
        background: TOKENS.bg, borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'shv-sheet-up 0.28s ease',
      }}>
        <div style={{ flexShrink: 0, padding: '12px 16px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${TOKENS.lineSoft}`, background: '#fff' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink, flex: 1 }}>商品详情</div>
          <button onClick={onClose} aria-label="关闭" style={{
            appearance: 'none', border: 0, background: '#f0ede8', cursor: 'pointer',
            width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><I.Close size={16} color={TOKENS.inkSoft} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px calc(env(safe-area-inset-bottom, 0px) + 22px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 商品大图 */}
          <div style={{
            height: 210, borderRadius: 16, position: 'relative', overflow: 'hidden',
            background: 'repeating-linear-gradient(135deg, #efe9df 0 10px, #f6f2ec 10px 20px)',
            border: `1px solid ${TOKENS.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11.5, color: TOKENS.inkMuted, background: 'rgba(255,255,255,0.85)',
              padding: '4px 10px', borderRadius: 8, letterSpacing: 1,
            }}>商品大图</span>
          </div>

          {/* 名称与状态 */}
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.35 }}>{p.skuName}</div>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
              {p.spec && <Chip tone="gray">{p.spec}</Chip>}
              {p.sales ? <Chip tone="green">货架在售</Chip> : <Chip tone="amber">当前未在售</Chip>}
              {p.plan && <Chip tone={p.plan.kind === 'remove' ? 'red' : p.plan.kind === 'push' ? 'green' : 'amber'}>{p.plan.action}</Chip>}
            </div>
          </div>

          {/* 销售数据（后台直读） */}
          {p.sales && (
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { k: '30日销量', v: `${p.sales.salesVolume30d} 件` },
                { k: '销售额', v: fmtMoney(p.sales.sales30d) },
                { k: '环比', v: `${p.sales.salesChange30d >= 0 ? '+' : ''}${p.sales.salesChange30d.toFixed(1)}%`, c: p.sales.salesChange30d >= 0 ? TOKENS.green : TOKENS.red },
              ].map((d) => (
                <div key={d.k} style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '11px 6px', textAlign: 'center', boxShadow: TOKENS.shadow1 }}>
                  <div style={{ fontSize: 10.5, color: TOKENS.inkMuted, fontWeight: 700 }}>{d.k}</div>
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: d.c || TOKENS.ink, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{d.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* 条码 */}
          <Card pad={16}>
            <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, marginBottom: 12 }}>商品条码</div>
            <Barcode code={p.skuCode} />
            <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, textAlign: 'center', marginTop: 10 }}>
              商品编码 {p.skuCode}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// 通用商品行（清单/记录里使用）：缩略图 + 名称 + 右侧内容，整行可点开详情
function ProductRow({ name, spec, right = null, onOpen, dim = false }) {
  return (
    <button onClick={onOpen} style={{
      appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
      width: '100%', textAlign: 'left', cursor: 'pointer', padding: 0,
      display: 'flex', alignItems: 'center', gap: 9,
    }}>
      <ProductThumb size={34} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600,
        color: dim ? TOKENS.inkMuted : TOKENS.ink,
        textDecoration: dim ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name} {spec && <span style={{ fontSize: 11.5, color: TOKENS.inkMuted, fontWeight: 500 }}>{spec}</span>}
      </span>
      {right}
      <I.ChevronR size={13} color={TOKENS.inkMuted} />
    </button>
  );
}

Object.assign(window, { ProductThumb, ProductDetailSheet, ProductRow, Barcode, findProduct });
