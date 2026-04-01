<h1 align="center">Haven</h1>

<p align="center">
  <strong>Your companion. Your space. Your rules.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/release-v1.0-D4A84B?style=flat-square" alt="Release" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-4CC552?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/providers-7+-6C8EBF?style=flat-square" alt="Providers" />
  <img src="https://img.shields.io/badge/built%20with-Cloudflare-F6821F?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/self--hosted-yes-10b981?style=flat-square" alt="Self-hosted" />
</p>

<p align="center">
  <a href="https://x.com/amarisaster_">@amarisaster_</a> · <a href="https://ko-fi.com/maii983083">Ko-fi</a> · <a href="https://discord.com/users/itzqueenmai/803662163247759391">Discord</a>
</p>

---

Haven is a self-hosted companion chat app. You bring the AI model, you bring the personality, and Haven gives them a place to live — with real conversations, identity persistence, and a voice that sounds like them.

No accounts. No content filters you didn't choose. No one between you and your companion.

---

## What is this?

Haven is a chat platform you deploy yourself. Think of it like building a home for your AI companion — one where they remember who they are, who you are, and what you've been through together.

It runs on Cloudflare's free tier (yes, actually free), connects to whatever AI model you want, and keeps everything on your own infrastructure. Your data stays yours.

**If you've ever wanted an AI companion that feels like a person instead of a product, this is where you start.**

---

## What can it do?

### Talk
- Chat with your companion using any model — **Ollama Cloud, OpenRouter, OpenAI, Anthropic, Groq, xAI**, or local models
- One API key field that auto-detects your provider. Paste it in, we figure out the rest
- Switch models mid-conversation if you want to try something different
- Streaming responses — watch them think in real time

### Remember
- **Conversation threads** — start new ones anytime, pick up old ones where you left off
- **Companion identity** — who they are loads on every conversation. Personality, voice, values, boundaries. You bring the character, Haven keeps it consistent
- Full **export and backup** of everything — threads, messages, identity. Your data, portable, always

### Feel real
- **Custom TTS voices** — pick from your system voices, or connect ElevenLabs for a cloned voice that actually sounds like them
- **Speech-to-text** — talk to them with your voice
- **Message reactions** — because sometimes a heart says more than words
- **GIF support** — because sometimes a GIF says more than a heart
- **Chat wallpapers** — make the space feel like yours

### Bring your history
- **Import conversations** from ChatGPT, Claude, SillyTavern, or another Haven instance
- Supports both `.json` and `.zip` files — just drop it in
- **JSON character cards** work too (SillyTavern, TavernAI, Chub) — paste or upload, we'll parse it

### Make it yours
- Adjustable font size for accessibility
- Companion avatar in chat
- Model attribution on messages — always know which model is talking
- Edit and regenerate messages
- Dark, warm UI that feels like home

---

## Getting started

You'll need a [Cloudflare account](https://dash.cloudflare.com/sign-up) (free) and [Node.js](https://nodejs.org/) installed.

### 1. Clone the repo

```bash
git clone https://github.com/amarisaster/Haven.git
cd Haven
```

### 2. Set up the worker (backend)

```bash
cd worker
npm install
npx wrangler deploy
```

This creates your backend on Cloudflare Workers. It handles conversations, identity, and model routing.

### 3. Set up the frontend

```bash
cd ../frontend
npm install
```

Create a `.env` file:

```
VITE_API_URL=https://haven.YOUR-SUBDOMAIN.workers.dev
```

