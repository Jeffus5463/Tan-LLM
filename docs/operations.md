# Household Operations

These procedures apply to the Windows laptop that hosts Tan LLM. Run commands from the repository root unless stated otherwise.

## Security boundary

Tan LLM is for one trusted household network. Do not configure router port forwarding, expose the laptop through a public IP address, or run the application on an untrusted network. Version 1 uses HTTP, so credentials, cookies, prompts, and responses are not encrypted in transit.

Production publishes Nginx on port `3000` only. Fastify and Ollama remain on the internal Docker network. Docker Desktop forwards published Windows traffic through `com.docker.backend.exe`, where Windows Firewall can filter it. See [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/) and [New-NetFirewallRule](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).

## First laptop deployment

### 1. Prepare the host

Create `%UserProfile%\.wslconfig` on the laptop:

```ini
[wsl2]
memory=10GB
processors=6
swap=4GB
```

Apply it, restart Docker Desktop, and verify Docker:

```powershell
wsl --shutdown
docker version
docker compose version
docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes'
```

Expected: Docker reports six CPUs and approximately 10 GB of available memory. Configure Docker Desktop to start when the laptop user signs in. Keep the laptop plugged in, awake, signed in, and connected while hosting.

### 2. Reserve the laptop address

Find the active home adapter, IPv4 address, prefix length, gateway, and MAC address:

```powershell
Get-NetIPConfiguration |
  Where-Object IPv4DefaultGateway |
  Format-List InterfaceAlias, InterfaceIndex, IPv4Address, IPv4DefaultGateway

Get-NetAdapter |
  Where-Object Status -eq 'Up' |
  Select-Object Name, InterfaceDescription, MacAddress, LinkSpeed
```

Open the router administration page at the reported default gateway. Create a DHCP reservation that maps the home adapter's MAC address to its current IPv4 address. Router interfaces may call this **Address Reservation**, **Static Lease**, or **Reserved IP**.

Do not reserve a VPN, WSL, virtual-switch, or disconnected adapter address. Record the reserved value as `LAN_HOST_IP` in `.env`.

### 3. Configure the private network

Inspect the Windows network category:

```powershell
Get-NetConnectionProfile |
  Select-Object InterfaceAlias, Name, NetworkCategory, IPv4Connectivity
```

Expected: the home Ethernet or Wi-Fi adapter reports `Private`. If it reports `Public`, change it only after confirming that it is the trusted home network:

```powershell
Set-NetConnectionProfile -InterfaceAlias 'Ethernet' -NetworkCategory Private
```

Replace `Ethernet` with the reported home adapter name.

### 4. Configure local values

Create the ignored configuration file:

```powershell
Copy-Item .env.example .env
```

Set these values in `.env`:

```dotenv
AUTH_USERNAME=owner
AUTH_PASSWORD_HASH='replace-with-an-argon2id-hash'
SESSION_SECRET=replace-with-a-random-64-character-hex-value
COOKIE_SECURE=false
ALLOW_LAN_HTTP=true
LAN_HOST_IP=192.168.1.50
```

Keep the internal proxy and network values from `.env.example` together. Change them only if their subnet conflicts with another Docker or VPN network.

The existing `.env` can be copied to the laptop through trusted removable storage. To create new credentials instead:

```powershell
npm.cmd ci
npm.cmd run build --workspace @tan-llm/api
.\scripts\new-auth-config.ps1
```

Enter the password when prompted. Copy the printed `AUTH_PASSWORD_HASH` and `SESSION_SECRET` lines into `.env`. Never commit or share `.env`.

### 5. Download and start

Internet access is required the first time Docker downloads images and Ollama downloads the model:

```powershell
docker compose pull ollama model-init
docker compose build --pull web api
docker compose up -d
docker compose ps --all
```

Expected:

- `web`, `api`, and `ollama` are `healthy`.
- `model-init` is `Exited (0)`.
- Only web shows host bindings for port `3000`.
- API and Ollama show `3001/tcp` and `11434/tcp` without a host mapping.

### 6. Apply the firewall rules

Determine the exact home subnet from the adapter's IPv4 prefix. A typical `192.168.1.x` address with prefix length `24` uses `192.168.1.0/24`.

Open PowerShell as Administrator and run:

```powershell
.\scripts\configure-lan-firewall.ps1 `
  -LanHostIp 192.168.1.50 `
  -HomeSubnet 192.168.1.0/24
```

Use the laptop's reserved address and actual subnet. The script refuses non-private IPv4 values, mismatched subnets, inactive addresses, and adapters that are not using the Private profile. It creates one narrowly scoped Private-profile allow rule and one Public-profile block rule.

Verify the rules:

```powershell
Get-NetFirewallRule -Group 'Tan LLM' |
  Select-Object Name, Enabled, Profile, Direction, Action

Get-NetTCPConnection -State Listen -LocalPort 3000 |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Expected: the allow rule applies only to `Private`, the block rule applies to `Public`, and listeners exist only for `127.0.0.1` and `LAN_HOST_IP`.

Inspect other enabled rules that mention Docker or port `3000`:

```powershell
Get-NetFirewallRule -Enabled True |
  Where-Object DisplayName -Match 'Docker|Tan LLM' |
  Select-Object DisplayName, Profile, Direction, Action

Get-NetFirewallPortFilter |
  Where-Object LocalPort -eq '3000' |
  Get-NetFirewallRule |
  Select-Object DisplayName, Enabled, Profile, Direction, Action
