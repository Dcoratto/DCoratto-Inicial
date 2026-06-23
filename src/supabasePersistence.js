import { isSupabaseConfigured, supabase } from './supabaseClient';
import { optimizeImageToWebp } from './imageOptimizer';

const PHOTO_BUCKET = import.meta.env.VITE_SUPABASE_PHOTOS_BUCKET || 'dcoratto-photos';
const HTML_BUCKET = import.meta.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';

export function assertSupabaseReady() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase ainda nao esta configurado. Preencha .env.local.');
  }
}

export async function uploadEnvironmentPhoto({ projectId, environmentId, file, position, title }) {
  assertSupabaseReady();

  const optimized = await optimizeImageToWebp(file).catch(() => null);
  const uploadFile = optimized?.blob || file;
  const extension = optimized?.converted ? 'webp' : extensionFromFile(uploadFile);
  const photoId = crypto.randomUUID();
  const storagePath = `${projectId}/${environmentId}/${String(position).padStart(3, '0')}-${photoId}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, uploadFile, {
      cacheControl: '31536000',
      contentType: optimized?.mimeType || uploadFile.type,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath);

  const { data, error } = await supabase
    .from('environment_photos')
    .insert({
      id: photoId,
      project_id: projectId,
      environment_id: environmentId,
      position,
      title: title || `Vista ${position + 1}`,
      caption: title || `Vista ${position + 1}`,
      storage_bucket: PHOTO_BUCKET,
      storage_path: storagePath,
      image_url: publicUrl.publicUrl,
      alt_text: title || `Vista ${position + 1}`,
      width: optimized?.width || null,
      height: optimized?.height || null,
      mime_type: optimized?.mimeType || uploadFile.type,
      file_size: uploadFile.size,
      data: {
        originalSize: optimized?.originalSize || file.size,
        optimizedSize: optimized?.optimizedSize || uploadFile.size,
        compressionRatio: optimized?.compressionRatio || 1,
        convertedToWebp: Boolean(optimized?.converted),
      },
    })
    .select('id, project_id, environment_id, position, title, caption, image_url, storage_bucket, storage_path, width, height, mime_type, file_size')
    .single();

  if (error) throw error;
  return data;
}

export async function saveEnvironmentPhotoOrder(environmentId, photos) {
  assertSupabaseReady();

  const updates = photos.map((photo, index) => supabase
    .from('environment_photos')
    .update({
      position: index,
      title: photo.title,
      caption: photo.caption ?? photo.title,
      layout_key: photo.layoutKey ?? 'balanced',
    })
    .eq('id', photo.id)
    .eq('environment_id', environmentId));

  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
}

export async function saveHtmlVersion({ projectId, html, title = 'Portfolio HTML', makeCurrent = true }) {
  assertSupabaseReady();

  const versionNumber = await nextHtmlVersionNumber(projectId);
  const storagePath = `${projectId}/portfolio-v${String(versionNumber).padStart(3, '0')}.html`;
  const file = new Blob([html], { type: 'text/html;charset=utf-8' });

  const { error: uploadError } = await supabase.storage
    .from(HTML_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '60',
      contentType: 'text/html;charset=utf-8',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage.from(HTML_BUCKET).getPublicUrl(storagePath);

  const { data, error } = await supabase
    .from('document_html_versions')
    .insert({
      project_id: projectId,
      version_number: versionNumber,
      title,
      html_content: html,
      storage_bucket: HTML_BUCKET,
      storage_path: storagePath,
      is_current: makeCurrent,
      data: {
        publicUrl: publicUrl.publicUrl,
      },
    })
    .select('id, project_id, version_number, title, storage_bucket, storage_path, is_current, data, created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function saveEnvironmentStructuredData({ projectId, environmentId, colors, materials, notes }) {
  assertSupabaseReady();

  if (colors) {
    const { error: deleteError } = await supabase.from('environment_colors').delete().eq('environment_id', environmentId);
    if (deleteError) throw deleteError;

    if (colors.length) {
      const { error: insertError } = await supabase.from('environment_colors').insert(colors.map((color, index) => ({
        project_id: projectId,
        environment_id: environmentId,
        name: color.name,
        hex: color.hex,
        position: index,
      })));
      if (insertError) throw insertError;
    }
  }

  if (materials) {
    const { error: deleteError } = await supabase.from('environment_materials').delete().eq('environment_id', environmentId);
    if (deleteError) throw deleteError;

    if (materials.length) {
      const { error: insertError } = await supabase.from('environment_materials').insert(materials.map((material, index) => ({
        project_id: projectId,
        environment_id: environmentId,
        group_key: material.groupKey,
        label: material.label,
        value: material.value,
        position: index,
      })));
      if (insertError) throw insertError;
    }
  }

  if (notes) {
    const { error: deleteError } = await supabase.from('environment_notes').delete().eq('environment_id', environmentId);
    if (deleteError) throw deleteError;

    if (notes.length) {
      const { error: insertError } = await supabase.from('environment_notes').insert(notes.map((note, index) => ({
        project_id: projectId,
        environment_id: environmentId,
        note_type: note.type || 'observacao',
        body: note.body,
        position: index,
        show_on_html: note.showOnHtml ?? true,
      })));
      if (insertError) throw insertError;
    }
  }
}

export async function loadProjectDocumentPayload(projectId) {
  assertSupabaseReady();

  const { data, error } = await supabase
    .from('project_document_payload')
    .select('id, title, client_name, contract_number, address, status, is_draft, draft_saved_at, updated_at, data')
    .eq('id', projectId)
    .single();

  if (error) throw error;
  return data;
}

async function nextHtmlVersionNumber(projectId) {
  const { data, error } = await supabase
    .from('document_html_versions')
    .select('version_number')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0]?.version_number ?? 0) + 1;
}

function extensionFromFile(file) {
  const fallback = file.type?.split('/')[1] || 'jpg';
  const fromName = file.name?.split('.').pop();
  return (fromName || fallback).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
}
