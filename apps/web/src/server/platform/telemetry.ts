import 'server-only';
import { logger } from './logger';

export type TelemetryContext = {
  requestId?: string;
  route?: string;
  tenantId?: string | null;
  userRef?: string | null;
};

/**
 * Observability port. The internal adapter writes structured logs; the Batela
 * adapter (the project owner's monitoring tool) plugs in here later.
 */
export interface Telemetry {
  captureError(error: unknown, ctx?: TelemetryContext): void;
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
  securityEvent(kind: string, ctx?: TelemetryContext & { detail?: string }): void;
}

const internalTelemetry: Telemetry = {
  captureError(error, ctx) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ ...ctx, err: { message: err.message, stack: err.stack } }, 'error');
  },
  recordMetric(name, value, tags) {
    logger.debug({ metric: name, value, tags }, 'metric');
  },
  securityEvent(kind, ctx) {
    logger.warn({ security: kind, ...ctx }, 'security_event');
  },
};

export function telemetry(): Telemetry {
  return internalTelemetry;
}
