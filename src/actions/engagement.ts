"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const markViewedSchema = z.object({
  userId: z.string().uuid(),
  contentType: z.enum(["document", "announcement", "popup", "banner", "onboarding", "folder_link", "attachment", "document_version"]),
  contentId: z.string().uuid(),
  categoryId: z.string().uuid().optional().or(z.literal(""))
});

export async function markEngagementViewedByAdmin(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = markViewedSchema.parse(Object.fromEntries(formData));
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("mark_content_as_viewed", {
    p_content_type: parsed.contentType,
    p_content_id: parsed.contentId,
    p_category_id: parsed.categoryId || null,
    p_user_id: parsed.userId,
    p_source: "admin"
  });

  if (error) {
    throw new Error("Não foi possível marcar a visualização.");
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "engagement.mark_viewed",
    entityType: "engagement",
    entityId: parsed.contentId,
    metadata: {
      userId: parsed.userId,
      contentType: parsed.contentType
    }
  });

  revalidatePath("/admin/engagement");
}
