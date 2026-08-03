import { KeyRound } from "lucide-react";
import { updateOwnPassword } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth";

export default async function ChangePasswordPage() {
  await requireAuth();

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-decorato-line bg-white p-6">
      <KeyRound aria-hidden="true" className="mb-4 text-decorato-teal" size={28} />
      <h1 className="text-2xl font-semibold text-decorato-ink">Trocar senha</h1>
      <p className="mt-2 text-sm leading-6 text-decorato-muted">
        Use uma senha entre 8 e 72 caracteres. A senha nunca e exibida ou registrada em logs.
      </p>
      <form action={updateOwnPassword} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm text-decorato-ink">Nova senha</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            className="mt-2 h-11 w-full rounded-lg border border-decorato-line px-3 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
          />
        </label>
        <Button type="submit">Salvar senha</Button>
      </form>
    </div>
  );
}
