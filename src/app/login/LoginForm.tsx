"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <div className="flex items-end gap-4">
        <label className="flex-1">
          <span className="sr-only">Password</span>
          <input
            type="password"
            name="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Password"
            className="w-full border-b border-hair bg-transparent pb-2 text-2xl text-ink outline-none placeholder:text-faint focus:border-[var(--stock)]"
          />
        </label>
        <button type="submit" disabled={pending} className="eyebrow pb-3 text-ink disabled:text-faint">
          {pending ? "checking…" : "enter →"}
        </button>
      </div>
      {state.error && <p className="mt-3 text-sm text-down">{state.error}</p>}
    </form>
  );
}
