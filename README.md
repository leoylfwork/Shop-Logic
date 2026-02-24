<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c0eb9020-9bb5-42ae-9e48-e8fc932903c8

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## E2E tests (Playwright)

Tests live in `tests/e2e` and hit the real app and Supabase (no mocks).

1. Copy `.env.e2e.example` to `.env.e2e` and set credentials per role: `E2E_OWNER_EMAIL`/`E2E_OWNER_PASSWORD`, `E2E_ADVISOR_EMAIL`/`E2E_ADVISOR_PASSWORD`, `E2E_FOREMAN_EMAIL`/`E2E_FOREMAN_PASSWORD`, plus `E2E_SUPABASE_URL` and `E2E_SUPABASE_ANON_KEY`.
2. Start the app: `npm run dev` (default `http://0.0.0.0:3000/`).
3. Run: `npm run test:e2e`
