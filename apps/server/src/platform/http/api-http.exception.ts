import { HttpException } from '@nestjs/common';

export class ApiHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}
