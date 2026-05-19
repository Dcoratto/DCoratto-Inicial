import React, { useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleLogin(event) {
    event.preventDefault();
    if (email.trim() === 'dcorattoinovacao@gmail.com' && password === 'sob_medida') {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          console.warn('Login local liberado, mas o Supabase Auth recusou a sessão.', error);
        }
      }
      onLoginSuccess();
      return;
    }
    alert('Credenciais incorretas.');
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#070605',
      color: '#f7f2e8',
    }}>
      <div style={{
        padding: '40px',
        textAlign: 'center',
        backgroundColor: '#151310',
        border: '1px solid rgba(184,151,106,0.28)',
        borderRadius: '8px',
        boxShadow: '0 22px 80px rgba(0,0,0,0.45)',
        width: '100%',
        maxWidth: '410px',
      }}>
        <h2 style={{ color: '#d4b896', marginBottom: '22px', fontWeight: 400 }}>Sistema D'Coratto</h2>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            placeholder="Seu email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ display: 'block', width: '100%', margin: '10px 0', padding: '12px', borderRadius: '4px', border: '1px solid rgba(184,151,106,0.28)', background: '#1f1c18', color: '#fff8eb', boxSizing: 'border-box' }}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Sua senha"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ display: 'block', width: '100%', margin: '10px 0', padding: '12px', borderRadius: '4px', border: '1px solid rgba(184,151,106,0.28)', background: '#1f1c18', color: '#fff8eb', boxSizing: 'border-box' }}
          />
          <button type="submit" style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#b8976a',
            color: '#070605',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: 700,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            marginTop: '10px',
          }}>Entrar no Sistema</button>
        </form>
      </div>
    </div>
  );
}
