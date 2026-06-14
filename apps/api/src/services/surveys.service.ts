/**
 * 调研问卷（聊一聊）+ 周边洞察 业务层
 *
 * 表：store_survey_questions / store_survey_answers / store_insights
 * scene 为 NULL = 全店问卷；非空 = 场景问卷
 */
import { query, withTransaction } from '../db/index.js';

export interface SurveyQuestion {
  id: string;
  scene: number | null;
  questionNo: number;
  questionText: string;
  questionKind: 'single' | 'multi' | 'text';
  options: unknown[];
  answer: unknown;
}

export async function listSurveyQuestions(args: {
  storeId: string;
  scene: number | null;
}): Promise<SurveyQuestion[]> {
  const where = args.scene == null ? `q.scene IS NULL` : `q.scene = $2`;
  const params: unknown[] = [args.storeId];
  if (args.scene != null) params.push(args.scene);
  const res = await query<{
    id: string;
    scene: number | null;
    question_no: number;
    question_text: string;
    question_kind: 'single' | 'multi' | 'text';
    options: unknown[];
    answer: unknown;
  }>(
    `SELECT q.id, q.scene, q.question_no, q.question_text, q.question_kind, q.options,
            (SELECT answer_value FROM store_survey_answers
              WHERE question_id = q.id
              ORDER BY answered_at DESC LIMIT 1) AS answer
       FROM store_survey_questions q
      WHERE q.store_id = $1 AND ${where}
   ORDER BY q.question_no`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    scene: r.scene,
    questionNo: r.question_no,
    questionText: r.question_text,
    questionKind: r.question_kind,
    options: r.options ?? [],
    answer: r.answer ?? null,
  }));
}

export async function replaceSurveyQuestions(args: {
  storeId: string;
  scene: number | null;
  questions: Array<{
    questionText: string;
    questionKind?: 'single' | 'multi' | 'text';
    options?: unknown[];
  }>;
  source?: 'ai' | 'manual';
  userId: string;
}): Promise<SurveyQuestion[]> {
  await withTransaction(async (client) => {
    if (args.scene == null) {
      await client.query(
        `DELETE FROM store_survey_questions WHERE store_id = $1 AND scene IS NULL`,
        [args.storeId],
      );
    } else {
      await client.query(
        `DELETE FROM store_survey_questions WHERE store_id = $1 AND scene = $2`,
        [args.storeId, args.scene],
      );
    }
    for (let i = 0; i < args.questions.length; i++) {
      const q = args.questions[i]!;
      await client.query(
        `INSERT INTO store_survey_questions
           (store_id, scene, question_no, question_text, question_kind, options,
            source, generated_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now(), $8)`,
        [
          args.storeId, args.scene, i + 1,
          q.questionText, q.questionKind ?? 'multi',
          JSON.stringify(q.options ?? []),
          args.source ?? 'ai',
          args.userId,
        ],
      );
    }
  });
  return listSurveyQuestions({ storeId: args.storeId, scene: args.scene });
}

export async function submitSurveyAnswers(args: {
  storeId: string;
  answers: Array<{ questionId: string; value: unknown }>;
  userId: string;
}): Promise<{ written: number }> {
  let written = 0;
  await withTransaction(async (client) => {
    for (const a of args.answers) {
      const check = await client.query<{ ok: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM store_survey_questions
                        WHERE id = $1 AND store_id = $2) AS ok`,
        [a.questionId, args.storeId],
      );
      if (!check.rows[0]?.ok) continue;
      await client.query(
        `INSERT INTO store_survey_answers (question_id, answer_value, answered_by)
         VALUES ($1, $2::jsonb, $3)`,
        [a.questionId, JSON.stringify(a.value), args.userId],
      );
      written++;
    }
  });
  return { written };
}

// ---- 周边洞察 -----------------------------------------------------------

export interface StoreInsight {
  city: string | null;
  mainDemographic: string | null;
  consumptionLevel: string | null;
  populationDensity: string | null;
  crowdSourceAnalysis: string | null;
  competitorAnalysis: string | null;
  topCompetitors: unknown;
  reportMarkdown: string | null;
  generatedAt: string | null;
}

export async function getStoreInsight(storeId: string): Promise<StoreInsight | null> {
  const res = await query<{
    city: string | null;
    main_demographic: string | null;
    consumption_level: string | null;
    population_density: string | null;
    crowd_source_analysis: string | null;
    competitor_analysis: string | null;
    top_competitors: unknown;
    report_markdown: string | null;
    generated_at: string | null;
  }>(
    `SELECT city, main_demographic, consumption_level, population_density,
            crowd_source_analysis, competitor_analysis, top_competitors,
            report_markdown, generated_at
       FROM store_insights WHERE store_id = $1 LIMIT 1`,
    [storeId],
  );
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return {
    city: r.city,
    mainDemographic: r.main_demographic,
    consumptionLevel: r.consumption_level,
    populationDensity: r.population_density,
    crowdSourceAnalysis: r.crowd_source_analysis,
    competitorAnalysis: r.competitor_analysis,
    topCompetitors: r.top_competitors ?? [],
    reportMarkdown: r.report_markdown,
    generatedAt: r.generated_at,
  };
}

export interface UpsertInsightInput {
  city?: string | null;
  mainDemographic?: string | null;
  consumptionLevel?: string | null;
  populationDensity?: string | null;
  crowdSourceAnalysis?: string | null;
  competitorAnalysis?: string | null;
  topCompetitors?: unknown;
  reportMarkdown?: string | null;
}

export async function upsertStoreInsight(
  storeId: string,
  input: UpsertInsightInput,
  userId: string,
): Promise<StoreInsight> {
  await query(
    `INSERT INTO store_insights
       (store_id, city, main_demographic, consumption_level, population_density,
        crowd_source_analysis, competitor_analysis, top_competitors,
        report_markdown, generated_at, generated_by, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), $10, 'ai')
     ON CONFLICT (store_id) DO UPDATE
       SET city = EXCLUDED.city,
           main_demographic = EXCLUDED.main_demographic,
           consumption_level = EXCLUDED.consumption_level,
           population_density = EXCLUDED.population_density,
           crowd_source_analysis = EXCLUDED.crowd_source_analysis,
           competitor_analysis = EXCLUDED.competitor_analysis,
           top_competitors = EXCLUDED.top_competitors,
           report_markdown = EXCLUDED.report_markdown,
           generated_at = now(),
           generated_by = EXCLUDED.generated_by,
           updated_at = now()`,
    [
      storeId,
      input.city ?? null,
      input.mainDemographic ?? null,
      input.consumptionLevel ?? null,
      input.populationDensity ?? null,
      input.crowdSourceAnalysis ?? null,
      input.competitorAnalysis ?? null,
      JSON.stringify(input.topCompetitors ?? []),
      input.reportMarkdown ?? null,
      userId,
    ],
  );
  const out = await getStoreInsight(storeId);
  if (!out) throw new Error('store_insights upsert 失败');
  return out;
}
