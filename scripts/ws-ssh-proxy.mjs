#!/usr/bin/env node

const targetUrl = process.argv[2];

if (!targetUrl) {
  process.stderr.write("Usage: ws-ssh-proxy.mjs <wss-url>\n");
  process.exit(2);
}

const ws = new WebSocket(targetUrl);
ws.binaryType = "arraybuffer";

const pending = [];
let open = false;

process.stdin.on("data", (chunk) => {
  if (!open) {
    pending.push(chunk);
    return;
  }

  ws.send(chunk);
});

process.stdin.on("end", () => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
});

ws.addEventListener("open", () => {
  open = true;
  for (const chunk of pending) {
    ws.send(chunk);
  }
  pending.length = 0;
});

ws.addEventListener("message", (event) => {
  if (typeof event.data === "string") {
    process.stdout.write(event.data);
    return;
  }

  const data = Buffer.from(event.data);
  process.stdout.write(data);
});

ws.addEventListener("close", (event) => {
  process.exit(event.code === 1000 ? 0 : 1);
});

ws.addEventListener("error", () => {
  process.exit(1);
});

process.stdin.resume();
