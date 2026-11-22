import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response, Request } from 'express';
import { Prisma } from '@prisma/client';

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
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // خطاهای شناخته‌شدهٔ Prisma — باید پاسخ معنادار بدهند، نه ۵۰۰
      if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'رکورد موردنظر یافت نشد';
      } else if (exception.code === 'P2023' || (exception.message ?? '').includes('Invalid UUID')) {
        status = HttpStatus.BAD_REQUEST;
        code = 'INVALID_ID';
        message = 'شناسهٔ ارسالی معتبر نیست';
      } else if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'DUPLICATE';
        message = 'رکورد تکراری (کلید یکتا)';
      }
      this.logger.warn(`Prisma ${exception.code} → ${status} target=${JSON.stringify((exception.meta as { target?: unknown } | null)?.target ?? null)}`);
    } else if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      // خطای raw-query — مهم‌ترین حالت: شناسهٔ بدشکل در کوئری‌های ::uuid
      const msg = exception.message ?? '';
      if (msg.includes('invalid input syntax for type uuid') || msg.includes('Invalid UUID')) {
        status = HttpStatus.BAD_REQUEST;
        code = 'INVALID_ID';
        message = 'شناسهٔ ارسالی معتبر نیست';
        this.logger.warn(`Prisma raw uuid → 400`);
      } else {
        this.logger.error('Unhandled Prisma raw exception', String(exception));
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
