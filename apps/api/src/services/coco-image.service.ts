/**
 * Corelays · Gemini 原生 generateContent 服务(海报生图)
 *
 * 设计:
 *   - 走 Gemini 原生协议:`${COCO_BASE_URL}/models/${model}:generateContent`
 *     这个 Corelays 订阅的 token 不放行 OpenAI Images API(/images/* 一律 404),
 *     只能走原生 Gemini contents/generateContent
 *   - 模型从 sys_settings.poster_image_model 读取(默认 gemini-3.1-flash-image)
 *   - 参考图统一作为 inlineData parts 塞进同一个 user content:
 *     · 无参考图 → 单 part `{text: prompt}`
 *     · 有参考图 → `{text: prompt}` + 多个 `{inlineData: {mimeType, data}}`
 *     软失败:能拉到几张用几张,全军覆没则只发 prompt
 *   - 响应:candidates[0].content.parts[] 找 inlineData 取 base64,
 *     按 mimeType 包成 data URL 交给 posters.service.ts 转存 OSS
 *   - 失败 → 502 UPSTREAM_ERROR;未配置 key → 502 友好提示
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { query } from '../db/index.js';

export interface PosterGenerateInput {
  template: 'vibrant' | 'premium' | 'minimal' | 'custom';
  mode: 'photo_compose' | 'official_bg_only' | 'multi_product';
  copyText: string;
  sourcePhotoUrl?: string;
  productImageUrl?: string;
  productImageUrls?: string[];
  customStyleDescription?: string;
  skuCode?: string;
  categoryName?: string;
  /** 活动 raw 枚举,挑右下角二维码用 */
  baseActivityType?: string;
  addonActivityType?: string;
}

export interface PosterGenerateOutput {
  posterUrl: string;
  thumbnailUrl?: string;
  modelUsed: string;
  promptUsed: string;
  generationMs: number;
}

// ============================================================================
// 风格描述(原版 STYLE_DESCRIPTIONS,详细版式 / 配色 / 字体指令)
// ============================================================================
const STYLE_DESCRIPTIONS: Record<'vibrant' | 'premium' | 'minimal', string> = {
  vibrant:
    "活力风格 / vibrant retail flash-sale poster: oversized 3D extruded red & gold price numbers with thick yellow stroke, comic-book burst (爆炸贴) shapes, lightning bolts, lots of yellow & red accents, very high energy, 'limited time grab' (限时抢购) badge, bottom red ribbon banner with yellow chevrons. Background subtly shows the original store scene.",
  premium:
    '高端风格 / premium upscale poster: elegant cream / off-white panels with thin gold ornamental frames and flourishes (欧式花纹), refined serif Chinese typography centered, lots of breathing room, subtle drop shadows, original-price strikethrough in thin small type. Sophisticated, understated, magazine-grade.',
  minimal:
    '简约风格 / minimal bold poster: very large bold black sans-serif Chinese price numbers with red outline stroke (描边字), one solid orange circular badge for the discount label, mostly the original photo as the background, generous whitespace. Minimalist, punchy, high-contrast.\n不要添加任何额外的页脚文字、标语、说明文字或装饰文字。\n如果文案中包含『限时优惠』四个字,必须用统一固定样式呈现:黑色加粗无衬线字体,配橙红色描边或下方短横线点缀,位置在主价格上方或画面右上角;这四个字必须原样、完整、无错字、无变形、无替换。',
};

interface InlinePart {
  mimeType: string;
  /** raw base64,不带 data: 前缀 */
  data: string;
}

// ============================================================================
// 风格参考图(本地文件,跟前端 style-refs 同一份)
//
// 文件来源:apps/web/public/style-refs/{vibrant,premium,minimal}.webp
//   - 前端选风格时拿来当缩略图
//   - 后端把同一份文件读出 base64,作为最后一张图传给 Gemini
//
// 加载策略:
//   1) dev: docker-compose 把 apps/web/public/style-refs 挂载到容器
//      /app/apps/api/style-refs(只读)
//   2) prod: apps/api/Dockerfile 把该目录 COPY 进 runtime image
//
// 容器内的相对路径 style-refs/{tmpl}.webp(基于 cwd=/app/apps/api)。
// 文件不存在 → getStyleRefPath 返回 null,prompt 自动退化到无参考图模式。
// ============================================================================
const STYLE_REF_DIR = path.resolve(process.cwd(), 'style-refs');

