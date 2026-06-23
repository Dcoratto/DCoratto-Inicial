import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Login, PRIMARY_ACCOUNT_EMAIL } from './Login'
import {
  createNewActiveProjectId,
  getActiveProjectId,
  persistEditorEvent,
  flushOfflineQueue,
  loadLatestEditorState,
  saveRemoteEditorSettings,
} from './auditPersistence'
import {
  loadLocalDraftSnapshot,
  loadLocalProjectSnapshot,
  saveLocalMutation,
  saveLocalProjectSnapshot,
  savePendingAsset,
} from './offlinePersistence'
import { optimizeImageToWebp } from './imageOptimizer'
import './styles.css'

function App() {
  const [isLogged, setIsLogged] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [remoteSettings, setRemoteSettings] = useState(null);
  const [remoteDocument, setRemoteDocument] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const iframeRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const pendingAutosaveRef = useRef(null);
  const actor = useMemo(() => ({
    email: currentUser?.email || '',
    name: currentUser?.name || '',
    role: currentUser?.role || 'team',
    primaryAccountEmail: PRIMARY_ACCOUNT_EMAIL,
    isPrimary: currentUser?.email === PRIMARY_ACCOUNT_EMAIL,
  }), [currentUser]);

  // Versao do sistema: altere para forcar atualizacao do iframe em producao.
  const SYSTEM_VERSION = "2026-06-23-egress-guard-v1";
  const editorUrl = `./editor_projeto_inicial.html?v=${SYSTEM_VERSION}`;

  useEffect(() => {
    if (!isLogged || !actor.email) return undefined;
    let cancelled = false;
    setIsBootstrapping(true);
    const activeProjectId = getActiveProjectId(actor);
    const cachedSettings = readLocalEditorSettings();
    const browserFallback = readBrowserDocumentCache(activeProjectId, actor);
    const immediateDocument = hydrateBrowserStorage(chooseBestDocumentState({
      candidates: [browserFallback],
      fallbackProjectId: activeProjectId,
      fallbackSettings: cachedSettings,
    }));
    immediateDocument.projectId = immediateDocument.projectId || activeProjectId;
    immediateDocument.status = immediateDocument.status || 'draft';
    setRemoteDocument(immediateDocument);
    if (immediateDocument.settings) setRemoteSettings(immediateDocument.settings);
    setIsBootstrapping(false);

    async function hydratePersistentState() {
      const localFallback = await loadLocalDraftSnapshot(activeProjectId, actor.email)
        .catch(() => loadLocalProjectSnapshot(activeProjectId).catch(() => null));
      if (!cancelled && localFallback) {
        const localDocument = hydrateBrowserStorage(chooseBestDocumentState({
          candidates: [localFallback, browserFallback],
          fallbackProjectId: activeProjectId,
          fallbackSettings: cachedSettings,
        }));
        setRemoteDocument(localDocument);
        if (localDocument.settings) setRemoteSettings(localDocument.settings);
      }

      try {
        const remote = await loadLatestEditorState(actor);
        if (cancelled) return;
        let remoteLocalFallback = localFallback;
        if (remote?.projectId && remote.projectId !== activeProjectId) {
          remoteLocalFallback = await loadLocalDraftSnapshot(remote.projectId, actor.email)
            .catch(() => loadLocalProjectSnapshot(remote.projectId).catch(() => localFallback));
        }
        const documentState = chooseBestDocumentState({
          remote,
          candidates: [remoteLocalFallback, browserFallback],
          fallbackProjectId: activeProjectId,
          fallbackSettings: cachedSettings,
        });
        if (remote?.settings && shouldSyncLocalSettings(cachedSettings, remote.settings)) {
          const syncedSettings = await saveRemoteEditorSettings(
            mergeSettingsForSharedSync(cachedSettings, remote.settings),
            actor,
            { type: 'settings-sync', createdAt: new Date().toISOString() },
          ).catch(() => null);
          if (syncedSettings) documentState.settings = syncedSettings;
        }
        if (cancelled) return;
        const hydrated = hydrateBrowserStorage(documentState);
        hydrated.projectId = hydrated.projectId || activeProjectId;
        hydrated.status = hydrated.status || 'draft';
        setRemoteDocument(hydrated);
        if (hydrated.settings) setRemoteSettings(hydrated.settings);
      } catch (error) {
        console.warn('Rascunho remoto indisponivel; editor mantido no estado local.', error);
      }
    }

    hydratePersistentState();
    const queueTimer = window.setTimeout(() => {
      flushOfflineQueue().catch((error) => console.warn('Falha ao limpar fila offline:', error));
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(queueTimer);
    };
  }, [isLogged, actor.email]);

  useEffect(() => {
    if (!isLogged || !actor.email) return undefined;

    async function handleMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'dcoratto:pending-asset') {
        const optimized = await optimizeImageToWebp(event.data.file).catch(() => null);
        const thumbnail = await optimizeImageToWebp(event.data.file, { maxSize: 480, quality: 0.72 }).catch(() => null);
        savePendingAsset({
          id: event.data.assetId,
          projectId: getActiveProjectId(actor),
          file: optimized?.blob || event.data.file,
          thumbnailBlob: thumbnail?.blob || null,
          metadata: {
            ...(event.data.metadata || {}),
            fileName: optimized?.fileName || event.data.file?.name || '',
            mimeType: optimized?.mimeType || event.data.file?.type || '',
            width: optimized?.width || 0,
            height: optimized?.height || 0,
            originalSize: optimized?.originalSize || event.data.file?.size || 0,
            optimizedSize: optimized?.optimizedSize || event.data.file?.size || 0,
            compressionRatio: optimized?.compressionRatio || 1,
            convertedToWebp: Boolean(optimized?.converted),
            syncStatus: 'pending',
          },
          thumbnailMetadata: thumbnail ? {
            fileName: `thumb-${thumbnail.fileName || event.data.file?.name || 'image.webp'}`,
            mimeType: thumbnail.mimeType || 'image/webp',
            width: thumbnail.width || 0,
            height: thumbnail.height || 0,
            size: thumbnail.optimizedSize || 0,
            quality: 0.72,
            syncStatus: 'pending',
          } : null,
          actor,
        }).catch((error) => console.warn('Falha ao guardar asset offline.', error));
        return;
      }
      if (event.data?.type === 'dcoratto:load-project') {
        const projectId = event.data.projectId || '';
        loadLatestEditorState(actor, projectId)
          .then(async (remote) => {
            const documentState = chooseBestDocumentState({
              remote,
              candidates: [
                await loadLocalDraftSnapshot(remote?.projectId || projectId, actor.email)
                  .catch(() => loadLocalProjectSnapshot(remote?.projectId || projectId).catch(() => null)),
                readBrowserDocumentCache(remote?.projectId || projectId, actor),
              ],
              fallbackProjectId: projectId,
              fallbackSettings: remoteSettings,
            });
            const hydrated = hydrateBrowserStorage(documentState);
            setRemoteDocument(hydrated);
            if (hydrated?.settings) setRemoteSettings(hydrated.settings);
            iframeRef.current?.contentWindow?.postMessage({
              type: 'dcoratto:hydrate-document',
              draft: documentState?.draft || null,
              preview: documentState?.preview || null,
              settings: documentState?.settings || remoteSettings,
              projectId: documentState?.projectId || projectId || null,
              status: documentState?.status || 'draft',
            }, window.location.origin);
          })
          .catch((error) => {
            iframeRef.current?.contentWindow?.postMessage({
              type: 'dcoratto:load-project-result',
              ok: false,
              error: String(error?.message || error),
            }, window.location.origin);
          });
        return;
      }
      if (event.data?.type === 'dcoratto:new-project') {
        window.clearTimeout(autosaveTimerRef.current);
        pendingAutosaveRef.current = null;
        const projectId = createNewActiveProjectId(actor);
        const freshDocument = {
          source: 'client-new-project',
          projectId,
          status: 'draft',
          draft: null,
          preview: null,
          settings: remoteSettings,
        };
        hydrateBrowserStorage(freshDocument);
        setRemoteDocument(freshDocument);
        iframeRef.current?.contentWindow?.postMessage({
          type: 'dcoratto:hydrate-document',
          draft: null,
          preview: null,
          settings: remoteSettings,
          projectId,
          status: 'draft',
          reset: true,
        }, window.location.origin);
        return;
      }
      if (event.data?.type === 'dcoratto:generate-pdf') {
        const source = event.source;
        try {
          const result = await generatePortfolioPdf({
            preview: event.data.preview || remoteDocument?.preview,
            fileName: event.data.fileName,
          });
          source?.postMessage({
            type: 'dcoratto:pdf-result',
            ok: true,
            fileName: result.fileName,
            pageCount: result.pageCount,
          }, window.location.origin);
        } catch (error) {
          source?.postMessage({
            type: 'dcoratto:pdf-result',
            ok: false,
            error: String(error?.message || error),
          }, window.location.origin);
        }
        return;
      }
      if (event.data?.type !== 'dcoratto:editor-state') return;

      const { action, draft, preview, settings, settingsMutation } = event.data;
      if (settings) setRemoteSettings(settings);
      if (draft || preview) {
        setRemoteDocument((previous) => ({
          ...(previous || {}),
          projectId: previous?.projectId || getActiveProjectId(actor),
          status: action === 'save_as_draft' ? 'draft' : previous?.status || 'draft',
          draft: draft || previous?.draft || null,
          preview: preview || previous?.preview || null,
          settings: settings || previous?.settings || remoteSettings || null,
          updatedAt: event.data.sentAt || new Date().toISOString(),
        }));
      }

      const eventId = event.data.eventId || crypto.randomUUID();
      const payload = {
        id: eventId,
        eventId,
        action,
        actor,
        draft,
        preview,
        settings,
        settingsMutation,
        saveHtml: action === 'generate_project_initial',
      };

      const activeProjectId = getActiveProjectId(actor);
      const localSnapshot = {
        projectId: activeProjectId,
        userEmail: actor.email || '',
        draft: draft || null,
        preview: preview || null,
        settings: settings || null,
        settingsMutation: settingsMutation || null,
        action,
        status: action === 'save_as_draft' ? 'draft' : remoteDocument?.status || 'draft',
        canonicalPage: CANONICAL_PAGE,
        syncStatus: 'dirty',
        actor,
      };
      try {
        await saveLocalProjectSnapshot(activeProjectId, localSnapshot);
        await saveLocalMutation({
          ...payload,
          projectId: activeProjectId,
          userEmail: actor.email || '',
          status: 'pending',
        });
      } catch (error) {
        console.warn('Falha ao gravar write-through local imediato.', error);
      }

      if (settings || settingsMutation) {
        persistEditorEvent(payload).then((result) => {
          if (result?.projectId) {
            iframeRef.current?.contentWindow?.postMessage({
              type: 'dcoratto:project-meta',
              projectId: result.projectId,
            }, window.location.origin);
          }
        }).catch((error) => {
          console.warn('Falha ao persistir configuracoes remotas.', error);
        });
        return;
      }

      if (action === 'save_as_draft') {
        const source = event.source;
        window.clearTimeout(autosaveTimerRef.current);
        pendingAutosaveRef.current = null;
        persistEditorEvent(payload).then((result) => {
          if (result?.projectId) {
            iframeRef.current?.contentWindow?.postMessage({
              type: 'dcoratto:project-meta',
              projectId: result.projectId,
              status: 'draft',
            }, window.location.origin);
          }
          source?.postMessage({
            type: 'dcoratto:draft-result',
            ok: true,
            projectId: result?.projectId || getActiveProjectId(actor),
            source: result?.source || '',
            queued: Boolean(result?.queued),
          }, window.location.origin);
        }).catch((error) => {
          console.warn('Falha ao salvar rascunho remoto.', error);
          source?.postMessage({
            type: 'dcoratto:draft-result',
            ok: false,
            error: String(error?.message || error),
          }, window.location.origin);
        });
        return;
      }

      if (action !== 'generate_project_initial') {
        pendingAutosaveRef.current = payload;
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = window.setTimeout(() => {
          const queuedPayload = pendingAutosaveRef.current;
          pendingAutosaveRef.current = null;
          persistEditorEvent(queuedPayload).then((result) => {
            if (result?.projectId) {
              iframeRef.current?.contentWindow?.postMessage({
                type: 'dcoratto:project-meta',
                projectId: result.projectId,
              }, window.location.origin);
            }
          }).catch((error) => {
            console.warn('Falha ao persistir autosave remoto.', error);
          });
        }, 900);
        return;
      }

      persistEditorEvent(payload).then((result) => {
        if (action !== 'generate_project_initial') return;
        iframeRef.current?.contentWindow?.postMessage({
          type: 'dcoratto:client-link',
          ok: Boolean(result?.htmlVersion?.data?.publicUrl),
          projectId: result?.projectId || null,
          publicUrl: result?.htmlVersion?.data?.publicUrl || '',
          storagePath: result?.htmlVersion?.storage_path || '',
          source: result?.source || '',
          error: result?.error ? String(result.error?.message || result.error) : result?.htmlVersion?.data?.storageError || '',
        }, window.location.origin);
      }).catch((error) => {
        if (action !== 'generate_project_initial') return;
        iframeRef.current?.contentWindow?.postMessage({
          type: 'dcoratto:client-link',
          ok: false,
          publicUrl: '',
          error: String(error?.message || error),
        }, window.location.origin);
      });
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [isLogged, actor, remoteSettings]);

  function sendSessionAndSettingsToEditor() {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dcoratto:session',
      actor,
    }, window.location.origin);
    if (remoteSettings) {
      iframeRef.current?.contentWindow?.postMessage({
        type: 'dcoratto:apply-settings',
        settings: remoteSettings,
      }, window.location.origin);
    }
  }

  function sendStateToEditor() {
    sendSessionAndSettingsToEditor();
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dcoratto:hydrate-document',
      draft: remoteDocument?.draft || null,
      preview: remoteDocument?.preview || null,
      settings: remoteSettings,
      projectId: remoteDocument?.projectId || null,
      status: remoteDocument?.status || 'draft',
    }, window.location.origin);
  }

  useEffect(() => {
    if (isLogged && !isBootstrapping) sendStateToEditor();
  }, [isLogged, isBootstrapping, actor.email, remoteDocument?.projectId, remoteDocument?.status]);

  useEffect(() => {
    if (isLogged && !isBootstrapping) sendSessionAndSettingsToEditor();
  }, [isLogged, isBootstrapping, actor.email, remoteSettings]);

  useEffect(() => {
    if (!isLogged || !actor.email) return undefined;

    const requestEditorFlush = (action) => {
      iframeRef.current?.contentWindow?.postMessage({
        type: 'dcoratto:force-local-flush',
        action,
      }, window.location.origin);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') requestEditorFlush('visibility_hidden_flush');
    };
    const handlePageHide = () => requestEditorFlush('pagehide_flush');
    const handleBeforeUnload = () => requestEditorFlush('before_unload_flush');
    const handleOnline = () => {
      requestEditorFlush('online_flush');
      flushOfflineQueue().catch((error) => console.warn('Falha ao sincronizar fila ao voltar online.', error));
    };
    const handleOffline = () => requestEditorFlush('offline_flush');

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isLogged, actor.email]);

  if (!isLogged) {
    return <Login onLoginSuccess={(user) => {
      setCurrentUser(user);
      setIsLogged(true);
    }} />;
  }

  if (!currentUser || isBootstrapping) {
    return (
      <div className="app-loading">
        <div>
          <span>D'CORATTO</span>
          <strong>Carregando rascunho persistente...</strong>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        src={editorUrl}
        onLoad={sendStateToEditor}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="DCoratto Sistema"
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

const PORTFOLIO_STORAGE_KEY = 'dcoratto.portfolio.document.v1';
const BUILDER_STORAGE_KEY = 'dcoratto.builder.document.v1';
const SHARED_PAGE_CONFIG = globalThis.DCORATTO_PAGE_CONFIG || {};
const PAGE_PRESET = SHARED_PAGE_CONFIG.preset || 'DCORATTO_CANONICAL_1440x1020';
const CANONICAL_PAGE = Object.freeze({
  preset: PAGE_PRESET,
  width: Number(SHARED_PAGE_CONFIG.width || 1440),
  height: Number(SHARED_PAGE_CONFIG.height || 1020),
  safeMarginX: Number(SHARED_PAGE_CONFIG.safeMarginX || 54),
  safeMarginTop: Number(SHARED_PAGE_CONFIG.safeMarginTop || 42),
  safeMarginBottom: Number(SHARED_PAGE_CONFIG.safeMarginBottom || 58),
  frameWidth: Number(SHARED_PAGE_CONFIG.frameWidth || 1332),
  frameHeight: Number(SHARED_PAGE_CONFIG.frameHeight || 720),
  coordinateSystemVersion: Number(SHARED_PAGE_CONFIG.coordinateSystemVersion || 2),
  unit: SHARED_PAGE_CONFIG.unit || 'px',
});
const PDF_VIEWPORT = { width: CANONICAL_PAGE.width, height: CANONICAL_PAGE.height };

async function generatePortfolioPdf({ preview, fileName } = {}) {
  if (!preview || !Array.isArray(preview.environments) || !preview.environments.length) {
    throw new Error('Adicione ao menos um ambiente antes de gerar o PDF.');
  }

  const [{ default: renderCanvas }, { jsPDF: PdfDocument }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canonicalPreview = {
    ...preview,
    canonicalPage: preview.canonicalPage || CANONICAL_PAGE,
    coordinateSystemVersion: Number(preview.coordinateSystemVersion || CANONICAL_PAGE.coordinateSystemVersion),
  };

  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(canonicalPreview));

  const frame = document.createElement('iframe');
  frame.title = 'Renderizador de PDF DCoratto';
  frame.style.position = 'fixed';
  frame.style.left = '-20000px';
  frame.style.top = '0';
  frame.style.width = `${PDF_VIEWPORT.width}px`;
  frame.style.height = `${PDF_VIEWPORT.height}px`;
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  document.body.appendChild(frame);

  try {
    await loadPdfFrame(frame, `/portfolio_document.html?pdf=${Date.now()}`);
    await waitForPdfDocumentReady(frame);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    const layoutValidation = win?.__DCORATTO_VALIDATE_PDF_LAYOUT__?.({ mark: true });
    if (layoutValidation && !layoutValidation.valid) {
      const details = layoutValidation.pages
        .filter(page => page.issues?.length)
        .slice(0, 3)
        .map(page => `${page.label}: ${page.issues[0]}`)
        .join(' | ');
      throw new Error(`Existem elementos fora do limite fisico da pagina PDF. Ajuste-os no editor antes de exportar.${details ? ` ${details}` : ''}`);
    }

    const sections = Array.from(doc.querySelectorAll('#document .document-page'))
      .filter(section => section.getBoundingClientRect().width && section.getBoundingClientRect().height);
    const captureTargets = createPdfCaptureTargets(sections);

    if (!captureTargets.length) throw new Error('Nao foi possivel encontrar paginas para gerar o PDF.');

    let pdf = null;
    for (const target of captureTargets) {
      const section = target.section;
      section.scrollIntoView({ block: 'start' });
      await waitForAnimationFrame(win);

      const preparedTarget = preparePdfCaptureTarget(target);
      await waitForAnimationFrame(win);

      try {
        const captureElement = preparedTarget.element || section;
        captureElement.scrollIntoView?.({ block: 'start' });
        await waitForAnimationFrame(win);
        const pageWidth = PDF_VIEWPORT.width;
        const pageHeight = PDF_VIEWPORT.height;
        const canvas = await renderCanvas(captureElement, {
          backgroundColor: '#080807',
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
          imageTimeout: 20000,
          windowWidth: pageWidth,
          windowHeight: pageHeight,
          width: pageWidth,
          height: pageHeight,
          scrollX: 0,
          scrollY: 0,
        });

        const orientation = 'landscape';
        if (!pdf) {
          pdf = new PdfDocument({
            orientation,
            unit: 'px',
            format: [pageWidth, pageHeight],
            compress: true,
            hotfixes: ['px_scaling'],
          });
        } else {
          pdf.addPage([pageWidth, pageHeight], orientation);
        }
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, pageHeight);
      } finally {
        preparedTarget.restore();
      }
    }

    const safeFileName = normalizePdfFileName(fileName || portfolioPdfFileName(preview));
    pdf.save(safeFileName);
    return { fileName: safeFileName, pageCount: captureTargets.length };
  } finally {
    frame.remove();
  }
}

function createPdfCaptureTargets(sections) {
  return sections.map(section => ({ type: 'section', section }));
}

function preparePdfCaptureTarget(target) {
  if (target?.type === 'frame' && target.frame) return preparePdfFramePageForCapture(target);
  if (target?.type === 'photo' && target.photoCard) return preparePdfPhotoPageForCapture(target);
  return preparePdfSectionForCapture(target.section);
}

function preparePdfPhotoPageForCapture(target) {
  const hiddenElements = new Map();
  const photoCards = Array.from(target.section.querySelectorAll('.photo-mural .photo-card'));
  const restorePhotoCardStyle = rememberInlineStyles(target.photoCard, ['grid-column', 'grid-row', 'min-height', 'height']);

  photoCards.forEach((photoCard) => {
    if (photoCard !== target.photoCard) hidePdfElement(photoCard, hiddenElements);
  });

  target.photoCard.style.setProperty('grid-column', '1 / -1');
  target.photoCard.style.setProperty('grid-row', 'span 4');
  target.photoCard.style.setProperty('min-height', '604px');
  target.photoCard.style.removeProperty('height');

  const preparedSection = preparePdfSectionForCapture(target.section);
  return {
    pageWidth: preparedSection.pageWidth,
    restore() {
      preparedSection.restore();
      restoreInlineStyles(target.photoCard, restorePhotoCardStyle);
      restoreHiddenPdfElements(hiddenElements);
    },
  };
}

function preparePdfFramePageForCapture(target) {
  const section = target.section;
  const frames = section.querySelector('.page-frames');
  if (!frames) return preparePdfSectionForCapture(section);

  const hiddenElements = new Map();
  const restoreFramesStyle = rememberInlineStyles(frames, ['transform', 'transform-origin', 'margin-left', 'margin-top', 'width', 'min-height', 'height']);
  const baseFramesRect = frames.getBoundingClientRect();
  const baseFramesHeight = Math.max(frames.scrollHeight, frames.offsetHeight, baseFramesRect.height);
  const allFrames = Array.from(frames.querySelectorAll(':scope > .doc-photo-frame'));
  const includeAllAnnotations = allFrames.length <= 1;
  const relatedAnnotationIds = collectFrameRelatedAnnotationIds(frames, target.frame, includeAllAnnotations);

  frames.style.transform = 'none';
  frames.style.transformOrigin = 'top left';
  frames.style.marginLeft = '0';
  frames.style.marginTop = '0';
  frames.style.setProperty('width', `${baseFramesRect.width}px`, 'important');
  frames.style.setProperty('min-height', `${baseFramesHeight}px`, 'important');
  frames.style.setProperty('height', `${baseFramesHeight}px`, 'important');

  allFrames.forEach((frame) => {
    if (frame !== target.frame) hidePdfElement(frame, hiddenElements);
  });

  frames.querySelectorAll(PDF_PAGE_ANNOTATION_SELECTOR).forEach((element) => {
    const id = pageAnnotationElementId(element);
    if (id && !relatedAnnotationIds.has(id)) hidePdfElement(element, hiddenElements);
  });

  frames.querySelectorAll('[data-free-element]').forEach((element) => {
    if (!includeAllAnnotations && !pdfRectsIntersect(element.getBoundingClientRect(), target.frame.getBoundingClientRect(), 64)) {
      hidePdfElement(element, hiddenElements);
    }
  });

  const visualBounds = collectPdfVisualBounds(frames, { includeContainerBounds: false });
  if (!visualBounds) {
    return {
      pageWidth: PDF_VIEWPORT.width,
      element: section,
      restore() {
        restoreInlineStyles(frames, restoreFramesStyle);
        restoreHiddenPdfElements(hiddenElements);
      },
    };
  }

  const contentWidth = Math.max(1, visualBounds.right - visualBounds.left);
  const contentHeight = Math.max(1, visualBounds.bottom - visualBounds.top);
  const pageWidth = Math.ceil(Math.min(PDF_MAX_PAGE_WIDTH, contentWidth + (PDF_PAGE_MARGIN * 2)));
  const scale = Math.min(1, Math.max(1, pageWidth - (PDF_PAGE_MARGIN * 2)) / contentWidth);
  const pageHeight = Math.ceil((contentHeight * scale) + (PDF_PAGE_MARGIN * 2));
  const sheet = createPdfFrameSheet(section.ownerDocument, {
    pageWidth,
    pageHeight,
  });
  const frameClone = frames.cloneNode(true);
  frameClone.style.position = 'absolute';
  frameClone.style.left = `${PDF_PAGE_MARGIN - ((visualBounds.left - baseFramesRect.left) * scale)}px`;
  frameClone.style.top = `${PDF_PAGE_MARGIN - ((visualBounds.top - baseFramesRect.top) * scale)}px`;
  frameClone.style.width = `${baseFramesRect.width}px`;
  frameClone.style.minHeight = `${baseFramesHeight}px`;
  frameClone.style.height = `${baseFramesHeight}px`;
  frameClone.style.margin = '0';
  frameClone.style.transformOrigin = 'top left';
  frameClone.style.transform = `scale(${scale})`;
  sheet.appendChild(frameClone);
  section.ownerDocument.body.appendChild(sheet);

  restoreHiddenPdfElements(hiddenElements);
  restoreInlineStyles(frames, restoreFramesStyle);

  return {
    pageWidth,
    element: sheet,
    restore() {
      sheet.remove();
    },
  };
}

function preparePdfSectionForCapture(section, options = {}) {
  const restoreSectionStyle = rememberInlineStyles(section, ['min-height', 'height', 'overflow', 'width']);

  section.style.width = `${PDF_VIEWPORT.width}px`;
  section.style.minHeight = `${PDF_VIEWPORT.height}px`;
  section.style.height = `${PDF_VIEWPORT.height}px`;
  section.style.overflow = 'hidden';

  return {
    pageWidth: PDF_VIEWPORT.width,
    restore() {
      restoreInlineStyles(section, restoreSectionStyle);
    },
  };
}

const PDF_PAGE_ANNOTATION_SELECTOR = [
  '[data-page-annotation-line]',
  '[data-page-annotation-arrow-head]',
  '[data-page-annotation-text]',
  '[data-page-detail-frame]',
  '[data-page-annotation-toolbar]',
  '[data-page-annotation-tail]',
  '[data-page-annotation-head]',
].join(',');

function collectFrameRelatedAnnotationIds(container, frame, includeAll = false) {
  const ids = new Set();
  const frameRect = frame.getBoundingClientRect();
  container.querySelectorAll(PDF_PAGE_ANNOTATION_SELECTOR).forEach((element) => {
    const id = pageAnnotationElementId(element);
    if (!id) return;
    if (includeAll || pdfElementRelatesToRect(element, frameRect)) ids.add(id);
  });
  return ids;
}

function pageAnnotationElementId(element) {
  return element.dataset.pageAnnotationLine
    || element.dataset.pageAnnotationArrowHead
    || element.dataset.pageAnnotationText
    || element.dataset.pageDetailFrame
    || element.dataset.pageAnnotationTail
    || element.dataset.pageAnnotationHead
    || (element.dataset.environmentIndex !== undefined && element.dataset.pageIndex !== undefined && element.dataset.annotationIndex !== undefined
      ? `${element.dataset.environmentIndex}-${element.dataset.pageIndex}-${element.dataset.annotationIndex}`
      : '');
}

function pdfElementRelatesToRect(element, rect) {
  const elementRect = element.getBoundingClientRect();
  if (element.matches('[data-page-annotation-arrow-head], [data-page-annotation-head]')) {
    return pdfPointInRect({
      x: elementRect.left + (elementRect.width / 2),
      y: elementRect.top + (elementRect.height / 2),
    }, rect, 48);
  }
  return pdfRectsIntersect(elementRect, rect, 48);
}

function pdfPointInRect(point, rect, padding = 0) {
  return point.x >= rect.left - padding
    && point.x <= rect.right + padding
    && point.y >= rect.top - padding
    && point.y <= rect.bottom + padding;
}

function pdfRectsIntersect(a, b, padding = 0) {
  if (!a || !b || (!a.width && !a.height) || (!b.width && !b.height)) return false;
  return a.right >= b.left - padding
    && a.left <= b.right + padding
    && a.bottom >= b.top - padding
    && a.top <= b.bottom + padding;
}

function hidePdfElement(element, hiddenElements) {
  if (!element || hiddenElements.has(element)) return;
  hiddenElements.set(element, element.style.display);
  element.style.display = 'none';
}

function restoreHiddenPdfElements(hiddenElements) {
  hiddenElements.forEach((display, element) => {
    element.style.display = display;
  });
}

function createPdfFrameSheet(doc, { pageWidth, pageHeight }) {
  const sheet = doc.createElement('section');
  sheet.className = 'pdf-frame-sheet';
  sheet.style.position = 'relative';
  sheet.style.width = `${Math.max(1, Math.ceil(pageWidth))}px`;
  sheet.style.minHeight = `${Math.max(1, Math.ceil(pageHeight))}px`;
  sheet.style.height = `${Math.max(1, Math.ceil(pageHeight))}px`;
  sheet.style.overflow = 'hidden';
  sheet.style.background = '#080807';
  sheet.style.color = '#f7f2ea';
  sheet.style.fontFamily = 'Montserrat, Arial, sans-serif';
  return sheet;
}

function rememberInlineStyles(element, properties) {
  return properties.map(property => ({
    property,
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  }));
}

function restoreInlineStyles(element, snapshot) {
  snapshot.forEach(({ property, value, priority }) => {
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
  });
}

function collectPdfVisualBounds(container, { includeContainerBounds = true } = {}) {
  const selectors = [
    '.doc-photo-frame',
    '.page-detail-frame',
    '.page-free-element',
    '.page-annotation-text',
    '.page-annotation-line',
    '.page-annotation-arrow-head',
    '.doc-annotation-text',
    '.doc-annotation-layer',
  ];
  const elements = [
    ...(includeContainerBounds ? [container] : []),
    ...container.querySelectorAll(selectors.join(',')),
  ];
  return elements.reduce((bounds, element) => {
    const rect = element.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return bounds;
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.right) || !Number.isFinite(rect.bottom)) return bounds;
    if (!bounds) {
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }
    bounds.left = Math.min(bounds.left, rect.left);
    bounds.top = Math.min(bounds.top, rect.top);
    bounds.right = Math.max(bounds.right, rect.right);
    bounds.bottom = Math.max(bounds.bottom, rect.bottom);
    return bounds;
  }, null);
}

