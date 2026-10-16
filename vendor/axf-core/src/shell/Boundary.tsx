/**
 * @file Render crash isolation — the three tiers, on the chokepoints.
 *
 * The requirement (owner, 2026-08-08): large modules will be built almost
 * entirely from individual plugins, so a plugin must not be able to crash its
 * module, and a module must not be able to crash the wrapper or the app. This
 * lives in CORE, not Studio, because peeled apps install third-party plugins at
 * runtime and would otherwise ship with no isolation at all.
 *
 * Three tiers, each mounted by the framework rather than remembered by authors:
 *
 *   - **contribution** — around each contribution, inside `<Slot>`. One per
 *     contribution, not one per slot, so a crashing plugin cannot take its
 *     siblings down with it.
 *   - **module** — around the module's screen, inside `<ModuleHost>`. The
 *     banner and shell chrome sit OUTSIDE it and survive.
 *   - **app** — around everything the shell mounts (`BootedHost` wraps itself
 *     in one). The last net: whatever slips the inner tiers replaces the page
 *     with a named panel instead of a white screen.
 *
 * Hard-won constraints, each proven by a failure:
 *
 *   1. **A contribution must be INVOKED below the boundary.** The obvious
 *      `<Boundary>{render(payload)}</Boundary>` runs `render()` during the
 *      PARENT's render — above a boundary that has not mounted — so the throw
 *      escapes to the next boundary up and the panel blames the wrong tier.
 *      `ContributionView` exists so the invocation happens in a child's render.
 *
 *   2. **There are TWO throw sites, and a boundary only covers one.** The
 *      render *callback* can throw while it executes (it runs synchronously in
 *      `ContributionView`'s render — try/catch covers that, on the server as
 *      well as the client), and the *element it returns* can throw later when
 *      React renders it (only the class boundary catches that, and only on the
 *      client). Both nets are needed; neither alone is "plugins cannot crash
 *      the module".
 *
 *   3. **React boundaries never catch async.** Event handlers, timers,
 *      requestAnimationFrame, promise rejections — none of it reaches a
 *      boundary. Those do not corrupt the mounted tree, so the right response
 *      is to RECORD them, not to unmount anything:
 *      `installGlobalCrashHandlers()` feeds them into the same crash log the
 *      boundaries write, so an async crash is named instead of vanishing into
 *      the console.
 *
 *   4. **The fallback must not be able to crash.** It renders only strings and
 *      `token()` values (pure string builders), touches nothing that can
 *      throw, and retry is manual — an automatic retry of a deterministic
 *      crash is an infinite loop with extra steps.
 *
 * ── WHY THIS FILE IS NOT MUI, WHEN EVERYTHING AROUND IT IS (2026-08-10, P2) ──
 *
 * The owner's standing rule is that where an MUI component exists it is used,
 * and P2 rebuilt every other drawing surface in core on it — `AppShell`,
 * `ModuleHost`, `PaneLayout`, `ContextMenu`, `Glyph`, and `NavMenu`/`Toolbar`/
 * `Dashboard` before them. `CrashPanel` below is the ONE exception, it is
 * declared as such in `scripts/check-ui.mjs` (rules `mui-control` +
 * `mui-chrome`), and this is the reason.
 *
 * It is constraint 4 applied to a specific, REACHABLE failure rather than to a
 * hypothetical one. `theme/mui.ts` says it in its own words: `createTheme`
 * throws on an unparseable colour, at theme construction, "taking the app with
 * it", and *"the alternative is a white screen."* The thing that stops that
 * being a white screen is this boundary — `AppShell` mounts the app tier
 * OUTSIDE `AxfMuiRoot` precisely so a throw from the provider is caught by a
 * panel that is not underneath it.
 *
 * A fallback built from `Box`/`Typography`/`Alert` would be reaching for the
 * kit whose provider has just failed, from inside the boundary's own render.
 * A throw there does not render a second panel — it escapes to the next
 * boundary up, and for the app tier there is no next boundary. The one job
 * this component has is to be the thing that still works, so it renders plain
 * elements painted from `token()` (which is string concatenation into
 * `var(--axf-*)`, published by `AxfStyleRoot`, and independent of MUI, Emotion
 * and any provider). It still follows the theme; it just cannot be taken down
 * by it.
 *
 * The scope of the exception is exactly `CrashPanel`. It is not a licence for
 * the rest of the file, and it is not a licence for the two wiring-error
 * strips in `ModuleHost` — those render with the tree intact and every provider
 * alive, so they are `Alert`s, and the docblock there says why the distinction
 * matters. Verified by mutation this phase: `AxfMuiRoot` was made to throw and
 * the app-tier panel rendered and named it.
 */
