# Repository Guidelines

## Project Structure & Modules

KiremData is a React, TypeScript, and Vite PWA with an Express/WebSocket LAN hub. The main UI and state live in `src/App.tsx`; reusable UI is in `src/components/`, browser services (crypto, storage, WebRTC, file streaming) in `src/services/`, and shared types/helpers in `src/types/` and `src/utils/`. PWA setup is in `src/sw.ts` and `vite.config.ts`. The server is in `server.ts`. Icons are in `public/`; app imagery is in `src/assets/images/`. There is no test directory.

## Development & Build Commands

- Use Node.js 22.18+; `npm install` installs dependencies (the repository also includes `bun.lock`).
- `npm run dev` starts the local server and Vite development app on port 3000.
- `npm run build` creates the production bundle in `dist/`.
- `npm start` runs `server.ts` in production mode and serves the built app; build first.
- `npm run preview` starts Vite's static preview server for `dist/`.
- `npm run lint` runs TypeScript type checking (`tsc --noEmit`); it is not a formatter or a test suite.

## Coding Style & Naming

Use TypeScript for application and server code, React function components, and two-space indentation. Follow nearby conventions: PascalCase for component files and component names (for example, `QuickSendView.tsx`), camelCase for functions and variables, and descriptive types/interfaces in PascalCase. Keep shared contracts in `src/types/`; isolate browser capabilities in `src/services/`. No formatter or dedicated linter is configured, so keep imports tidy and match the surrounding style.

## Testing Guidelines

No test framework or test scripts are configured. Before submitting changes, run `npm run lint` and `npm run build`. For changes to chat, encryption, WebRTC, or file transfer, include manual verification steps in the pull request; cover both connected and interrupted/reconnected flows where relevant. Do not describe type checking as automated behavioral test coverage.

## Commits & Pull Requests

Git history uses short Conventional Commit-style subjects, such as `feat: initialize KiremData project scaffolding`. Use prefixes like `feat:`, `fix:`, and `docs:` with an imperative summary. Pull requests should explain user-visible changes, list verification performed, link related issues when available, and include screenshots for UI changes. Call out protocol, security, or configuration impacts explicitly.

## Security & Configuration

Use `.env.example` as the configuration reference; never commit real secrets. LAN/VPN clients require trusted HTTPS and shared `KIREMDATA_ACCESS_CODE`. Treat that code as group access, not unique peer identity. Crypto/transfer changes must fail closed and receive careful review.
