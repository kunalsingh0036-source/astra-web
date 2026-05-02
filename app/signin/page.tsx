import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import styles from "./signin.module.css";

/**
 * /signin — the only public page besides NextAuth's own callback routes.
 *
 * Follows Astra's boot aesthetic — the italic wordmark emerges from
 * black, one sentence of copy, a single button. No explanation of what
 * Astra is, because if you're here you already know.
 */

interface Props {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const session = await auth();
  const { callbackUrl = "/", error } = await searchParams;

  // Already signed in — bounce.
  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <main className={styles.main}>
      <div className={styles.wordmark}>astra</div>

      <p className={styles.hello}>
        <em>welcome back,</em> kunal.
      </p>

      {error && <p className={styles.error}>access denied. wrong account?</p>}

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl });
        }}
      >
        <button type="submit" className={styles.button}>
          sign in with google
        </button>
      </form>

      <p className={styles.footnote}>
        only the owner of this instance can sign in.
      </p>
    </main>
  );
}
