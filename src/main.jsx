import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Database, FileText, Images } from 'lucide-react';
import './styles.css';

const hasSupabaseEnv = Boolean(
  import.meta.env.VITE_SUPABASE_URL
  && import.meta.env.VITE_SUPABASE_ANON_KEY
  && !import.meta.env.VITE_SUPABASE_URL.includes('seu-projeto')
);

function App() {
  const [activeView, setActiveView] = useState('builder');
  const frameSrc = activeView === 'builder' ? '/editor_projeto_inicial.html' : '/portfolio_document.html';

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
            <span>{hasSupabaseEnv ? 'Supabase configurado' : 'Supabase pendente'}</span>
          </div>
        </div>
      </header>

      <iframe
        className="legacy-frame"
        title={activeView === 'builder' ? "Editor Projeto Inicial D'coratto" : "Preview HTML D'coratto"}
        src={frameSrc}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
