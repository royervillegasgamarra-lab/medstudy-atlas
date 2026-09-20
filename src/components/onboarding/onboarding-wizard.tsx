"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  saveAcademicBasicsAction,
  completeOnboardingAction,
} from "@/modules/identity/actions";
import {
  createSubjectAction,
  createExamTargetAction,
} from "@/modules/curriculum/actions";
import type { Subject } from "@/modules/curriculum/types";
import { getCalendarDateInLima } from "@/lib/date-utils";

interface OnboardingWizardProps {
  initialProfile: {
    fullName: string | null;
    medicalSchool: string | null;
    yearOfStudy: number | null;
  };
  initialSubjects: Subject[];
}

export function OnboardingWizard({
  initialProfile,
  initialSubjects,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Resume state based on DB state
  const determineInitialStep = () => {
    if (initialSubjects.length > 0) return 3;
    if (initialProfile.medicalSchool || initialProfile.yearOfStudy) return 2;
    return 1;
  };

  const [step, setStep] = useState<number>(determineInitialStep());
  const [subjects, setSubjects] = useState<Subject[]>(initialSubjects);

  // Form states
  const [medicalSchool, setMedicalSchool] = useState(
    initialProfile.medicalSchool || ""
  );
  const [yearOfStudy, setYearOfStudy] = useState(
    initialProfile.yearOfStudy ? String(initialProfile.yearOfStudy) : ""
  );
  const [subjectName, setSubjectName] = useState("");
  const [examTitle, setExamTitle] = useState("");
  const [examDate, setExamDate] = useState("");
  const [examSubjectId, setExamSubjectId] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Step 1: Save academic basics
  const handleStep1Submit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const formData = new FormData();
      if (medicalSchool.trim())
        formData.set("medicalSchool", medicalSchool.trim());
      if (yearOfStudy) formData.set("yearOfStudy", yearOfStudy);

      const res = await saveAcademicBasicsAction(formData);
      if (!res.success) {
        setErrorMsg(res.error || "Error al guardar información académica.");
        return;
      }
      setStep(2);
    });
  };

  // Step 2: Add subject
  const handleAddSubject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectName.trim()) {
      setErrorMsg("Ingrese el nombre de la asignatura.");
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", subjectName.trim());

      const res = await createSubjectAction(formData);
      if (!res.success) {
        setErrorMsg(res.error || "No se pudo registrar la asignatura.");
        return;
      }

      if (res.data) {
        setSubjects((prev) => [...prev, res.data as Subject]);
        setSubjectName("");
        setSuccessMsg("¡Asignatura agregada!");
      }
    });
  };

  // Step 3: Add exam target and finish
  const handleAddExamAndFinish = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const hasTitle = Boolean(examTitle.trim());
    const hasDate = Boolean(examDate);

    // Defense in depth: explicitly reject partial exam input
    if (hasTitle && !hasDate) {
      setErrorMsg(
        "Debe ingresar la fecha del examen para guardarlo, o usar 'Omitir y Finalizar'."
      );
      return;
    }
    if (!hasTitle && hasDate) {
      setErrorMsg(
        "Debe ingresar el título del examen para guardarlo, o usar 'Omitir y Finalizar'."
      );
      return;
    }
    if (!hasTitle && !hasDate) {
      setErrorMsg(
        "Debe completar el título y la fecha del examen para guardarlo, o usar 'Omitir y Finalizar'."
      );
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("title", examTitle.trim());
      formData.set("exam_date", examDate);
      if (examSubjectId) formData.set("subject_id", examSubjectId);

      const examRes = await createExamTargetAction(formData);
      if (!examRes.success) {
        setErrorMsg(examRes.error || "Error al guardar el examen.");
        return;
      }

      // Complete onboarding
      const completeRes = await completeOnboardingAction();
      if (!completeRes.success) {
        setErrorMsg(completeRes.error || "Error al completar el onboarding.");
        return;
      }

      router.push("/app");
      router.refresh();
    });
  };

  const handleSkipExamAndFinish = () => {
    setErrorMsg(null);
    startTransition(async () => {
      const completeRes = await completeOnboardingAction();
      if (!completeRes.success) {
        setErrorMsg(completeRes.error || "Error al completar el onboarding.");
        return;
      }

      router.push("/app");
      router.refresh();
    });
  };

  const todayStr = getCalendarDateInLima();

  return (
    <div className="space-y-6">
      {/* Step Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <span className={step >= 1 ? "text-primary font-bold" : ""}>
            1. Contexto Académico
          </span>
          <span className={step >= 2 ? "text-primary font-bold" : ""}>
            2. Asignaturas
          </span>
          <span className={step >= 3 ? "text-primary font-bold" : ""}>
            3. Próximo Examen
          </span>
        </div>
        <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-primary h-1.5 transition-all duration-300 rounded-full"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg"
        >
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="p-3 text-xs bg-primary/10 border border-primary/20 text-primary rounded-lg"
        >
          {successMsg}
        </div>
      )}

      {/* STEP 1: ACADEMIC CONTEXT */}
      {step === 1 && (
        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-bold">
              Sobre tus estudios de medicina
            </CardTitle>
            <CardDescription>
              Personaliza tu entorno de estudio. Estos datos son opcionales y
              puedes modificarlos en cualquier momento.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleStep1Submit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="medicalSchool">
                  Facultad o Universidad (Opcional)
                </Label>
                <Input
                  id="medicalSchool"
                  placeholder="Ej. Universidad Nacional Mayor de San Marcos"
                  value={medicalSchool}
                  onChange={(e) => setMedicalSchool(e.target.value)}
                  maxLength={150}
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="yearOfStudy">Año de Carrera (Opcional)</Label>
                <select
                  id="yearOfStudy"
                  aria-label="Año de Carrera (Opcional)"
                  value={yearOfStudy}
                  onChange={(e) => setYearOfStudy(e.target.value)}
                  disabled={isPending}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Prefiero no especificar / Otro</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((y) => (
                    <option key={y} value={y}>
                      {y}° Año
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between border-t border-border/40 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setErrorMsg(null);
                  setSuccessMsg(null);
                  setStep(2);
                }}
                disabled={isPending}
              >
                Omitir
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Guardando..." : "Continuar"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* STEP 2: WHAT ARE YOU STUDYING (SUBJECTS) */}
      {step === 2 && (
        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-bold">
              ¿Qué estás estudiando actualmente?
            </CardTitle>
            <CardDescription>
              Agrega al menos una asignatura o módulo para organizar tus
              materiales de estudio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddSubject} className="space-y-3">
              <Label htmlFor="subjectName">Nombre de la asignatura</Label>
              <div className="flex gap-2">
                <Input
                  id="subjectName"
                  placeholder="Ej. Anatomía, Cardiología, Farmacología"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  maxLength={120}
                  disabled={isPending}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={isPending || !subjectName.trim()}
                >
                  Agregar
                </Button>
              </div>
            </form>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tus asignaturas ({subjects.length})
              </Label>
              {subjects.length === 0 ? (
                <div className="p-4 border border-dashed border-border rounded-lg text-center text-xs text-muted-foreground">
                  Aún no has agregado ninguna asignatura. Agrega al menos una
                  para continuar.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-1">
                  {subjects.map((sub) => (
                    <Badge
                      key={sub.id}
                      variant="outline"
                      className="px-3 py-1 text-sm bg-card border-primary/30 text-foreground"
                    >
                      {sub.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t border-border/40 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(1)}
              disabled={isPending}
            >
              Atrás
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setStep(3)}
              disabled={isPending || subjects.length === 0}
            >
              Continuar al Paso 3 ({subjects.length}{" "}
              {subjects.length === 1 ? "asignatura" : "asignaturas"})
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP 3: UPCOMING EXAM TARGET (OPTIONAL) */}
      {step === 3 && (
        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-bold">
              ¿Tienes un examen próximo? (Opcional)
            </CardTitle>
            <CardDescription>
              Establecer una fecha de examen te permite visualizar los días
              restantes. Si no tienes un examen programado, puedes omitir este
              paso.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleAddExamAndFinish}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="examTitle">Nombre o meta del examen</Label>
                <Input
                  id="examTitle"
                  placeholder="Ej. Examen Parcial, Final, ENAM 2027"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  maxLength={160}
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="examDate">Fecha del examen</Label>
                <Input
                  id="examDate"
                  type="date"
                  min={todayStr}
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="examSubject">
                  Asignatura vinculada (Opcional)
                </Label>
                <select
                  id="examSubject"
                  aria-label="Asignatura vinculada (Opcional)"
                  value={examSubjectId}
                  onChange={(e) => setExamSubjectId(e.target.value)}
                  disabled={isPending}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Ninguna / Examen general</option>
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between border-t border-border/40 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSkipExamAndFinish}
                disabled={isPending}
              >
                Omitir y Finalizar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !examTitle.trim() || !examDate}
              >
                {isPending ? "Finalizando..." : "Guardar examen y finalizar"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}
