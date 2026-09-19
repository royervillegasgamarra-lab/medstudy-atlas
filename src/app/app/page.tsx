import Link from "next/link";
import { getCurrentUser, getCurrentProfile } from "@/modules/identity";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatExamDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Sin fecha definida";
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("es-PE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function AppDashboardPage() {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();

  const studentName = profile?.full_name || "Colega Médico";
  const studentEmail = profile?.email || user?.email || "";
  const studentSchool = profile?.medical_school || "No especificada";
  const studentYear = profile?.year_of_study
    ? `${profile.year_of_study}° Año`
    : "No registrado";
  const examDate = formatExamDate(profile?.target_exam_date);

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Bienvenido, {studentName}
            </h1>
            <Badge variant="outline" className="border-primary/40 text-primary">
              Sesión Segura
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Entorno de Estudio Médico y Preparación Académica Personalizada
          </p>
        </div>

        <Link href="/app/profile">
          <Button variant="outline" size="sm">
            Editar Perfil
          </Button>
        </Link>
      </div>

      {/* Student Profile Overview Card */}
      <Card className="border-border bg-card/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center justify-between">
            <span>Ficha del Estudiante</span>
            <Badge variant="secondary" className="text-xs">
              RLS Aislado
            </Badge>
          </CardTitle>
          <CardDescription>
            Tus datos están protegidos por Row Level Security exclusivo para tu
            cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Correo Electrónico
              </p>
              <p className="font-medium text-foreground mt-1">{studentEmail}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Facultad de Medicina
              </p>
              <p className="font-medium text-foreground mt-1">
                {studentSchool}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Nivel Académico
              </p>
              <p className="font-medium text-foreground mt-1">{studentYear}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Examen Objetivo
              </p>
              <p className="font-medium text-foreground mt-1">{examDate}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modules Roadmap Grid */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground mb-4">
          Módulos de Preparación
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-border/60 bg-card/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Plan de Estudio & Currículo
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-xs text-muted-foreground"
                >
                  Fase 1B
                </Badge>
              </div>
              <CardDescription>
                Onboarding académico, asignaturas y blueprints de examen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Configuración curricular y metas de estudio según tu año y
                facultad de medicina.
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-xs"
                disabled
              >
                Próximamente
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-border/60 bg-card/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Biblioteca & Documentos
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-xs text-muted-foreground"
                >
                  Fase 1C
                </Badge>
              </div>
              <CardDescription>
                Ingesta de guías clínicas y PDFs con OCR selectivo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Sube tus materiales de clase para extraer conceptos y generar
                packs de estudio.
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-xs"
                disabled
              >
                Próximamente
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-border/60 bg-card/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Repetición Espaciada (FSRS)
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-xs text-muted-foreground"
                >
                  Fase 1H
                </Badge>
              </div>
              <CardDescription>
                Algoritmo FSRS de retención cognitiva a largo plazo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Tarjetas de memoria generadas a partir de tus lecturas con
                cálculo de estabilidad y olvido.
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-xs"
                disabled
              >
                Próximamente
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-border/60 bg-card/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Simulador & Error Notebook
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-xs text-muted-foreground"
                >
                  Fase 1F
                </Badge>
              </div>
              <CardDescription>
                Preguntas de opción múltiple tipo ENAM y cuaderno de errores.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Entrena con casos clínicos educativos y retroalimentación
                justificada.
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-xs"
                disabled
              >
                Próximamente
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
