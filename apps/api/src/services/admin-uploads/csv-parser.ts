/**
 * 简单 CSV 解析器(够用即可,不引第三方依赖)
 *
 * 支持:
 *   - BOM(UTF-8 BOM,Excel 中文 CSV 默认带)
 *   - CRLF / LF 换行
 *   - 双引号包围 + 内部双引号转义("aa""bb" → aa"bb)
 *   - 字段内逗号(必须在双引号内)
 *
 * 不支持(YAGNI):
 *   - 自定义分隔符(总是逗号)
 *   - 跨行字段(双引号内的换行)— 实际业务 CSV 没人这么写
 *
 * 返回值是 string[][](外层是行,内层是单元格 string),
 * 不做类型转换,留给 validators。
 */
export function parseCsv(text: string): string[][] {
  // 去 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  // 统一换行
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // 转义的双引号
          field += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      // 跳过完全空行(全是逗号也算空,过滤)
      if (row.length > 0 && row.some((c) => c.trim() !== '')) {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  // 收尾(末尾没换行)
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}
