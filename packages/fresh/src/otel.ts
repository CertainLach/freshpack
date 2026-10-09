import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import packageJson from "../package.json" with { type: "json" };

export const CURRENT_FRESH_VERSION = packageJson.version;

export const tracer = trace.getTracer("fresh", CURRENT_FRESH_VERSION);
export { trace };

export function recordSpanError(span: Span, err: unknown) {
  if (err instanceof Error) {
    span.recordException(err);
  } else {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: String(err),
    });
  }
}
