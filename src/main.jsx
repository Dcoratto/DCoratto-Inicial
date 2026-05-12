import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Login } from './Login'
import './styles.css'

function App() {
  const [isLogged, setIsLogged] = useState(false);
  
  // Versão do sistema (mude aqui para forçar atualização em todos os usuários)
  const SYSTEM_VERSION = "2026-05-12-v4";

  // URL do seu editor
  const editorUrl = `./editor_projeto_inicial.html?v=${SYSTEM_VERSION}`;

  if (!isLogged) {
    return <Login onLoginSuccess={() => setIsLogged(true)} />;
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <iframe 
        src={editorUrl}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="DCoratto Sistema"
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)