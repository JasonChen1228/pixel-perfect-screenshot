# Pixel-Perfect Screenshot

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c0a5a874-c834-4fd6-be94-8f8550753afc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deploying to Vercel (static SPA)

This app is a plain Vite + React Router single-page app — no server, no SSR.

- **Build:** `vite build` → static files in `dist/`
- **SPA fallback:** `vercel.json` rewrites every non-file path to `index.html`, so deep links like `/app` resolve client-side.
- **Environment variables:** set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the Vercel project (they are baked in at build time).
- **Supabase auth:** add your Vercel domain (e.g. `https://<your-app>.vercel.app/app`) to Supabase → Authentication → URL Configuration → Redirect URLs, so sign-up confirmation emails redirect correctly.
