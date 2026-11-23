"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, passwordToken } from "@/middleware";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) redirect("/");
  const given = String(form.get("password") ?? "");
  // Same-length comparison of hashes, so timing says nothing about the password.
  const [a, b] = await Promise.all([passwordToken(given), passwordToken(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0) return { error: "Wrong password." };

  (await cookies()).set(AUTH_COOKIE, b, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
