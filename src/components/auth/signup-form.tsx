"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "@/modules/identity/actions";
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

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(
    signupAction,
    undefined
  );

  return (
    <Card className="w-full max-w-md shadow-lg border-border">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold tracking-tight text-center">
          Crear Cuenta
        </CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          Únete a MedStudy Atlas y optimiza tu estudio médico
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

          <div className="space-y-2">
            <Label htmlFor="fullName">Nombre Completo</Label>
            <Input
              id="fullName"
              name="fullName"
              placeholder="Dra. María Quispe"
              required
              disabled={isPending}
            />
            {state?.fieldErrors?.fullName && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.fullName.join(", ")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Correo Electrónico</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="estudiante@medicina.edu.pe"
              autoComplete="email"
              required
              disabled={isPending}
            />
            {state?.fieldErrors?.email && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.email.join(", ")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña (mínimo 8 caracteres)</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              disabled={isPending}
            />
            {state?.fieldErrors?.password && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.password.join(", ")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="medicalSchool">Facultad de Medicina</Label>
              <Input
                id="medicalSchool"
                name="medicalSchool"
                placeholder="Ej. UNMSM, UPCH"
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
                placeholder="1 - 7"
                disabled={isPending}
              />
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            className="w-full font-medium"
            disabled={isPending}
          >
            {isPending ? "Creando cuenta..." : "Crear Cuenta"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            ¿Ya tienes una cuenta?{" "}
            <Link
              href="/auth/login"
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Inicia sesión aquí
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
