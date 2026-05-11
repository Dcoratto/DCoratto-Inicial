import React from 'react';
import { createRoot } from 'react-dom/client';
import { Database, FileText } from 'lucide-react';
import './styles.css';

const hasSupabaseEnv = Boolean(
  import.meta.env.VITE_SUPABASE_URL
  && import.meta.env.VITE_SUPABASE_ANON_KEY
  && !import.meta.env.VITE_SUPABASE_URL.includes('seu-projeto')
);

function App() {
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

        <div className={`persistence-pill ${hasSupabaseEnv ? 'online' : 'offline'}`}>
          <Database size={15} />
          <span>{hasSupabaseEnv ? 'Supabase configurado' : 'Supabase pendente'}</span>
        </div>
      </header>

      <iframe
        className="legacy-frame"
        title="Editor Projeto Inicial D'coratto"
        src="/editor_projeto_inicial.html"
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
