import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, getCurrentProfile } from "@/modules/identity";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login");
  }

  const profile = await getCurrentProfile();

  // If already completed onboarding, redirect to dashboard
  if (profile?.onboarding_completed_at) {
    redirect("/app");
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/50 backdrop-blur sticky top-0 z-40 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/onboarding" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
              M
            </div>
            <span className="font-semibold text-lg tracking-tight">
              MedStudy Atlas
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground hidden sm:inline-block">
              {profile?.full_name || user.email}
            </span>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto p-6 flex flex-col justify-center">
        {children}
      </main>

      <footer className="py-4 text-center text-xs text-muted-foreground border-t border-border/40">
        © {new Date().getFullYear()} MedStudy Atlas. Configuración inicial del
        estudiante.
      </footer>
    </div>
  );
}
