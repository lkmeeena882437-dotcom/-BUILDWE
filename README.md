# BUILDWE.ONLINE

**Build anything. Create everything.**

One free AI workspace for chat, code, images, voice, web search, and purpose-built writing tools. Cream UI, guest-first, installable as a PWA.

## Why it exists

Creators juggle a chat tab, a coding tool, an image app, and a voice app. BUILDWE is one workspace so students, founders, and builders can think, ship, make visuals, and speak text without switching windows.

## Features

- **Guest-first workspace** — start immediately; register when you want a named account that survives a cleared cookie.
- **Chat & Code** — streaming answers, optional web search with sources, file understanding, and a coding canvas.
- **Image & Audio** — generate visuals and voice from the same thread.
- **Vision & files** — read an image or summarise a spreadsheet you attach.
- **31 writing tools** — blog posts, emails, ads, scripts, resumes, and more. Each tool has its own inputs and output contract.
- **Studios** — curated bundles of those tools for founders, marketers, students, teachers, developers, agencies, and executives.
- **Projects & teams** — fold chats into folders; share a workspace with invite links.
- **Creations** — one list for images, clips, code, and any chat answer you keep — named, pinned, shareable.
- **Share links** — a whole chat, one creation, or one answer, as a public read-only page.
- **Credits & PRO** — a simple wallet for generations; PRO for higher limits and an ad-free workspace.
- **Bring your own key** — optional: use your own provider key for your requests only.
- **Developer API** — issue a key from the in-app developers page when you want programmatic chat.

Open the workspace from the landing page (**Start free**). Deep links use query params on `/` — there is no separate login wall.

## Keyboard (workspace)

- `⌘K` / `Ctrl+K` — jump to recent chats, modes, tools, and studios
- `/` — focus the composer
- `Esc` — close the top layer, or stop an answer / agent run that is in flight

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

Copy `.env.example` to `.env.local` and fill in any provider or payment keys you actually use. The app runs without them: images still generate, voice can use the browser, and anything that truly needs a key says so instead of faking success.

## Scripts

- `npm run dev` — development server on port 3000
- `npm run build`
- `npm start`
- `npm run lint`
- `npm test` — the automated suite

## Roadmap

- Richer team workspaces (roles, shared projects that feel like one desk)
- More purpose-built tools, same runner and contracts
- Faster history and creations as libraries grow
- Clearer model picker: what this deployment can actually call, nothing advertised that is not wired

Trust pages: `/how-it-works` `/security` `/acceptable-use` `/changelog` `/status` `/help` `/contact`
