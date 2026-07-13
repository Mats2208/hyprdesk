# Security Policy

## Reporting a vulnerability

Please **do not open a public issue.** Report it privately through
[GitHub Security Advisories](https://github.com/Mats2208/hyprdesk/security/advisories/new), and I'll get back to you.

## Threat model — read this before you file anything

HyprDesk is a **local desktop orchestrator for coding agents**. Some things that look like vulnerabilities are the actual design:

- **Agents run with permission bypass by default.** `--dangerously-skip-permissions` on claude, `--dangerously-bypass-approvals-and-sandbox` on codex, open permissions on opencode. That is the point of delegation — an agent that stops to ask about every edit can't be delegated to. Switch to **"ask" mode** in Settings if you want to review each edit and command.
- **Agents can read and write your files and run commands.** The blast radius is the workspace folder (and, in git repos, each worker's isolated worktree).
- **The A2A tunnel is a local HTTP server** bound to `127.0.0.1` on a random port. Any process on your machine can talk to it. That is the same trust boundary as the agent CLIs themselves.

**Run HyprDesk on a machine you trust, with tasks and inputs you trust.** Do not point it at untrusted repositories or paste untrusted prompts into a router: prompt injection in a file an agent reads is, by construction, code execution.

Things that *are* in scope and worth reporting: the tunnel binding to something other than loopback, session/credential material leaking outside `~/HyprDesk` and the engines' own config dirs, a worker escaping its worktree into another workspace, or anything that lets a remote party reach the control server.

## Supported versions

HyprDesk is in active development and pre-1.0. Only `main` is supported.
