import { getCurrentProfile } from "@/modules/identity";
import { getActiveSubjects } from "@/modules/curriculum";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();
  const subjectsRes = await getActiveSubjects();

  const initialProfile = {
    fullName: profile?.full_name || null,
    medicalSchool: profile?.medical_school || null,
    yearOfStudy: profile?.year_of_study || null,
  };

  const initialSubjects = subjectsRes.data || [];

  return (
    <div className="py-8">
      <div className="mb-6 text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Bienvenido a MedStudy Atlas
        </h1>
        <p className="text-xs text-muted-foreground">
          Configuración rápida de tu espacio de estudio médico
        </p>
      </div>

      <OnboardingWizard
        initialProfile={initialProfile}
        initialSubjects={initialSubjects}
      />
    </div>
  );
}
