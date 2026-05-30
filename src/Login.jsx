import React, { useState } from 'react';

export const PRIMARY_ACCOUNT_EMAIL = 'dcorattoinovacao@gmail.com';

const LOCAL_USERS = [
  { email: PRIMARY_ACCOUNT_EMAIL, password: 'sob_medida', name: "D'Coratto Inovacao", role: 'owner' },
  { email: 'rafael@dcoratto.com.br', password: 'Dcoratto@Rafael26', name: 'Rafael', role: 'team' },
  { email: 'isabela@dcoratto.com.br', password: 'Dcoratto@Isabela26', name: 'Isabela', role: 'team' },
  { email: 'vinicius@dcoratto.com.br', password: 'Dcoratto@Vinicius26', name: 'Vinicius', role: 'team' },
];

function localLogin(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = LOCAL_USERS.find((item) => item.email === normalizedEmail && item.password === password);
  if (!user) return null;
  return {
    email: user.email,
    name: user.name,
    role: user.role,
    primaryAccountEmail: PRIMARY_ACCOUNT_EMAIL,
    isPrimary: user.email === PRIMARY_ACCOUNT_EMAIL,
  };
}

export function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result?.user?.email) {
        onLoginSuccess(result.user);
        return;
      }
      if (!response.ok || result?.error) {
        setIsSubmitting(false);
        alert(result?.error || 'Credenciais incorretas.');
        return;
      }
    } catch (error) {
      console.warn('Login remoto indisponivel, usando validacao local.', error);
    }

    const localUser = localLogin(email, password);
    if (localUser) {
      onLoginSuccess(localUser);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
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
          <button type="submit" disabled={isSubmitting} style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#b8976a',
            color: '#070605',
            border: 'none',
            borderRadius: '3px',
            cursor: isSubmitting ? 'wait' : 'pointer',
            fontWeight: 700,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            marginTop: '10px',
            opacity: isSubmitting ? .72 : 1,
          }}>{isSubmitting ? 'Entrando...' : 'Entrar no Sistema'}</button>
        </form>
      </div>
    </div>
  );
}
