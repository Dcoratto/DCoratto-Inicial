import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSignedUrl } from "@/lib/storage";
import { createServiceRoleClient, createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const storagePath = (url.searchParams.get("path") ?? "").trim();

  if (!isSafeStoragePath(storagePath)) {
    return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
  }

  const allowed = await canAccessStoragePath(storagePath);
  if (!allowed) {
    return NextResponse.json({ error: "Você não tem acesso a este arquivo." }, { status: 403 });
  }

  const signedUrl = await createSignedUrl(storagePath);
  if (!signedUrl) {
    return NextResponse.json({ error: "Não foi possível carregar o arquivo." }, { status: 404 });
  }

  return NextResponse.json({ signedUrl, expiresIn: 600 });
}

function isSafeStoragePath(storagePath: string) {
  return (
    storagePath.length > 0 &&
    storagePath.length <= 500 &&
    !storagePath.includes("..") &&
    !storagePath.startsWith("/") &&
    /^[a-zA-Z0-9/_.,@-]+$/.test(storagePath)
  );
}

async function canAccessStoragePath(storagePath: string) {
  const supabase = await createSupabaseServerClient();
  const service = createServiceRoleClient();

  const { data: versionRecord } = await service
    .from("document_file_versions")
    .select("id")
    .eq("storage_path", storagePath)
    .limit(1);

  if (versionRecord && versionRecord.length > 0) {
    const { data: readableVersion } = await supabase
      .from("document_file_versions")
      .select("id")
      .eq("storage_path", storagePath)
      .limit(1);

    return Boolean(readableVersion && readableVersion.length > 0);
  }

  const { data: attachment } = await supabase
    .from("attachments")
    .select("id")
    .eq("storage_path", storagePath)
    .limit(1);

  if (attachment && attachment.length > 0) {
    return true;
  }

  const fields = [
    "media_storage_path",
    "popup_media_storage_path",
    "banner_image_storage_path"
  ];

  for (const field of fields) {
    const { data } = await supabase
      .from("announcements")
      .select("id")
      .eq(field, storagePath)
      .limit(1);

    if (data && data.length > 0) {
      return true;
    }
  }

  const { data: onboardingFile } = await supabase
    .from("onboarding_items")
    .select("id")
    .eq("file_storage_path", storagePath)
    .limit(1);

  if (onboardingFile && onboardingFile.length > 0) {
    return true;
  }

  return false;
}
