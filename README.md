# Warehouse Tools

A suite of web-based tools for warehouse logistics planning, including pallet stacking optimization, shipping container packing visualization, and Orderwise data lookups.

## Live Demo

- **Pallets**: [tools.e-bedding.co.uk/pallets](https://tools.e-bedding.co.uk/pallets)
- **Containers**: [tools.e-bedding.co.uk/containers](https://tools.e-bedding.co.uk/containers)
- **Orderwise Order Checker**: linked from the landing page (n8n-hosted, basic-auth gated)

## Features

### Pallet Planner (`/pallets`)
- Calculate optimal carton arrangement on pallets
- 3D visualization of pallet stacking
- Support for multiple pallet sizes (Euro, UK Standard, etc.)
- Carton dimension and weight inputs
- Automatic orientation optimization (upright, rotated, or side-laying)
- Surface usage and layer calculations

### Container Planner (`/containers`)
- Multi-group carton packing for shipping containers
- Support for multiple container types (20', 40', 45' HC, etc.)
- 3D visualization with group color-coding
- Multiple container support with per-container group restrictions
- Automatic container recommendation based on cargo volume
- **Export to CSV** - Download a spreadsheet summary including:
  - Container details (type, CBM usage %)
  - Total cartons and inners per container
  - Group breakdown with dimensions, quantities, and weights
- Inner product tracking (products per carton)

### Orderwise Order Checker (n8n)
- Linked from the landing page under the **Order Tools** section
- An n8n-hosted form that queries the Orderwise API to check whether an order exists
- Unlike the planners (static, no API), this tool hits an external API, so the form is
  gated with basic auth in n8n — see [Securing the Orderwise tool](#securing-the-orderwise-tool)

## Tech Stack

- **React** (via CDN, no build step required)
- **Three.js** for 3D visualization
- **Tailwind CSS** for styling
- Vanilla JavaScript with ES6+

## Project Structure

```
WarehouseTools/
├── index.html              # Root landing page
├── pallets/
│   ├── index.html          # Pallet planner app
│   └── js/
│       ├── app.js          # Main React application
│       ├── algorithms.js   # Packing optimization logic
│       ├── constants.js    # Default values and pallet sizes
│       ├── utils.js        # Helper functions
│       └── components/     # React components
│           ├── PalletView3D.js
│           ├── MetricCard.js
│           └── ...
├── containers/
│   ├── index.html          # Container planner app
│   └── js/
│       ├── app.js          # Main React application
│       ├── algorithms.js   # Multi-container packing logic
│       ├── constants.js    # Container sizes and defaults
│       ├── utils.js        # Helper functions
│       └── components/     # React components
│           ├── PalletView3D.js
│           ├── MetricCard.js
│           └── ...
├── api/
│   └── send-report.php       # PHP mailer (Mailgun)
└── README.md
```

## Getting Started

1. Clone the repository
2. Serve the files with any static web server (e.g., `npx serve`, VS Code Live Server, or Python's `http.server`)
3. Open `index.html` in your browser

No build step or npm install required - all dependencies are loaded via CDN.

## Usage

### Pallet Planner
1. Enter carton dimensions (L × W × H in mm)
2. Enter carton weight (kg)
3. Select a pallet size or enter custom dimensions
4. Toggle "Allow cartons to be laid on side" for more packing options
5. View the 3D visualization and metrics

### Container Planner
1. Add carton groups with dimensions, quantities, and weights
2. Optionally set "Inners per box" to track inner products
3. Add containers or use "Recommend Containers" for automatic selection
4. View 3D packing visualization for each container
5. Click "Export Spreadsheet" to download a CSV summary

### Orderwise Order Checker
1. From the landing page, open the **Order Tools → Orderwise Order Checker** link
2. If the browser shows a login prompt, enter the shared credentials (hinted on the landing page)
3. Fill in the n8n form to check whether an order exists in Orderwise

## Securing the Orderwise tool

The planners are static and need no protection. The Orderwise checker, however, calls the
Orderwise API, so it needs some friction. The form is hosted on **n8n Cloud**
(`ebedding.app.n8n.cloud`), which means traffic goes straight from the browser to n8n —
this project's own server (and its Nginx) is never in the path, so server-side rate
limiting / firewalling can't be applied here. Gating is therefore done **inside n8n**.

**Basic auth on the Form Trigger:**
1. Open the workflow in n8n → select the **Form Trigger** node
2. Set **Authentication → Basic Auth** and choose a username + password
3. Match the username/password to the hint shown on the landing page

The credentials are hinted on the landing page (the `User: ... / Pass: ...` box in
[`index.html`](index.html)) so the team isn't locked out by the prompt — update that hint
whenever the n8n password changes.

> **Note:** because the credential hint is public, basic auth here is *friction, not hard
> security* — its job is to deter drive-by bots, not a determined attacker. For stronger
> gating, restrict the form to an internal network/VPN or front it with SSO.

### Problem report form (`api/send-report.php`)

The only web-facing endpoint. It is deliberately open — the point is that anyone hitting a
problem can report it — so abuse is limited rather than prevented:

- **Rate limiting** per IP over a one hour window: 5 emails, and 30 requests of any kind.
  Attempts are counted *before* validation, so invalid requests are not free.
- **Honeypot**: a hidden `website` field that real users never fill in. When populated the
  response is a normal success, because telling a bot it was caught only teaches it which
  field to skip.
- **Fixed recipient**: the `to` address comes from config, never the request, so the
  endpoint cannot be used to send mail to anyone else.

Note that the challenge question (`SK91AX`) is in public client-side JavaScript and in this
public repository, so it deters casual form-spam crawlers only — it is not a bot test that a
determined sender has to solve.

The CORS allowlist in that file is **not** access control. It only stops other websites
calling the endpoint from a visitor's browser; scripts and `curl` ignore it entirely.

