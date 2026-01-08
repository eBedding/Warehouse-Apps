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
  // Base colors that get adjusted for each cycle
  // -------------------------------------------------

  BASE_GROUP_COLORS: [
    "#4a9eff", // blue
    "#f59e0b", // amber
    "#10b981", // green
    "#ef4444", // red
    "#8b5cf6", // purple
  ],

  // Legacy array for backwards compatibility (first 5 colors)
  GROUP_COLORS: [
    "#4a9eff", // blue
    "#f59e0b", // amber
    "#10b981", // green
    "#ef4444", // red
    "#8b5cf6", // purple
  ],

  // Generate a unique color for any group index
  // Each cycle adjusts the shade to create distinct but related colors
  getGroupColor: function(index) {
    const baseColors = this.BASE_GROUP_COLORS;
    const baseIndex = index % baseColors.length;
    const cycle = Math.floor(index / baseColors.length);

    if (cycle === 0) {
      return baseColors[baseIndex];
    }

    // Convert hex to HSL, adjust, and convert back
    const hex = baseColors[baseIndex];
    const hsl = hexToHSL(hex);

    // Adjust lightness and saturation based on cycle
    // Alternate between darker and lighter variants
    if (cycle % 2 === 1) {
      // Odd cycles: darker, slightly more saturated
      hsl.l = Math.max(25, hsl.l - (cycle * 8));
      hsl.s = Math.min(100, hsl.s + 5);
    } else {
      // Even cycles: lighter, slightly less saturated
      hsl.l = Math.min(75, hsl.l + (cycle * 6));
      hsl.s = Math.max(40, hsl.s - 10);
    }

    // Also shift hue slightly each cycle to add more variation
    hsl.h = (hsl.h + (cycle * 15)) % 360;

    return hslToHex(hsl.h, hsl.s, hsl.l);
  },

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

// -------------------------------------------------
// Color conversion helper functions
// -------------------------------------------------

function hexToHSL(hex) {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Parse hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
