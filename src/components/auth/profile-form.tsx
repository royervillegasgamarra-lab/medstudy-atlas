"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/modules/identity/actions";
import type { UserProfile } from "@/modules/identity/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

interface ProfileFormProps {
  profile: UserProfile;
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateProfileAction,
    undefined
  );

  return (
    <Card className="w-full max-w-xl shadow-md border-border">
      <CardHeader>
        <CardTitle className="text-xl font-bold">
          Perfil del Estudiante
        </CardTitle>
        <CardDescription>
          Configura tus datos académicos y fecha de examen objetivo
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          {state?.error && (
            <div
              role="alert"
              className="p-3 text-sm rounded-md bg-destructive/15 text-destructive border border-destructive/20"
            >
              {state.error}
            </div>
          )}

          {state?.success && (
            <div
              role="status"
              className="p-3 text-sm rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
            >
              ¡Perfil actualizado con éxito!
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Correo Electrónico (Registrado)</Label>
            <Input
              id="email"
              type="email"
              defaultValue={profile.email}
              disabled
              className="bg-muted text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              El correo está vinculado a tu cuenta de acceso.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Nombre Completo</Label>
            <Input
              id="fullName"
              name="fullName"
              defaultValue={profile.full_name || ""}
              required
              disabled={isPending}
            />
            {state?.fieldErrors?.fullName && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.fullName.join(", ")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="medicalSchool">Facultad de Medicina</Label>
              <Input
                id="medicalSchool"
                name="medicalSchool"
                defaultValue={profile.medical_school || ""}
                placeholder="Ej. UNMSM, UPCH, UCSUR"
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="yearOfStudy">Año de Estudio</Label>
              <Input
                id="yearOfStudy"
                name="yearOfStudy"
                type="number"
                min="1"
                max="7"
                defaultValue={profile.year_of_study || ""}
                placeholder="1 - 7"
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetExamDate">Fecha del Examen Objetivo</Label>
            <Input
              id="targetExamDate"
              name="targetExamDate"
              type="date"
              defaultValue={profile.target_exam_date || ""}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Fecha estimada de tu examen (ENAM, Essalud o residentado).
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex justify-between items-center">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Guardando..." : "Guardar Cambios"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
