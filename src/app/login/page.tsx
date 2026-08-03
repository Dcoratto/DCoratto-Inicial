import Image from "next/image";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-decorato-line bg-white/92 p-6 shadow-soft">
        <div className="mb-8 text-center">
          <div className="mx-auto grid h-24 w-full max-w-xs place-items-center rounded-lg bg-decorato-ink px-6 shadow-sm">
            <Image
              src="/logo-dcoratto.png"
              alt="D'Coratto"
              width={260}
              height={96}
              className="h-16 w-auto"
              priority
            />
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-decorato-ink">Central D&apos;Coratto</h1>
          <p className="mt-2 text-sm leading-6 text-decorato-muted">
            Acesse procedimentos, documentos, comunicados e onboarding em um unico lugar.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
