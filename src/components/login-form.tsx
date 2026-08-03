"use client";

import { useActionState } from "react";
import { LockKeyhole, LogIn, User } from "lucide-react";
import { loginAction, type LoginState } from "@/actions/auth";
import { Button } from "@/components/ui/button";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="login" className="text-sm text-decorato-ink">
          Login
        </label>
        <div className="mt-2 flex h-11 items-center gap-2 rounded-lg border border-decorato-line bg-white px-3">
          <User aria-hidden="true" size={18} className="text-decorato-muted" />
          <input
            id="login"
            name="login"
            required
            minLength={3}
            maxLength={120}
            autoComplete="username"
            className="w-full bg-transparent text-sm outline-none"
            placeholder="usuario ou e-mail"
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="text-sm text-decorato-ink">
          Senha
        </label>
        <div className="mt-2 flex h-11 items-center gap-2 rounded-lg border border-decorato-line bg-white px-3">
          <LockKeyhole aria-hidden="true" size={18} className="text-decorato-muted" />
          <input
            id="password"
            name="password"
            required
            minLength={8}
            maxLength={72}
            type="password"
            autoComplete="current-password"
            className="w-full bg-transparent text-sm outline-none"
            placeholder="senha"
          />
        </div>
      </div>

      {state.error ? (
        <p className="rounded-md border border-decorato-coral/30 bg-decorato-coral/10 px-3 py-2 text-sm text-decorato-coral">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        <LogIn aria-hidden="true" size={18} />
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
