"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  formatExamDate,
  getRemainingDays,
  getCalendarDateInLima,
} from "@/lib/date-utils";
import {
  createExamTargetAction,
  updateExamTargetAction,
  archiveExamTargetAction,
} from "@/modules/curriculum/actions";
import type {
  ExamTargetWithSubject,
  Subject,
} from "@/modules/curriculum/types";

interface ExamManagerProps {
  initialExams: ExamTargetWithSubject[];
  subjects: Subject[];
}

export function ExamManager({ initialExams, subjects }: ExamManagerProps) {
  const [exams, setExams] = useState<ExamTargetWithSubject[]>(initialExams);
  const [isPending, startTransition] = useTransition();

  // Create state
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newSubjectId, setNewSubjectId] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editSubjectId, setEditSubjectId] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const todayStr = getCalendarDateInLima();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDate) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("title", newTitle.trim());
      formData.set("exam_date", newDate);
      if (newSubjectId) formData.set("subject_id", newSubjectId);

      const res = await createExamTargetAction(formData);

      if (!res.success) {
        setErrorMsg(res.error || "Error al registrar el examen objetivo.");
        return;
      }

      if (res.data) {
        const created = res.data as ExamTargetWithSubject;
        setExams((prev) =>
          [...prev, created].sort((a, b) =>
            a.exam_date.localeCompare(b.exam_date)
          )
        );
        setNewTitle("");
        setNewDate("");
        setNewSubjectId("");
        setIsCreating(false);
        setSuccessMsg("Examen objetivo programado con éxito.");
      }
    });
  };

  const handleEdit = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim() || !editDate) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("title", editTitle.trim());
      formData.set("exam_date", editDate);
      formData.set("subject_id", editSubjectId);

      const res = await updateExamTargetAction(id, formData);

      if (!res.success) {
        setErrorMsg(res.error || "Error al actualizar el examen.");
        return;
      }

      if (res.data) {
        const updated = res.data as ExamTargetWithSubject;
        setExams((prev) =>
          prev
            .map((item) => (item.id === id ? updated : item))
            .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
        );
        setEditingId(null);
        setSuccessMsg("Examen actualizado.");
      }
    });
  };

  const handleArchive = (id: string, title: string) => {
    if (
      !confirm(`¿Estás seguro de que deseas archivar el examen "${title}"?`)
    ) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const res = await archiveExamTargetAction(id);
      if (!res.success) {
        setErrorMsg(res.error || "Error al archivar el examen.");
        return;
      }

      setExams((prev) => prev.filter((item) => item.id !== id));
      setSuccessMsg(`"${title}" ha sido archivado.`);
    });
  };

  return (
    <Card className="border-border bg-card/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <span>Exámenes y Metas de Evaluación</span>
            <Badge variant="secondary" className="text-xs">
              {exams.length}
            </Badge>
          </CardTitle>
          <CardDescription className="mt-1">
            Próximas evaluaciones académicas con cuenta regresiva.
          </CardDescription>
        </div>

        <Button
          size="sm"
          variant={isCreating ? "ghost" : "outline"}
          onClick={() => {
            setIsCreating(!isCreating);
            setErrorMsg(null);
          }}
          disabled={isPending}
        >
          {isCreating ? "Cancelar" : "+ Nuevo Examen"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
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

        {/* Create form */}
        {isCreating && (
          <form
            onSubmit={handleCreate}
            className="p-4 border border-primary/30 bg-card rounded-lg space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label
                  htmlFor="examTitleInput"
                  className="text-xs font-semibold"
                >
                  Título del examen
                </Label>
                <Input
                  id="examTitleInput"
                  placeholder="Ej. Examen Parcial de Farmacología"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={160}
                  disabled={isPending}
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor="examDateInput"
                  className="text-xs font-semibold"
                >
                  Fecha del examen
                </Label>
                <Input
                  id="examDateInput"
                  type="date"
                  min={todayStr}
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="examSubjectSelect"
                className="text-xs font-semibold"
              >
                Asignatura vinculada (Opcional)
              </Label>
              <select
                id="examSubjectSelect"
                aria-label="Asignatura vinculada (Opcional)"
                value={newSubjectId}
                onChange={(e) => setNewSubjectId(e.target.value)}
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

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !newTitle.trim() || !newDate}
              >
                {isPending ? "Guardando..." : "Guardar Examen"}
              </Button>
            </div>
          </form>
        )}

        {/* Exams list */}
        {exams.length === 0 ? (
          <div className="p-8 border border-dashed border-border rounded-lg text-center space-y-2">
            <p className="text-sm font-medium text-foreground">
              No tienes exámenes programados
            </p>
            <p className="text-xs text-muted-foreground">
              Registra tus fechas de parciales, finales o simulacros para seguir
              tu cuenta regresiva.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {exams.map((exam) => {
              const remaining = getRemainingDays(exam.exam_date);
              const formattedDate = formatExamDate(exam.exam_date);

              return (
                <div
                  key={exam.id}
                  className="p-4 rounded-lg border border-border bg-background/80 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                >
                  {editingId === exam.id ? (
                    <form
                      onSubmit={(e) => handleEdit(exam.id, e)}
                      className="w-full space-y-3"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          maxLength={160}
                          disabled={isPending}
                        />
                        <Input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          disabled={isPending}
                        />
                      </div>
                      <select
                        aria-label="Asignatura vinculada"
                        value={editSubjectId}
                        onChange={(e) => setEditSubjectId(e.target.value)}
                        disabled={isPending}
                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
                      >
                        <option value="">Ninguna / Examen general</option>
                        {subjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          disabled={isPending}
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isPending || !editTitle.trim() || !editDate}
                        >
                          Guardar
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-base text-foreground">
                            {exam.title}
                          </span>
                          {remaining && (
                            <Badge
                              variant={
                                remaining.isPast ? "secondary" : "outline"
                              }
                              className={
                                remaining.isPast
                                  ? "text-xs text-muted-foreground"
                                  : "text-xs border-primary/40 text-primary"
                              }
                            >
                              {remaining.label}
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>📅 {formattedDate}</span>
                          {exam.subject && (
                            <span className="flex items-center gap-1">
                              • <span>{exam.subject.name}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 self-end md:self-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditingId(exam.id);
                            setEditTitle(exam.title);
                            setEditDate(exam.exam_date);
                            setEditSubjectId(exam.subject_id || "");
                            setErrorMsg(null);
                          }}
                          disabled={isPending}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2.5 text-xs text-destructive/70 hover:text-destructive"
                          onClick={() => handleArchive(exam.id, exam.title)}
                          disabled={isPending}
                        >
                          Archivar
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
