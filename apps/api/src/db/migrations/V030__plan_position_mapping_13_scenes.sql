-- =============================================================================
-- V030: plan_position_mapping 重定义 —— 13 个场景
--
-- 业务背景：V015 的 5 个示例场景（糖巧/面包架/冷藏柜/冰柜/零食货架）只是占位 seed。
-- 实际线下运营按 13 个场景规划，部分场景共享 position_code（如「面包架」=常温奶+烘焙
-- 两条；「9」=日化+家杂两条），需要 (position_code, position_name) 复合来区分。
-- 配套 scenes.service.ts listScenes() 已改成按 (code, name) 复合 key 分组。
--
-- display_order 的作用：
--   - 同一场景内多个品类的展示顺序（如「日化」下 6 个子品类的顺序）
--   - 同一 position_code 下多场景的展示顺序（service 用 SQL ORDER 后的插入序）
--   所以「日化」的 display_order 必须全部小于「家杂」的，才能保证日化先出。
--
-- 13 个场景一览：
--   code 0  糖巧                糖果, 巧克力
--   code 1  面包架【常温奶】     常温乳制品
--   code 1  面包架【烘焙】       烘焙糕点
--   code 2  小零食              定量小包装
--   code 3  大休闲              坚果炒货, 休闲肉脯, 休闲素食, 果干蜜饯
--   code 4  饼干膨化            膨化食品, 饼干
--   code 5  方便速食            方便食品
--   code 6  根油调味            调味副食, 粮油, 冲调品
--   code 7  酒                  酒类
--   code 8  玩具                玩具
--   code 9  日化                卫生用品, 家庭护理, 个人护理, 生活用纸, 口腔护理, 针织品及鞋类
--   code 9  家杂                家庭杂品, 数码电器, 餐厨用品, 文具用品, 宠物产品
--   code 10 冷藏                冷藏品
-- =============================================================================

-- 清空旧 seed（V015 5 条示例 + 任何后续手动调整）。
-- 注意 scene_remake / scene_adjustment / store_shelf_config / virtual_shelf_history
-- 都以 position_code SMALLINT 引用，但都没建 FK，所以这里安全清空不会引发 FK 错。
-- 历史数据中残留的旧 position_code（如 V015 的 2=冷藏柜）会被新映射重新解释为
-- 新含义（2=小零食），这是 dev/staging 环境可接受的；prod 部署前需运维确认无数据。
DELETE FROM plan_position_mapping;

INSERT INTO plan_position_mapping (position_code, position_name, category_name, display_order) VALUES
  -- code 0 糖巧
  (0,  '糖巧',              '糖果',         0),
  (0,  '糖巧',              '巧克力',       1),
  -- code 1 面包架【常温奶】（display_order 0-9 段）
  (1,  '面包架【常温奶】',   '常温乳制品',   0),
  -- code 1 面包架【烘焙】（display_order 10-19 段，确保排在常温奶之后）
  (1,  '面包架【烘焙】',     '烘焙糕点',    10),
  -- code 2 小零食
  (2,  '小零食',            '定量小包装',   0),
  -- code 3 大休闲
  (3,  '大休闲',            '坚果炒货',     0),
  (3,  '大休闲',            '休闲肉脯',     1),
  (3,  '大休闲',            '休闲素食',     2),
  (3,  '大休闲',            '果干蜜饯',     3),
  -- code 4 饼干膨化
  (4,  '饼干膨化',          '膨化食品',     0),
  (4,  '饼干膨化',          '饼干',         1),
  -- code 5 方便速食
  (5,  '方便速食',          '方便食品',     0),
  -- code 6 根油调味
  (6,  '根油调味',          '调味副食',     0),
  (6,  '根油调味',          '粮油',         1),
  (6,  '根油调味',          '冲调品',       2),
  -- code 7 酒
  (7,  '酒',                '酒类',         0),
  -- code 8 玩具
  (8,  '玩具',              '玩具',         0),
  -- code 9 日化（display_order 0-9 段）
  (9,  '日化',              '卫生用品',     0),
  (9,  '日化',              '家庭护理',     1),
  (9,  '日化',              '个人护理',     2),
  (9,  '日化',              '生活用纸',     3),
  (9,  '日化',              '口腔护理',     4),
  (9,  '日化',              '针织品及鞋类', 5),
  -- code 9 家杂（display_order 10-19 段，确保排在日化之后）
  (9,  '家杂',              '家庭杂品',    10),
  (9,  '家杂',              '数码电器',    11),
  (9,  '家杂',              '餐厨用品',    12),
  (9,  '家杂',              '文具用品',    13),
  (9,  '家杂',              '宠物产品',    14),
  -- code 10 冷藏
  (10, '冷藏',              '冷藏品',       0)
ON CONFLICT (position_code, category_name) DO UPDATE
  SET position_name = EXCLUDED.position_name,
      display_order = EXCLUDED.display_order,
      is_active     = TRUE,
      updated_at    = now();
