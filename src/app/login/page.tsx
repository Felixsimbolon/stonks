import { FadeIn } from "@/components/FadeIn";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="max-w-xl pb-16 pt-24 sm:pt-32">
        <FadeIn>
          <p className="eyebrow mb-6">private instance</p>
        </FadeIn>
        <FadeIn delay={0.08}>
          <h1 className="display text-6xl">
            Enter the <em className="gradient-text">password.</em>
          </h1>
        </FadeIn>
        <FadeIn delay={0.14}>
          <p className="mt-4 text-sm text-muted">This instance spends real API credits, so it&apos;s kept private.</p>
        </FadeIn>
        <FadeIn delay={0.2} className="mt-10">
          <LoginForm next={next ?? "/"} />
        </FadeIn>
      </section>
    </main>
  );
}
