<p align="center">
  <img src="https://img.shields.io/badge/Microsoft%20Entra%20ID-0078D4?style=for-the-badge&logo=microsoftentra&logoColor=white" alt="Microsoft Entra ID" />
  <img src="https://img.shields.io/badge/Microsoft%20365-D83B01?style=for-the-badge&logo=microsoft365&logoColor=white" alt="Microsoft 365" />
  <img src="https://img.shields.io/badge/Microsoft%20Graph-2C2C2C?style=for-the-badge&logo=microsoftgraph&logoColor=white" alt="Microsoft Graph" />
</p>

<h1 align="center">🛡️ M365 User Forensics</h1>

<p align="center"><i>Analyze the sign-in history, tools usage, privileged access and licensing of a Microsoft 365 user — with maps, charts, comparison and PDF export.</i></p>

<p align="center">
  <a href="#portugues"><img src="https://img.shields.io/badge/Português-009b3a?style=for-the-badge" alt="Português" /></a>
  &nbsp;
  <a href="#english"><img src="https://img.shields.io/badge/English-0078d4?style=for-the-badge" alt="English" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white" alt="Leaflet" />
</p>

---

<a name="english"></a>
## 🇺🇸 English

A web tool to analyze the **sign-in history of a Microsoft 365 user** via Microsoft Graph (and optionally Azure Monitor / Log Analytics for longer history).

### Features

- 🕐 **When they signed in** — full sign-in history (timestamp, success/failure)
- 📱 **Which applications & tools** — top client apps and accessed M365 resources
- 🔑 **Privileged access** — assigned directory roles (Global Admin, etc.)
- 🎫 **License assignments** — assigned SKUs; click a license to see enabled service plans
- 📊 **Access counts** — totals, successes, failures, unique apps/IPs/countries
- 🗺️ **Locations on a map** — geolocation of sign-ins (Leaflet) with clustering
- 🌐 **IPs** — source addresses and per-IP counts
- 📈 **Timelines** — success vs failures over time, and per-tool access timeline
- 🖼️ **User photo** and **company logo** (tenant branding)
- ⤵️ **Drill-down** — click any metric to see the granular records
- ⚖️ **Compare** — compare the user against another user, side by side
- 🏢 **Tenant average** — compare the user against a sampled tenant baseline
- 📄 **PDF export** and **period filters** (24h / 7 / 30 days, or 90+ via Log Analytics)

> ℹ️ Usage counts are **sign-in / token events**, not API calls.

### 1. Prerequisite: App Registration in Entra ID