function loadPdfFrame(frame, src) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Tempo esgotado ao preparar o PDF.')), 30000);
    frame.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    frame.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Nao foi possivel abrir o documento para PDF.'));
    };
    frame.src = src;
  });
}

async function waitForPdfDocumentReady(frame) {
  const doc = frame.contentDocument;
  if (!doc) throw new Error('Nao foi possivel acessar o documento do PDF.');
  await waitForCondition(() => doc.body?.dataset.pdfReady === 'true' && doc.querySelector('#document .document-page'), 15000);
  await waitForPdfAssets(doc);
  frame.contentWindow?.updatePageAnnotationGeometry?.();
  await waitForAnimationFrame(frame.contentWindow);
}

function waitForCondition(predicate, timeout = 10000, interval = 80) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeout) {
        reject(new Error('Tempo esgotado ao renderizar o documento para PDF.'));
        return;
      }
      window.setTimeout(tick, interval);
    };
    tick();
  });
}

async function waitForPdfAssets(doc) {
  await (doc.fonts?.ready?.catch?.(() => null) || Promise.resolve());
  await Promise.all(Array.from(doc.images || []).map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
      window.setTimeout(done, 20000);
    });
  }));
}

function waitForAnimationFrame(win = window) {
  return new Promise(resolve => {
    const target = win || window;
    const raf = callback => (target.requestAnimationFrame || window.requestAnimationFrame).call(target, callback);
    raf(() => raf(resolve));
  });
}

