import Image from "next/image";

export default function Home() {
  return (
    <main className="candidate-page flex min-h-dvh w-full items-center">
      <section className="w-full border-t border-hairline pt-6">
        <Image
          src="/brand/logo-ink.png"
          alt="Cosmetics.lk"
          width={201}
          height={187}
          className="mb-8 h-10 w-auto"
          priority
        />
        <p className="mb-2 text-sm text-muted">Online exam platform</p>
        <h1 className="text-title font-semibold text-ink">Setup complete</h1>
        <p className="mt-3 max-w-prose text-md text-muted">
          Candidate and administration screens will be added in the next phases.
        </p>
      </section>
    </main>
  );
}
