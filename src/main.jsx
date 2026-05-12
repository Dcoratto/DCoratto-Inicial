import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Database, FileText, Images, Lock, LogOut } from 'lucide-react';
import { flushOfflineQueue, persistEditorEvent, readOfflineQueue } from './auditPersistence';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import './styles.css';

const AUTH_EMAIL = 'dcorattoinovacao@gmail.com';
const AUTH_PASSWORD = 'sob_medida';
const AUTH_STORAGE_KEY = 'dcoratto.auth.session.v1';

const hasSupabaseEnv = Boolean(
  import.meta.env.VITE_SUPABASE_URL
  && import.meta.env.VITE_SUPABASE_ANON_KEY
  && !import.meta.env.VITE_SUPABASE_URL.includes('seu-projeto')
);

const frameVersion = '2026-05-12-editor-settings-v2';

function App() {
  const [session, setSession] = useState(() => readStoredSession());
  const [activeView, setActiveView] = useState('builder');
  const [syncState, setSyncState] = useState({ status: 'idle', queued: readOfflineQueue().length });
  const [remoteSettings, setRemoteSettings] = useState(null);
  const frameRef = React.useRef(null);
  const framePath = activeView === 'builder' ? '/editor_projeto_inicial.html' : '/portfolio_document.html';
  const frameSrc = `${framePath}?v=${frameVersion}`;

  React.useEffect(() => {
    if (!session) return undefined;

    let timer = null;
    let lastMessage = null;

    const persist = async (message) => {
      setSyncState((state) => ({ ...state, status: 'saving' }));
      const result = await persistEditorEvent({
        action: message.action || 'editor_sync',
        actor: session,
        draft: message.draft,
        preview: message.preview,
        settings: message.settings,
        saveHtml: message.action === 'generate_project_initial',
      });
      setSyncState({
        status: result.source === 'supabase' ? 'saved' : 'queued',
        queued: readOfflineQueue().length,
      });
    };

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'dcoratto:editor-state') return;
      lastMessage = event.data;

      if (event.data.action === 'generate_project_initial') {
        clearTimeout(timer);
        persist(event.data);
        return;
      }

      clearTimeout(timer);
      timer = setTimeout(() => persist(lastMessage), 1400);
    };

    window.addEventListener('message', handleMessage);
    flushOfflineQueue().finally(() => setSyncState((state) => ({ ...state, queued: readOfflineQueue().length })));

    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', handleMessage);
    };
  }, [session]);

  React.useEffect(() => {
    if (!session || !isSupabaseConfigured || !supabase) return;
    supabase
      .from('editor_settings')
      .select('payload')
      .eq('settings_key', 'default')
      .maybeSingle()
      .then(({ data }) => setRemoteSettings(data?.payload || null));
  }, [session]);

  function sendSettingsToFrame() {
    if (activeView !== 'builder' || !remoteSettings) return;
    frameRef.current?.contentWindow?.postMessage({
      type: 'dcoratto:apply-settings',
      settings: remoteSettings,
    }, window.location.origin);
  }

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <main className="legacy-shell">
      <header className="legacy-toolbar">
        <div className="toolbar-brand">
          <FileText size={18} />
          <div>
            <span>D'coratto</span>
            <strong>Editor Projeto Inicial</strong>
          </div>
        </div>

        <div className="toolbar-actions">
          <div className="view-switcher" aria-label="Alternar visualizacao">
            <button className={activeView === 'builder' ? 'active' : ''} type="button" onClick={() => setActiveView('builder')}>
              <FileText size={14} />
              Construtor
            </button>
            <button className={activeView === 'preview' ? 'active' : ''} type="button" onClick={() => setActiveView('preview')}>
              <Images size={14} />
              Preview HTML
            </button>
          </div>

          <div className={`persistence-pill ${hasSupabaseEnv ? 'online' : 'offline'}`}>
            <Database size={15} />
            <span>{persistenceLabel(syncState)}</span>
          </div>

          <div className="user-pill">
            <span>{session.email}</span>
            <button type="button" aria-label="Sair" onClick={() => logout(setSession)}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      <iframe
        ref={frameRef}
        className="legacy-frame"
        title={activeView === 'builder' ? "Editor Projeto Inicial D'coratto" : "Preview HTML D'coratto"}
        src={frameSrc}
        onLoad={sendSettingsToFrame}
      />
    </main>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState(AUTH_EMAIL);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (email.trim().toLowerCase() !== AUTH_EMAIL || password !== AUTH_PASSWORD) {
      setError('Usuario ou senha invalidos.');
      return;
    }

    setLoading(true);
    try {
      let provider = 'local';
      if (isSupabaseConfigured && supabase) {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: AUTH_EMAIL,
          password: AUTH_PASSWORD,
        });
        if (authError) {
          throw new Error('Crie este usuario no Supabase Auth ou confira a senha configurada.');
        }
        provider = 'supabase';
      }

      const session = {
        email: AUTH_EMAIL,
        provider,
        loggedAt: new Date().toISOString(),
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      onLogin(session);
      await persistEditorEvent({ action: 'login', actor: session });
    } catch (loginError) {
      setError(loginError.message || 'Nao foi possivel entrar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-mark">
          <Lock size={18} />
        </div>
        <span>D'coratto</span>
        <h1>Editor Projeto Inicial</h1>
        <label>
          E-mail
          <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Senha
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <button type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

async function logout(setSession) {
  if (supabase) await supabase.auth.signOut();
  localStorage.removeItem(AUTH_STORAGE_KEY);
  setSession(null);
}

function persistenceLabel(syncState) {
  if (!hasSupabaseEnv) return `Fila local: ${syncState.queued}`;
  if (syncState.status === 'saving') return 'Salvando...';
  if (syncState.status === 'queued') return `Fila local: ${syncState.queued}`;
  if (syncState.status === 'saved') return 'Supabase salvo';
  return 'Supabase configurado';
}

createRoot(document.getElementById('root')).render(<App />);
