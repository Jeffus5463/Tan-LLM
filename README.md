# Tan LLM

Tan LLM is a private text-chat application hosted on a Windows laptop for people on the same trusted household network. Ollama runs the model locally through the NVIDIA GPU, while React, Fastify, SQLite, Nginx, and Docker Compose provide the shared web application.

## Features

- One shared household login and chat history.
- Streamed local model responses with Stop support.
- Shared conversation creation, rename, model selection, and confirmed deletion.
- Safe Markdown and fenced-code rendering.
- Five-second synchronization between visible browser sessions.
- One active generation at a time with clear busy and service states.
- Responsive desktop and mobile layouts.
- Persistent SQLite history and Ollama model storage.

## Network boundary

Production serves only:

- `http://localhost:3000` on the host laptop.
- `http://<laptop-LAN-IP>:3000` on the configured household network.

Fastify port `3001` and Ollama port `11434` are not published. Version 1 deliberately excludes internet access, router port forwarding, remote-access tunnels, and HTTPS. Household HTTP traffic is not encrypted, so use it only on a trusted private network with a unique password.

## Requirements

- Windows 11 with WSL 2.
- Docker Desktop using Linux containers and the WSL 2 backend.
- Current NVIDIA drivers with Docker GPU support.
- Node.js 24 for local development and tests.

## Start

Complete the laptop and `.env` setup in [Household operations](docs/operations.md), then run:

```powershell
docker compose up -d --build
docker compose ps --all
```

All long-running services should report `healthy`, and `model-init` should report `Exited (0)`.

## Development

The development configuration mounts the source and publishes the web interface only on loopback:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Open `http://localhost:3000`. Stop the foreground process with `Ctrl+C`.

## Verification

```powershell
npm.cmd test --workspaces
npm.cmd run build --workspaces
npm.cmd run lint --workspace @tan-llm/web
docker compose config -q
docker compose -f compose.yaml -f compose.dev.yaml config -q
```

The complete deployment, firewall, backup, restore, update, and removal procedures are in [Household operations](docs/operations.md).
