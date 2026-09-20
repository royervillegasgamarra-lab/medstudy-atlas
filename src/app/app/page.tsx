import Link from "next/link";
import { getCurrentProfile } from "@/modules/identity";
import {
  getActiveSubjects,
  getUpcomingExamTargets,
} from "@/modules/curriculum";
import { getUserDocuments } from "@/modules/documents";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatExamDate, getRemainingDays } from "@/lib/date-utils";
import { SubjectManager } from "@/components/curriculum/subject-manager";
import { ExamManager } from "@/components/curriculum/exam-manager";
import { Files, ArrowRight } from "lucide-react";

export default async function AppDashboardPage() {
  const profile = await getCurrentProfile();
  const subjectsRes = await getActiveSubjects();
  const examsRes = await getUpcomingExamTargets();
  const docsRes = await getUserDocuments();

  const subjects = subjectsRes.data || [];
  const exams = examsRes.data || [];
  const documents = docsRes.data || [];

  const studentName = profile?.full_name || "Colega Médico";
  const studentSchool = profile?.medical_school || "Facultad no especificada";
  const studentYear = profile?.year_of_study
    ? `${profile.year_of_study}° Año de Medicina`
    : "Año no especificado";

  // Earliest upcoming exam
  const nextExam = exams.length > 0 ? exams[0] : null;
  const nextExamRemaining = nextExam
    ? getRemainingDays(nextExam.exam_date)
    : null;

  return (
    <div className="space-y-8">
      {/* Student Greeting & Academic Context */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Bienvenido, {studentName}
            </h1>
            <Badge variant="outline" className="border-primary/40 text-primary">
              Sesión Segura
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {studentSchool} • {studentYear}
          </p>
        </div>

        <Link href="/app/profile">
          <Button variant="outline" size="sm">
            Editar Perfil
          </Button>
        </Link>
      </div>

      {/* Next Upcoming Exam Banner / Empty State */}
      {nextExam ? (
        <Card className="border-primary/30 bg-primary/5 shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase font-bold text-primary tracking-wider">
                    Próximo Examen
                  </span>
                  {nextExamRemaining && (
                    <Badge
                      variant={
                        nextExamRemaining.isPast ? "secondary" : "default"
                      }
                      className="text-xs"
                    >
                      {nextExamRemaining.label}
                    </Badge>
                  )}
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  {nextExam.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  📅 {formatExamDate(nextExam.exam_date)}
                  {nextExam.subject && (
                    <span> • Asignatura: {nextExam.subject.name}</span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border bg-card/40 shadow-xs">
          <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">
                Sin exámenes próximos programados
              </h2>
              <p className="text-xs text-muted-foreground">
                Puedes registrar tus fechas de evaluación abajo para activar la
                cuenta regresiva.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document Library Quick Banner */}
      <Card className="border-border bg-card shadow-xs">
        <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Files className="w-5 h-5" />
            </div>
            <div className="space-y-0.5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                Biblioteca de Documentos
                <Badge variant="outline" className="text-xs">
                  {documents.length}{" "}
                  {documents.length === 1 ? "archivo" : "archivos"}
                </Badge>
              </h2>
              <p className="text-xs text-muted-foreground">
                Syllabus y diapositivas en PDF con almacenamiento seguro y
                privado.
              </p>
            </div>
          </div>

          <Link href="/app/documents">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 w-full sm:w-auto"
            >
              Ir a Documentos
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Subjects Section */}
      <SubjectManager initialSubjects={subjects} />

      {/* Exam Targets Section */}
      <ExamManager initialExams={exams} subjects={subjects} />
    </div>
  );
}
