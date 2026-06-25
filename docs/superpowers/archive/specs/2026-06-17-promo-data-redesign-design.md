# 促销数据重构设计（多 sheet 上传 + 4 类机制 + 多批次共存）

**日期**：2026-06-17
**状态**：设计已确认，待写实施计划
**前置背景**：之前的 V028 promo raw_items 工作已回滚（stash@{0}），本次重新设计。V028 已被 AI status 迁移占用，新 schema 从 V029 起。

---

## 1. 背景与动机

### 1.1 当前状态
- 一份 Excel 只能装"会员价"一类活动，1 张 sheet，1083 个 sku。
- 数据库表 `hq_promo_batch_items` 只有"单品 + 凑单组"语义，没有活动类型区分。
- 全局只允许一个 `is_active = TRUE` 的批次（V005 UNIQUE 约束）。
- 视图 `v_promotion_active` 直接喂给最低价计算和海报生成。

### 1.2 新需求带来的变化
**新文件结构**：`6月下营销活动（会员价+叠券）.xlsx` 有 **5 张 sheet**：
| sheet | 行数 | 含义 |
|---|---|---|
| 会员价 | ~1030 | 主力，1031 行 / 983 unique sku，含"促销组"列 |
| 周末啤酒日 | 73 | 单一规则 "本品买3送1"，仅五六日生效 |
| 品牌满减券 | 364 | 行内 fill-down：只有 15 行写了规则，其余继承上方 |
| 周二会员日 | 27 | 仅周二生效 |
| 常规优惠券 | 35 | 与会员价/啤酒日可叠加 |

**新叠加规则**：每次结算 = 一个 base + 至多一个 add-on：
- **base** ∈ { 会员价, 周末啤酒日 }（同 sku 都参与时强制二选一）
- **add-on** ∈ { 品牌满减券, 周二会员日, 常规优惠券 } **且其机制必须可叠加**（百分比折扣 / 满减），其它机制（一口价 / 多件特价 / 买M送N）只能跟 base 二选一

**前端功能不变**：最低价、列表、海报三件套保持现有 UX；变化都在数据层。

### 1.3 现状不能满足的点
- 单 active 批次约束 → 多期活动共存做不到
- 单一活动类型 → 4 个新 sheet 无处落
- 没有"机制类型" → 叠加矩阵算不出来
- 文件级 mix_group → 跨活动类型（满减券的品牌池）放不下

---

## 2. 目标 / 非目标

### 2.1 目标
- 一次上传能吃下完整 5 sheet
- 多批次共存，按当下日期 + 星期自动过滤生效中的优惠
- 4 类机制 + 4 个子类型覆盖 Excel 实测的所有话术变体
- 最低价计算只面对结构化字段，不再正则解析话术
- 默认促销文案从机制字段拼装（不再手写文案表）

### 2.2 非目标（本期不做）
- 海报模板升级（继续走当前模板，只在视图列上做映射）
- 运营自定义文案模板（不入 schema，写在代码里；将来需要再加表）
- 历史批次回看 UI（数据保留但不提供专门页面）
- 旧 batch 数据迁移（**老数据全部丢弃，从空表开始**）

---

## 3. 总体形状

3 张表 + 1 张按日期过滤的视图。

```
        ┌─────────────────────────┐
        │  上传批次（hq_promo_     │  一次上传 = 一行
        │  batches，语义改造）     │  谁传的、何时、是否作废
        └─────────────┬───────────┘
                      │ 1:N
        ┌─────────────┴───────────┐
        │  原始活动行（档案层）     │  Excel 每行 = 一条
        │  hq_promo_raw_items     │  忠实还原，永不改
        └─────────────┬───────────┘
                      │ 1:1（极少 1:N，保留可能性）
        ┌─────────────┴───────────┐
        │  标准化优惠（计算层）     │  最低价/海报/文案只读这层
        │  hq_promo_offers        │  4 类机制 + 池子标签
        └─────────────────────────┘

        视图 v_active_offers ← hq_promo_offers 上加日期 / 星期 / 作废过滤
```

