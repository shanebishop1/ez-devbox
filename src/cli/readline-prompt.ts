import { createInterface } from "node:readline/promises";

export async function promptWithReadline(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}
