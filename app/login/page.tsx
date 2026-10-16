/**
 * @file `/login` — the one page the gate (`proxy.ts`) lets a signed-out visitor
 * render. Deploy overlay; see `deploy/expenses/build.sh`. Renders the accounts
 * companion's own sign-in card, so there is exactly one login form in the app.
 */
import LoginScreen from "@axs/modules/accounts/LoginScreen";

export default function LoginPage() {
  return <LoginScreen />;
}