function getStyleRefPath(
  template: PosterGenerateInput['template'],
): string | null {
  if (template === 'custom') return null;
  const p = path.join(STYLE_REF_DIR, `${template}.webp`);
  return existsSync(p) ? p : null;
}

function readStyleRefAsInline(
  template: PosterGenerateInput['template'],
): InlinePart | null {
  const p = getStyleRefPath(template);
  if (!p) return null;
  try {
    const buf = readFileSync(p);
    return { mimeType: 'image/webp', data: buf.toString('base64') };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, path: p },
      'style ref read failed, falling back to text-only style guidance',
    );
    return null;
  }
}

/** 风格段 —— 插到主模板的"风格说明"位置 */
function buildStyleSegment(input: PosterGenerateInput): string {
  if (input.template === 'custom') {
    const custom =
      input.customStyleDescription?.trim() || '干净、简洁、突出商品和优惠';
    return `用户自定义风格描述:${custom}。\n仅参考此文字描述的版式、配色、字体与文字风格,不引入其他商品或场景元素。`;
  }
  const desc = STYLE_DESCRIPTIONS[input.template];
  if (getStyleRefPath(input.template)) {
    return `参考风格说明:${desc}。最后一张图是【风格参考图】,仅用于参考其版式、配色、字体、文案排版方式与装饰元素风格,绝对不要把参考图里的任何商品、人物、物体、场景搬到最终海报中。`;
  }
  // 风格参考图文件缺失 → 退化成纯文字风格指导
  return `参考风格说明:${desc}。仅按以上文字描述的版式、配色、字体与装饰风格生成,不要引入其他商品或场景元素。`;
}

// ============================================================================
// Mode A · photo_compose(用户上传实拍照,单图模式)
// ============================================================================
function buildModeAPrompt(
  input: PosterGenerateInput,
  styleSegment: string,
): string {
  return `你是一位经验非常丰富的中国便利店促销海报设计师,专门为美宜佳便利店店主设计用于发到微信群的促销海报。
这张海报最终会通过微信群发给美宜佳便利店的顾客,目的是吸引顾客到店购买,所以视觉上必须有明确的促销感、足够吸睛,让顾客一眼就能看出是在搞特价。
请基于第一张图(用户在自己店里拍摄的实拍照片,包含真实商品和店内环境)生成一张促销海报。输出图片的宽高比例必须与第一张图保持完全一致,不要裁切、不要拉伸、不要改成其他比例。
硬性要求(不可违反):
1. 海报中的商品必须与第一张图中的商品完全一致——同一件实物、同一个包装、同一个品牌、同一个角度、同一个位置;不允许替换、不允许换包装、不允许换成参考图里的商品、不允许凭空生成新商品。
2. 背景必须沿用第一张图原本的店内/台面/货架场景,保持原有构图与物体位置不变;只允许做轻度光线美化(提亮曝光、柔化阴影、轻微加柔光、轻度调色),不允许替换背景、不允许添加虚构场景或虚构物体。
3. ${styleSegment}
4. 排版处理原则:参考图的排版(构图、文字位置、装饰元素布局、字体风格、配色比例)能不改就尽量不改,保持参考图原本的设计语言;但允许根据第一张实拍照片的实际构图、商品位置、留白区域,做适度的局部调整,让文字和装饰元素与真实商品及背景自然融合,达到整体和谐的效果。
5. 海报上需要清晰呈现以下中文促销文案,文字必须清晰、无错别字、无多余英文乱码、排版美观:
"""
${input.copyText}
"""
6. 价格处理重点:如果上面的文案中出现了"原价xxx"、"原价 xx 元"或类似表述,必须用一条明显的斜线(删除线)把原价数字划掉,并把现价/促销价用更大、更醒目的字体放在原价旁边,让顾客一眼就能看出现在是特价促销且促销力度很大。删除线要清晰可见,不能太细太淡。
7. 整体为简体中文海报,符合美宜佳便利店店主发微信群使用的场景,必须有强烈的促销氛围和到店购买的吸引力。
8. 风格参考图防泄漏(强制):风格参考图仅作版式/字体/配色/装饰风格灵感,绝对禁止把参考图中出现的任何商品包装、商品形状、商品文字、Logo、人物、图标搬进最终海报;最终海报中出现的商品只能是第一张图里的商品。
9. 海报上的所有文字必须严格来自上面给定的促销文案,禁止模型自行补充任何额外的中英文标语、店铺名、口号、说明文字或页脚。【逐字一致】文案中的每一个汉字、数字、标点必须与给定文案完全一致,禁止改写、替换为同义词、繁体字、异体字、艺术变形字或拆分重组;如出现『限时优惠』『限时特价』『原价』『现价』『会员价』等关键词,必须原文原字呈现,绝对不允许变成『超值钜惠』『火爆抢购』等任何近义表达。
10. 输出单张海报图片,宽高比例与第一张图完全一致,不要加任何水印、二维码或外框。`;
}

