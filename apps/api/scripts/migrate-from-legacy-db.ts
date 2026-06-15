#!/usr/bin/env tsx
/**
 * 一次性 ETL：把老 myjadviser 库的业务数据搬到新统一库
 *
 * 用法：
 *   OLD_DATABASE_URL=postgresql://postgres:postgres@localhost:5435/myjadviser \
 *     npm run -w apps/api migrate:legacy
 *
 * 是**幂等的**：所有 INSERT 都用 ON CONFLICT DO NOTHING，重复跑不会重复插数据。
 *
 * 迁移范围（业务数据）：店、商品、分类、竞品、销售/价格/调价/上下架流水、
 * 选品业务（货架配置、运行态、问卷、勘误、周边洞察、SKU 促销）、海报业务、应用配置。
 *
 * 跳过：shelf_photos / shelf_photo_history（图片缓存）、usage_logs / login_events（日志）、
 * auth_sessions（会话）、profiles（重复于 auth_users）。
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/migrate-from-legacy-db.ts → 仓库根:3 层
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const OLD_URL =
  process.env.OLD_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5435/myjadviser';
const NEW_URL =
  process.env.DATABASE_URL || 'postgresql://myj:myj@localhost:5432/myj_dev';

const oldDb = new Pool({ connectionString: OLD_URL });
const newDb = new Pool({ connectionString: NEW_URL });

interface Stats {
  table: string;
  read: number;
  inserted: number;
  skipped: number;
  errors: number;
}

const log = (msg: string) => console.log(`[migrate-legacy] ${msg}`);

async function loadMap(
  pool: Pool,
  query: string,
  keyCol: string,
  valCol: string,
): Promise<Map<string, string>> {
  const { rows } = await pool.query<Record<string, string>>(query);
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r[keyCol] && r[valCol]) m.set(r[keyCol]!, r[valCol]!);
  }
  return m;
}

// ============================================================================
// 阶段 1 · app_settings
// ============================================================================
async function migrateAppSettings(): Promise<Stats> {
  const stats: Stats = { table: 'app_settings', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const { rows } = await oldDb.query<any>(`SELECT key, value, updated_at FROM app_settings`);
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const result = await newDb.query(
        `INSERT INTO app_settings (key, value, value_type, description, category, updated_at)
         VALUES ($1, $2, 'string', '迁移自老库', 'legacy', $3)
         ON CONFLICT (key) DO NOTHING`,
        [r.key, r.value, r.updated_at],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 2 · dim_category（自引用）
// ============================================================================
async function migrateDimCategory(): Promise<Stats> {
  const stats: Stats = { table: 'dim_category', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const { rows } = await oldDb.query<any>(
    `SELECT category_code, category_name, level, parent_code FROM dim_category ORDER BY level, category_code`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const result = await newDb.query(
        `INSERT INTO dim_category (category_code, category_name, level)
         VALUES ($1, $2, $3)
         ON CONFLICT (category_code) DO NOTHING`,
        [r.category_code, r.category_name, r.level],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  // 回填 parent_id
  for (const r of rows) {
    if (!r.parent_code) continue;
    try {
      await newDb.query(
        `UPDATE dim_category SET parent_id = parent.id
           FROM dim_category parent
          WHERE dim_category.category_code = $1
            AND parent.category_code = $2
            AND dim_category.parent_id IS NULL`,
        [r.category_code, r.parent_code],
      );
    } catch {}
  }
  return stats;
}

// ============================================================================
// 阶段 3 · dim_product
// ============================================================================
async function migrateDimProduct(): Promise<Stats> {
  const stats: Stats = { table: 'dim_product', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const catMap = await loadMap(newDb, 'SELECT category_code, id FROM dim_category', 'category_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT product_code, product_name, category_code, brand_name, spec, unit,
            is_new, is_own_brand, shelf_life_days, height, width, depth,
            intro_date, wholesale_price, product_status
       FROM dim_product`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const categoryId = r.category_code ? catMap.get(r.category_code) ?? null : null;
      const result = await newDb.query(
        `INSERT INTO dim_product (
            sku_code, product_name, category_id, brand, spec, unit,
            is_new_product, is_private_label, shelf_life_days,
            length_cm, width_cm, height_cm,
            introduced_at, wholesale_price, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT DO NOTHING`,
        [
          r.product_code, r.product_name, categoryId, r.brand_name, r.spec, r.unit,
          r.is_new ?? false, r.is_own_brand ?? false, r.shelf_life_days,
          r.depth, r.width, r.height,
          r.intro_date, r.wholesale_price,
          r.product_status === 'delisted' ? 'delisted' : 'active',
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 4 · benchmark_sku_allowlist
// ============================================================================
async function migrateBenchmarkSkus(): Promise<Stats> {
  const stats: Stats = { table: 'benchmark_sku_allowlist', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const productMap = await loadMap(newDb, 'SELECT sku_code, id FROM dim_product', 'sku_code', 'id');
  const { rows } = await oldDb.query<any>(`SELECT DISTINCT sku_code FROM benchmark_sku_allowlist`);
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const productId = productMap.get(r.sku_code) ?? null;
      const result = await newDb.query(
        `INSERT INTO benchmark_sku_allowlist (product_id, sku_code, segment, is_active)
         VALUES ($1, $2, 'core', TRUE)
         ON CONFLICT DO NOTHING`,
        [productId, r.sku_code],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 5 · 竞品（渠道 / 商品 / 价格）
// 注意：老库渠道用 channel_code 做 PK，没有 UUID；商品也用 comp_product_id；
// 价格表是复合 PK。新库都用 UUID PK。所以需要构建 code → UUID 映射。
// ============================================================================
async function migrateCompetitorChannels(): Promise<Stats> {
  const stats: Stats = { table: 'dim_competitor_channel', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const { rows } = await oldDb.query<any>(
    `SELECT channel_code, channel_name, channel_type, price_scope, city, address,
            longitude, latitude, remark
       FROM dim_competitor_channel`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const kind = r.channel_type === 1 ? 'online' : 'offline';
      const priceUniform = r.price_scope === 1;
      const result = await newDb.query(
        `INSERT INTO dim_competitor_channel (
            channel_code, channel_name, kind, city, address, price_uniform, is_active, attributes
          ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
          ON CONFLICT (channel_code) DO NOTHING`,
        [
          r.channel_code, r.channel_name, kind, r.city, r.address, priceUniform,
          { remark: r.remark, longitude: r.longitude, latitude: r.latitude },
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
      log(`  ! channel ${r.channel_code}: ${(err as Error).message}`);
    }
  }
  return stats;
}

async function migrateCompetitorProducts(): Promise<Stats> {
  const stats: Stats = { table: 'dim_competitor_product', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const productMap = await loadMap(newDb, 'SELECT sku_code, id FROM dim_product', 'sku_code', 'id');
  const channelMap = await loadMap(newDb, 'SELECT channel_code, id FROM dim_competitor_channel', 'channel_code', 'id');

  // 老库没有 channel 字段，从 fact 表 first-occurrence 反推
  const { rows: channelRows } = await oldDb.query<any>(
    `SELECT DISTINCT ON (comp_product_id) comp_product_id, channel_code
       FROM fact_competitor_price_weekly
       ORDER BY comp_product_id, snapshot_date DESC`,
  );
  const productToChannel = new Map<string, string>();
  for (const r of channelRows) productToChannel.set(r.comp_product_id, r.channel_code);

  const { rows } = await oldDb.query<any>(
    `SELECT comp_product_id, product_name, spec, competitor_category, map_product_code
       FROM dim_competitor_product`,
  );
  stats.read = rows.length;

  // 若有 comp_product 没出现在 fact 表，分配到 "default" 渠道（取第一个）
  const firstChannel = channelMap.values().next().value ?? null;

  for (const r of rows) {
    try {
      const channelCode = productToChannel.get(r.comp_product_id);
      const channelId = channelCode ? channelMap.get(channelCode) : firstChannel;
      if (!channelId) {
        stats.skipped++;
        continue;
      }
      // 幂等：external_sku 已存在则跳过
      const existing = await newDb.query(
        `SELECT id FROM dim_competitor_product WHERE external_sku = $1 LIMIT 1`,
        [r.comp_product_id],
      );
      if (existing.rows.length > 0) {
        stats.skipped++;
        continue;
      }
      const mappedProductId = r.map_product_code ? productMap.get(r.map_product_code) ?? null : null;
      const result = await newDb.query(
        `INSERT INTO dim_competitor_product (
            channel_id, external_sku, product_name, spec,
            mapped_sku_code, mapped_product_id, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [
          channelId, r.comp_product_id, r.product_name, r.spec,
          r.map_product_code, mappedProductId,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      if (stats.errors === 0) log(`  ! competitor_product first error: ${(err as Error).message}`);
      stats.errors++;
    }
  }
  return stats;
}

async function migrateCompetitorPrices(): Promise<Stats> {
  const stats: Stats = { table: 'fact_competitor_price_weekly', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const channelMap = await loadMap(newDb, 'SELECT channel_code, id FROM dim_competitor_channel', 'channel_code', 'id');
  // dim_competitor_product 通过 external_sku 反查 UUID
  const { rows: cpRows } = await newDb.query<any>(
    `SELECT id, external_sku FROM dim_competitor_product WHERE external_sku IS NOT NULL`,
  );
  const compProductMap = new Map<string, string>();
  for (const r of cpRows) compProductMap.set(r.external_sku, r.id);

  const { rows } = await oldDb.query<any>(
    `SELECT snapshot_date, channel_code, comp_product_id, retail_price,
            collect_source, batch_no, load_time
       FROM fact_competitor_price_weekly`,
  );
  stats.read = rows.length;

  for (const r of rows) {
    const channelId = channelMap.get(r.channel_code);
    const compProductId = compProductMap.get(r.comp_product_id);
    if (!channelId || !compProductId) {
      stats.skipped++;
      continue;
    }
    try {
      const result = await newDb.query(
        `INSERT INTO fact_competitor_price_weekly (
            competitor_product_id, channel_id, snapshot_date,
            retail_price, source, collected_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING`,
        [compProductId, channelId, r.snapshot_date, r.retail_price, r.collect_source ?? 'legacy', r.load_time],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 6 · stores
// ============================================================================
async function migrateStores(): Promise<Stats> {
  const stats: Stats = { table: 'stores', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const { rows } = await oldDb.query<any>(
    `SELECT id, store_id, store_label, coordinates, address, created_at FROM imported_stores`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    try {
      let lon: number | null = null;
      let lat: number | null = null;
      if (r.coordinates && r.coordinates.includes(',')) {
        const [lonStr, latStr] = r.coordinates.split(',');
        lon = parseFloat(lonStr);
        lat = parseFloat(latStr);
      }
      const result = await newDb.query(
        `INSERT INTO stores (id, store_code, store_name, address, longitude, latitude, ownership, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'franchise', 'active', $7)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.store_id, r.store_label, r.address || '', lon, lat, r.created_at],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
      log(`  ! ${r.store_id}: ${(err as Error).message}`);
    }
  }
  return stats;
}

// ============================================================================
// 阶段 7 · users + roles + user_stores
// ============================================================================
async function migrateUsers(): Promise<Stats> {
  const stats: Stats = { table: 'users', read: 0, inserted: 0, skipped: 0, errors: 0 };

  // 老 auth_users
  const auth = await oldDb.query<any>(
    `SELECT id, email, encrypted_password, display_name, created_at FROM auth_users`,
  );
  stats.read += auth.rows.length;
  for (const u of auth.rows) {
    try {
      const result = await newDb.query(
        `INSERT INTO users (id, display_name, email, legacy_account, legacy_password_hash, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.display_name ?? u.email.split('@')[0], u.email, u.email, u.encrypted_password, u.created_at],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
      // 分配角色：email/display_name 含 superadmin → super_admin，否则 store_owner
      const isSuperAdmin =
        (u.email && /superadmin/i.test(u.email)) ||
        (u.display_name && /superadmin/i.test(u.display_name));
      await newDb.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [u.id, isSuperAdmin ? 'super_admin' : 'store_owner'],
      );
    } catch (err) {
      stats.errors++;
    }
  }

  // store_accounts
  const accounts = await oldDb.query<any>(
    `SELECT account, store_id, store_label, password_hash, created_at FROM store_accounts`,
  );
  stats.read += accounts.rows.length;
  for (const a of accounts.rows) {
    try {
      // 先清掉 V015 占位 admin（用 'changeme' 的）
      if (a.account === 'admin') {
        await newDb.query(
          `DELETE FROM users WHERE legacy_account = 'admin' AND legacy_password_hash NOT LIKE $1`,
          [a.password_hash.substring(0, 10) + '%'],
        );
        await newDb.query(
          `DELETE FROM user_roles WHERE user_id NOT IN (SELECT id FROM users)`,
        );
      }

      const inserted = await newDb.query<{ id: string }>(
        `INSERT INTO users (display_name, legacy_account, legacy_password_hash, status, created_at)
         VALUES ($1, $2, $3, 'active', $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [a.account === 'admin' ? '系统管理员' : `${a.store_label} 店长`, a.account, a.password_hash, a.created_at],
      );

      let userId: string;
      if (inserted.rows.length > 0) {
        userId = inserted.rows[0]!.id;
        stats.inserted++;
      } else {
        const ex = await newDb.query<{ id: string }>(
          `SELECT id FROM users WHERE legacy_account = $1 AND deleted_at IS NULL LIMIT 1`,
          [a.account],
        );
        if (!ex.rows[0]) {
          stats.errors++;
          continue;
        }
        userId = ex.rows[0].id;
        stats.skipped++;
      }

      // 角色
      if (a.account === 'admin') {
        await newDb.query(
          `INSERT INTO user_roles (user_id, role) VALUES ($1, 'super_admin') ON CONFLICT DO NOTHING`,
          [userId],
        );
      } else {
        await newDb.query(
          `INSERT INTO user_roles (user_id, role) VALUES ($1, 'store_owner') ON CONFLICT DO NOTHING`,
          [userId],
        );
        const store = await newDb.query<{ id: string }>(
          `SELECT id FROM stores WHERE store_code = $1 AND deleted_at IS NULL LIMIT 1`,
          [a.store_id],
        );
        if (store.rows[0]) {
          await newDb.query(
            `INSERT INTO user_stores (user_id, store_id, role, is_primary)
             VALUES ($1, $2, 'manager', TRUE) ON CONFLICT DO NOTHING`,
            [userId, store.rows[0].id],
          );
        }
      }
    } catch (err) {
      stats.errors++;
      log(`  ! account ${a.account}: ${(err as Error).message}`);
    }
  }
  return stats;
}

// ============================================================================
// 阶段 8 · fact_store_sku_weekly
// ============================================================================
async function migrateStoreSkuFacts(): Promise<Stats> {
  const stats: Stats = { table: 'fact_store_sku_weekly', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  const productMap = await loadMap(newDb, 'SELECT sku_code, id FROM dim_product', 'sku_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT snapshot_date, store_id, product_code, sale_price,
            sales_amt_30d, sales_qty_30d, sales_amt_90d, sales_qty_90d, last_ship_date
       FROM fact_store_sku_weekly`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    const storeId = storeMap.get(r.store_id);
    const productId = productMap.get(r.product_code);
    if (!storeId || !productId) {
      stats.skipped++;
      continue;
    }
    try {
      const result = await newDb.query(
        `INSERT INTO fact_store_sku_weekly (
            store_id, product_id, sku_code, snapshot_date,
            retail_price, sales_qty_30d, sales_amount_30d,
            sales_qty_90d, sales_amount_90d, last_delivery_at, source
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'erp_sync')
          ON CONFLICT DO NOTHING`,
        [
          storeId, productId, r.product_code, r.snapshot_date,
          r.sale_price, r.sales_qty_30d, r.sales_amt_30d,
          r.sales_qty_90d, r.sales_amt_90d, r.last_ship_date,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 9 · ops_store_price_change
// ============================================================================
async function migratePriceChanges(): Promise<Stats> {
  const stats: Stats = { table: 'ops_store_price_change', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  const productMap = await loadMap(newDb, 'SELECT sku_code, id FROM dim_product', 'sku_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT batch_id, store_id, product_code, old_price, new_price,
            effective_date, operator_user_id, created_at
       FROM ops_store_price_change`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    const storeId = storeMap.get(r.store_id);
    const productId = productMap.get(r.product_code);
    if (!storeId || !productId) {
      stats.skipped++;
      continue;
    }
    // 幂等：相同 (store, product, effective_date, old, new) 已存在则跳过
    const existing = await newDb.query(
      `SELECT 1 FROM ops_store_price_change
        WHERE store_id = $1 AND product_id = $2
          AND effective_date = $3 AND old_price = $4 AND new_price = $5 LIMIT 1`,
      [storeId, productId, r.effective_date, r.old_price, r.new_price],
    );
    if (existing.rows.length > 0) {
      stats.skipped++;
      continue;
    }
    try {
      // 老库 operator_user_id 是文本（如 "admin"），不是 UUID。
      // 尝试反查老账号 → 新 user UUID；查不到就置 NULL，原值放 note
      let operatorUuid: string | null = null;
      let opNote = '';
      if (r.operator_user_id) {
        if (/^[0-9a-f]{8}-/.test(r.operator_user_id)) {
          operatorUuid = r.operator_user_id;
        } else {
          const u = await newDb.query<{ id: string }>(
            `SELECT id FROM users WHERE legacy_account = $1 LIMIT 1`,
            [r.operator_user_id],
          );
          if (u.rows[0]) operatorUuid = u.rows[0].id;
          else opNote = `legacy operator=${r.operator_user_id} `;
        }
      }
      const noteText = opNote + (r.batch_id ? `legacy batch_id=${r.batch_id}` : '');
      const result = await newDb.query(
        `INSERT INTO ops_store_price_change (
            store_id, product_id, sku_code, old_price, new_price,
            source, effective_date, operator_user_id, note, created_at
          ) VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, $9)`,
        [
          storeId, productId, r.product_code, r.old_price, r.new_price,
          r.effective_date, operatorUuid, noteText || null, r.created_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      if (stats.errors === 0) log(`  ! price_change first error: ${(err as Error).message}`);
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 10 · ops_store_assortment_change
// ============================================================================
async function migrateAssortmentChanges(): Promise<Stats> {
  const stats: Stats = { table: 'ops_store_assortment_change', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  const productMap = await loadMap(newDb, 'SELECT sku_code, id FROM dim_product', 'sku_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT batch_id, store_id, product_code, change_type,
            effective_date, operator, created_at
       FROM ops_store_assortment_change`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    const storeId = storeMap.get(r.store_id);
    const productId = productMap.get(r.product_code);
    if (!storeId || !productId) {
      stats.skipped++;
      continue;
    }
    try {
      const action = r.change_type === 'add' ? 'add' : r.change_type === 'remove' ? 'remove' : 'replace';
      // 幂等：相同 (store, product, action, effective_date) 已存在则跳过
      const existing = await newDb.query(
        `SELECT 1 FROM ops_store_assortment_change
          WHERE store_id = $1 AND product_id = $2 AND action = $3 AND effective_date = $4 LIMIT 1`,
        [storeId, productId, action, r.effective_date],
      );
      if (existing.rows.length > 0) {
        stats.skipped++;
        continue;
      }
      // 老库 batch_id 是文本（如 "CSV-IMPORT-20260603"），不是 UUID。置 NULL，原值放 operator_display 前缀。
      let batchUuid: string | null = null;
      let opDisplay = r.operator ?? '';
      if (r.batch_id) {
        if (/^[0-9a-f]{8}-/.test(r.batch_id)) {
          batchUuid = r.batch_id;
        } else {
          opDisplay = `[batch=${r.batch_id}] ${opDisplay}`;
        }
      }
      const result = await newDb.query(
        `INSERT INTO ops_store_assortment_change (
            store_id, product_id, sku_code, action, reason_code,
            batch_id, effective_date, operator_display, created_at
          ) VALUES ($1, $2, $3, $4, 'other', $5, $6, $7, $8)`,
        [
          storeId, productId, r.product_code, action,
          batchUuid, r.effective_date, opDisplay, r.created_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      if (stats.errors === 0) log(`  ! assortment first error: ${(err as Error).message}`);
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 11 · plan_position_mapping（先清 V015 seed 再导）
// ============================================================================
async function migratePlanPositions(): Promise<Stats> {
  const stats: Stats = { table: 'plan_position_mapping', read: 0, inserted: 0, skipped: 0, errors: 0 };
  // 清掉 V015 占位 seed
  await newDb.query(`DELETE FROM plan_position_mapping WHERE position_code BETWEEN 0 AND 4`);
  const { rows } = await oldDb.query<any>(
    `SELECT id, position_code, position_name, category_name FROM plan_position_mapping`,
  );
  stats.read = rows.length;
  // 幂等：先查是否已存在
  for (const r of rows) {
    try {
      const existing = await newDb.query(
        `SELECT id FROM plan_position_mapping WHERE position_code = $1 AND category_name = $2 LIMIT 1`,
        [r.position_code, r.category_name],
      );
      if (existing.rows.length > 0) {
        stats.skipped++;
        continue;
      }
      // 不传 id（老 id 不是 UUID），让 DB 生成
      const result = await newDb.query(
        `INSERT INTO plan_position_mapping (position_code, position_name, category_name, is_active)
         VALUES ($1, $2, $3, TRUE)`,
        [r.position_code, r.position_name, r.category_name],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      if (stats.errors === 0) log(`  ! plan_position first error: ${(err as Error).message}`);
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 12 · store_shelf_config
// ============================================================================
async function migrateShelfConfigs(): Promise<Stats> {
  const stats: Stats = { table: 'store_shelf_config', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT id, store_id, shelf_id, group_name, group_sort, shelf_type, shelf_width,
            categories, sort_order, shelf_layers, display_label, created_at
       FROM store_shelf_config`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    const storeId = storeMap.get(r.store_id);
    if (!storeId) {
      stats.skipped++;
      continue;
    }
    try {
      const cats = Array.isArray(r.categories)
        ? r.categories
        : typeof r.categories === 'string'
          ? [r.categories]
          : r.categories ?? [];
      // 老库 shelf_width 是 "90cm" 这种文本 → 解析出数字
      let widthCm: number | null = null;
      if (r.shelf_width != null) {
        const m = String(r.shelf_width).match(/[\d.]+/);
        widthCm = m ? parseFloat(m[0]) : null;
      }
      const result = await newDb.query(
        `INSERT INTO store_shelf_config (
            id, store_id, shelf_code, position_code, group_name,
            width_cm, layer_count, supported_categories, display_order, notes,
            attributes, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO NOTHING`,
        [
          r.id, storeId, r.shelf_id, r.group_sort ?? 0, r.group_name,
          widthCm, r.shelf_layers, cats, r.sort_order ?? 0, r.display_label,
          { shelf_type: r.shelf_type, original_shelf_width: r.shelf_width },
          r.created_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
      log(`  ! shelf_config ${r.id}: ${(err as Error).message}`);
    }
  }
  return stats;
}

// ============================================================================
// 阶段 13 · shelf_runtime_state（部分字段在新 schema 没有，进 attributes）
// ============================================================================
async function migrateShelfRuntime(): Promise<Stats> {
  const stats: Stats = { table: 'shelf_runtime_state', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  // 新 shelf_runtime_state.shelf_id 是 UUID FK 到 store_shelf_config.id
  // 老 shelf_id 是文本（"A05"），需要反查
  const shelfMap = new Map<string, string>();
  const { rows: configs } = await newDb.query<any>(
    `SELECT id, store_id, shelf_code FROM store_shelf_config WHERE deleted_at IS NULL`,
  );
  for (const c of configs) shelfMap.set(`${c.store_id}|${c.shelf_code}`, c.id);

  const { rows } = await oldDb.query<any>(
    `SELECT id, store_id, shelf_id, reset_version, photo_url, aligned_products, aligned_sub_categories,
            diagnosis_data, strategies, virtual_shelf_layout, virtual_shelf_status, virtual_shelf_error,
            virtual_shelf_raw_outputs, virtual_shelf_context, virtual_shelf_started_at,
            created_at, updated_at
       FROM shelf_runtime_state`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    const storeId = storeMap.get(r.store_id);
    if (!storeId) {
      stats.skipped++;
      continue;
    }
    const shelfUuid = shelfMap.get(`${storeId}|${r.shelf_id}`);
    if (!shelfUuid) {
      stats.skipped++;
      continue;
    }
    try {
      const vsMap: Record<string, string> = {
        idle: 'idle', processing: 'running', completed: 'succeeded', failed: 'failed',
      };
      const virtualStatus = vsMap[r.virtual_shelf_status ?? 'idle'] ?? 'idle';
      // 老库 JSONB 字段可能是奇怪格式（字符串/对象），强制 JSON.stringify
      const safeJson = (v: any, def: any) => {
        if (v === null || v === undefined) return JSON.stringify(def);
        if (typeof v === 'string') {
          try { JSON.parse(v); return v; } catch { return JSON.stringify(def); }
        }
        return JSON.stringify(v);
      };
      const result = await newDb.query(
        `INSERT INTO shelf_runtime_state (
            id, store_id, shelf_id, status,
            current_skus, last_detect_result,
            virtual_status, virtual_last_output, virtual_last_run_at,
            updated_at
          ) VALUES ($1, $2, $3, 'confirmed', $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $9)
          ON CONFLICT (id) DO NOTHING`,
        [
          r.id, storeId, shelfUuid,
          safeJson(r.aligned_products, []),
          safeJson(r.diagnosis_data, {}),
          virtualStatus,
          safeJson(r.virtual_shelf_raw_outputs ?? r.virtual_shelf_layout, {}),
          r.virtual_shelf_started_at,
          r.updated_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
      log(`  ! shelf ${r.shelf_id}: ${(err as Error).message}`);
    }
  }
  return stats;
}

// ============================================================================
// 阶段 14 · shelf_survey（老库 JSONB 数组 → 新库每题一行）
// ============================================================================
async function migrateShelfSurveys(): Promise<Stats> {
  const stats: Stats = { table: 'shelf_survey_*', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  // shelf_id 反查
  const shelfMap = new Map<string, string>();
  const { rows: configs } = await newDb.query<any>(
    `SELECT id, store_id, shelf_code FROM store_shelf_config WHERE deleted_at IS NULL`,
  );
  for (const c of configs) shelfMap.set(`${c.store_id}|${c.shelf_code}`, c.id);

  // 问题：JSONB 数组展开为每题一行
  const q = await oldDb.query<any>(`SELECT id, store_id, shelf_id, questions, created_at FROM shelf_survey_questions`);
  for (const r of q.rows) {
    const storeId = storeMap.get(r.store_id);
    if (!storeId) {
      stats.skipped++;
      continue;
    }
    const shelfUuid = shelfMap.get(`${storeId}|${r.shelf_id}`);
    if (!shelfUuid) {
      stats.skipped++;
      continue;
    }
    const questions = Array.isArray(r.questions) ? r.questions : [];
    stats.read += questions.length;
    for (let i = 0; i < questions.length; i++) {
      const item = questions[i];
      let questionText: string;
      let questionKind: string = 'text';
      let options: any = [];
      if (typeof item === 'string') {
        questionText = item;
      } else if (typeof item === 'object' && item !== null) {
        questionText = item.question ?? item.text ?? item.title ?? JSON.stringify(item);
        questionKind = item.kind ?? item.type ?? 'text';
        options = item.options ?? [];
      } else {
        questionText = String(item);
      }
      try {
        const result = await newDb.query(
          `INSERT INTO shelf_survey_questions (
              shelf_id, store_id, question_no, question_text, question_kind, options, source, generated_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'legacy', $7)
            ON CONFLICT (shelf_id, question_no) DO NOTHING`,
          [shelfUuid, storeId, i + 1, questionText, questionKind, JSON.stringify(options ?? []), r.created_at],
        );
        result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
      } catch (err) {
        if (stats.errors === 0) log(`  ! shelf_survey first error: ${(err as Error).message}`);
        stats.errors++;
      }
    }
  }

  // 答案：跳过迁移
  // 原因：新 schema shelf_survey_answers.question_id 是 NOT NULL FK，
  // 老数据是松散 JSONB，无法逐题对应。问卷答案数据量小（11 行）、价值低，
  // 让店长在新系统里重新填即可。
  return stats;
}

// ============================================================================
// 阶段 15 · promo_groups
// ============================================================================
async function migratePromoGroups(): Promise<Stats> {
  const stats: Stats = { table: 'promo_groups', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const productMap = await loadMap(newDb, 'SELECT sku_code, id FROM dim_product', 'sku_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT id, group_id, sku_code, promo_content, promo_type, created_at FROM promo_groups`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const productId = productMap.get(r.sku_code) ?? null;
      const result = await newDb.query(
        `INSERT INTO promo_groups (
            id, group_code, sku_code, product_id, promo_text,
            scope, is_active, attributes, created_at
          ) VALUES ($1, $2, $3, $4, $5, 'all_stores', TRUE, $6, $7)
          ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.group_id, r.sku_code, productId, r.promo_content,
          { promo_type: r.promo_type },
          r.created_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 16 · sku_corrections
// ============================================================================
async function migrateSkuCorrections(): Promise<Stats> {
  const stats: Stats = { table: 'sku_corrections', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  const productMap = await loadMap(newDb, 'SELECT sku_code, id FROM dim_product', 'sku_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT id, store_id, shelf_id, account, sku_code, sku_name,
            correction_kind, reason_code, reason_text, created_at
       FROM sku_corrections`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    const storeId = storeMap.get(r.store_id);
    if (!storeId) {
      stats.skipped++;
      continue;
    }
    try {
      const productId = productMap.get(r.sku_code) ?? null;
      const validKinds = ['missed', 'false_positive'];
      const kind = validKinds.includes(r.correction_kind) ? r.correction_kind : 'missed';
      const validReasons = ['obstruction', 'low_resolution', 'new_sku', 'similar_packaging', 'other'];
      const reason = validReasons.includes(r.reason_code) ? r.reason_code : 'other';
      const result = await newDb.query(
        `INSERT INTO sku_corrections (
            id, store_id, shelf_id, product_id, sku_code,
            correction_kind, reason_code, reason_text,
            resolution_note, submitted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO NOTHING`,
        [
          r.id, storeId, r.shelf_id, productId, r.sku_code,
          kind, reason, r.reason_text,
          r.account ? `legacy account: ${r.account}` : null,
          r.created_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 17 · store_environment_insights
// ============================================================================
async function migrateStoreEnvironment(): Promise<Stats> {
  const stats: Stats = { table: 'store_environment_insights', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const storeMap = await loadMap(newDb, 'SELECT store_code, id FROM stores', 'store_code', 'id');
  const { rows } = await oldDb.query<any>(
    `SELECT id, store_id, poi_count, report_markdown, category,
            crowd_source_analysis, top_competitors, competitor_analysis, questions,
            created_at, updated_at
       FROM store_environment_insights`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    const storeId = storeMap.get(r.store_id);
    if (!storeId) {
      stats.skipped++;
      continue;
    }
    try {
      const insightData = {
        legacy_report_markdown: r.report_markdown,
        legacy_category: r.category,
        crowd_source_analysis: r.crowd_source_analysis,
        top_competitors: r.top_competitors,
        competitor_analysis: r.competitor_analysis,
        questions: r.questions,
      };
      const result = await newDb.query(
        `INSERT INTO store_environment_insights (
            id, store_id, competitor_count, insight_data,
            source, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'legacy', $5, $6)
          ON CONFLICT (id) DO NOTHING`,
        [r.id, storeId, r.poi_count, insightData, r.created_at, r.updated_at],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
      log(`  ! env ${r.store_id}: ${(err as Error).message}`);
    }
  }
  return stats;
}

// ============================================================================
// 阶段 18 · promotion_uploads
// ============================================================================
async function migratePromotionUploads(): Promise<Stats> {
  const stats: Stats = { table: 'promotion_uploads', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const { rows } = await oldDb.query<any>(
    `SELECT id, filename, uploaded_by, product_count, created_at, is_active FROM promotion_uploads`,
  );
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const result = await newDb.query(
        `INSERT INTO promotion_uploads (
            id, file_name, uploaded_by, product_count, is_active, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING`,
        [r.id, r.filename, r.uploaded_by, r.product_count ?? 0, r.is_active ?? false, r.created_at],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 19 · product_promotions
// ============================================================================
async function migrateProductPromotions(): Promise<Stats> {
  const stats: Stats = { table: 'product_promotions', read: 0, inserted: 0, skipped: 0, errors: 0 };
  // 按 upload 取，逐行赋递增 row_index（满足 UNIQUE upload_id+row_index）
  const { rows } = await oldDb.query<any>(`SELECT * FROM product_promotions ORDER BY upload_id, created_at, id`);
  stats.read = rows.length;
  const rowIndexByUpload = new Map<string, number>();
  for (const r of rows) {
    try {
      const idx = (rowIndexByUpload.get(r.upload_id) ?? 0) + 1;
      rowIndexByUpload.set(r.upload_id, idx);
      // valid_dates 是 DATE[] 类型，all_options 是 JSONB
      const validDates: any = Array.isArray(r.best_valid_dates) ? r.best_valid_dates : null;
      const allOptions = Array.isArray(r.all_options) ? r.all_options : (r.all_options ? [r.all_options] : []);
      const result = await newDb.query(
        `INSERT INTO product_promotions (
            id, upload_id, row_index, sku_code, product_name, unit, original_price,
            category_name, best_label, best_required_qty, best_total_price,
            best_effective_unit_price, best_saving_percent,
            all_options, valid_from, valid_to, valid_dates,
            mix_group_code, display_text, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19, $20)
          ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.upload_id, idx,
          r.sku, r.product_name, r.unit, r.original_price,
          r.category, r.best_label, r.best_qty, r.best_total,
          r.best_effective_price, r.best_saving_percent,
          JSON.stringify(allOptions), r.best_valid_from, r.best_valid_to, validDates,
          r.promo_group_code, r.display_text, r.created_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      if (stats.errors === 0) log(`  ! product_promotions first error: ${(err as Error).message}`);
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 阶段 20 · promotion_groups
// ============================================================================
async function migratePromotionGroups(): Promise<Stats> {
  const stats: Stats = { table: 'promotion_groups', read: 0, inserted: 0, skipped: 0, errors: 0 };
  const { rows } = await oldDb.query<any>(`SELECT * FROM promotion_groups`);
  stats.read = rows.length;
  for (const r of rows) {
    try {
      const skuCodes = Array.isArray(r.member_skus) ? r.member_skus : [];
      const result = await newDb.query(
        `INSERT INTO promotion_groups (
            id, upload_id, mix_group_code, display_name, category_name,
            sku_codes, product_count, best_label, best_total_price, best_saving_percent,
            attributes, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.upload_id, r.group_key, r.brand_label, r.category,
          skuCodes, skuCodes.length, r.best_label, r.best_total, r.best_saving_percent,
          {
            unit: r.unit, original_price: r.original_price,
            best_qty: r.best_qty, best_effective_price: r.best_effective_price,
            display_text: r.display_text,
            best_valid_from: r.best_valid_from, best_valid_to: r.best_valid_to,
            best_valid_dates: r.best_valid_dates, best_applies_to_skus: r.best_applies_to_skus,
          },
          r.created_at,
        ],
      );
      result.rowCount && result.rowCount > 0 ? stats.inserted++ : stats.skipped++;
    } catch (err) {
      stats.errors++;
    }
  }
  return stats;
}

// ============================================================================
// 主流程
// ============================================================================
async function main() {
  log('开始迁移老库业务数据到新库');
  log(`  老库: ${OLD_URL}`);
  log(`  新库: ${NEW_URL}`);
  log('');

  const phases = [
    migrateAppSettings,
    migrateDimCategory,
    migrateDimProduct,
    migrateBenchmarkSkus,
    migrateCompetitorChannels,
    migrateCompetitorProducts,
    migrateCompetitorPrices,
    migrateStores,
    migrateUsers,
    migrateStoreSkuFacts,
    migratePriceChanges,
    migrateAssortmentChanges,
    migratePlanPositions,
    migrateShelfConfigs,
    migrateShelfRuntime,
    migrateShelfSurveys,
    migratePromoGroups,
    migrateSkuCorrections,
    migrateStoreEnvironment,
    migratePromotionUploads,
    migrateProductPromotions,
    migratePromotionGroups,
  ];

  const allStats: Stats[] = [];
  for (const phase of phases) {
    const before = Date.now();
    let stats: Stats;
    try {
      stats = await phase();
    } catch (err) {
      stats = { table: phase.name, read: 0, inserted: 0, skipped: 0, errors: 1 };
      log(`✗ ${phase.name} 整体失败: ${(err as Error).message}`);
    }
    const ms = Date.now() - before;
    log(
      `${stats.table.padEnd(35)} read=${String(stats.read).padStart(5)} new=${String(stats.inserted).padStart(5)} dup=${String(stats.skipped).padStart(5)} err=${String(stats.errors).padStart(3)}  (${ms}ms)`,
    );
    allStats.push(stats);
  }

  log('');
  log('迁移完成。汇总：');
  log(`  阶段数: ${allStats.length}`);
  log(`  共读取 ${allStats.reduce((a, s) => a + s.read, 0)} 行`);
  log(`  共新增 ${allStats.reduce((a, s) => a + s.inserted, 0)} 行`);
  log(`  跳过 ${allStats.reduce((a, s) => a + s.skipped, 0)} 行（已存在或源缺数据）`);
  log(`  报错 ${allStats.reduce((a, s) => a + s.errors, 0)} 行`);

  await oldDb.end();
  await newDb.end();
}

main().catch((err) => {
  console.error('迁移失败：', err);
  process.exit(1);
});
