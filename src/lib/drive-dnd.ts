export type DriveDragItem = {
  type: "document" | "link" | "folder";
  id: string;
  name: string;
  sourceCategoryId?: string | null;
};

export type DriveItemMovedDetail = {
  item: DriveDragItem;
  targetCategoryId: string;
  targetName: string;
};

export const DRIVE_ITEM_MIME = "application/x-dcoratto-drive-item";
export const DRIVE_ITEM_MOVED_EVENT = "dcoratto:drive-item-moved";

let currentDriveDragItem: DriveDragItem | null = null;

export function setCurrentDriveDragItem(item: DriveDragItem) {
  currentDriveDragItem = item;
}

export function getCurrentDriveDragItem() {
  return currentDriveDragItem;
}

export function clearCurrentDriveDragItem(item?: DriveDragItem | null) {
  if (!item || currentDriveDragItem?.id === item.id) {
    currentDriveDragItem = null;
  }
}

export function hasDriveItem(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(DRIVE_ITEM_MIME);
}

export function readDraggedItem(dataTransfer: DataTransfer): DriveDragItem | null {
  const raw = dataTransfer.getData(DRIVE_ITEM_MIME);
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<DriveDragItem>;
    if (
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      (candidate.type === "document" || candidate.type === "link" || candidate.type === "folder")
    ) {
      return {
        type: candidate.type,
        id: candidate.id,
        name: candidate.name,
        sourceCategoryId: typeof candidate.sourceCategoryId === "string" || candidate.sourceCategoryId === null ? candidate.sourceCategoryId : undefined
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function moveRequestForItem(item: DriveDragItem, categoryId: string) {
  if (item.type === "document") {
    return { url: "/api/documents/drive", body: { action: "move", documentId: item.id, categoryId } };
  }
  if (item.type === "link") {
    return { url: "/api/folders/links", body: { action: "move", id: item.id, categoryId } };
  }
  return { url: "/api/folders/actions", body: { action: "move", id: item.id, parentId: categoryId } };
}
