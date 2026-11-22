import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response, Request } from 'express';

/**
 * AllExceptionsFilter — شکل استاندارد خطا (سند ۰۵ بخش ۲):
 * { error: { code, message, details?, requestId } } — هیچ جزئیات داخلی افشا نمی‌شود.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Unexpected error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        code = (b.code as string) ?? codeForStatus(status);
        message = (b.message as string) ?? exception.message;
        details = b.details ?? (Array.isArray(b.message) ? b.message : undefined);
        if (Array.isArray(b.message)) message = 'Validation failed';
      }
    } else {
      this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      error: {
        code,
        message,
        details,
        requestId: (req as unknown as { id?: string }).id,
      },
    });
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400: return 'VALIDATION';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 422: return 'BUSINESS_RULE';
    case 429: return 'RATE_LIMITED';
    default: return 'INTERNAL';
  }
}
