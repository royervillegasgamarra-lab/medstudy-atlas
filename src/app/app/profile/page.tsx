import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProfile } from "@/modules/identity";
import { ProfileForm } from "@/components/auth/profile-form";
import { Button } from "@/components/ui/button";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login");
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between border-b border-border/60 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Configuración del Perfil
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestiona tus datos académicos y preferencias de examen objetivo
          </p>
        </div>
        <Link href="/app">
          <Button variant="ghost" size="sm">
            ← Volver al Panel
          </Button>
        </Link>
      </div>

      <div className="flex justify-center">
        <ProfileForm profile={profile} />
      </div>
    </div>
  );
}
