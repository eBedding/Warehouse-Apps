// js/utils.js
// Shared utility functions for CartonApp

window.CartonApp = window.CartonApp || {};
window.CartonApp.Utils = {
  // -------------------------------------------------
  // Numeric input handler
  // -------------------------------------------------
  handleNumberInput: function (setter, obj, key, value) {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0) {
      setter({ ...obj, [key]: num });
    }
  },

  // -------------------------------------------------
  // Number formatting (adds commas, rounds)
  // -------------------------------------------------
  numberFmt: function (num) {
    if (num == null || isNaN(num)) return "0";
    return num.toLocaleString("en-GB");
  },

  // -------------------------------------------------
  // Visible dimension labels by orientation
  // -------------------------------------------------
  getVisibleLabels: function (pattern = "") {
    const labels = window.CartonApp.Constants.ORIENTATION_LABELS;
    const base = pattern.replace("mixed-", "");
    return labels[base] || labels.upright;
  },

  // -------------------------------------------------
  // Row-specific labels for mixed patterns
  // -------------------------------------------------
  getRowLabels: function (pattern, rotated) {
    const labels = window.CartonApp.Utils.getVisibleLabels(pattern);
    if (pattern.startsWith("mixed") && rotated) {
      return { primary: labels.secondary, secondary: labels.primary };
    }
    return labels;
  },

  // -------------------------------------------------
  // Compute total pallet weight
  // -------------------------------------------------
  computeTotalWeight: function (unitsPerCarton, cartonWeight, perLayer, layers) {
    const cartons = perLayer * layers;
    const totalWeight = cartons * cartonWeight;
    const totalUnits = cartons * unitsPerCarton;
    return { cartons, totalWeight, totalUnits };
  },

  // -------------------------------------------------
  // Percentage of pallet volume used
  // -------------------------------------------------
  computeVolumeUsage: function (usedVol, totalVol) {
    if (totalVol <= 0) return 0;
    return (usedVol / totalVol) * 100;
  },

  // -------------------------------------------------
  // URL Parameter utilities
  // -------------------------------------------------

  // Parse URL params into carton and pallet config
  parseUrlParams: function () {
    const params = new URLSearchParams(window.location.search);
    const result = {
      carton: null,
      pallet: null,
      preset: null,
      sku: null,
      weight: null,
      innersPerCarton: null,
    };

    // Product SKU — resolved against the catalogue once it has loaded
    const skuParam = params.get("sku");
    if (skuParam && skuParam.trim()) result.sku = skuParam.trim();

    // Weight / inners only appear when they diverge from the SKU's catalogue
    // values, so a link never shows different numbers to the recipient.
    const weightParam = params.get("weight");
    if (weightParam !== null) {
      const n = parseFloat(weightParam);
      if (!isNaN(n) && n >= 0) result.weight = n;
    }
    const innersParam = params.get("inners");
    if (innersParam !== null) {
      const n = parseInt(innersParam, 10);
      if (!isNaN(n) && n >= 0) result.innersPerCarton = n;
    }

    // Parse carton: "270x435x350" -> { l: 270, w: 435, h: 350 }
    const cartonParam = params.get("carton");
    if (cartonParam) {
      const parts = cartonParam.split("x").map(Number);
      if (parts.length === 3 && parts.every((n) => !isNaN(n) && n > 0)) {
        result.carton = { l: parts[0], w: parts[1], h: parts[2] };
      }
    }

    // Parse pallet preset OR custom dimensions
    const presetParam = params.get("preset");
    const palletParam = params.get("pallet");

    if (presetParam) {
      // Find matching preset by slug
      const presets = window.CartonApp.Constants.PALLET_SIZES;
      const preset = presets.find(
        (p) => window.CartonApp.Utils.toPresetSlug(p.label) === presetParam
      );
      if (preset && preset.L) {
        result.preset = presetParam;
        result.pallet = { L: preset.L, W: preset.W, H: preset.H };
      }
    } else if (palletParam) {
      // Parse custom pallet: "1000x1200x2000" -> { L: 1000, W: 1200, H: 2000 }
      const parts = palletParam.split("x").map(Number);
      if (parts.length === 3 && parts.every((n) => !isNaN(n) && n > 0)) {
        result.pallet = { L: parts[0], W: parts[1], H: parts[2] };
      }
    }

    return result;
  },

  // Update URL params without page reload
  updateUrlParams: function (carton, limits, selectedSku, product) {
    const params = new URLSearchParams();
    const Products = window.CartonApp.Products;

    // A link to an unmodified product carries the SKU alone — the dimensions
    // come from the catalogue on load. Explicit dimensions are written only
    // once they have been adjusted away from it, so the *presence* of a carton
    // param alongside a sku is what marks a link as carrying overrides.
    //
    // This matters when a URL is edited by hand: changing just the sku on a
    // clean product link leaves nothing to contradict the new product, so it
    // loads that product's real dimensions.
    const usingCatalogue =
      !!selectedSku && !!product && Products && !Products.isAdjusted(product, carton);

    if (!usingCatalogue && carton.l > 0 && carton.w > 0 && carton.h > 0) {
      params.set("carton", `${carton.l}x${carton.w}x${carton.h}`);
    }

    if (selectedSku) {
      params.set("sku", selectedSku);
      if (product && !usingCatalogue) {
        const cat = product.carton || {};
        if (Number(carton.weight) !== Number(cat.weight)) {
          params.set("weight", carton.weight);
        }
        if (
          Number(carton.innersPerCarton || 0) !==
          Number(product.innersPerCarton || 0)
        ) {
          params.set("inners", carton.innersPerCarton || 0);
        }
      }
    }

    // Add pallet - either preset slug or custom dimensions
    const presets = window.CartonApp.Constants.PALLET_SIZES;
    const matchedPreset = presets.find(
      (p) => p.L === limits.palletL && p.W === limits.palletW && p.H === limits.palletH
    );

    if (matchedPreset && matchedPreset.L !== null) {
      // Use preset slug
      params.set("preset", window.CartonApp.Utils.toPresetSlug(matchedPreset.label));
    } else if (limits.palletL > 0 && limits.palletW > 0 && limits.palletH > 0) {
      // Use custom dimensions
      params.set("pallet", `${limits.palletL}x${limits.palletW}x${limits.palletH}`);
    }

    // Update URL without reload
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;

    window.history.replaceState({}, "", newUrl);
  },

  // Human-readable age of an ISO timestamp, for catalogue freshness.
  // Returns null for anything unparseable rather than guessing.
  relativeAge: function (iso) {
    if (!iso) return null;
    const then = Date.parse(iso);
    if (isNaN(then)) return null;
    const mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 0) return { text: "just now", hours: 0 };
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    let text;
    if (mins < 2) text = "just now";
    else if (mins < 60) text = `${mins} minutes ago`;
    else if (hours < 2) text = "an hour ago";
    else if (hours < 24) text = `${hours} hours ago`;
    else if (days < 2) text = "yesterday";
    else text = `${days} days ago`;
    return { text, hours };
  },

  // Convert preset label to URL-friendly slug
  toPresetSlug: function (label) {
    if (!label) return "";
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  },
};