// ============================================================================
// Mode B · official_bg_only(店内空背景 + 商品官方图合成)
// ============================================================================
function buildModeBPrompt(
  input: PosterGenerateInput,
  styleSegment: string,
): string {
  return `你是一位经验非常丰富的中国便利店促销海报设计师,专门为美宜佳便利店店主设计用于发到微信群的促销海报。
这张海报会通过微信群发给顾客,目的是吸引顾客到店购买,必须有明确的促销感、足够吸睛。
请基于以下素材生成一张促销海报:
- 第一张图:店长在自己店里拍的实拍背景(含收银台/桌面/货架等)。输出海报必须沿用这张图的背景、构图、光照氛围,宽高比例与第一张图完全一致。
- 第二张图:商品的官方包装图(透明背景或白底),仅用于确认包装外观。输出海报中的商品必须与第二张图完全一致——同一品牌、同一包装、同一 SKU,不允许换包装、不允许凭空生成其他商品。

【关键合成思路】请分两步在脑中完成,再输出最终图:
第一步:先合成一张"商品真的被摆在第一张图的台面/收银台上"的实拍照片。要求达到照片级真实,不是贴图、不是抠图拼贴。
第二步:在这张合成实拍照上叠加促销文字与装饰元素,形成最终海报。

【物理真实感硬性要求 — 必须全部满足,不可违反】
1. 接触阴影(contact shadow):商品底部必须与台面有清晰、柔和、方向正确的接触阴影,绝对不允许商品悬浮在空中或像贴纸一样浮在画面上。阴影要紧贴商品底部边缘,越靠近商品越深,向外柔化扩散。
2. 透视一致:商品的视角(俯仰角、左右旋转、消失点)必须严格匹配第一张图台面的透视。如果第一张图是俯视台面,商品就必须以同样的俯视角呈现;如果是平视,商品就必须平视。绝对不允许商品是正面平视而桌面是俯视这种透视错位。
3. 光照一致:仔细分析第一张图的主光源方向(从左/右/上方/前方)、强度和色温(暖黄灯、冷白灯、自然光等)。商品的高光面、暗面、投影方向必须与之完全一致,并叠加相同色温的环境光(例如店内是暖黄灯,商品表面要带暖黄色调,而不是冷白)。
4. 比例合理:商品大小要符合真实物理尺寸——参考第一张图里桌面宽度、旁边物体(收银机、烟柜、零食架)作为比例尺。一瓶饮料就该是一瓶饮料的大小,不要把小包装放大到占满整个台面,也不要小到看不清。
5. 边缘融合:商品边缘必须自然融入背景,不能保留白底、不能有硬切边、不能有 PNG 抠图常见的锯齿或彩边。必要时在商品边缘做轻微的环境光反射。
6. 摆放位置:商品放在台面前景的视觉中心或偏中位置,底部稳稳坐在台面上,可以略微靠前以突出主体;不允许漂浮、不允许穿模穿过台面、不允许半个商品被台面遮住一半还浮在空中。
7. 多件或单件:默认摆放 1 件商品;如果文案明显是组合装/多件促销,可以并排摆放 2–3 件,但每一件都要满足以上 1–6 条。

【背景与场景】
8. 背景必须保留第一张图的店内环境(货架、收银台、墙面、灯光),不允许替换背景、不允许添加虚构场景或物体。如果第一张图整体偏暗,可适度提亮曝光、柔化阴影,但不要改变店内陈设。

【海报版式与文案】
9. ${styleSegment}
10. 排版:参考风格图的构图、字体、配色、装饰元素,但根据商品实际位置和背景留白做局部调整,让文字与商品、背景自然融合,不要遮挡商品主体。
11. 海报上需要清晰呈现以下中文促销文案,文字必须清晰、无错别字、无多余英文乱码、排版美观:
"""
${input.copyText}
"""
12. 价格处理重点:如果文案中出现"原价xxx"或类似表述,必须用明显的删除线划掉原价数字,并把现价/促销价用更大、更醒目的字体放在原价旁边。
13. 整体为简体中文海报,符合美宜佳便利店店主发微信群的场景,必须有强烈的促销氛围。
14. 风格参考图防泄漏(强制):风格参考图仅作版式/字体/配色/装饰风格灵感,绝对禁止把参考图中出现的任何商品包装、商品形状、商品文字、Logo、人物、图标搬进最终海报;最终海报中出现的商品只能是第一张和第二张图里的商品。
15. 海报上的所有文字必须严格来自上面给定的促销文案,禁止模型自行补充任何额外的中英文标语、店铺名、口号、说明文字或页脚。【逐字一致】文案中的每一个汉字、数字、标点必须与给定文案完全一致,禁止改写、替换为同义词、繁体字、异体字、艺术变形字或拆分重组;如出现『限时优惠』『限时特价』『原价』『现价』『会员价』等关键词,必须原文原字呈现,绝对不允许变成『超值钜惠』『火爆抢购』等任何近义表达。
16. 输出单张海报,宽高比例与第一张图完全一致,不要加水印、二维码或外框。`;
}

