/**
 * 应用错误模型 + 错误码常量
 *
 * 所有可控的业务/校验错误，handler/middleware/service 应抛 AppError；
 * 全局错误中间件会把它转成统一的 JSON 错误响应。
 */

export const ErrorCodes = {
  // 通用
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // 鉴权
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // 业务
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  STORE_NOT_BOUND: 'STORE_NOT_BOUND',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * 应用统一异常。
 * - status：HTTP 状态码
 * - code：业务错误码字符串（前端按 code 分支）
 * - message：人类可读
 * - details：可选附加（如 zod 校验细节），仅 dev/test 透出
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 路由占位：标记接口尚未在当前里程碑实现 */
export class NotImplementedError extends AppError {
  constructor(message = '本接口将在 M1+ 里程碑实现') {
    super(501, ErrorCodes.NOT_IMPLEMENTED, message);
    this.name = 'NotImplementedError';
  }
}
