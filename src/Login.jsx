import React, { useState } from 'react'; // ESSA LINHA É A CHAVE PARA NÃO QUEBRAR
import { supabase } from './supabaseClient'; // MANTÉM A CONEXÃO COM SEU BANCO

export function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    // Sua regra de acesso
    if (email === 'dcorattoinovacao@gmail.com' && password === 'sob_medida') {
      onLoginSuccess();
    } else {
      alert('Credenciais incorretas.');
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh', 
      backgroundColor: '#f0f2f5' 
    }}>
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        backgroundColor: '#ffffff', 
        borderRadius: '15px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
        width: '100%',
        maxWidth: '400px'
      }}>
        <h2 style={{ color: '#1a73e8', marginBottom: '20px' }}>Sistema DCoratto</h2>
        <form onSubmit={handleLogin}>
          <input 
            type="email" 
            placeholder="Seu email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            style={{ display: 'block', width: '100%', margin: '10px 0', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', boxSizing: 'border-box' }}
          />
          <input 
            type="password" 
            placeholder="Sua senha" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            style={{ display: 'block', width: '100%', margin: '10px 0', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', boxSizing: 'border-box' }}
          />
          <button type="submit" style={{ 
            width: '100%', 
            padding: '12px', 
            backgroundColor: '#1a73e8', 
            color: 'white', 
            border: 'none', 
            borderRadius: '8px', 
            cursor: 'pointer',
            fontWeight: 'bold',
            marginTop: '10px'
          }}>Entrar no Sistema</button>
        </form>
      </div>
    </div>
  );
}