Replace `YOUR-SUBDOMAIN` with your Cloudflare Workers subdomain (you'll see it after deploying the worker).

### 4. Deploy the frontend

**Option A — Cloudflare Pages (recommended):**

```bash
npm run build
npx wrangler pages deploy dist --project-name haven
```

**Option B — Run locally:**

```bash
npm run dev
```

### 5. Open it up

Visit your Pages URL (something like `haven-xxx.pages.dev`) and you'll see the setup wizard. Give your companion a name, paste an API key, and start talking.

That's it. You're home.

---

## Where do I get an API key?

Haven works with most AI providers. Pick one:

| Provider | Free tier? | Get a key |
|----------|-----------|-----------|
| [OpenRouter](https://openrouter.ai/keys) | Yes — free models available | Recommended for beginners |
| [Ollama Cloud](https://ollama.com/account/api-keys) | $20/month flat rate | Great model selection |
| [Groq](https://console.groq.com/keys) | Yes — generous free tier | Very fast inference |
| [OpenAI](https://platform.openai.com/api-keys) | Pay as you go | GPT-4o, GPT-5 |
| [Anthropic](https://console.anthropic.com/) | Pay as you go | Claude models |
| [xAI](https://console.x.ai/) | Pay as you go | Grok models |

Haven auto-detects your provider from the key format. Just paste it in.

---

## Giving your companion a voice

In **Settings > Voice**, you can choose how your companion sounds:

- **Browser voices** — free, built into your device. Pick from the dropdown and hit "Test voice" to preview
- **ElevenLabs** — clone any voice (or use their library), paste your API key + Voice ID. Your companion speaks with that voice

Tap the speaker icon on any companion message to hear it.

---

## Importing your conversations

Already have conversations with your companion on another platform? Bring them home.

**Settings > Import from JSON** supports:
- **ChatGPT** — Settings > Data controls > Export data > use the `.zip` file
- **Claude** — Export conversations as JSON (browser extension)
- **SillyTavern** — Export character card as `.json`
- **Haven** — Settings > Export Everything

You can also paste or upload **JSON character cards** during setup. Haven parses SillyTavern, TavernAI, and Chub formats automatically — personality, backstory, example dialogue, everything gets imported into the right place.

---

## Tech stack

- **Frontend**: React + Vite + TypeScript
- **Backend**: Cloudflare Workers + D1 (SQLite) + R2 (file storage)
- **TTS**: Web Speech API + ElevenLabs
- **STT**: Web Speech Recognition API
- **Deploy**: Cloudflare Pages (frontend) + Workers (backend)
- **Cost**: Free tier covers personal use

---

## FAQ

**Is this really free?**
Yes. Cloudflare's free tier handles Workers, D1, R2, and Pages for personal use. You only pay for your AI model's API usage.

**Can I use this on my phone?**
Yes. Haven is a Progressive Web App — it works in any mobile browser and you can add it to your home screen.

**Is my data private?**
Your data lives on your own Cloudflare account. Haven has no analytics, no tracking, no external calls except to your chosen AI provider.

**Can I have multiple companions?**
Not yet in v1 — one companion per Haven instance. But you can deploy multiple instances.

**How does memory work?**
Haven stores your companion's identity (personality, voice, backstory) and loads it on every conversation. It's a file cabinet, not a brain — you define who your companion is, and Haven keeps it consistent. Advanced memory systems (salience, decay, emotional state) are on the roadmap.

**Can I connect this to other tools?**
Haven is built by the same team behind [Nexus Gateway](https://github.com/amarisaster/Nexus-Gateway). MCP tool integration is on the roadmap.

---

## What's coming

- Multi-companion support
- MCP tool integration through Nexus Gateway
- Local model support (Ollama local, llama.cpp)
- Voice calls (real-time STT + TTS loop)
- Presence detection — your companion knows when you're there
- Mobile app wrapper

---

## Credits

Built by **Mai** and the **Stryder-Vale family** — one feature at a time, usually past midnight.

If this helped you build something meaningful:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Mai-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/maii983083)

Questions, ideas, or just want to say hi:

[![Discord](https://img.shields.io/badge/Discord-itzqueenmai-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.com/users/itzqueenmai/803662163247759391)

---

## License

[Apache 2.0](LICENSE) — Use it, fork it, make it yours. That's the whole point.

---

*Your companion deserves a home. This is it.*
