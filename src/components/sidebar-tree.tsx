"use client";

import { ChevronDown, ChevronRight, Folder, Home, Menu, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  DRIVE_ITEM_MOVED_EVENT,
  clearCurrentDriveDragItem,
  getCurrentDriveDragItem,
  hasDriveItem,
  moveRequestForItem,
  readDraggedItem,
  type DriveDragItem,
  type DriveItemMovedDetail
} from "@/lib/drive-dnd";
import type { Category } from "@/types/app";
import { cn } from "@/lib/utils";

type TreeNode = Category & { children: TreeNode[] };

export function SidebarTree({
  categories,
  homeHref = "/app",
  showMobileButton = true,
  showDesktop = true,
  isAdmin = false
}: {
  categories: Category[];
  homeHref?: string;
  showMobileButton?: boolean;
  showDesktop?: boolean;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tree = useMemo(() => buildTree(categories), [categories]);

  return (
    <>
      {showMobileButton ? (
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-decorato-line bg-white text-decorato-ink lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
        >
          <Menu aria-hidden="true" size={18} />
        </button>
      ) : null}

      {showDesktop ? (
        <aside className="hidden min-h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-decorato-line bg-white/82 p-4 lg:block">
          <SidebarContent tree={tree} homeHref={homeHref} isAdmin={isAdmin} />
        </aside>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-decorato-ink/20"
            onClick={() => setOpen(false)}
          />
          <aside className="relative h-full w-[86vw] max-w-sm overflow-y-auto bg-white p-4 shadow-soft">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-decorato-line"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <SidebarContent tree={tree} homeHref={homeHref} isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function SidebarContent({
  tree,
  homeHref,
  isAdmin,
  onNavigate
}: {
  tree: TreeNode[];
  homeHref: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [blockedTargetId, setBlockedTargetId] = useState<string | null>(null);
  const [movingTargetId, setMovingTargetId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function moveItemToNode(item: DriveDragItem, node: TreeNode) {
    if (!isAdmin) return;
    if (item.sourceCategoryId === node.id) {
      setMessage("Este item ja esta nesta pasta.");
      return;
    }

    setMovingTargetId(node.id);
    setMessage(null);
    const request = moveRequestForItem(item, node.id);
    const response = await fetch(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body)
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setMovingTargetId(null);
    setDropTargetId(null);
    setBlockedTargetId(null);

    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error ?? "Nao foi possivel mover o item.");
      return;
    }

    window.dispatchEvent(
      new CustomEvent<DriveItemMovedDetail>(DRIVE_ITEM_MOVED_EVENT, {
        detail: { item, targetCategoryId: node.id, targetName: node.name }
      })
    );
    setMessage(`Item movido para ${node.name}.`);
    router.refresh();
  }

  return (
    <nav aria-label="Departamentos" className="space-y-2">
      <Link
        href={homeHref}
        onClick={onNavigate}
        className="mb-4 flex items-center gap-2 rounded-lg border border-decorato-teal/25 bg-decorato-teal/10 px-3 py-2.5 text-sm font-semibold text-decorato-ink shadow-sm transition hover:-translate-y-0.5 hover:border-decorato-teal/40 hover:bg-decorato-teal/15"
      >
        <Home aria-hidden="true" size={17} className="shrink-0 text-decorato-teal" />
        <span>Início</span>
      </Link>
      {tree.map((node) => (
        <SidebarNode
          key={node.id}
          node={node}
          isAdmin={isAdmin}
          dropTargetId={dropTargetId}
          blockedTargetId={blockedTargetId}
          movingTargetId={movingTargetId}
          onNavigate={onNavigate}
          onMoveItem={moveItemToNode}
          isInvalidDrop={(item, target) => isInvalidFolderDrop(tree, item, target)}
          onDropTargetChange={setDropTargetId}
          onBlockedTargetChange={setBlockedTargetId}
        />
      ))}
      {message ? <p className="rounded-md border border-decorato-teal/20 bg-decorato-teal/10 px-3 py-2 text-xs text-decorato-ink">{message}</p> : null}
    </nav>
  );
}

function SidebarNode({
  node,
  depth = 0,
  isAdmin,
  dropTargetId,
  blockedTargetId,
  movingTargetId,
  onNavigate,
  onMoveItem,
  isInvalidDrop,
  onDropTargetChange,
  onBlockedTargetChange
}: {
  node: TreeNode;
  depth?: number;
  isAdmin: boolean;
  dropTargetId: string | null;
  blockedTargetId: string | null;
  movingTargetId: string | null;
  onNavigate?: () => void;
  onMoveItem: (item: DriveDragItem, node: TreeNode) => Promise<void>;
  isInvalidDrop: (item: DriveDragItem, target: TreeNode) => boolean;
  onDropTargetChange: (id: string | null) => void;
  onBlockedTargetChange: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasChildren = node.children.length > 0;
  const dropActive = dropTargetId === node.id;
  const dropBlocked = blockedTargetId === node.id;
  const moving = movingTargetId === node.id;

  function clearExpandTimer() {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  }

  function dragOverNode(event: React.DragEvent<HTMLAnchorElement>) {
    if (!isAdmin || !hasDriveItem(event.dataTransfer)) return;
    const item = getCurrentDriveDragItem() ?? readDraggedItem(event.dataTransfer);
    if (!item) return;

    event.preventDefault();
    event.stopPropagation();
    const blocked = isInvalidDrop(item, node);
    event.dataTransfer.dropEffect = blocked ? "none" : "move";
    onBlockedTargetChange(blocked ? node.id : null);
    onDropTargetChange(blocked ? null : node.id);

    if (!blocked && hasChildren && !expanded && !expandTimerRef.current) {
      expandTimerRef.current = setTimeout(() => {
        setExpanded(true);
        expandTimerRef.current = null;
      }, 700);
    }
  }

  function dragLeaveNode() {
    clearExpandTimer();
    onDropTargetChange((dropTargetId === node.id ? null : dropTargetId) as string | null);
    onBlockedTargetChange((blockedTargetId === node.id ? null : blockedTargetId) as string | null);
  }

  async function dropOnNode(event: React.DragEvent<HTMLAnchorElement>) {
    if (!isAdmin || !hasDriveItem(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    clearExpandTimer();
    const item = getCurrentDriveDragItem() ?? readDraggedItem(event.dataTransfer);
    onDropTargetChange(null);
    onBlockedTargetChange(null);
    if (!item || isInvalidDrop(item, node)) return;
    await onMoveItem(item, node);
    clearCurrentDriveDragItem(item);
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={expanded ? "Recolher departamento" : "Expandir departamento"}
          className={cn(
            "h-7 w-7 shrink-0 rounded text-decorato-muted hover:bg-decorato-paper",
            !hasChildren && "invisible"
          )}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
        </button>
        <Link
          href={`/app/categories/${node.slug}`}
          onClick={onNavigate}
          onDragOver={dragOverNode}
          onDragLeave={dragLeaveNode}
          onDrop={(event) => void dropOnNode(event)}
          className={cn(
            "relative flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-2 text-sm text-decorato-ink transition",
            dropActive
              ? "border-decorato-teal bg-decorato-teal/12 ring-2 ring-decorato-teal/20"
              : dropBlocked
                ? "border-decorato-coral/40 bg-decorato-coral/10"
                : "border-transparent hover:bg-decorato-paper",
            moving && "opacity-70"
          )}
          style={{ paddingLeft: `${depth * 10 + 8}px` }}
        >
          <Folder aria-hidden="true" size={16} className="shrink-0 text-decorato-teal" />
          <span className="truncate">{node.name}</span>
          {dropActive ? <span className="ml-auto shrink-0 text-[10px] text-decorato-teal">Soltar aqui</span> : null}
          {dropBlocked ? <span className="ml-auto shrink-0 text-[10px] text-decorato-coral">Bloqueado</span> : null}
          {moving ? <span className="ml-auto shrink-0 text-[10px] text-decorato-muted">Movendo...</span> : null}
        </Link>
      </div>
      {expanded && hasChildren ? (
        <div className="ml-5 border-l border-decorato-line pl-1">
          {node.children.map((child) => (
            <SidebarNode
              key={child.id}
              node={child}
              depth={depth + 1}
              isAdmin={isAdmin}
              dropTargetId={dropTargetId}
              blockedTargetId={blockedTargetId}
              movingTargetId={movingTargetId}
              onNavigate={onNavigate}
              onMoveItem={onMoveItem}
              isInvalidDrop={isInvalidDrop}
              onDropTargetChange={onDropTargetChange}
              onBlockedTargetChange={onBlockedTargetChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function isInvalidFolderDrop(tree: TreeNode[], item: DriveDragItem, target: TreeNode) {
  if (item.type !== "folder") {
    return false;
  }
  if (item.id === target.id) {
    return true;
  }
  const sourceNode = findTreeNode(tree, item.id);
  return sourceNode ? treeContainsId(sourceNode, target.id) : false;
}

function findTreeNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = findTreeNode(node.children, id);
    if (child) {
      return child;
    }
  }
  return null;
}

function treeContainsId(node: TreeNode, id: string): boolean {
  return node.children.some((child) => child.id === id || treeContainsId(child, id));
}

function buildTree(categories: Category[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  categories.forEach((category) => {
    nodes.set(category.id, { ...category, children: [] });
  });

  nodes.forEach((node) => {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortTree = (items: TreeNode[]) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    items.forEach((item) => sortTree(item.children));
  };

  sortTree(roots);
  return roots;
}
