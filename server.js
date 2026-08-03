import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const localEnvKeys = new Set();
loadLocalEnvFile('.env');
loadLocalEnvFile('.env.local', true);

const port = Number(process.env.PORT || 4173);
const root = resolve('dist');
const publicRoot = resolve('public');
const indexFile = join(root, 'index.html');
const htmlBucket = process.env.SUPABASE_HTML_BUCKET || process.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';
const photoBucket = process.env.SUPABASE_PHOTOS_BUCKET || process.env.VITE_SUPABASE_PHOTOS_BUCKET || 'dcoratto-photos';
const clientMobileFirstVersion = '2026-06-08-mobile-contain-markers-v1';
const supabaseRequestTimeoutMs = Math.min(4000, Math.max(1000, Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 2500)));
const supabaseStorageTimeoutMs = Math.min(30000, Math.max(5000, Number(process.env.SUPABASE_STORAGE_TIMEOUT_MS || 15000)));
const supabaseCircuitCooldownMs = Math.max(5000, Number(process.env.SUPABASE_CIRCUIT_COOLDOWN_MS || 20000));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SERVICE_ROLE_KEY
  || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  || '';
const primaryAccountEmail = 'dcorattoinovacao@gmail.com';
const defaultFactories = ['VITTA', 'BOA VISTA'];
const defaultMaterialOptions = {
  tampon: ['15mm', '25mm', '15 e 25mm', '6mm', '15 e 6mm'],
  porta: ['LISA', 'CAVA 45°', 'PASSANTE', 'FRISO', 'ROMEU E JULIETA', 'AMERICANA', 'ESPELHO'],
  puxador: ['CAVA 45°', 'GARD 256mm', 'PASSANTE', 'LISA PASSANTE', 'LISA PASSANTE COM FRISO', 'EMBUTIDO', 'PUXADOR J', 'PUXADOR L'],
  corredica: ['Telescópica', 'Invisível', 'Slow Motion', 'Toque', 'Push Open'],
};
const defaultObservations = [
  'Apenas Marcenaria considerado no Projeto',
  'Apenas Marcenaria e Metalons considerados no Projeto',
  'Leds não inclusos',
  'Considerar cavas para instalação de LEDS',
  'Eletrodomésticos não inclusos',
];
const localLoginUsers = [
  { email: primaryAccountEmail, password: 'sob_medida', name: "D'Coratto Inovacao", role: 'owner' },
  { email: 'rafael@dcoratto.com.br', password: 'Dcoratto@Rafael26', name: 'Rafael', role: 'team' },
  { email: 'isabela@dcoratto.com.br', password: 'Dcoratto@Isabela26', name: 'Isabela', role: 'team' },
  { email: 'vinicius@dcoratto.com.br', password: 'Dcoratto@Vinicius26', name: 'Vinicius', role: 'team' },
];
const runtimeLoginUsers = localLoginUsers.map(user => ({ ...user }));
let lastKnownEditorSettings = null;
let seedCatalogFallback = null;
let htmlBucketReadyPromise = null;
const lastKnownProjectLists = new Map();
const lastKnownClientHistory = new Map();
const serverQueryCache = new Map();
const promotedAssetCache = new Map();
const promotedAssetCacheTtlMs = 60 * 60 * 1000;
const promotedAssetCacheMaxEntries = 800;
const cacheTtl = {
  appUsers: 5 * 60 * 1000,
  editorSettings: 5 * 60 * 1000,
  catalog: 5 * 60 * 1000,
  projects: 45 * 1000,
  clientHistory: 60 * 1000,
  latestProjectMeta: 20 * 1000,
  clientHtml: 10 * 60 * 1000,
};
let supabaseUnavailableUntil = 0;
const supabaseServer = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithSupabaseTimeout },
  })
  : null;

function fetchWithSupabaseTimeout(input, init = {}) {
  const isStorageRequest = isSupabaseStorageRequest(input);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error('supabase_request_timeout'));
  }, isStorageRequest ? supabaseStorageTimeoutMs : supabaseRequestTimeoutMs);
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else init.signal.addEventListener('abort', () => controller.abort(init.signal.reason), { once: true });
  }
  return fetch(input, {
    ...init,
    signal: controller.signal,
  }).then((response) => {
    if (!isStorageRequest && (response.status >= 500 || response.status === 408 || response.status === 429)) {
      supabaseUnavailableUntil = Date.now() + supabaseCircuitCooldownMs;
    } else if (!isStorageRequest && response.ok) {
      supabaseUnavailableUntil = 0;
    }
    return response;
  }).catch((error) => {
    if (!isStorageRequest) {
      supabaseUnavailableUntil = Date.now() + supabaseCircuitCooldownMs;
    }
    throw error;
  }).finally(() => clearTimeout(timer));
}

function isSupabaseStorageRequest(input) {
  const url = typeof input === 'string'
    ? input
    : String(input?.url || input || '');
  return /\/storage\/v1\//i.test(url);
}

