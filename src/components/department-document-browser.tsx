"use client";

import {
  Award,
  Archive,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  Grid2X2,
  Image as ImageIcon,
  LayoutGrid,
  Link as LinkIcon,
  List,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  Video,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContentViewTracker, MarkAsViewedButton } from "@/components/content-view-tracker";
import { ProtectedFileActions } from "@/components/protected-file-actions";
import { ProtectedMedia } from "@/components/protected-media";
import { Button } from "@/components/ui/button";
import {
  DRIVE_ITEM_MIME,
  DRIVE_ITEM_MOVED_EVENT,
  clearCurrentDriveDragItem,
  getCurrentDriveDragItem,
  hasDriveItem,
  moveRequestForItem,
  readDraggedItem,
  setCurrentDriveDragItem,
  type DriveDragItem,
  type DriveItemMovedDetail
} from "@/lib/drive-dnd";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import type { Category, ContentAudienceReceipt, DocumentFileVersion, DocumentListItem, FolderLink, Profile } from "@/types/app";

type ViewMode = "icons" | "large" | "list";
type TypeFilter = "all" | "folders" | "documents" | "images" | "videos" | "pdfs" | "links" | "others";
type ModifiedFilter = "all" | "recent" | "old" | "today" | "last7" | "last30" | "month" | "year";
type SortMode = "name_asc" | "name_desc" | "modified_desc" | "modified_asc";
type UnifiedDriveItem =
  | { kind: "document"; item: DocumentListItem; name: string; modifiedAt: string | null }
  | { kind: "link"; item: FolderLink; name: string; modifiedAt: string | null };
type FolderModal =
  | "folder-create"
  | "folder-edit"
  | "folder-move"
  | "link-create"
  | "link-edit"
  | "document-move"
  | "link-move"
  | "version-upload"
  | "versions"
  | "share"
  | null;

type ShareTarget = {
  resourceType: "category" | "document" | "folder_link";
  resourceId: string;
  name: string;
};

type DocumentEngagement = Pick<
  ContentAudienceReceipt,
  "content_id" | "is_viewed" | "viewed_at" | "open_count" | "total_active_seconds" | "last_opened_at"
>;

type FolderJourney = {
  total: number;
  viewed: number;
  opened: number;
  points: number;
  progress: number;
  focusedSeconds: number;
  level: string;
  nextStep: string;
};

type KnowledgeStatus = "new" | "started" | "viewed";

const modeOptions: Array<{ id: ViewMode; label: string; icon: typeof Grid2X2 }> = [
  { id: "icons", label: "Ícones", icon: Grid2X2 },
  { id: "large", label: "Ícones grandes", icon: LayoutGrid },
  { id: "list", label: "Lista", icon: List }
];

const typeOptions: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "folders", label: "Pastas" },
  { id: "documents", label: "Documentos" },
  { id: "images", label: "Imagens" },
  { id: "videos", label: "Vídeos" },
  { id: "pdfs", label: "PDFs" },
  { id: "links", label: "Links" },
  { id: "others", label: "Outros" }
];

const modifiedOptions: Array<{ id: ModifiedFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "recent", label: "Mais recentes" },
  { id: "old", label: "Mais antigos" },
  { id: "today", label: "Hoje" },
  { id: "last7", label: "Últimos 7 dias" },
  { id: "last30", label: "Últimos 30 dias" },
  { id: "month", label: "Este mês" },
  { id: "year", label: "Este ano" }
];

const sortOptions: Array<{ id: SortMode; label: string }> = [
  { id: "name_asc", label: "Nome A-Z" },
  { id: "name_desc", label: "Nome Z-A" },
  { id: "modified_desc", label: "Modificado mais recente" },
  { id: "modified_asc", label: "Modificado mais antigo" }
];

const STANDARD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const VIDEO_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

