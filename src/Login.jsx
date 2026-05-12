import { useState } from 'react';
import { supabase } from './supabaseClient';

export function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    // Validação das credenciais específicas que você solicitou
    if (email === 'dcorattoinovacao@gmail.com' && password === 'sob_medida') {
      onLoginSuccess();
    } else {
      alert('Credenciais incorretas.');
    }
  };

  return (
    <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
      <h2>Acesso ao Sistema DCoratto</h2>
      <form onSubmit={handleLogin}>
        <input 
          type="email" 
          placeholder="Email" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)} 
          style={{ display: 'block', margin: '10px auto', padding: '8px' }}
        />
        <input 
          type="password" 
          placeholder="Senha" 
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
          style={{ display: 'block', margin: '10px auto', padding: '8px' }}
        />
        <button type="submit" style={{ padding: '10px 20px', cursor: 'pointer' }}>Entrar</button>
      </form>
    </div>
  );
}