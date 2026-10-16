/**
 * @file `/login` — the one page the gate (`proxy.ts`) lets a signed-out visitor
 * render. Deploy overlay; see `deploy/expenses/build.sh`. Renders the accounts
 * companion's own sign-in card, so there is exactly one login form in the app.
 */
import LoginScreen from "@axs/modules/accounts/LoginScreen";
import WelcomeReset from "@axs/modules/expenses/WelcomeReset";

export default function LoginPage() {
  return (
    <>
      {/* A sign-in starts here, so the ledger's once-per-sign-in welcome marker
          is cleared here (see modules/expenses/welcomeMarker.ts). */}
      <WelcomeReset />
      <LoginScreen />
    </>
  );
}
