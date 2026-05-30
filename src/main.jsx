import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Login, PRIMARY_ACCOUNT_EMAIL } from './Login'
import { getActiveProjectId, persistEditorEvent, flushOfflineQueue, loadLatestEditorState } from './auditPersistence'
import { loadLocalProjectSnapshot, saveLocalProjectSnapshot, savePendingAsset } from './offlinePersistence'
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
    email: currentUser?.email || PRIMARY_ACCOUNT_EMAIL,
    name: currentUser?.name || "D'Coratto Inovacao",
    role: currentUser?.role || 'owner',
    primaryAccountEmail: PRIMARY_ACCOUNT_EMAIL,
    isPrimary: (currentUser?.email || PRIMARY_ACCOUNT_EMAIL) === PRIMARY_ACCOUNT_EMAIL,
  }), [currentUser]);

  // Versao do sistema: altere para forcar atualizacao do iframe em producao.
  const SYSTEM_VERSION = "2026-05-22-remote-persistence-v2";
  const editorUrl = `./editor_projeto_inicial.html?v=${SYSTEM_VERSION}`;

  useEffect(() => {
    if (!isLogged) return undefined;
    let cancelled = false;
    setIsBootstrapping(true);

    flushOfflineQueue().catch((error) => console.warn('Falha ao limpar fila offline:', error));

    async function bootstrapRemoteState() {
      try {
        const remote = await loadLatestEditorState(actor);
        if (cancelled) return;
        hydrateBrowserStorage(remote);
        setRemoteDocument(remote);
        if (remote?.settings) setRemoteSettings(remote.settings);
      } catch (error) {
        console.warn('Nao foi possivel carregar o rascunho remoto pelo servidor.', error);
        const local = await loadLocalProjectSnapshot(getActiveProjectId(actor)).catch(() => null);
        if (!cancelled && local) {
          hydrateBrowserStorage(local);
          setRemoteDocument(local);
          if (local?.settings) setRemoteSettings(local.settings);
        }
      }
    }

    bootstrapRemoteState()
      .finally(() => {
        if (!cancelled) setIsBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLogged, actor.email]);

  useEffect(() => {
    if (!isLogged) return undefined;

    async function handleMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'dcoratto:pending-asset') {
        const optimized = await optimizeImageToWebp(event.data.file).catch(() => null);
        savePendingAsset({
          id: event.data.assetId,
          projectId: getActiveProjectId(actor),
          file: optimized?.blob || event.data.file,
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
          },
          actor,
        }).catch((error) => console.warn('Falha ao guardar asset offline.', error));
        return;
      }
      if (event.data?.type === 'dcoratto:load-project') {
        const projectId = event.data.projectId || '';
        loadLatestEditorState(actor, projectId)
          .then((remote) => {
            hydrateBrowserStorage(remote);
            setRemoteDocument(remote);
            if (remote?.settings) setRemoteSettings(remote.settings);
            iframeRef.current?.contentWindow?.postMessage({
              type: 'dcoratto:hydrate-document',
              draft: remote?.draft || null,
              preview: remote?.preview || null,
              settings: remote?.settings || remoteSettings,
              projectId: remote?.projectId || projectId || null,
              status: remote?.status || 'draft',
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
      if (event.data?.type !== 'dcoratto:editor-state') return;

      const { action, draft, preview, settings } = event.data;
      if (settings) setRemoteSettings(settings);

      const payload = {
        action,
        actor,
        draft,
        preview,
        settings,
        saveHtml: action === 'generate_project_initial',
      };

      saveLocalProjectSnapshot(getActiveProjectId(actor), {
        draft: draft || null,
        preview: preview || null,
        settings: settings || null,
        action,
        actor,
      }).catch((error) => console.warn('Falha ao salvar snapshot local imediato.', error));

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

  function sendStateToEditor() {
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
  }, [isLogged, isBootstrapping, remoteSettings, remoteDocument]);

  if (!isLogged) {
    return <Login onLoginSuccess={(user) => {
      setCurrentUser(user);
      setIsLogged(true);
    }} />;
  }

  if (isBootstrapping) {
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

function hydrateBrowserStorage(remote) {
  try {
    if (remote?.draft) localStorage.setItem('dcoratto.builder.document.v1', JSON.stringify(remote.draft));
    else localStorage.removeItem('dcoratto.builder.document.v1');
    if (remote?.preview) localStorage.setItem('dcoratto.portfolio.document.v1', JSON.stringify(remote.preview));
    else localStorage.removeItem('dcoratto.portfolio.document.v1');
    if (remote?.settings) localStorage.setItem('dcoratto.editor.settings.v1', JSON.stringify(remote.settings));
  } catch (error) {
    console.warn('Nao foi possivel preparar o cache local do editor.', error);
  }
}
