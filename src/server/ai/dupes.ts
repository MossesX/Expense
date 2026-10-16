/**
 * @file Ask Claude which candidate pairs are one transaction recorded twice
 * — the subscription (Claude Code CLI) first, the API as the fallback, the
 * same two backends and the same order as `vision.ts`. The pairs come from
 * the browser's own scan (`modules/expenses/dupes.ts`); the model only
 * judges, it never sees the ledger. **Node-only.**
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { cliOk } from "./assistant";
import { runCliOnce } from "./cli";
import { getCredentials } from "./credentials";

const Verdict = z.object({
  index: z.number().int().describe("The pair's index, copied from the input."),
  duplicate: z.boolean().describe("true when the two entries are most likely ONE real-world transaction recorded twice."),
  confidence: z.number().min(0).max(1).describe("How sure, 0..1."),
  reason: z.string().describe("One short sentence a person can act on, e.g. 'Same Amazon order: bank text vs app name, posted 2 days later.'")
});

export const Verdicts = z.object({ verdicts: z.array(Verdict) });

export type DupeVerdicts = z.infer<typeof Verdicts>;

const SYSTEM =
  "You review pairs of personal-ledger entries that share the same amount and fall within a few days of each other, and decide for each pair whether they are one real transaction recorded twice. " +
  "Duplicates typically come from: the same charge imported from a bank export and typed by hand; a statement screenshot and a receipt scan of one purchase; a bank's terse description ('AMZN Mktp US*2K4') beside the app's clean name ('Amazon'); a purchase date beside its posting date two or three days later; a card's pending line and its settled line. " +
  "NOT duplicates: a genuinely repeated purchase (two coffees on different days at the same shop, a subscription that bills monthly, two identical fares), a refund beside its charge (kinds differ — those are never paired), different accounts paying for different things that happen to cost the same, and round amounts that recur (ATM withdrawals, transfers). " +
  "Weigh: how specific the amount is (an odd amount like 47.83 repeating is strong evidence; 5.00 is not), merchant text similarity allowing for bank abbreviations, the gap in days (0–3 days is typical posting lag), whether the two came from different sources (a hand entry plus an import is the classic double), and the notes. " +
  "Be decisive but honest with the confidence number; when it is truly a coin flip, say duplicate=false with a confidence near 0.5 and a reason that says what would settle it.";

const ask = (pairsJson: string) =>
  `Judge every pair below. Answer for ALL of them, keeping each pair's index.\n\nPAIRS (JSON):\n${pairsJson}`;

export interface JudgeInput {
  user: string;
  pairs: unknown[];
  model: string;
  connection: "auto" | "server" | "user-key";
}

export async function judgeDuplicates(input: JudgeInput): Promise<{ verdicts: DupeVerdicts["verdicts"]; backend: "subscription" | "api" }> {
  const creds = await getCredentials(input.user);
  const pairsJson = JSON.stringify(input.pairs);
  let lastError: Error | null = null;

  if (input.connection !== "user-key" && creds.subscriptionToken && cliOk()) {
    const dir = mkdtempSync(path.join(tmpdir(), "expenses-dupes-"));
    try {
      // The pairs go in a file the CLI reads, not on the command line: a
      // hundred pairs is more than an argv should carry.
      const file = path.join(dir, "pairs.json");
      writeFileSync(file, pairsJson);
      const prompt =
        `${SYSTEM}\n\nRead the candidate pairs from ${file} with your Read tool. ${ask("(in that file)")}\n\n` +
        `Answer with ONLY a JSON object, no prose and no code fence, of the shape {"verdicts": [{"index": number, "duplicate": boolean, "confidence": number, "reason": string}]}.`;
      const r = await runCliOnce({ token: creds.subscriptionToken, model: input.model, prompt, cwd: dir, allowedTools: ["Read"], timeoutMs: 5 * 60_000 });
      if (r.ok) {
        const text = r.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        const parsed = Verdicts.safeParse(JSON.parse(text.slice(start, end + 1)));
        if (parsed.success) return { verdicts: parsed.data.verdicts, backend: "subscription" };
        lastError = new Error("Claude Code answered in an unexpected shape");
      } else lastError = new Error(r.detail);
    } catch (e) {
      lastError = e as Error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const useApi = !!creds.apiKey && (input.connection !== "server" || creds.sources.api === "env");
  if (useApi) {
    const client = new Anthropic({ apiKey: creds.apiKey, timeout: 5 * 60_000 });
    const response = await client.messages.parse({
      model: input.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: ask(pairsJson) }],
      output_config: { format: zodOutputFormat(Verdicts) }
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined to judge these pairs.");
    if (!response.parsed_output) throw new Error("The model's answer did not match the expected shape.");
    return { verdicts: response.parsed_output.verdicts, backend: "api" };
  }

  throw lastError ?? new Error("No Claude connection. Add a subscription token or an API key in Settings › AI, or set CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY on the server.");
}
