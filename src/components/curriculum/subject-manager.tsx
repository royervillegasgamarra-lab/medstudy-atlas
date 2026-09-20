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
  createSubjectAction,
  renameSubjectAction,
  archiveSubjectAction,
} from "@/modules/curriculum/actions";
import type { Subject } from "@/modules/curriculum/types";

interface SubjectManagerProps {
  initialSubjects: Subject[];
}

export function SubjectManager({ initialSubjects }: SubjectManagerProps) {
  const [subjects, setSubjects] = useState<Subject[]>(initialSubjects);
  const [isPending, startTransition] = useTransition();

  // Create state
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", newName.trim());
      const res = await createSubjectAction(formData);

      if (!res.success) {
        setErrorMsg(res.error || "Error al crear la asignatura.");
        return;
      }

      if (res.data) {
        setSubjects((prev) => [...prev, res.data as Subject]);
        setNewName("");
        setIsCreating(false);
        setSuccessMsg("Asignatura creada con éxito.");
      }
    });
  };

  const handleRename = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", editName.trim());
      const res = await renameSubjectAction(id, formData);

      if (!res.success) {
        setErrorMsg(res.error || "Error al renombrar la asignatura.");
        return;
      }

      if (res.data) {
        setSubjects((prev) =>
          prev.map((s) => (s.id === id ? (res.data as Subject) : s))
        );
        setEditingId(null);
        setEditName("");
        setSuccessMsg("Asignatura actualizada.");
      }
    });
  };

  const handleArchive = (id: string, name: string) => {
    if (
      !confirm(`¿Estás seguro de que deseas archivar la asignatura "${name}"?`)
    ) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const res = await archiveSubjectAction(id);
      if (!res.success) {
        setErrorMsg(res.error || "Error al archivar la asignatura.");
        return;
      }

      setSubjects((prev) => prev.filter((s) => s.id !== id));
      setSuccessMsg(`"${name}" ha sido archivada.`);
    });
  };

  return (
    <Card className="border-border bg-card/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <span>Asignaturas de Estudio</span>
            <Badge variant="secondary" className="text-xs">
              {subjects.length}
            </Badge>
          </CardTitle>
          <CardDescription className="mt-1">
            Módulos y cursos académicos que estás cursando.
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
          {isCreating ? "Cancelar" : "+ Nueva Asignatura"}
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
            <Label
              htmlFor="createSubjectInput"
              className="text-xs font-semibold"
            >
              Nombre de la nueva asignatura
            </Label>
            <div className="flex gap-2">
              <Input
                id="createSubjectInput"
                placeholder="Ej. Farmacología Médica"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={120}
                disabled={isPending}
                autoFocus
              />
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !newName.trim()}
              >
                {isPending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </form>
        )}

        {/* Subjects list */}
        {subjects.length === 0 ? (
          <div className="p-8 border border-dashed border-border rounded-lg text-center space-y-2">
            <p className="text-sm font-medium text-foreground">
              No tienes asignaturas activas
            </p>
            <p className="text-xs text-muted-foreground">
              Agrega tus cursos actuales para organizar tus apuntes y exámenes.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subjects.map((sub) => (
              <div
                key={sub.id}
                className="p-3.5 rounded-lg border border-border bg-background/80 flex flex-col justify-between gap-3 hover:border-border/80 transition-colors"
              >
                {editingId === sub.id ? (
                  <form
                    onSubmit={(e) => handleRename(sub.id, e)}
                    className="space-y-2"
                  >
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={120}
                      disabled={isPending}
                      autoFocus
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setEditingId(null)}
                        disabled={isPending}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isPending || !editName.trim()}
                      >
                        Guardar
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm text-foreground break-words">
                        {sub.name}
                      </span>
                    </div>

                    <div className="flex items-center justify-end gap-1 pt-1 border-t border-border/40">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingId(sub.id);
                          setEditName(sub.name);
                          setErrorMsg(null);
                        }}
                        disabled={isPending}
                      >
                        Renombrar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive/70 hover:text-destructive"
                        onClick={() => handleArchive(sub.id, sub.name)}
                        disabled={isPending}
                      >
                        Archivar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