**为什么没有独立的"凑单池"表**：凑单池（会员价的促销组、满减券的 fill-down 段落）逻辑上是"一组商品共享一条规则"，但每条优惠本来就要带规则参数。所以池子身份用**池子标签**字符串字段表达：查询时按 `(batch_id, activity_type, pool_label)` 分组就是池子，UI 显示"百威系列池里有 18 个商品"只是 `count(*)`。少一张表、少一次 join。

**为什么 raw → offer 允许 1:N**：极少数情况下一行话术含两层规则（"满 25 减 5 + 第 2 件半价"塞同一格），解析器可拆出两条 offer 指回同一条 raw。当前 Excel 实测没出现，但 schema 不堵这扇门。

---

## 4. 档案层（faithful to Excel，永远只读）

### 4.1 上传批次表（`hq_promo_batches` 改造）

| 字段 | 业务含义 | 写入时机 | 读取场景 |
|---|---|---|---|
| `id` | 批次编号 | 上传时由系统生成 | 关联数据回溯 |
| `file_name` | 文件原名 | 上传时记录 | 列表显示是哪一期 |
| `source_file_url` | OSS 文件链接 | 落 OSS 后回写 | 想看原文件时点开 |
| `uploaded_by` / `created_at` | 谁传、什么时间 | 上传时记录 | 审计 |
| `is_voided` | 误传 / 撤回的开关；作废后整批 raw 行视为不生效 | 默认 false；后台手动切 | 视图过滤排除作废批 |
| `activity_window_start` / `activity_window_end` | 这一批次里所有 raw 行起止时间的 min / max | 解析完成回填 | 列表页一眼看出"哪一期" |
| `parse_warnings` | JSONB；行号 + 原文 + 失败原因 | 解析完成回填 | 上传后给运营复核 |
| `row_total` / `parsed_total` | 各 sheet 行数 / 成功解析数（JSONB） | 解析完成回填 | 上传后给运营一个核对数字 |
| `parsed_at` | 后台跑完解析的时间 | 解析完成时间戳 | 监控解析时延 |

**跟当前差异**：
- 删 `is_active` + 它的 UNIQUE 约束；改成 `is_voided`（语义反转，默认生效）
- 加 `activity_window_start` / `end`、`uploaded_by`、`parsed_at`
- 拆掉 `group_count` 单列（凑单池数从 offers 算）

### 4.2 原始活动行表（`hq_promo_raw_items` 新建）

| 字段 | 业务含义 | 全 sheet 都有？ |
|---|---|---|
| `id` | 行编号 | ✓ |
| `batch_id` | 所属批次 | ✓ |
| `activity_type` | 5 选 1：member_price / weekend_beer / brand_coupon / tuesday_member / regular_coupon | ✓（按 sheet 名映射） |
| `sheet_row_no` | 在 Excel 里是第几行 | ✓（fill-down 溯源 + 告警定位） |
| `sku_code` | 商品代码 | ✓ |
| `sku_name_original` | Excel 里的品名规格（与 hq_products 可能不一致） | ✓ |
| `unit` | 罐 / 瓶 / 包 / 盒 | ✓ |
| `original_price` | 原零售价（Excel 写的，作为活动报送时的参考） | ✓ |
| `raw_method_text` | 促销话术原文（**满减券的 fill-down 已回填，便于档案独立阅读**） | ✓ |
| `qty_required` | "包含商品数"列（凑齐几件） | 仅 member_price / weekend_beer |
| `promo_total_price` | "促销价"列（凑齐后总价） | 仅 member_price / weekend_beer |
| `promo_group_code` | "促销组"列（同组商品可任选凑数） | 仅 member_price |
| `category_code` / `category_name` | 大类 | 仅 member_price / weekend_beer |
| `valid_from` / `valid_to` | 起止时间 | ✓ |
| `fill_down_anchor_row` | 当本行话术来自 fill-down 时，指向段落起始行号 | 仅 brand_coupon |

**写入时机**：上传文件 → 解析器把 5 个 sheet 全部展平为这张表的行，一次 COPY 写入（~1100 行 < 1 秒）；之后只读。