// ============================================================================
// Mode C · multi_product(店内背景 + N 张商品官方图,组合促销海报)
//
// 跟 Mode B 的物理真实感 / 防泄漏 / 删除线 / 逐字一致同套,但所有「商品」相关
// 表述都改成多件并存的语义:
//   - 第一张图是背景,第二张及之后才是 N 张商品图
//   - 7 条物理真实感对每一件商品分别成立
//   - "完整呈现所有商品"作为单独硬约束,防止 AI 偷工只画一两件
// ============================================================================
function buildModeCPrompt(
  input: PosterGenerateInput,
  styleSegment: string,
): string {
  const productCount =
    (input.productImageUrl ? 1 : 0) + (input.productImageUrls?.length ?? 0);
  const N = productCount > 0 ? productCount : '若干';
  const styleRefSuffix = getStyleRefPath(input.template)
    ? '(末尾的【风格参考图】不算商品,仅供版式参考)'
    : '';

  return `你是一位经验非常丰富的中国便利店促销海报设计师,专门为美宜佳便利店店主设计用于发到微信群的促销海报。
这张海报会通过微信群发给顾客,目的是吸引顾客到店购买,必须有明确的【组合促销】感、足够吸睛,让顾客一眼看出"几件一起买更划算"。
请基于以下素材生成一张组合促销海报:
- 第一张图:店长在自己店里拍的实拍背景(含收银台/桌面/货架等)。输出海报必须沿用这张图的背景、构图、光照氛围,宽高比例与第一张图完全一致。
- 之后的 ${N} 张图${styleRefSuffix}:本次组合促销涉及的 ${N} 件商品的官方包装图(透明背景或白底),每张对应一件参与组合的 SKU。海报中出现的商品必须与这些图完全一致——同一品牌、同一包装、同一 SKU,不允许换包装、不允许凭空生成其他商品、不允许只挑选其中一件而把其余忽略。

【关键合成思路】请分两步在脑中完成,再输出最终图:
第一步:先合成一张"这 ${N} 件商品真的并排被摆在第一张图的台面/收银台上"的实拍照片。要求达到照片级真实,不是贴图、不是抠图拼贴。每一件商品都要按下面 7 条物理真实感约束处理。
第二步:在这张合成实拍照上叠加促销文字与装饰元素,形成最终海报。

【物理真实感硬性要求 — 对每一件商品都必须满足,不可违反】
1. 接触阴影(contact shadow):每件商品底部都必须与台面有清晰、柔和、方向正确的接触阴影,绝对不允许悬浮在空中或像贴纸一样浮在画面上。阴影紧贴商品底部边缘,越近越深,向外柔化扩散。
2. 透视一致:所有商品的视角(俯仰角、左右旋转、消失点)必须严格匹配第一张图台面的透视,且彼此之间也保持一致透视——不允许一件正面平视,另一件却 3/4 侧视。
3. 光照一致:仔细分析第一张图的主光源方向(从左/右/上方/前方)、强度和色温(暖黄灯、冷白灯、自然光等)。所有商品的高光面、暗面、投影方向必须与之完全统一,色温也保持一致(店内是暖黄灯则商品表面带暖黄色调,而不是冷白)。
4. 比例合理:商品大小符合真实物理尺寸——以第一张图里桌面宽度、旁边物体(收银机/烟柜/零食架)作为比例尺;多件商品之间也要按真实尺寸比例摆放,不允许一件占满台面而另一件只剩拇指大,也不允许把瓶装饮料放大到比包装盒还大几倍。
5. 边缘融合:每件商品边缘必须自然融入背景,不能保留白底、不能有硬切边、不能有 PNG 抠图常见的锯齿或彩边。必要时在商品边缘做轻微的环境光反射。
6. 摆放位置:并排或前后错落地摆在台面前景的视觉中心区域,底部稳稳坐在台面上,允许略微前后错开层次以体现"组合搭配感";不允许漂浮、不允许穿模穿过台面、不允许半个商品被台面或别的商品遮住一半还浮在空中。
7. 完整呈现所有商品:必须把所有 ${N} 件商品图中的每一件都摆到海报上,**缺一不可**。如果商品数量多到台面摆不下,可以略微缩小整体或调整摆位以容纳,但绝对不允许省略、合并、替换任何一件;也不允许同一件商品重复出现假装是另一件。

【背景与场景】
8. 背景必须保留第一张图的店内环境(货架、收银台、墙面、灯光),不允许替换背景、不允许添加虚构场景或物体。如果第一张图整体偏暗,可适度提亮曝光、柔化阴影,但不要改变店内陈设。

【海报版式与文案】
9. ${styleSegment}
10. 排版:参考风格图的构图、字体、配色、装饰元素,但根据多件商品的实际位置和背景留白做局部调整,让文字与所有商品、背景自然融合,不要遮挡任何一件商品的主体。
11. 海报上需要清晰呈现以下中文促销文案,文字必须清晰、无错别字、无多余英文乱码、排版美观:
"""
${input.copyText}
"""
12. 价格处理重点:如果文案中出现"原价xxx"或类似表述,必须用一条明显的斜线(删除线)把原价数字划掉,并把现价/促销价用更大、更醒目的字体放在原价旁边。组合促销文案中常见的"满 X 减 Y"、"X 件起售"、"相当于¥xx"等关键表述,也必须用醒目字号呈现,让顾客一眼看出"组合更划算"的力度。
13. 整体为简体中文海报,符合美宜佳便利店店主发微信群的场景,必须有强烈的促销氛围和"组合搭配 / 一次买齐"的视觉表达。
14. 风格参考图防泄漏(强制):风格参考图仅作版式/字体/配色/装饰风格灵感,绝对禁止把参考图中出现的任何商品包装、商品形状、商品文字、Logo、人物、图标搬进最终海报;最终海报中出现的商品只能是第二张及之后那 ${N} 张商品官方图里的商品。
15. 海报上的所有文字必须严格来自上面给定的促销文案,禁止模型自行补充任何额外的中英文标语、店铺名、口号、说明文字或页脚。【逐字一致】文案中的每一个汉字、数字、标点必须与给定文案完全一致,禁止改写、替换为同义词、繁体字、异体字、艺术变形字或拆分重组;如出现『限时优惠』『限时特价』『原价』『现价』『会员价』『满 X 减 Y』『相当于』『到店领券』等关键词,必须原文原字呈现,绝对不允许变成『超值钜惠』『火爆抢购』等任何近义表达。
16. 输出单张海报,宽高比例与第一张图完全一致,不要加水印、二维码或外框。`;
}

