import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { PurgeExpiredTrashButton, TrashItemActions } from "@/components/trash-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams?: Promise<{
    type?: string;
    department?: string;
    actor?: string;
    period?: string;
    q?: string;
  }>;
};

type TrashType = "document" | "folder" | "link" | "attachment" | "document_version" | "announcement";

type TrashItem = {
  id: string;
  type: TrashType;
  typeLabel: string;
  name: string;
  folderId: string | null;
  folderName: string;
  deletedBy: string | null;
  deletedByName: string;
  deletedAt: string;
  expiresAt: string | null;
  sizeBytes: number | null;
  detail?: string | null;
};

export default async function AdminTrashPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const selectedType = isTrashType(params.type) ? params.type : "all";
  const selectedDepartment = params.department && params.department !== "all" ? params.department : null;
  const selectedActor = params.actor && params.actor !== "all" ? params.actor : null;
  const selectedPeriod = ["7", "30", "90"].includes(params.period ?? "") ? Number(params.period) : null;
  const query = (params.q ?? "").trim().toLowerCase();
  const supabase = await createSupabaseServerClient();

  const [
    { data: documents },
    { data: folders },
    { data: links },
    { data: attachments },
    { data: versions },
    { data: announcements },
    { data: categories },
    { data: profiles },
    { data: allDocuments }
  ] = await Promise.all([
    supabase
      .from("documents")
      .select("id,title,category_id,deleted_at,deleted_by,trash_expires_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(500),
    supabase
      .from("categories")
      .select("id,name,parent_id,deleted_at,deleted_by,trash_expires_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(500),
    supabase
      .from("folder_links")
      .select("id,title,category_id,deleted_at,deleted_by,trash_expires_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(500),
    supabase
      .from("attachments")
      .select("id,original_name,size_bytes,document_id,deleted_at,deleted_by,trash_expires_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(500),
    supabase
      .from("document_file_versions")
      .select("id,original_name,size_bytes,document_id,version_number,deleted_at,deleted_by,trash_expires_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(500),
    supabase
      .from("announcements")
      .select("id,title,body,status_before_delete,banner_enabled,popup_enabled,deleted_at,deleted_by,trash_expires_at")
      .not("deleted_at", "is", null)
      .is("permanently_deleted_at", null)
      .order("deleted_at", { ascending: false })
      .limit(500),
    supabase.from("categories").select("id,name,parent_id").limit(2000),
    supabase.from("profiles").select("id,username,email,full_name").limit(2000),
    supabase.from("documents").select("id,title,category_id").limit(2000)
  ]);

  const categoryById = new Map(((categories as CategoryRow[] | null) ?? []).map((category) => [category.id, category]));
  const profileById = new Map(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]));
  const documentById = new Map(((allDocuments as DocumentRefRow[] | null) ?? []).map((document) => [document.id, document]));
  const rows = [
    ...(((documents as DocumentTrashRow[] | null) ?? []).map((item): TrashItem => ({
      id: item.id,
      type: "document",
      typeLabel: "Documento",
      name: item.title,
      folderId: item.category_id,
      folderName: categoryName(item.category_id, categoryById),
      deletedBy: item.deleted_by,
      deletedByName: profileName(item.deleted_by, profileById),
      deletedAt: item.deleted_at,
      expiresAt: item.trash_expires_at,
      sizeBytes: null
    }))),
    ...(((folders as FolderTrashRow[] | null) ?? []).map((item): TrashItem => ({
      id: item.id,
      type: "folder",
      typeLabel: "Pasta",
      name: item.name,
      folderId: item.parent_id,
      folderName: item.parent_id ? categoryName(item.parent_id, categoryById) : "Raiz",
      deletedBy: item.deleted_by,
      deletedByName: profileName(item.deleted_by, profileById),
      deletedAt: item.deleted_at,
      expiresAt: item.trash_expires_at,
      sizeBytes: null
    }))),
    ...(((links as LinkTrashRow[] | null) ?? []).map((item): TrashItem => ({
      id: item.id,
      type: "link",
      typeLabel: "Link",
      name: item.title,
      folderId: item.category_id,
      folderName: categoryName(item.category_id, categoryById),
      deletedBy: item.deleted_by,
      deletedByName: profileName(item.deleted_by, profileById),
      deletedAt: item.deleted_at,
      expiresAt: item.trash_expires_at,
      sizeBytes: null
    }))),
    ...(((attachments as AttachmentTrashRow[] | null) ?? []).map((item): TrashItem => {
      const doc = item.document_id ? documentById.get(item.document_id) : null;
      return {
        id: item.id,
        type: "attachment",
        typeLabel: "Anexo",
        name: item.original_name,
        folderId: doc?.category_id ?? null,
        folderName: doc?.category_id ? categoryName(doc.category_id, categoryById) : "Documento removido",
        deletedBy: item.deleted_by,
        deletedByName: profileName(item.deleted_by, profileById),
        deletedAt: item.deleted_at,
        expiresAt: item.trash_expires_at,
        sizeBytes: item.size_bytes
      };
    })),
    ...(((versions as VersionTrashRow[] | null) ?? []).map((item): TrashItem => {
      const doc = documentById.get(item.document_id);
      return {
        id: item.id,
        type: "document_version",
        typeLabel: "Versao",
        name: `${item.original_name} v${item.version_number}`,
        folderId: doc?.category_id ?? null,
        folderName: doc?.category_id ? categoryName(doc.category_id, categoryById) : "Documento removido",
        deletedBy: item.deleted_by,
        deletedByName: profileName(item.deleted_by, profileById),
        deletedAt: item.deleted_at,
        expiresAt: item.trash_expires_at,
        sizeBytes: item.size_bytes
      };
    })),
    ...(((announcements as AnnouncementTrashRow[] | null) ?? []).map((item): TrashItem => ({
      id: item.id,
      type: "announcement",
      typeLabel: "Comunicado",
      name: item.title,
      folderId: null,
      folderName: "Comunicação interna",
      deletedBy: item.deleted_by,
      deletedByName: profileName(item.deleted_by, profileById),
      deletedAt: item.deleted_at,
      expiresAt: item.trash_expires_at,
      sizeBytes: null,
      detail: [
        item.status_before_delete ? `Status anterior: ${humanStatus(item.status_before_delete)}` : null,
        item.banner_enabled ? "Banner" : null,
        item.popup_enabled ? "Popup" : null,
        item.body ? item.body.slice(0, 120) : null
      ].filter(Boolean).join(" · ")
    })))
  ]
    .filter((item) => (selectedType === "all" ? true : item.type === selectedType))
    .filter((item) => (selectedDepartment ? item.folderId === selectedDepartment : true))
    .filter((item) => (selectedActor ? item.deletedBy === selectedActor : true))
    .filter((item) => {
      if (!selectedPeriod) return true;
      return new Date(item.deletedAt).getTime() >= Date.now() - selectedPeriod * 24 * 60 * 60 * 1000;
    })
    .filter((item) => (query ? `${item.name} ${item.folderName} ${item.deletedByName}`.toLowerCase().includes(query) : true))
    .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());

  const activeProfiles = ((profiles as ProfileRow[] | null) ?? []).filter((profile) => profile.full_name || profile.username || profile.email);
  const activeCategories = ((categories as CategoryRow[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wide text-decorato-teal">Administração</p>
          <h1 className="mt-1 text-3xl font-semibold text-decorato-ink">Lixeira</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-decorato-muted">
            Itens movidos para a lixeira ficam disponíveis para restauração por 30 dias. Arquivos físicos não são removidos imediatamente.
          </p>
        </div>
        <PurgeExpiredTrashButton />
      </header>

      <form className="grid gap-3 rounded-xl border border-decorato-line bg-white p-4 shadow-sm md:grid-cols-5">
        <Select name="type" label="Tipo" defaultValue={selectedType}>
          <option value="all">Todos</option>
          <option value="document">Documentos</option>
          <option value="folder">Pastas</option>
          <option value="link">Links</option>
          <option value="announcement">Comunicados</option>
          <option value="attachment">Anexos</option>
          <option value="document_version">Versões</option>
        </Select>
        <Select name="department" label="Departamento/pasta" defaultValue={selectedDepartment ?? "all"}>
          <option value="all">Todos</option>
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select name="actor" label="Quem moveu" defaultValue={selectedActor ?? "all"}>
          <option value="all">Todos</option>
          {activeProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profileName(profile.id, profileById)}
            </option>
          ))}
        </Select>
        <Select name="period" label="Período" defaultValue={selectedPeriod ? String(selectedPeriod) : "all"}>
          <option value="all">Todos</option>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="90">90 dias</option>
        </Select>
        <label className="grid gap-1 text-sm text-decorato-ink">
          Buscar
          <input
            name="q"
            defaultValue={params.q ?? ""}
            className="h-10 rounded-md border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            placeholder="Nome, pasta ou pessoa"
          />
        </label>
        <button className="h-10 rounded-md bg-decorato-teal px-4 text-sm font-semibold text-white md:col-span-5 lg:col-span-1" type="submit">
          Filtrar
        </button>
      </form>

      <section className="overflow-hidden rounded-xl border border-decorato-line bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-decorato-line bg-decorato-paper px-4 py-3 text-sm text-decorato-muted">
          <Trash2 aria-hidden="true" size={17} />
          {rows.length} item(ns) na lixeira
        </div>
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-decorato-line text-sm">
              <thead className="bg-white text-left text-decorato-muted">
                <tr>
                  <th className="px-4 py-3 font-normal">Nome</th>
                  <th className="px-4 py-3 font-normal">Tipo</th>
                  <th className="px-4 py-3 font-normal">Pasta original</th>
                  <th className="px-4 py-3 font-normal">Movido por</th>
                  <th className="px-4 py-3 font-normal">Movido em</th>
                  <th className="px-4 py-3 font-normal">Exclusão definitiva</th>
                  <th className="px-4 py-3 font-normal">Tamanho</th>
                  <th className="px-4 py-3 font-normal">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-decorato-line">
                {rows.map((item) => {
                  const days = daysRemaining(item.expiresAt);
                  return (
                    <tr key={`${item.type}:${item.id}`} className="align-top">
                      <td className="px-4 py-3 font-semibold text-decorato-ink">
                        {item.name}
                        {item.detail ? <span className="mt-1 block max-w-md text-xs font-normal text-decorato-muted">{item.detail}</span> : null}
                      </td>
                      <td className="px-4 py-3">{item.typeLabel}</td>
                      <td className="px-4 py-3">{item.folderName}</td>
                      <td className="px-4 py-3">{item.deletedByName}</td>
                      <td className="px-4 py-3">{formatDateTime(item.deletedAt)}</td>
                      <td className="px-4 py-3">
                        <span className={days <= 0 ? "text-decorato-coral" : "text-decorato-muted"}>
                          {item.expiresAt ? `${formatDate(item.expiresAt)} · ${days <= 0 ? "expirado" : `${days} dia(s)`}` : "Sem prazo"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{item.sizeBytes ? formatBytes(item.sizeBytes) : "-"}</td>
                      <td className="px-4 py-3">
                        <TrashItemActions itemType={item.type} itemId={item.id} canPermanentlyDelete={days <= 0} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-decorato-muted">Nenhum item encontrado na lixeira para este filtro.</div>
        )}
      </section>
    </div>
  );
}

function Select({
  name,
  label,
  defaultValue,
  children
}: {
  name: string;
  label: string;
  defaultValue: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm text-decorato-ink">
      {label}
      <select name={name} defaultValue={defaultValue} className="h-10 rounded-md border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30">
        {children}
      </select>
    </label>
  );
}

function isTrashType(value: string | undefined): value is TrashType {
  return value === "document" || value === "folder" || value === "link" || value === "attachment" || value === "document_version" || value === "announcement";
}

function humanStatus(value: string) {
  if (value === "published") return "Publicado";
  if (value === "archived") return "Arquivado";
  return "Rascunho";
}

function categoryName(categoryId: string | null, categories: Map<string, CategoryRow>) {
  if (!categoryId) return "Sem pasta";
  return categories.get(categoryId)?.name ?? "Pasta removida";
}

function profileName(profileId: string | null, profiles: Map<string, ProfileRow>) {
  if (!profileId) return "Sistema";
  const profile = profiles.get(profileId);
  return profile?.full_name || profile?.username || profile?.email || profileId.slice(0, 8);
}

function daysRemaining(expiresAt: string | null) {
  if (!expiresAt) return 0;
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type CategoryRow = { id: string; name: string; parent_id: string | null };
type ProfileRow = { id: string; username: string | null; email: string | null; full_name: string | null };
type DocumentRefRow = { id: string; title: string; category_id: string | null };
type DocumentTrashRow = { id: string; title: string; category_id: string | null; deleted_at: string; deleted_by: string | null; trash_expires_at: string | null };
type FolderTrashRow = { id: string; name: string; parent_id: string | null; deleted_at: string; deleted_by: string | null; trash_expires_at: string | null };
type LinkTrashRow = { id: string; title: string; category_id: string; deleted_at: string; deleted_by: string | null; trash_expires_at: string | null };
type AttachmentTrashRow = { id: string; original_name: string; size_bytes: number; document_id: string | null; deleted_at: string; deleted_by: string | null; trash_expires_at: string | null };
type VersionTrashRow = { id: string; original_name: string; size_bytes: number; document_id: string; version_number: number; deleted_at: string; deleted_by: string | null; trash_expires_at: string | null };
type AnnouncementTrashRow = {
  id: string;
  title: string;
  body: string;
  status_before_delete: string | null;
  banner_enabled: boolean;
  popup_enabled: boolean;
  deleted_at: string;
  deleted_by: string | null;
  trash_expires_at: string | null;
};
