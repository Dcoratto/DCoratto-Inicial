import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Login } from './Login'
import { persistEditorEvent, flushOfflineQueue } from './auditPersistence'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import './styles.css'

function App() {
  const [isLogged, setIsLogged] = useState(false);
  const [remoteSettings, setRemoteSettings] = useState(null);
  const iframeRef = useRef(null);
  const actor = { email: 'dcorattoinovacao@gmail.com' };

  // Versao do sistema: altere para forcar atualizacao do iframe em producao.
  const SYSTEM_VERSION = "2026-05-19-crud-config-v1";
  const editorUrl = `./editor_projeto_inicial.html?v=${SYSTEM_VERSION}`;

  useEffect(() => {
    if (!isLogged) return undefined;

    flushOfflineQueue().catch((error) => console.warn('Falha ao limpar fila offline:', error));

    async function loadRemoteSettings() {
      if (!isSupabaseConfigured || !supabase) return;
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) return;
      const { data, error } = await supabase
        .from('editor_settings')
        .select('payload')
        .eq('settings_key', 'default')
        .maybeSingle();

      if (!error && data?.payload) {
        setRemoteSettings(data.payload);
      }
    }

    loadRemoteSettings();
  }, [isLogged]);

  useEffect(() => {
    if (!isLogged) return undefined;

    function handleMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'dcoratto:editor-state') return;

      const { action, draft, preview, settings } = event.data;
      if (settings) setRemoteSettings(settings);

      persistEditorEvent({
        action,
        actor,
        draft,
        preview,
        settings,
        saveHtml: action === 'generate_project_initial',
      }).then((result) => {
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
    return () => window.removeEventListener('message', handleMessage);
  }, [isLogged]);

  function sendSettingsToEditor() {
    if (!remoteSettings) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dcoratto:apply-settings',
      settings: remoteSettings,
    }, window.location.origin);
  }

  useEffect(() => {
    if (isLogged) sendSettingsToEditor();
  }, [isLogged, remoteSettings]);

  if (!isLogged) {
    return <Login onLoginSuccess={() => setIsLogged(true)} />;
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        src={editorUrl}
        onLoad={sendSettingsToEditor}
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
