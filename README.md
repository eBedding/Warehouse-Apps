# Warehouse Tools

A suite of web-based tools for warehouse logistics planning, including pallet stacking optimization and shipping container packing visualization.

## Live Demo

- **Pallets**: [tools.e-bedding.co.uk/pallets](https://tools.e-bedding.co.uk/pallets)
- **Containers**: [tools.e-bedding.co.uk/containers](https://tools.e-bedding.co.uk/containers)

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

