# Remote commands

Default execution preserves argv boundaries:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" --timeout-ms 120000 -- printf '%s\n' 'a b' '$HOME'
```

Use explicit shell mode only for operators, expansion, or a script:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" --shell 'npm test && git status --short'
ez-devbox command --sandbox-id "$SANDBOX_ID" --shell-file ./remote-check.sh --json
```

JSON returns the sandbox ID, cwd, command description, stdout, stderr, and remote exit code. A transport/setup failure instead returns `error.code`, `error.stage`, and `error.sandboxId` when known.
