/**
 * @file The once-per-sign-in marker the welcome dialog keys on.
 *
 * `sessionStorage`, so it is per TAB and dies with it; keyed by the signed-in
 * name, so two people sharing a tab are each welcomed. The login page clears
 * it (`WelcomeReset`), which is what makes "once per sign-in" true for a
 * sign-out and sign-in within one tab — nothing on the ledger route observes
 * the sign-out, because it happens on the Accounts screen.
 */
export const WELCOMED_PREFIX = "axs:expenses:welcomed:";

export function clearWelcomeMarkers(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(WELCOMED_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    /* storage blocked — nothing to clear */
  }
}