"use client";

import * as React from "react";
import type { ReactNode } from "react";

import { token } from "../theme/apply";

/* ------------------------------------------------------------- crash log */

export type CrashTier = "contribution" | "module" | "app" | "async";

export interface CrashRecord {
  readonly tier: CrashTier;
  /** What crashed, by name — "demo-badge → demo.badge", "demo", "shell". */
  readonly source: string;
  readonly message: string;
  /** Milliseconds since epoch. */
  readonly at: number;
}

const KEEP = 50;

/**
 * The crash history, observable. Small on purpose: it exists so "what failed"
 * is a question the running app can answer (an inspector card, a dev overlay)
 * rather than something scrolled away in the console.
 */
export class CrashLog {
  #records: CrashRecord[] = [];
  readonly #listeners = new Set<() => void>();
  #snapshot: readonly CrashRecord[] = [];

  report(tier: CrashTier, source: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#records.push({ tier, source, message, at: Date.now() });
    if (this.#records.length > KEEP) this.#records = this.#records.slice(-KEEP);
    this.#snapshot = [...this.#records];
    // Named and visible even where no UI is looking — one line, greppable.
    if (typeof console !== "undefined") {
      console.warn(`[axf] ${tier} crash · ${source} · ${message}`);
    }
    for (const fn of this.#listeners) fn();
  }

  list(): readonly CrashRecord[] {
    return this.#snapshot;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
}

/** The process-wide crash log. Per-runtime, like every other registry. */
export const crashes = new CrashLog();

/** Subscribe to the crash history. Re-renders when a crash is recorded. */
export function useCrashes(): readonly CrashRecord[] {
  return React.useSyncExternalStore(
    crashes.subscribe,
    () => crashes.list(),
    () => crashes.list()
  );
}

let handlersInstalled = false;

/**
 * Route window-level failures — the async errors no boundary can catch — into
 * the crash log. Idempotent, because fast refresh re-evaluates modules and a
 * second install would double-report every crash. Mounted by `<Boundary>` on
 * first client mount, so any app using the isolation gets the async net
 * without a separate call to remember.
 */
export function installGlobalCrashHandlers(): void {
  if (handlersInstalled || typeof window === "undefined") return;
  handlersInstalled = true;
  window.addEventListener("error", (e) => {
    crashes.report("async", "window", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    crashes.report("async", "unhandled promise", e.reason);
  });
}

/* -------------------------------------------------------------- fallback */

const TIER_LABEL: Record<CrashTier, string> = {
  contribution: "plugin failed",
  module: "module failed",
  app: "application failed",
  async: "async failure"
};

/**
 * What renders in place of the crashed thing. Names the tier, the source and
 * the error, and offers a manual retry. `compact` is the contribution flavour —
 * a chip that sits inside a host's layout without blowing it up.
 */
function CrashPanel({
  tier,
  source,
  message,
  compact,
  onRetry
}: {
  tier: CrashTier;
  source: string;
  message: string;
  compact?: boolean;
  onRetry: () => void;
}) {
  const base: React.CSSProperties = {
    fontFamily: token("mono"),
    color: token("err"),
    border: `1px dashed ${token("err")}`,
    borderRadius: 6,
    background: token("panel")
  };
  const retryStyle: React.CSSProperties = {
    fontFamily: token("mono"),
    fontSize: compact ? 10 : 12,
    color: token("dim"),
    background: "transparent",
    border: `1px solid ${token("edge")}`,
    borderRadius: 4,
    padding: compact ? "1px 6px" : "3px 10px",
    cursor: "pointer"
  };
  if (compact) {
    return (
      <span
        role="alert"
        data-axf-crash={tier}
        style={{
          ...base,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 10.5,
          padding: "3px 8px"
        }}
        title={message}
      >
        {TIER_LABEL[tier]} · {source}
        <button type="button" style={retryStyle} onClick={onRetry}>
          retry
        </button>
      </span>
    );
  }
  return (
    <div role="alert" data-axf-crash={tier} style={{ ...base, padding: "18px 20px", margin: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {TIER_LABEL[tier]} · {source}
      </div>
      <div style={{ fontSize: 12, color: token("dim"), margin: "8px 0 12px", whiteSpace: "pre-wrap" }}>
        {message}
      </div>
      <button type="button" style={retryStyle} onClick={onRetry}>
        retry
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- boundary */

interface BoundaryProps {
  readonly tier: Exclude<CrashTier, "async">;
  /** What this boundary protects the app FROM, by name. */
  readonly source: string;
  readonly compact?: boolean;
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly error: string | null;
}

/**
 * The error boundary itself — a class, because catching a descendant's render
 * error is still a class-only capability. Not exported raw as the whole API:
 * `Slot` and `ModuleHost` mount it so authors cannot forget it, and
 * `BootedHost` mounts the app tier. Exported for hosts core does not know
 * about.
 */
export class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown): void {
    crashes.report(this.props.tier, this.props.source, error);
  }

  componentDidMount(): void {
    installGlobalCrashHandlers();
  }

  #retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <CrashPanel
          tier={this.props.tier}
          source={this.props.source}
          message={this.state.error}
          compact={this.props.compact}
          onRetry={this.#retry}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Invokes a contribution's render callback in a CHILD's render phase — below
 * the boundary (constraint 1) — and wraps the synchronous call in try/catch,
 * which is the half a boundary cannot cover during SSR (constraint 2). A
 * synchronous throw here renders the same panel the boundary would, and is
 * reported once, from here; the boundary above catches only what escapes into
 * the returned element's own render.
 */
export function ContributionView<P>({
  render,
  payload,
  from,
  point
}: {
  render: (payload: P, from: string) => ReactNode;
  payload: P;
  from: string;
  point: string;
}) {
  const [attempt, setAttempt] = React.useState(0);

  let content: ReactNode = null;
  let caught: unknown = null;
  let failed = false;
  try {
    content = render(payload, from);
  } catch (err) {
    caught = err;
    failed = true;
  }

  // Reported from an effect, not from the render phase: `crashes.report()`
  // notifies subscribers, and notifying a store while another component is
  // rendering is the "update during render" bug wearing a trench coat. On the
  // server the effect never runs — the fallback still renders there, and the
  // client re-render reports it.
  const message = failed ? (caught instanceof Error ? caught.message : String(caught)) : null;
  React.useEffect(() => {
    if (failed) crashes.report("contribution", `${from} → ${point}`, caught);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `caught` is not
    // comparable state; `attempt` re-reports a repeated failure after a retry.
  }, [failed, attempt, from, point]);

  if (failed) {
    return (
      <CrashPanel
        tier="contribution"
        source={`${from} → ${point}`}
        message={message ?? "unknown error"}
        compact
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }
  // `key={attempt}` remounts the contribution subtree on retry, so a component
  // that crashed mid-mount does not retry into its own corpse.
  return <React.Fragment key={attempt}>{content}</React.Fragment>;
}
