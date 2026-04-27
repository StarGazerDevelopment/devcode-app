# devcode

Local-first AI coding workspace (web UI + desktop shell) with:

- Left AI chat sidebar (Cursor/Trae-style)
- Project file tree + editor (Monaco)
- Bottom terminal (command runner + streaming output)
- Localhost preview (auto-detects URLs from terminal output)
- Project chat memory stored in `.devcode/` inside the opened project

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file (do not commit it):

```bash
copy .env.example .env
```

3. Put your Groq key into `.env`:

```
GROQ_API_KEY=...
```

## Run (Desktop app)

```bash
npm run dev
```

This starts:

- Vite web UI at http://localhost:5173
- Local API server at http://localhost:3030
- Electron window that loads the UI so it feels like an app

## Run (Web-only)

In one terminal:

```bash
npm run dev:server
```

In another:

```bash
npm run dev:web
```