async function withSupabaseOperationTimeout(operation, options = {}) {
  if (!options.bypassCircuit && Date.now() < supabaseUnavailableUntil) {
    const circuitError = new Error('supabase_circuit_open');
    circuitError.code = 'supabase_unavailable';
    throw circuitError;
  }

  let timer = null;
  const operationPromise = Promise.resolve().then(operation);
  operationPromise.catch(() => null);
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      supabaseUnavailableUntil = Date.now() + supabaseCircuitCooldownMs;
      const timeoutError = new Error('supabase_request_timeout');
      timeoutError.code = 'supabase_unavailable';
      reject(timeoutError);
    }, supabaseRequestTimeoutMs);
  });

  try {
    const result = await Promise.race([operationPromise, timeoutPromise]);
    supabaseUnavailableUntil = 0;
    return result;
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      supabaseUnavailableUntil = Date.now() + supabaseCircuitCooldownMs;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getCacheEntry(key) {
  const entry = serverQueryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    serverQueryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCacheEntry(key, value, ttlMs) {
  if (!key || !ttlMs) return value;
  serverQueryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

async function cachedQuery(key, ttlMs, loader) {
  const cached = getCacheEntry(key);
  if (cached !== null) return { value: cached, cacheHit: true };
  const value = await loader();
  setCacheEntry(key, value, ttlMs);
  return { value, cacheHit: false };
}

function clearCacheByPrefix(...prefixes) {
  if (!prefixes.length) {
    serverQueryCache.clear();
    return;
  }
  for (const key of [...serverQueryCache.keys()]) {
    if (prefixes.some(prefix => key.startsWith(prefix))) {
      serverQueryCache.delete(key);
    }
  }
}

function loadLocalEnvFile(fileName, overrideLocal = false) {
  const filePath = resolve(fileName);
  if (!existsSync(filePath)) return;
  let content = '';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    console.warn(`Nao foi possivel carregar ${fileName}.`, error);
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined && !(overrideLocal && localEnvKeys.has(key))) continue;
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, '\n');
    localEnvKeys.add(key);
  }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/api/connection-diagnostics') {
    await handleConnectionDiagnosticsRequest(url, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/login') {
    await handleLoginRequest(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/app-users') {
    await handleAppUsersGet(url, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/app-users') {
    await handleAppUsersUpsert(request, response);
    return;
  }

  if (request.method === 'DELETE' && url.pathname === '/api/app-users') {
    await handleAppUsersDelete(url, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/client-links') {
    await handleClientLinkRequest(request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/editor-events') {
    await handleEditorEventRequest(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/editor-state/latest') {
    await handleLatestEditorStateRequest(url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/editor-settings') {
    await handleEditorSettingsGet(response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/catalog-materials') {
    await handleCatalogMaterialsGet(url, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/editor-settings') {
    await handleEditorSettingsPost(request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/project-status') {
    await handleProjectStatusRequest(request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/project-restore') {
    await handleProjectRestoreRequest(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/client-history') {
    await handleClientHistoryRequest(url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/projects') {
    await handleProjectsRequest(url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/cliente/')) {
    await handleClientHtmlRequest(url, response);
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(join(root, safePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    filePath = indexFile;
  }

  if (!existsSync(filePath)) {
    response.writeHead(404);
    response.end('Build not found. Run npm run build first.');
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`D'coratto editor listening on port ${port}`);
});

async function handleConnectionDiagnosticsRequest(url, response) {
  const actorEmail = normalizeEmail(url.searchParams.get('actor'));
  if (!isAdminEmail(actorEmail)) {
    sendJson(response, 403, { ok: false, error: 'forbidden', message: 'Diagnostico disponivel apenas para a conta principal.' });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    supabase: await safeSupabaseDiagnostics(),
  });
}

async function handleLoginRequest(request, response) {
  const startedAt = Date.now();
  try {
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password) {
      sendJson(response, 400, { error: 'Informe email e senha.' });
      return;
    }
    const fallbackUser = findRuntimeLoginUser(email, password);
    if (fallbackUser) {
      sendJson(response, 200, { ok: true, source: 'local', user: normalizeAppUser(fallbackUser) });
      return;
    }

    let retryableLoginError = null;
    if (supabaseServer) {
      try {
        const { data, error } = await withSupabaseOperationTimeout(() => supabaseServer.rpc('verify_app_login', {
          login_email: email,
          login_password: password,
        }));
        if (!error && data?.ok && data?.user?.email) {
          const remoteUser = normalizeAppUser(data.user);
          upsertRuntimeLoginUser({
            originalEmail: email,
            email: remoteUser.email,
            name: remoteUser.name,
            role: remoteUser.role,
            password,
          });
          sendJson(response, 200, { ok: true, source: 'supabase', user: remoteUser });
          return;
        }
        if (!error) {
          sendJson(response, 401, { error: 'Credenciais incorretas.' });
          return;
        }
        retryableLoginError = normalizeExternalServiceError(error);
      } catch (error) {
        retryableLoginError = normalizeExternalServiceError(error);
        logNormalizedServerError(retryableLoginError, {
          endpoint: '/api/login',
          actorEmail: email,
          durationMs: Date.now() - startedAt,
        });
      }
    } else {
      retryableLoginError = {
        code: 'supabase_not_configured',
        message: 'Validacao remota de login indisponivel no momento.',
        retryable: true,
      };
    }

    if (retryableLoginError) {
      const status = retryableLoginError.retryable ? 503 : 500;
      sendJson(response, status, {
        ok: false,
        error: retryableLoginError.code || 'login_validation_error',
        message: retryableLoginError.retryable
          ? 'Nao foi possivel validar este login no Supabase agora. Tente novamente em alguns instantes.'
          : 'Nao foi possivel validar este login por uma falha interna do servidor.',
        retryable: Boolean(retryableLoginError.retryable),
      });
      return;
    }

    sendJson(response, 401, { error: 'Credenciais incorretas.' });
  } catch (error) {
    sendErrorJson(response, error, { endpoint: '/api/login', durationMs: Date.now() - startedAt });
  }
}

function findRuntimeLoginUser(email, password) {
  const normalizedEmail = normalizeEmail(email);
  return runtimeLoginUsers.find((user) => (
    normalizeEmail(user.email) === normalizedEmail
    && user.password === password
    && user.active !== false
  )) || null;
}

async function handleAppUsersGet(url, response) {
  const startedAt = Date.now();
  const actorEmail = normalizeEmail(url.searchParams.get('actor'));
  try {
    if (!canManageAppUsers(actorEmail)) {
      sendJson(response, 403, { error: 'Apenas a conta principal pode gerenciar funcionarios.' });
      return;
    }

    if (!supabaseServer) {
      sendJson(response, 200, {
        ok: true,
        source: 'local',
        users: localPublicAppUsers(),
      });
      return;
    }

    const { value: data, cacheHit } = await cachedQuery('app-users:active', cacheTtl.appUsers, async () => {
      const { data, error } = await withSupabaseOperationTimeout(() => supabaseServer
        .from('app_users')
        .select('email, display_name, role, active, created_at, updated_at')
        .eq('active', true)
        .order('display_name', { ascending: true })
        .order('email', { ascending: true }));
      if (error) throw error;
      return data || [];
    });
    cacheRuntimeUserMetadata(data || []);

    sendJson(response, 200, {
      ok: true,
      source: cacheHit ? 'server-cache' : 'supabase',
      users: mergePublicAppUsers(data || [], runtimeLoginUsers),
    });
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      logNormalizedServerError(normalized, { endpoint: '/api/app-users', actorEmail, durationMs: Date.now() - startedAt });
      sendJson(response, 200, {
        ok: true,
        source: 'local-cache',
        stale: true,
        warning: normalized.code,
        message: 'Exibindo a ultima lista local de funcionarios enquanto o Supabase esta indisponivel.',
        retryable: true,
        users: localPublicAppUsers(),
      });
      return;
    }
    sendErrorJson(response, error, { endpoint: '/api/app-users', actorEmail, durationMs: Date.now() - startedAt });
  }
}

async function handleAppUsersUpsert(request, response) {
  const startedAt = Date.now();
  let body = {};
  try {
    body = await readJsonBody(request);
    const actorEmail = normalizeEmail(body.actor?.email);
    if (!canManageAppUsers(actorEmail)) {
      sendJson(response, 403, { error: 'Apenas a conta principal pode gerenciar funcionarios.' });
      return;
    }

    const originalEmail = normalizeEmail(body.originalEmail);
    const email = normalizeEmail(body.email);
    const name = String(body.name || '').trim();
    const role = normalizeAppUserRole(body.role);
    const password = String(body.password || '');
    const validationError = validateAppUserInput({ email, name, password, isNew: !originalEmail });
    if (validationError) {
      sendJson(response, 400, { error: validationError });
      return;
    }

    if (email === primaryAccountEmail && role !== 'owner') {
      sendJson(response, 400, { error: 'A conta principal deve permanecer como proprietaria.' });
      return;
    }

    const localUser = upsertRuntimeLoginUser({ originalEmail, email, name, role, password });

    if (!supabaseServer) {
      sendJson(response, 200, { ok: true, source: 'local', user: publicAppUser(localUser) });
      return;
    }

    const { data, error } = await withSupabaseOperationTimeout(() => supabaseServer.rpc('upsert_app_user', {
      manager_email: actorEmail,
      original_email: originalEmail || '',
      user_email: email,
      user_display_name: name,
      user_role: role,
      user_password: password,
    }));
    if (error) throw error;
    clearCacheByPrefix('app-users:');
    sendJson(response, 200, { ok: true, source: 'supabase', user: publicAppUser(data?.user || data) });
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      logNormalizedServerError(normalized, {
        endpoint: '/api/app-users',
        action: 'upsert',
        actorEmail: body?.actor?.email,
        durationMs: Date.now() - startedAt,
      });
      const localUser = findRuntimeUserByEmail(body?.email);
      sendJson(response, 202, {
        ok: true,
        source: 'local-cache',
        pendingSync: true,
        warning: normalized.code,
        message: 'Funcionario salvo localmente. A sincronizacao remota sera tentada quando o Supabase voltar.',
        user: publicAppUser(localUser || body),
      });
    } else {
      sendJson(response, 500, { ok: false, error: 'app_user_error', message: normalizeAppUserError(error), retryable: false });
    }
  }
}

async function handleAppUsersDelete(url, response) {
  const startedAt = Date.now();
  const actorEmail = normalizeEmail(url.searchParams.get('actor'));
  const email = normalizeEmail(url.searchParams.get('email'));
  try {
    if (!canManageAppUsers(actorEmail)) {
      sendJson(response, 403, { error: 'Apenas a conta principal pode gerenciar funcionarios.' });
      return;
    }
    if (!email) {
      sendJson(response, 400, { error: 'Informe o funcionario para excluir.' });
      return;
    }
    if (email === primaryAccountEmail) {
      sendJson(response, 400, { error: 'A conta principal nao pode ser excluida.' });
      return;
    }

    const localUser = findRuntimeUserByEmail(email);
    if (localUser) localUser.active = false;

    if (!supabaseServer) {
      sendJson(response, 200, { ok: true, source: 'local', email });
      return;
    }

    const { error } = await withSupabaseOperationTimeout(() => supabaseServer
      .from('app_users')
      .update({ active: false })
      .eq('email', email));
    if (error) throw error;
    clearCacheByPrefix('app-users:');
    sendJson(response, 200, { ok: true, source: 'supabase', email });
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      logNormalizedServerError(normalized, {
        endpoint: '/api/app-users',
        action: 'delete',
        actorEmail,
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, {
        ok: true,
        source: 'local-cache',
        pendingSync: true,
        warning: normalized.code,
        email,
      });
      return;
    }
    sendErrorJson(response, error, {
      endpoint: '/api/app-users',
      action: 'delete',
      actorEmail,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleClientLinkRequest(request, response) {
  const startedAt = Date.now();
  let body = {};
  try {
    if (!supabaseServer) {
      sendSupabaseUnavailable(response, 'Supabase indisponivel para gerar links persistentes. Seus dados locais foram preservados e a sincronizacao sera tentada novamente.');
      return;
    }

    body = await readJsonBody(request);
    const projectId = safeId(body.projectId) || crypto.randomUUID();
    const actorEmail = normalizeEmail(body.actor?.email);
    const existingPublishedVersion = await withSupabaseOperationTimeout(
      () => loadPublishedVersionByEventId(body.eventId, projectId),
      { bypassCircuit: true }
    );
    if (existingPublishedVersion?.id) {
      if (!canAccessPrivateHtmlVersion(existingPublishedVersion, actorEmail)) {
        sendJson(response, 403, { error: 'forbidden_project_access' });
        return;
      }
      const existingPath = clientLinkPath(existingPublishedVersion);
      sendJson(response, 200, {
        ok: true,
        source: 'server-supabase-deduped',
        projectId,
        publicUrl: existingPath ? `${requestOrigin(request)}${existingPath}` : '',
        storagePublicUrl: '',
        storagePath: existingPublishedVersion.storage_path || '',
        shareSlug: existingPublishedVersion.share_slug || '',
        mobileFirst: true,
        mobileLayoutVersion: clientMobileFirstVersion,
        deduped: true,
        assetPromotions: [],
      });
      return;
    }
    const existingProject = await withSupabaseOperationTimeout(
      () => loadProjectForWrite(projectId),
      { bypassCircuit: true }
    );
    if (existingProject && !canAccessPrivateProject(existingProject, actorEmail)) {
      sendJson(response, 403, { error: 'forbidden_project_access' });
      return;
    }
    const promotedDocument = await promoteDocumentImages({
      projectId,
      draft: body.draft || null,
      preview: body.preview || {},
    });
    let preview = sanitizeClientPreview(promotedDocument.preview || {});
    const protectedDocument = protectAgainstImplicitContentLoss({
      existingProject,
      action: 'generate_project_initial',
      draft: promotedDocument.draft,
      preview,
    });
    promotedDocument.draft = protectedDocument.draft;
    preview = protectedDocument.preview || preview;
    if (!Array.isArray(preview.environments) || !preview.environments.length) {
      sendJson(response, 400, { error: 'Adicione ao menos um ambiente antes de gerar o link do cliente.' });
      return;
    }

    const versionNumber = await nextHtmlVersionNumber(projectId);
    const shareSlug = `${slugify(preview.client?.name || 'cliente')}-${String(versionNumber).padStart(3, '0')}-${crypto.randomUUID().slice(0, 8)}`;
    const storagePath = `${projectId}/cliente/${shareSlug}.html`;
    const html = await buildStandaloneHtml(preview);
    const clientUrl = `${requestOrigin(request)}/cliente/${encodeURIComponent(projectId)}/${encodeURIComponent(shareSlug)}`;

    const dbResult = await persistHtmlVersion({
      projectId,
      versionNumber,
      shareSlug,
      storagePath,
      publicUrl: clientUrl,
      storagePublicUrl: '',
      html,
      preview,
      actor: body.actor,
      draft: promotedDocument.draft,
      eventId: body.eventId,
      createdAt: body.createdAt,
      existingProject,
    });
    const finalPublicUrl = dbResult.publicUrl || clientUrl;
    const finalStoragePath = dbResult.storagePath || storagePath;
    if (!dbResult.deduped) {
      void uploadHtmlSnapshotToStorage(finalStoragePath, html);
    }
    clearCacheByPrefix(
      'projects:',
      'client-history:',
      'project-summaries:',
      'latest-project-meta:',
      `project-snapshot:${projectId}`,
      `client-html:${projectId}:`
    );

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId,
      publicUrl: finalPublicUrl,
      storagePublicUrl: dbResult.storagePublicUrl || '',
      storagePath: finalStoragePath,
      shareSlug: dbResult.shareSlug || shareSlug,
      mobileFirst: true,
      mobileLayoutVersion: clientMobileFirstVersion,
      storageWarning: '',
      assetPromotions: promotedDocument.assetPromotions || [],
    });
  } catch (error) {
    sendErrorJson(response, error, {
      endpoint: '/api/client-links',
      action: 'generate_project_initial',
      projectId: body?.projectId,
      actorEmail: body?.actor?.email,
      payloadBytes: approximateJsonBytes(body),
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleEditorEventRequest(request, response) {
  const startedAt = Date.now();
  let body = {};
  try {
    if (!supabaseServer) {
      sendSupabaseUnavailable(response, 'Supabase indisponivel para persistir o editor. Seus dados locais foram preservados e a sincronizacao sera tentada novamente.');
      return;
    }

    body = await readJsonBody(request);
    const projectId = safeId(body.projectId) || crypto.randomUUID();
    const actorEmail = normalizeEmail(body.actor?.email);
    const existingProject = await withSupabaseOperationTimeout(() => loadProjectForWrite(projectId));
    if (existingProject && !canAccessPrivateProject(existingProject, actorEmail)) {
      sendJson(response, 403, { error: 'forbidden_project_access' });
      return;
    }
    const promotedDocument = await promoteDocumentImages({
      projectId,
      draft: body.draft || null,
      preview: body.preview || null,
    });
    const persistenceResult = await persistEditorState({
      projectId,
      actor: body.actor,
      action: body.action,
      draft: promotedDocument.draft,
      preview: promotedDocument.preview,
      settings: body.settings,
      settingsMutation: body.settingsMutation || null,
      eventId: body.eventId,
      createdAt: body.createdAt,
      existingProject,
    });
    clearCacheByPrefix(
      'projects:',
      'client-history:',
      'project-summaries:',
      'latest-project-meta:',
      `project-snapshot:${projectId}`
    );

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId,
      assetPromotions: mergeAssetPromotionLists(
        promotedDocument.assetPromotions,
        persistenceResult?.assetPromotions
      ),
    });
  } catch (error) {
    sendErrorJson(response, error, {
      endpoint: '/api/editor-events',
      action: body?.action,
      projectId: body?.projectId,
      actorEmail: body?.actor?.email,
      payloadBytes: approximateJsonBytes(body),
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleLatestEditorStateRequest(url, response) {
  const startedAt = Date.now();
  const requestedProjectId = safeId(url.searchParams.get('projectId'));
  const actorEmail = normalizeEmail(url.searchParams.get('actor'));
  try {
    if (!supabaseServer) {
      sendSupabaseUnavailable(response, 'Supabase indisponivel para carregar o rascunho. Continue usando o rascunho local salvo neste dispositivo.');
      return;
    }

    let project = null;
    if (requestedProjectId) {
      project = await loadProjectSnapshotForRead(requestedProjectId);
      if (project && !canAccessPrivateProject(project, actorEmail)) {
        sendJson(response, 403, { error: 'forbidden_project_access' });
        return;
      }
    } else {
      project = await loadLatestProjectSnapshotForActor(actorEmail);
    }

    let settings = null;
    try {
      const settingsResult = await cachedQuery('editor-settings:default', cacheTtl.editorSettings, () => (
        withSupabaseOperationTimeout(() => loadSharedEditorSettings())
      ));
      settings = settingsResult.value;
    } catch (settingsError) {
      console.warn('Nao foi possivel carregar configuracoes remotas.', settingsError);
    }

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId: project?.id || null,
      updatedAt: project?.updated_at || null,
      status: project?.status || 'draft',
      draft: project?.data?.draft || null,
      preview: project?.data?.preview || null,
      settings,
    });
  } catch (error) {
    sendErrorJson(response, error, {
      endpoint: '/api/editor-state/latest',
      projectId: requestedProjectId,
      actorEmail,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleProjectStatusRequest(request, response) {
  const startedAt = Date.now();
  let body = {};
  try {
    if (!supabaseServer) {
      sendSupabaseUnavailable(response, 'Supabase indisponivel para atualizar o status. A alteracao sera tentada novamente quando o banco voltar.');
      return;
    }
    body = await readJsonBody(request);
    const projectId = safeId(body.projectId);
    const status = String(body.status || '').trim();
    if (!projectId || !['draft', 'active', 'review', 'approved', 'archived', 'sold'].includes(status)) {
      sendJson(response, 400, { error: 'Status ou projeto invalido.' });
      return;
    }
    const current = await loadProjectForWrite(projectId);
    const actorEmail = normalizeEmail(body.actor?.email);
    if (current && !canAccessPrivateProject(current, actorEmail)) {
      sendJson(response, 403, { error: 'forbidden_project_access' });
      return;
    }
    const currentData = current?.data && typeof current.data === 'object' ? current.data : {};

    const { error } = await supabaseServer
      .from('document_projects')
      .update({
        status,
        updated_by: actorEmail,
        last_editor_email: actorEmail,
        last_editor_name: String(body.actor?.name || ''),
        sold_at: status === 'sold' ? new Date().toISOString() : null,
        sold_by: status === 'sold' ? actorEmail : null,
        locked_at: status === 'sold' ? new Date().toISOString() : null,
        locked_by: status === 'sold' ? actorEmail : null,
        lock_reason: status === 'sold' ? 'sold_project' : null,
        is_draft: status === 'draft' ? true : status === 'sold' ? false : Boolean(current?.is_draft),
        data: {
          ...currentData,
          soldAt: status === 'sold' ? new Date().toISOString() : null,
          soldBy: status === 'sold' ? actorEmail : null,
        },
      })
      .eq('id', projectId);
    if (error) throw error;
    clearCacheByPrefix(
      'projects:',
      'client-history:',
      'project-summaries:',
      'latest-project-meta:',
      `project-snapshot:${projectId}`
    );
    sendJson(response, 200, { ok: true, projectId, status });
  } catch (error) {
    sendErrorJson(response, error, {
      endpoint: '/api/project-status',
      action: body?.status,
      projectId: body?.projectId,
      actorEmail: body?.actor?.email,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleProjectRestoreRequest(request, response) {
  const startedAt = Date.now();
  let body = {};
  try {
    if (!supabaseServer) {
      sendSupabaseUnavailable(response, 'Supabase indisponivel para restaurar projetos. Tente novamente em alguns instantes.');
      return;
    }

    body = await readJsonBody(request);
    const projectId = safeId(body.projectId);
    const actorEmail = normalizeEmail(body.actor?.email);
    if (!projectId) {
      sendJson(response, 400, { error: 'Projeto invalido para restauracao.' });
      return;
    }
    if (!(await canRestoreProjects(actorEmail))) {
      sendJson(response, 403, { error: 'Apenas a conta admin pode restaurar projetos.' });
      return;
    }

    const restored = await restoreBestProjectSnapshot({ projectId, actor: body.actor || null });
    clearCacheByPrefix(
      'projects:',
      'client-history:',
      'project-summaries:',
      'latest-project-meta:',
      `project-snapshot:${projectId}`
    );
    sendJson(response, 200, {
      ok: true,
      source: restored.source,
      projectId,
      environments: restored.environments,
      restoredAt: restored.restoredAt,
    });
  } catch (error) {
    sendErrorJson(response, error, {
      endpoint: '/api/project-restore',
      projectId: body?.projectId,
      actorEmail: body?.actor?.email,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleEditorSettingsGet(response) {
  const startedAt = Date.now();
  try {
    if (!supabaseServer) {
      sendEditorSettingsFallback(response, 'Supabase indisponivel para carregar configuracoes. Exibindo base local de emergencia.');
      return;
    }

    const { value: settings, cacheHit } = await cachedQuery('editor-settings:default', cacheTtl.editorSettings, () => (
      withSupabaseOperationTimeout(() => loadSharedEditorSettings())
    ));
    lastKnownEditorSettings = settings;
    sendJson(response, 200, {
      ok: true,
      source: cacheHit ? 'server-cache' : 'server-supabase',
      settings,
    });
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      logNormalizedServerError(normalized, { endpoint: '/api/editor-settings', durationMs: Date.now() - startedAt });
      sendEditorSettingsFallback(response, 'Supabase temporariamente indisponivel. Exibindo configuracoes locais/cacheadas.');
      return;
    }
    sendErrorJson(response, error, { endpoint: '/api/editor-settings', durationMs: Date.now() - startedAt });
  }
}

async function handleCatalogMaterialsGet(url, response) {
  const startedAt = Date.now();
  try {
    if (!supabaseServer) {
      sendCatalogFallback(response, filtersFromCatalogUrl(url), 'Supabase indisponivel para carregar catalogos. Exibindo catalogo local de emergencia.');
      return;
    }

    const filters = filtersFromCatalogUrl(url);
    const cacheKey = `catalog:${JSON.stringify(filters)}`;
    const cached = getCacheEntry(cacheKey);
    if (cached) {
      sendJson(response, 200, {
        ok: true,
        source: 'server-cache',
        filters,
        items: cached,
      });
      return;
    }

    let query = supabaseServer
      .from('catalog_materials')
      .select('id,catalog_key,group_key,name,code,manufacturer,line_name,quality,material_type,category,hex,texture_url,image_url,storage_bucket,storage_path,public_url,mime_type,width,height,active,sort_order,created_by,updated_by,created_at,updated_at')
      .eq('active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .limit(filters.limit);

    if (filters.category) query = query.eq('group_key', catalogItemGroup(filters.category));
    if (filters.factory) query = query.eq('manufacturer', filters.factory);
    if (filters.line) query = query.eq('line_name', filters.line);
    if (filters.quality) query = query.eq('quality', filters.quality);
    if (filters.search) {
      const term = escapePostgrestLike(filters.search);
      query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,catalog_key.ilike.%${term}%`);
    }

    const { data, error } = await withSupabaseOperationTimeout(() => query);
    if (error) throw error;
    const tableItems = (data || []).map(catalogMaterialToSettingsItem).filter(Boolean);
    let items = tableItems;
    if (lastKnownEditorSettings?.catalogItems?.length) {
      const payloadItems = (lastKnownEditorSettings.catalogItems || []).filter(item => catalogItemMatchesFiltersPayload(item, filters));
      items = mergeCatalogItemsPayload(tableItems, payloadItems).slice(0, filters.limit);
    }
    lastKnownEditorSettings = {
      ...(lastKnownEditorSettings || {}),
      catalogItems: mergeCatalogItemsPayload(lastKnownEditorSettings?.catalogItems || [], items),
    };
    setCacheEntry(cacheKey, items, cacheTtl.catalog);
    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      filters,
      items,
    });
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      logNormalizedServerError(normalized, { endpoint: '/api/catalog-materials', durationMs: Date.now() - startedAt });
      sendCatalogFallback(response, filtersFromCatalogUrl(url), 'Supabase temporariamente indisponivel. Exibindo catalogo local/cacheado.');
      return;
    }
    sendErrorJson(response, error, { endpoint: '/api/catalog-materials', durationMs: Date.now() - startedAt });
  }
}

function filtersFromCatalogUrl(url) {
  return {
    category: String(url.searchParams.get('category') || '').trim(),
    factory: String(url.searchParams.get('factory') || '').trim(),
    line: String(url.searchParams.get('line') || '').trim(),
    quality: String(url.searchParams.get('quality') || '').trim(),
    search: String(url.searchParams.get('search') || '').trim(),
    limit: Math.min(150, Math.max(25, Number(url.searchParams.get('limit') || 120))),
  };
}

function sendEditorSettingsFallback(response, message) {
  const settings = fallbackEditorSettings();
  sendJson(response, 200, {
    ok: true,
    source: lastKnownEditorSettings ? 'memory-cache' : 'local-fallback',
    stale: true,
    retryable: true,
    warning: 'supabase_unavailable',
    message,
    settings,
  });
}

function sendCatalogFallback(response, filters, message) {
  const settings = fallbackEditorSettings();
  const items = (settings.catalogItems || [])
    .filter(item => catalogItemMatchesFiltersPayload(item, filters))
    .slice(0, filters.limit);
  sendJson(response, 200, {
    ok: true,
    source: lastKnownEditorSettings?.catalogItems?.length ? 'memory-cache' : 'local-fallback',
    stale: true,
    retryable: true,
    warning: 'supabase_unavailable',
    message,
    filters,
    items,
  });
}

function fallbackEditorSettings() {
  const seedItems = loadSeedCatalogFallback();
  const settings = lastKnownEditorSettings || {};
  const catalogItems = mergeCatalogItemsPayload(seedItems, settings.catalogItems || [], { preferIncoming: true });
  return normalizeEditorSettingsPayload({
    ...settings,
    catalogItems,
    factories: normalizeFactoriesPayload(settings.factories || defaultFactories, catalogItems),
    materialOptions: mergeMaterialOptionsPayload(defaultMaterialOptions, settings.materialOptions || {}),
    observations: settings.observations?.length ? settings.observations : defaultObservations,
  });
}

function loadSeedCatalogFallback() {
  if (seedCatalogFallback) return seedCatalogFallback;
  const seedPath = resolve('supabase', 'seed.sql');
  if (!existsSync(seedPath)) {
    seedCatalogFallback = [];
    return seedCatalogFallback;
  }

  try {
    const seedSql = readFileSync(seedPath, 'utf8');
    const items = [
      ...parseSeedCatalogMaterials(seedSql),
      ...parseSeedBoaVistaColors(seedSql),
    ];
    seedCatalogFallback = mergeCatalogItemsPayload([], items);
  } catch (error) {
    console.warn('Nao foi possivel carregar catalogo local de emergencia.', normalizeExternalServiceError(error).message);
    seedCatalogFallback = [];
  }
  return seedCatalogFallback;
}

function parseSeedCatalogMaterials(seedSql = '') {
  const match = String(seedSql).match(/insert\s+into\s+public\.catalog_materials\s*\(\s*group_key,\s*name,\s*code,\s*brand,\s*hex,\s*sort_order\s*\)\s*values\s*([\s\S]*?)\s*on\s+conflict/i);
  if (!match?.[1]) return [];
  return parseSqlTuples(match[1]).map((tuple) => {
    const [groupKey, name, code, brand, hex, sortOrder] = tuple;
    return seedCatalogItem({
      groupKey,
      name,
      code,
      manufacturer: brand || '',
      line: '',
      quality: '',
      hex,
      textureUrl: '',
      sortOrder,
      source: 'seed',
    });
  }).filter(Boolean);
}

function parseSeedBoaVistaColors(seedSql = '') {
  const match = String(seedSql).match(/with\s+boa_vista_colors\s*\([^)]*\)\s+as\s*\(\s*values\s*([\s\S]*?)\s*\)\s*insert\s+into\s+public\.catalog_materials/i);
  if (!match?.[1]) return [];
  return parseSqlTuples(match[1]).map((tuple) => {
    const [sortOrder, line, name, quality, hex, textureUrl] = tuple;
    return seedCatalogItem({
      groupKey: 'boa_vista_cores',
      name,
      code: '',
      manufacturer: 'BOA VISTA',
      line,
      quality,
      hex,
      textureUrl,
      sortOrder,
      source: 'seed:boa-vista',
    });
  }).filter(Boolean);
}

function seedCatalogItem({ groupKey, name, code, manufacturer, line, quality, hex, textureUrl, sortOrder, source }) {
  if (!groupKey || !name) return null;
  const type = settingsTypeFromCatalogGroup(groupKey);
  if (!type) return null;
  const catalogKey = stableCatalogKey({
    category: type,
    factory: manufacturer,
    line,
    quality,
    name,
  });
  return normalizeCatalogItemsPayload([{
    id: catalogKey,
    catalogKey,
    catalog_key: catalogKey,
    type,
    category: groupKey,
    factory: manufacturer || '',
    manufacturer: manufacturer || '',
    line: line || '',
    name,
    code: code || catalogKey.toUpperCase(),
    quality: quality || '',
    materialType: quality || '',
    hex: hex || '#b8976a',
    textureUrl: textureUrl || '',
    imageUrl: textureUrl || '',
    publicUrl: '',
    sort_order: Number(sortOrder) || 0,
    source,
  }])[0] || null;
}

function parseSqlTuples(valuesBlock = '') {
  const tuples = [];
  let tuple = null;
  let token = '';
  let inString = false;
  const pushToken = () => {
    if (!tuple) return;
    const value = token.trim();
    tuple.push(sqlValue(value));
    token = '';
  };

  for (let index = 0; index < valuesBlock.length; index += 1) {
    const char = valuesBlock[index];
    const next = valuesBlock[index + 1];
    if (inString) {
      if (char === "'" && next === "'") {
        token += "'";
        index += 1;
      } else if (char === "'") {
        inString = false;
      } else {
        token += char;
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      continue;
    }
    if (char === '(') {
      tuple = [];
      token = '';
      continue;
    }
    if (char === ',' && tuple) {
      pushToken();
      continue;
    }
    if (char === ')' && tuple) {
      pushToken();
      tuples.push(tuple);
      tuple = null;
      token = '';
      continue;
    }
    if (tuple) token += char;
  }
  return tuples;
}

function sqlValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw || /^null$/i.test(raw)) return '';
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function catalogItemMatchesFiltersPayload(item = {}, filters = {}) {
  if (!item?.name) return false;
  if (filters.category && catalogItemGroup(item.type || item.category) !== catalogItemGroup(filters.category)) return false;
  if (filters.factory && (item.manufacturer || item.factory || '') !== filters.factory) return false;
  if (filters.line && (item.line || item.lineName || item.line_name || '') !== filters.line) return false;
  if (filters.quality && (item.quality || item.materialType || '') !== filters.quality) return false;
  if (filters.search) {
    const term = normalizeCatalogSearch(filters.search);
    const haystack = normalizeCatalogSearch([
      item.name,
      item.code,
      item.id,
      item.catalogKey,
      item.catalog_key,
      item.manufacturer,
      item.line,
      item.quality,
    ].filter(Boolean).join(' '));
    if (!haystack.includes(term)) return false;
  }
  return true;
}

function normalizeCatalogSearch(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function handleEditorSettingsPost(request, response) {
  const startedAt = Date.now();
  let body = {};
  try {
    if (!supabaseServer) {
      sendSupabaseUnavailable(response, 'Supabase indisponivel para salvar configuracoes. A sincronizacao sera tentada novamente.');
      return;
    }

    body = await readJsonBody(request);
    const settings = await saveSharedEditorSettings(body.settings || {}, body.actor || null, body.settingsMutation || null);
    lastKnownEditorSettings = settings;
    clearCacheByPrefix('editor-settings:', 'catalog:');
    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      settings,
    });
  } catch (error) {
    sendErrorJson(response, error, {
      endpoint: '/api/editor-settings',
      action: body?.settingsMutation?.type || 'settings_save',
      actorEmail: body?.actor?.email,
      payloadBytes: approximateJsonBytes(body),
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleClientHistoryRequest(url, response) {
  const startedAt = Date.now();
  const actorEmail = normalizeEmail(url.searchParams.get('actor'));
  const cacheKey = actorEmail || 'anonymous';
  try {
    if (!supabaseServer) {
      sendClientHistoryFallback(response, cacheKey, 'Supabase indisponivel para carregar historico de clientes.');
      return;
    }

    const includeDeleted = url.searchParams.get('includeDeleted') === 'true' && isAdminEmail(actorEmail);
    const includeDeletedKey = includeDeleted ? 'with-deleted' : 'visible';
    const cached = getCacheEntry(`client-history:${cacheKey}:${includeDeletedKey}`);
    if (cached) {
      sendJson(response, 200, {
        ok: true,
        source: 'server-cache',
        history: cached,
      });
      return;
    }
    let query = supabaseServer
      .from('document_html_versions')
      .select('id, title, share_slug, project_id, created_at, created_by, assigned_to_email, is_current, replacement_public_url')
      .eq('shared_with_client', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!includeDeleted) query = query.is('deleted_at', null);
    if (!isAdminEmail(actorEmail)) {
      query = query.or(`created_by.eq.${escapePostgrestValue(actorEmail)},assigned_to_email.eq.${escapePostgrestValue(actorEmail)}`);
    }
    const { data: versions, error } = await withSupabaseOperationTimeout(() => query);
    
    if (error) throw error;

    const projectSummaries = await loadProjectSummariesForHistory(versions || []);
    const history = (versions || []).map((v) => {
      const projectSummary = projectSummaries.get(v.project_id) || {};
      const designerEmail = normalizeEmail(v.created_by || projectSummary.last_editor_email || projectSummary.created_by || projectSummary.assigned_to_email);
      return {
        id: v.id,
        title: v.title,
        clientName: projectSummary.client_name || clientNameFromHtmlTitle(v.title) || 'Cliente',
        contractNumber: projectSummary.contract_number || '',
        address: projectSummary.address || '',
        designerEmail,
        designerName: designerNameFromEmail(designerEmail),
        shareSlug: v.share_slug,
        projectId: v.project_id,
        createdAt: v.created_at,
        publicUrl: clientLinkPath(v),
        isCurrent: v.is_current !== false,
        replacementPublicUrl: v.replacement_public_url || '',
      };
    });

    lastKnownClientHistory.set(cacheKey, history);
    setCacheEntry(`client-history:${cacheKey}:${includeDeletedKey}`, history, cacheTtl.clientHistory);
    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      history,
    });
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      logNormalizedServerError(normalized, {
        endpoint: '/api/client-history',
        actorEmail,
        durationMs: Date.now() - startedAt,
      });
      sendClientHistoryFallback(response, cacheKey, 'Supabase temporariamente indisponivel. Exibindo ultimo historico carregado quando disponivel.');
      return;
    }
    sendErrorJson(response, error, {
      endpoint: '/api/client-history',
      actorEmail,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function handleProjectsRequest(url, response) {
  const startedAt = Date.now();
  const actorEmail = normalizeEmail(url.searchParams.get('actor'));
  const folder = String(url.searchParams.get('folder') || 'active').trim();
  const cacheKey = `${actorEmail || 'anonymous'}:${folder}:${url.searchParams.get('includeDeleted') === 'true' && isAdminEmail(actorEmail) ? 'with-deleted' : 'visible'}`;
  try {
    if (!supabaseServer) {
      sendProjectsFallback(response, cacheKey, 'Supabase indisponivel para carregar projetos. Usando cache local quando disponivel.');
      return;
    }

    const cached = getCacheEntry(`projects:${cacheKey}`);
    if (cached) {
      sendJson(response, 200, { ok: true, source: 'server-cache', projects: cached });
      return;
    }

    let query = supabaseServer
      .from('document_projects')
      .select('id, title, client_name, contract_number, address, status, is_draft, draft_saved_at, updated_at, created_by, assigned_to_email, last_editor_name, last_editor_email, deleted_at, deleted_by, deleted_reason, deleted_for_users')
      .eq('document_type', 'projeto_inicial')
      .order('updated_at', { ascending: false })
      .limit(100);
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true' && isAdminEmail(actorEmail);
    if (!includeDeleted) query = query.is('deleted_at', null);

    if (folder === 'drafts') {
      query = query.eq('is_draft', true);
    } else if (folder === 'sold') {
      query = query.eq('status', 'sold');
    } else {
      query = query.neq('status', 'sold').eq('is_draft', false);
    }
    if (!isAdminEmail(actorEmail)) {
      query = query.or(privateProjectAccessOr(actorEmail));
    }

    const { data, error } = await withSupabaseOperationTimeout(() => query);
    if (error) throw error;
    const projects = (data || [])
      .filter(project => !isDeletedForUser(project, actorEmail))
      .map(project => ({
        id: project.id,
        title: project.title || 'Projeto Inicial',
        clientName: project.client_name || 'Cliente',
        contractNumber: project.contract_number || '',
        address: project.address || '',
        status: project.status || 'draft',
        isDraft: Boolean(project.is_draft),
        draftSavedAt: project.draft_saved_at || null,
        updatedAt: project.updated_at || null,
        deletedAt: project.deleted_at || null,
        deletedBy: project.deleted_by || '',
        deletedReason: project.deleted_reason || '',
        designerEmail: normalizeEmail(project.assigned_to_email || project.created_by || project.last_editor_email),
        designerName: project.last_editor_name || designerNameFromEmail(project.assigned_to_email || project.created_by || project.last_editor_email),
      }));

    lastKnownProjectLists.set(cacheKey, projects);
    setCacheEntry(`projects:${cacheKey}`, projects, cacheTtl.projects);
    sendJson(response, 200, { ok: true, source: 'server-supabase', projects });
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    if (normalized.retryable) {
      logNormalizedServerError(normalized, {
        endpoint: '/api/projects',
        actorEmail,
        durationMs: Date.now() - startedAt,
      });
      sendProjectsFallback(response, cacheKey, 'Supabase temporariamente indisponivel. Exibindo ultimos projetos carregados quando disponivel.');
      return;
    }
    sendErrorJson(response, error, {
      endpoint: '/api/projects',
      actorEmail,
      durationMs: Date.now() - startedAt,
    });
  }
}

function sendClientHistoryFallback(response, cacheKey, message) {
  const history = lastKnownClientHistory.get(cacheKey) || [];
  sendJson(response, 200, {
    ok: true,
    source: history.length ? 'memory-cache' : 'local-fallback',
    stale: true,
    retryable: true,
    warning: 'supabase_unavailable',
    message,
    history,
  });
}

function sendProjectsFallback(response, cacheKey, message) {
  const projects = lastKnownProjectLists.get(cacheKey) || [];
  sendJson(response, 200, {
    ok: true,
    source: projects.length ? 'memory-cache' : 'local-fallback',
    stale: true,
    retryable: true,
    warning: 'supabase_unavailable',
    message,
    projects,
  });
}

async function loadProjectSummariesForHistory(versions = []) {
  const projectIds = [...new Set((versions || []).map(version => safeId(version.project_id)).filter(Boolean))];
  if (!projectIds.length) return new Map();
  const cacheKey = `project-summaries:${projectIds.slice().sort().join(',')}`;
  const { value: rows } = await cachedQuery(cacheKey, cacheTtl.clientHistory, async () => {
    const { data, error } = await withSupabaseOperationTimeout(() => supabaseServer
      .from('document_projects')
      .select('id, client_name, contract_number, address, created_by, assigned_to_email, last_editor_email, last_editor_name')
      .in('id', projectIds)
      .limit(projectIds.length));
    if (error) throw error;
    return data || [];
  });
  return new Map((rows || []).map(row => [row.id, row]));
}

function clientLinkPath(version = {}) {
  const projectId = safeId(version.project_id);
  const slug = String(version.share_slug || '').trim();
  if (!projectId || !slug) return '';
  return `/cliente/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}`;
}

async function loadPublishedVersionByEventId(eventId, projectId = '') {
  const safeEventId = String(eventId || '').trim();
  if (!safeEventId) return null;
  let query = supabaseServer
    .from('document_html_versions')
    .select('id, project_id, storage_path, share_slug, owner_email, created_by, assigned_to_email, deleted_at, deleted_for_users')
    .filter('data->>eventId', 'eq', safeEventId)
    .eq('shared_with_client', true);
  if (safeId(projectId)) query = query.eq('project_id', projectId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

function clientNameFromHtmlTitle(title = '') {
  return String(title || '').replace(/^Projeto Inicial\s*-\s*/i, '').trim();
}

async function handleClientHtmlRequest(url, response) {
  try {
    if (!supabaseServer) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Servidor sem SUPABASE_SERVICE_ROLE_KEY para carregar o HTML do cliente.');
      return;
    }

    const clientLink = parseClientLink(url.pathname);
    if (!clientLink.shareSlug) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Link do cliente nao encontrado.');
      return;
    }

    const html = await loadClientHtml(clientLink);

    if (!html) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('HTML do cliente nao encontrado.');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(await optimizeClientHtmlForMobile(html));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Nao foi possivel abrir o HTML do cliente: ${normalizeExternalServiceError(error).message}`);
  }
}

let cachedClientMobileCss = '';

async function optimizeClientHtmlForMobile(html = '') {
  if (!html) return html;
  if (clientHtmlIsCurrentMobileFirst(html)) {
    return html;
  }
  const preview = extractPreviewFromHtmlContent(html);
  if (preview) {
    try {
      return await buildStandaloneHtml(preview);
    } catch (error) {
      logNormalizedServerError(normalizeExternalServiceError(error), {
        endpoint: 'client-html-mobile-optimize',
        action: 'rebuild_mobile_html',
      });
    }
  }
  if (html.includes('data-dcoratto-mobile-client-optimized')) return html;
  const css = clientMobileCssPatch();
  if (!css) return html;
  const style = `<style data-dcoratto-mobile-client-optimized="${clientMobileFirstVersion}">\n${css}\n</style>`;
  return html.includes('</head>')
    ? html.replace('</head>', `${style}</head>`)
    : `${style}${html}`;
}

function clientHtmlIsCurrentMobileFirst(html = '') {
  return html.includes(`__DCORATTO_CLIENT_MOBILE_FIRST__ = ${JSON.stringify(clientMobileFirstVersion)}`)
    || html.includes(`data-dcoratto-mobile-first="${clientMobileFirstVersion}"`);
}

function clientMobileCssPatch() {
  if (cachedClientMobileCss) return cachedClientMobileCss;
  const template = readPortfolioTemplateSync();
  const match = template.match(/\/\* dcoratto-client-mobile-v1 \*\/([\s\S]*?)\/\* \/dcoratto-client-mobile-v1 \*\//);
  cachedClientMobileCss = match?.[1]?.trim() || '';
  return cachedClientMobileCss;
}

function portfolioTemplateCandidates() {
  return [join(root, 'portfolio_document.html'), join(publicRoot, 'portfolio_document.html')];
}

function isMobileFirstPortfolioTemplate(template = '') {
  return template.includes('renderMobileFrameFlow')
    && template.includes('mobile-frame-flow')
    && template.includes('has-mobile-flow');
}

function choosePortfolioTemplate(candidates = []) {
  return candidates.find(candidate => isMobileFirstPortfolioTemplate(candidate.content))
    || candidates[0]
    || { content: '', path: '' };
}

function readPortfolioTemplateSync() {
  const candidates = portfolioTemplateCandidates()
    .filter(path => existsSync(path))
    .map(path => ({ path, content: readFileSync(path, 'utf8') }));
  return choosePortfolioTemplate(candidates).content;
}

async function readPortfolioTemplate() {
  const candidates = [];
  for (const path of portfolioTemplateCandidates()) {
    if (!existsSync(path)) continue;
    candidates.push({ path, content: await readFile(path, 'utf8') });
  }
  return choosePortfolioTemplate(candidates).content;
}

function parseClientLink(pathname) {
  const parts = pathname
    .replace(/^\/cliente\/?/, '')
    .split('/')
    .map(part => decodeURIComponent(part).trim())
    .filter(Boolean);
  if (parts.length >= 2 && safeId(parts[0])) {
    return { projectId: parts[0], shareSlug: parts[1] };
  }
  return { projectId: '', shareSlug: parts[0] || '' };
}

async function loadClientHtml({ projectId, shareSlug }) {
  if (projectId) {
    const storagePath = `${projectId}/cliente/${shareSlug}.html`;
    const byStoragePath = await findHtmlVersionByStoragePath(storagePath);
    if (byStoragePath) return byStoragePath;
  }

  const byShareSlug = await findHtmlVersionByShareSlug(shareSlug);
  if (byShareSlug) return byShareSlug;

  const byDataShareSlug = await findHtmlVersionByDataShareSlug(shareSlug);
  if (byDataShareSlug) return byDataShareSlug;

  return '';
}

async function findHtmlVersionByStoragePath(storagePath) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('id, project_id, storage_path, share_slug, is_current, replacement_public_url')
    .eq('storage_path', storagePath)
    .eq('shared_with_client', true)
    .maybeSingle();
  if (error) throw error;
  return resolveHtmlVersion(data, storagePath);
}

async function findHtmlVersionByShareSlug(shareSlug) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('id, project_id, storage_path, share_slug, is_current, replacement_public_url')
    .eq('share_slug', shareSlug)
    .eq('shared_with_client', true)
    .maybeSingle();
  if (error) throw error;
  return resolveHtmlVersion(data);
}

async function findHtmlVersionByDataShareSlug(shareSlug) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('id, project_id, storage_path, share_slug, is_current, replacement_public_url')
    .filter('data->>shareSlug', 'eq', shareSlug)
    .eq('shared_with_client', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    logNormalizedServerError(normalizeExternalServiceError(error), {
      endpoint: 'document_html_versions',
      action: 'find_by_data_share_slug',
    });
    return '';
  }
  return resolveHtmlVersion(data?.[0] || null);
}

async function resolveHtmlVersion(version, preferredStoragePath = '') {
  if (!version) return '';
  if (version.is_current !== false) {
    const storagePath = version.storage_path || preferredStoragePath;
    const storedHtml = storagePath ? await downloadHtmlFromStorageCached(version.project_id, storagePath) : '';
    if (storedHtml) return storedHtml;
    return findHtmlContentById(version.id);
  }
  const replacementUrl = version.replacement_public_url
    || await currentProjectPublicUrl(version.project_id);
  return obsoleteClientLinkHtml(replacementUrl);
}

async function currentProjectPublicUrl(projectId) {
  if (!projectId) return '';
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('project_id, share_slug, replacement_public_url')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .eq('shared_with_client', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return '';
  const current = data?.[0] || null;
  return current?.replacement_public_url || clientLinkPath(current);
}

async function findHtmlContentById(versionId) {
  if (!safeId(versionId)) return '';
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('html_content')
    .eq('id', versionId)
    .maybeSingle();
  if (error) return '';
  return data?.html_content || '';
}

function obsoleteClientLinkHtml(replacementUrl = '') {
  const safeUrl = escapeHtml(replacementUrl);
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Link atualizado | D'Coratto</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080807;color:#f7f2ea;font-family:Arial,sans-serif;padding:24px}
      main{max-width:560px;text-align:center;border:1px solid rgba(184,151,106,.28);background:#15120f;padding:34px}
      h1{margin:0 0 12px;color:#d7c2a7;font-family:Georgia,serif;font-weight:400}
      p{line-height:1.55;color:#d8c8b3}
      a{display:inline-block;margin-top:14px;color:#080807;background:#d7c2a7;padding:12px 16px;text-decoration:none;font-weight:700}
    </style>
  </head>
  <body>
    <main>
      <h1>há um novo link desse projeto</h1>
      <p>Este link foi substituído por uma versão mais recente do projeto.</p>
      ${safeUrl ? `<a href="${safeUrl}">Abrir novo link</a>` : ''}
    </main>
  </body>
</html>`;
}

async function downloadHtmlFromStorage(storagePath) {
  const { data, error } = await supabaseServer.storage
    .from(htmlBucket)
    .download(storagePath);
  if (error) return '';
  return data?.text ? data.text() : '';
}

async function downloadHtmlFromStorageCached(projectId, storagePath) {
  const cacheKey = `client-html:${safeId(projectId) || 'unknown'}:${storagePath}`;
  const cached = getCacheEntry(cacheKey);
  if (cached) return cached;
  const html = await downloadHtmlFromStorage(storagePath);
  if (html) setCacheEntry(cacheKey, html, cacheTtl.clientHtml);
  return html;
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 50_000_000) throw new Error('O projeto ficou grande demais para persistir. Reduza imagens muito pesadas.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function ensureHtmlBucket() {
  if (htmlBucketReadyPromise) return htmlBucketReadyPromise;
  htmlBucketReadyPromise = ensureHtmlBucketNow().catch((error) => {
    htmlBucketReadyPromise = null;
    throw error;
  });
  return htmlBucketReadyPromise;
}

async function ensureHtmlBucketNow() {
  const { data: buckets, error: listError } = await supabaseServer.storage.listBuckets();
  if (listError) throw listError;
  if (buckets?.some((bucket) => bucket.name === htmlBucket || bucket.id === htmlBucket)) {
    if (typeof supabaseServer.storage.updateBucket === 'function') {
      await supabaseServer.storage.updateBucket(htmlBucket, {
        public: true,
        fileSizeLimit: 52_428_800,
        allowedMimeTypes: ['text/html'],
      });
    }
    return;
  }

  const { error } = await supabaseServer.storage.createBucket(htmlBucket, {
    public: true,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: ['text/html'],
  });
  if (error) throw error;
}

async function uploadHtmlSnapshotToStorage(storagePath, html) {
  try {
    await ensureHtmlBucket();
    const { error: uploadError } = await supabaseServer.storage
      .from(htmlBucket)
      .upload(storagePath, new Blob([html], { type: 'text/html;charset=utf-8' }), {
        cacheControl: '60',
        contentType: 'text/html;charset=utf-8',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabaseServer.storage.from(htmlBucket).getPublicUrl(storagePath);
    const publicUrl = publicData?.publicUrl || '';
    return { publicUrl };
  } catch (error) {
    const normalized = normalizeExternalServiceError(error);
    logNormalizedServerError(normalized, { endpoint: 'supabase-storage-html', payloadBytes: Buffer.byteLength(String(html || ''), 'utf8') });
    return { publicUrl: '', warning: normalized.message, error: normalized.code, retryable: normalized.retryable };
  }
}

async function persistEditorState({ projectId, actor, action, draft, preview, settings, settingsMutation, eventId, createdAt, existingProject = null }) {
  let savedSettings = null;
  if (settings) {
    savedSettings = await saveSharedEditorSettings(settings, actor, settingsMutation || null);
  }
  const settingsAssetPromotions = collectAssetPromotions(savedSettings);

  if (!hasPersistableContent(draft, preview)) return { assetPromotions: settingsAssetPromotions };

  existingProject ||= await loadProjectForWrite(projectId);
  if (existingProject?.status === 'sold') {
    throw new Error('Projeto vendido esta bloqueado para alteracoes.');
  }

  if (eventId && existingProject?.data?.lastEventId === eventId) return { assetPromotions: settingsAssetPromotions };
  if (isStaleProjectEvent(existingProject, createdAt)) {
    await persistAuditLog({ projectId, actor, action, draft, preview, settings, eventId, createdAt });
    return { assetPromotions: settingsAssetPromotions };
  }

  const protectedDocument = protectAgainstImplicitContentLoss({
    existingProject,
    action,
    draft,
    preview,
  });
  draft = protectedDocument.draft;
  preview = protectedDocument.preview;
  const persistenceAction = protectedDocument.protected
    ? `${action || 'editor_sync'}_content_preserved`
    : action;

  const client = preview?.client || {};
  const actorEmail = normalizeEmail(actor?.email);
  const isDraftSave = action === 'save_as_draft';
  const nowIso = new Date().toISOString();
  const createdBy = normalizeEmail(existingProject?.created_by) || actorEmail;
  const assignedToEmail = normalizeEmail(existingProject?.assigned_to_email) || actorEmail;
  const projectPayload = {
    id: projectId,
    title: preview?.projectType || 'Projeto Inicial',
    client_name: client.name || draft?.fields?.clientName || '',
    contract_number: client.contractNumber || draft?.fields?.contractNum || '',
    factory: Array.isArray(client.manufacturers) ? client.manufacturers.join(' + ') : '',
    address: client.address || draft?.fields?.endereco || '',
    document_type: 'projeto_inicial',
    status: isDraftSave ? 'draft' : (existingProject?.status || 'active'),
    owner_email: primaryAccountEmail,
    created_by: createdBy,
    updated_by: actorEmail,
    assigned_to_email: assignedToEmail,
    last_editor_email: actorEmail,
    last_editor_name: String(actor?.name || ''),
    is_draft: isDraftSave || Boolean(existingProject?.is_draft),
    draft_owner_email: isDraftSave ? actorEmail : (normalizeEmail(existingProject?.draft_owner_email) || createdBy || actorEmail),
    draft_saved_at: isDraftSave ? nowIso : existingProject?.draft_saved_at || null,
    data: {
      draft: draft || null,
      preview: preview || null,
      actor: actor || null,
      ownerEmail: primaryAccountEmail,
      createdBy,
      assignedToEmail,
      lastEditorEmail: actorEmail,
      lastEditorName: String(actor?.name || ''),
      lastAction: persistenceAction || 'autosave',
      lastEventId: eventId || null,
      lastEventAt: createdAt || nowIso,
      contentPreservedFromImplicitLoss: Boolean(protectedDocument.protected),
    },
  };

  const { error } = await supabaseServer
    .from('document_projects')
    .upsert(projectPayload, { onConflict: 'id' });
  if (error) throw error;
  await persistAuditLog({ projectId, actor, action: persistenceAction, draft, preview, settings, eventId, createdAt });
  return { assetPromotions: settingsAssetPromotions };
}

function isStaleProjectEvent(existingProject, createdAt) {
  if (!existingProject?.data?.lastEventAt || !createdAt) return false;
  const lastEventTime = Date.parse(existingProject.data.lastEventAt);
  const incomingTime = Date.parse(createdAt);
  if (!Number.isFinite(lastEventTime) || !Number.isFinite(incomingTime)) return false;
  return incomingTime < lastEventTime;
}

async function loadProjectForWrite(projectId) {
  const { data, error } = await supabaseServer
    .from('document_projects')
    .select('id, status, data, owner_email, created_by, updated_by, assigned_to_email, last_editor_email, last_editor_name, is_draft, draft_owner_email, draft_saved_at, deleted_at, deleted_for_users')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadProjectSnapshotForRead(projectId) {
  const safeProjectId = safeId(projectId);
  if (!safeProjectId) return null;
  const { value } = await cachedQuery(`project-snapshot:${safeProjectId}`, cacheTtl.latestProjectMeta, async () => {
    const { data, error } = await withSupabaseOperationTimeout(() => supabaseServer
      .from('document_projects')
      .select('id, data, updated_at, status, owner_email, created_by, assigned_to_email, draft_owner_email, deleted_at, deleted_for_users')
      .eq('id', safeProjectId)
      .maybeSingle());
    if (error) throw error;
    return data || null;
  });
  return value;
}

async function loadLatestProjectSnapshotForActor(actorEmail) {
  const cacheKey = `latest-project-meta:${normalizeEmail(actorEmail) || 'admin'}`;
  const { value: projects } = await cachedQuery(cacheKey, cacheTtl.latestProjectMeta, async () => {
    let query = supabaseServer
      .from('document_projects')
      .select('id, updated_at, status, owner_email, created_by, assigned_to_email, draft_owner_email, deleted_at, deleted_for_users')
      .eq('document_type', 'projeto_inicial')
      .neq('status', 'sold')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(24);
    if (!isAdminEmail(actorEmail)) {
      query = query.or(privateProjectAccessOr(actorEmail));
    }
    const { data, error } = await withSupabaseOperationTimeout(() => query);
    if (error) throw error;
    return (data || []).filter(item => !isDeletedForUser(item, actorEmail));
  });

  for (const item of (projects || []).slice(0, 5)) {
    const snapshot = await loadProjectSnapshotForRead(item.id);
    if (hasPersistableContent(snapshot?.data?.draft, snapshot?.data?.preview)) {
      return snapshot;
    }
  }
  return null;
}

async function persistAuditLog({ projectId, actor, action, draft, preview, settings, eventId, createdAt }) {
  if (!eventId) return;
  const includeSnapshot = shouldStoreAuditSnapshot(action);
  const { error } = await supabaseServer
    .from('editor_audit_logs')
    .insert({
      project_id: projectId,
      event_id: eventId,
      actor_email: normalizeEmail(actor?.email),
      action: action || 'autosave',
      payload: {
        draft: draft ? { updatedAt: draft.updatedAt || null } : null,
        preview: preview ? { environments: Array.isArray(preview.environments) ? preview.environments.length : 0 } : null,
        settingsChanged: Boolean(settings),
        snapshot: includeSnapshot ? {
          draft: draft || null,
          preview: preview || null,
          settings: settings || null,
        } : null,
        snapshotOmitted: !includeSnapshot,
      },
      created_at: createdAt || new Date().toISOString(),
    });
  if (error && error.code !== '23505') throw error;
}

function shouldStoreAuditSnapshot(action = '') {
  const normalized = String(action || '').toLowerCase();
  return normalized === 'save_as_draft'
    || normalized === 'generate_project_initial'
    || normalized === 'project_restored'
    || normalized === 'portfolio_history_restore';
}

function protectAgainstImplicitContentLoss({ existingProject, action, draft, preview }) {
  if (!existingProject?.data || isExplicitDeletionAction(action)) {
    return { draft, preview, protected: false };
  }
  const previousDraft = existingProject.data?.draft || null;
  if (!projectDraftStructureWasReduced(previousDraft, draft)) {
    return { draft, preview, protected: false };
  }
  return {
    draft: previousDraft || draft || null,
    preview: existingProject.data?.preview || preview || null,
    protected: true,
  };
}

function isExplicitDeletionAction(action = '') {
  const normalized = String(action || '').toLowerCase();
  return normalized.includes('delete')
    || normalized.includes('deleted')
    || normalized.includes('removed')
    || normalized === 'portfolio_history_restore';
}

function projectDraftStructureWasReduced(previousDraft, incomingDraft) {
  if (!previousDraft || !incomingDraft) return false;
  const previousEnvironments = Array.isArray(previousDraft.ambientes) ? previousDraft.ambientes : [];
  const incomingEnvironments = Array.isArray(incomingDraft.ambientes) ? incomingDraft.ambientes : [];
  if (!previousEnvironments.length) return false;
  if (incomingEnvironments.length < previousEnvironments.length) return true;

  const incomingById = mapById(incomingEnvironments);
  return previousEnvironments.some((previousEnvironment) => {
    const incomingEnvironment = incomingById.get(String(previousEnvironment?.id || ''));
    if (previousEnvironment?.id && !incomingEnvironment) return true;
    if (!incomingEnvironment) return false;
    if (collectionWasReduced(previousEnvironment.photos, incomingEnvironment.photos)) return true;
    return nestedPagesWereReduced(previousEnvironment.pages, incomingEnvironment.pages);
  });
}

function nestedPagesWereReduced(previousPages = [], incomingPages = []) {
  if (collectionWasReduced(previousPages, incomingPages)) return true;
  const incomingById = mapById(incomingPages);
  return (Array.isArray(previousPages) ? previousPages : []).some((previousPage) => {
    const incomingPage = incomingById.get(String(previousPage?.id || ''));
    if (previousPage?.id && !incomingPage) return true;
    if (!incomingPage) return false;
    if (collectionWasReduced(previousPage.frames, incomingPage.frames)) return true;
    if (collectionWasReduced(previousPage.annotations, incomingPage.annotations)) return true;
    const incomingFramesById = mapById(incomingPage.frames);
    return (Array.isArray(previousPage.frames) ? previousPage.frames : []).some((previousFrame) => {
      const incomingFrame = incomingFramesById.get(String(previousFrame?.id || ''));
      if (previousFrame?.id && !incomingFrame) return true;
      if (!incomingFrame) return false;
      return collectionWasReduced(previousFrame.annotations, incomingFrame.annotations);
    });
  });
}

function collectionWasReduced(previous = [], incoming = []) {
  const previousList = Array.isArray(previous) ? previous : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (!previousList.length) return false;
  if (incomingList.length < previousList.length) return true;
  const previousIds = previousList.map(item => String(item?.id || '')).filter(Boolean);
  if (!previousIds.length) return false;
  const incomingIds = new Set(incomingList.map(item => String(item?.id || '')).filter(Boolean));
  return previousIds.some(id => !incomingIds.has(id));
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : [])
    .filter(item => item?.id)
    .map(item => [String(item.id), item]));
}

async function restoreBestProjectSnapshot({ projectId, actor }) {
  const current = await loadProjectForWrite(projectId);
  if (!current) throw new Error('Projeto nao encontrado para restauracao.');
  const actorEmail = normalizeEmail(actor?.email);
  const candidate = await findBestRestoreCandidate(projectId, current);
  if (!candidate) throw new Error('Nenhum snapshot restauravel foi encontrado para este projeto.');

  const currentData = current.data && typeof current.data === 'object' ? current.data : {};
  const preview = candidate.snapshot.preview || currentData.preview || null;
  const draft = candidate.snapshot.draft || draftFromPreview(preview, currentData.draft || null);
  if (!hasPersistableContent(draft, preview)) {
    throw new Error('O snapshot encontrado nao possui ambientes para restaurar.');
  }

  const client = preview?.client || {};
  const restoredAt = new Date().toISOString();
  const status = current.status === 'sold' ? 'sold' : (current.is_draft ? 'draft' : 'active');
  const isDraft = status === 'sold' ? false : Boolean(current.is_draft || status === 'draft');
  const { error } = await supabaseServer
    .from('document_projects')
    .update({
      title: preview?.projectType || currentData.preview?.projectType || 'Projeto Inicial',
      client_name: client.name || draft?.fields?.clientName || '',
      contract_number: client.contractNumber || draft?.fields?.contractNum || '',
      address: client.address || draft?.fields?.endereco || '',
      status,
      is_draft: isDraft,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null,
      deleted_for_users: [],
      restored_at: restoredAt,
      restored_by: actorEmail || primaryAccountEmail,
      updated_by: actorEmail || primaryAccountEmail,
      last_editor_email: actorEmail || primaryAccountEmail,
      last_editor_name: String(actor?.name || 'Admin'),
      data: {
        ...currentData,
        draft,
        preview,
        restoredFrom: candidate.source,
        restoredSourceId: candidate.id || '',
        restoredAt,
        restoredBy: actorEmail || primaryAccountEmail,
      },
    })
    .eq('id', projectId);
  if (error) throw error;

  await persistAuditLog({
    projectId,
    actor,
    action: 'project_restored',
    draft,
    preview,
    settings: null,
    eventId: randomUUID(),
    createdAt: restoredAt,
  });

  return {
    source: candidate.source,
    environments: Array.isArray(draft?.ambientes) ? draft.ambientes.length : (preview?.environments || []).length,
    restoredAt,
  };
}

async function findBestRestoreCandidate(projectId, currentProject) {
  const candidates = [];
  const currentSnapshot = {
    draft: currentProject?.data?.draft || null,
    preview: currentProject?.data?.preview || null,
  };
  addRestoreCandidate(candidates, {
    source: 'current_project',
    id: projectId,
    createdAt: currentProject?.data?.lastEventAt || '',
    snapshot: currentSnapshot,
  });

  const { data: logs, error: logsError } = await supabaseServer
    .from('editor_audit_logs')
    .select('id, event_id, action, payload, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (logsError) throw logsError;
  (logs || []).forEach((log) => {
    const snapshot = restoreSnapshotFromAuditPayload(log.payload);
    addRestoreCandidate(candidates, {
      source: `audit:${log.action || 'editor'}`,
      id: log.id || log.event_id || '',
      createdAt: log.created_at || '',
      snapshot,
    });
  });

  const { data: versions, error: versionsError } = await supabaseServer
    .from('document_html_versions')
    .select('id, html_content, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (versionsError) throw versionsError;
  (versions || []).forEach((version) => {
    const preview = extractPreviewFromHtmlContent(version.html_content || '');
    if (!preview) return;
    addRestoreCandidate(candidates, {
      source: 'html_version',
      id: version.id || '',
      createdAt: version.created_at || '',
      snapshot: {
        draft: draftFromPreview(preview, currentProject?.data?.draft || null),
        preview,
      },
    });
  });

  return candidates
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || dateScore(b.createdAt) - dateScore(a.createdAt))[0] || null;
}

function addRestoreCandidate(candidates, candidate) {
  const snapshot = candidate?.snapshot || {};
  const score = scoreProjectSnapshot(snapshot);
  if (!score) return;
  candidates.push({ ...candidate, score });
}

function dateScore(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function restoreSnapshotFromAuditPayload(payload = {}) {
  const snapshot = payload?.snapshot || {};
  return {
    draft: snapshot.draft || null,
    preview: snapshot.preview || null,
  };
}

function extractPreviewFromHtmlContent(html = '') {
  const match = String(html || '').match(/window\.__DCORATTO_PORTFOLIO_DOCUMENT__\s*=\s*([\s\S]*?);\s*window\.__DCORATTO_CLIENT_VIEW__/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function draftFromPreview(preview, previousDraft = null) {
  if (!Array.isArray(preview?.environments) || !preview.environments.length) return previousDraft || null;
  const ambientes = preview.environments.map((environment, index) => {
    const id = slugify(`${environment.title || 'ambiente'}-${index + 1}`) || `ambiente-${index + 1}`;
    const photos = Array.isArray(environment.photos) && environment.photos.length
      ? environment.photos.map(photo => ({ label: photo.label || photo.title || '', src: photo.src || '' })).filter(photo => photo.src)
      : [];
    return {
      id,
      name: environment.title || `Ambiente ${index + 1}`,
      img: photos[0]?.src || '',
      photos,
      layout: environment.layout || 'balanced',
      pages: Array.isArray(environment.pages) ? environment.pages : [],
    };
  });
  const state = {};
  ambientes.forEach((amb, index) => {
    const environment = preview.environments[index] || {};
    state[amb.id] = {
      tampon: splitSpecValue(environment.specs?.tamponamentos),
      porta: splitSpecValue(environment.specs?.portas),
      puxador: splitSpecValue(environment.specs?.puxadores),
      corredica: splitSpecValue(environment.specs?.corredicas),
      cores: Array.isArray(environment.colors) ? environment.colors : [],
      obs: Array.isArray(environment.notes) ? environment.notes : [],
      obsExtra: '',
    };
  });
  return {
    fields: {
      clientName: preview.client?.name || '',
      contractNum: preview.client?.contractNumber || '',
      endereco: preview.client?.address || '',
      factories: Array.isArray(previousDraft?.fields?.factories) ? previousDraft.fields.factories : [],
    },
    ambientes,
    state,
    updatedAt: new Date().toISOString(),
  };
}

function splitSpecValue(value = '') {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function scoreProjectSnapshot(snapshot = {}) {
  return scoreDraft(snapshot.draft) + scorePreview(snapshot.preview);
}

function scoreDraft(draft = {}) {
  const environments = Array.isArray(draft?.ambientes) ? draft.ambientes : [];
  const stateValues = Object.values(draft?.state || {});
  return environments.reduce((total, environment) => {
    const pages = Array.isArray(environment.pages) ? environment.pages : [];
    const photos = Array.isArray(environment.photos) ? environment.photos : [];
    return total + 10 + photos.length + pages.reduce((pageTotal, page) => {
      const frames = Array.isArray(page.frames) ? page.frames : [];
      const annotations = Array.isArray(page.annotations) ? page.annotations : [];
      const freeElements = Array.isArray(page.freeElements) ? page.freeElements : [];
      return pageTotal + 5 + frames.length * 3 + annotations.length + freeElements.length;
    }, 0);
  }, 0) + stateValues.reduce((total, item) => {
    return total
      + (Array.isArray(item?.cores) ? item.cores.length : 0)
      + (Array.isArray(item?.tampon) ? item.tampon.length : 0)
      + (Array.isArray(item?.porta) ? item.porta.length : 0)
      + (Array.isArray(item?.puxador) ? item.puxador.length : 0)
      + (Array.isArray(item?.corredica) ? item.corredica.length : 0)
      + (Array.isArray(item?.obs) ? item.obs.length : 0)
      + (item?.obsExtra ? 1 : 0);
  }, 0);
}

function scorePreview(preview = {}) {
  const environments = Array.isArray(preview?.environments) ? preview.environments : [];
  return environments.reduce((total, environment) => {
    const pages = Array.isArray(environment.pages) ? environment.pages : [];
    const photos = Array.isArray(environment.photos) ? environment.photos : [];
    const colors = Array.isArray(environment.colors) ? environment.colors : [];
    const notes = Array.isArray(environment.notes) ? environment.notes : [];
    return total + 10 + photos.length + colors.length + notes.length + pages.reduce((pageTotal, page) => {
      const frames = Array.isArray(page.frames) ? page.frames : [];
      const annotations = Array.isArray(page.annotations) ? page.annotations : [];
      const freeElements = Array.isArray(page.freeElements) ? page.freeElements : [];
      return pageTotal + 5 + frames.length * 3 + annotations.length + freeElements.length;
    }, 0);
  }, 0);
}

async function loadSharedEditorSettings() {
  const { data, error } = await supabaseServer
    .from('editor_settings')
    .select('payload')
    .eq('settings_key', 'default')
    .maybeSingle();
  if (error) throw error;
  const tableSettings = await loadSettingsFromSharedCatalogTables();
  const storedPayload = data?.payload || {};
  const payload = normalizeEditorSettingsPayload(storedPayload);
  const catalogItems = mergeCatalogItemsPayload(tableSettings.catalogItems, payload.catalogItems, { preferIncoming: false });
  return {
    ...payload,
    catalogItems,
    factories: normalizeFactoriesPayload(payload.factories, catalogItems),
    materialOptions: mergeMaterialOptionsPayload(tableSettings.materialOptions, payload.materialOptions),
  };
}

async function saveSharedEditorSettings(incomingSettings, actor = null, settingsMutation = null) {
  const currentSettings = await loadSharedEditorSettings();
  const actorEmail = normalizeEmail(actor?.email);
  const hasIncomingSettings = incomingSettings && Object.keys(incomingSettings).length > 0;
  const protectCatalogCollections = settingsMutation?.type !== 'settings-sync';
  const mergedSettings = hasIncomingSettings
    ? mergeEditorSettingsPayload(currentSettings, incomingSettings, { protectCatalogCollections })
    : normalizeEditorSettingsPayload(currentSettings);
  const mutatedSettings = applySettingsMutation(mergedSettings, settingsMutation, actorEmail);
  const payload = await promoteSettingsImagesToStorage(mutatedSettings);
  const { error } = await supabaseServer
    .from('editor_settings')
    .upsert({
      settings_key: 'default',
      payload,
      updated_by: actorEmail || '',
    }, { onConflict: 'settings_key' });
  if (error) throw error;
  await persistSharedCatalogMutation(payload, settingsMutation, actorEmail).catch((tableError) => {
    console.warn('Configuracoes salvas, mas nao foi possivel espelhar catalogos nas tabelas.', tableError);
  });
  return payload;
}

async function promoteSettingsImagesToStorage(settings = {}) {
  const promoted = { ...settings };
  const context = {
    normalizedAssets: new Map(),
    uploadPromises: new Map(),
    promotions: new Map(),
  };
  const [logoAsset, logoThumbAsset] = await Promise.all([
    String(promoted.logo || '').startsWith('data:image/')
      ? uploadDataUrlAsset({
        dataUrl: promoted.logo,
        folder: 'settings/logo',
        fileNameHint: 'logo',
        context,
      })
      : null,
    String(promoted.logoThumb || '').startsWith('data:image/')
      ? uploadDataUrlAsset({
        dataUrl: promoted.logoThumb,
        folder: 'settings/logo',
        fileNameHint: 'logo-thumb',
        context,
      })
      : null,
  ]);
  if (logoAsset) {
    promoted.logo = logoAsset.publicUrl || promoted.logo;
    promoted.logoAsset = mergePromotedAssetMetadata(promoted.logoAsset, logoAsset);
  }
  if (logoThumbAsset) {
    promoted.logoThumb = logoThumbAsset.publicUrl || promoted.logoThumb;
    promoted.logoThumbAsset = mergePromotedAssetMetadata(promoted.logoThumbAsset, logoThumbAsset);
  }
  promoted.catalogItems = await Promise.all((promoted.catalogItems || []).map(async (item) => {
    const textureUrl = catalogItemTextureUrlPayload(item);
    if (!String(textureUrl || '').startsWith('data:image/')) return item;
    const asset = await uploadDataUrlAsset({
      dataUrl: textureUrl,
      folder: `catalog/${catalogItemGroup(item.type)}`,
      fileNameHint: item.name || item.id || 'material',
      context,
    });
    return {
      ...item,
      textureUrl: asset.publicUrl || textureUrl,
      imageUrl: asset.publicUrl || textureUrl,
      publicUrl: asset.publicUrl || item.publicUrl || '',
      public_url: asset.publicUrl || item.public_url || '',
      storageBucket: asset.storageBucket,
      storagePath: asset.storagePath,
      storage_path: asset.storagePath,
      mimeType: asset.mimeType,
      mime_type: asset.mimeType,
      size: asset.size,
      uploadedAt: asset.uploadedAt,
      asset: mergePromotedAssetMetadata(
        item.asset || (item.assetId ? { assetId: item.assetId, localAssetId: item.assetId } : {}),
        asset
      ),
    };
  }));
  return promoted;
}

function mergePromotedAssetMetadata(existing = {}, promoted = {}) {
  const current = existing && typeof existing === 'object' ? existing : {};
  return {
    ...current,
    ...promoted,
    assetId: current.assetId || current.localAssetId || '',
    localAssetId: current.localAssetId || current.assetId || '',
    syncStatus: 'synced',
  };
}

function collectAssetPromotions(value) {
  const promotions = new Map();
  const visit = (current) => {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const localAssetId = String(current.localAssetId || current.assetId || '');
    const publicUrl = String(current.publicUrl || '');
    const storagePath = String(current.storagePath || current.storage_path || '');
    if (localAssetId && publicUrl && storagePath && current.syncStatus === 'synced') {
      const variant = current.variant === 'thumbnail' ? 'thumbnail' : 'main';
      promotions.set(`${localAssetId}:${variant}`, {
        localAssetId,
        variant,
        publicUrl,
        storageBucket: current.storageBucket || '',
        storagePath,
        mimeType: current.mimeType || current.mime_type || 'image/webp',
        width: Number(current.width || 0),
        height: Number(current.height || 0),
        size: Number(current.size || 0),
      });
    }
    Object.values(current).forEach(visit);
  };
  visit(value);
  return [...promotions.values()];
}

function mergeAssetPromotionLists(...lists) {
  const merged = new Map();
  lists.flat().filter(Boolean).forEach((promotion) => {
    const localAssetId = String(promotion.localAssetId || '');
    if (!localAssetId) return;
    const variant = promotion.variant === 'thumbnail' ? 'thumbnail' : 'main';
    merged.set(`${localAssetId}:${variant}`, { ...promotion, localAssetId, variant });
  });
  return [...merged.values()];
}

async function promoteDocumentImages({ projectId, draft, preview }) {
  const folder = `projects/${projectId}/assets`;
  const context = {
    normalizedAssets: new Map(),
    uploadPromises: new Map(),
    promotions: new Map(),
  };
  const [promotedDraft, promotedPreview] = await Promise.all([
    promoteImageDataUrls(draft, folder, context),
    promoteImageDataUrls(preview, folder, context),
  ]);
  return {
    draft: promotedDraft,
    preview: promotedPreview,
    assetPromotions: [...context.promotions.values()],
  };
}

const promotableImageFields = new Set([
  'src',
  'thumbSrc',
  'photo',
  'logo',
  'logoThumb',
  'textureUrl',
  'imageUrl',
  'imageData',
  'img',
]);

async function promoteImageDataUrls(value, folder, context) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map(item => promoteImageDataUrls(item, folder, context)));
  }

  const entries = await Promise.all(Object.entries(value).map(async ([key, fieldValue]) => {
    if (typeof fieldValue === 'string' && promotableImageFields.has(key) && fieldValue.startsWith('data:image/')) {
      const asset = await uploadDataUrlAsset({
        dataUrl: fieldValue,
        folder,
        fileNameHint: key,
        context,
      });
      recordAssetPromotion(context, value, key, asset);
      return {
        key,
        value: asset.publicUrl || fieldValue,
        asset,
      };
    }
    return {
      key,
      value: await promoteImageDataUrls(fieldValue, folder, context),
      asset: null,
    };
  }));

  const promoted = Object.fromEntries(entries.map(entry => [entry.key, entry.value]));
  entries.filter(entry => entry.asset).forEach(({ key, asset }) => {
    const metadataKey = imageAssetMetadataKey(value, key);
    const existingMetadata = value[metadataKey] && typeof value[metadataKey] === 'object'
      ? value[metadataKey]
      : {};
    promoted[metadataKey] = {
      ...existingMetadata,
      ...asset,
      assetId: existingMetadata.assetId || existingMetadata.localAssetId || '',
      localAssetId: existingMetadata.localAssetId || existingMetadata.assetId || '',
      syncStatus: 'synced',
    };
  });
  return promoted;
}

function imageAssetMetadataKey(owner = {}, field = '') {
  if (/thumb/i.test(field)) {
    if (owner.logoThumbAsset) return 'logoThumbAsset';
    if (owner.thumbAsset) return 'thumbAsset';
    return `${field}Asset`;
  }
  if (field === 'logo' || owner.logoAsset) return 'logoAsset';
  if (owner.photoAsset) return 'photoAsset';
  if (owner.asset) return 'asset';
  return `${field}Asset`;
}

async function uploadDataUrlAsset({ dataUrl, folder, fileNameHint, context }) {
  const rawHash = createHash('sha1').update(String(dataUrl || '')).digest('hex');
  const rawCacheKey = `${photoBucket}:${folder}:raw:${rawHash}`;
  const cachedRawAsset = getPromotedAssetCache(rawCacheKey);
  if (cachedRawAsset) return cachedRawAsset;
  let normalizedPromise = context?.normalizedAssets?.get(rawHash);
  if (!normalizedPromise) {
    normalizedPromise = normalizeDataUrlAsset(parseDataUrl(dataUrl));
    context?.normalizedAssets?.set(rawHash, normalizedPromise);
  }
  const parsed = await normalizedPromise;
  const hash = createHash('sha256').update(parsed.buffer).digest('hex');
  const extension = extensionFromMime(parsed.mimeType);
  const storagePath = `${folder}/asset-${hash.slice(0, 32)}.${extension}`;
  const cacheKey = `${photoBucket}:${storagePath}`;
  const cachedAsset = getPromotedAssetCache(cacheKey);
  if (cachedAsset) return cachedAsset;

  let uploadPromise = context?.uploadPromises?.get(storagePath);
  if (!uploadPromise) {
    uploadPromise = (async () => {
      const { error } = await supabaseServer.storage
        .from(photoBucket)
        .upload(storagePath, parsed.buffer, {
          cacheControl: '31536000',
          contentType: parsed.mimeType,
          upsert: false,
        });
      if (error && !isStorageObjectAlreadyExists(error)) throw error;
      const { data } = supabaseServer.storage.from(photoBucket).getPublicUrl(storagePath);
      const asset = {
        id: hash,
        storageBucket: photoBucket,
        storagePath,
        publicUrl: data?.publicUrl || '',
        mimeType: parsed.mimeType,
        width: parsed.width || 0,
        height: parsed.height || 0,
        size: parsed.buffer.length,
        uploadedAt: new Date().toISOString(),
        fileNameHint: slugify(fileNameHint || 'asset') || 'asset',
      };
      setPromotedAssetCache(cacheKey, asset);
      return asset;
    })();
    context?.uploadPromises?.set(storagePath, uploadPromise);
  }
  const asset = await uploadPromise;
  setPromotedAssetCache(rawCacheKey, asset);
  return asset;
}

function recordAssetPromotion(context, owner, field, asset) {
  const localAssetId = localAssetIdForImageField(owner, field);
  if (!localAssetId || !asset?.publicUrl) return;
  const variant = /thumb/i.test(field) ? 'thumbnail' : 'main';
  const key = `${localAssetId}:${variant}`;
  context.promotions.set(key, {
    localAssetId,
    variant,
    publicUrl: asset.publicUrl,
    storageBucket: asset.storageBucket,
    storagePath: asset.storagePath,
    mimeType: asset.mimeType,
    width: asset.width || 0,
    height: asset.height || 0,
    size: asset.size || 0,
  });
}

function localAssetIdForImageField(owner = {}, field = '') {
  const isThumbnail = /thumb/i.test(field);
  if (isThumbnail) {
    return owner.thumbAsset?.assetId
      || owner.thumbAsset?.localAssetId
      || owner.logoThumbAsset?.assetId
      || owner.logoThumbAsset?.localAssetId
      || (owner.logoAssetId ? `${owner.logoAssetId}-thumb` : '')
      || (owner.assetId ? `${owner.assetId}-thumb` : '');
  }
  return owner.photoAsset?.assetId
    || owner.photoAsset?.localAssetId
    || owner.logoAsset?.assetId
    || owner.logoAsset?.localAssetId
    || owner.asset?.assetId
    || owner.asset?.localAssetId
    || owner.logoAssetId
    || owner.assetId
    || '';
}

function getPromotedAssetCache(key) {
  const entry = promotedAssetCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    promotedAssetCache.delete(key);
    return null;
  }
  return entry.asset;
}

function setPromotedAssetCache(key, asset) {
  promotedAssetCache.set(key, {
    asset,
    expiresAt: Date.now() + promotedAssetCacheTtlMs,
  });
  if (promotedAssetCache.size <= promotedAssetCacheMaxEntries) return;
  const overflow = promotedAssetCache.size - promotedAssetCacheMaxEntries;
  [...promotedAssetCache.keys()].slice(0, overflow).forEach(cacheKey => promotedAssetCache.delete(cacheKey));
}

function isStorageObjectAlreadyExists(error) {
  const code = String(error?.statusCode || error?.status || error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '409' || message.includes('already exists') || message.includes('resource already exists');
}

async function normalizeDataUrlAsset(parsed) {
  try {
    const image = sharp(parsed.buffer, { failOn: 'none' }).rotate();
    const metadata = await image.metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const maxDimension = Math.max(width, height);
    const alreadyEfficientWebp = parsed.mimeType === 'image/webp'
      && maxDimension <= 1920
      && parsed.buffer.length <= 1_200_000;
    if (alreadyEfficientWebp) return { ...parsed, width, height };
    const { data: buffer, info } = await image
      .resize({
        width: 1920,
        height: 1920,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return {
      mimeType: 'image/webp',
      buffer,
      width: Number(info.width || width || 0),
      height: Number(info.height || height || 0),
    };
  } catch (error) {
    const invalidImageError = new Error('Imagem em data URL invalida ou corrompida.');
    invalidImageError.code = 'invalid_image_data_url';
    invalidImageError.cause = error;
    throw invalidImageError;
  }
}

function parseDataUrl(dataUrl) {
  const value = String(dataUrl || '').trim();
  const match = value.match(/^data:([^;,]+)((?:;[^,]*)?),(.*)$/s);
  if (!match) {
    const error = new Error('Imagem em data URL invalida.');
    error.code = 'invalid_image_data_url';
    throw error;
  }
  const mimeType = String(match[1] || '').trim().toLowerCase();
  if (!mimeType.startsWith('image/')) {
    const error = new Error('Imagem em data URL invalida.');
    error.code = 'invalid_image_data_url';
    throw error;
  }
  const parameters = String(match[2] || '').toLowerCase();
  const payload = String(match[3] || '');
  let buffer;
  if (parameters.split(';').includes('base64')) {
    let normalized = payload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    normalized += '='.repeat((4 - (normalized.length % 4)) % 4);
    buffer = Buffer.from(normalized, 'base64');
  } else {
    try {
      buffer = Buffer.from(decodeURIComponent(payload), 'utf8');
    } catch {
      buffer = Buffer.from(payload, 'utf8');
    }
  }
  if (!buffer.length) {
    const error = new Error('Imagem em data URL invalida.');
    error.code = 'invalid_image_data_url';
    throw error;
  }
  return { mimeType, buffer };
}

function extensionFromMime(mimeType = '') {
  return {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }[mimeType] || 'bin';
}

function normalizeFactoryName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeFactoriesPayload(factories = [], catalogItems = []) {
  const values = Array.isArray(factories) ? factories : [];
  const normalized = values
    .map(factory => normalizeFactoryName(typeof factory === 'string' ? factory : factory?.name))
    .filter(Boolean);
  const manufacturers = (Array.isArray(catalogItems) ? catalogItems : [])
    .map(item => normalizeFactoryName(item.manufacturer || item.factory))
    .filter(Boolean);
  return [...new Set([...defaultFactories, ...normalized, ...manufacturers])];
}

function normalizeEditorSettingsPayload(settings = {}) {
  const incomingSettings = settings || {};
  const catalogItems = normalizeCatalogItemsPayload(incomingSettings.catalogItems);
  return {
    ...incomingSettings,
    logo: incomingSettings.logo || '',
    catalogItems,
    factories: normalizeFactoriesPayload(incomingSettings.factories, catalogItems),
    observations: Array.isArray(incomingSettings.observations)
      ? [...new Set(incomingSettings.observations.filter(value => String(value || '').trim()))]
      : [],
    materialOptions: normalizeMaterialOptionsPayload(incomingSettings.materialOptions),
  };
}

function mergeEditorSettingsPayload(current = {}, incoming = {}, options = {}) {
  const currentSettings = current || {};
  const incomingSettings = incoming || {};
  const currentCatalogItems = normalizeCatalogItemsPayload(currentSettings.catalogItems);
  const incomingCatalogItems = normalizeCatalogItemsPayload(incomingSettings.catalogItems);
  const currentMaterialOptions = normalizeMaterialOptionsPayload(currentSettings.materialOptions);
  const catalogItems = options.protectCatalogCollections && currentCatalogItems.length
    ? currentCatalogItems
    : mergeCatalogItemsPayload(currentCatalogItems, incomingCatalogItems, { preferIncoming: false });
  const materialOptions = options.protectCatalogCollections && hasMaterialOptionsPayload(currentMaterialOptions)
    ? currentMaterialOptions
    : mergeMaterialOptionsPayload(currentMaterialOptions, incomingSettings.materialOptions);
  return {
    ...currentSettings,
    ...incomingSettings,
    logo: incomingSettings.logo || currentSettings.logo || '',
    catalogItems,
    factories: Array.isArray(incomingSettings.factories)
      ? normalizeFactoriesPayload(incomingSettings.factories, catalogItems)
      : normalizeFactoriesPayload(currentSettings.factories, catalogItems),
    observations: [...new Set([...(currentSettings.observations || []), ...(incomingSettings.observations || [])])],
    materialOptions,
  };
}

function hasMaterialOptionsPayload(options = {}) {
  return Object.values(options || {}).some(values => Array.isArray(values) && values.length);
}

function applySettingsMutation(settings = {}, mutation = null, actorEmail = '') {
  const payload = normalizeEditorSettingsPayload(settings);
  if (!mutation?.type) return payload;
  if (mutation.type === 'catalog-item-upsert' && mutation.item) {
    if (isStaleCatalogMutation(payload.catalogItems, mutation, [mutation.previousId, mutation.previousCatalogKey])) return payload;
    const mutationTimestamp = mutation.createdAt || new Date().toISOString();
    payload.catalogItems = upsertCatalogItemPayload(payload.catalogItems, {
      ...mutation.item,
      updatedBy: actorEmail || mutation.item.updatedBy || '',
      updatedAt: mutationTimestamp,
    }, [mutation.previousId, mutation.previousCatalogKey]);
  }
  if (mutation.type === 'catalog-item-delete') {
    if (isStaleCatalogMutation(payload.catalogItems, mutation)) return payload;
    payload.catalogItems = removeCatalogItemsPayload(payload.catalogItems, [mutation]);
  }
  if (mutation.type === 'catalog-items-delete') {
    payload.catalogItems = removeCatalogItemsPayload(
      payload.catalogItems,
      (mutation.items || []).filter(item => !isStaleCatalogMutation(payload.catalogItems, { ...item, createdAt: mutation.createdAt }))
    );
  }
  if (mutation.type === 'material-option-upsert' && mutation.group && mutation.value) {
    payload.materialOptions = upsertMaterialOptionPayload(payload.materialOptions, mutation);
  }
  if (mutation.type === 'material-option-delete' && mutation.group && mutation.value) {
    payload.materialOptions = deleteMaterialOptionPayload(payload.materialOptions, mutation.group, mutation.value);
  }
  if (mutation.type === 'factory-upsert' && mutation.name) {
    const nextName = normalizeFactoryName(mutation.name);
    const previousName = normalizeFactoryName(mutation.previousName);
    const factories = normalizeFactoriesPayload(payload.factories, payload.catalogItems);
    payload.factories = [...new Set(factories.map(factory => factory === previousName ? nextName : factory).concat(nextName))];
    if (previousName && nextName && previousName !== nextName) {
      const updatedAt = mutation.createdAt || new Date().toISOString();
      payload.catalogItems = normalizeCatalogItemsPayload(payload.catalogItems.map((item) => {
        if (normalizeFactoryName(item.manufacturer || item.factory) !== previousName) return item;
        const catalogKey = stableCatalogKey({
          category: catalogItemGroup(item.type || item.category),
          factory: nextName,
          line: item.line || item.lineName || item.line_name || '',
          quality: item.quality || item.materialType || '',
          name: item.name,
        });
        return {
          ...item,
          factory: nextName,
          manufacturer: nextName,
          catalogKey,
          catalog_key: catalogKey,
          updatedAt,
          updated_at: updatedAt,
          updatedBy: actorEmail || item.updatedBy || item.updated_by || '',
          updated_by: actorEmail || item.updated_by || item.updatedBy || '',
        };
      }));
    }
  }
  if (mutation.type === 'factory-delete' && mutation.name) {
    const name = normalizeFactoryName(mutation.name);
    payload.factories = normalizeFactoriesPayload(payload.factories, []).filter(factory => factory !== name || defaultFactories.includes(factory));
  }
  return payload;
}

function isStaleCatalogMutation(items = [], mutation = {}, previousKeys = []) {
  if (!mutation?.createdAt) return false;
  const incomingTime = Date.parse(mutation.createdAt);
  if (!Number.isFinite(incomingTime)) return false;
  const existingItem = findCatalogItemForMutation(items, mutation.item || mutation, previousKeys);
  if (!existingItem) return false;
  const existingTime = Date.parse(existingItem.updatedAt || existingItem.updated_at || existingItem.uploadedAt || existingItem.createdAt || '');
  return Number.isFinite(existingTime) && existingTime > incomingTime;
}

function catalogItemTextureUrlPayload(item = {}) {
  return item.textureUrl
    || item.imageUrl
    || item.imageData
    || item.publicUrl
    || item.texture_url
    || item.image_url
    || item.image_data
    || item.public_url
    || item.data?.textureUrl
    || item.data?.imageUrl
    || item.data?.publicUrl
    || item.data?.image
    || '';
}

function catalogItemUpdatedTimePayload(item = {}) {
  const value = item.updatedAt
    || item.updated_at
    || item.uploadedAt
    || item.createdAt
    || item.created_at
    || item.data?.updatedAt
    || item.data?.updated_at
    || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function isCatalogDataImagePayload(value = '') {
  return String(value || '').startsWith('data:image/');
}

function chooseCatalogImagePayload(existingItem = {}, incomingItem = {}) {
  const existingImage = catalogItemTextureUrlPayload(existingItem);
  const incomingImage = catalogItemTextureUrlPayload(incomingItem);
  if (!existingImage) return incomingImage;
  if (!incomingImage) return existingImage;
  const existingTime = catalogItemUpdatedTimePayload(existingItem);
  const incomingTime = catalogItemUpdatedTimePayload(incomingItem);
  if (existingTime && incomingTime && existingTime > incomingTime) return existingImage;
  if (isCatalogDataImagePayload(existingImage) && (!incomingTime || existingTime >= incomingTime)) return existingImage;
  return incomingImage;
}

function normalizeCatalogItemsPayload(items = []) {
  const merged = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || !item.name) return;
    const textureUrl = catalogItemTextureUrlPayload(item);
    const normalizedItem = textureUrl
      ? { ...item, textureUrl, imageUrl: item.imageUrl || textureUrl }
      : { ...item };
    normalizedItem.catalogKey = stableCatalogKey({
      category: catalogItemGroup(normalizedItem.type || normalizedItem.category),
      factory: normalizedItem.manufacturer || normalizedItem.factory || '',
      line: normalizedItem.line || normalizedItem.line_name || normalizedItem.lineName || '',
      quality: normalizedItem.quality || normalizedItem.materialType || '',
      name: normalizedItem.name,
    });
    normalizedItem.catalog_key = normalizedItem.catalogKey;
    const key = [
      normalizedItem.id,
      normalizedItem.catalogKey,
    ].filter(Boolean).join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalizedItem);
  });
  return preferAdminCatalogItems(merged);
}

function preferAdminCatalogItems(items = []) {
  return items;
}

function mergeCatalogItemsPayload(current = [], incoming = [], options = {}) {
  let merged = [];
  const preferIncoming = options.preferIncoming !== false;
  const firstItems = preferIncoming ? current : incoming;
  const secondItems = preferIncoming ? incoming : current;
  normalizeCatalogItemsPayload(firstItems).forEach((item) => {
    if (!item || !item.name) return;
    merged = upsertCatalogItemPayload(merged, item);
  });
  normalizeCatalogItemsPayload(secondItems).forEach((item) => {
    if (!item || !item.name) return;
    merged = upsertCatalogItemPayload(merged, item);
  });
  return merged;
}

function catalogItemPayloadMatchKeys(item = {}) {
  if (!item) return [];
  return [
    item.id,
    item.catalogKey,
    item.catalog_key,
    stableCatalogKey({
      category: catalogItemGroup(item.type || item.category),
      factory: item.manufacturer || item.factory || '',
      line: item.line || item.line_name || item.lineName || '',
      quality: item.quality || item.materialType || '',
      name: item.name || '',
    }),
  ].filter(Boolean).map(value => String(value).toLowerCase());
}

function upsertCatalogItemPayload(items = [], incomingItem, previousKeys = []) {
  const normalizedItem = normalizeCatalogItemsPayload([incomingItem])[0];
  if (!normalizedItem) return items || [];
  const matchKeys = new Set([
    ...catalogItemPayloadMatchKeys(normalizedItem),
    ...previousKeys.filter(Boolean).map(value => String(value).toLowerCase()),
  ]);
  let replaced = false;
  const next = (items || []).map((item) => {
    const keys = catalogItemPayloadMatchKeys(item);
    if (!replaced && keys.some(key => matchKeys.has(key))) {
      replaced = true;
      return mergeCatalogItemPayload(item, normalizedItem);
    }
    return item;
  });
  if (!replaced) next.push(normalizedItem);
  return next;
}

function mergeCatalogItemPayload(existingItem = {}, incomingItem = {}) {
  const image = chooseCatalogImagePayload(existingItem, incomingItem);
  const merged = {
    ...existingItem,
    ...incomingItem,
  };
  if (image) {
    merged.textureUrl = image;
    merged.imageUrl = image;
  }
  if (!incomingItem.storageBucket && existingItem.storageBucket) merged.storageBucket = existingItem.storageBucket;
  if (!incomingItem.storagePath && existingItem.storagePath) merged.storagePath = existingItem.storagePath;
  if (!incomingItem.publicUrl && existingItem.publicUrl) merged.publicUrl = existingItem.publicUrl;
  if (!incomingItem.mimeType && existingItem.mimeType) merged.mimeType = existingItem.mimeType;
  return normalizeCatalogItemsPayload([merged])[0] || merged;
}

function removeCatalogItemsPayload(items = [], selectors = []) {
  const removeKeys = new Set((selectors || []).flatMap(selector => [
    selector?.id,
    selector?.catalogKey,
    selector?.catalog_key,
  ]).filter(Boolean).map(value => String(value).toLowerCase()));
  if (!removeKeys.size) return items || [];
  return (items || []).filter(item => !catalogItemPayloadMatchKeys(item).some(key => removeKeys.has(key)));
}

function normalizeMaterialOptionsPayload(options = {}) {
  const groups = new Set(['tampon', 'porta', 'puxador', 'corredica', ...Object.keys(options || {})]);
  return Object.fromEntries([...groups].map(group => [
    group,
    Array.isArray(options?.[group])
      ? [...new Set(options[group].filter(value => String(value || '').trim()))]
      : [],
  ]));
}

function mergeMaterialOptionsPayload(current = {}, incoming = {}) {
  const groups = new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})]);
  return Object.fromEntries([...groups].map(group => [
    group,
    [...new Set([...(current?.[group] || []), ...(incoming?.[group] || [])])],
  ]));
}

function upsertMaterialOptionPayload(options = {}, mutation = {}) {
  const next = normalizeMaterialOptionsPayload(options);
  if (mutation.previousGroup && mutation.previousValue) {
    next[mutation.previousGroup] = (next[mutation.previousGroup] || []).filter(value => value !== mutation.previousValue);
  }
  next[mutation.group] = [...new Set([...(next[mutation.group] || []), mutation.value])];
  return next;
}

function deleteMaterialOptionPayload(options = {}, group, value) {
  const next = normalizeMaterialOptionsPayload(options);
  next[group] = (next[group] || []).filter(option => option !== value);
  return next;
}

async function loadSettingsFromSharedCatalogTables() {
  const [materialsResult, optionsResult] = await Promise.all([
    supabaseServer
      .from('catalog_materials')
      .select('id,catalog_key,group_key,name,code,manufacturer,line_name,quality,material_type,category,hex,texture_url,image_url,storage_bucket,storage_path,public_url,mime_type,width,height,active,sort_order,created_by,updated_by,created_at,updated_at')
      .eq('active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .limit(500),
    supabaseServer
      .from('catalog_options')
      .select('group_key, label, sort_order')
      .eq('active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true }),
  ]);

  if (materialsResult.error) throw materialsResult.error;
  if (optionsResult.error) throw optionsResult.error;

  const catalogItems = (materialsResult.data || [])
    .map(catalogMaterialToSettingsItem)
    .filter(Boolean);
  const materialOptions = (optionsResult.data || []).reduce((acc, option) => {
    if (!option?.group_key || !option?.label) return acc;
    acc[option.group_key] = [...(acc[option.group_key] || []), option.label];
    return acc;
  }, {});

  return { catalogItems, materialOptions };
}

function catalogMaterialToSettingsItem(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {};
  const type = data.type || settingsTypeFromCatalogGroup(row?.group_key);
  if (!type || !row?.name) return null;
  const textureUrl = data.textureUrl || data.imageUrl || row.public_url || row.image_url || row.texture_url || '';
  return {
    id: data.id || row.catalog_key || `${row.group_key}-${row.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    catalogKey: row.catalog_key || data.catalogKey || '',
    catalog_key: row.catalog_key || data.catalogKey || '',
    type,
    category: data.category || row.category || row.group_key || '',
    factory: data.factory || data.manufacturer || row.manufacturer || '',
    manufacturer: data.manufacturer || row.manufacturer || '',
    line: data.line || data.line_name || row.line_name || '',
    name: data.name || row.name,
    quality: data.quality || row.quality || '',
    materialType: data.materialType || row.material_type || row.quality || '',
    hex: data.hex || row.hex || '#b8976a',
    textureUrl,
    imageUrl: textureUrl,
    storageBucket: data.storageBucket || row.storage_bucket || '',
    storagePath: data.storagePath || row.storage_path || '',
    publicUrl: data.publicUrl || row.public_url || row.image_url || '',
    storage_path: data.storagePath || row.storage_path || '',
    public_url: data.publicUrl || row.public_url || row.image_url || '',
    mimeType: data.mimeType || row.mime_type || '',
    mime_type: data.mimeType || row.mime_type || '',
    width: data.width || row.width || null,
    height: data.height || row.height || null,
    active: row.active !== false,
    sort_order: row.sort_order ?? 0,
    createdBy: data.createdBy || row.created_by || '',
    updatedBy: data.updatedBy || row.updated_by || '',
    created_by: data.createdBy || row.created_by || '',
    updated_by: data.updatedBy || row.updated_by || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    source: data.source || 'shared',
  };
}

function settingsTypeFromCatalogGroup(groupKey) {
  return {
    color: 'color',
    boa_vista_cores: 'color',
    madeira: 'color',
    laca: 'color',
    tamponamento: 'tampon',
    tampon: 'tampon',
    puxador: 'handle',
    porta: 'door',
    corredica: 'slide',
  }[groupKey] || '';
}

async function persistSharedCatalogMutation(settings = {}, mutation = null, actorEmail = '') {
  if (!mutation?.type) return;
  if (mutation.type === 'settings-sync') {
    await persistSharedCatalogTables(settings, actorEmail);
    return;
  }
  if (mutation.type === 'catalog-item-upsert' && mutation.item) {
    if (isStaleCatalogMutation(settings.catalogItems || [], mutation, [mutation.previousId, mutation.previousCatalogKey])) return;
    const item = findCatalogItemForMutation(settings.catalogItems || [], mutation.item, [mutation.previousId, mutation.previousCatalogKey]);
    if (!item) return;
    await upsertSharedCatalogItem(item, actorEmail);
    const nextCatalogKey = item.catalogKey || item.catalog_key || catalogMaterialKeyFromItem(item);
    if (mutation.previousCatalogKey && mutation.previousCatalogKey !== nextCatalogKey) {
      await softDeleteSharedCatalogItem({ catalogKey: mutation.previousCatalogKey }, actorEmail, 'catalog_item_key_changed');
    }
    return;
  }
  if (mutation.type === 'catalog-item-delete') {
    if (isStaleCatalogMutation(settings.catalogItems || [], mutation)) return;
    await softDeleteSharedCatalogItem(mutation, actorEmail, 'catalog_item_removed');
    return;
  }
  if (mutation.type === 'catalog-items-delete') {
    for (const item of mutation.items || []) {
      if (isStaleCatalogMutation(settings.catalogItems || [], { ...item, createdAt: mutation.createdAt })) continue;
      await softDeleteSharedCatalogItem(item, actorEmail, 'catalog_item_removed');
    }
    return;
  }
  if (mutation.type === 'material-option-upsert' && mutation.group && mutation.value) {
    if (mutation.previousGroup && mutation.previousValue && (mutation.previousGroup !== mutation.group || mutation.previousValue !== mutation.value)) {
      await softDeleteSharedCatalogOption(mutation.previousGroup, mutation.previousValue, actorEmail, 'catalog_option_changed');
    }
    await upsertSharedCatalogOption(mutation.group, mutation.value, settings.catalogItems || [], actorEmail);
    return;
  }
  if (mutation.type === 'material-option-delete' && mutation.group && mutation.value) {
    await softDeleteSharedCatalogOption(mutation.group, mutation.value, actorEmail, 'catalog_option_removed');
    return;
  }
  if (mutation.type === 'factory-upsert' && mutation.previousName && mutation.name) {
    const previousName = normalizeFactoryName(mutation.previousName);
    const nextName = normalizeFactoryName(mutation.name);
    if (!previousName || !nextName || previousName === nextName) return;
    await persistSharedCatalogTables(settings, actorEmail);
    await softDeleteSharedCatalogItemsByManufacturer(previousName, actorEmail, 'factory_renamed');
  }
}

function findCatalogItemForMutation(items = [], incomingItem = {}, previousKeys = []) {
  const matchKeys = new Set([
    ...catalogItemPayloadMatchKeys(incomingItem),
    ...previousKeys.filter(Boolean).map(value => String(value).toLowerCase()),
  ]);
  return (items || []).find(item => catalogItemPayloadMatchKeys(item).some(key => matchKeys.has(key))) || null;
}

function catalogMaterialKeyFromItem(item = {}) {
  return stableCatalogKey({
    category: catalogItemGroup(item.type),
    factory: item.manufacturer || item.factory || '',
    line: item.line || item.line_name || '',
    quality: item.quality || item.materialType || '',
    name: item.name,
  });
}

function catalogMaterialRowFromItem(item, index = 0, actorEmail = '') {
  const groupKey = catalogItemGroup(item.type);
  const catalogKey = item.catalogKey || item.catalog_key || catalogMaterialKeyFromItem(item);
  const textureUrl = catalogItemTextureUrlPayload(item);
  const publicImageUrl = [
    item.textureUrl,
    item.imageUrl,
    item.texture_url,
    item.image_url,
    item.publicUrl,
    item.public_url,
  ].map(value => String(value || '').trim())
    .find(value => value && !value.startsWith('data:image/') && (value.startsWith('http') || value.startsWith('/'))) || null;
  const rowData = {
    ...item,
    catalogKey,
    textureUrl: publicImageUrl || textureUrl || '',
    imageUrl: publicImageUrl || textureUrl || '',
    publicUrl: publicImageUrl || item.publicUrl || item.public_url || '',
    public_url: publicImageUrl || item.public_url || item.publicUrl || '',
  };
  return {
    catalog_key: catalogKey,
    group_key: groupKey,
    name: item.name,
    code: item.code || item.id || null,
    brand: item.brand || item.manufacturer || null,
    manufacturer: item.manufacturer || null,
    line_name: item.line || item.line_name || null,
    quality: item.quality || null,
    material_type: item.materialType || item.quality || null,
    category: item.category || groupKey,
    hex: item.hex || null,
    texture_url: textureUrl || null,
    image_data: null,
    image_url: publicImageUrl,
    storage_bucket: item.storageBucket || photoBucket,
    storage_path: item.storagePath || null,
    public_url: publicImageUrl,
    mime_type: item.mimeType || (String(item.textureUrl || '').includes('.webp') ? 'image/webp' : null),
    width: Number(item.width) || null,
    height: Number(item.height) || null,
    sort_order: Number(item.sort_order ?? index) || 0,
    active: true,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    restored_at: new Date().toISOString(),
    restored_by: actorEmail || primaryAccountEmail,
    owner_email: primaryAccountEmail,
    created_by: item.createdBy || actorEmail || primaryAccountEmail,
    updated_by: actorEmail || primaryAccountEmail,
    data: rowData,
  };
}

async function upsertSharedCatalogItem(item, actorEmail = '') {
  if (!item?.name) return;
  const { error } = await supabaseServer
    .from('catalog_materials')
    .upsert([catalogMaterialRowFromItem(item, 0, actorEmail)], { onConflict: 'catalog_key' });
  if (error) throw error;
}

async function softDeleteSharedCatalogItem(selector = {}, actorEmail = '', reason = 'catalog_item_removed') {
  const catalogKey = selector.catalogKey || selector.catalog_key;
  if (!catalogKey) return;
  const { error } = await supabaseServer
    .from('catalog_materials')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: actorEmail || primaryAccountEmail,
      deleted_reason: reason,
      updated_by: actorEmail || primaryAccountEmail,
    })
    .eq('catalog_key', catalogKey);
  if (error) throw error;
}

async function softDeleteSharedCatalogItemsByManufacturer(manufacturer, actorEmail = '', reason = 'factory_renamed') {
  if (!manufacturer) return;
  const { error } = await supabaseServer
    .from('catalog_materials')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: actorEmail || primaryAccountEmail,
      deleted_reason: reason,
      updated_by: actorEmail || primaryAccountEmail,
    })
    .eq('manufacturer', manufacturer);
  if (error) throw error;
}

async function upsertSharedCatalogOption(group, label, catalogItems = [], actorEmail = '') {
  const image = catalogItems
    .map(item => {
      const optionGroup = catalogItemOptionGroup(item.type);
      const optionLabel = `${item.name}${item.line ? ' Â· ' + item.line : ''}`;
      return optionGroup === group && optionLabel === label ? (item.textureUrl || item.imageUrl || '') : '';
    })
    .find(Boolean) || '';
  const { error } = await supabaseServer
    .from('catalog_options')
    .upsert([{
      group_key: group,
      label,
      sort_order: 0,
      active: true,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null,
      restored_at: new Date().toISOString(),
      restored_by: actorEmail || primaryAccountEmail,
      image_data: null,
      image_url: String(image).startsWith('http') || String(image).startsWith('/') ? image : null,
      updated_by: actorEmail || primaryAccountEmail,
      data: image ? { image } : {},
    }], { onConflict: 'group_key,label' });
  if (error) throw error;
}

async function softDeleteSharedCatalogOption(group, label, actorEmail = '', reason = 'catalog_option_removed') {
  if (!group || !label) return;
  const { error } = await supabaseServer
    .from('catalog_options')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: actorEmail || primaryAccountEmail,
      deleted_reason: reason,
      updated_by: actorEmail || primaryAccountEmail,
    })
    .eq('group_key', group)
    .eq('label', label);
  if (error) throw error;
}

async function persistSharedCatalogTables(settings = {}, actorEmail = '') {
  const catalogItems = Array.isArray(settings.catalogItems) ? settings.catalogItems : [];
  const materialOptions = settings.materialOptions || {};
  const catalogGroups = [...new Set(['color', 'tamponamento', 'puxador', 'porta', 'corredica', ...catalogItems.map(item => catalogItemGroup(item.type)).filter(Boolean)])];
  const optionGroups = [...new Set(['tampon', 'porta', 'puxador', 'corredica', ...Object.keys(materialOptions || {})])];

  const materialRows = catalogItems
    .filter(item => item?.name)
    .map((item, index) => catalogMaterialRowFromItem(item, index, actorEmail));

  if (materialRows.length) {
    const { error } = await supabaseServer
      .from('catalog_materials')
      .upsert(materialRows, { onConflict: 'catalog_key' });
    if (error) throw error;
  }

  const imageByOption = new Map();
  catalogItems.forEach((item) => {
    const group = catalogItemOptionGroup(item.type);
    if (!group || !item?.name) return;
    const label = `${item.name}${item.line ? ' · ' + item.line : ''}`;
    imageByOption.set(`${group}|${label}`.toLowerCase(), item.textureUrl || item.imageUrl || '');
  });

  const optionRows = Object.entries(materialOptions).flatMap(([group, options]) => {
    if (!Array.isArray(options)) return [];
    return options.filter(Boolean).map((label, index) => {
      const image = imageByOption.get(`${group}|${label}`.toLowerCase()) || '';
      return {
        group_key: group,
        label,
        sort_order: index,
        active: true,
        deleted_at: null,
        deleted_by: null,
        deleted_reason: null,
        restored_at: new Date().toISOString(),
        restored_by: actorEmail || primaryAccountEmail,
        image_data: null,
        image_url: String(image).startsWith('http') || String(image).startsWith('/') ? image : null,
        updated_by: actorEmail || primaryAccountEmail,
        data: image ? { image } : {},
      };
    });
  });

  if (optionRows.length) {
    const { error } = await supabaseServer
      .from('catalog_options')
      .upsert(optionRows, { onConflict: 'group_key,label' });
    if (error) throw error;
  }
}

function catalogItemGroup(type) {
  return {
    color: 'color',
    tampon: 'tamponamento',
    handle: 'puxador',
    door: 'porta',
    slide: 'corredica',
  }[type] || String(type || 'material');
}

function stableCatalogKey({ category, factory, line, quality, name }) {
  return normalizeCatalogKey([category, factory, line, quality, name].join(':'));
}

function normalizeCatalogKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'catalog-item';
}

function escapePostgrestLike(value) {
  return String(value || '').replace(/[,%]/g, '');
}

function catalogItemOptionGroup(type) {
  return {
    tampon: 'tampon',
    handle: 'puxador',
    door: 'porta',
    slide: 'corredica',
  }[type] || '';
}

function hasPersistableContent(draft, preview) {
  const hasPreviewContent = Array.isArray(preview?.environments) && preview.environments.length > 0;
  const hasAmbientes = Array.isArray(draft?.ambientes) && draft.ambientes.length > 0;
  const hasFields = Object.entries(draft?.fields || {}).some(([key, value]) => {
    if (key === 'factories') return false;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(String(value || '').trim());
  });
  return hasPreviewContent || hasAmbientes || hasFields;
}

function isAdminEmail(email) {
  return normalizeEmail(email) === primaryAccountEmail;
}

function privateProjectAccessOr(email) {
  const safeEmail = escapePostgrestValue(normalizeEmail(email));
  return `assigned_to_email.eq.${safeEmail},created_by.eq.${safeEmail},draft_owner_email.eq.${safeEmail}`;
}

function escapePostgrestValue(value) {
  return String(value || '').replace(/"/g, '\\"');
}

function canAccessPrivateProject(project, actorEmail) {
  const email = normalizeEmail(actorEmail);
  if (isAdminEmail(email)) return true;
  if (!email || !project) return false;
  if (project.deleted_at) return false;
  return [
    project.assigned_to_email,
    project.created_by,
    project.draft_owner_email,
  ].map(normalizeEmail).includes(email) && !isDeletedForUser(project, email);
}

function canAccessPrivateHtmlVersion(version, actorEmail) {
  const email = normalizeEmail(actorEmail);
  if (isAdminEmail(email)) return true;
  if (!email || !version || version.deleted_at) return false;
  const deleted = Array.isArray(version.deleted_for_users) ? version.deleted_for_users : [];
  if (deleted.map(normalizeEmail).includes(email)) return false;
  return [
    version.assigned_to_email,
    version.created_by,
    version.owner_email,
  ].map(normalizeEmail).includes(email);
}

function isDeletedForUser(project, actorEmail) {
  if (isAdminEmail(actorEmail)) return false;
  const deleted = Array.isArray(project?.deleted_for_users) ? project.deleted_for_users : [];
  return deleted.map(normalizeEmail).includes(normalizeEmail(actorEmail));
}

async function persistHtmlVersion({ projectId, versionNumber, shareSlug, storagePath, publicUrl, storagePublicUrl, html, preview, actor, draft, eventId, createdAt, existingProject = null }) {
  let client = preview.client || {};
  const actorEmail = normalizeEmail(actor?.email);
  let projectFactories = Array.isArray(client.manufacturers) && client.manufacturers.length
    ? client.manufacturers
    : (Array.isArray(draft?.fields?.factories) ? draft.fields.factories : []);
  existingProject ||= await loadProjectForWrite(projectId);
  if (existingProject?.status === 'sold') {
    throw new Error('Projeto vendido esta bloqueado para alteracoes.');
  }
  if (existingProject && !canAccessPrivateProject(existingProject, actorEmail)) {
    throw new Error('forbidden_project_access');
  }
  const protectedDocument = protectAgainstImplicitContentLoss({
    existingProject,
    action: 'generate_project_initial',
    draft,
    preview,
  });
  draft = protectedDocument.draft;
  preview = protectedDocument.preview;
  client = preview?.client || client || {};
  projectFactories = Array.isArray(client.manufacturers) && client.manufacturers.length
    ? client.manufacturers
    : (Array.isArray(draft?.fields?.factories) ? draft.fields.factories : projectFactories);
  const createdBy = normalizeEmail(existingProject?.created_by) || actorEmail;
  const assignedToEmail = normalizeEmail(existingProject?.assigned_to_email) || actorEmail;

  const { error: projectError } = await supabaseServer
    .from('document_projects')
    .upsert({
      id: projectId,
      title: preview.projectType || 'Projeto Inicial',
      client_name: client.name || draft?.fields?.clientName || '',
      contract_number: client.contractNumber || draft?.fields?.contractNum || '',
      factory: projectFactories.join(' + '),
      address: client.address || draft?.fields?.endereco || '',
      document_type: 'projeto_inicial',
      status: existingProject?.status || 'active',
      owner_email: primaryAccountEmail,
      created_by: createdBy,
      updated_by: actorEmail,
      assigned_to_email: assignedToEmail,
      last_editor_email: actorEmail,
      last_editor_name: String(actor?.name || ''),
      is_draft: false,
      data: { draft: draft || null, preview, actor: actor || null, ownerEmail: primaryAccountEmail, createdBy, assignedToEmail, lastEditorEmail: actorEmail, lastEditorName: String(actor?.name || ''), lastEventId: eventId || null, lastEventAt: createdAt || new Date().toISOString() },
    });
  if (projectError) throw projectError;

  const htmlPayload = {
    project_id: projectId,
    version_number: versionNumber,
    title: `Projeto Inicial - ${client.name || 'Cliente'}`,
    html_content: html,
    storage_bucket: htmlBucket,
    storage_path: storagePath,
    is_current: true,
    shared_with_client: true,
    shared_at: new Date().toISOString(),
    created_by: actorEmail,
    assigned_to_email: assignedToEmail,
    owner_email: primaryAccountEmail,
    share_slug: shareSlug,
    data: {
      publicUrl,
      storagePublicUrl,
      client,
      shareSlug,
      eventId: eventId || null,
      sharedWithClient: true,
      mobileFirst: true,
      mobileLayoutVersion: clientMobileFirstVersion,
      sharedAt: new Date().toISOString(),
      createdBy: actorEmail,
      assignedToEmail,
      ownerEmail: primaryAccountEmail,
    },
  };

  const { data: insertedVersion, error: htmlError } = await supabaseServer
    .from('document_html_versions')
    .insert(htmlPayload)
    .select('id')
    .single();
  if (htmlError) throw htmlError;

  if (insertedVersion?.id) {
    const { error: supersedeError } = await supabaseServer
      .from('document_html_versions')
      .update({
        is_current: false,
        superseded_at: new Date().toISOString(),
        superseded_by_id: insertedVersion.id,
        replacement_public_url: publicUrl,
      })
      .eq('project_id', projectId)
      .neq('id', insertedVersion.id)
      .eq('shared_with_client', true)
      .eq('is_current', true);
    if (supersedeError) throw supersedeError;

    const { error: currentError } = await supabaseServer
      .from('document_projects')
      .update({ current_html_id: insertedVersion.id })
      .eq('id', projectId);
    if (currentError) throw currentError;
  }

  return { versionId: insertedVersion?.id || '' };
}

async function nextHtmlVersionNumber(projectId) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('version_number')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1);

  if (error) {
    logNormalizedServerError(normalizeExternalServiceError(error), {
      endpoint: 'document_html_versions',
      action: 'next_version_number',
      projectId,
    });
    throw error;
  }
  return (data?.[0]?.version_number ?? 0) + 1;
}

async function buildStandaloneHtml(preview) {
  const template = await readPortfolioTemplate();
  if (!template) throw new Error('Template portfolio_document.html nao encontrado para gerar o link do cliente.');
  const clientPreview = sanitizeClientPreview(preview);
  const serialized = JSON.stringify(clientPreview)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const pageConfig = JSON.stringify(standalonePageConfig(clientPreview))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const hardening = `
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="referrer" content="no-referrer">
    <meta name="dcoratto-client-layout" content="mobile-first">
    <script>
      window.DCORATTO_PAGE_CONFIG = Object.freeze(${pageConfig});
      window.__DCORATTO_CLIENT_MOBILE_FIRST__ = ${JSON.stringify(clientMobileFirstVersion)};
      window.__DCORATTO_PORTFOLIO_DOCUMENT__ = ${serialized};
      window.__DCORATTO_CLIENT_VIEW__ = true;
      document.addEventListener('contextmenu', function(event) { event.preventDefault(); });
      document.addEventListener('keydown', function(event) {
        const key = String(event.key || '').toLowerCase();
        if (event.key === 'F12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i','j','c'].includes(key)) || ((event.ctrlKey || event.metaKey) && key === 'u')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);
    </script>`;
  const html = template.replace('</head>', `${hardening}</head>`);
  return html.replace('<body>', `<body data-dcoratto-mobile-first="${clientMobileFirstVersion}">`);
}

function standalonePageConfig(preview = {}) {
  const page = preview.canonicalPage || {};
  const frame = preview.canonicalFrame || {};
  return {
    preset: page.preset || 'DCORATTO_CANONICAL_1440x1020',
    width: Number(page.width || 1440),
    height: Number(page.height || 1020),
    safeMarginX: Number(page.safeMarginX || 54),
    safeMarginTop: Number(page.safeMarginTop || 42),
    safeMarginBottom: Number(page.safeMarginBottom || 58),
    frameWidth: Number(frame.width || page.frameWidth || 1332),
    frameHeight: Number(frame.height || page.frameHeight || 720),
    coordinateSystemVersion: Number(page.coordinateSystemVersion || preview.coordinateSystemVersion || 2),
    unit: page.unit || 'px',
  };
}

function sanitizeClientPreview(preview = {}) {
  const {
    manufacturer,
    manufacturers,
    factory,
    factories,
    ...client
  } = preview.client || {};
  return {
    ...preview,
    client: {
      ...client,
      manufacturers: [],
    },
    environments: (Array.isArray(preview.environments) ? preview.environments : []).map((environment) => ({
      ...environment,
      colors: (Array.isArray(environment.colors) ? environment.colors : []).map(clientVisibleColorPayload),
    })),
  };
}

function clientVisibleColorPayload(color = {}) {
  return {
    name: color.displayName || color.name || '',
    hex: color.hex || '',
    textureUrl: color.textureUrl || color.imageUrl || '',
    quality: color.quality || '',
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function sendErrorJson(response, error, context = {}) {
  const normalized = normalizeExternalServiceError(error);
  const status = context.status || (normalized.retryable ? 503 : 500);
  logNormalizedServerError(normalized, context);
  sendJson(response, status, {
    ok: false,
    error: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
  });
}

function sendSupabaseUnavailable(response, message, retryable = true) {
  sendJson(response, 503, {
    ok: false,
    error: retryable ? 'supabase_unavailable' : 'supabase_not_configured',
    message,
    retryable,
  });
}

async function safeSupabaseDiagnostics() {
  const hostname = safeSupabaseHostname();
  const projectRef = hostname && hostname.endsWith('.supabase.co')
    ? hostname.split('.')[0]
    : '';
  const circuitRemainingMs = Math.max(0, supabaseUnavailableUntil - Date.now());
  return {
    configured: Boolean(supabaseUrl && supabaseServiceKey),
    host: hostname,
    projectRef,
    serviceRoleConfigured: Boolean(supabaseServiceKey),
    circuitOpen: circuitRemainingMs > 0,
    circuitRemainingMs,
    timeoutMs: supabaseRequestTimeoutMs,
    cooldownMs: supabaseCircuitCooldownMs,
    restProbe: await probeSupabaseRest(hostname),
  };
}

function safeSupabaseHostname() {
  try {
    return supabaseUrl ? new URL(supabaseUrl).hostname : '';
  } catch {
    return '';
  }
}

async function probeSupabaseRest(hostname) {
  if (!hostname) return { ok: false, status: 0, error: 'missing_host' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('diagnostic_timeout')), 1800);
  try {
    const response = await fetch(`https://${hostname}/rest/v1/`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    return {
      ok: response.status === 401 || response.ok,
      status: response.status,
      reachable: response.status > 0 && response.status < 500,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reachable: false,
      error: normalizeExternalServiceError(error).code,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeExternalServiceError(error) {
  const rawMessage = String(
    error?.message
    || error?.error_description
    || error?.error
    || error
    || ''
  );
  const rawCode = String(error?.code || error?.status || error?.name || '').trim();
  const haystack = `${rawCode} ${rawMessage}`.toLowerCase();
  const looksLikeMissingSupabaseSchema = /pgrst20[25]|schema cache|could not find the table|could not find the function|relation .* does not exist|function .* does not exist/i
    .test(haystack);
  if (looksLikeMissingSupabaseSchema) {
    return {
      code: 'supabase_schema_unavailable',
      message: 'Banco DCoratto indisponivel ou configurado sem as tabelas esperadas. Seus dados locais foram preservados.',
      retryable: true,
    };
  }

  const looksLikeHtml = /<!doctype html|<html[\s>]|<\/html>|cloudflare|supabase\.co|connection timed out|error code 522|522:|524:|gateway timeout|bad gateway|service unavailable|supabase_request_timeout|supabase_circuit_open|supabase_unavailable|aborterror|networkerror|fetch failed|econnreset|etimedout|enotfound|socket hang up/i
    .test(haystack);

  if (looksLikeHtml) {
    return {
      code: 'supabase_unavailable',
      message: 'Supabase temporariamente indisponivel. Seus dados locais foram preservados e a sincronizacao sera tentada novamente.',
      retryable: true,
    };
  }

  const message = publicErrorMessage(rawMessage);
  return {
    code: rawCode && !rawCode.includes('<') ? rawCode : 'server_error',
    message: message || 'Erro interno ao processar a solicitacao.',
    retryable: false,
  };
}

function publicErrorMessage(message = '') {
  const raw = String(message || '').trim();
  if (!raw) return '';
  if (/<!doctype html|<html[\s>]|<\/html>/i.test(raw)) return 'Erro interno ao processar a solicitacao.';
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .replace(/(service[_-]?role|apikey|authorization|bearer)\s*[:=]\s*[^\s"'<>]+/ig, '$1=[redacted]')
    .slice(0, 360);
}

function approximateJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
  } catch {
    return 0;
  }
}

function logNormalizedServerError(normalized, context = {}) {
  const entry = {
    endpoint: context.endpoint || '',
    action: context.action || '',
    projectId: context.projectId || '',
    actorEmail: normalizeEmail(context.actorEmail || ''),
    errorCode: normalized.code,
    retryable: normalized.retryable,
    durationMs: Number(context.durationMs || 0),
    payloadBytes: Number(context.payloadBytes || 0),
  };
  if (normalized.retryable) console.warn('supabase_operation_failed', entry);
  else console.error('server_operation_failed', entry);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAppUser(user = {}) {
  const email = normalizeEmail(user.email);
  return {
    email,
    name: user.name || user.display_name || email,
    role: user.role || (email === primaryAccountEmail ? 'owner' : 'team'),
    primaryAccountEmail,
    isPrimary: email === primaryAccountEmail,
  };
}

function publicAppUser(user = {}) {
  const normalized = normalizeAppUser(user);
  return {
    email: normalized.email,
    name: normalized.name,
    role: normalized.role,
    active: user.active !== false,
    isPrimary: normalized.email === primaryAccountEmail,
    updatedAt: user.updated_at || user.updatedAt || null,
    createdAt: user.created_at || user.createdAt || null,
  };
}

function findRuntimeUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  return runtimeLoginUsers.find(user => normalizeEmail(user.email) === normalizedEmail) || null;
}

function cacheRuntimeUserMetadata(users = []) {
  (Array.isArray(users) ? users : []).forEach((user) => {
    const normalized = normalizeAppUser(user);
    if (!normalized.email) return;
    const existing = findRuntimeUserByEmail(normalized.email);
    if (existing) {
      existing.name = normalized.name;
      existing.role = normalized.role;
      existing.active = user.active !== false;
      existing.updatedAt = user.updated_at || user.updatedAt || existing.updatedAt || null;
      return;
    }
    runtimeLoginUsers.push({
      email: normalized.email,
      name: normalized.name,
      role: normalized.role,
      password: '',
      active: user.active !== false,
      createdAt: user.created_at || user.createdAt || null,
      updatedAt: user.updated_at || user.updatedAt || null,
    });
  });
}

function mergePublicAppUsers(...groups) {
  const usersByEmail = new Map();
  groups.flat().forEach((user) => {
    const publicUser = publicAppUser(user);
    if (!publicUser.email || publicUser.active === false || usersByEmail.has(publicUser.email)) return;
    usersByEmail.set(publicUser.email, publicUser);
  });
  return [...usersByEmail.values()].sort(sortAppUsers);
}

function localPublicAppUsers() {
  return mergePublicAppUsers(runtimeLoginUsers);
}

function sortAppUsers(a, b) {
  if (a.email === primaryAccountEmail) return -1;
  if (b.email === primaryAccountEmail) return 1;
  return String(a.name || a.email).localeCompare(String(b.name || b.email), 'pt-BR');
}

function canManageAppUsers(actorEmail) {
  return isAdminEmail(actorEmail);
}

async function canRestoreProjects(actorEmail) {
  const email = normalizeEmail(actorEmail);
  if (isAdminEmail(email)) return true;
  if (!email || !supabaseServer) return false;
  const { data, error } = await supabaseServer
    .from('app_users')
    .select('role, active')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data?.active !== false && ['owner', 'admin'].includes(String(data?.role || '').toLowerCase());
}

function normalizeAppUserRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return ['owner', 'admin', 'team'].includes(normalizedRole) ? normalizedRole : 'team';
}

function validateAppUserInput({ email, name, password, isNew }) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Informe um login de email valido.';
  if (!name) return 'Informe o nome do funcionario.';
  if (isNew && !password) return 'Informe uma senha para o novo funcionario.';
  if (password && password.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  return '';
}

function upsertRuntimeLoginUser({ originalEmail, email, name, role, password }) {
  const existingIndex = runtimeLoginUsers.findIndex(user => user.email === (originalEmail || email));
  const existingUser = existingIndex >= 0 ? runtimeLoginUsers[existingIndex] : null;
  const nextUser = {
    ...(existingUser || {}),
    email,
    name,
    role: email === primaryAccountEmail ? 'owner' : role,
    password: password || existingUser?.password || '',
    active: true,
  };
  if (existingIndex >= 0) runtimeLoginUsers.splice(existingIndex, 1, nextUser);
  else runtimeLoginUsers.push(nextUser);
  return nextUser;
}

function normalizeAppUserError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('password_required')) return 'Informe uma senha para o novo funcionario.';
  if (message.includes('primary_user_locked')) return 'A conta principal nao pode ter o login alterado.';
  if (message.includes('duplicate key')) return 'Ja existe um funcionario com este login.';
  if (message.includes('invalid_app_user')) return 'Revise nome, login e senha do funcionario.';
  if (message.includes('forbidden')) return 'Apenas a conta principal pode gerenciar funcionarios.';
  return message || 'Nao foi possivel salvar o funcionario.';
}

function designerNameFromEmail(email = '') {
  const normalizedEmail = normalizeEmail(email);
  const knownUser = runtimeLoginUsers.find(user => user.email === normalizedEmail);
  return knownUser?.name || normalizedEmail || 'Não informado';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function requestOrigin(request) {
  const host = request.headers['x-forwarded-host'] || request.headers.host || `localhost:${port}`;
  const proto = request.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function slugify(value) {
  return String(value || 'cliente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'cliente';
}

function safeId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
    ? String(value)
    : '';
}
