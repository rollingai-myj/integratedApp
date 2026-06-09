/**
 * 调研问卷 shim —— 对接 /api/v1/surveys/:shelfCode/*
 *
 * 形态差异：
 *   - 后端 question = { id(UUID), questionNo, questionText, questionKind, options(JSONB), source }
 *   - 前端 InsightQuestion = { id(number), direction, context, question, options[] }
 *   保存时把 { direction, context, options } 整体塞进 options JSONB[0]，读回再解出来。
 *
 *   - 后端 answer = { questionId(UUID), answerValue }
 *   - 前端 SurveyQA = { id(number, == questionNo), question, answer(string), ... }
 *   保存/读取时按 questionNo ↔ questionId 做映射（需要先 list questions）。
 *
 * shelfCode：直接用 "pos-{N}"。saveShelfGroups（scenes.ts）会同时创建一行场景
 * 级合成 config（shelfCode="pos-{N}", attributes.__scene_anchor__=true），让
 * 后端 resolveShelfId 能查到。不再翻译 "pos-{N}-0" hack。
 */
import { apiFetch } from '@/components/shelves/lib/api-client';
import type { InsightQuestion } from '@/components/shelves/lib/difyInsightApi';

export interface SurveyQA {
  id: number;
  question: string;
  direction?: string;
  context?: string;
  options?: string[];
  answer: string;
}

interface BackendQuestion {
  id: string;
  questionNo: number;
  questionText: string;
  questionKind: string | null;
  options: unknown;
  source: string;
}

interface BackendAnswer {
  id: string;
  questionId: string;
  answerValue: unknown;
  answeredAt: string;
}

// shelfId 直接当 shelfCode 用；场景级 "pos-{N}" 由 saveShelfGroups 时创建合成
// config 行兜底（attributes.__scene_anchor__=true）。
const toShelfCode = (s: string) => s;

function parseFrontQuestion(b: BackendQuestion): InsightQuestion {
  const opts = b.options;
  let direction = '';
  let context = '';
  let options: string[] = [];
  if (Array.isArray(opts)) {
    const first = opts[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const meta = first as { direction?: string; context?: string; options?: string[] };
      direction = String(meta.direction ?? '');
      context = String(meta.context ?? '');
      options = Array.isArray(meta.options) ? meta.options.map(String) : [];
    } else {
      options = opts.filter((x): x is string => typeof x === 'string');
    }
  }
  return {
    id: b.questionNo,
    direction,
    context,
    question: b.questionText,
    options,
  };
}

export async function getShelfSurveyQuestions(
  storeId: string,
  shelfId: string,
): Promise<InsightQuestion[] | null> {
  if (!storeId || !shelfId) return null;
  try {
    const code = toShelfCode(shelfId);
    const res = await apiFetch(`/surveys/${encodeURIComponent(code)}/questions`);
    if (!res.ok) return [];
    const data = (await res.json()) as { questions?: BackendQuestion[] };
    return (data.questions ?? []).map(parseFrontQuestion);
  } catch (err) {
    console.warn('[shelves/shelfSurvey.getQuestions] failed', err);
    return [];
  }
}

export async function saveShelfSurveyQuestions(
  storeId: string,
  shelfId: string,
  questions: InsightQuestion[],
): Promise<void> {
  if (!storeId || !shelfId || questions.length === 0) return;
  const code = toShelfCode(shelfId);
  await apiFetch(`/surveys/${encodeURIComponent(code)}/questions`, {
    method: 'PUT',
    body: JSON.stringify({
      replace: true,
      questions: questions.map((q) => ({
        questionNo: q.id,
        questionText: q.question,
        questionKind: q.direction || undefined,
        // 把整套元数据塞进 options[0]，保证回读时能拼回原 InsightQuestion
        options: [{ direction: q.direction, context: q.context, options: q.options }],
        source: 'ai',
      })),
    }),
  });
}

export async function getShelfSurveyAnswers(
  storeId: string,
  shelfId: string,
): Promise<SurveyQA[] | null> {
  if (!storeId || !shelfId) return null;
  try {
    const code = toShelfCode(shelfId);
    const [qRes, aRes] = await Promise.all([
      apiFetch(`/surveys/${encodeURIComponent(code)}/questions`),
      apiFetch(`/surveys/${encodeURIComponent(code)}/answers`),
    ]);
    if (!qRes.ok || !aRes.ok) return [];
    const qData = (await qRes.json()) as { questions?: BackendQuestion[] };
    const aData = (await aRes.json()) as { answers?: BackendAnswer[] };
    const questions = qData.questions ?? [];
    const answers = aData.answers ?? [];
    const ansByQId = new Map(answers.map((a) => [a.questionId, a]));
    return questions.map((bq) => {
      const front = parseFrontQuestion(bq);
      const ans = ansByQId.get(bq.id);
      const answer = ans?.answerValue;
      return {
        id: front.id,
        question: front.question,
        direction: front.direction,
        context: front.context,
        options: front.options,
        answer:
          typeof answer === 'string'
            ? answer
            : answer != null
              ? JSON.stringify(answer)
              : '',
      };
    });
  } catch (err) {
    console.warn('[shelves/shelfSurvey.getAnswers] failed', err);
    return [];
  }
}

export async function saveShelfSurveyAnswers(
  storeId: string,
  shelfId: string,
  answers: SurveyQA[],
): Promise<void> {
  if (!storeId || !shelfId || answers.length === 0) return;
  const code = toShelfCode(shelfId);
  // 先 list questions 拿 questionNo ↔ questionId 映射
  const qRes = await apiFetch(`/surveys/${encodeURIComponent(code)}/questions`);
  if (!qRes.ok) throw new Error(`无法读取问题列表 ${qRes.status}`);
  const qData = (await qRes.json()) as { questions?: BackendQuestion[] };
  const qIdByNo = new Map((qData.questions ?? []).map((q) => [q.questionNo, q.id]));
  const payload = answers
    .map((a) => {
      const qid = qIdByNo.get(a.id);
      if (!qid) return null;
      return { questionId: qid, answerValue: a.answer };
    })
    .filter((x): x is { questionId: string; answerValue: string } => !!x);
  if (payload.length === 0) return;
  await apiFetch(`/surveys/${encodeURIComponent(code)}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ answers: payload }),
  });
}