function portfolioPdfFileName(preview = {}) {
  const client = pdfNamePart(preview.client?.name || 'cliente');
  const contract = pdfNamePart(preview.client?.contractNumber || '');
  return ['projeto-inicial', client, contract].filter(Boolean).join('-') + '.pdf';
}

function normalizePdfFileName(value = '') {
  const fileName = String(value || 'projeto-inicial.pdf')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120);
  return fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName || 'projeto-inicial'}.pdf`;
}

function pdfNamePart(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

function snapshotHasDocumentContent(snapshot = {}) {
  if (Array.isArray(snapshot?.preview?.environments) && snapshot.preview.environments.length) return true;
  if (Array.isArray(snapshot?.draft?.ambientes) && snapshot.draft.ambientes.length) return true;
  return Object.entries(snapshot?.draft?.fields || {}).some(([key, value]) => {
    if (key === 'factories') return false;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(String(value || '').trim());
  });
}

function chooseBestDocumentState({ remote = null, candidates = [], fallbackProjectId = '', fallbackSettings = null } = {}) {
  const snapshots = [remote, ...candidates]
    .filter(snapshotHasDocumentContent)
    .sort((a, b) => documentSnapshotTime(b) - documentSnapshotTime(a));
  const selected = snapshots[0] || remote || candidates.find(Boolean) || null;
  if (!selected) {
    return {
      projectId: fallbackProjectId || null,
      status: 'draft',
      settings: fallbackSettings || null,
    };
  }
  return {
    ...(remote || {}),
    ...(selected || {}),
    projectId: selected.projectId || remote?.projectId || fallbackProjectId || null,
    status: selected.status || remote?.status || 'draft',
    settings: remote?.settings || selected.settings || fallbackSettings || null,
  };
}

function documentSnapshotTime(snapshot = {}) {
  const timestamps = [
    snapshot.localUpdatedAt,
    snapshot.remoteUpdatedAt,
    snapshot.updatedAt,
    snapshot.updated_at,
    snapshot.snapshotUpdatedAt,
    snapshot.draft?.localUpdatedAt,
    snapshot.draft?.updatedAt,
    snapshot.preview?.localUpdatedAt,
    snapshot.preview?.updatedAt,
    snapshot.data?.lastEventAt,
  ];
  for (const value of timestamps) {
    const time = Date.parse(value || '');
    if (Number.isFinite(time)) return time;
  }
  return snapshotHasDocumentContent(snapshot) ? 1 : 0;
}

function readBrowserDocumentCache(projectId = '', actor = null) {
  const draft = parseStoredJson(localStorage.getItem(BUILDER_STORAGE_KEY));
  const preview = parseStoredJson(localStorage.getItem(PORTFOLIO_STORAGE_KEY));
  if (!snapshotHasDocumentContent({ draft, preview })) return null;
  if (!browserDraftMatchesActor(draft, actor)) return null;
  return {
    projectId: draft?.projectId || projectId || null,
    status: draft?.status || 'draft',
    draft: draft || null,
    preview: preview || null,
    actor: draft?.actor || actor || null,
    updatedAt: draft?.updatedAt || null,
  };
}

function browserDraftMatchesActor(draft, actor) {
  const draftEmail = String(draft?.actor?.email || '').trim().toLowerCase();
  const actorEmail = String(actor?.email || '').trim().toLowerCase();
  return !draftEmail || !actorEmail || draftEmail === actorEmail;
}

function hydrateBrowserStorage(remote) {
  const hydrated = { ...(remote || {}) };
  try {
    if (remote?.draft) localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify(remote.draft));
    else localStorage.removeItem(BUILDER_STORAGE_KEY);
    if (remote?.preview) localStorage.setItem('dcoratto.portfolio.document.v1', JSON.stringify(remote.preview));
    else localStorage.removeItem('dcoratto.portfolio.document.v1');
    if (remote?.settings) {
      const localSettings = parseStoredJson(localStorage.getItem('dcoratto.editor.settings.v1')) || {};
      hydrated.settings = mergeSettingsPreservingCatalogImages(localSettings, remote.settings);
      localStorage.setItem('dcoratto.editor.settings.v1', JSON.stringify(hydrated.settings));
    }
  } catch (error) {
    console.warn('Nao foi possivel preparar o cache local do editor.', error);
  }
  return hydrated;
}

function readLocalEditorSettings() {
  return parseStoredJson(localStorage.getItem('dcoratto.editor.settings.v1')) || {};
}

function parseStoredJson(value) {
  try {
    return JSON.parse(value || 'null');
  } catch {
    return null;
  }
}

function shouldSyncLocalSettings(localSettings = {}, remoteSettings = {}) {
  if (!localSettings || !Object.keys(localSettings).length) return false;
  return hasCatalogItemsMissingRemotely(localSettings, remoteSettings)
    || hasFactoriesMissingRemotely(localSettings, remoteSettings)
    || hasMaterialOptionsMissingRemotely(localSettings, remoteSettings)
    || hasObservationsMissingRemotely(localSettings, remoteSettings);
}

function hasCatalogItemsMissingRemotely(localSettings = {}, remoteSettings = {}) {
  const remoteKeys = new Set((remoteSettings.catalogItems || []).flatMap(catalogItemMatchKeys));
  return (localSettings.catalogItems || []).some(item => item?.name && !catalogItemMatchKeys(item).some(key => remoteKeys.has(key)));
}

function hasFactoriesMissingRemotely(localSettings = {}, remoteSettings = {}) {
  const remoteFactories = new Set(normalizeFactoryList(remoteSettings.factories, remoteSettings.catalogItems));
  return normalizeFactoryList(localSettings.factories, localSettings.catalogItems).some(factory => !remoteFactories.has(factory));
}

function hasMaterialOptionsMissingRemotely(localSettings = {}, remoteSettings = {}) {
  const groups = new Set([
    ...Object.keys(localSettings.materialOptions || {}),
    ...Object.keys(remoteSettings.materialOptions || {}),
  ]);
  return [...groups].some((group) => {
    const remoteValues = new Set(remoteSettings.materialOptions?.[group] || []);
    return (localSettings.materialOptions?.[group] || []).some(value => value && !remoteValues.has(value));
  });
}

function hasObservationsMissingRemotely(localSettings = {}, remoteSettings = {}) {
  const remoteValues = new Set(remoteSettings.observations || []);
  return (localSettings.observations || []).some(value => value && !remoteValues.has(value));
}

function mergeSettingsForSharedSync(localSettings = {}, remoteSettings = {}) {
  const catalogItems = mergeCatalogItemsForSync(remoteSettings.catalogItems, localSettings.catalogItems);
  return {
    ...localSettings,
    ...remoteSettings,
    logo: remoteSettings.logo || localSettings.logo || '',
    catalogItems,
    factories: normalizeFactoryList([
      ...(remoteSettings.factories || []),
      ...(localSettings.factories || []),
    ], catalogItems),
    materialOptions: mergeMaterialOptions(localSettings.materialOptions, remoteSettings.materialOptions),
    observations: [...new Set([...(remoteSettings.observations || []), ...(localSettings.observations || [])].filter(Boolean))],
  };
}

function mergeMaterialOptions(localOptions = {}, remoteOptions = {}) {
  const groups = new Set([...Object.keys(localOptions || {}), ...Object.keys(remoteOptions || {})]);
  return Object.fromEntries([...groups].map(group => [
    group,
    [...new Set([...(remoteOptions?.[group] || []), ...(localOptions?.[group] || [])].filter(Boolean))],
  ]));
}

function mergeCatalogItemsForSync(remoteItems = [], localItems = []) {
  let merged = [];
  (Array.isArray(remoteItems) ? remoteItems : []).forEach((item) => {
    if (!item?.name) return;
    merged = upsertCatalogItemPreservingImage(merged, item);
  });
  (Array.isArray(localItems) ? localItems : []).forEach((item) => {
    if (!item?.name) return;
    merged = upsertCatalogItemPreservingImage(merged, item);
  });
  return merged;
}

function normalizeFactoryList(factories = [], catalogItems = []) {
  const explicitFactories = (Array.isArray(factories) ? factories : [])
    .map(factory => String(typeof factory === 'string' ? factory : factory?.name || '').trim().replace(/\s+/g, ' ').toUpperCase())
    .filter(Boolean);
  const catalogFactories = (Array.isArray(catalogItems) ? catalogItems : [])
    .map(item => String(item?.manufacturer || item?.factory || '').trim().replace(/\s+/g, ' ').toUpperCase())
    .filter(Boolean);
  return [...new Set([...explicitFactories, ...catalogFactories])];
}

function mergeSettingsPreservingCatalogImages(localSettings = {}, remoteSettings = {}) {
  const catalogItems = mergeCatalogItemsPreservingImages(localSettings.catalogItems, remoteSettings.catalogItems);
  return {
    ...localSettings,
    ...remoteSettings,
    catalogItems,
    factories: normalizeFactoryList([
      ...(remoteSettings.factories || []),
      ...(localSettings.factories || []),
    ], catalogItems),
  };
}

function mergeCatalogItemsPreservingImages(localItems = [], remoteItems = []) {
  let merged = [];
  (Array.isArray(remoteItems) ? remoteItems : []).forEach((item) => {
    if (!item?.name) return;
    merged = upsertCatalogItemPreservingImage(merged, item);
  });
  (Array.isArray(localItems) ? localItems : []).forEach((item) => {
    if (!item?.name) return;
    const localImage = catalogItemTextureUrl(item);
    const localTime = catalogItemUpdatedTime(item);
    const shouldProtectLocal = Boolean(localImage && (localTime || isCatalogDataImage(localImage)));
    if (!shouldProtectLocal) return;
    merged = upsertCatalogItemPreservingImage(merged, item);
  });
  return merged;
}

function upsertCatalogItemPreservingImage(items = [], incomingItem = {}) {
  const matchKeys = new Set(catalogItemMatchKeys(incomingItem));
  let replaced = false;
  const next = items.map((item) => {
    if (!replaced && catalogItemMatchKeys(item).some(key => matchKeys.has(key))) {
      replaced = true;
      return mergeCatalogItemPreservingImage(item, incomingItem);
    }
    return item;
  });
  if (!replaced) next.push(incomingItem);
  return next;
}

function mergeCatalogItemPreservingImage(existingItem = {}, incomingItem = {}) {
  const image = chooseCatalogImage(existingItem, incomingItem);
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
  return merged;
}

function chooseCatalogImage(existingItem = {}, incomingItem = {}) {
  const existingImage = catalogItemTextureUrl(existingItem);
  const incomingImage = catalogItemTextureUrl(incomingItem);
  if (!existingImage) return incomingImage;
  if (!incomingImage) return existingImage;
  const existingTime = catalogItemUpdatedTime(existingItem);
  const incomingTime = catalogItemUpdatedTime(incomingItem);
  if (existingTime && incomingTime && existingTime > incomingTime) return existingImage;
  if (isCatalogDataImage(existingImage) && (!incomingTime || existingTime >= incomingTime)) return existingImage;
  return incomingImage;
}

function catalogItemTextureUrl(item = {}) {
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

function catalogItemUpdatedTime(item = {}) {
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

function isCatalogDataImage(value = '') {
  return String(value || '').startsWith('data:image/');
}

function catalogItemMatchKeys(item = {}) {
  return [
    item.id,
    item.catalogKey,
    item.catalog_key,
    stableCatalogKey({
      category: item.type || item.category,
      factory: item.manufacturer || item.factory,
      line: item.line || item.lineName || item.line_name,
      quality: item.quality || item.materialType,
      name: item.name,
    }),
  ].filter(Boolean).map(value => String(value).toLowerCase());
}

function stableCatalogKey({ category, factory, line, quality, name }) {
  return [category, factory, line, quality, name]
    .map(value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
    .filter(Boolean)
    .join('-');
}
