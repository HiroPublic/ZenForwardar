import type { AuditEvent } from "../../shared/types";

export function audit(step: string, status: AuditEvent["status"], message: string, details?: Record<string, unknown>): AuditEvent {
  return {
    at: new Date().toISOString(),
    step,
    status,
    message,
    details
  };
}
