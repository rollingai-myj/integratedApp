/**
 * 门店洞察 + 调研问卷（聊一聊）路由
 *
 *  GET  /insights                       本店周边洞察
 *  PUT  /insights                       手动写入洞察
 *  POST /insights/ai/report             AI 生成周边洞察报告（流式）
 *  GET  /insights/surveys/questions     问卷题目（scene 可空 = 全店）
 *  PUT  /insights/surveys/questions     保存/重置题目
 *  POST /insights/surveys/questions/ai  AI 生成题目（流式，仅场景问卷）
 *  PUT  /insights/surveys/answers       提交答案
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import { assertSceneExists } from '../services/hq.service.js';
import {
  listSurveyQuestions, replaceSurveyQuestions, submitSurveyAnswers,
  getStoreInsight, upsertStoreInsight,
} from '../services/surveys.service.js';
import { writeAuditEvent } from '../services/audit.service.js';
import {
  buildInsightInputs, buildQuestionsInputs, streamToClient,
} from '../services/ai-shelves.service.js';
import { buildDifyUser } from '../lib/dify-user.js';

export const insightsRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ---- 周边洞察 ------------------------------------------------------------

insightsRouter.get(
  '/insights', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const out = await getStoreInsight(req.user!.currentStoreId!);
    res.json(out ?? null);
  }),
);

const insightPutSchema = z.object({
  city: z.string().nullable().optional(),
  mainDemographic: z.string().nullable().optional(),
  consumptionLevel: z.string().nullable().optional(),
  populationDensity: z.string().nullable().optional(),
  crowdSourceAnalysis: z.string().nullable().optional(),
  competitorAnalysis: z.string().nullable().optional(),
  topCompetitors: z.unknown().optional(),
  reportMarkdown: z.string().nullable().optional(),
});

insightsRouter.put(
  '/insights', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const body = insightPutSchema.parse(req.body);
    const out = await upsertStoreInsight(
      req.user!.currentStoreId!, body, req.user!.id,
    );
    void writeAuditEvent({
      eventKind: 'store_insight_update',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
    }).catch(() => {});
    res.json(out);
  }),
);

insightsRouter.post(
  '/insights/ai/report', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const inputs = await buildInsightInputs({ storeId: req.user!.currentStoreId! });
    void writeAuditEvent({
      eventKind: 'insight_generate',
      actorUserId: req.user!.id, isAiCall: true, aiWorkflow: 'insight',
      targetStoreId: req.user!.currentStoreId!,
    }).catch(() => {});
    await streamToClient('insight', inputs, buildDifyUser(req.user!), res);
  }),
);

// ---- 调研问卷 ------------------------------------------------------------

const sceneQuerySchema = z.object({
  scene: z.coerce.number().int().min(0).max(12).optional(),
});

insightsRouter.get(
  '/insights/surveys/questions', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const parsed = sceneQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '参数错误');
    res.json({
      questions: await listSurveyQuestions({
        storeId: req.user!.currentStoreId!,
        scene: parsed.data.scene ?? null,
      }),
    });
  }),
);

const replaceQuestionsSchema = z.object({
  questions: z.array(z.object({
    questionText: z.string().min(1),
    questionKind: z.enum(['single', 'multi', 'text']).optional(),
    options: z.array(z.unknown()).optional(),
  })),
  source: z.enum(['ai', 'manual']).optional(),
});

insightsRouter.put(
  '/insights/surveys/questions', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const q = sceneQuerySchema.parse(req.query);
    const body = replaceQuestionsSchema.parse(req.body);
    const scene = q.scene ?? null;
    if (scene != null) await assertSceneExists(scene);
    const questions = await replaceSurveyQuestions({
      storeId: req.user!.currentStoreId!,
      scene,
      questions: body.questions,
      source: body.source,
      userId: req.user!.id,
    });
    void writeAuditEvent({
      eventKind: 'survey_submit',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene, count: questions.length, action: 'replace_questions' },
    }).catch(() => {});
    res.json({ questions });
  }),
);

insightsRouter.post(
  '/insights/surveys/questions/ai', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const q = sceneQuerySchema.parse(req.query);
    if (q.scene == null) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '需要 scene 才能生成场景问卷');
    }
    await assertSceneExists(q.scene);
    const inputs = await buildQuestionsInputs({
      storeId: req.user!.currentStoreId!, scene: q.scene,
    });
    void writeAuditEvent({
      eventKind: 'scene_qa_submit',
      actorUserId: req.user!.id, isAiCall: true, aiWorkflow: 'questions',
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene: q.scene, phase: 'ai_generate' },
    }).catch(() => {});
    await streamToClient('questions', inputs, buildDifyUser(req.user!), res);
  }),
);

const answersSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    value: z.unknown(),
  })).min(1),
});

insightsRouter.put(
  '/insights/surveys/answers', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const body = answersSchema.parse(req.body);
    const result = await submitSurveyAnswers({
      storeId: req.user!.currentStoreId!,
      answers: body.answers.map((a) => ({ questionId: a.questionId, value: a.value ?? null })),
      userId: req.user!.id,
    });
    void writeAuditEvent({
      eventKind: 'survey_submit',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
      payload: { written: result.written, action: 'submit_answers' },
    }).catch(() => {});
    res.json(result);
  }),
);
