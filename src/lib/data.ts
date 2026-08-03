import "server-only";

import { unstable_cache, revalidateTag } from "next/cache";
import { createServiceRoleClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type { BannerAnnouncement, Category, DocumentDetail, DocumentListItem, PopupAnnouncement, Profile } from "@/types/app";

export const getActiveCategoriesCached = unstable_cache(
  async (): Promise<Category[]> => {
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from("categories")
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as Category[];
  },
  ["active-categories"],
  { revalidate: 300, tags: ["categories"] }
);

export async function getCategoriesForUser(profile: Profile): Promise<Category[]> {
  void profile;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Category[];
}

export const getPublishedDocumentCached = unstable_cache(
  async (slug: string): Promise<DocumentDetail | null> => {
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from("documents")
      .select(
        "id,title,slug,summary,category_id,status,updated_at,tags,content_json,content_text,version,published_at,archived_at,categories(name,slug)"
      )
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return null;
    }

    const record = data as unknown as SupabaseDocumentWithCategory;
    const { categories, ...document } = record;
    return {
      ...document,
      category: normalizeCategory(categories)
    };
  },
  ["published-document"],
  { revalidate: 300, tags: ["documents"] }
);

export async function getPublishedDocumentForUser(slug: string): Promise<DocumentDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id,title,slug,summary,category_id,status,updated_at,tags,content_json,content_text,version,published_at,archived_at,categories(name,slug)"
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const record = data as unknown as SupabaseDocumentWithCategory;
  const { categories, ...document } = record;
  return {
    ...document,
    category: normalizeCategory(categories)
  };
}

type SupabaseDocumentWithCategory = DocumentDetail & {
  categories?: Pick<Category, "name" | "slug"> | Array<Pick<Category, "name" | "slug">> | null;
};

function normalizeCategory(
  category: SupabaseDocumentWithCategory["categories"]
): Pick<Category, "name" | "slug"> | null {
  if (!category) {
    return null;
  }

  return Array.isArray(category) ? category[0] ?? null : category;
}

export async function getRecentPublishedDocuments(limit = 6): Promise<DocumentListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id,title,slug,summary,category_id,status,updated_at,tags")
    .eq("status", "published")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return data as DocumentListItem[];
}

export function invalidateKnowledgeCaches() {
  revalidateTag("documents");
  revalidateTag("categories");
}

export async function getPopupAnnouncementsForUser(profile: Profile): Promise<PopupAnnouncement[]> {
  const service = createServiceRoleClient();
  const readableCategoryIds = await getReadableCategoryIdsForProfile(service, profile);
  const now = new Date().toISOString();
  const { data, error } = await service
    .from("announcements")
    .select(
      "id,title,body,media_storage_path,media_mime_type,popup_media_storage_path,popup_media_mime_type,popup_ends_at,announcement_targets(user_id),announcement_target_categories(category_id),announcement_dismissals(user_id)"
    )
    .eq("status", "published")
    .is("deleted_at", null)
    .is("permanently_deleted_at", null)
    .eq("popup_enabled", true)
    .eq("popup_active", true)
    .lte("popup_starts_at", now)
    .gte("popup_ends_at", now)
    .order("published_at", { ascending: false })
    .limit(5);

  if (error || !data) {
    return [];
  }

  const visible = (data as Array<{
    id: string;
    title: string;
    body: string;
    media_storage_path: string | null;
    media_mime_type: string | null;
    popup_media_storage_path: string | null;
    popup_media_mime_type: string | null;
    popup_ends_at: string | null;
    announcement_targets?: Array<{ user_id: string }>;
    announcement_target_categories?: Array<{ category_id: string }>;
    announcement_dismissals?: Array<{ user_id: string }>;
  }>).filter((announcement) => {
    const targets = announcement.announcement_targets ?? [];
    const targetCategories = announcement.announcement_target_categories ?? [];
    const dismissals = announcement.announcement_dismissals ?? [];
    const targeted =
      profile.role === "admin" ||
      (targets.length === 0 && targetCategories.length === 0) ||
      targets.some((target) => target.user_id === profile.id) ||
      targetCategories.some((target) => readableCategoryIds.has(target.category_id));
    const dismissed = dismissals.some((dismissal) => dismissal.user_id === profile.id);
    return targeted && !dismissed;
  });

  return Promise.all(
    visible.map(async (announcement) => {
      const mediaPath = announcement.popup_media_storage_path ?? announcement.media_storage_path;
      return {
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        mediaStoragePath: mediaPath,
        mediaUrl: null,
        mediaMimeType: announcement.popup_media_mime_type ?? announcement.media_mime_type,
        popupEndsAt: announcement.popup_ends_at
      };
    })
  );
}

export async function getBannerAnnouncementsForUser(profile: Profile): Promise<BannerAnnouncement[]> {
  const service = createServiceRoleClient();
  const readableCategoryIds = await getReadableCategoryIdsForProfile(service, profile);
  const now = new Date().toISOString();
  const { data, error } = await service
    .from("announcements")
    .select(
      "id,title,body,media_storage_path,media_mime_type,banner_image_storage_path,banner_image_mime_type,banner_ends_at,announcement_targets(user_id),announcement_target_categories(category_id)"
    )
    .eq("status", "published")
    .is("deleted_at", null)
    .is("permanently_deleted_at", null)
    .eq("banner_enabled", true)
    .eq("banner_active", true)
    .lte("banner_starts_at", now)
    .gte("banner_ends_at", now)
    .order("published_at", { ascending: false })
    .limit(5);

  if (error || !data) {
    return [];
  }

  const visible = (data as Array<{
    id: string;
    title: string;
    body: string;
    media_storage_path: string | null;
    media_mime_type: string | null;
    banner_image_storage_path: string | null;
    banner_image_mime_type: string | null;
    banner_ends_at: string | null;
    announcement_targets?: Array<{ user_id: string }>;
    announcement_target_categories?: Array<{ category_id: string }>;
  }>).filter((announcement) => {
    const targets = announcement.announcement_targets ?? [];
    const targetCategories = announcement.announcement_target_categories ?? [];
    if (profile.role === "admin") {
      return true;
    }

    if (targets.length === 0 && targetCategories.length === 0) {
      return true;
    }

    return (
      targets.some((target) => target.user_id === profile.id) ||
      targetCategories.some((target) => readableCategoryIds.has(target.category_id))
    );
  });

  return Promise.all(
    visible
      .map((announcement) => {
        const mediaPath = announcement.banner_image_storage_path ?? announcement.media_storage_path;
        const mimeType = announcement.banner_image_mime_type ?? announcement.media_mime_type;
        return {
          announcement,
          mediaPath,
          mimeType
        };
      })
      .filter((item) => item.mediaPath && item.mimeType?.startsWith("image/"))
      .map(async ({ announcement, mediaPath, mimeType }) => ({
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        mediaStoragePath: mediaPath,
        mediaUrl: null,
        mediaMimeType: mimeType,
        bannerEndsAt: announcement.banner_ends_at
      }))
  );
}

async function getReadableCategoryIdsForProfile(
  service: ReturnType<typeof createServiceRoleClient>,
  profile: Profile
) {
  if (profile.role === "admin") {
    return new Set<string>();
  }

  const ids = new Set<string>();
  if (profile.department_category_id) {
    ids.add(profile.department_category_id);
  }

  const { data } = await service
    .from("user_folder_permissions")
    .select("category_id")
    .eq("user_id", profile.id);

  ((data ?? []) as Array<{ category_id: string }>).forEach((item) => ids.add(item.category_id));
  return ids;
}