**读取场景**：
- 解析告警页（"第 35 行话术识别不了，原文这样"）
- 历史回看
- 优惠层异常时校对回查

---

## 5. 计算层（4 类机制 + 池子标签）

### 5.1 4 类机制

| 机制代码（ENUM 值）| 业务含义 | 参数（JSONB） | 可叠加在 base 之上 |
|---|---|---|---|
| **`flat_price`** | 单品直接到某个目标价 | `{ target_price }` | ❌ |
| **`bundle_price`** | 凑齐 Q 件后总价按某公式 | `{ qty_required, subtype, ... }` 见 5.2 | ❌ |
| **`percent_discount`** | 凭券打折 | `{ pay_ratio }`（"50% 折扣券" = 0.5） | ✅ |
| **`pool_threshold`** | 凑单池满 X 减 Y | `{ threshold, discount }`（池子标签独立字段） | ✅ |

> 下文为简洁起见，会用 A / B / C / D 作为这 4 类机制的速记代号；DB / 代码里用上表第一列的语义名。

**叠加规则的本质**：不是按"活动类型"判断，而是按"加成项的机制类型"判断——机制 ∈ {C, D} 才可叠加，其它一律二选一。这条规则一句话涵盖了所有特例：
- 周二会员日"50% 折扣券"可叠（C）；"0.1 元抢"不可叠（A）
- 常规优惠券"75% 折扣券"可叠（C）；"3 件特价 9 元"不可叠（B）

### 5.2 机制 B（bundle_price）的 4 个子类型

| 子类型 | 例句 | 参数 | 总价公式 |
|---|---|---|---|
| **B1. fixed_total** | "9.9 元/任意 2 盒""两件特价 9 元""3 件特价 9 元" | `Q, V` | 常数 V |
| **B2. nth_ratio** | "本品第 2 支半价""任意第 2 瓶半价" | `Q=2, K=2, ratio=0.5` | `(Q−1) × 原价 + 第 K 件 × ratio`；池内任选时第 K 件选**池内当下被选中的价更低**那件 |
| **B3. add_extra** | "加 1 元多 1 包""加 2 元多任意 1 瓶" | `Q=2, add_amount` | `本品原价 + add_amount` |
| **B4. buy_m_get_n** | "本品买 3 送 1""买一送一" | `M, N, Q=M+N` | `M × 本品原价`（仅本品，不进池） |

**为什么不把 Q 件总价 parse-time 算成常数**：B2/B3 在"任意"模式下，总价依赖池内被选中的件的原价——只有结算时才能定。**parse 时只存算法 + 参数**，最低价计算 runtime 用池里实际选中的件代入。

**周末啤酒日的对账**：73 行都是 B4，参数 `M=3, N=1, Q=4`；解析时验证 `3 × original_price == promo_total_price`，对不上就报告解析告警。

### 5.3 标准化优惠表（`hq_promo_offers` 新建）

| 字段 | 业务含义 |
|---|---|
| `id` | 优惠编号 |
| `raw_item_id` | 指回档案行（1:1 / 极少 1:N） |
| `batch_id` / `activity_type` / `sku_code` | 冗余存放，便于直接过滤而不必 join |
| `mechanic` | ENUM: `flat_price` / `bundle_price` / `percent_discount` / `pool_threshold` |
| `mechanic_params` | JSONB，按机制类型解读：A 存 `{target_price}`；B 存 `{subtype, qty_required, ...}`；C 存 `{pay_ratio}`；D 存 `{threshold, discount}` |
| `pool_label` | 字符串。例如 `"会员价/促销组27"` 或 `"品牌满减券/百威系列"`。同 `(batch_id, activity_type, pool_label)` = 同一池子。可为 null（=只能本品自己凑） |
| `original_price` | 本品原零售价；从档案行复制（避免每次 join），池子任选公式也要用 |
| `valid_weekday_mask` | 7 位（周一到周日）；member_price / brand_coupon / regular_coupon = 全 1；weekend_beer = 五六日；tuesday_member = 仅周二 |
| `valid_from` / `valid_to` | 从档案行复制；视图用 |
| `is_stackable` | 由 mechanic 决定（C / D = true，A / B = false）；冗余字段，方便过滤 |
| `parse_note` | 调试用：匹配到的正则子串和判定理由 |