Create an app registration in [Entra ID](https://entra.microsoft.com) and grant **Application API permissions** (with admin consent):

| Permission | Used for |
|-----------|----------|
| `AuditLog.Read.All` | Read sign-in logs |
| `Directory.Read.All` | Resolve user and directory data |
| `RoleManagement.Read.Directory` | Read privileged role assignments |
| `User.Read.All` | Read user profile, photo and licenses |
| `OrganizationalBranding.Read.All` | *(optional)* Company logo in the header |

> ⚠️ Sign-in logs require a **Microsoft Entra ID P1/P2** license (Graph retains up to 30 days).

Create a **client secret** and note the `Tenant ID`, `Client ID` and `Secret`.

### 2. Run with Docker (recommended)

```bash
git clone <this-repo>
cd "M365 User Forensics"
docker compose up --build -d
```

Open http://localhost:8080, click the gear ⚙️ and enter the Service Principal credentials (or seed them via `.env`, copying from `.env.example`).

### 3. Run locally (without Docker)

```bash
npm install
npm run dev        # development (hot reload)
# or
npm run build && npm start
```

### 4. Usage

1. Open http://localhost:8080
2. Configure the Service Principal in the gear ⚙️
3. Enter the **UPN, email or objectId** of a user
4. Pick the **data source** (Graph or Log Analytics) and click **Analyze**
5. Use **period filters**, **Compare**, **Tenant average**, drill-downs and **Export PDF**

### 5. 90+ day history with Log Analytics (optional)

Microsoft Graph only retains sign-in logs for ~30 days. For longer history:

1. In **Entra → Monitoring → Diagnostic settings**, export `SigninLogs` to a **Log Analytics workspace**.
2. Grant the Service Principal the **Log Analytics Reader** role on that workspace.
3. Paste the **Workspace ID** in the gear ⚙️ panel and select **Log Analytics** as the data source.

### API

| Endpoint | Description |
|----------|-------------|
| `GET /api/analyze?user=<upn\|email\|id>&source=<graph\|loganalytics>&days=<n>` | Full analysis JSON |
| `GET /api/tenant-average?days=<n>&sample=<n>` | Sampled tenant baseline |
| `GET /api/branding` | Company logo (data URI) |
| `GET/POST /api/config` · `POST /api/config/test` | Credentials state / save / test |
| `GET /health` | Healthcheck |

### Security notes

- The `.env` holds the client secret — it is **git-ignored**, never commit it.
- The tool is **read-only** against Graph / Log Analytics.
- The API has **no built-in authentication**; expose it only on an internal network or behind an authenticating reverse proxy.
- Front-end libraries (Leaflet, MarkerCluster, Chart.js) are **vendored locally** (no external CDN). Map tiles still come from OpenStreetMap.
- Prefer **certificate auth / Managed Identity + Key Vault** over a client secret in production, and rotate secrets.

---

<a name="portugues"></a>
## 🇧🇷 Português

Ferramenta web para analisar o **histórico de logins de um usuário do Microsoft 365** via Microsoft Graph (e, opcionalmente, Azure Monitor / Log Analytics para histórico mais longo).

### Funcionalidades

- 🕐 **Quando logou** — histórico completo de sign-ins (data/hora, sucesso/falha)
- 📱 **Quais aplicativos e ferramentas** — top apps clientes e recursos M365 acessados
- 🔑 **Acessos privilegiados** — roles de diretório atribuídas (Global Admin, etc.)
- 🎫 **Licenciamentos** — SKUs atribuídos; clique numa licença para ver os service plans habilitados
- 📊 **Quantidade de acessos** — totais, sucessos, falhas, apps/IPs/países únicos
- 🗺️ **Localidades no mapa** — geolocalização dos logins (Leaflet) com clusters
- 🌐 **IPs** — endereços de origem e contagem por IP
- 📈 **Timelines** — sucesso vs. falhas ao longo do tempo e timeline de acesso por ferramenta
- 🖼️ **Foto do usuário** e **logo da empresa** (branding do tenant)
- ⤵️ **Drill-down** — clique em qualquer métrica para ver os registros granulares
- ⚖️ **Comparar** — compara o usuário com outro usuário, lado a lado
- 🏢 **Média do tenant** — compara o usuário com uma baseline amostral do tenant
- 📄 **Exportar PDF** e **filtros de período** (24h / 7 / 30 dias, ou 90+ via Log Analytics)

> ℹ️ As contagens de uso são **eventos de sign-in / emissão de token**, não chamadas de API.

### 1. Pré-requisito: registro de aplicativo no Entra ID

Crie um app registration no [Entra ID](https://entra.microsoft.com) e conceda **permissões de API (Application)** com consentimento de administrador:

| Permissão | Usada para |
|-----------|------------|
| `AuditLog.Read.All` | Ler os sign-in logs |
| `Directory.Read.All` | Resolver o usuário e dados de diretório |
| `RoleManagement.Read.Directory` | Ler atribuições de roles privilegiadas |
| `User.Read.All` | Ler perfil, foto e licenças do usuário |
| `OrganizationalBranding.Read.All` | *(opcional)* Logo da empresa no topo |

> ⚠️ Os sign-in logs exigem licença **Microsoft Entra ID P1/P2** (o Graph retém até 30 dias).

Gere um **client secret** e anote o `Tenant ID`, `Client ID` e o `Secret`.

### 2. Executar com Docker (recomendado)

```bash
git clone <este-repo>
cd "M365 User Forensics"
docker compose up --build -d
```

Abra http://localhost:8080, clique na engrenagem ⚙️ e informe as credenciais do Service Principal (ou configure pelo `.env`, copiando do `.env.example`).

### 3. Executar localmente (sem Docker)

```bash
npm install
npm run dev        # desenvolvimento (hot reload)
# ou
npm run build && npm start
```

### 4. Uso

1. Abra http://localhost:8080
2. Configure o Service Principal na engrenagem ⚙️
3. Informe o **UPN, email ou objectId** de um usuário
4. Escolha a **fonte de dados** (Graph ou Log Analytics) e clique em **Analyze**
5. Use os **filtros de período**, **Compare**, **Tenant average**, os drill-downs e **Export PDF**

### 5. Histórico de 90+ dias com Log Analytics (opcional)

O Microsoft Graph retém os sign-in logs por apenas ~30 dias. Para histórico maior:

1. Em **Entra → Monitoramento → Configurações de diagnóstico**, exporte `SigninLogs` para um **Log Analytics workspace**.
2. Conceda ao Service Principal o papel **Log Analytics Reader** nesse workspace.
3. Cole o **Workspace ID** na engrenagem ⚙️ e selecione **Log Analytics** como fonte de dados.

### API

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/analyze?user=<upn\|email\|id>&source=<graph\|loganalytics>&days=<n>` | JSON completo da análise |
| `GET /api/tenant-average?days=<n>&sample=<n>` | Baseline amostral do tenant |
| `GET /api/branding` | Logo da empresa (data URI) |
| `GET/POST /api/config` · `POST /api/config/test` | Estado / salvar / testar credenciais |
| `GET /health` | Healthcheck |

### Notas de segurança

- O `.env` guarda o client secret — está no **.gitignore**, nunca faça commit dele.
- A ferramenta é **somente leitura** sobre o Graph / Log Analytics.
- A API **não tem autenticação própria**; exponha apenas em rede interna ou atrás de um reverse proxy com autenticação.
- As bibliotecas de frontend (Leaflet, MarkerCluster, Chart.js) são **servidas localmente** (sem CDN externo). Os tiles do mapa ainda vêm do OpenStreetMap.
- Em produção, prefira **autenticação por certificado / Managed Identity + Key Vault** em vez de client secret, e rotacione os segredos.

---

<p align="center"><sub>Built with TypeScript, Express, Microsoft Graph SDK, Azure Monitor Query, Leaflet and Chart.js.</sub></p>
