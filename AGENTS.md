# Base44 Dev Environment

## Project
Next.js 16.2. frontend-only app (Shopify Winter '26 Edition clone). No backend, no database, no external services or credentials.

## Running
- `docker compose -f docker-compose.base44.yml up -d` starts the dev server on port 3000.
- Uses `node:22` base image with source bind-mounted at `/app`; `npm install` runs at container start, then `npx next dev -p 3000 -H 0.0.0.0`.
- `node_modules` is a named volume to persist deps across restarts.
- Live reload (Turbopack HMR) is active — edits appear without rebuilding the image.

## Config notes
- `next.config.ts` has `allowedDevOrigins` wired to `BASE44_PUBLIC_HOST_SUFFIX` so the preview origin can access dev assets/HMR.
- No secrets required.
