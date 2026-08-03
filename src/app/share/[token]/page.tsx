import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, FileText, Folder, Link as LinkIcon, Video } from "lucide-react";
import { hashShareToken, isSafeShareToken, type ShareResourceType } from "@/lib/share-tokens";
import { KNOWLEDGE_BUCKET } from "@/lib/storage";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Link compartilhado | Central D'Coratto",
  robots: {
    index: false,
    follow: false
  }
};

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ folder?: string }>;
};

type SharedLinkRow = {
  id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  access_count: number;
  expires_at: string | null;
};

type PublicCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
};

type PublicDocument = {
  id: string;
  title: string;
  summary: string | null;
  category_id: string | null;
  updated_at: string | null;
};

type PublicVersion = {
  document_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  version_number: number;
};

type PublicFolderLink = {
  id: string;
  title: string;
  url: string;
  description: string | null;
  category_id: string;
  updated_at: string | null;
};

export default async function SharedLinkPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { folder } = await searchParams;

  if (!isSafeShareToken(token)) {
    notFound();
  }

  const service = createServiceRoleClient();
  const now = new Date().toISOString();
  const { data: link } = await service
    .from("shared_links")
    .select("id,resource_type,resource_id,access_count,expires_at")
    .eq("token_hash", hashShareToken(token))
    .eq("is_active", true)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle<SharedLinkRow>();

  if (!link) {
    return <ShareError title="Link indisponivel" description="Este link foi revogado, expirou ou nao existe mais." />;
  }

  await service
    .from("shared_links")
    .update({
      last_accessed_at: new Date().toISOString(),
      access_count: link.access_count + 1
    })
    .eq("id", link.id);

  if (link.resource_type === "document") {
    return <SharedDocument resourceId={link.resource_id} />;
  }

  if (link.resource_type === "folder_link") {
    return <SharedExternalLink resourceId={link.resource_id} />;
  }

  return <SharedFolder token={token} rootCategoryId={link.resource_id} requestedFolderId={folder ?? null} />;
}

