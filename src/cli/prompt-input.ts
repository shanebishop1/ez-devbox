import { readFile } from "node:fs/promises";

export interface PromptInputOptions {
  promptFile?: string;
  promptStdin: boolean;
}

export async function readPromptInput(options: PromptInputOptions): Promise<string | undefined> {
  if (options.promptFile && options.promptStdin) {
    throw new Error("Use only one of --prompt-file or --prompt-stdin.");
  }

  if (options.promptFile) {
    return readFile(options.promptFile, "utf8");
  }

  if (!options.promptStdin) {
    return undefined;
  }

  if (process.stdin.isTTY) {
    throw new Error("--prompt-stdin requires piped stdin.");
  }

  return readPromptStream(process.stdin);
}

export async function readPromptStream(stream: AsyncIterable<string | Buffer>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function validatePromptText(prompt: string | undefined): string | undefined {
  if (prompt === undefined) {
    return undefined;
  }
  if (prompt.length === 0) {
    throw new Error("Prompt input is empty.");
  }
  if (prompt.includes("\0")) {
    throw new Error("Prompt input cannot contain NUL bytes.");
  }
  return prompt;
}
