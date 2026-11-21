/**
 * instrumentation.ts — رصد با OpenTelemetry (F1-T7).
 * فقط وقتی OTEL_EXPORTER_OTLP_ENDPOINT تنظیم شده باشد فعال می‌شود؛
 * نبود کلکتور هرگز اجرای برنامه را متوقف نمی‌کند (قواعد یکپارچگی: قطع سرویس بیرونی ≤ degrade).
 * Sentry اگر SENTRY_DSN ست شده باشد فعال می‌شود.
 */
export function startTelemetry(): void {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    try {
      // ایمپورت دیرهنگام تا بدون کلکتور هزینه راه‌اندازی پرداخت نشود
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { NodeSDK } = require('@opentelemetry/sdk-node');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
      const sdk = new NodeSDK({
        traceExporter: new OTLPTraceExporter({ url: `${otlpEndpoint.replace(/\/$/, '')}/v1/traces` }),
        instrumentations: [new HttpInstrumentation()],
      });
      sdk.start();
      // eslint-disable-next-line no-console
      console.log('[otel] tracing enabled →', otlpEndpoint);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[otel] failed to start, continuing without tracing:', (err as Error).message);
    }
  }

  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = require('@sentry/node');
      Sentry.init({ dsn: sentryDsn, environment: process.env.NODE_ENV ?? 'development' });
      // eslint-disable-next-line no-console
      console.log('[sentry] enabled');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sentry] failed to init:', (err as Error).message);
    }
  }
}