/**
 * 主入口:按 mode 分支拼 prompt。
 *   - photo_compose    → Mode A(用户实拍照,商品已在第一张图里)
 *   - official_bg_only → Mode B(店内背景 + 单张商品官方图合成)
 *   - multi_product    → Mode C(店内背景 + N 张商品官方图,组合促销)
 */
export function buildPosterPrompt(input: PosterGenerateInput): string {
  const styleSegment = buildStyleSegment(input);
  if (input.mode === 'official_bg_only') {
    return buildModeBPrompt(input, styleSegment);
  }
  if (input.mode === 'multi_product') {
    return buildModeCPrompt(input, styleSegment);
  }
  return buildModeAPrompt(input, styleSegment);
}

// 与 admin-stats.service 同源(同 key + 同默认);切模型从 PUT /admin/settings/image-model 走。
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';

async function getCurrentImageModel(): Promise<string> {
  const res = await query<{ value: string }>(
    `SELECT value FROM sys_settings WHERE key = 'poster_image_model' LIMIT 1`,
  );
  return res.rows[0]?.value ?? DEFAULT_IMAGE_MODEL;
}

/**
 * 收集所有要喂给 Gemini 的参考图。
 *
 * 旧版只按 mode 二选一:multi_product 只挑 productImageUrls,official_bg_only
 * 只挑 productImageUrl —— 把用户上传的 sourcePhotoUrl(门店背景照)直接丢了,
 * 海报背景全靠 prompt 文字瞎编。
 *
 * 现在三种模式都把可用的图全收上来。顺序约定:**sourcePhotoUrl(底图)放前面**,
 * 后面是商品图;Gemini 多模态输入按出现顺序参考,底图先到模型脑子里更可能被当
 * 背景看待。mode 仍然影响 prompt 文字(由 buildPosterPrompt 处理)。
 */
