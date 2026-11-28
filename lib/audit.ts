import type { Prisma } from "@/app/generated/prisma/client";

// Immutable audit trail of access-control changes (server-only). The ONLY write path is `recordAudit`, called inside the same transaction
// as the change it records. There is deliberately no update or delete function — and no UI or Server Action that changes or removes
// audit events. The only reader besides the role audit tab is the read-only Audit Log viewer (/audit-log, lib/audit-view.ts).
// Metadata is limited to safe, non-secret facts (ids, names, permission keys, counts); never passwords, tokens or raw request bodies.

export const AUDIT_EVENT_TYPES = [
  "ROLE_CREATED",
  "ROLE_UPDATED",
  "ROLE_PERMISSIONS_CHANGED",
  "ROLE_ACTIVATED",
  "ROLE_DEACTIVATED",
  "ROLE_CLONED",
  "ROLE_DELETED",
  "TEMPLATES_INITIALIZED",
  "USER_ROLE_ASSIGNED",
  "USER_ROLE_CHANGED",
  "USER_ROLE_UNASSIGNED",
  "USER_WAREHOUSE_SCOPE_CHANGED",
  "TRANSLATION_SAVED",
  "TRANSLATION_RESET",
  "PRODUCT_DELETED",
  "PRODUCT_DEACTIVATED",
  "PRODUCT_ACTIVATED",
  "PRODUCT_BULK_REMOVED",
  "PRODUCT_BULK_STATUS",
  "PRODUCT_IMPORTED",
  "CUSTOMER_CREATED",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditTarget = "ROLE" | "USER" | "SYSTEM" | "TRANSLATION" | "PRODUCT" | "CUSTOMER";

export async function recordAudit(tx: Prisma.TransactionClient, e: { actorId: string; eventType: AuditEventType; targetType: AuditTarget; targetId: string; metadata?: Record<string, unknown> }) {
  // Round-trip through JSON so only plain data can ever be stored.
  const metadata = e.metadata ? (JSON.parse(JSON.stringify(e.metadata)) as Prisma.InputJsonValue) : undefined;
  await tx.auditEvent.create({ data: { actorId: e.actorId, eventType: e.eventType, targetType: e.targetType, targetId: e.targetId, metadata } });
}
