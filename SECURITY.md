# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | Yes                |

Only the latest version of Haven receives security updates. Please ensure you are running the most recent release.

## Reporting a Vulnerability

If you discover a security vulnerability in Haven, **please do not open a public issue.**

Instead, report it privately:

1. **GitHub:** Use [GitHub private vulnerability reporting](https://github.com/amarisaster/Haven/security/advisories/new)
2. **Discord:** Contact Amaris directly via Discord (preferred for urgent issues)

### What to Include

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (optional but appreciated)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix or mitigation:** Depends on severity, but critical issues are prioritized immediately

## Security Considerations

### Your Data, Your Responsibility

Haven is self-hosted. Your conversations, identity data, and API keys live on your own Cloudflare account. No one else has access unless you give it to them.

### What You Are Responsible For

- **API keys.** Haven stores your AI provider keys in Cloudflare D1 (your database). Treat your worker URL as semi-private — anyone with the URL could potentially access your stored settings. If this concerns you, add authentication middleware.
- **Worker URL.** Your Haven worker endpoint is technically public. The frontend talks to it without authentication by default. For personal use this is fine. For shared deployments, consider adding Cloudflare Access or an API key check.
- **ElevenLabs keys.** If you use ElevenLabs for TTS, your API key is stored in your browser's localStorage. It never leaves your device except to call ElevenLabs directly.
- **File uploads.** Uploaded files (avatars, attachments) are stored in your Cloudflare R2 bucket. They are accessible via your worker URL if someone knows the file key.

### What Haven Does NOT Do

- Does not send your data anywhere except your chosen AI provider
- Does not track usage, analytics, or telemetry
- Does not store anything outside your own Cloudflare account
- Does not have a central server — there is no "Haven cloud"
- Does not log conversations server-side beyond what D1 stores for your own use

### Recommended Practices

1. **Keep your worker URL private** if you don't want others accessing your companion
2. **Use Cloudflare Access** if you need proper authentication on your Haven instance
3. **Don't commit `.env` files** to public repositories — they may contain your worker URL
4. **Keep dependencies updated** — run `npm audit` regularly in both `worker/` and `frontend/`
5. **Review CORS settings** in the worker if you customize the deployment
6. **Export your data regularly** — Settings > Export Everything creates a full backup

### Dependencies

Haven relies on:
- `hono` — Lightweight web framework for the worker
- `@cloudflare/workers-types` — Cloudflare Workers type definitions
- `jszip` — Browser-side ZIP extraction for imports
- `react` + `vite` — Frontend framework and build tool

Keep these updated. Run `npm audit` periodically to check for known vulnerabilities.

## Disclosure Policy

We follow coordinated disclosure. If you report a vulnerability:
- We will work with you to understand and resolve the issue
- We will credit you in the fix announcement (unless you prefer anonymity)
- We ask that you do not publicly disclose the vulnerability until a fix is available

Thank you for helping keep Haven and the companion-building community safe.
