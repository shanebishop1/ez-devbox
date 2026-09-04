# Minimal workflow

This example launches a shell in an E2B sandbox, clones GitHub's public `octocat/Hello-World` sample, and starts in the cloned repository.

1. Install Node.js 20 or newer and obtain an E2B API key.
2. Copy `ez-devbox.config.toml` into an empty working directory.
3. Create `.env` there and set `E2B_API_KEY`.
4. Run:

   ```bash
   npx ez-devbox@latest create
   npx ez-devbox@latest list
   npx ez-devbox@latest resume
   ```

5. When finished, delete the sandbox explicitly:

   ```bash
   npx ez-devbox@latest wipe
   ```

Replace the sample repo URL, branch, and `setup_command` for a real project. The sandbox remains an E2B resource after you detach; it is not automatically deleted on terminal exit.
