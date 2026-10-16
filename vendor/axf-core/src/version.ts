/**
 * @file The core version, alone in a file so anything inside core can read it.
 *
 * It used to live in `index.ts`, which is the BARREL — and a module inside
 * core importing the barrel is a cycle waiting to be discovered at the worst
 * possible moment (the wrapper renderer wants to print "core 0.0.19" in a
 * band, and importing `../index` for it would make the barrel depend on a file
 * that depends on the barrel). One definition, no cycle; `index.ts` re-exports
 * it so the public name is unchanged.
 */

/** Bumped when core gains a capability. The Core Inspector displays it. */
export const AXF_CORE_VERSION = "0.0.25";