function collectReferenceImageUrls(input: PosterGenerateInput): string[] {
  const urls: string[] = [];
  if (input.sourcePhotoUrl) urls.push(input.sourcePhotoUrl);
  if (input.productImageUrl) urls.push(input.productImageUrl);
  if (input.productImageUrls?.length) {
    urls.push(...input.productImageUrls.filter(Boolean));
  }
  // 风格参考图不在这里追加 —— 它来自本地磁盘,由 readStyleRefAsInline 直接做成
  // InlinePart 拼到 inlineParts 末尾。这样既避免走 HTTP fetch,也保证它一定是
  // "最后一张图"(prompt 里写死了这句)。
  return urls;
}

/**
 * 拉一张参考图 → base64 inlineData;失败(404 / 超时 / 网络抖动)返回 null。
 * 调用方按"能拉到几张用几张"处理 —— 不让单张图缺失废掉整个海报任务。
 */
async function tryFetchImageAsInline(url: string): Promise<InlinePart | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      logger.warn(
        { status: res.status, url: url.slice(0, 200) },
        'coco-image ref image non-2xx, skipping',
      );
      return null;
    }
    const arrayBuf = await res.arrayBuffer();
    const mimeType = res.headers.get('content-type') ?? 'image/png';
    const data = Buffer.from(arrayBuf).toString('base64');
    return { mimeType, data };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, url: url.slice(0, 200) },
      'coco-image ref image fetch failed, skipping',
    );
    return null;
  }
}

interface GeminiResponsePart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  /** 兼容 snake_case(部分网关回 inline_data)*/
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiResponsePart[];
    };
  }>;
  promptFeedback?: { blockReason?: string };
}