async function SharedFolder({
  token,
  rootCategoryId,
  requestedFolderId
}: {
  token: string;
  rootCategoryId: string;
  requestedFolderId: string | null;
}) {
  const service = createServiceRoleClient();
  const { data: categoriesData } = await service
    .from("categories")
    .select("id,parent_id,name,description,sort_order")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .limit(1000);

  const categories = (categoriesData ?? []) as PublicCategory[];
  const root = categories.find((category) => category.id === rootCategoryId);
  if (!root) {
    return <ShareError title="Pasta indisponivel" description="A pasta compartilhada nao esta mais disponivel." />;
  }

  const current = requestedFolderId ? categories.find((category) => category.id === requestedFolderId) : root;
  if (!current || !isSameOrDescendant(current.id, root.id, categories)) {
    return <ShareError title="Acesso bloqueado" description="Esta pasta nao faz parte do link compartilhado." />;
  }

  const [documentsResult, linksResult] = await Promise.all([
    service
      .from("documents")
      .select("id,title,summary,category_id,updated_at")
      .eq("category_id", current.id)
      .eq("status", "published")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("title", { ascending: true })
      .limit(120),
    service
      .from("folder_links")
      .select("id,title,url,description,category_id,updated_at")
      .eq("category_id", current.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("title", { ascending: true })
      .limit(120)
  ]);

  const documents = (documentsResult.data ?? []) as PublicDocument[];
  const documentIds = documents.map((document) => document.id);
  const versionsResult =
    documentIds.length > 0
      ? await service
          .from("document_file_versions")
          .select("document_id,storage_path,original_name,mime_type,size_bytes,version_number")
          .in("document_id", documentIds)
          .eq("is_current", true)
          .eq("is_active", true)
          .is("deleted_at", null)
          .limit(120)
      : { data: [] };
  const versions = (versionsResult.data ?? []) as PublicVersion[];
  const versionByDocument = new Map(versions.map((version) => [version.document_id, version]));
  const signedUrls = await createSignedUrlMap(versions.map((version) => version.storage_path));
  const links = (linksResult.data ?? []) as PublicFolderLink[];
  const subfolders = categories
    .filter((category) => category.parent_id === current.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true }));
  const breadcrumbs = buildBreadcrumbs(current, root, categories);

  return (
    <ShareShell title={current.name} description={current.description ?? "Pasta compartilhada pela Central D'Coratto."}>
      <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm text-decorato-muted">
        {breadcrumbs.map((item, index) => (
          <span key={item.id} className="inline-flex items-center gap-2">
            {index > 0 ? <span>/</span> : null}
            {item.id === current.id ? (
              <span className="text-decorato-ink">{item.name}</span>
            ) : (
              <Link href={`/share/${token}?folder=${item.id}`} className="hover:text-decorato-teal">
                {item.name}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {subfolders.length + documents.length + links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-decorato-line bg-white p-8 text-center text-sm text-decorato-muted">
          Esta pasta compartilhada nao possui itens disponiveis.
        </div>
      ) : (
        <div className="grid gap-3">
          {subfolders.map((folder) => (
            <Link
              key={folder.id}
              href={`/share/${token}?folder=${folder.id}`}
              className="flex items-center gap-3 rounded-lg border border-decorato-line bg-white p-4 transition hover:border-decorato-teal/40 hover:bg-decorato-teal/5"
            >
              <span className="rounded-lg bg-decorato-teal/10 p-2 text-decorato-teal">
                <Folder aria-hidden="true" size={20} />
              </span>
              <span>
                <span className="block font-medium text-decorato-ink">{folder.name}</span>
                <span className="text-sm text-decorato-muted">Pasta</span>
              </span>
            </Link>
          ))}

          {links.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg border border-decorato-line bg-white p-4 transition hover:border-decorato-teal/40 hover:bg-decorato-teal/5"
            >
              <span className="rounded-lg bg-decorato-sun/20 p-2 text-decorato-ink">
                <LinkIcon aria-hidden="true" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-decorato-ink">{item.title}</span>
                <span className="block truncate text-sm text-decorato-muted">{item.description ?? item.url}</span>
              </span>
              <ExternalLink aria-hidden="true" size={17} className="text-decorato-muted" />
            </a>
          ))}

          {documents.map((document) => {
            const version = versionByDocument.get(document.id);
            const url = version ? signedUrls.get(version.storage_path) : null;
            return <SharedDocumentRow key={document.id} document={document} version={version ?? null} signedUrl={url ?? null} />;
          })}
        </div>
      )}
    </ShareShell>
  );
}

async function SharedDocument({ resourceId }: { resourceId: string }) {
  const service = createServiceRoleClient();
  const [{ data: document }, { data: versions }] = await Promise.all([
    service
      .from("documents")
      .select("id,title,summary,category_id,updated_at,status,is_active,deleted_at")
      .eq("id", resourceId)
      .maybeSingle<(PublicDocument & { status: string; is_active: boolean; deleted_at: string | null })>(),
    service
      .from("document_file_versions")
      .select("document_id,storage_path,original_name,mime_type,size_bytes,version_number")
      .eq("document_id", resourceId)
      .eq("is_current", true)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle<PublicVersion>()
  ]);

  if (!document || document.status !== "published" || !document.is_active || document.deleted_at) {
    return <ShareError title="Documento indisponivel" description="Este documento nao esta mais disponivel para compartilhamento." />;
  }

  const signedUrls = versions ? await createSignedUrlMap([versions.storage_path]) : new Map<string, string>();
  return (
    <ShareShell title={document.title} description={document.summary ?? "Documento compartilhado pela Central D'Coratto."}>
      <SharedDocumentRow document={document} version={versions ?? null} signedUrl={versions ? signedUrls.get(versions.storage_path) ?? null : null} expanded />
    </ShareShell>
  );
}

async function SharedExternalLink({ resourceId }: { resourceId: string }) {
  const service = createServiceRoleClient();
  const { data: item } = await service
    .from("folder_links")
    .select("id,title,url,description,is_active,deleted_at,category_id,updated_at")
    .eq("id", resourceId)
    .maybeSingle<PublicFolderLink & { is_active: boolean; deleted_at: string | null }>();

  if (!item || !item.is_active || item.deleted_at) {
    return <ShareError title="Link indisponivel" description="Este link nao esta mais disponivel para compartilhamento." />;
  }

  return (
    <ShareShell title={item.title} description={item.description ?? "Link compartilhado pela Central D'Coratto."}>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-decorato-line bg-white px-4 py-3 text-decorato-ink hover:bg-decorato-paper"
      >
        <ExternalLink aria-hidden="true" size={18} />
        Abrir link compartilhado
      </a>
    </ShareShell>
  );
}

function SharedDocumentRow({
  document,
  version,
  signedUrl,
  expanded = false
}: {
  document: PublicDocument;
  version: PublicVersion | null;
  signedUrl: string | null;
  expanded?: boolean;
}) {
  return (
    <article className="rounded-lg border border-decorato-line bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-lg bg-decorato-paper p-2 text-decorato-ink">
            {version?.mime_type.startsWith("video/") ? <Video aria-hidden="true" size={20} /> : <FileText aria-hidden="true" size={20} />}
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-medium text-decorato-ink">{document.title}</h2>
            <p className="text-sm text-decorato-muted">
              {version ? `${version.original_name} · ${formatBytes(version.size_bytes)}` : "Arquivo indisponivel"}
            </p>
          </div>
        </div>
        {signedUrl && version ? (
          <div className="flex flex-wrap gap-2">
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-decorato-line bg-white px-3 py-2 text-sm text-decorato-ink hover:bg-decorato-paper"
            >
              <ExternalLink aria-hidden="true" size={16} />
              Abrir
            </a>
            <a
              href={signedUrl}
              download={version.original_name}
              className="inline-flex items-center gap-2 rounded-md border border-decorato-line bg-white px-3 py-2 text-sm text-decorato-ink hover:bg-decorato-paper"
            >
              <Download aria-hidden="true" size={16} />
              Baixar
            </a>
          </div>
        ) : null}
      </div>

      {expanded && signedUrl && version?.mime_type.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={signedUrl} alt={document.title} className="mt-4 max-h-[70vh] w-full rounded-lg object-contain" />
      ) : null}

      {expanded && signedUrl && version?.mime_type.startsWith("video/") ? (
        <video controls preload="metadata" className="mt-4 max-h-[70vh] w-full rounded-lg bg-black">
          <source src={signedUrl} type={version.mime_type} />
        </video>
      ) : null}
    </article>
  );
}

function ShareShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-decorato-paper px-4 py-8 text-decorato-ink">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 rounded-xl border border-decorato-line bg-white p-6 shadow-sm">
          <p className="text-xs text-decorato-teal">Link compartilhado</p>
          <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-decorato-muted">{description}</p>
        </header>
        {children}
      </div>
    </main>
  );
}

function ShareError({ title, description }: { title: string; description: string }) {
  return (
    <ShareShell title={title} description={description}>
      <div className="rounded-lg border border-decorato-line bg-white p-6 text-sm text-decorato-muted">
        Solicite um novo link para a equipe D&apos;Coratto.
      </div>
    </ShareShell>
  );
}

async function createSignedUrlMap(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) {
    return new Map<string, string>();
  }

  const service = createServiceRoleClient();
  const { data } = await service.storage.from(KNOWLEDGE_BUCKET).createSignedUrls(uniquePaths, 10 * 60);
  return new Map((data ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}

function buildBreadcrumbs(current: PublicCategory, root: PublicCategory, categories: PublicCategory[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path: PublicCategory[] = [current];
  let cursor = current.parent_id ? byId.get(current.parent_id) : null;
  let guard = 0;

  while (cursor && guard < 50) {
    path.unshift(cursor);
    if (cursor.id === root.id) {
      break;
    }
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null;
    guard += 1;
  }

  return path[0]?.id === root.id ? path : [root];
}

function isSameOrDescendant(candidateId: string, rootId: string, categories: PublicCategory[]) {
  if (candidateId === rootId) {
    return true;
  }
  const byId = new Map(categories.map((category) => [category.id, category]));
  let cursor = byId.get(candidateId);
  let guard = 0;
  while (cursor?.parent_id && guard < 50) {
    if (cursor.parent_id === rootId) {
      return true;
    }
    cursor = byId.get(cursor.parent_id);
    guard += 1;
  }
  return false;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
