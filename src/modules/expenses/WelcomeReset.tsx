"use client";

/**
 * @file Mounted by the login page: reaching it means a sign-in is about to
 * happen (or just ended), so the ledger's welcome marker is cleared and the
 * next arrival on the ledger is welcomed again. Renders nothing.
 */
import * as React from "react";

import { clearWelcomeMarkers } from "./welcomeMarker";

export default function WelcomeReset() {
  React.useEffect(() => {
    clearWelcomeMarkers();
  }, []);
  return null;
}