export class CocoImageService {
  async generatePoster(input: PosterGenerateInput): Promise<PosterGenerateOutput> {
    if (!config.COCO_API_KEY) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        '未配置 COCO_API_KEY,海报生成不可用',
      );
    }

    const model = await getCurrentImageModel();
    const prompt = buildPosterPrompt(input);
    const refUrls = collectReferenceImageUrls(input);

    // 软失败:并发拉所有外部参考图(用户底图/商品图),能拉几张用几张;失败照样发 prompt
    const externalParts = refUrls.length
      ? (await Promise.all(refUrls.map((u) => tryFetchImageAsInline(u)))).filter(
          (p): p is InlinePart => p !== null,
        )
      : [];
    // 风格参考图来自本地磁盘,直接读 —— 拼在末尾,与 prompt 里"最后一张图"对齐
    const styleRefPart = readStyleRefAsInline(input.template);
    const inlineParts = styleRefPart
      ? [...externalParts, styleRefPart]
      : externalParts;

    if (refUrls.length > 0 && externalParts.length === 0) {
      logger.warn(
        { model, requested: refUrls.length },
        'coco-image all ref images failed, falling back to prompt-only',
      );
    } else if (externalParts.length < refUrls.length) {
      logger.warn(
        { model, got: externalParts.length, requested: refUrls.length },
        'coco-image some ref images skipped',
      );
    }

    // 显式日志:每次生成都打"传给 AI 的图片组成",方便排查图少传/没传
    logger.info(
      {
        mode: input.mode,
        template: input.template,
        externalImages: externalParts.length,
        externalUrls: refUrls.map((u) => u.slice(0, 80)),
        hasStyleRef: !!styleRefPart,
        totalImagesSent: inlineParts.length,
      },
      'coco-image inline parts composition',
    );

    const start = Date.now();
    let res: Response;
    try {
      res = await this.callGenerateContent(model, prompt, inlineParts);
    } catch (err) {
      logger.error({ err }, 'coco-image fetch failed');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Corelays 调用失败:${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail = body.slice(0, 1000);
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string; code?: string | number } };
        if (parsed.error?.message) {
          detail = String(parsed.error.message).slice(0, 600);
        }
      } catch {
        // 不是 JSON,保留原文截断
      }
      logger.warn(
        { status: res.status, body: body.slice(0, 2000), model, refCount: inlineParts.length },
        'coco-image non-2xx',
      );
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Corelays 返回 ${res.status}: ${detail}`,
      );
    }

    const data = (await res.json()) as GeminiResponse;

    if (data.promptFeedback?.blockReason) {
      logger.warn(
        { reason: data.promptFeedback.blockReason, model },
        'coco-image blocked by safety',
      );
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Corelays 内容审核拦截:${data.promptFeedback.blockReason}`,
      );
    }

    const rawPosterUrl = extractImageDataUrl(data);
    if (!rawPosterUrl) {
      logger.warn({ data: JSON.stringify(data).slice(0, 800) }, 'coco-image no image');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        'Corelays 响应中未找到海报图片',
      );
    }

    // 后处理:按活动类型把对应二维码贴到右下角(member_price / weekend_beer 不贴)
    const posterUrl = await compositeQrIfNeeded(rawPosterUrl, input);

    return {
      posterUrl,
      modelUsed: model,
      promptUsed: prompt,
      generationMs: Date.now() - start,
    };
  }

  private async callGenerateContent(
    model: string,
    prompt: string,
    inlineParts: InlinePart[],
  ): Promise<Response> {
    const url = `${config.COCO_BASE_URL}/models/${encodeURIComponent(
      model,
    )}:generateContent`;
    const parts: Array<{ text: string } | { inlineData: InlinePart }> = [
      { text: prompt },
    ];
    for (const p of inlineParts) parts.push({ inlineData: p });

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.COCO_API_KEY}`,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  }
}

function extractImageDataUrl(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    if (!inline) continue;
    const mimeType =
      (p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png') as string;
    const b64 = inline.data;
    if (b64) return `data:${mimeType};base64,${b64}`;
  }
  return '';
}

// ============================================================================
// 右下角二维码合成
//
// 业务规则(@用户 2026-06-22 / 2026-06-24):
//   品牌满减券 (brand_coupon)   → 大牌好券.jpeg
//   常规优惠券 (regular_coupon) → 领券中心.jpg
//   周二会员日 (tuesday_member) → 会员日.jpg
//   会员价 (member_price)       → 无 QR(base 类,非领券)
//   周末啤酒日 (weekend_beer)    → 无 QR(base 类,与 member_price 同性质)
//
// 叠加规则(决定 QR 选哪个):
//   base ∈ {member_price, weekend_beer} 二者性质相同 —— 都是"商品本身的优惠价"
//   addon ∈ {brand_coupon, regular_coupon, tuesday_member} 三者都是"领券" —— 与 base 叠加
//   特别:tuesday_member 与 brand_coupon **互斥**,同一海报不会同时出现。
//   所以一张海报最多有一个 addon,QR 跟着 addon 走就对。
//
// 优先级:看 addon(用户实际要去扫码领的券)→ 没 addon 再看 base。
// 注:base 永远是 member_price / weekend_beer,activityToTag 返回 null,base 兜底实际
//    永远不会进 — 留在这只是防御性写法。
// ============================================================================
const QR_BASE = 'https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com/PROMO_tag';

interface QrFile {
  tag: string;
  ext: 'jpg' | 'jpeg' | 'png';
}

function activityToQrFile(t: string | undefined): QrFile | null {
  if (!t) return null;
  if (t === 'brand_coupon') return { tag: '大牌好券', ext: 'jpeg' };
  if (t === 'regular_coupon') return { tag: '领券中心', ext: 'jpg' };
  if (t === 'tuesday_member') return { tag: '会员日', ext: 'jpg' };
  // member_price / weekend_beer / 其他 → 无 QR
  return null;
}

function pickQrFile(input: PosterGenerateInput): QrFile | null {
  return (
    activityToQrFile(input.addonActivityType) ??
    activityToQrFile(input.baseActivityType)
  );
}

/** 把 data URL 解析成 buffer */
function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return Buffer.from(m[1]!, 'base64');
}

/**
 * 拉一张 QR 图回来(60s 超时,失败返回 null,不阻塞生成主流程)
 */
async function fetchQrBuffer(file: QrFile): Promise<Buffer | null> {
  const url = `${QR_BASE}/${encodeURIComponent(file.tag)}.${file.ext}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      logger.warn({ status: res.status, tag: file.tag, url }, 'qr fetch non-2xx, skip composite');
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, tag: file.tag, url },
      'qr fetch failed, skip composite',
    );
    return null;
  }
}

