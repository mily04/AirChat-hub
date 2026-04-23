
# Tmesh

Tmesh is a local-network chat and file sharing app for nearby devices. It runs a small web server on one machine and lets other devices on the same LAN join through a browser.

## Features

- Public LAN chat room
- Direct user-to-user messages
- Temporary group chats
- File, image, and video transfer
- Drag-and-drop file upload in the chat window
- Message forwarding, including separate and merged forwarding
- Download buttons for transferred files
- Local network URL discovery with mDNS support
- Windows executable packaging script

## Experimental Features

The following features are currently experimental. They are included for testing and feedback, but their behavior and data formats may change in future versions.

- IndexedDB-based local storage for profiles, contacts, groups, message history, and attachment metadata. This is intended to avoid localStorage quota limits and reduce full-history rewrites.
- Paged loading of local message history, so large conversations can load recent messages first and fetch older messages on demand.
- Chunked file upload with resumable chunk status checks, retry handling, configurable chunk size, and server-side streaming merge.
- Experimental private-message encryption using browser Web Crypto APIs. Private text messages publish client public keys and send encrypted payloads through the server. This does not yet cover group chats or file attachments, and it should not be treated as a complete audited security system.
- Basic identity-key binding for connected users, intended to reduce simple user-id spoofing during a session.
- White theme as the default for first-time users. Existing users keep their locally saved theme preference.

## Technology Stack

- TypeScript
- React
- Vite
- Express
- Socket.IO
- Multer
- Tailwind CSS

## Requirements

- Node.js 18 or newer
- npm
- Devices must be on the same local network
- The host firewall must allow Node.js or the packaged Tmesh executable on private networks

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by the server. Other devices on the same LAN can join through the LAN IP URL or the mDNS URL shown by Tmesh.

If another device cannot open the LAN URL, allow Node.js through the operating system firewall for private networks and make sure both devices are connected to the same router or subnet.

## Configuration

Copy `.env.example` to `.env` if you need to expose a public URL in the share dialog:

```bash
APP_URL="https://example.com"
```

`APP_URL` is optional. Tmesh works on a LAN without it.

## Scripts

```bash
npm run dev          # start the development server
npm run lint         # run TypeScript checks
npm run build        # build the web app and server bundle
npm run package:win  # build a Windows executable
```

## Repository Layout

```text
src/                 React client
server.ts            Express and Socket.IO server
uploads/             Runtime upload directory, ignored by Git
dist/                Build output, ignored by Git
LICENSE              AGPL-3.0 license text
LICENSE-COMMERCIAL.md
THIRD_PARTY_LICENSES.md
```

## Security and Privacy Notes

Tmesh is designed for trusted local networks. It does not provide end-to-end encryption, user accounts, or long-term server-side access control. Do not expose it directly to the public internet without adding authentication, transport security, and operational hardening.

Experimental private-message encryption is being developed separately from the baseline security model above. At this stage, group chats and transferred files are not end-to-end encrypted, public keys are not independently verified by users, and uploaded file URLs may still be accessible to anyone who can reach the host and knows the link.

Uploaded files are stored on the host machine in the runtime upload directory. Do not commit uploads, logs, local databases, certificates, private keys, or environment files.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License

Tmesh is open source under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later).

You may use, modify, and distribute this project under the terms of the AGPL. If you distribute a modified version, or provide a modified version to users over a network as a hosted/SaaS service, you must provide the corresponding source code to those users as required by the AGPL.

If you want to use Tmesh in a closed-source product, closed-source internal system, closed-source SDK, or closed-source SaaS/hosted service without complying with the corresponding AGPL obligations, contact the author for a separate commercial license.

Commercial licensing contact:

- Email: mily040625@gmail.com
- Website: https://yourwebsite.com

Third-party dependencies are reviewed separately in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