export function DepartmentDocumentBrowser({
  category,
  allCategories,
  subfolders,
  documents,
  folderLinks,
  fileVersions,
  documentEngagement,
  storageKey,
  profile
}: {
  category: Category;
  allCategories: Category[];
  subfolders: Category[];
  documents: DocumentListItem[];
  folderLinks: FolderLink[];
  fileVersions: DocumentFileVersion[];
  documentEngagement: DocumentEngagement[];
  storageKey: string;
  profile: Profile;
}) {
  const router = useRouter();
  const isAdmin = profile.role === "admin";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<ViewMode>("icons");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [modifiedFilter, setModifiedFilter] = useState<ModifiedFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("name_asc");
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState(documents);
  const [folders, setFolders] = useState(subfolders);
  const [links, setLinks] = useState(folderLinks);
  const [versions, setVersions] = useState(fileVersions);
  const [activeDocument, setActiveDocument] = useState<DocumentListItem | null>(null);
  const [activeLink, setActiveLink] = useState<FolderLink | null>(null);
  const [modal, setModal] = useState<FolderModal>(null);
  const [editingFolder, setEditingFolder] = useState<Category | null>(null);
  const [movingFolder, setMovingFolder] = useState<Category | null>(null);
  const [editingLink, setEditingLink] = useState<FolderLink | null>(null);
  const [movingDocument, setMovingDocument] = useState<DocumentListItem | null>(null);
  const [movingLink, setMovingLink] = useState<FolderLink | null>(null);
  const [versionDocument, setVersionDocument] = useState<DocumentListItem | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [uploadRows, setUploadRows] = useState<Array<{ name: string; status: string; ok?: boolean }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<DriveDragItem | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [movingTargetId, setMovingTargetId] = useState<string | null>(null);
  const [engagementByDocument, setEngagementByDocument] = useState<Map<string, DocumentEngagement>>(
    () => new Map(documentEngagement.map((entry) => [entry.content_id, entry]))
  );

  useEffect(() => {
    setEngagementByDocument(new Map(documentEngagement.map((entry) => [entry.content_id, entry])));
  }, [documentEngagement]);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "icons" || saved === "large" || saved === "list") {
      setMode(saved);
    }
  }, [storageKey]);

  useEffect(() => {
    const onDriveItemMoved = (event: Event) => {
      const detail = (event as CustomEvent<DriveItemMovedDetail>).detail;
      if (!detail?.item || detail.item.sourceCategoryId !== category.id || detail.targetCategoryId === category.id) {
        return;
      }

      if (detail.item.type === "document") {
        setItems((current) => current.filter((document) => document.id !== detail.item.id));
      }
      if (detail.item.type === "link") {
        setLinks((current) => current.filter((link) => link.id !== detail.item.id));
      }
      if (detail.item.type === "folder") {
        setFolders((current) => current.filter((folder) => folder.id !== detail.item.id));
      }
      setMessage(null);
      setSuccessMessage(`Item movido para a pasta ${detail.targetName}.`);
    };

    window.addEventListener(DRIVE_ITEM_MOVED_EVENT, onDriveItemMoved);
    return () => window.removeEventListener(DRIVE_ITEM_MOVED_EVENT, onDriveItemMoved);
  }, [category.id]);

  const versionsByDocument = useMemo(() => {
    const grouped = new Map<string, DocumentFileVersion[]>();
    versions.forEach((version) => {
      grouped.set(version.document_id, [...(grouped.get(version.document_id) ?? []), version]);
    });
    grouped.forEach((list) => list.sort((a, b) => b.version_number - a.version_number));
    return grouped;
  }, [versions]);

  const filteredFolders = useMemo(
    () =>
      folders
        .filter(() => typeFilter === "all" || typeFilter === "folders")
        .filter((folder) => matchesSearch(`${folder.name} ${folder.description ?? ""}`, query))
        .filter((folder) => matchesModifiedFilter(getFolderModifiedAt(folder), modifiedFilter))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true })),
    [folders, modifiedFilter, query, typeFilter]
  );
  const filteredDocuments = useMemo(
    () =>
      items
        .filter((document) => matchesDocumentType(document, typeFilter))
        .filter((document) => matchesSearch(`${document.title} ${document.summary ?? ""} ${document.current_file_version?.original_name ?? ""}`, query))
        .filter((document) => matchesModifiedFilter(getDocumentModifiedAt(document), modifiedFilter))
        .sort((a, b) => compareDriveItems(a.title, getDocumentModifiedAt(a), b.title, getDocumentModifiedAt(b), sortMode)),
    [items, modifiedFilter, query, sortMode, typeFilter]
  );
  const filteredLinks = useMemo(
    () =>
      links
        .filter(() => typeFilter === "all" || typeFilter === "links")
        .filter((link) => matchesSearch(`${link.title} ${link.description ?? ""} ${link.url}`, query))
        .filter((link) => matchesModifiedFilter(getLinkModifiedAt(link), modifiedFilter))
        .sort((a, b) => compareDriveItems(a.title, getLinkModifiedAt(a), b.title, getLinkModifiedAt(b), sortMode)),
    [links, modifiedFilter, query, sortMode, typeFilter]
  );
  const filteredContentItems = useMemo<UnifiedDriveItem[]>(
    () =>
      [
        ...filteredDocuments.map((document) => ({
          kind: "document" as const,
          item: document,
          name: document.title,
          modifiedAt: getDocumentModifiedAt(document)
        })),
        ...filteredLinks.map((folderLink) => ({
          kind: "link" as const,
          item: folderLink,
          name: folderLink.title,
          modifiedAt: getLinkModifiedAt(folderLink)
        }))
      ].sort((a, b) => compareDriveItems(a.name, a.modifiedAt, b.name, b.modifiedAt, sortMode)),
    [filteredDocuments, filteredLinks, sortMode]
  );
  const folderJourney = useMemo(() => buildFolderJourney(items, engagementByDocument), [engagementByDocument, items]);
  const filtersActive = query.trim().length > 0 || typeFilter !== "all" || !["all", "recent", "old"].includes(modifiedFilter);

  function markDocumentViewed(documentId: string, viewedAt: string) {
    setEngagementByDocument((current) => {
      const next = new Map(current);
      const existing = next.get(documentId);
      next.set(documentId, {
        content_id: documentId,
        is_viewed: true,
        viewed_at: viewedAt,
        open_count: Math.max(existing?.open_count ?? 0, 1),
        total_active_seconds: existing?.total_active_seconds ?? 0,
        last_opened_at: existing?.last_opened_at ?? viewedAt
      });
      return next;
    });
    setMessage(null);
    setSuccessMessage("Conteúdo concluído. Seu progresso nesta pasta foi atualizado.");
  }

  function changeMode(nextMode: ViewMode) {
    setMode(nextMode);
    window.localStorage.setItem(storageKey, nextMode);
  }

  function changeModifiedFilter(nextFilter: ModifiedFilter) {
    setModifiedFilter(nextFilter);
    if (nextFilter === "recent") {
      setSortMode("modified_desc");
    }
    if (nextFilter === "old") {
      setSortMode("modified_asc");
    }
  }

  function startItemDrag(event: React.DragEvent<HTMLElement>, item: DriveDragItem) {
    if (!isAdmin) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRIVE_ITEM_MIME, JSON.stringify(item));
    event.dataTransfer.setData("text/plain", `Movendo: ${item.name}`);
    setCurrentDriveDragItem(item);
    setDraggedItem(item);
    setSuccessMessage(null);
    setMessage(null);
  }

  function finishItemDrag() {
    clearCurrentDriveDragItem(draggedItem);
    setDraggedItem(null);
    setDropTargetId(null);
  }

  function dragOverFolder(event: React.DragEvent<HTMLElement>, folder: Category) {
    const item = draggedItem ?? getCurrentDriveDragItem() ?? readDraggedItem(event.dataTransfer);
    if (!isAdmin || !item || (item.type === "folder" && item.id === folder.id)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(folder.id);
  }

  async function dropIntoFolder(event: React.DragEvent<HTMLElement>, folder: Category) {
    event.preventDefault();
    event.stopPropagation();
    const item = draggedItem ?? getCurrentDriveDragItem() ?? readDraggedItem(event.dataTransfer);
    setDropTargetId(null);
    if (!isAdmin || !item || (item.type === "folder" && item.id === folder.id)) return;
    if (item.sourceCategoryId === folder.id) {
      setMessage("Este item ja esta nesta pasta.");
      return;
    }

    setMovingTargetId(folder.id);
    setMessage(null);
    setSuccessMessage(null);

    const request = moveRequestForItem(item, folder.id);
    const response = await fetch(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body)
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setMovingTargetId(null);
    setDraggedItem(null);
    clearCurrentDriveDragItem(item);

    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error ?? "Não foi possível mover o item.");
      return;
    }

    if (item.sourceCategoryId === category.id && item.type === "document") setItems((current) => current.filter((document) => document.id !== item.id));
    if (item.sourceCategoryId === category.id && item.type === "link") setLinks((current) => current.filter((link) => link.id !== item.id));
    if (item.sourceCategoryId === category.id && item.type === "folder") setFolders((current) => current.filter((candidate) => candidate.id !== item.id));
    setSuccessMessage(`Item movido para a pasta ${folder.name}.`);
    router.refresh();
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!isAdmin || files.length === 0) {
      return;
    }

    const selectedFiles = Array.from(files);
    const validationError = validateFolderUploadFiles(selectedFiles);
    if (validationError) {
      setDragging(false);
      setUploadRows([]);
      setSuccessMessage(null);
      setMessage(validationError);
      return;
    }

    setMessage(null);
    setSuccessMessage(null);
    setUploadRows(selectedFiles.map((file) => ({ name: file.name, status: "Enviando..." })));

    const videoFiles = selectedFiles.filter(isVideoUploadFile);
    const regularFiles = selectedFiles.filter((file) => !isVideoUploadFile(file));
    const results: FolderUploadResult[] = [];

    if (regularFiles.length > 0) {
      const formData = new FormData();
      formData.set("categoryId", category.id);
      regularFiles.forEach((file) => formData.append("files", file));

      const response = await fetchWithTimeout("/api/folders/upload", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => null)) as FolderUploadResponse | null;

      if (!payload?.results) {
        const error = payload?.error ?? "Não foi possível enviar os arquivos.";
        results.push(...regularFiles.map((file) => ({ ok: false, fileName: file.name, error, code: "UPLOAD_FAILED" })));
      } else {
        results.push(...payload.results);
      }
    }

    for (const file of videoFiles) {
      setUploadRows((current) =>
        current.map((row) => (row.name === file.name ? { ...row, status: "Enviando vídeo para o Storage..." } : row))
      );
      const result = await uploadVideoFileDirect(file, category.id);
      results.push(result);
      setUploadRows((current) =>
        current.map((row) =>
          row.name === file.name
            ? { ...row, status: result.ok ? result.warning ?? "Vídeo enviado." : result.error ?? "Falha no envio.", ok: result.ok }
            : row
        )
      );
    }

    const uploadedDocuments = results.filter(isSuccessfulUpload).map((result) => result.document);
    setItems((current) => mergeById(uploadedDocuments, current));
    setVersions((current) => mergeById(uploadedDocuments.map((document) => document.current_file_version).filter(Boolean), current));
    setUploadRows(
      results.map((result) => ({
        name: result.fileName,
        status: result.ok ? result.warning ?? "Enviado." : result.error ?? "Falha no envio.",
        ok: result.ok
      }))
    );
    if (results.length > 0 && results.every((result) => !result.ok)) {
      setMessage(results[0]?.error ?? "Não foi possível enviar os arquivos.");
    }
    router.refresh();
  }

  const gridClass =
    mode === "list" ? "grid gap-2" : mode === "large" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-3 sm:grid-cols-3 xl:grid-cols-4";

  return (
    <section
      className={cn(
        "space-y-5 transition",
        dragging && "rounded-xl border border-decorato-teal bg-decorato-teal/5 p-4"
      )}
      onDragOver={(event) => {
        if (!isAdmin) return;
        if (hasDriveItem(event.dataTransfer)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!hasDriveItem(event.dataTransfer)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!isAdmin) return;
        if (hasDriveItem(event.dataTransfer)) return;
        event.preventDefault();
        setDragging(false);
        void uploadFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept="application/pdf,image/png,image/jpeg,image/webp,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
        onChange={(event) => {
          const selected = event.currentTarget.files;
          if (selected) void uploadFiles(selected);
          event.currentTarget.value = "";
        }}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-decorato-ink">Conteúdo da pasta</h2>
          <p className="mt-1 text-sm text-decorato-muted">Explore arquivos, acompanhe seu progresso e retome de onde parou.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setModal("folder-create")}>
                <Plus aria-hidden="true" size={16} />
                Nova pasta
              </Button>
              <Button type="button" onClick={() => inputRef.current?.click()}>
                <Upload aria-hidden="true" size={16} />
                Enviar arquivo
              </Button>
              <Button type="button" variant="secondary" onClick={() => setModal("link-create")}>
                <LinkIcon aria-hidden="true" size={16} />
                Adicionar link
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <FolderJourneyPanel journey={folderJourney} />

      <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_auto] xl:items-end">
        <label className="relative block min-w-0">
          <span className="mb-1 block text-xs text-decorato-muted">Buscar nesta pasta</span>
          <Search aria-hidden="true" size={17} className="absolute bottom-3 left-3 text-decorato-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nesta pasta"
            className="h-11 w-full rounded-lg border border-decorato-line bg-white pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[640px]">
          <ToolbarSelect label="Tipo" value={typeFilter} onChange={(value) => setTypeFilter(value as TypeFilter)}>
            {typeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </ToolbarSelect>
          <ToolbarSelect label="Modificado" value={modifiedFilter} onChange={(value) => changeModifiedFilter(value as ModifiedFilter)}>
            {modifiedOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </ToolbarSelect>
          <ToolbarSelect label="Ordenar por" value={sortMode} onChange={(value) => setSortMode(value as SortMode)}>
            {sortOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </ToolbarSelect>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-decorato-muted">
          {filteredFolders.length + filteredLinks.length + filteredDocuments.length} item(ns) nesta visualização
        </p>
        <div className="inline-flex self-start rounded-lg border border-decorato-line bg-white p-1">
          {modeOptions.map((option) => {
            const Icon = option.icon;
            const active = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => changeMode(option.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
                  active ? "bg-decorato-teal text-white" : "text-decorato-muted hover:bg-decorato-paper"
                )}
                title={option.label}
                aria-label={option.label}
              >
                <Icon aria-hidden="true" size={16} />
                <span className="hidden md:inline">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {message ? <p role="alert" className="rounded-lg border border-decorato-coral/30 bg-decorato-coral/10 px-3 py-2 text-sm text-decorato-coral">{message}</p> : null}
      {successMessage ? <p aria-live="polite" className="rounded-lg border border-decorato-teal/30 bg-decorato-teal/10 px-3 py-2 text-sm text-decorato-teal">{successMessage}</p> : null}
      {uploadRows.length > 0 ? (
        <div className="grid gap-2 rounded-lg border border-decorato-line bg-decorato-paper/50 p-3">
          {uploadRows.map((row) => (
            <div key={row.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-decorato-ink">{row.name}</span>
              <span className={row.ok === false ? "text-decorato-coral" : "text-decorato-muted"}>{row.status}</span>
            </div>
          ))}
        </div>
      ) : null}

      {dragging ? (
        <div className="rounded-xl border border-dashed border-decorato-teal bg-decorato-teal/10 p-8 text-center text-sm text-decorato-ink">
          Solte os arquivos aqui para enviar para esta pasta.
        </div>
      ) : null}

      {filteredFolders.length + filteredContentItems.length > 0 ? (
        <div className={gridClass} aria-label="Itens da pasta">
          {filteredFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              mode={mode}
              isAdmin={isAdmin}
              dragging={draggedItem?.type === "folder" && draggedItem.id === folder.id}
              dropActive={dropTargetId === folder.id}
              moving={movingTargetId === folder.id}
              onDragStart={(event) => startItemDrag(event, { type: "folder", id: folder.id, name: folder.name, sourceCategoryId: folder.parent_id })}
              onDragEnd={finishItemDrag}
              onDragOver={(event) => dragOverFolder(event, folder)}
              onDragLeave={() => setDropTargetId((current) => (current === folder.id ? null : current))}
              onDrop={(event) => void dropIntoFolder(event, folder)}
              onOpen={() => router.push(`/app/categories/${folder.slug}`)}
              onEdit={() => {
                setEditingFolder(folder);
                setModal("folder-edit");
              }}
              onMove={() => {
                setMovingFolder(folder);
                setModal("folder-move");
              }}
              onShare={() => {
                setShareTarget({ resourceType: "category", resourceId: folder.id, name: folder.name });
                setModal("share");
              }}
              onAction={(action) => void runFolderAction(action, folder)}
            />
          ))}
          {filteredContentItems.map((entry) =>
            entry.kind === "link" ? (
              <FolderLinkItem
                key={`link-${entry.item.id}`}
                folderLink={entry.item}
                mode={mode}
                isAdmin={isAdmin}
                dragging={draggedItem?.type === "link" && draggedItem.id === entry.item.id}
                onDragStart={(event) => startItemDrag(event, { type: "link", id: entry.item.id, name: entry.item.title, sourceCategoryId: entry.item.category_id })}
                onDragEnd={finishItemDrag}
                onOpen={() => setActiveLink(entry.item)}
                onEdit={() => {
                  setEditingLink(entry.item);
                  setModal("link-edit");
                }}
                onMove={() => {
                  setMovingLink(entry.item);
                  setModal("link-move");
                }}
                onShare={() => {
                  setShareTarget({ resourceType: "folder_link", resourceId: entry.item.id, name: entry.item.title });
                  setModal("share");
                }}
                onAction={(action) => void runLinkAction(action, entry.item)}
              />
            ) : (
              <DocumentItem
                key={`document-${entry.item.id}`}
                document={entry.item}
                mode={mode}
                isAdmin={isAdmin}
                engagement={engagementByDocument.get(entry.item.id)}
                dragging={draggedItem?.type === "document" && draggedItem.id === entry.item.id}
                onDragStart={(event) => startItemDrag(event, { type: "document", id: entry.item.id, name: entry.item.title, sourceCategoryId: entry.item.category_id })}
                onDragEnd={finishItemDrag}
                onOpen={() => setActiveDocument(entry.item)}
                onVersion={() => {
                  setVersionDocument(entry.item);
                  setModal("version-upload");
                }}
                onVersions={() => {
                  setVersionDocument(entry.item);
                  setModal("versions");
                }}
                onMove={() => {
                  setMovingDocument(entry.item);
                  setModal("document-move");
                }}
                onShare={() => {
                  setShareTarget({ resourceType: "document", resourceId: entry.item.id, name: entry.item.title });
                  setModal("share");
                }}
                onAction={(action) => void runDocumentAction(action, entry.item)}
              />
            )
          )}
        </div>
      ) : null}

      {filteredFolders.length === 0 && filteredDocuments.length === 0 && filteredLinks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-decorato-line bg-decorato-paper/45 p-8 text-center">
          <Folder aria-hidden="true" size={34} className="mx-auto text-decorato-teal" />
          <h3 className="mt-3 text-lg font-semibold text-decorato-ink">
            {filtersActive ? "Nenhum item encontrado com este filtro" : "Esta pasta ainda esta vazia"}
          </h3>
          <p className="mt-1 text-sm text-decorato-muted">
            {filtersActive ? "Ajuste a busca, o tipo ou o periodo para ver outros itens." : "Crie uma pasta, envie arquivos ou adicione um link."}
          </p>
        </div>
      ) : null}

      {activeDocument ? (
        <DocumentModal
          document={activeDocument}
          versions={versionsByDocument.get(activeDocument.id) ?? []}
          engagement={engagementByDocument.get(activeDocument.id)}
          isAdmin={isAdmin}
          onViewed={(viewedAt) => markDocumentViewed(activeDocument.id, viewedAt)}
          onClose={() => setActiveDocument(null)}
        />
      ) : null}

      {activeLink ? <LinkModal folderLink={activeLink} onClose={() => setActiveLink(null)} /> : null}

      {modal === "folder-create" ? (
        <QuickFolderCreateModal
          currentCategory={category}
          existingNames={folders.map((folder) => folder.name)}
          onClose={() => setModal(null)}
          onSubmit={(name) =>
            saveFolder({
              name,
              parentId: category.id,
              description: "",
              sortOrder: 0,
              accessScope: category.access_scope === "global" ? "global" : "department"
            })
          }
        />
      ) : null}

      {modal === "folder-edit" ? (
        <FolderFormModal
          title="Editar pasta"
          folder={editingFolder}
          currentCategory={category}
          allCategories={allCategories}
          onClose={() => {
            setModal(null);
            setEditingFolder(null);
          }}
          onSubmit={(folderPayload) => void saveFolder(folderPayload)}
        />
      ) : null}

      {modal === "folder-move" && movingFolder ? (
        <MoveItemModal
          title="Mover pasta"
          itemName={movingFolder.name}
          allCategories={allCategories}
          currentCategoryId={movingFolder.parent_id ?? category.id}
          excludedCategoryIds={getCategoryDescendantIds(movingFolder.id, allCategories)}
          onClose={() => {
            setModal(null);
            setMovingFolder(null);
          }}
          onSubmit={(categoryId) => void moveFolder(movingFolder, categoryId)}
        />
      ) : null}

      {modal === "link-create" || modal === "link-edit" ? (
        <LinkFormModal
          title={modal === "link-create" ? "Adicionar link" : "Editar link"}
          folderLink={modal === "link-edit" ? editingLink : null}
          onClose={() => {
            setModal(null);
            setEditingLink(null);
          }}
          onSubmit={(payload) => void saveLink(payload)}
        />
      ) : null}

      {modal === "document-move" && movingDocument ? (
        <MoveItemModal
          title="Mover documento"
          itemName={movingDocument.title}
          allCategories={allCategories}
          currentCategoryId={movingDocument.category_id ?? category.id}
          onClose={() => {
            setModal(null);
            setMovingDocument(null);
          }}
          onSubmit={(categoryId) => void moveDocument(movingDocument, categoryId)}
        />
      ) : null}

      {modal === "link-move" && movingLink ? (
        <MoveItemModal
          title="Mover link"
          itemName={movingLink.title}
          allCategories={allCategories}
          currentCategoryId={movingLink.category_id}
          onClose={() => {
            setModal(null);
            setMovingLink(null);
          }}
          onSubmit={(categoryId) => void moveLink(movingLink, categoryId)}
        />
      ) : null}

      {modal === "version-upload" && versionDocument ? (
        <VersionUploadModal
          document={versionDocument}
          onClose={() => {
            setModal(null);
            setVersionDocument(null);
          }}
          onUploaded={(version) => {
            setVersions((current) =>
              current.map((item) => (item.document_id === version.document_id ? { ...item, is_current: false } : item)).concat(version)
            );
            setItems((current) => current.map((item) => (item.id === version.document_id ? { ...item, current_file_version: version } : item)));
            setModal(null);
            setVersionDocument(null);
            router.refresh();
          }}
        />
      ) : null}

      {modal === "versions" && versionDocument ? (
        <VersionsModal
          document={versionDocument}
          versions={versionsByDocument.get(versionDocument.id) ?? []}
          isAdmin={isAdmin}
          onClose={() => {
            setModal(null);
            setVersionDocument(null);
          }}
          onSetCurrent={(version) => void setCurrentVersion(version)}
        />
      ) : null}

      {modal === "share" && shareTarget ? (
        <ShareLinkModal
          target={shareTarget}
          onClose={() => {
            setModal(null);
            setShareTarget(null);
          }}
        />
      ) : null}
    </section>
  );

  async function saveFolder(folderPayload: FolderFormPayload): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch("/api/folders/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: folderPayload.id ? "update" : "create",
        folder: {
          id: folderPayload.id,
          parentId: folderPayload.parentId,
          name: folderPayload.name,
          description: folderPayload.description,
          sortOrder: folderPayload.sortOrder,
          accessScope: folderPayload.accessScope
        }
      })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; folder?: Category } | null;
    if (!response.ok || !payload?.ok || !payload.folder) {
      const error = payload?.error ?? "Não foi possível salvar a pasta.";
      setMessage(error);
      return { ok: false, error };
    }
    setFolders((current) => (folderPayload.id ? current.map((folder) => (folder.id === payload.folder?.id ? payload.folder : folder)) : [payload.folder!, ...current]));
    setModal(null);
    setEditingFolder(null);
    router.refresh();
    return { ok: true };
  }

  async function saveLink(linkPayload: LinkFormPayload) {
    const response = await fetch("/api/folders/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: linkPayload.id ? "update" : "create",
        link: {
          id: linkPayload.id,
          categoryId: category.id,
          title: linkPayload.title,
          url: linkPayload.url,
          description: linkPayload.description,
          sortOrder: linkPayload.sortOrder
        }
      })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; link?: FolderLink } | null;
    if (!response.ok || !payload?.ok || !payload.link) {
      setMessage(payload?.error ?? "Não foi possível salvar o link.");
      return;
    }
    setLinks((current) => (linkPayload.id ? current.map((link) => (link.id === payload.link?.id ? payload.link : link)) : [payload.link!, ...current]));
    setModal(null);
    setEditingLink(null);
    router.refresh();
  }

  async function runFolderAction(action: "copy" | "deactivate" | "reactivate" | "delete", folder: Category) {
    if (
      action === "delete" &&
      !window.confirm(
        "Esta pasta será movida para a Lixeira e poderá ser restaurada por até 30 dias. Se houver conteúdos dentro, eles também deixarão de aparecer para colaboradores."
      )
    ) {
      return;
    }
    const response = await fetch("/api/folders/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id: folder.id, parentId: category.id })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; folder?: Category } | null;
    if (!response.ok || !payload?.ok || !payload.folder) {
      setMessage(payload?.error ?? "Não foi possível atualizar a pasta.");
      return;
    }
    setFolders((current) =>
      action === "copy"
        ? [payload.folder!, ...current]
        : action === "delete"
          ? current.filter((item) => item.id !== folder.id)
          : current.map((item) => (item.id === payload.folder?.id ? payload.folder : item))
    );
    router.refresh();
  }

  async function runLinkAction(action: "copy" | "deactivate" | "reactivate" | "delete", folderLink: FolderLink) {
    if (
      action === "delete" &&
      !window.confirm("Este link será movido para a Lixeira e poderá ser restaurado por até 30 dias.")
    ) {
      return;
    }
    const response = await fetch("/api/folders/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id: folderLink.id, categoryId: category.id })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; link?: FolderLink } | null;
    if (!response.ok || !payload?.ok || !payload.link) {
      setMessage(payload?.error ?? "Não foi possível atualizar o link.");
      return;
    }
    setLinks((current) =>
      action === "copy"
        ? [payload.link!, ...current]
        : action === "delete"
          ? current.filter((item) => item.id !== folderLink.id)
          : current.map((item) => (item.id === payload.link?.id ? payload.link : item))
    );
    router.refresh();
  }

  async function moveLink(folderLink: FolderLink, categoryId: string) {
    const response = await fetch("/api/folders/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", id: folderLink.id, categoryId })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; link?: FolderLink } | null;
    if (!response.ok || !payload?.ok || !payload.link) {
      setMessage(payload?.error ?? "Não foi possível mover o link.");
      return;
    }
    setLinks((current) => current.filter((item) => item.id !== folderLink.id));
    setModal(null);
    setMovingLink(null);
    router.refresh();
  }

  async function moveFolder(folder: Category, parentId: string) {
    const response = await fetch("/api/folders/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", id: folder.id, parentId })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; folder?: Category } | null;
    if (!response.ok || !payload?.ok || !payload.folder) {
      setMessage(payload?.error ?? "Não foi possível mover a pasta.");
      return;
    }
    setFolders((current) => current.filter((item) => item.id !== folder.id));
    setSuccessMessage(`Item movido para a pasta ${allCategories.find((candidate) => candidate.id === parentId)?.name ?? "selecionada"}.`);
    setModal(null);
    setMovingFolder(null);
    router.refresh();
  }

  async function runDocumentAction(action: "copy" | "deactivate" | "reactivate" | "delete", document: DocumentListItem) {
    if (
      action === "delete" &&
      !window.confirm(
        "Este documento será movido para a Lixeira e poderá ser restaurado por até 30 dias. Arquivos físicos e versões não serão apagados agora."
      )
    ) {
      return;
    }
    const response = await fetch("/api/documents/drive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, documentId: document.id, categoryId: category.id })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; document?: DocumentListItem } | null;
    if (!response.ok || !payload?.ok || !payload.document) {
      setMessage(payload?.error ?? "Não foi possível atualizar o documento.");
      return;
    }
    setItems((current) =>
      action === "copy"
        ? [payload.document!, ...current]
        : action === "delete"
          ? current.filter((item) => item.id !== document.id)
          : current.map((item) => (item.id === payload.document?.id ? { ...item, ...payload.document } : item))
    );
    router.refresh();
  }

  async function moveDocument(document: DocumentListItem, categoryId: string) {
    const response = await fetch("/api/documents/drive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", documentId: document.id, categoryId })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; document?: DocumentListItem } | null;
    if (!response.ok || !payload?.ok || !payload.document) {
      setMessage(payload?.error ?? "Não foi possível mover o documento.");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== document.id));
    setModal(null);
    setMovingDocument(null);
    router.refresh();
  }

  async function setCurrentVersion(version: DocumentFileVersion) {
    const response = await fetch("/api/documents/drive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setCurrentVersion", versionId: version.id })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error ?? "Não foi possível alterar a versão vigente.");
      return;
    }
    setVersions((current) =>
      current.map((item) =>
        item.document_id === version.document_id ? { ...item, is_current: item.id === version.id } : item
      )
    );
    setItems((current) => current.map((item) => (item.id === version.document_id ? { ...item, current_file_version: version } : item)));
    router.refresh();
  }
}

