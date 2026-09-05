import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPromptInput, readPromptStream } from "../src/cli/prompt-input.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("prompt input", () => {
  it("preserves multiline and shell metacharacters from files", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-prompt-"));
    roots.push(root);
    const path = join(root, "prompt.md");
    const prompt = "line one\n$HOME `command` 'quotes' 😀\n";
    await writeFile(path, prompt);
    await expect(readPromptInput({ promptFile: path, promptStdin: false })).resolves.toBe(prompt);
  });

  it("preserves stream chunk boundaries as exact text", async () => {
    async function* chunks(): AsyncGenerator<Buffer> {
      yield Buffer.from("first\n$");
      yield Buffer.from("HOME\nlast");
    }
    await expect(readPromptStream(chunks())).resolves.toBe("first\n$HOME\nlast");
  });
});
