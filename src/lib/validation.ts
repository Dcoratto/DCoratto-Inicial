import { z } from "zod";
import { parseContentBlocks, contentBlocksToText } from "@/lib/content";

const requiredString = (max: number) => z.string().trim().min(1).max(max);
const loginOrEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(80)
  .refine((value) => {
    if (value.includes("@")) {
      return z.string().email().safeParse(value).success;
    }

    return /^[a-z0-9._-]+$/.test(value);
  }, "Use um e-mail válido ou um login simples com letras, números, ponto, underline ou hífen.");

export const loginSchema = z.object({
  login: z.string().trim().min(3).max(120),
  password: z.string().min(8).max(72)
});

export const passwordSchema = z.object({
  password: z.string().min(8).max(72)
});

export const createViewerUserSchema = z.object({
  username: loginOrEmailSchema,
  password: z.string().min(8).max(72),
  full_name: z.string().trim().max(120).optional().or(z.literal("")),
  department_category_id: z.string().uuid()
});

export const userIdSchema = z.object({
  userId: z.string().uuid()
});

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: requiredString(80),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  parent_id: z.string().uuid().optional().or(z.literal("")),
  access_scope: z.enum(["department", "global"]).default("department"),
  is_department: z.coerce.boolean().default(true),
  sort_order: z.coerce.number().int().min(0).max(10000).default(0),
  is_active: z.coerce.boolean().default(true)
});

export const documentSchema = z.object({
  id: z.string().uuid().optional(),
  title: requiredString(140),
  summary: z.string().trim().max(300).optional().or(z.literal("")),
  category_id: z.string().uuid().optional().or(z.literal("")),
  tags: z.string().trim().max(240).optional().or(z.literal("")),
  content_json: z.string().transform((value, context) => {
    try {
      return parseContentBlocks(value);
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Conteudo invalido." });
      return z.NEVER;
    }
  })
});

export const announcementSchema = z.object({
  id: z.string().uuid().optional(),
  title: requiredString(140),
  body: requiredString(5000),
  popup_enabled: z
    .union([z.literal("on"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "on" || value === "true"),
  popup_starts_at: z.string().trim().optional().or(z.literal("")),
  popup_duration_days: z.coerce.number().int().min(1).max(60).default(7),
  banner_enabled: z
    .union([z.literal("on"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "on" || value === "true"),
  banner_starts_at: z.string().trim().optional().or(z.literal("")),
  banner_duration_days: z.coerce.number().int().min(1).max(60).default(7)
});

export const onboardingTrackSchema = z.object({
  title: requiredString(140),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  department_category_id: z.string().uuid().optional().or(z.literal(""))
});

export const onboardingItemSchema = z.object({
  track_id: z.string().uuid(),
  title: requiredString(140),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  document_id: z.string().uuid().optional().or(z.literal("")),
  video_url: z.string().url().optional().or(z.literal("")),
  sort_order: z.coerce.number().int().min(0).max(10000).default(0)
});

export function parseTags(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

export function parseDocumentPayload(formData: FormData) {
  const parsed = documentSchema.parse(Object.fromEntries(formData));
  const tagsValue = formData.get("tags");
  return {
    ...parsed,
    summary: parsed.summary || null,
    category_id: parsed.category_id || null,
    tags: parseTags(typeof tagsValue === "string" ? tagsValue : ""),
    content_text: contentBlocksToText(parsed.content_json).slice(0, 50000)
  };
}