```

Review any unrelated broad inbound allow rule before changing it. Do not disable Docker's networking or firewall integration.

### 7. Verify household access

On the laptop:

```powershell
curl.exe --noproxy '*' http://localhost:3000/healthz
```

Expected: `ok`.

From another household device, open:

```text
http://<LAN_HOST_IP>:3000
```

Verify login, a streamed response, Stop, refresh, logout, and shared history from a second browser. Direct connections to `<LAN_HOST_IP>:3001` and `<LAN_HOST_IP>:11434` must fail.

## Routine operation

Start or reconcile the production stack:

```powershell
docker compose up -d
```

Stop containers without deleting them:

```powershell
docker compose stop
```

Stop and remove containers and the project network while retaining both named volumes:

```powershell
docker compose down
```

`docker compose down` does not delete chat history or downloaded models unless `--volumes` is added.

Inspect status and logs:

```powershell
docker compose ps --all
docker compose logs --tail 100 web api ollama model-init
docker compose logs --follow api ollama
```

## GPU verification

Send one prompt through the application, then run:

```powershell
docker compose exec ollama ollama ps
docker compose logs ollama |
  Select-String 'CUDA|inference compute|GPU'
```

Expected: the running model reports GPU use, and Ollama logs identify the RTX 4050 with CUDA. CPU-only execution is not accepted for the laptop deployment.

## Model changes

Update `OLLAMA_MODEL` in `.env`. If more than one model should appear in the selector, set `OLLAMA_ALLOWED_MODELS` to a comma-separated list. Pull the configured model and recreate the API:

```powershell
docker compose run --rm model-init
docker compose up -d --force-recreate api web
docker compose exec ollama ollama list
```

Remove an unused model only when its disk space is needed:

```powershell
docker compose exec ollama ollama rm <model-name>
```

The removed model must be downloaded again before it can be used.

## Credential rotation

Generate replacement values:

```powershell
npm.cmd run build --workspace @tan-llm/api
.\scripts\new-auth-config.ps1
```

- To change only the password, replace `AUTH_PASSWORD_HASH` and retain the current `SESSION_SECRET`. Existing sessions remain valid until they expire.
- To sign out every browser, also replace `SESSION_SECRET` with the newly generated value.

Apply the change:

```powershell
docker compose up -d --force-recreate api web
```

## Database backup

The application can remain online during a backup. The helper uses SQLite's online backup API and verifies the resulting database:

```powershell
.\scripts\backup-database.ps1
Get-ChildItem .\backups\tan-llm-*.db |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 Name, Length, LastWriteTime
```

Expected: a timestamped, nonempty `.db` file appears in the ignored `backups` directory. Copy important backups to separate storage.

## Database restore

Place the chosen backup directly in the `backups` directory, then run:

```powershell
.\scripts\restore-database.ps1 -BackupPath .\backups\tan-llm-20260907-120000.db
```

The script requests confirmation, creates a fresh safety backup, stops web/API access, validates and restores the selected database, and starts the application again. If validation fails, the current database remains unchanged.

Verify the restored history in the browser and check service health:

```powershell
docker compose ps --all
```

## Updates

Create a database backup before updating. Bring the reviewed source changes onto the laptop, then rebuild and reconcile containers:

```powershell
.\scripts\backup-database.ps1
docker compose build --pull web api
docker compose pull ollama model-init
docker compose up -d
docker compose ps --all
```

Do not remove volumes during an update. Review release notes before changing major versions of Node.js, Ollama, Nginx, SQLite, or `better-sqlite3`.

## Offline operation

After the images and configured models are present, routine chat generation uses no external service. Disconnect internet access while remaining connected to the home LAN, then send a prompt. It should stream normally. Image pulls, model pulls, source updates, and dependency installation still require internet access.

## Troubleshooting LAN access

- Confirm the laptop still owns `LAN_HOST_IP`. If it changed, correct the DHCP reservation and `.env`, then recreate `web`.
- Confirm the home adapter uses the Private profile and the Tan LLM firewall rules are enabled.
- Guest Wi-Fi often isolates clients from one another. Connect both devices to the main household network or disable client/AP isolation for the trusted network.
- Disconnect VPN software temporarily if it changes routing or firewall behavior.
- Confirm Docker Desktop is running and `docker compose ps --all` reports healthy services.
- Confirm the device uses `http://`, not `https://`, and includes port `3000`.
- Review `docker compose logs --tail 100 web api ollama model-init`.

## Firewall removal

Open PowerShell as Administrator:

```powershell
.\scripts\remove-lan-firewall.ps1
```

Expected: both rules in the `Tan LLM` firewall group are removed.

## Complete removal

First create and copy out any required database backup. Remove the firewall rules, containers, and network while keeping data volumes:

```powershell
.\scripts\remove-lan-firewall.ps1
docker compose down --remove-orphans
```

The following command is destructive:

```powershell
docker compose down --volumes --remove-orphans
```

`--volumes` permanently deletes the SQLite history and local Ollama model store from Docker. Chat history cannot be recovered without a separate backup. Models are rebuildable but must be downloaded again.

After the volumes are deliberately removed, the repository folder and remaining application images can be removed separately.

## Docker concepts

- **Image:** immutable application or service package built or downloaded by Docker.
- **Container:** running instance of an image; replacing it does not erase named-volume data.
- **Named volume:** Docker-managed persistent storage for SQLite and Ollama models.
- **Bind mount:** a host folder exposed to a container; `backups` is mounted this way for export and restore.
- **Bridge network:** private network used by web, API, Ollama, and model initialization.
- **Published port:** explicit host-to-container mapping; only web port `3000` is published.
- **Health check:** repeated probe used by Compose to delay dependent services until they are ready.
- **One-shot service:** container expected to finish successfully, such as `model-init`.