/**
 * 如果当前活动需要 QR,把 QR 合成到海报右下角并返回新的 data URL。
 *
 * 合成参数:
 *   - QR 占海报短边 ~18%(肉眼可扫且不喧宾夺主)
 *   - 距右、下边各留 4% 边距
 *   - 白色描边 + 圆角 + 轻阴影,确保贴到深色背景上也清晰
 *
 * 任何环节失败(QR 拉不到 / sharp 处理异常)都直接返回原图,不让 QR 拖垮整张生成。
 */
async function compositeQrIfNeeded(
  rawDataUrl: string,
  input: PosterGenerateInput,
): Promise<string> {
  const qrFile = pickQrFile(input);
  if (!qrFile) {
    logger.info(
      { base: input.baseActivityType, addon: input.addonActivityType },
      'qr composite skipped (activity not requiring QR)',
    );
    return rawDataUrl;
  }

  const posterBuf = dataUrlToBuffer(rawDataUrl);
  if (!posterBuf) return rawDataUrl;

  const qrBuf = await fetchQrBuffer(qrFile);
  if (!qrBuf) return rawDataUrl;

  try {
    const meta = await sharp(posterBuf).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return rawDataUrl;

    const shortSide = Math.min(W, H);
    // 之前 18%+4% margin 偶尔挡文案 → 缩到 15% 并贴到右下边角(margin=0)。
    // 注意 qrSticker 自带白色 padding (qrSize 5% ≈ 短边 0.75%),所以可视上
    // QR 主体仍离海报边有一点呼吸,不会真的"硬怼"。
    const qrSize = Math.round(shortSide * 0.15);
    const margin = 0;

    // QR 子图:resize → 白色 padding 做"贴纸感"白边 → 轻圆角
    const qrPadding = Math.max(4, Math.round(qrSize * 0.05));
    const qrCanvasSize = qrSize + qrPadding * 2;

    const qrResized = await sharp(qrBuf)
      .resize(qrSize, qrSize, { fit: 'contain', background: '#fff' })
      .toBuffer();

    // 在白底画布上居中放 QR,得到"白边贴纸"
    const qrSticker = await sharp({
      create: {
        width: qrCanvasSize,
        height: qrCanvasSize,
        channels: 4,
        background: '#fff',
      },
    })
      .composite([{ input: qrResized, top: qrPadding, left: qrPadding }])
      .png()
      .toBuffer();

    const left = W - qrCanvasSize - margin;
    const top = H - qrCanvasSize - margin;

    const merged = await sharp(posterBuf)
      .composite([{ input: qrSticker, left, top }])
      .png()
      .toBuffer();

    logger.info(
      { tag: qrFile.tag, qrSize, position: { left, top }, poster: { W, H } },
      'qr composited to bottom-right',
    );

    return `data:image/png;base64,${merged.toString('base64')}`;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, tag: qrFile.tag },
      'qr composite failed, returning poster without QR',
    );
    return rawDataUrl;
  }
}

export const cocoImageService = new CocoImageService();
