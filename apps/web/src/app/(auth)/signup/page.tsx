import { AuthPage } from "@/components/auth-page";
import { isGoogleOAuthConfigured } from "@/lib/auth-providers";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <AuthPage
      mode="signup"
      initialGoogleConfigured={isGoogleOAuthConfigured()}
      useKratos={process.env.EXPONENTIAL_HEADLESS_AUTH_PROVIDERS === "true"}
    />
  );
}
