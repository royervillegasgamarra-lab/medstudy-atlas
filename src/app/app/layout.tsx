import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, getCurrentProfile } from "@/modules/identity";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login");
  }

  const profile = await getCurrentProfile();

  if (!profile?.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/50 backdrop-blur sticky top-0 z-40 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/app" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
                M
              </div>
              <span className="font-semibold text-lg tracking-tight hidden sm:inline-block">
                MedStudy Atlas
              </span>
            </Link>

            <nav className="flex items-center gap-4 text-sm font-medium">
              <Link
                href="/app"
                className="text-foreground hover:text-primary transition-colors"
              >
                Panel de Estudio
              </Link>
              <Link
                href="/app/profile"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Mi Perfil
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <p className="text-xs font-medium text-foreground">
                {profile?.full_name || user.email}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {profile?.medical_school || "Estudiante de Medicina"}
              </p>
            </div>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6">{children}</main>

      <footer className="py-4 text-center text-xs text-muted-foreground border-t border-border/40">
        © {new Date().getFullYear()} MedStudy Atlas. Entorno Seguro —
        Aislamiento Estricto por Estudiante.
      </footer>
    </div>
  );
}
