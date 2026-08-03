import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditInput): Promise<void> {
  const service = createServiceRoleClient();
  const { error } = await service.from("audit_logs").insert({
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {}
  });

  if (error) {
    console.error("Falha ao gravar auditoria", {
      action: input.action,
      entityType: input.entityType
    });
  }
}
