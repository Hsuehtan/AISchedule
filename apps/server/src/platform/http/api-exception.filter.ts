import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ApiHttpException } from './api-http.exception.js';
import { getRequestId, type RequestWithPublicId } from './request-id.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Pick<Logger, 'error'> = new Logger(ApiExceptionFilter.name),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithPublicId>();
    const reply = context.getResponse<FastifyReply>();

    const requestId = getRequestId(request);
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = exception instanceof ApiHttpException ? exception.code : this.defaultCode(status);
    const message =
      exception instanceof ApiHttpException
        ? exception.message
        : status >= 500
          ? '服务暂时不可用'
          : '请求无法处理';
    const details = exception instanceof ApiHttpException ? exception.details : {};

    if (!(exception instanceof HttpException)) {
      this.logger.error({
        event: 'unhandled_http_exception',
        requestId,
        errorKind: exception instanceof Error ? 'Error' : 'UnknownThrownValue',
      });
    }

    void reply.status(status).send({
      error: { code, message, requestId, details },
    });
  }

  private defaultCode(status: number): string {
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status >= 500) return 'INTERNAL_ERROR';
    return 'INVALID_REQUEST';
  }
}
