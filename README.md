# KiremData

KiremData combines local-network file transfer with team chat. The React PWA connects to an Express/WebSocket hub; browsers can establish WebRTC DataChannels for direct peer transfers. Encrypted file mode is enabled by default and only sends over P2P. If a direct connection drops, encrypted transfers stop instead of silently falling back to plaintext HTTP. Users can explicitly turn file encryption off for LAN hub streaming.

## Run locally

Requires Node.js 22.18 or later and npm. From the repository root:

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. When no access code is configured, the hub generates one at startup and prints it in the server terminal. Enter that code in the app. For repeatable setup, copy `.env.example` to `.env` and configure `KIREMDATA_ACCESS_CODE` with at least 12 random characters.

## LAN and VPN access

Device browsers require a trusted HTTPS origin to use Web Crypto. Do not enter the access code over plain HTTP from another device. Put a trusted TLS reverse proxy in front of the hub, enable WebSocket upgrades, and forward `X-Forwarded-Proto`. Set `KIREMDATA_TRUST_PROXY=true` for a local proxy, or set it to the proxy's trusted IP/CIDR. The hub listens on port 3000; restrict direct network access to that port so clients use the HTTPS proxy. `KIREMDATA_DATA_DIR` changes the persistent hub-data directory (default: `~/.kiremdata`); `KIREMDATA_SAVE_DIR` changes the final file-save directory.

The access code is shared by the LAN/VPN group, not a unique account. Once a device ID is registered, the hub rejects a different public key for that ID; first registration still relies on the shared code and should be verified by comparing safety numbers through a trusted channel. VPN membership and local networking do not protect a compromised device. Staged transfer files older than 30 days are removed; final files in the configured save directory are kept.

## Checks

```sh
npm run lint
npm run build
```

There is no automated behavioral test suite yet. For chat, crypto, or transfer changes, include manual steps covering accepted and rejected access codes, connected peers, and P2P failure behavior.