### 5.4 视图 `v_active_offers`

视图层做一件事：拦掉当下不该看见的 offers。列 = offers 表全部列，无额外字段。

| 过滤条件 | 含义 |
|---|---|
| `batches.is_voided = false` | 整批被运营手动关的不计入 |
| `current_date BETWEEN valid_from AND valid_to` | 单条 offer 的时间窗 |
| `valid_weekday_mask` 在当下星期位上为 1 | 周末啤酒日 / 周二会员日的星期约束 |

最低价计算 / UI 列表 / 海报生成全都走视图，不走 offers 表。

### 5.5 14 种话术 → 机制 映射表

| 原话术（实测来自 Excel） | 机制 | 子类型 | 参数 |
|---|---|---|---|
| "0.1 元抢""2 元抢""6.9 元抢""9.9 元抢""4.5 元抢""特价 9.9 元/瓶""16.9 元抢""3 元抢""3.25 元抢""1.9 元抢""2.5 元抢""2.7 元抢""2.75 元抢" | A | — | `{target_price=X}` |
| "9.9 元/任意 2 袋""8 元/任意 2 瓶""15 元/任意 2 罐""两件特价 9 元""3 件特价 9 元""4 件特价 24 元""两件特价 18 元""两件特价 8.9 元""2 件特价 5.2 元""2 件特价 8.8 元""两件特价 8.2 元" | B | B1 | `{Q=N, V=Y}` |
| "本品第 2 支半价""任意第 2 瓶半价""第 2 支半价""第 2 瓶半价""任意第 2 包半价""第 2 包半价""任意第 2 袋半价" | B | B2 | `{Q=2, K=2, ratio=0.5}` |
| "加 1 元多 1 包""加 1 元多 1 瓶""加 1 元多任意 1 瓶""加 1 元多任意 1 包""加 2 元多任意 1 瓶" | B | B3 | `{Q=2, add_amount=ΔY}` |
| "本品买 3 送 1""买一送一" | B | B4 | `{M, N, Q=M+N}` |
| "50% 折扣券""75% 折扣券" | C | — | `{pay_ratio=X/100}` |
| "满 15 减 3 元""满 25 减 5 元""满 30 减 5 元""满 20 减 4 元""满 20 减 5 元""满 59 减 15 元" | D | — | `{threshold=X, discount=Y}` |

**"任意"前缀**：表示在池子里任选其它成员凑数（pool_label 非空且池子大小 > 1）；不带"任意"或带"本品"前缀，pool_label 仍可能非空（属于池子）但子类型计算只用本品（如 B4）。

---

## 6. 叠加 + 最低价 + 默认文案

### 6.1 叠加矩阵

> 一次结算 = **一个 base** + **至多一个可叠 add-on**

- base 候选：会员价 / 周末啤酒日 之一
- add-on 候选：品牌满减券 / 周二会员日 / 常规优惠券 之一，且 `is_stackable = true`
- 双方都要满足"今天的日期 ∈ 起止窗口" + "今天的星期 ∈ 星期掩码"

> 不直观的规则角落：周末啤酒日（五六日）+ 周二会员日（仅周二）按星期约束自然不重叠，组合会被时间过滤掉为空。这条规则不写在数据里，由计算时按星期取交集自然得到。

### 6.2 最低价计算

**输入**：
- 一组 sku
- 当下日期

**对每个 sku 输出**：
- 最优组合：base 机制 + add-on 机制（add-on 可为空）
- 支付金额（按公式算）
- 节省金额 = 原零售价 − 支付金额
- 池子上下文：B / D 机制时告诉前端"要凑齐 N 件" / "本池累计满 X 减 Y，目前金额 Z"

