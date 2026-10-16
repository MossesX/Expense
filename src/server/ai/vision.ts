/**
 * @file Read a statement image into transactions, on whichever backend the
 * person has: Claude Code on the subscription (the image is written to a
 * scratch file the CLI's Read tool can open), else the API with a structured
 * output. The result shape is the same either way. **Node-only.**
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

const Transaction = z.object({
  date: z.string().describe("ISO date YYYY-MM-DD. If the year is not printed, use the most plausible recent year."),
  merchant: z.string().describe("The merchant or description exactly as printed."),
  amount: z.number().describe("Absolute amount in major currency units, e.g. 26.51."),
  kind: z.enum(["expense", "income"]).describe("expense for a charge or purchase; income for a credit, refund, deposit or payment received."),
  category: z.string().describe("The statement's own category word if printed, else an empty string."),
  payment: z.boolean().describe("true when this line is a payment made TO the card/account (e.g. 'MOBILE PAYMENT', 'AUTOPAY', 'PAYMENT - THANK YOU').")
});

export const Statement = z.object({
  account: z.string().describe("Bank or card name if visible, else empty."),
  transactions: z.array(Transaction),
  notes: z.string().describe("Anything uncertain: unreadable lines, ambiguous years, cut-off rows.")
});

export type ParsedStatement = z.infer<typeof Statement>;

const SYSTEM =
  "You read bank and credit-card statement screenshots, printed statements and receipts, and list every transaction visible. " +
  "Be exhaustive: one entry per transaction line, in the order shown, including ones partly cut off at the edge if the amount and merchant are legible. " +
  "Never invent a line. Dates: statements group lines under date headers — apply the header's date to each line beneath it. " +
  "Amounts are absolute; set kind=income for credits, refunds and deposits (often shown with a minus sign or in green), expense for charges.";

const ask = (account: string) =>
  `List every transaction in this image.${account ? ` The account is "${account}".` : ""} Today's date is ${new Date().toISOString().slice(0, 10)}; if a line shows only a month and day, choose the most recent year on or before today.`;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface ReadImageInput {
  user: string;
  image: string; // base64, no data: prefix
  mediaType: ImageMediaType;
  account: string;
  model: string;
  connection: "auto" | "server" | "user-key";
}

export async function readStatementImage(input: ReadImageInput): Promise<{ parsed: ParsedStatement; backend: "subscription" | "api" }> {
  const creds = await getCredentials(input.user);
  let lastError: Error | null = null;

  if (input.connection !== "user-key" && creds.subscriptionToken && cliOk()) {
    const dir = mkdtempSync(path.join(tmpdir(), "expenses-scan-"));
    const ext = input.mediaType === "image/png" ? "png" : input.mediaType === "image/gif" ? "gif" : input.mediaType === "image/webp" ? "webp" : "jpg";
    const file = path.join(dir, `statement.${ext}`);
    try {
      writeFileSync(file, Buffer.from(input.image, "base64"));
      const prompt =
        `${SYSTEM}\n\nRead the image file at ${file} with your Read tool. ${ask(input.account)}\n\n` +
        `Answer with ONLY a JSON object, no prose and no code fence, of the shape {"account": string, "transactions": [{"date": "YYYY-MM-DD", "merchant": string, "amount": number, "kind": "expense"|"income", "category": string, "payment": boolean}], "notes": string}.`;
      const r = await runCliOnce({ token: creds.subscriptionToken, model: input.model, prompt, cwd: dir, allowedTools: ["Read"], timeoutMs: 5 * 60_000 });
      if (r.ok) {
        const text = r.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        const parsed = Statement.safeParse(JSON.parse(text.slice(start, end + 1)));
        if (parsed.success) return { parsed: parsed.data, backend: "subscription" };
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
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.image } },
            { type: "text", text: ask(input.account) }
          ]
        }
      ],
      output_config: { format: zodOutputFormat(Statement) }
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined to read this image.");
    if (!response.parsed_output) throw new Error("The model's answer did not match the expected shape.");
    return { parsed: response.parsed_output, backend: "api" };
  }

  throw lastError ?? new Error("No Claude connection. Add a subscription token or an API key in Settings › AI, or set CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY on the server.");
}
