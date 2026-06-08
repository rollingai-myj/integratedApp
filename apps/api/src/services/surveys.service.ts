/**
 * 调研问卷题目 + 答案 业务层
 *
 * 表：
 *   shelf_survey_questions  按 (shelf_id, question_no) 唯一
 *   shelf_survey_answers    每个 question 多个 answer（理论上一店一答，按 answered_at 排序取最新）
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

export interface SurveyQuestion {
  id: string;
  questionNo: number;
  questionText: string;
  questionKind: string | null;
  options: unknown[];
  source: string;
}

export interface SurveyAnswer {
  id: string;
  questionId: string;
  answerValue: unknown;
  answeredBy: string | null;
  answeredAt: string;
}

async function resolveShelfId(
  storeId: string,
  shelfCode: string,
): Promise<string> {
  const cfg = await query<{ id: string }>(
    `SELECT id FROM store_shelf_config
      WHERE store_id = $1 AND shelf_code = $2 AND deleted_at IS NULL LIMIT 1`,
    [storeId, shelfCode],
  );
  const shelfId = cfg.rows[0]?.id;
  if (!shelfId) throw new AppError(404, ErrorCodes.NOT_FOUND, '货架不存在');
  return shelfId;
}

export async function listQuestions(
  storeId: string,
  shelfCode: string,
): Promise<SurveyQuestion[]> {
  const shelfId = await resolveShelfId(storeId, shelfCode);
  const res = await query<{
    id: string;
    question_no: number;
    question_text: string;
    question_kind: string | null;
    options: unknown[];
    source: string;
  }>(
    `SELECT id, question_no, question_text, question_kind, options, source
       FROM shelf_survey_questions
      WHERE shelf_id = $1
   ORDER BY question_no`,
    [shelfId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    questionNo: r.question_no,
    questionText: r.question_text,
    questionKind: r.question_kind,
    options: r.options,
    source: r.source,
  }));
}

export interface SaveQuestionsInput {
  questions: Array<{
    questionNo: number;
    questionText: string;
    questionKind?: string;
    options?: unknown[];
    source?: string;
  }>;
  /** true = 先删旧再写新；false = upsert by question_no */
  replace?: boolean;
}

export async function saveQuestions(
  storeId: string,
  shelfCode: string,
  input: SaveQuestionsInput,
  userId: string,
): Promise<{ saved: number }> {
  const shelfId = await resolveShelfId(storeId, shelfCode);
  return withTransaction(async (client) => {
    if (input.replace) {
      await client.query(
        `DELETE FROM shelf_survey_questions WHERE shelf_id = $1`,
        [shelfId],
      );
    }
    for (const q of input.questions) {
      await client.query(
        `INSERT INTO shelf_survey_questions
           (shelf_id, store_id, question_no, question_text, question_kind, options, source, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7, 'ai'), $8)
         ON CONFLICT (shelf_id, question_no) DO UPDATE
           SET question_text = EXCLUDED.question_text,
               question_kind = EXCLUDED.question_kind,
               options = EXCLUDED.options,
               source = EXCLUDED.source,
               generated_at = now()`,
        [
          shelfId,
          storeId,
          q.questionNo,
          q.questionText,
          q.questionKind ?? null,
          JSON.stringify(q.options ?? []),
          q.source ?? null,
          userId,
        ],
      );
    }
    return { saved: input.questions.length };
  });
}

export async function listAnswers(
  storeId: string,
  shelfCode: string,
): Promise<SurveyAnswer[]> {
  const shelfId = await resolveShelfId(storeId, shelfCode);
  const res = await query<{
    id: string;
    question_id: string;
    answer_value: unknown;
    answered_by: string | null;
    answered_at: string;
  }>(
    `SELECT DISTINCT ON (question_id)
            id, question_id, answer_value, answered_by, answered_at
       FROM shelf_survey_answers
      WHERE shelf_id = $1
   ORDER BY question_id, answered_at DESC`,
    [shelfId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    questionId: r.question_id,
    answerValue: r.answer_value,
    answeredBy: r.answered_by,
    answeredAt: r.answered_at,
  }));
}

export interface SaveAnswersInput {
  answers: Array<{ questionId: string; answerValue?: unknown }>;
}

export async function saveAnswers(
  storeId: string,
  shelfCode: string,
  input: SaveAnswersInput,
  userId: string,
): Promise<{ saved: number }> {
  const shelfId = await resolveShelfId(storeId, shelfCode);
  return withTransaction(async (client) => {
    for (const a of input.answers) {
      await client.query(
        `INSERT INTO shelf_survey_answers
           (shelf_id, store_id, question_id, answer_value, answered_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [shelfId, storeId, a.questionId, JSON.stringify(a.answerValue), userId],
      );
    }
    return { saved: input.answers.length };
  });
}
