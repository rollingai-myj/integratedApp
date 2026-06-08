/**
 * 飞书身份解析单元测试
 *
 * 用真实样本验证：
 *   - 用户给的店长样本（"场景运营" + "粤28125"，无 Rolling Digital）
 *   - 用户给的管理员样本（路径含 "Rolling Digital"）
 *   - 边界：空数组 / 缺字段 / 重复叶子名 / 大小写边界
 */
import { describe, expect, it } from 'vitest';
import type { FeishuDeptPathItem } from './feishu.service.js';
import { parseFeishuIdentity } from './feishu-identity.service.js';

describe('parseFeishuIdentity', () => {
  it('真实店长样本：identifies leaf candidates, not super_admin', () => {
    // 来自用户 2026-06-08 给的真实店长响应
    const deptPath: FeishuDeptPathItem[] = [
      {
        department_id: 'od-4de6db2aa1aeba7ed52170dd826f93c1',
        department_name: { name: '场景运营' },
        department_path: {
          department_ids: [
            'od-33b2f7058d8033f88dd1a0da9830a38a',
            'od-d8a277988369c9dd7dd425048e30103e',
            'od-4de6db2aa1aeba7ed52170dd826f93c1',
          ],
          department_path_name: {
            name: '门店经营中心-场景运营部-场景运营',
          },
        },
      },
      {
        department_id: 'od-72a67059407afaeb1c59e88a6247f121',
        department_name: { name: '粤28125' },
        department_path: {
          department_ids: [],
          department_path_name: { name: '' },
        },
      },
    ];

    const result = parseFeishuIdentity(deptPath);
    expect(result.isSuperAdmin).toBe(false);
    expect(result.leafCandidates).toEqual(['场景运营', '粤28125']);
    expect(result.debugTrace).toHaveLength(2);
  });

  it('管理员样本：path 含 "Rolling Digital" → isSuperAdmin true', () => {
    const deptPath: FeishuDeptPathItem[] = [
      {
        department_id: 'od-xxx',
        department_name: { name: '数字化中心' },
        department_path: {
          department_path_name: {
            name: 'Rolling Digital-总部-数字化中心',
          },
        },
      },
    ];

    const result = parseFeishuIdentity(deptPath);
    expect(result.isSuperAdmin).toBe(true);
    expect(result.leafCandidates).toEqual(['数字化中心']);
  });

  it('叶子名本身就是 "Rolling Digital ..." → 也算超管', () => {
    const deptPath: FeishuDeptPathItem[] = [
      {
        department_id: 'od-xxx',
        department_name: { name: 'Rolling Digital 总部' },
        department_path: { department_path_name: { name: '' } },
      },
    ];

    const result = parseFeishuIdentity(deptPath);
    expect(result.isSuperAdmin).toBe(true);
  });

  it('空数组 → 不是超管，无候选', () => {
    expect(parseFeishuIdentity([])).toMatchObject({
      isSuperAdmin: false,
      leafCandidates: [],
    });
    expect(parseFeishuIdentity(null)).toMatchObject({
      isSuperAdmin: false,
      leafCandidates: [],
    });
    expect(parseFeishuIdentity(undefined)).toMatchObject({
      isSuperAdmin: false,
      leafCandidates: [],
    });
  });

  it('叶子重复（用户在同一店两个职能下） → 去重', () => {
    const deptPath: FeishuDeptPathItem[] = [
      {
        department_id: 'a',
        department_name: { name: '粤32826' },
        department_path: { department_path_name: { name: 'A-粤32826' } },
      },
      {
        department_id: 'b',
        department_name: { name: '粤32826' },
        department_path: { department_path_name: { name: 'B-粤32826' } },
      },
    ];
    expect(parseFeishuIdentity(deptPath).leafCandidates).toEqual(['粤32826']);
  });

  it('容错：缺 department_name / department_path 字段', () => {
    const deptPath = [
      { department_id: 'a' }, // 完全没字段
      { department_id: 'b', department_name: { name: '' } }, // 空名
      {
        department_id: 'c',
        department_name: { name: 'store_a' },
        // 缺 department_path
      },
    ] as unknown as FeishuDeptPathItem[];

    const result = parseFeishuIdentity(deptPath);
    expect(result.isSuperAdmin).toBe(false);
    expect(result.leafCandidates).toEqual(['store_a']);
  });

  it('Rolling Digital 大小写敏感（按规则原文匹配，不做大小写归一）', () => {
    const deptPath: FeishuDeptPathItem[] = [
      {
        department_id: 'a',
        department_name: { name: 'foo' },
        department_path: { department_path_name: { name: 'rolling digital-X' } },
      },
    ];
    // "Rolling Digital" 严格大小写，"rolling digital" 不算
    expect(parseFeishuIdentity(deptPath).isSuperAdmin).toBe(false);
  });
});