function FolderJourneyPanel({ journey }: { journey: FolderJourney }) {
  if (journey.total === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-decorato-line bg-decorato-paper/70 px-4 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-decorato-sun/25 text-decorato-ink">
          <Sparkles aria-hidden="true" size={19} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-decorato-ink">A jornada desta pasta está pronta para começar</h3>
          <p className="mt-0.5 text-sm text-decorato-muted">Os conteúdos publicados aparecerão aqui com progresso e conquistas.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-decorato-teal/25 bg-[#f2fbfa]" aria-labelledby="folder-journey-title">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)]">
        <div className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-decorato-sun/30 text-decorato-ink">
              <Trophy aria-hidden="true" size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-decorato-teal">Jornada de conhecimento</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 id="folder-journey-title" className="text-lg font-semibold text-decorato-ink">{journey.level}</h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-decorato-muted shadow-sm">
                  <Award aria-hidden="true" size={14} className="text-decorato-sun" />
                  {journey.points} pontos
                </span>
              </div>
              <p className="mt-1 text-sm text-decorato-muted">{journey.nextStep}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-decorato-muted">
              <span>Domínio da pasta</span>
              <span>{journey.progress}%</span>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-white shadow-inner"
              role="progressbar"
              aria-label="Progresso na pasta"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={journey.progress}
            >
              <div className="h-full rounded-full bg-decorato-teal transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${journey.progress}%` }} />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-3 border-t border-decorato-teal/15 bg-white/70 lg:border-l lg:border-t-0">
          <JourneyMetric icon={CheckCircle2} label="Concluídos" value={`${journey.viewed}/${journey.total}`} tone="leaf" />
          <JourneyMetric icon={Eye} label="Abertos" value={`${journey.opened}`} tone="blue" />
          <JourneyMetric icon={Clock3} label="Tempo focado" value={formatFocusTime(journey.focusedSeconds)} tone="sun" />
        </dl>
      </div>
    </section>
  );
}

function JourneyMetric({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  tone: "leaf" | "blue" | "sun";
}) {
  const toneClass = tone === "leaf" ? "text-decorato-leaf" : tone === "blue" ? "text-decorato-blue" : "text-[#b77900]";
  return (
    <div className="flex min-w-0 flex-col justify-center border-r border-decorato-line px-3 py-4 last:border-r-0 sm:px-4">
      <Icon aria-hidden="true" size={17} className={toneClass} />
      <dd className="mt-2 truncate text-lg font-semibold text-decorato-ink">{value}</dd>
      <dt className="mt-0.5 text-xs text-decorato-muted">{label}</dt>
    </div>
  );
}

function FolderItem({
  folder,
  mode,
  isAdmin,
  dragging,
  dropActive,
  moving,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  onEdit,
  onMove,
  onShare,
  onAction
}: {
  folder: Category;
  mode: ViewMode;
  isAdmin: boolean;
  dragging: boolean;
  dropActive: boolean;
  moving: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onShare: () => void;
  onAction: (action: "copy" | "deactivate" | "reactivate" | "delete") => void;
}) {
  const inactive = !folder.is_active || Boolean(folder.deleted_at);
  const modifiedAt = getFolderModifiedAt(folder);
  if (mode === "list") {
    return (
      <article
        draggable={isAdmin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border border-decorato-line bg-white p-3 transition",
          isAdmin && "cursor-grab active:cursor-grabbing",
          dragging && "scale-[0.99] opacity-45",
          dropActive && "border-decorato-teal bg-decorato-teal/10 ring-2 ring-decorato-teal/25"
        )}
      >
        <Link href={`/app/categories/${folder.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-10 w-12 shrink-0 place-items-center rounded-md rounded-tl-xl bg-decorato-teal/10 text-decorato-teal">
            <Folder aria-hidden="true" size={21} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-decorato-ink">{folder.name}</span>
            <span className="block truncate text-xs text-decorato-muted">
              {moving ? "Movendo..." : dropActive ? "Mover para esta pasta" : formatModifiedDate(modifiedAt)}
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {inactive ? <StatusBadge label="Inativa" tone="muted" /> : null}
          {isAdmin ? <ActionsMenu onOpen={onOpen} onEdit={onEdit} onMove={onMove} onShare={onShare} onAction={onAction} inactive={inactive} /> : null}
        </div>
      </article>
    );
  }

  return (
    <article
      draggable={isAdmin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "rounded-lg border border-decorato-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft",
        mode === "large" && "p-5",
        isAdmin && "cursor-grab active:cursor-grabbing",
        dragging && "scale-[0.98] opacity-45",
        dropActive && "border-decorato-teal bg-decorato-teal/10 ring-2 ring-decorato-teal/25"
      )}
    >
      <Link href={`/app/categories/${folder.slug}`} className="block">
        <span className="inline-flex h-14 w-20 items-center justify-center rounded-md rounded-tl-2xl bg-decorato-teal/10 text-decorato-teal shadow-inner">
          <Folder aria-hidden="true" size={mode === "large" ? 32 : 24} />
        </span>
        <h4 className="mt-3 line-clamp-2 font-semibold text-decorato-ink">{folder.name}</h4>
        <p className="mt-1 text-xs text-decorato-muted">
          {moving ? "Movendo..." : dropActive ? "Mover para esta pasta" : formatModifiedDate(modifiedAt)}
        </p>
        {mode === "large" && folder.description ? <p className="mt-2 line-clamp-2 text-sm text-decorato-muted">{folder.description}</p> : null}
      </Link>
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusBadge label="Pasta" tone="teal" />
        {inactive ? <StatusBadge label="Inativa" tone="muted" /> : null}
        {isAdmin ? <ActionsMenu onOpen={onOpen} onEdit={onEdit} onMove={onMove} onShare={onShare} onAction={onAction} inactive={inactive} /> : null}
      </div>
    </article>
  );
}

function DocumentItem({
  document,
  mode,
  isAdmin,
  engagement,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onVersion,
  onVersions,
  onMove,
  onShare,
  onAction
}: {
  document: DocumentListItem;
  mode: ViewMode;
  isAdmin: boolean;
  engagement?: DocumentEngagement;
  dragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onVersion: () => void;
  onVersions: () => void;
  onMove: () => void;
  onShare: () => void;
  onAction: (action: "copy" | "deactivate" | "reactivate" | "delete") => void;
}) {
  const version = document.current_file_version;
  const inactive = document.is_active === false || Boolean(document.deleted_at);
  const modifiedAt = getDocumentModifiedAt(document);
  const kindLabel = getDocumentKindLabel(document);
  const knowledgeStatus = getKnowledgeStatus(document, engagement);

  if (mode === "list") {
    return (
      <article
        draggable={isAdmin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-decorato-line bg-white p-3 transition sm:flex-row sm:items-center sm:justify-between",
          isAdmin && "cursor-grab active:cursor-grabbing",
          dragging && "scale-[0.99] opacity-45"
        )}
      >
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <DocumentListThumbnail document={document} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-decorato-ink">{document.title}</span>
            <span className="mt-1 block text-xs text-decorato-muted">
              {version
                ? `${kindLabel} · Versão ${version.version_number} vigente · ${formatBytes(version.size_bytes)} · ${formatModifiedDate(modifiedAt)}`
                : `Documento · ${formatModifiedDate(modifiedAt)}`}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          {knowledgeStatus ? <KnowledgeStatusBadge status={knowledgeStatus} /> : null}
          <StatusBadge label="Vigente" tone="teal" />
          {inactive ? <StatusBadge label="Inativo" tone="muted" /> : null}
          {isAdmin ? <DocumentActions onOpen={onOpen} onVersion={onVersion} onVersions={onVersions} onMove={onMove} onShare={onShare} onAction={onAction} inactive={inactive} /> : null}
        </div>
      </article>
    );
  }

  return (
    <article
      draggable={isAdmin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-lg border border-decorato-line bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft",
        isAdmin && "cursor-grab active:cursor-grabbing",
        dragging && "scale-[0.98] opacity-45"
      )}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <DocumentThumbnail document={document} large={mode === "large"} />
        <div className={cn("p-4", mode === "large" && "p-5")}>
          <h4 className="line-clamp-2 font-semibold text-decorato-ink group-hover:text-decorato-teal">{document.title}</h4>
          <p className="mt-1 text-xs text-decorato-muted">
            {version ? `${kindLabel} · Versão ${version.version_number} · ${formatBytes(version.size_bytes)}` : kindLabel}
          </p>
          <p className="mt-1 text-xs text-decorato-muted">{formatModifiedDate(modifiedAt)}</p>
          {mode === "large" && document.summary ? <p className="mt-2 line-clamp-2 text-sm text-decorato-muted">{document.summary}</p> : null}
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-decorato-line px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {knowledgeStatus ? <KnowledgeStatusBadge status={knowledgeStatus} /> : null}
          <StatusBadge label="Vigente" tone="teal" />
          {inactive ? <StatusBadge label="Inativo" tone="muted" /> : null}
        </div>
        {isAdmin ? <DocumentActions onOpen={onOpen} onVersion={onVersion} onVersions={onVersions} onMove={onMove} onShare={onShare} onAction={onAction} inactive={inactive} /> : null}
      </div>
    </article>
  );
}

function FolderLinkItem({
  folderLink,
  mode,
  isAdmin,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onEdit,
  onMove,
  onShare,
  onAction
}: {
  folderLink: FolderLink;
  mode: ViewMode;
  isAdmin: boolean;
  dragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onShare: () => void;
  onAction: (action: "copy" | "deactivate" | "reactivate" | "delete") => void;
}) {
  const inactive = !folderLink.is_active || Boolean(folderLink.deleted_at);
  const modifiedAt = getLinkModifiedAt(folderLink);
  const content = (
    <>
      <span className="inline-flex rounded-xl bg-decorato-sky/30 p-3 text-decorato-ink">
        <LinkIcon aria-hidden="true" size={mode === "large" ? 28 : 22} />
      </span>
      <h4 className="mt-3 line-clamp-2 font-semibold text-decorato-ink">{folderLink.title}</h4>
      <p className="mt-1 line-clamp-2 text-sm text-decorato-muted">{folderLink.description || folderLink.url}</p>
      <p className="mt-2 text-xs text-decorato-muted">{formatModifiedDate(modifiedAt)}</p>
    </>
  );

  if (mode === "list") {
    return (
      <article
        draggable={isAdmin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border border-decorato-line bg-white p-3 transition",
          isAdmin && "cursor-grab active:cursor-grabbing",
          dragging && "scale-[0.99] opacity-45"
        )}
      >
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <LinkIcon aria-hidden="true" size={18} className="text-decorato-teal" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-decorato-ink">{folderLink.title}</span>
            <span className="block truncate text-xs text-decorato-muted">{folderLink.url}</span>
            <span className="block truncate text-xs text-decorato-muted">{formatModifiedDate(modifiedAt)}</span>
          </span>
        </button>
        {inactive ? <StatusBadge label="Inativo" tone="muted" /> : null}
        {isAdmin ? <ActionsMenu onOpen={onOpen} onEdit={onEdit} onMove={onMove} onShare={onShare} onAction={onAction} inactive={inactive} /> : null}
      </article>
    );
  }

  return (
    <article
      draggable={isAdmin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "rounded-lg border border-decorato-line bg-white p-4 shadow-sm transition",
        isAdmin && "cursor-grab active:cursor-grabbing",
        dragging && "scale-[0.98] opacity-45"
      )}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        {content}
      </button>
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusBadge label="Link" tone="teal" />
        {inactive ? <StatusBadge label="Inativo" tone="muted" /> : null}
        {isAdmin ? <ActionsMenu onOpen={onOpen} onEdit={onEdit} onMove={onMove} onShare={onShare} onAction={onAction} inactive={inactive} /> : null}
      </div>
    </article>
  );
}

function DocumentThumbnail({ document, large }: { document: DocumentListItem; large: boolean }) {
  const version = document.current_file_version;
  const height = large ? "h-44" : "h-28";
  const kindLabel = getDocumentKindLabel(document);
  const frameClass = cn(height, "relative overflow-hidden border-b border-decorato-line bg-decorato-paper");

  if (version?.mime_type.startsWith("image/")) {
    return (
      <div className={frameClass}>
        <ProtectedMedia
          storagePath={version.storage_path}
          initialUrl={document.thumbnail_url}
          mimeType={version.mime_type}
          alt={`Miniatura de ${version.original_name}`}
          variant="thumbnail"
          className="h-full w-full object-cover object-center"
        />
        <ThumbnailBadge icon={ImageIcon} label={kindLabel} />
      </div>
    );
  }

  if (version?.mime_type.startsWith("video/")) {
    return (
      <div className={cn(frameClass, "bg-decorato-ink")}>
        <ProtectedMedia
          storagePath={version.storage_path}
          initialUrl={document.thumbnail_url}
          mimeType={version.mime_type}
          alt={`Miniatura de ${version.original_name}`}
          variant="thumbnail"
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <ThumbnailBadge icon={Video} label={kindLabel} dark />
        <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <span className="grid h-11 w-11 place-items-center rounded-full border border-white/70 bg-decorato-ink/75 text-white shadow-sm">
            <Play size={19} className="translate-x-px" fill="currentColor" />
          </span>
        </span>
      </div>
    );
  }

  if (version?.mime_type === "application/pdf") {
    return (
      <div className={cn(frameClass, "bg-white")}>
        <ProtectedMedia
          storagePath={version.storage_path}
          initialUrl={document.thumbnail_url}
          mimeType={version.mime_type}
          alt={`Miniatura de ${version.original_name}`}
          variant="thumbnail"
          className="pointer-events-none h-full w-full bg-white"
        />
        <ThumbnailBadge icon={FileText} label="PDF" />
      </div>
    );
  }

  const extension = extensionFromName(version?.original_name ?? document.title).toUpperCase() || "ARQUIVO";
  const ThumbnailIcon = fileThumbnailIcon(version?.mime_type ?? null, extension);
  const tone = fileThumbnailTone(extension);
  return (
    <div className={cn(frameClass, tone.surface)}>
      <div className="absolute inset-x-6 top-5 space-y-2 opacity-65" aria-hidden="true">
        <span className="block h-1.5 w-3/4 rounded-full bg-white" />
        <span className="block h-1.5 w-full rounded-full bg-white" />
        <span className="block h-1.5 w-5/6 rounded-full bg-white" />
      </div>
      <span className={cn("absolute bottom-4 left-4 grid h-11 w-11 place-items-center rounded-lg bg-white shadow-sm", tone.icon)}>
        <ThumbnailIcon aria-hidden="true" size={large ? 25 : 21} />
      </span>
      <span className="absolute bottom-4 right-4 max-w-[55%] truncate rounded-md bg-white px-2 py-1 text-xs text-decorato-ink shadow-sm">
        {extension}
      </span>
    </div>
  );
}

function DocumentListThumbnail({ document }: { document: DocumentListItem }) {
  const version = document.current_file_version;
  const frameClass = "relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-decorato-line bg-decorato-paper";

  if (version?.mime_type.startsWith("image/")) {
    return (
      <div className={frameClass} aria-hidden="true">
        <ProtectedMedia
          storagePath={version.storage_path}
          initialUrl={document.thumbnail_url}
          mimeType={version.mime_type}
          alt=""
          variant="thumbnail"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (version?.mime_type.startsWith("video/")) {
    return (
      <div className={cn(frameClass, "bg-decorato-ink")} aria-hidden="true">
        <ProtectedMedia
          storagePath={version.storage_path}
          initialUrl={document.thumbnail_url}
          mimeType={version.mime_type}
          alt=""
          variant="thumbnail"
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-white">
          <Play size={15} fill="currentColor" />
        </span>
      </div>
    );
  }

  if (version?.mime_type === "application/pdf") {
    return (
      <div className={frameClass} aria-hidden="true">
        <ProtectedMedia
          storagePath={version.storage_path}
          initialUrl={document.thumbnail_url}
          mimeType={version.mime_type}
          alt=""
          variant="thumbnail"
          className="pointer-events-none h-full w-full bg-white"
        />
      </div>
    );
  }

  const extension = extensionFromName(version?.original_name ?? document.title).toUpperCase() || "ARQ";
  const ThumbnailIcon = fileThumbnailIcon(version?.mime_type ?? null, extension);
  const tone = fileThumbnailTone(extension);
  return (
    <div className={cn(frameClass, "grid place-items-center", tone.surface)} aria-hidden="true">
      <ThumbnailIcon size={20} className={tone.icon} />
      <span className="absolute bottom-0.5 right-1 rounded bg-white/90 px-1 text-[9px] text-decorato-muted">{extension}</span>
    </div>
  );
}

function ThumbnailBadge({ icon: Icon, label, dark = false }: { icon: typeof FileText; label: string; dark?: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs shadow-sm",
        dark ? "border border-white/30 bg-decorato-ink/75 text-white" : "border border-decorato-line bg-white/95 text-decorato-ink"
      )}
    >
      <Icon aria-hidden="true" size={13} />
      {label}
    </span>
  );
}

function DocumentModal({
  document,
  versions,
  engagement,
  isAdmin,
  onViewed,
  onClose
}: {
  document: DocumentListItem;
  versions: DocumentFileVersion[];
  engagement?: DocumentEngagement;
  isAdmin: boolean;
  onViewed: (viewedAt: string) => void;
  onClose: () => void;
}) {
  const currentVersion = versions.find((version) => version.is_current && version.is_active) ?? document.current_file_version ?? null;
  return (
    <BaseModal title={document.title} eyebrow={currentVersion ? `Versão ${currentVersion.version_number} vigente` : "Documento"} onClose={onClose} wide>
      <ContentViewTracker contentType="document" contentId={document.id} categoryId={document.category_id} />
      {currentVersion ? (
        <ProtectedMedia
          storagePath={currentVersion.storage_path}
          initialUrl={document.thumbnail_url}
          mimeType={currentVersion.mime_type}
          alt={currentVersion.original_name}
          controls
          className="max-h-[68vh] w-full rounded-lg bg-decorato-paper object-contain"
        />
      ) : (
        <div className="rounded-lg border border-decorato-line bg-decorato-paper p-5 text-sm text-decorato-muted">
          Este documento ainda não tem arquivo vigente. Use a página completa para ler o conteúdo textual.
        </div>
      )}
      {document.summary ? <p className="text-sm leading-6 text-decorato-muted">{document.summary}</p> : null}
      <div className="flex flex-wrap gap-2">
        <MarkAsViewedButton
          contentType="document"
          contentId={document.id}
          categoryId={document.category_id}
          initialViewed={engagement?.is_viewed ?? false}
          initialViewedAt={engagement?.viewed_at ?? null}
          onViewed={onViewed}
        />
        <Link href={`/app/documents/${document.slug}`} className="inline-flex items-center rounded-md bg-decorato-teal px-4 py-2 text-sm font-semibold text-white">
          Abrir página completa
        </Link>
        {currentVersion ? <ProtectedFileActions storagePath={currentVersion.storage_path} fileName={currentVersion.original_name} /> : null}
      </div>
      {isAdmin && versions.length > 0 ? (
        <div className="rounded-lg border border-decorato-line bg-white p-4">
          <h3 className="font-semibold text-decorato-ink">Versoes</h3>
          <div className="mt-3 grid gap-2">
            {versions.map((version) => (
              <VersionRow key={version.id} version={version} compact />
            ))}
          </div>
        </div>
      ) : null}
    </BaseModal>
  );
}

function LinkModal({ folderLink, onClose }: { folderLink: FolderLink; onClose: () => void }) {
  return (
    <BaseModal title={folderLink.title} eyebrow="Link da pasta" onClose={onClose}>
      <ContentViewTracker contentType="folder_link" contentId={folderLink.id} categoryId={folderLink.category_id} heartbeat={false} />
      {folderLink.description ? <p className="text-sm leading-6 text-decorato-muted">{folderLink.description}</p> : null}
      <a
        href={folderLink.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-decorato-teal px-4 py-2 text-sm font-semibold text-white"
      >
        <ExternalLink aria-hidden="true" size={16} />
        Abrir link em nova aba
      </a>
      <MarkAsViewedButton contentType="folder_link" contentId={folderLink.id} categoryId={folderLink.category_id} />
    </BaseModal>
  );
}

function QuickFolderCreateModal({
  currentCategory,
  existingNames,
  onClose,
  onSubmit
}: {
  currentCategory: Category;
  existingNames: string[];
  onClose: () => void;
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  async function submit() {
    const trimmed = name.trim();
    setError(null);
    if (trimmed.length < 2) {
      setError("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    if (normalizedNameExists(trimmed, existingNames)) {
      setError("Ja existe uma pasta com esse nome neste local.");
      return;
    }

    setPending(true);
    const result = await onSubmit(trimmed);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível criar a pasta.");
    }
  }

  return (
    <BaseModal title="Nova pasta" eyebrow={currentCategory.name} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="grid gap-1 text-sm text-decorato-ink">
          Nome da pasta
          <input
            ref={fieldRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className="h-11 rounded-md border border-decorato-line px-3 outline-none focus:ring-2 focus:ring-decorato-teal/30"
            placeholder="Ex.: Treinamentos"
          />
        </label>
        {error ? <p className="rounded-md bg-decorato-coral/10 p-2 text-sm text-decorato-coral">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || name.trim().length < 2}>
            {pending ? "Criando..." : "Criar"}
          </Button>
        </div>
      </form>
    </BaseModal>
  );
}

function FolderFormModal({
  title,
  folder,
  currentCategory,
  allCategories,
  onClose,
  onSubmit
}: {
  title: string;
  folder: Category | null;
  currentCategory: Category;
  allCategories: Category[];
  onClose: () => void;
  onSubmit: (payload: FolderFormPayload) => void;
}) {
  return (
    <BaseModal title={title} eyebrow="Pasta" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSubmit({
            id: folder?.id,
            name: String(form.get("name") ?? ""),
            description: String(form.get("description") ?? ""),
            parentId: String(form.get("parentId") ?? "") || null,
            sortOrder: Number(form.get("sortOrder") ?? 0),
            accessScope: String(form.get("accessScope") ?? "department") === "global" ? "global" : "department"
          });
        }}
      >
        <FormInput name="name" label="Nome" defaultValue={folder?.name ?? ""} required maxLength={80} />
        <label className="grid gap-1 text-sm text-decorato-ink">
          Pasta superior
          <select name="parentId" defaultValue={folder?.parent_id ?? currentCategory.id} className="h-10 rounded-md border border-decorato-line px-3">
            <option value="">Nenhuma</option>
            {allCategories
              .filter((candidate) => candidate.id !== folder?.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-decorato-ink">
          Escopo
          <select name="accessScope" defaultValue={folder?.access_scope ?? "department"} className="h-10 rounded-md border border-decorato-line px-3">
            <option value="department">Departamento/pasta</option>
            <option value="global">Global</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-decorato-ink">
          Descricao
          <textarea name="description" defaultValue={folder?.description ?? ""} maxLength={300} rows={3} className="rounded-md border border-decorato-line px-3 py-2" />
        </label>
        <FormInput name="sortOrder" label="Ordem" type="number" defaultValue={String(folder?.sort_order ?? 0)} />
        <Button type="submit">Salvar pasta</Button>
      </form>
    </BaseModal>
  );
}

function LinkFormModal({
  title,
  folderLink,
  onClose,
  onSubmit
}: {
  title: string;
  folderLink: FolderLink | null;
  onClose: () => void;
  onSubmit: (payload: LinkFormPayload) => void;
}) {
  return (
    <BaseModal title={title} eyebrow="Link" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSubmit({
            id: folderLink?.id,
            title: String(form.get("title") ?? ""),
            url: String(form.get("url") ?? ""),
            description: String(form.get("description") ?? ""),
            sortOrder: Number(form.get("sortOrder") ?? 0)
          });
        }}
      >
        <FormInput name="title" label="Titulo" defaultValue={folderLink?.title ?? ""} required maxLength={140} />
        <FormInput name="url" label="URL" defaultValue={folderLink?.url ?? ""} required type="url" />
        <label className="grid gap-1 text-sm text-decorato-ink">
          Descricao
          <textarea name="description" defaultValue={folderLink?.description ?? ""} maxLength={300} rows={3} className="rounded-md border border-decorato-line px-3 py-2" />
        </label>
        <FormInput name="sortOrder" label="Ordem" type="number" defaultValue={String(folderLink?.sort_order ?? 0)} />
        <Button type="submit">Salvar link</Button>
      </form>
    </BaseModal>
  );
}

function ShareLinkModal({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ShareLinkStatusResponse | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setShareUrl(null);
    fetch(`/api/share-links?resourceType=${target.resourceType}&resourceId=${target.resourceId}`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as ShareLinkStatusResponse | null;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error ?? "Não foi possível carregar o compartilhamento.");
        }
        if (active) {
          setStatus(payload);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar o compartilhamento.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [target.resourceId, target.resourceType]);

  async function generateLink() {
    setPending(true);
    setError(null);
    setCopied(false);
    const payload = await postShareAction("create", target);
    setPending(false);
    if (!payload.ok || !payload.shareUrl) {
      setError(payload.error ?? "Não foi possível gerar o link compartilhável.");
      return;
    }
    setShareUrl(payload.shareUrl);
    setStatus({ ok: true, isShared: true, link: payload.link ?? null });
  }

  async function revokeLink() {
    if (!window.confirm("O link compartilhável será desativado. Pessoas externas deixarão de acessar este item.")) {
      return;
    }
    setPending(true);
    setError(null);
    setCopied(false);
    const payload = await postShareAction("revoke", target);
    setPending(false);
    if (!payload.ok) {
      setError(payload.error ?? "Não foi possível desativar o link.");
      return;
    }
    setShareUrl(null);
    setStatus({ ok: true, isShared: false, link: null });
  }

  async function copyLink() {
    if (!shareUrl) {
      return;
    }
    await copyToClipboard(shareUrl);
    setCopied(true);
  }

  const isShared = Boolean(status?.isShared);

  return (
    <BaseModal title="Compartilhamento por link" eyebrow={target.name} onClose={onClose}>
      <div className="grid gap-4">
        <div className="rounded-lg border border-decorato-line bg-decorato-paper/40 p-3 text-sm text-decorato-muted">
          Pessoas sem login poderão acessar somente este item compartilhado. Links de arquivos são temporários e gerados com segurança quando a página compartilhada abre.
        </div>

        {loading ? <p className="text-sm text-decorato-muted">Carregando compartilhamento...</p> : null}

        {!loading && isShared ? (
          <div className="rounded-lg border border-decorato-teal/30 bg-decorato-teal/5 p-3 text-sm text-decorato-ink">
            <p className="font-semibold">Compartilhamento ativo</p>
            <p className="mt-1 text-decorato-muted">
              {shareUrl
                ? "Copie o link abaixo agora. Por segurança, o link completo não fica salvo em texto puro."
                : "Ja existe um link ativo. Gere um novo link se precisar copiar novamente."}
            </p>
            {status?.link?.accessCount !== undefined ? (
              <p className="mt-2 text-xs text-decorato-muted">Acessos registrados: {status.link.accessCount}</p>
            ) : null}
          </div>
        ) : null}

        {!loading && !isShared ? (
          <div className="rounded-lg border border-dashed border-decorato-line bg-white p-3 text-sm text-decorato-muted">
            Este item esta privado. Gere um link para liberar acesso externo.
          </div>
        ) : null}

        {shareUrl ? (
          <label className="grid gap-1 text-sm text-decorato-ink">
            Link compartilhavel
            <input readOnly value={shareUrl} className="h-10 rounded-md border border-decorato-line bg-white px-3 text-sm" onFocus={(event) => event.currentTarget.select()} />
          </label>
        ) : null}

        {error ? <p className="rounded-md bg-decorato-coral/10 p-2 text-sm text-decorato-coral">{error}</p> : null}
        {copied ? <p className="rounded-md bg-decorato-teal/10 p-2 text-sm text-decorato-teal">Link copiado.</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void generateLink()} disabled={pending || loading}>
            <Share2 aria-hidden="true" size={15} />
            {isShared ? "Gerar novo link" : "Gerar link compartilhavel"}
          </Button>
          {shareUrl ? (
            <Button type="button" variant="secondary" onClick={() => void copyLink()}>
              <Copy aria-hidden="true" size={15} />
              Copiar link
            </Button>
          ) : null}
          {isShared ? (
            <Button type="button" variant="secondary" onClick={() => void revokeLink()} disabled={pending || loading}>
              Desativar compartilhamento
            </Button>
          ) : null}
        </div>
      </div>
    </BaseModal>
  );
}

function MoveItemModal({
  title,
  itemName,
  allCategories,
  currentCategoryId,
  excludedCategoryIds = new Set<string>(),
  onClose,
  onSubmit
}: {
  title: string;
  itemName: string;
  allCategories: Category[];
  currentCategoryId: string;
  excludedCategoryIds?: Set<string>;
  onClose: () => void;
  onSubmit: (categoryId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const availableCategories = allCategories
    .filter((candidate) => !candidate.deleted_at && candidate.is_active && !excludedCategoryIds.has(candidate.id))
    .filter((candidate) => matchesSearch(candidate.name, query))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true }));
  const initialCategoryId = availableCategories.some((candidate) => candidate.id === currentCategoryId)
    ? currentCategoryId
    : availableCategories[0]?.id ?? "";

  return (
    <BaseModal title={title} eyebrow={itemName} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const categoryId = String(form.get("categoryId") ?? "");
          if (categoryId) {
            onSubmit(categoryId);
          }
        }}
      >
        <label className="grid gap-1 text-sm text-decorato-ink">
          Buscar pasta
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Digite o nome da pasta"
            className="h-10 rounded-md border border-decorato-line px-3 outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
        <label className="grid gap-1 text-sm text-decorato-ink">
          Pasta de destino
          <select name="categoryId" key={initialCategoryId} defaultValue={initialCategoryId} className="h-10 rounded-md border border-decorato-line px-3">
            {availableCategories.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        {availableCategories.length === 0 ? <p className="text-sm text-decorato-muted">Nenhuma pasta de destino disponível.</p> : null}
        <Button type="submit" disabled={availableCategories.length === 0}>Mover</Button>
      </form>
    </BaseModal>
  );
}

function VersionUploadModal({
  document,
  onClose,
  onUploaded
}: {
  document: DocumentListItem;
  onClose: () => void;
  onUploaded: (version: DocumentFileVersion) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <BaseModal title="Enviar nova versão" eyebrow={document.title} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          const form = new FormData(event.currentTarget);
          form.set("documentId", document.id);
          const response = await fetch("/api/documents/versions/upload", { method: "POST", body: form });
          const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; version?: DocumentFileVersion } | null;
          setPending(false);
          if (!response.ok || !payload?.ok || !payload.version) {
            setError(payload?.error ?? "Não foi possível enviar a nova versão.");
            return;
          }
          onUploaded(payload.version);
        }}
      >
        <input
          name="file"
          type="file"
          required
          accept="application/pdf,image/png,image/jpeg,image/webp,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          className="block w-full text-sm text-decorato-muted file:mr-4 file:rounded-md file:border-0 file:bg-decorato-paper file:px-3 file:py-2 file:text-decorato-ink"
        />
        <label className="grid gap-1 text-sm text-decorato-ink">
          Notas da versão
          <textarea name="notes" maxLength={1000} rows={3} className="rounded-md border border-decorato-line px-3 py-2" />
        </label>
        {error ? <p className="rounded-md bg-decorato-coral/10 p-2 text-sm text-decorato-coral">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Enviando..." : "Enviar nova versão"}
        </Button>
      </form>
    </BaseModal>
  );
}

function VersionsModal({
  document,
  versions,
  isAdmin,
  onClose,
  onSetCurrent
}: {
  document: DocumentListItem;
  versions: DocumentFileVersion[];
  isAdmin: boolean;
  onClose: () => void;
  onSetCurrent: (version: DocumentFileVersion) => void;
}) {
  return (
    <BaseModal title="Versoes do documento" eyebrow={document.title} onClose={onClose} wide>
      {versions.length === 0 ? (
        <p className="text-sm text-decorato-muted">Ainda não há versões de arquivo para este documento.</p>
      ) : (
        <div className="grid gap-3">
          {versions.map((version) => (
            <VersionRow key={version.id} version={version} onSetCurrent={isAdmin && !version.is_current ? () => onSetCurrent(version) : undefined} />
          ))}
        </div>
      )}
    </BaseModal>
  );
}

function VersionRow({
  version,
  onSetCurrent,
  compact = false
}: {
  version: DocumentFileVersion;
  onSetCurrent?: () => void;
  compact?: boolean;
}) {
  return (
    <article className="rounded-lg border border-decorato-line bg-decorato-paper/35 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-decorato-ink">
            Versão {version.version_number} · {version.original_name}
          </h4>
          <p className="mt-1 text-xs text-decorato-muted">
            {formatBytes(version.size_bytes)} · {formatDate(version.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={version.is_current ? "Vigente" : "Somente leitura"} tone={version.is_current ? "teal" : "muted"} />
          <ProtectedFileActions storagePath={version.storage_path} fileName={version.original_name} compact={compact} />
          {onSetCurrent ? (
            <Button type="button" variant="secondary" onClick={onSetCurrent}>
              <RefreshCw aria-hidden="true" size={15} />
              Tornar vigente
            </Button>
          ) : null}
        </div>
      </div>
      {version.notes ? <p className="mt-2 text-sm text-decorato-muted">{version.notes}</p> : null}
    </article>
  );
}

function ActionsMenu({
  onOpen,
  onEdit,
  onMove,
  onShare,
  onAction,
  inactive
}: {
  onOpen?: () => void;
  onEdit: () => void;
  onMove?: () => void;
  onShare?: () => void;
  onAction: (action: "copy" | "deactivate" | "reactivate" | "delete") => void;
  inactive: boolean;
}) {
  const actions = [
    ...(onOpen ? [{ icon: ExternalLink, label: "Abrir", onClick: onOpen }] : []),
    { icon: Pencil, label: "Editar", onClick: onEdit },
    ...(onMove ? [{ icon: Folder, label: "Mover", onClick: onMove }] : []),
    ...(onShare ? [{ icon: Share2, label: "Compartilhar", onClick: onShare }] : []),
    { icon: Copy, label: "Copiar", onClick: () => onAction("copy") },
    { icon: Archive, label: inactive ? "Reativar" : "Inativar", onClick: () => onAction(inactive ? "reactivate" : "deactivate") },
    { icon: Trash2, label: "Mover para lixeira", danger: true, onClick: () => onAction("delete") }
  ];

  return (
    <FloatingActions
      label="Abrir menu de ações"
      actions={actions}
    />
  );
}

function DocumentActions({
  onOpen,
  onVersion,
  onVersions,
  onMove,
  onShare,
  onAction,
  inactive
}: {
  onOpen: () => void;
  onVersion: () => void;
  onVersions: () => void;
  onMove: () => void;
  onShare: () => void;
  onAction: (action: "copy" | "deactivate" | "reactivate" | "delete") => void;
  inactive: boolean;
}) {
  const actions = [
    { icon: ExternalLink, label: "Abrir", onClick: onOpen },
    { icon: Upload, label: "Enviar nova versão", onClick: onVersion },
    { icon: List, label: "Ver versões", onClick: onVersions },
    { icon: Folder, label: "Mover", onClick: onMove },
    { icon: Share2, label: "Compartilhar", onClick: onShare },
    { icon: Copy, label: "Copiar", onClick: () => onAction("copy") },
    { icon: Archive, label: inactive ? "Reativar" : "Inativar", onClick: () => onAction(inactive ? "reactivate" : "deactivate") },
    { icon: Trash2, label: "Mover para lixeira", danger: true, onClick: () => onAction("delete") }
  ];

  return (
    <FloatingActions
      label="Abrir menu de ações do documento"
      width={232}
      actions={actions}
    />
  );
}

function FloatingActions({
  label,
  actions,
  width = 208
}: {
  label: string;
  actions: Array<{ icon: typeof Pencil; label: string; danger?: boolean; onClick: () => void }>;
  width?: number;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const gap = 8;
      const menuHeight = Math.min(actions.length * 42 + 12, 320);
      const top =
        rect.bottom + gap + menuHeight > window.innerHeight
          ? Math.max(12, rect.top - gap - menuHeight)
          : rect.bottom + gap;
      const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
      setPosition({ top, left });
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    updatePosition();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [actions.length, open, width]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-decorato-line bg-white text-decorato-muted hover:text-decorato-ink"
        aria-label={label}
        aria-expanded={open}
      >
        <MoreVertical aria-hidden="true" size={16} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="z-[1000] rounded-lg border border-decorato-line bg-white p-1 shadow-soft"
              role="menu"
              style={{ position: "fixed", top: position.top, left: position.left, width }}
            >
              {actions.map((action) => (
                <ActionButton
                  key={action.label}
                  icon={action.icon}
                  label={action.label}
                  danger={action.danger}
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                />
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function ActionButton({
  icon: Icon,
  label,
  danger = false,
  onClick
}: {
  icon: typeof Pencil;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-decorato-paper", danger ? "text-decorato-coral" : "text-decorato-ink")}
    >
      <Icon aria-hidden="true" size={15} />
      {label}
    </button>
  );
}

function KnowledgeStatusBadge({ status }: { status: KnowledgeStatus }) {
  const config = {
    viewed: {
      icon: CheckCircle2,
      label: "Concluído",
      className: "bg-decorato-leaf/15 text-decorato-leaf"
    },
    started: {
      icon: Clock3,
      label: "Em andamento",
      className: "bg-decorato-sun/25 text-[#8a5a00]"
    },
    new: {
      icon: Sparkles,
      label: "Novo",
      className: "bg-decorato-sky/35 text-decorato-blue"
    }
  }[status];
  const Icon = config.icon;

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs", config.className)}>
      <Icon aria-hidden="true" size={12} />
      {config.label}
    </span>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "teal" | "muted" }) {
  return (
    <span className={cn("rounded-full px-2 py-1 text-xs", tone === "teal" ? "bg-decorato-teal/10 text-decorato-teal" : "bg-decorato-paper text-decorato-muted")}>
      {label}
    </span>
  );
}

function ToolbarSelect({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs text-decorato-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-lg border border-decorato-line bg-white px-3 text-sm text-decorato-ink outline-none focus:ring-2 focus:ring-decorato-teal/30"
      >
        {children}
      </select>
    </label>
  );
}

function BaseModal({
  title,
  eyebrow,
  onClose,
  children,
  wide = false
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-decorato-ink/45 p-4" role="dialog" aria-modal="true">
      <div className={cn("max-h-[92vh] w-full overflow-y-auto rounded-xl border border-decorato-line bg-white shadow-soft", wide ? "max-w-5xl" : "max-w-xl")}>
        <div className="flex items-start justify-between gap-3 border-b border-decorato-line p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-decorato-teal">{eyebrow}</p>
            <h2 className="mt-1 text-2xl font-semibold text-decorato-ink">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-decorato-line text-decorato-muted hover:text-decorato-ink"
            aria-label="Fechar"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}

function FormInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="grid gap-1 text-sm text-decorato-ink">
      {label}
      <input {...props} className="h-10 rounded-md border border-decorato-line px-3" />
    </label>
  );
}

function matchesSearch(text: string, query: string) {
  const normalized = normalizeText(query);
  if (!normalized) return true;
  return normalizeText(text).includes(normalized);
}

function validateFolderUploadFiles(files: File[]) {
  for (const file of files) {
    const limit = isVideoUploadFile(file) ? VIDEO_UPLOAD_LIMIT_BYTES : STANDARD_UPLOAD_LIMIT_BYTES;
    if (file.size > limit) {
      return `Arquivo muito grande. "${file.name}" tem mais de ${Math.round(limit / 1024 / 1024)} MB.`;
    }
  }
  return null;
}

function isVideoUploadFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm|mpeg|mpg|m4v|3gp|wmv|flv|mts|m2ts)$/i.test(file.name);
}

async function uploadVideoFileDirect(file: File, categoryId: string): Promise<FolderUploadResult> {
  const mimeType = videoMimeType(file);
  const start = await postJson<VideoUploadStartResponse>(
    "/api/folders/video-upload/start",
    {
      categoryId,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size
    },
    30_000
  );

  if (!start.ok || !start.storagePath || !start.token || !start.bucket) {
    return { ok: false, fileName: file.name, error: start.error ?? "Não foi possível preparar o envio do vídeo.", code: start.code };
  }

  try {
    const supabase = createSupabaseBrowserClient();
    const upload = await withTimeout(
      supabase.storage.from(start.bucket).uploadToSignedUrl(start.storagePath, start.token, file, {
        contentType: start.mimeType ?? mimeType
      }),
      videoUploadTimeoutMs(file.size)
    );

    if (upload.error) {
      return {
        ok: false,
        fileName: file.name,
        error: storageUploadErrorMessage(upload.error),
        code: isStorageSizeError(upload.error) ? "STORAGE_FILE_TOO_LARGE" : "STORAGE_UPLOAD_FAILED"
      };
    }
  } catch (error) {
    return {
      ok: false,
      fileName: file.name,
      error: error instanceof Error ? error.message : "Não foi possível enviar o vídeo.",
      code: "STORAGE_UPLOAD_FAILED"
    };
  }

  const complete = await postJson<VideoUploadCompleteResponse>(
    "/api/folders/video-upload/complete",
    {
      categoryId,
      storagePath: start.storagePath,
      originalName: file.name,
      mimeType: start.mimeType ?? mimeType,
      sizeBytes: file.size
    },
    45_000
  );

  if (!complete.ok || !complete.document) {
    return { ok: false, fileName: file.name, error: complete.error ?? "Vídeo enviado, mas não foi possível registrar o documento.", code: complete.code };
  }

  return {
    ok: true,
    fileName: file.name,
    document: complete.document,
    warning: complete.warning ?? "Vídeo enviado."
  };
}


function storageUploadErrorMessage(error: unknown) {
  if (isStorageSizeError(error)) {
    return "O Storage recusou o vídeo por tamanho. O limite por arquivo é 50 MB; confirme também que o limite global do Supabase está em 50 MB.";
  }
  return "Não foi possível enviar o vídeo para o Storage.";
}

function isStorageSizeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { message?: unknown; error?: unknown; code?: unknown; statusCode?: unknown };
  const details = [candidate.message, candidate.error, candidate.code, candidate.statusCode]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();

  return details.includes("entitytoolarge") || details.includes("payload too large") || details.includes("413");
}

async function postJson<T extends { ok?: boolean; error?: string; code?: string }>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    timeoutMs
  );
  const payload = (await response.json().catch(() => null)) as T | null;
  if (payload) {
    return payload;
  }
  return { ok: false, error: "Resposta invalida do servidor.", code: "INVALID_RESPONSE" } as T;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 180_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("O envio demorou demais. Verifique a conexao e tente novamente.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error("O envio demorou demais. Verifique a conexao e tente novamente.")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

function videoUploadTimeoutMs(sizeBytes: number) {
  return Math.max(180_000, Math.min(900_000, Math.ceil(sizeBytes / (512 * 1024)) * 1000));
}

function videoMimeType(file: File) {
  if (file.type.startsWith("video/")) {
    return file.type;
  }
  const extension = extensionFromName(file.name);
  const types: Record<string, string> = {
    "3gp": "video/3gpp",
    avi: "video/x-msvideo",
    flv: "video/x-flv",
    m2ts: "video/mp2t",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    mts: "video/mp2t",
    webm: "video/webm",
    wmv: "video/x-ms-wmv"
  };
  return types[extension] ?? "video/unknown";
}

function getCategoryDescendantIds(categoryId: string, categories: Category[]) {
  const blocked = new Set<string>([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    categories.forEach((candidate) => {
      if (candidate.parent_id && blocked.has(candidate.parent_id) && !blocked.has(candidate.id)) {
        blocked.add(candidate.id);
        changed = true;
      }
    });
  }
  return blocked;
}

function compareDriveItems(aName: string, aDate: string | null, bName: string, bDate: string | null, sort: SortMode) {
  if (sort === "name_desc") {
    return bName.localeCompare(aName, "pt-BR", { sensitivity: "base", numeric: true });
  }
  if (sort === "modified_desc") {
    return timestamp(bDate) - timestamp(aDate) || aName.localeCompare(bName, "pt-BR", { sensitivity: "base", numeric: true });
  }
  if (sort === "modified_asc") {
    return timestamp(aDate) - timestamp(bDate) || aName.localeCompare(bName, "pt-BR", { sensitivity: "base", numeric: true });
  }
  return aName.localeCompare(bName, "pt-BR", { sensitivity: "base", numeric: true });
}

function matchesModifiedFilter(value: string | null, filter: ModifiedFilter) {
  if (filter === "all" || filter === "recent" || filter === "old") return true;
  const itemDate = value ? new Date(value) : null;
  if (!itemDate || Number.isNaN(itemDate.getTime())) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const itemTime = itemDate.getTime();

  if (filter === "today") return itemTime >= startOfToday;
  if (filter === "last7") return itemTime >= Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (filter === "last30") return itemTime >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (filter === "month") return itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
  if (filter === "year") return itemDate.getFullYear() === now.getFullYear();
  return true;
}

function matchesDocumentType(document: DocumentListItem, filter: TypeFilter) {
  if (filter === "all") return true;
  if (filter === "folders" || filter === "links") return false;
  return getDocumentKind(document) === filter;
}

function getDocumentKind(document: DocumentListItem): Exclude<TypeFilter, "all" | "folders" | "links"> {
  const version = document.current_file_version;
  if (!version) return "documents";
  const mime = version?.mime_type.toLowerCase() ?? "";
  const extension = extensionFromName(version?.original_name ?? document.title);

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp"].includes(extension)) return "images";
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm", "mpeg", "mpg", "m4v", "3gp", "wmv", "flv", "mts", "m2ts"].includes(extension)) return "videos";
  if (mime === "application/pdf" || extension === "pdf") return "pdfs";
  if (
    mime.startsWith("text/") ||
    mime.includes("word") ||
    mime.includes("excel") ||
    mime.includes("powerpoint") ||
    mime.includes("spreadsheet") ||
    mime.includes("presentation") ||
    ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "ods", "odp"].includes(extension)
  ) {
    return "documents";
  }
  return "others";
}

function getDocumentKindLabel(document: DocumentListItem) {
  const labels: Record<ReturnType<typeof getDocumentKind>, string> = {
    documents: "Documento",
    images: "Imagem",
    videos: "Vídeo",
    pdfs: "PDF",
    others: "Arquivo"
  };
  return labels[getDocumentKind(document)];
}

function getFolderModifiedAt(folder: Category) {
  return folder.updated_at ?? folder.created_at ?? null;
}

function getLinkModifiedAt(link: FolderLink) {
  return link.updated_at ?? link.created_at ?? null;
}

function getDocumentModifiedAt(document: DocumentListItem) {
  return latestDate(document.current_file_version?.created_at ?? null, document.updated_at ?? document.created_at ?? null);
}

function latestDate(...values: Array<string | null | undefined>) {
  const valid = values.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  return valid.sort((a, b) => timestamp(b) - timestamp(a))[0];
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function extensionFromName(name: string) {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toLowerCase() : "";
}

function getKnowledgeStatus(document: DocumentListItem, engagement?: DocumentEngagement): KnowledgeStatus | null {
  if (document.status !== "published" || document.is_active === false || document.deleted_at) {
    return null;
  }
  if (engagement?.is_viewed) {
    return "viewed";
  }
  if ((engagement?.open_count ?? 0) > 0 || (engagement?.total_active_seconds ?? 0) > 0) {
    return "started";
  }
  return "new";
}

function buildFolderJourney(items: DocumentListItem[], engagementByDocument: Map<string, DocumentEngagement>): FolderJourney {
  const published = items.filter((item) => item.status === "published" && item.is_active !== false && !item.deleted_at);
  const summary = published.reduce(
    (result, item) => {
      const engagement = engagementByDocument.get(item.id);
      const viewed = Boolean(engagement?.is_viewed);
      const opened = viewed || (engagement?.open_count ?? 0) > 0 || (engagement?.total_active_seconds ?? 0) > 0;
      const focusedSeconds = Math.max(0, engagement?.total_active_seconds ?? 0);
      const focusPoints = Math.min(20, Math.floor(focusedSeconds / 30) * 2);
      const itemPoints = viewed ? 100 : opened ? 30 + focusPoints : 0;

      result.viewed += viewed ? 1 : 0;
      result.opened += opened ? 1 : 0;
      result.points += itemPoints;
      result.focusedSeconds += focusedSeconds;
      return result;
    },
    { viewed: 0, opened: 0, points: 0, focusedSeconds: 0 }
  );
  const total = published.length;
  const progress = total > 0 ? Math.round((summary.points / (total * 100)) * 100) : 0;
  const level =
    progress === 100
      ? "Pasta dominada"
      : progress >= 75
        ? "Quase lá"
        : progress >= 40
          ? "Em evolução"
          : progress > 0
            ? "Explorador"
            : "Primeiro passo";
  const nextStep =
    progress === 100
      ? "Você concluiu todos os conteúdos publicados desta pasta."
      : progress === 0
        ? "Abra seu primeiro conteúdo e comece a construir seu progresso."
        : `${summary.viewed} de ${total} conteúdos concluídos. Continue de onde parou.`;

  return { total, progress, level, nextStep, ...summary };
}

function formatFocusTime(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}min`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

function fileThumbnailIcon(mimeType: string | null, extension: string) {
  const normalizedExtension = extension.toLowerCase();
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.includes("spreadsheet") || mime.includes("excel") || ["xls", "xlsx", "ods", "csv"].includes(normalizedExtension)) {
    return FileSpreadsheet;
  }
  if (mime.includes("presentation") || mime.includes("powerpoint") || ["ppt", "pptx", "odp"].includes(normalizedExtension)) {
    return Presentation;
  }
  if (mime.includes("word") || mime.startsWith("text/") || ["doc", "docx", "odt", "rtf", "txt"].includes(normalizedExtension)) {
    return FileType2;
  }
  return FileText;
}

function fileThumbnailTone(extension: string) {
  const normalizedExtension = extension.toLowerCase();
  if (["xls", "xlsx", "ods", "csv"].includes(normalizedExtension)) {
    return { surface: "bg-decorato-leaf/20", icon: "text-decorato-leaf" };
  }
  if (["ppt", "pptx", "odp"].includes(normalizedExtension)) {
    return { surface: "bg-decorato-coral/15", icon: "text-decorato-coral" };
  }
  if (["doc", "docx", "odt", "rtf", "txt"].includes(normalizedExtension)) {
    return { surface: "bg-decorato-sky/35", icon: "text-decorato-blue" };
  }
  return { surface: "bg-decorato-teal/10", icon: "text-decorato-teal" };
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizedNameExists(name: string, names: string[]) {
  const normalized = normalizeText(name);
  return names.some((candidate) => normalizeText(candidate) === normalized);
}

function mergeById<T extends { id: string }>(incoming: T[], current: T[]) {
  const map = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => map.set(item.id, item));
  return Array.from(map.values());
}

function isSuccessfulUpload(result: FolderUploadResult): result is FolderUploadResult & { ok: true; document: DocumentListItem & { current_file_version: DocumentFileVersion } } {
  return Boolean(result.ok && result.document);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatModifiedDate(value: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `Atualizado hoje às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `Modificado em ${date.toLocaleDateString("pt-BR")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function postShareAction(action: "create" | "revoke", target: ShareTarget): Promise<ShareLinkMutationResponse> {
  const response = await fetch("/api/share-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      resourceType: target.resourceType,
      resourceId: target.resourceId
    })
  });
  const payload = (await response.json().catch(() => null)) as ShareLinkMutationResponse | null;
  if (!response.ok || !payload) {
    return { ok: false, error: payload?.error ?? "Não foi possível atualizar o compartilhamento." };
  }
  return payload;
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

type FolderFormPayload = {
  id?: string;
  parentId: string | null;
  name: string;
  description: string;
  sortOrder: number;
  accessScope: "department" | "global";
};

type LinkFormPayload = {
  id?: string;
  title: string;
  url: string;
  description: string;
  sortOrder: number;
};

type FolderUploadResult = {
  ok: boolean;
  fileName: string;
  error?: string;
  code?: string;
  warning?: string;
  document?: DocumentListItem & { current_file_version?: DocumentFileVersion | null };
};

type FolderUploadResponse = {
  ok?: boolean;
  error?: string;
  results?: FolderUploadResult[];
};

type VideoUploadStartResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  bucket?: string;
  storagePath?: string;
  token?: string;
  mimeType?: string;
};

type VideoUploadCompleteResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  warning?: string;
  document?: DocumentListItem & { current_file_version?: DocumentFileVersion | null };
};

type ShareLinkInfo = {
  id: string;
  tokenHint: string;
  expiresAt?: string | null;
  createdAt?: string | null;
  lastAccessedAt?: string | null;
  accessCount?: number;
};

type ShareLinkStatusResponse = {
  ok?: boolean;
  error?: string;
  isShared?: boolean;
  link?: ShareLinkInfo | null;
};

type ShareLinkMutationResponse = ShareLinkStatusResponse & {
  shareUrl?: string;
};
