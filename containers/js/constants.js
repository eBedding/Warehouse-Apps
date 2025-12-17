// js/constants.js
// Shared constants for CartonApp

window.CartonApp = window.CartonApp || {};
window.CartonApp.Constants = {
  // -------------------------------------------------
  // Default values for form initialization
  // -------------------------------------------------
  DEFAULT_VALUES: {
    carton: { l: 600, w: 400, h: 300, weight: 10.0, innersPerCarton: 0 },
    limits: {
      palletL: 6058,
      palletW: 2438,
      palletH: 2591,
      cartonGrossMax: 25,
      palletGrossMax: 28000,
      desiredCartons: "",
    },
  },

  // -------------------------------------------------
  // Common pallet presets
  // costWeight: relative cost factor (lower = more cost efficient)
  // Used by recommendContainers to prefer cost-effective combinations
  // e.g., 1x 40'HC (cost 1.5) is better than 2x 20' (cost 2.0)
  // -------------------------------------------------
  PALLET_SIZES: [
    { label: "20' Standard (5895 × 2350 mm x 2392mm)", L: 5895, W: 2350, H: 2392, WeightLimit: 28230, costWeight: 1.0 },
    // { label: "40' Standard (12029 × 2350 mm x 2392mm)", L: 12029, W: 2350, H: 2392, WeightLimit: 26700, costWeight: 1.4 },
    { label: "40' High Cube (12024 × 2350 mm x 2697mm)", L: 12024, W: 2350, H: 2697, WeightLimit: 26460, costWeight: 1.5 },
    // { label: "45' High Cube (13556 × 2352 mm x 2700mm)", L: 13556, W: 2352, H: 2700, WeightLimit: 27700, costWeight: 1.8 },
    { label: "Custom size", L: null, W: null, H: null, WeightLimit: null, costWeight: 1.0 },
  ],

  
  //-------------------------------------------------
  // Group colors for carton groups
  // -------------------------------------------------

  GROUP_COLORS: [
    "#4a9eff", // blue
    "#f59e0b", // amber
    "#10b981", // green
    "#ef4444", // red
    "#8b5cf6", // purple
  ],

  // -------------------------------------------------
  // Orientation label mappings for 2D/3D drawing
  // -------------------------------------------------
  ORIENTATION_LABELS: {
    upright: { primary: "L", secondary: "W" },
    "upright-rotated": { primary: "W", secondary: "L" },
    "laid-side-l": { primary: "W", secondary: "H" },
    "laid-side-w": { primary: "L", secondary: "H" },
    "laid-h-l": { primary: "L", secondary: "H" },
    "laid-h-w": { primary: "H", secondary: "W" },
    mixed: { primary: "L", secondary: "W" },
  },

  // -------------------------------------------------
  // Color definitions for dimension labels
  // -------------------------------------------------
  DIMENSION_COLORS: {
    L: "#ef4444", // Red
    W: "#3b82f6", // Blue
    H: "#10b981", // Green
  },

  // -------------------------------------------------
  // Three.js visual constants
  // -------------------------------------------------
  THREE_CONFIG: {
    colors: {
      scene: 0xf5f5f5,
      ground: 0xe0e0e0,
      palletBase: 0x8b7355,
      heightGuide: 0x60a5fa,
      heightOutline: 0x3b82f6,
    },
    palletBaseHeight: 100,
  },
};