**算法骨架**：
1. 取该 sku 当前生效的所有 offers（从 `v_active_offers`）
2. 按机制分组：base 候选（机制 ∈ {A, B} 且 activity_type ∈ {member_price, weekend_beer}）vs add-on 候选（is_stackable = true）
3. 对每个 base × (空 add-on, 每个 add-on) 笛卡尔积
4. 对每个组合算应付金额（先算 base 套餐总价，再让 add-on 作用于这个总价）：
   - base = A → 套餐总价 = `target_price`（套餐 = 1 件）
   - base = B → 套餐总价 = 按子类型公式算出的 Q 件总价
     - B1：常数 V
     - B2：(Q−1) × 原价 + 第 K 件 × ratio；池内任选时第 K 件取池内当下选中的最低原价
     - B3：本品原价 + add_amount
     - B4：M × 本品原价
   - 叠 add-on：
     - 无 add-on → 应付 = 套餐总价
     - C → 应付 = 套餐总价 × pay_ratio
     - D → 该 sku 与同池其它商品**累计金额**参与满减判断；命中则按比例摊回本 sku 的应付金额（**摊销公式仅用于展示，实际收银是池子级别的整笔满减**）
5. 选最低应付的组合（按套餐总价 ÷ Q 折成单品摊销值比较，便于跨 base 比对）
6. 节省 = original_price − 最低单品摊销值

**池子层特殊性**：B 和 D 的最低价是池子级别的最优而非单品级别。计算时先按 `(batch_id, activity_type, pool_label)` 把池子聚起来，再按池子规则算最优买法。池子内对单品分摊（B 的"任选第 K 件半价" / D 的"按比例摊减免"）仅用于展示和文案，不影响实际收银。

**不变量**：算法只读视图，不直接读 raw 档案；多 batch 共存时视图已按日期 + 星期 + 是否作废过滤完。

### 6.3 默认文案拼装

> 示例（用户给的）：`"会员价 2 瓶 9.9 元 到店领券 品牌满减券 满 25 减 5"`

每段从优惠层字段直接读，不再去解析原话术：

| 段位 | 来源 | 模板 |
|---|---|---|
| **段 1 base** | base 优惠的 mechanic + activity_type | A → "{活动类型}特价 {target_price} 元/件"<br>B1 → "{活动类型} {Q} 件 {V} 元"<br>B2 → "{活动类型} 第 {K} 件半价"<br>B3 → "{活动类型} 加 {ΔY} 元多 1 件"<br>B4 → "{活动类型} 买 {M} 送 {N}" |
| **段 2 连接** | 固定 | "到店领券"（仅当有 add-on） |
| **段 3 add-on** | add-on 优惠的 mechanic + activity_type | C → "{活动类型} {pay_ratio×100}% 折"<br>D → "{活动类型} 满 {threshold} 减 {discount}" |

**模板存哪里**：写在后端代码里（一份 `mechanic → 模板` 的字典），不入 schema。如果以后要让运营改文案，再加 `promo_copy_templates` 表。**当前不做。**

---

## 7. 上传流程

```
[运营点上传]
   ↓
[文件上 OSS]                       → 留下 source_file_url
   ↓
[建批次记录]                       → batches 新增一行（is_voided=false）
   ↓
[解析 5 个 sheet]
   ├─ 每读一行 → 写一条 raw_items
   ├─ brand_coupon 特殊处理：维护当前 fill-down 规则，遇非空就更新
   │   每行档案 → 把当下生效规则填入 raw_method_text + fill_down_anchor_row
   ├─ 话术 → 4 类机制匹配
   │   ├─ 成功 → 写一条 offers（含 pool_label）
   │   └─ 失败 → 写 parse_warnings；档案行照存
   └─ weekend_beer 对账：3 × original_price ?= promo_total_price；不等告警
   ↓
[回写批次统计]                     → row_total / parsed_total / activity_window / parse_warnings / parsed_at
   ↓
[返回告警列表]                     → 前端弹窗给运营看；运营决定保留或作废重传
```

**性能**：~1100 raw + ~1100 offers，COPY 写入 < 1 秒。解析在内存里跑（话术匹配是纯字符串），不调用任何外部服务。

