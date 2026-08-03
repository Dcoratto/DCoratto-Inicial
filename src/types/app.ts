export type UserRole = "admin" | "viewer";
export type DocumentStatus = "draft" | "published" | "archived";

export type Profile = {
  id: string;
  username: string | null;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  department: string | null;
  department_id?: string | null;
  department_category_id?: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at?: string;
  updated_at?: string;
};

export type Department = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
};

export type Category = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  archived_at?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  trash_expires_at?: string | null;
  delete_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  department_id?: string | null;
  department_category_id?: string | null;
  is_department?: boolean;
  access_scope?: "department" | "global";
  department?: Pick<Department, "name" | "slug"> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DocumentListItem = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  category_id: string | null;
  status: DocumentStatus;
  created_at?: string | null;
  updated_at: string;
  tags: string[];
  is_active?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  trash_expires_at?: string | null;
  delete_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  current_file_version?: DocumentFileVersion | null;
  thumbnail_url?: string | null;
};

export type DocumentDetail = DocumentListItem & {
  content_json: ContentBlock[];
  content_text: string;
  version: number;
  published_at: string | null;
  archived_at: string | null;
  category?: Pick<Category, "name" | "slug"> | null;
};

export type ContentBlock =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "list"; items: string[] }
  | { id: string; type: "checklist"; items: Array<{ text: string; checked: boolean }> }
  | { id: string; type: "table"; rows: string[][] }
  | { id: string; type: "link"; label: string; url: string };

export type Announcement = {
  id: string;
  title: string;
  body: string;
  status: DocumentStatus;
  published_at: string | null;
  media_storage_path?: string | null;
  media_original_name?: string | null;
  media_mime_type?: string | null;
  media_size_bytes?: number | null;
  popup_media_storage_path?: string | null;
  popup_media_original_name?: string | null;
  popup_media_mime_type?: string | null;
  popup_media_size_bytes?: number | null;
  popup_media_width?: number | null;
  popup_media_height?: number | null;
  popup_media_duration_seconds?: number | null;
  banner_image_storage_path?: string | null;
  banner_image_original_name?: string | null;
  banner_image_mime_type?: string | null;
  banner_image_size_bytes?: number | null;
  banner_image_width?: number | null;
  banner_image_height?: number | null;
  popup_enabled?: boolean;
  popup_starts_at?: string | null;
  popup_ends_at?: string | null;
  banner_enabled?: boolean;
  banner_starts_at?: string | null;
  banner_ends_at?: string | null;
  popup_active?: boolean;
  banner_active?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  trash_expires_at?: string | null;
  delete_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  status_before_delete?: DocumentStatus | null;
  permanently_deleted_at?: string | null;
  permanently_deleted_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type Attachment = {
  id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  deleted_at?: string | null;
  deleted_by?: string | null;
  trash_expires_at?: string | null;
  delete_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  signedUrl?: string | null;
};

export type DocumentFileVersion = {
  id: string;
  document_id: string;
  version_number: number;
  attachment_id: string | null;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string | null;
  notes: string | null;
  is_current: boolean;
  is_active: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  trash_expires_at?: string | null;
  delete_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  created_by: string | null;
  created_at: string;
};

export type FolderLink = {
  id: string;
  category_id: string;
  title: string;
  url: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  deleted_by?: string | null;
  trash_expires_at?: string | null;
  delete_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type OnboardingTrack = {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  department_category_id?: string | null;
};

export type OnboardingItem = {
  id: string;
  track_id: string;
  title: string;
  description: string | null;
  document_id: string | null;
  video_url: string | null;
  attachment_id?: string | null;
  file_storage_path?: string | null;
  file_original_name?: string | null;
  file_mime_type?: string | null;
  file_size_bytes?: number | null;
  sort_order: number;
};

export type SearchResult = {
  type: "document" | "announcement" | "onboarding";
  id: string;
  title: string;
  slug?: string;
  summary?: string | null;
  status?: DocumentStatus;
  href: string;
  updated_at?: string | null;
};

export type PopupAnnouncement = {
  id: string;
  title: string;
  body: string;
  mediaStoragePath: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  popupEndsAt: string | null;
};

export type BannerAnnouncement = {
  id: string;
  title: string;
  body: string;
  mediaStoragePath: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  bannerEndsAt: string | null;
};

export type EngagementContentType =
  | "document"
  | "announcement"
  | "popup"
  | "banner"
  | "onboarding"
  | "folder_link"
  | "attachment"
  | "document_version";
export type EngagementEventType = "open" | "heartbeat" | "close" | "manual_viewed" | "auto_viewed" | "admin_marked_viewed";

export type ContentViewRollup = {
  id: string;
  user_id: string;
  content_type: EngagementContentType;
  content_id: string;
  category_id: string | null;
  department_id: string | null;
  department_category_id?: string | null;
  open_count: number;
  total_active_seconds: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  is_viewed: boolean;
  viewed_at: string | null;
  viewed_source: "manual" | "auto" | "admin" | null;
  created_at: string;
  updated_at: string;
};

export type ContentAudienceReceipt = {
  id: string;
  user_id: string;
  content_type: EngagementContentType;
  content_id: string;
  category_id: string | null;
  assigned_department_category_id: string | null;
  assigned_by: string | null;
  assigned_reason: "department" | "extra_folder" | "global" | "direct_user" | "admin";
  required: boolean;
  first_opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  total_active_seconds: number;
  average_session_seconds?: number;
  expected_seconds?: number | null;
  is_viewed: boolean;
  viewed_at: string | null;
  viewed_source: "manual" | "auto" | "admin" | null;
  video_completed_count?: number;
  max_video_percent_watched?: number | null;
  attention_status?: "not_opened" | "low_attention" | "partial_attention" | "good_attention" | "completed" | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserFolderPermission = {
  id: string;
  user_id: string;
  category_id: string;
  granted_by: string | null;
  created_at: string;
};
