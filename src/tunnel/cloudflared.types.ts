import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface CloudflaredTunnelSession {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export type CloudflaredProcess = ChildProcessByStdio<null, Readable, Readable>;