---

## 8. 迁移（一次性，老数据丢弃）

**V029** 一次 migration 完成。下方为伪 SQL 示意（字段集详见第 4 / 5 段，最终 DDL 在实施计划阶段细化）：

```sql
BEGIN;

-- 1. 删旧（依赖顺序：view → table）
DROP VIEW  IF EXISTS v_promotion_active;
DROP VIEW  IF EXISTS hq_promo_mix_groups;
DROP TABLE IF EXISTS hq_promo_batch_items;
DROP TABLE IF EXISTS hq_promo_batches CASCADE;

-- 2. 新 ENUM
CREATE TYPE promo_activity_type AS ENUM (
  'member_price', 'weekend_beer', 'brand_coupon', 'tuesday_member', 'regular_coupon'
);
CREATE TYPE promo_mechanic AS ENUM (
  'flat_price', 'bundle_price', 'percent_discount', 'pool_threshold'
);

-- 3. 新表（字段集见 4.1 / 4.2 / 5.3）
CREATE TABLE hq_promo_batches   ( /* 见 4.1 */ );
CREATE TABLE hq_promo_raw_items ( /* 见 4.2 */ );
CREATE TABLE hq_promo_offers    ( /* 见 5.3 */ );

-- 4. 视图（见 5.4 的过滤条件）
CREATE VIEW v_active_offers AS
SELECT o.*
FROM   hq_promo_offers o
JOIN   hq_promo_batches b ON b.id = o.batch_id
WHERE  b.is_voided = false
  AND  current_date BETWEEN o.valid_from AND o.valid_to
  AND  /* 当日星期掩码位匹配 */;

COMMIT;
```

**配套代码改动**：
- 后端：`promotions.service.ts` 全部重写（上传 → 解析 → 双层写入）；`promotions.routes.ts` 接口 shape 大体保留，新增 5 个活动类型字段
- 后端：删 `hq_promo_sku_texts` 相关残留代码（V021 已删表，可能还有 dead code）
- 前端：`promotionsApi.active / recommend` 输出 shape **可能扩展**（增加 mechanic 字段供文案模板用），但不破坏现有调用方
- 海报模板：当前模板继续读最低价 + 节省金额；mechanic 详细字段可选用
- seed：dev-seed 新增几条样例（每类活动各 1-2 条），便于本地跑通

**风险/约束**：
- 上线时如有未消费的旧批次数据 → 直接丢（用户确认"老数据全部丢弃"）
- 解析告警不阻断入库；运营看告警后自决重传
- fill-down 段落跨 batch 同名（如两期都有"百威系列"池）→ 池子标签自带 batch_id 前缀天然隔离

---

## 9. 边界与已知细节

- **同 sku 多 sheet 共存**：解析时不去重，每个活动类型独立成 offer 行。最低价计算按叠加矩阵挑最优组合。
- **会员价 sheet 同 sku 多行**（实测 47 个）：保留两条档案行，分别生成两条 offer。原因通常是 sku 同时参与"促销组 27"和"促销组 28"；业务允许。
- **历史回看 UI**：本期不做，数据保留供未来需要。
- **文案模板可配置化**：本期不做，写代码里。
- **海报模板升级**：本期不做。

---

## 10. 决策记录

- ✅ 档案层 vs 计算层分离（选项 C）
- ✅ 多 batch 共存按时间窗过滤（选项 B）
- ✅ 品牌满减券 fill-down = 空继承上方最近一条非空规则（用户确认）
- ✅ 老数据丢弃，一次性 migration（用户确认）
- ✅ 凑单池用标签字段表达，不建独立表
- ✅ 4 类机制 + B 机制 4 子类型可覆盖实测全部话术

---

## 附：与 stash@{0} 的关系

stash@{0} 是上一次 V028 promo raw_items 的尝试，采用"raw_items 单表 + mix_groups view"路径，与本设计的"raw + offers 两层 + 4 机制"不同。**建议丢弃 stash，按本设计从零写新迁移**。stash 留作"曾走过这条死路"的档案。
