// js/App.js
// Main Application Component

window.CartonApp = window.CartonApp || {};

window.CartonApp.MainApp = function () {
  const { useState, useMemo } = React;
  const { DEFAULT_VALUES, PALLET_SIZES } = window.CartonApp.Constants;
  const { handleNumberInput, numberFmt } = window.CartonApp.Utils;
  const { bestTile, packGroups, packMultipleContainers, recommendContainers } = window.CartonApp.Algorithms;
  const {
    InputSection,
    MetricCard,
    PalletSizeSelector,
    OptimizationDetails,
    NotesAndTips,
    PalletView3D,
  } = window.CartonApp.Components;

  // -------------------------------------------------
  // STATE
  // -------------------------------------------------
  const [carton, setCarton] = useState({
    ...DEFAULT_VALUES.carton,
    weight: 10.0,
    innersPerCarton: DEFAULT_VALUES.carton.innersPerCarton || 0,
  });

  const [cartonGroups, setCartonGroups] = useState([
    {
      id: Date.now(),
      name: "Group 1",
      l: 300,
      w: 300,
      h: 200,
      qty: 10,
      weight: 10.0,
      innersPerBox: 0,
      color: "#4a9eff",
      allowVerticalFlip: true, // Allow cartons to be laid on their side
    },
  ]);

  const [limits, setLimits] = useState(DEFAULT_VALUES.limits);
  const [allowVerticalFlip, setAllowVerticalFlip] = useState(true);

  // -------------------------------------------------
  // MULTI-CONTAINER STATE
  // -------------------------------------------------
  const [containers, setContainers] = useState([
    {
      id: Date.now(),
      type: "20' Standard (5895 × 2350 mm x 2392mm)",
      L: 5895,
      W: 2350,
      H: 2392,
      weightLimit: 28000,
      allowedGroups: [], // Empty array = allow all groups (default behavior)
    },
  ]);
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [spreadAcrossContainers, setSpreadAcrossContainers] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importError, setImportError] = useState("");

  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportJsonText, setExportJsonText] = useState("");
  const [exportCopied, setExportCopied] = useState(false);

  // View display mode: 'paginated' shows one container at a time, 'stacked' shows all in a column
  const [displayMode, setDisplayMode] = useState("paginated");

  const multiMode =
    Array.isArray(cartonGroups) &&
    cartonGroups.some((g) => (Number(g.qty) || 0) > 0);

  // Apply wait cursor when processing heavy operations
  React.useEffect(() => {
    if (isProcessing || isRecommending) {
      document.body.style.cursor = 'wait';
      // Apply to all interactive elements
      const style = document.createElement('style');
      style.id = 'processing-cursor-style';
      style.textContent = '* { cursor: wait !important; }';
      document.head.appendChild(style);
    } else {
      document.body.style.cursor = '';
      const style = document.getElementById('processing-cursor-style');
      if (style) style.remove();
    }

    return () => {
      document.body.style.cursor = '';
      const style = document.getElementById('processing-cursor-style');
      if (style) style.remove();
    };
  }, [isProcessing, isRecommending]);

  // -------------------------------------------------
  // COMPUTATIONS
  // -------------------------------------------------
  // Get active container dimensions
  const activeContainer = containers[activeContainerIndex] || containers[0];
  const containerLimits = {
    palletL: activeContainer.L,
    palletW: activeContainer.W,
    palletH: activeContainer.H,
    palletGrossMax: activeContainer.weightLimit,
    cartonGrossMax: limits.cartonGrossMax,
    desiredCartons: limits.desiredCartons,
  };

  const cartonWeight = carton.weight || 0;
  const overweight =
    containerLimits.cartonGrossMax && cartonWeight > containerLimits.cartonGrossMax;

  const palletTile = useMemo(
    () =>
      bestTile(
        carton.l,
        carton.w,
        carton.h,
        containerLimits.palletL,
        containerLimits.palletW,
        containerLimits.palletH,
        allowVerticalFlip
      ),
    [carton, containerLimits.palletL, containerLimits.palletW, containerLimits.palletH, allowVerticalFlip]
  );

  // Multi-container packing: pack groups across all containers
  // NOTE: cartonGroups is intentionally NOT in the dependency array to prevent
  // recalculation on every dimension/quantity/weight change (performance optimization)
  // Recalculation only happens when containers change or user clicks "Recommend Containers"
  const multiContainerPacking = useMemo(
    () =>
      multiMode && containers.length > 0
        ? packMultipleContainers(cartonGroups, containers, allowVerticalFlip, spreadAcrossContainers)
        : null,
    [multiMode, containers, allowVerticalFlip, spreadAcrossContainers]
  );

  // Get packing result for the active container
  const multiPack = multiContainerPacking
    ? multiContainerPacking[activeContainerIndex] || null
    : null;

  // IMPORTANT: In multi-mode, ALWAYS use multiPack (even if empty)
  // This prevents fallback to single-carton bestTile calculations
  const isMultiActive = !!multiPack;

  // Decide which packing drives the visuals & metrics
  const drivingTile = isMultiActive ? multiPack : palletTile;

  // Expose current tile globally for 2D view awareness
  window.CartonApp.lastTile = drivingTile;

  const singleLayers = palletTile.layers || 0;
  const singleCartonsPerPallet = palletTile.perLayer * singleLayers;

  let palletLayers = isMultiActive ? multiPack.totalLayers || 0 : singleLayers;
  let cartonsPerPallet = isMultiActive
    ? multiPack.totalCartons || 0
    : singleCartonsPerPallet;

  let effectiveCartons = cartonsPerPallet;
  let desiredTooHigh = false;

  if (!isMultiActive) {
    const desired = Number(limits.desiredCartons);
    if (Number.isFinite(desired) && desired > 0) {
      if (desired > cartonsPerPallet) {
        effectiveCartons = cartonsPerPallet;
        desiredTooHigh = true;
      } else {
        effectiveCartons = desired;
      }
    }
  }

  // Calculate weight based on mode
  let palletWeight = 0;
  if (isMultiActive && multiPack && multiPack.groups) {
    // Multi-carton mode: sum up weight from all placed boxes
    palletWeight = multiPack.groups.reduce((total, group) => {
      const groupWeight = Number(group.weight) || 0;
      const placedQty = Number(group.placedQty) || 0;
      return total + (groupWeight * placedQty);
    }, 0);
  } else {
    // Single-carton mode
    palletWeight = effectiveCartons * cartonWeight;
  }

  const palletOverweight =
    containerLimits.palletGrossMax && palletWeight > containerLimits.palletGrossMax;

  // -------------------------------------------------
  // GROUP HANDLERS
  // -------------------------------------------------
  function addGroup() {
    const newIndex = cartonGroups.length;
    setCartonGroups([
      ...cartonGroups,
      {
        id: Date.now() + newIndex,
        name: `Group ${newIndex + 1}`,
        l: 300,
        w: 300,
        h: 200,
        qty: 10,
        weight: 10.0,
        innersPerBox: 0,
        color: window.CartonApp.Constants.getGroupColor(newIndex),
        allowVerticalFlip: true,
      },
    ]);
  }

  function updateGroup(id, field, value) {
    setIsProcessing(true);
    setTimeout(() => {
      setCartonGroups((groups) =>
        groups.map((g) => {
          if (g.id !== id) return g;
          // Handle different field types
          let newValue = value;
          if (field === "name") {
            newValue = value; // Keep as string
          } else if (field === "allowVerticalFlip") {
            newValue = Boolean(value); // Keep as boolean
          } else {
            newValue = Number(value); // Convert to number
          }
          return { ...g, [field]: newValue };
        })
      );
      setIsProcessing(false);
    }, 10);
  }

  function removeGroup(id) {
    setCartonGroups((groups) => groups.filter((g) => g.id !== id));
  }

  // -------------------------------------------------
  // CONTAINER HANDLERS
  // -------------------------------------------------
  function addContainer() {
    const newContainer = {
      id: Date.now(),
      type: "20' Standard (5895 × 2350 mm x 2392mm)",
      L: 5895,
      W: 2350,
      H: 2392,
      weightLimit: 28000,
      allowedGroups: [], // Empty array = allow all groups (default behavior)
    };
    setContainers([...containers, newContainer]);
  }

  function updateContainer(index, field, value) {
    setIsProcessing(true);
    setTimeout(() => {
      setContainers((ctrs) =>
        ctrs.map((c, i) => {
          if (i !== index) return c;
          if (field === "type") {
            // When type changes, update all dimensions from preset
            const preset = PALLET_SIZES.find((p) => p.label === value);
            if (preset && preset.L && preset.W && preset.H) {
              return {
                ...c,
                type: value,
                L: preset.L,
                W: preset.W,
                H: preset.H,
                weightLimit: preset.WeightLimit || c.weightLimit,
              };
            }
          }
          return { ...c, [field]: value };
        })
      );
      setIsProcessing(false);
    }, 10);
  }

  function removeContainer(index) {
    if (containers.length <= 1) return; // Keep at least one container
    setIsProcessing(true);
    setTimeout(() => {
      setContainers((ctrs) => ctrs.filter((_, i) => i !== index));
      // Adjust active index if needed
      if (activeContainerIndex >= containers.length - 1) {
        setActiveContainerIndex(Math.max(0, containers.length - 2));
      }
      setIsProcessing(false);
    }, 10);
  }

  function updateContainerGroups(index, selectedGroupIds) {
    setIsProcessing(true);
    setTimeout(() => {
      setContainers((ctrs) =>
        ctrs.map((c, i) =>
          i === index ? { ...c, allowedGroups: selectedGroupIds } : c
        )
      );
      setIsProcessing(false);
    }, 10);
  }

  function handleRecommendContainers() {
    setIsRecommending(true);

    // Use setTimeout to allow UI to update with loading state before heavy computation
    setTimeout(() => {
      const recommended = recommendContainers(cartonGroups, PALLET_SIZES, allowVerticalFlip);
      if (recommended.length > 0) {
        setContainers(recommended);
        setActiveContainerIndex(0);
        setSpreadAcrossContainers(false); // Reset to sequential mode
      }
      setIsRecommending(false);
    }, 50);
  }

  function handleExportSpreadsheet() {
    if (!multiContainerPacking || multiContainerPacking.length === 0) return;

    // CSV header
    const headers = [
      "Containers",
      "Cubic Volume Used (m3)",
      "CBM %",
      "Total Cartons",
      "Total Inners",
      "Groups",
      "Length (mm)",
      "Width (mm)",
      "Height (mm)",
      "Quantity",
      "Weight (kg)",
      "Inners per box"
    ];

    const rows = [headers.join(",")];

    // Process each container
    multiContainerPacking.forEach((packResult, containerIndex) => {
      const container = containers[containerIndex];
      if (!container) return;

      // Calculate container stats
      const containerVolume = (container.L * container.W * container.H) / 1e9; // Convert mm³ to m³
      const usedVolume = packResult.groups
        ? packResult.groups.reduce((sum, g) => {
            const groupVolume = (g.l * g.w * g.h * (g.placedQty || 0)) / 1e9;
            return sum + groupVolume;
          }, 0)
        : 0;
      const cbmPercent = containerVolume > 0 ? ((usedVolume / containerVolume) * 100).toFixed(2) : 0;
      const totalCartons = packResult.totalCartons || 0;
      const totalInners = packResult.groups
        ? packResult.groups.reduce((sum, packGroup) => {
            const originalGroup = cartonGroups.find(g => g.id === packGroup.id);
            const innersPerBox = originalGroup ? (originalGroup.innersPerBox || 0) : 0;
            return sum + ((packGroup.placedQty || 0) * innersPerBox);
          }, 0)
        : 0;

      // Get container name from type
      const containerName = container.type || `Container ${containerIndex + 1}`;

      // Get groups in this container
      const groupsInContainer = packResult.groups || [];

      if (groupsInContainer.length === 0) {
        // Container with no groups
        rows.push([
          `"${containerName}"`,
          usedVolume.toFixed(2),
          `${cbmPercent}%`,
          totalCartons,
          totalInners,
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        ].join(","));
      } else {
        // Filter out groups with 0 placed quantity
        const nonZeroGroups = groupsInContainer.filter(g => (g.placedQty || 0) > 0);

        if (nonZeroGroups.length === 0) {
          // Container has groups but all have 0 quantity - show container row only
          rows.push([
            `"${containerName}"`,
            usedVolume.toFixed(2),
            `${cbmPercent}%`,
            totalCartons,
            totalInners,
            "",
            "",
            "",
            "",
            "",
            "",
            ""
          ].join(","));
        } else {
          // First group row includes container info
          nonZeroGroups.forEach((packGroup, groupIndex) => {
            const originalGroup = cartonGroups.find(g => g.id === packGroup.id);
            const groupName = originalGroup ? originalGroup.name : `Group ${groupIndex + 1}`;
            const innersPerBox = originalGroup ? (originalGroup.innersPerBox || 0) : 0;
            const weight = originalGroup ? (originalGroup.weight || 0) : 0;

            if (groupIndex === 0) {
              // First row: include container info
              rows.push([
                `"${containerName}"`,
                usedVolume.toFixed(2),
                `${cbmPercent}%`,
                totalCartons,
                totalInners,
                `"${groupName}"`,
                packGroup.l || 0,
                packGroup.w || 0,
                packGroup.h || 0,
                packGroup.placedQty || 0,
                weight,
                innersPerBox
              ].join(","));
            } else {
              // Subsequent rows: leave container columns empty
              rows.push([
                "",
                "",
                "",
                "",
                "",
                `"${groupName}"`,
                packGroup.l || 0,
                packGroup.w || 0,
                packGroup.h || 0,
                packGroup.placedQty || 0,
                weight,
                innersPerBox
              ].join(","));
            }
          });
        }
      }
    });

    // Create and download CSV
    const csvContent = "\uFEFF" + rows.join("\n"); // BOM for Excel UTF-8 compatibility
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `container-packing-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleExportJSON() {
    const exportData = {
      exportDate: new Date().toISOString(),
      version: "1.0",
      groups: cartonGroups.map(g => ({
        name: g.name,
        dimensions: {
          length: g.l,
          width: g.w,
          height: g.h
        },
        quantity: g.qty,
        weight: g.weight,
        innersPerBox: g.innersPerBox || 0,
        color: g.color,
        allowVerticalFlip: g.allowVerticalFlip !== false
      })),
      containers: containers.map(c => ({
        type: c.type,
        dimensions: {
          length: c.L,
          width: c.W,
          height: c.H
        },
        weightLimit: c.weightLimit,
        restrictedToGroups: c.allowedGroups && c.allowedGroups.length > 0
          ? c.allowedGroups.map(groupId => {
              const group = cartonGroups.find(g => g.id === groupId);
              return group ? group.name : null;
            }).filter(Boolean)
          : [] // Empty array means all groups allowed
      })),
      settings: {
        allowVerticalFlip: allowVerticalFlip,
        spreadAcrossContainers: spreadAcrossContainers
      }
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    setExportJsonText(jsonContent);
    setExportCopied(false);
    setShowExportModal(true);
  }

  function handleCopyExport() {
    navigator.clipboard.writeText(exportJsonText).then(() => {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    });
  }

  function handleImportJSON() {
    setImportError("");

    if (!importJsonText.trim()) {
      setImportError("Please paste JSON configuration data.");
      return;
    }

    try {
      const data = JSON.parse(importJsonText);

      // Validate structure
      if (!data.groups || !Array.isArray(data.groups)) {
        setImportError("Invalid format: missing 'groups' array.");
        return;
      }
      if (!data.containers || !Array.isArray(data.containers)) {
        setImportError("Invalid format: missing 'containers' array.");
        return;
      }

      // Import groups
      const newGroups = data.groups.map((g, index) => ({
        id: Date.now() + index,
        name: g.name || `Group ${index + 1}`,
        l: g.dimensions?.length || 300,
        w: g.dimensions?.width || 300,
        h: g.dimensions?.height || 200,
        qty: g.quantity || 0,
        weight: g.weight || 0,
        innersPerBox: g.innersPerBox || 0,
        color: g.color || window.CartonApp.Constants.getGroupColor(index),
        allowVerticalFlip: g.allowVerticalFlip !== false, // Default to true if not specified
      }));

      // Import containers (need to map group names to new IDs)
      const newContainers = data.containers.map((c, index) => {
        // Map group names back to IDs
        let allowedGroups = [];
        if (c.restrictedToGroups && Array.isArray(c.restrictedToGroups) && c.restrictedToGroups.length > 0) {
          allowedGroups = c.restrictedToGroups
            .map(groupName => {
              const groupIndex = newGroups.findIndex(g => g.name === groupName);
              return groupIndex >= 0 ? newGroups[groupIndex].id : null;
            })
            .filter(id => id !== null);
        }

        return {
          id: Date.now() + 1000 + index,
          type: c.type || "20' Standard (5895 × 2350 mm x 2392mm)",
          L: c.dimensions?.length || 5895,
          W: c.dimensions?.width || 2350,
          H: c.dimensions?.height || 2392,
          weightLimit: c.weightLimit || 28000,
          allowedGroups: allowedGroups,
        };
      });

      // Import settings
      if (data.settings) {
        if (typeof data.settings.allowVerticalFlip === "boolean") {
          setAllowVerticalFlip(data.settings.allowVerticalFlip);
        }
        if (typeof data.settings.spreadAcrossContainers === "boolean") {
          setSpreadAcrossContainers(data.settings.spreadAcrossContainers);
        }
      }

      // Apply imported data
      setCartonGroups(newGroups);
      setContainers(newContainers);
      setActiveContainerIndex(0);

      // Close modal and reset
      setShowImportModal(false);
      setImportJsonText("");
      setImportError("");

    } catch (e) {
      setImportError(`Parse error: ${e.message}`);
    }
  }

  // Helper function to generate JSON config string (used by export and report problem)
  function getJsonConfigString() {
    const exportData = {
      exportDate: new Date().toISOString(),
      version: "1.0",
      groups: cartonGroups.map(g => ({
        name: g.name,
        dimensions: {
          length: g.l,
          width: g.w,
          height: g.h
        },
        quantity: g.qty,
        weight: g.weight,
        innersPerBox: g.innersPerBox || 0,
        color: g.color,
        allowVerticalFlip: g.allowVerticalFlip !== false
      })),
      containers: containers.map(c => ({
        type: c.type,
        dimensions: {
          length: c.L,
          width: c.W,
          height: c.H
        },
        weightLimit: c.weightLimit,
        restrictedToGroups: c.allowedGroups && c.allowedGroups.length > 0
          ? c.allowedGroups.map(groupId => {
              const group = cartonGroups.find(g => g.id === groupId);
              return group ? group.name : null;
            }).filter(Boolean)
          : []
      })),
      settings: {
        allowVerticalFlip: allowVerticalFlip,
        spreadAcrossContainers: spreadAcrossContainers
      }
    };
    return JSON.stringify(exportData, null, 2);
  }

  // -------------------------------------------------
  // RENDER
  // -------------------------------------------------
  return React.createElement(
    "div",
    { className: "min-h-screen" },

    // Navigation Bar
    React.createElement(
      "nav",
      { className: "bg-teal-700 text-white" },
      React.createElement(
        "div",
        { className: "mx-auto px-4 sm:px-6 lg:px-8" },
        React.createElement(
          "div",
          { className: "flex items-center justify-between h-14" },
          // Logo / Brand
          React.createElement(
            "div",
            { className: "flex items-center gap-2" },
            React.createElement(
              "span",
              { className: "font-semibold text-lg" },
              "Shipping Container - Planner & Visualizer"
            )
          ),
          // Nav Links
          React.createElement(
            "div",
            { className: "flex items-center gap-2" },
            React.createElement(
              "a",
              {
                href: "https://tools.e-bedding.co.uk/pallets",
                className: "px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
              },
              "Pallets"
            ),
            React.createElement(
              "a",
              {
                href: "https://tools.e-bedding.co.uk/containers",
                className: "px-4 py-2 rounded-lg text-sm font-medium bg-teal-500 hover:bg-teal-600 transition-colors"
              },
              "Containers"
            ),
            // Divider
            React.createElement("div", {
              className: "h-6 w-px bg-teal-500 mx-2"
            }),
            // Report Problem button
            React.createElement(window.CartonApp.Components.ReportProblem, {
              getJsonConfig: getJsonConfigString
            })
          )
        )
      )
    ),

    // Main Content
    React.createElement(
      "div",
      { className: "p-6 space-y-6" },
      // Header
      React.createElement(
        "header",
        { className: "flex items-center justify-between" },
        React.createElement(
          "div",
          { className: "text-sm text-blue-600" },
          "All dimensions in ",
          React.createElement("b", {}, "mm"),
          " and weights in ",
          React.createElement("b", {}, "kg"),
          "."
        ),
        // Display mode toggle (only show when multiple containers)
        containers.length > 1 && React.createElement(
          "div",
          { className: "flex items-center gap-2 bg-gray-100 rounded-lg p-1" },
          React.createElement(
            "button",
            {
              onClick: () => setDisplayMode("paginated"),
              className: `px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${
                displayMode === "paginated"
                  ? "bg-white text-gray-900 shadow-sm font-medium"
                  : "text-gray-600 hover:text-gray-900"
              }`,
            },
            React.createElement(
              "svg",
              { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" },
              React.createElement("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "2",
                d: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              })
            ),
            "Paginated"
          ),
          React.createElement(
            "button",
            {
              onClick: () => setDisplayMode("stacked"),
              className: `px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${
                displayMode === "stacked"
                  ? "bg-white text-gray-900 shadow-sm font-medium"
                  : "text-gray-600 hover:text-gray-900"
              }`,
            },
            React.createElement(
              "svg",
              { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" },
              React.createElement("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "2",
                d: "M4 6h16M4 10h16M4 14h16M4 18h16"
              })
            ),
            "Show All"
          )
        )
      ),

    // Main Layout
    React.createElement(
      "div",
      { className: "grid grid-cols-1 lg:grid-cols-3 gap-6" },

      // -----------------------
      // INPUT PANEL
      // -----------------------
      React.createElement(
        "div",
        { className: "lg:col-span-1 space-y-4" },

        // ---------------------------
        // MULTIPLE CARTON GROUPS
        // ---------------------------
        React.createElement(
          "section",
          { className: "p-4 border rounded-2xl shadow-sm bg-white space-y-4" },

          React.createElement(
            "div",
            { className: "flex items-center justify-between" },
            React.createElement(
              "h3",
              { className: "font-semibold" },
              "Carton Groups"
            ),
            React.createElement(
              "button",
              {
                className:
                  "px-3 py-1 bg-teal-500 text-white rounded-lg text-sm hover:bg-teal-600",
                onClick: addGroup,
              },
              "+ Add Group"
            )
          ),

          ...cartonGroups.map((g) =>
            React.createElement(
              "div",
              {
                key: g.id,
                className:
                  "p-3 border rounded-xl bg-gray-50 flex flex-col gap-2 relative",
              },

              // Delete button
              React.createElement(
                "button",
                {
                  onClick: () => removeGroup(g.id),
                  className:
                    "absolute top-2 right-2 text-red-600 text-xs hover:underline",
                },
                "Remove"
              ),

              // Group name + colour
              React.createElement(
                "div",
                { className: "flex items-center gap-2" },
                React.createElement("div", {
                  className: "w-4 h-4 rounded-sm border",
                  style: { backgroundColor: g.color },
                }),
                React.createElement("input", {
                  type: "text",
                  value: g.name,
                  onChange: (e) => updateGroup(g.id, "name", e.target.value),
                  className: "border rounded px-2 py-1 text-sm w-40",
                })
              ),

              // Dimensions row
              React.createElement(
                "div",
                { className: "grid grid-cols-3 gap-2" },
                ["l", "w", "h"].map((field) =>
                  React.createElement(
                    "label",
                    { key: field, className: "text-xs text-gray-700" },
                    field.toUpperCase(),
                    React.createElement("input", {
                      type: "number",
                      min: 1,
                      value: g[field],
                      onChange: (e) =>
                        updateGroup(g.id, field, Number(e.target.value)),
                      className: "border rounded px-2 py-1 w-full text-sm",
                    })
                  )
                )
              ),

              // Quantity, Weight, and Inners row
              React.createElement(
                "div",
                { className: "grid grid-cols-3 gap-2" },
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700" },
                  "Quantity",
                  React.createElement("input", {
                    type: "number",
                    min: 0,
                    value: g.qty,
                    onChange: (e) =>
                      updateGroup(g.id, "qty", Number(e.target.value)),
                    className: "border rounded px-2 py-1 w-full text-sm",
                  })
                ),
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700" },
                  "Weight (kg)",
                  React.createElement("input", {
                    type: "number",
                    min: 0,
                    step: 0.1,
                    value: g.weight || 0,
                    onChange: (e) =>
                      updateGroup(g.id, "weight", Number(e.target.value)),
                    className: "border rounded px-2 py-1 w-full text-sm",
                  })
                ),
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700" },
                  "Inners per box",
                  React.createElement("input", {
                    type: "number",
                    min: 0,
                    value: g.innersPerBox || 0,
                    onChange: (e) =>
                      updateGroup(g.id, "innersPerBox", Number(e.target.value)),
                    className: "border rounded px-2 py-1 w-full text-sm",
                  })
                )
              ),

              // Allow vertical flip checkbox
              React.createElement(
                "label",
                { className: "flex items-center gap-2 text-xs text-gray-700 mt-2 cursor-pointer" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: g.allowVerticalFlip !== false, // Default to true if undefined
                  onChange: (e) =>
                    updateGroup(g.id, "allowVerticalFlip", e.target.checked),
                  className: "w-3.5 h-3.5 cursor-pointer",
                }),
                React.createElement(
                  "span",
                  { className: g.allowVerticalFlip !== false ? "text-gray-700" : "text-orange-600" },
                  "Allow cartons to be laid on their side"
                )
              )
            )
          ),

          React.createElement(
            "p",
            { className: "text-xs text-blue-700 mt-1" },
            "Multi-group packing active when at least one group has quantity > 0. 3D view will show mixed groups."
          )
        ),

        // ---------------------------
        // CONTAINER CONFIGURATION
        // ---------------------------
        React.createElement(
          "section",
          { className: "p-4 border rounded-2xl shadow-sm bg-white space-y-4" },

          React.createElement(
            "div",
            { className: "flex items-center justify-between" },
            React.createElement(
              "h3",
              { className: "font-semibold" },
              "Containers"
            ),
            React.createElement(
              "div",
              { className: "flex gap-2" },
              React.createElement(
                "button",
                {
                  className:
                    "px-3 py-1 bg-teal-500 text-white rounded-lg text-sm hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2",
                  onClick: handleRecommendContainers,
                  disabled: isRecommending,
                },
                isRecommending && React.createElement(
                  "svg",
                  {
                    className: "animate-spin h-4 w-4",
                    xmlns: "http://www.w3.org/2000/svg",
                    fill: "none",
                    viewBox: "0 0 24 24"
                  },
                  React.createElement("circle", {
                    className: "opacity-25",
                    cx: "12",
                    cy: "12",
                    r: "10",
                    stroke: "currentColor",
                    strokeWidth: "4"
                  }),
                  React.createElement("path", {
                    className: "opacity-75",
                    fill: "currentColor",
                    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  })
                ),
                isRecommending ? "Calculating..." : "Recommend Containers"
              ),
              React.createElement(
                "button",
                {
                  className:
                    "px-3 py-1 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-700",
                  onClick: addContainer,
                },
                "+ Add Container"
              )
            )
          ),

          ...containers.map((container, index) =>
            React.createElement(
              "div",
              {
                key: container.id,
                className: `p-3 border rounded-xl ${
                  index === activeContainerIndex
                    ? "bg-blue-50 border-blue-400"
                    : "bg-gray-50"
                } flex flex-col gap-2 relative`,
              },

              // Delete button (only if more than 1 container)
              containers.length > 1 &&
                React.createElement(
                  "button",
                  {
                    onClick: () => removeContainer(index),
                    className:
                      "absolute top-2 right-2 text-red-600 text-xs hover:underline",
                  },
                  "Remove"
                ),

              // Container header with number
              React.createElement(
                "div",
                { className: "flex items-center gap-2" },
                React.createElement(
                  "span",
                  { className: "font-semibold text-sm" },
                  `Container ${index + 1}`
                ),
                index === activeContainerIndex &&
                  React.createElement(
                    "span",
                    { className: "text-xs text-blue-600 font-medium" },
                    "(Currently viewing)"
                  )
              ),

              // Container type selector
              React.createElement(
                "label",
                { className: "text-xs text-gray-700" },
                "Type",
                React.createElement(
                  "select",
                  {
                    className: "border rounded px-2 py-1 w-full text-sm mt-1",
                    value: container.type,
                    onChange: (e) =>
                      updateContainer(index, "type", e.target.value),
                  },
                  ...PALLET_SIZES.map((p) =>
                    React.createElement(
                      "option",
                      { key: p.label, value: p.label },
                      p.label
                    )
                  )
                )
              ),

              // Manual dimension inputs
              React.createElement(
                "div",
                { className: "grid grid-cols-2 gap-2 mt-2" },
                // Length
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700" },
                  "Length (mm)",
                  React.createElement("input", {
                    type: "number",
                    min: 0,
                    step: 1,
                    value: container.L || "",
                    onChange: (e) =>
                      updateContainer(index, "L", parseFloat(e.target.value) || 0),
                    className: "border rounded px-2 py-1 w-full text-sm mt-1",
                  })
                ),
                // Width
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700" },
                  "Width (mm)",
                  React.createElement("input", {
                    type: "number",
                    min: 0,
                    step: 1,
                    value: container.W || "",
                    onChange: (e) =>
                      updateContainer(index, "W", parseFloat(e.target.value) || 0),
                    className: "border rounded px-2 py-1 w-full text-sm mt-1",
                  })
                ),
                // Height
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700" },
                  "Height (mm)",
                  React.createElement("input", {
                    type: "number",
                    min: 0,
                    step: 1,
                    value: container.H || "",
                    onChange: (e) =>
                      updateContainer(index, "H", parseFloat(e.target.value) || 0),
                    className: "border rounded px-2 py-1 w-full text-sm mt-1",
                  })
                ),
                // Weight Limit
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700" },
                  "Weight Limit (kg)",
                  React.createElement("input", {
                    type: "number",
                    min: 0,
                    step: 0.01,
                    value: container.weightLimit || "",
                    onChange: (e) =>
                      updateContainer(index, "weightLimit", parseFloat(e.target.value) || 0),
                    className: "border rounded px-2 py-1 w-full text-sm mt-1",
                  })
                )
              ),

              // Allowed Groups Multi-select (full width, after grid)
              React.createElement(
                "div",
                { className: "mt-2" },
                React.createElement(
                  "label",
                  { className: "text-xs text-gray-700 block mb-1" },
                  "Restrict to Groups (leave empty for all)"
                ),
                React.createElement(
                  "div",
                  { className: "border rounded px-2 py-2 bg-gray-50 space-y-1 max-h-24 overflow-y-auto" },
                  cartonGroups.length === 0
                    ? React.createElement(
                        "div",
                        { className: "text-xs text-gray-500 italic" },
                        "No groups available"
                      )
                    : cartonGroups.map((group) =>
                        React.createElement(
                          "label",
                          {
                            key: group.id,
                            className: "flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded"
                          },
                          React.createElement("input", {
                            type: "checkbox",
                            checked: (container.allowedGroups || []).includes(group.id),
                            onChange: (e) => {
                              const currentGroups = container.allowedGroups || [];
                              const newGroups = e.target.checked
                                ? [...currentGroups, group.id]
                                : currentGroups.filter(id => id !== group.id);
                              updateContainerGroups(index, newGroups);
                            },
                            className: "w-3 h-3 cursor-pointer"
                          }),
                          React.createElement(
                            "span",
                            { className: "flex items-center gap-1.5" },
                            React.createElement("div", {
                              className: "w-2 h-2 rounded-sm",
                              style: { backgroundColor: group.color }
                            }),
                            group.name
                          )
                        )
                      )
                )
              ),

              // View button
              React.createElement(
                "button",
                {
                  className: `px-3 py-1 rounded-lg text-sm ${
                    index === activeContainerIndex
                      ? "bg-teal-500 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`,
                  onClick: () => setActiveContainerIndex(index),
                },
                index === activeContainerIndex ? "Viewing" : "View This Container"
              )
            )
          ),

          // Multi-container summary (only show if multiple containers and packing is active)
          containers.length > 1 && multiContainerPacking && React.createElement(
            "div",
            { className: "p-3 bg-blue-50 border border-blue-200 rounded-xl" },
            React.createElement(
              "h4",
              { className: "text-sm font-semibold text-blue-900 mb-2" },
              "Multi-Container Summary"
            ),
            React.createElement(
              "div",
              { className: "text-xs space-y-1" },
              // Total cartons placed across all containers
              React.createElement(
                "div",
                { className: "flex justify-between" },
                React.createElement("span", { className: "text-gray-700" }, "Total cartons placed:"),
                React.createElement(
                  "span",
                  { className: "font-semibold text-blue-900" },
                  multiContainerPacking.reduce((sum, c) => sum + (c.totalCartons || 0), 0)
                )
              ),
              // Total weight across all containers
              React.createElement(
                "div",
                { className: "flex justify-between" },
                React.createElement("span", { className: "text-gray-700" }, "Total weight:"),
                React.createElement(
                  "span",
                  { className: "font-semibold text-blue-900" },
                  `${multiContainerPacking.reduce((sum, c) => sum + (c.totalWeight || 0), 0).toFixed(1)} kg`
                )
              ),
              // Containers used
              React.createElement(
                "div",
                { className: "flex justify-between" },
                React.createElement("span", { className: "text-gray-700" }, "Containers with cartons:"),
                React.createElement(
                  "span",
                  { className: "font-semibold text-blue-900" },
                  `${multiContainerPacking.filter(c => (c.totalCartons || 0) > 0).length} of ${containers.length}`
                )
              ),
              // Breakdown by container
              React.createElement(
                "div",
                { className: "mt-2 pt-2 border-t border-blue-200" },
                React.createElement("div", { className: "font-medium text-gray-700 mb-1" }, "Per container:"),
                multiContainerPacking.map((packResult, idx) =>
                  React.createElement(
                    "div",
                    { key: idx, className: "flex justify-between text-gray-600 ml-2" },
                    React.createElement("span", null, `Container ${idx + 1}:`),
                    React.createElement(
                      "span",
                      null,
                      `${packResult.totalCartons || 0} cartons (${(packResult.totalWeight || 0).toFixed(1)} kg)`
                    )
                  )
                )
              )
            )
          ),

          // Spread across containers checkbox (only show if multiple containers)
          containers.length > 1 && React.createElement(
            "label",
            { className: "flex items-center gap-2 text-sm cursor-pointer" },
            React.createElement("input", {
              type: "checkbox",
              checked: spreadAcrossContainers,
              onChange: (e) => setSpreadAcrossContainers(e.target.checked),
              className: "w-4 h-4 cursor-pointer",
            }),
            React.createElement(
              "span",
              { className: "text-gray-700" },
              "Force spread cartons evenly across all containers"
            )
          ),

          React.createElement(
            "p",
            { className: "text-xs text-gray-600 mt-1" },
            spreadAcrossContainers && containers.length > 1
              ? "Cartons will be distributed evenly across all containers (not sequential fill)."
              : "Add multiple containers to distribute your carton groups across several shipments."
          )
        ),

        // TOTAL WEIGHT
        React.createElement(
          "div",
          {
            className: `mt-2 text-sm px-4 ${
              palletOverweight
                ? "text-red-600 font-semibold"
                : "text-gray-600"
            }`,
          },
          palletOverweight
            ? `⚠️ Total container weight ${palletWeight.toFixed(
                2
              )} kg exceeds ${containerLimits.palletGrossMax} kg limit!`
            : `Total container weight: ${palletWeight.toFixed(2)} kg`
        )
      ),

      // -----------------------
      // VISUALIZATION PANEL
      // -----------------------
      React.createElement(
        "div",
        { className: "lg:col-span-2 space-y-4" },

        // Paginated view (single container at a time)
        displayMode === "paginated" && React.createElement(window.CartonApp.Components.PalletView3D, {
          palletL: containerLimits.palletL,
          palletW: containerLimits.palletW,
          palletH: containerLimits.palletH,
          cartonL: palletTile.boxL,
          cartonW: palletTile.boxW,
          cartonH: palletTile.boxH,
          pattern: palletTile.pattern,
          perLayer: palletTile.perLayer,
          layers: palletLayers,
          patternRows: palletTile.patternRows,
          palletTile,
          cartonWeight,
          effectiveCartons,
          multiTile: isMultiActive ? multiPack : null,
          activeContainerIndex: activeContainerIndex,
          totalContainers: containers.length,
          onContainerChange: setActiveContainerIndex,
          totalInners: isMultiActive && multiPack && multiPack.groups
            ? multiPack.groups.reduce((total, packGroup) => {
                const originalGroup = cartonGroups.find(g => g.id === packGroup.id);
                const innersPerBox = originalGroup ? (originalGroup.innersPerBox || 0) : 0;
                const placedQty = packGroup.placedQty || 0;
                return total + (placedQty * innersPerBox);
              }, 0)
            : 0,
        }),

        // Stacked view (all containers in a column)
        displayMode === "stacked" && React.createElement(
          "div",
          { className: "space-y-6" },
          ...containers.map((container, idx) => {
            const packResult = multiContainerPacking ? multiContainerPacking[idx] : null;
            const containerWeight = packResult && packResult.groups
              ? packResult.groups.reduce((total, group) => {
                  const groupWeight = Number(group.weight) || 0;
                  const placedQty = Number(group.placedQty) || 0;
                  return total + (groupWeight * placedQty);
                }, 0)
              : 0;
            const containerInners = packResult && packResult.groups
              ? packResult.groups.reduce((total, packGroup) => {
                  const originalGroup = cartonGroups.find(g => g.id === packGroup.id);
                  const innersPerBox = originalGroup ? (originalGroup.innersPerBox || 0) : 0;
                  const placedQty = packGroup.placedQty || 0;
                  return total + (placedQty * innersPerBox);
                }, 0)
              : 0;

            return React.createElement(
              "div",
              { key: container.id, className: "border-b border-gray-200 pb-6 last:border-b-0" },
              // Container header
              React.createElement(
                "div",
                { className: "flex items-center justify-between mb-3" },
                React.createElement(
                  "h3",
                  { className: "font-semibold text-lg text-gray-800" },
                  `Container ${idx + 1}: ${container.type}`
                ),
                React.createElement(
                  "div",
                  { className: "text-sm text-gray-600" },
                  `${packResult ? packResult.totalCartons || 0 : 0} cartons • ${containerWeight.toFixed(1)} kg`
                )
              ),
              // Row: 3D View (75%) + Per Container card (25%)
              React.createElement(
                "div",
                { className: "flex gap-4" },
                // 3D View for this container (75% width)
                React.createElement(
                  "div",
                  { className: "w-3/4" },
                  React.createElement(window.CartonApp.Components.PalletView3D, {
                    palletL: container.L,
                    palletW: container.W,
                    palletH: container.H,
                    cartonL: palletTile.boxL,
                    cartonW: palletTile.boxW,
                    cartonH: palletTile.boxH,
                    pattern: palletTile.pattern,
                    perLayer: palletTile.perLayer,
                    layers: packResult ? packResult.totalLayers || 0 : 0,
                    patternRows: palletTile.patternRows,
                    palletTile,
                    cartonWeight,
                    effectiveCartons: packResult ? packResult.totalCartons || 0 : 0,
                    multiTile: packResult || null,
                    activeContainerIndex: idx,
                    totalContainers: 1, // Hide pagination in stacked view
                    onContainerChange: () => {},
                    totalInners: containerInners,
                  })
                ),
                // Per Container card (25% width, smaller text)
                React.createElement(
                  "div",
                  { className: "w-1/4 p-3 border rounded-2xl shadow-sm bg-white self-start" },
                  React.createElement("h4", { className: "font-semibold text-sm mb-1" }, "Per Container"),
                  React.createElement(
                    "div",
                    { className: "text-xs text-gray-600 mb-2" },
                    packResult
                      ? `${packResult.totalCartons || 0} cartons, ${packResult.totalLayers || 0} layer${(packResult.totalLayers || 0) === 1 ? "" : "s"}`
                      : "No cartons"
                  ),
                  React.createElement(
                    "div",
                    { className: "text-lg font-bold" },
                    `${packResult ? packResult.totalCartons || 0 : 0} cartons`
                  ),
                  // Group-by-group inners breakdown
                  packResult && packResult.groups && React.createElement(
                    "div",
                    { className: "mt-2 pt-2 border-t border-gray-100" },
                    React.createElement("div", { className: "text-xs font-medium text-gray-500 mb-1" }, "Inners per group:"),
                    React.createElement(
                      "div",
                      { className: "space-y-0.5" },
                      ...packResult.groups
                        .filter(packGroup => (packGroup.placedQty || 0) > 0)
                        .map(packGroup => {
                          const originalGroup = cartonGroups.find(g => g.id === packGroup.id);
                          const groupName = originalGroup ? originalGroup.name : "Unknown";
                          const innersPerBox = originalGroup ? (originalGroup.innersPerBox || 0) : 0;
                          const placedQty = packGroup.placedQty || 0;
                          const totalInners = placedQty * innersPerBox;
                          const groupColor = originalGroup ? originalGroup.color : "#999";

                          return React.createElement(
                            "div",
                            { key: packGroup.id, className: "flex items-center justify-between text-xs" },
                            React.createElement(
                              "div",
                              { className: "flex items-center gap-1" },
                              React.createElement("div", {
                                className: "w-2 h-2 rounded-sm",
                                style: { backgroundColor: groupColor }
                              }),
                              React.createElement("span", { className: "text-gray-700 truncate max-w-[60px]" }, groupName)
                            ),
                            React.createElement(
                              "span",
                              { className: "font-medium text-xs" },
                              innersPerBox > 0
                                ? `${placedQty}×${innersPerBox}=${totalInners.toLocaleString()}`
                                : `${placedQty}`
                            )
                          );
                        })
                    ),
                    // Total inners for this container
                    React.createElement(
                      "div",
                      { className: "flex justify-between text-xs font-semibold mt-1 pt-1 border-t border-gray-100" },
                      React.createElement("span", null, "Total:"),
                      React.createElement("span", null, containerInners.toLocaleString())
                    )
                  ),
                  // Weight footer
                  React.createElement(
                    "div",
                    { className: `text-xs mt-2 ${containerWeight > container.weightLimit ? "text-red-600 font-semibold" : "text-gray-600"}` },
                    `${containerWeight.toFixed(1)} kg${containerWeight > container.weightLimit ? " ⚠️" : ""}`
                  )
                )
              )
            );
          })
        ),

        // Export/Import buttons
        React.createElement(
          "div",
          { className: "mt-1 pl-1 flex gap-2" },
          // Export Spreadsheet button
          React.createElement(
            "button",
            {
              className:
                "px-4 py-2 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2",
              onClick: handleExportSpreadsheet,
              disabled: !multiContainerPacking || multiContainerPacking.length === 0,
            },
            React.createElement(
              "svg",
              { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" },
              React.createElement("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "2",
                d: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              })
            ),
            "Export Spreadsheet"
          ),
          // Export JSON button
          React.createElement(
            "button",
            {
              className:
                "px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2",
              onClick: handleExportJSON,
            },
            React.createElement(
              "svg",
              { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" },
              React.createElement("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "2",
                d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              })
            ),
            "Export JSON"
          ),
          // Import JSON button
          React.createElement(
            "button",
            {
              className:
                "px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2",
              onClick: () => {
                setImportJsonText("");
                setImportError("");
                setShowImportModal(true);
              },
            },
            React.createElement(
              "svg",
              { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" },
              React.createElement("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "2",
                d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              })
            ),
            "Import JSON"
          )
        ),

        // Metric Cards (only in paginated mode)
        displayMode === "paginated" && React.createElement(
          "section",
          { className: "grid md:grid-cols-2 gap-4" },

          // Per Container card with group breakdown
          React.createElement(
            "div",
            { className: "p-4 border rounded-2xl shadow-sm bg-white" },
            React.createElement("h4", { className: "font-semibold mb-1" }, "Per Container"),
            React.createElement(
              "div",
              { className: "text-sm text-gray-600 mb-2" },
              isMultiActive
                ? `Multi-group: ${cartonsPerPallet} cartons across ${palletLayers} layer${palletLayers === 1 ? "" : "s"}`
                : `${palletTile.perLayer} cartons/layer × ${palletLayers} layers`
            ),
            React.createElement(
              "div",
              { className: "text-xl font-bold" },
              `${numberFmt(effectiveCartons)} cartons`
            ),
            // Group-by-group inners breakdown
            isMultiActive && multiPack && multiPack.groups && React.createElement(
              "div",
              { className: "mt-3 pt-3 border-t border-gray-100" },
              React.createElement("div", { className: "text-xs font-medium text-gray-500 mb-2" }, "Inners per group:"),
              React.createElement(
                "div",
                { className: "space-y-1" },
                ...multiPack.groups
                  .filter(packGroup => (packGroup.placedQty || 0) > 0)
                  .map(packGroup => {
                    const originalGroup = cartonGroups.find(g => g.id === packGroup.id);
                    const groupName = originalGroup ? originalGroup.name : "Unknown";
                    const innersPerBox = originalGroup ? (originalGroup.innersPerBox || 0) : 0;
                    const placedQty = packGroup.placedQty || 0;
                    const totalInners = placedQty * innersPerBox;
                    const groupColor = originalGroup ? originalGroup.color : "#999";

                    return React.createElement(
                      "div",
                      { key: packGroup.id, className: "flex items-center justify-between text-sm" },
                      React.createElement(
                        "div",
                        { className: "flex items-center gap-2" },
                        React.createElement("div", {
                          className: "w-3 h-3 rounded-sm",
                          style: { backgroundColor: groupColor }
                        }),
                        React.createElement("span", { className: "text-gray-700" }, groupName)
                      ),
                      React.createElement(
                        "span",
                        { className: "font-medium" },
                        innersPerBox > 0
                          ? `${placedQty} × ${innersPerBox} = ${totalInners.toLocaleString()}`
                          : `${placedQty} boxes`
                      )
                    );
                  })
              ),
              // Total inners
              React.createElement(
                "div",
                { className: "flex justify-between text-sm font-semibold mt-2 pt-2 border-t border-gray-100" },
                React.createElement("span", null, "Total inners:"),
                React.createElement("span", null,
                  (isMultiActive && multiPack && multiPack.groups
                    ? multiPack.groups.reduce((total, packGroup) => {
                        const originalGroup = cartonGroups.find(g => g.id === packGroup.id);
                        const innersPerBox = originalGroup ? (originalGroup.innersPerBox || 0) : 0;
                        return total + ((packGroup.placedQty || 0) * innersPerBox);
                      }, 0)
                    : 0
                  ).toLocaleString()
                )
              )
            ),
            // Weight footer
            React.createElement(
              "div",
              { className: `text-sm mt-3 ${palletOverweight ? "text-red-600 font-semibold" : "text-gray-600"}` },
              `${palletWeight.toFixed(1)} kg total ${palletOverweight ? ` ⚠️ OVER LIMIT` : ""}`
            )
          ),

          // Optimization summary
          React.createElement(window.CartonApp.Components.OptimizationDetails, {
            palletTile,
            limits: containerLimits,
            palletLayers: singleLayers,
            cartonsPerPallet: singleCartonsPerPallet,
            carton,
            multiPack,
            isMultiActive,
          }),
        ),

        // Notes section
        React.createElement(window.CartonApp.Components.NotesAndTips)
      )
    )
    ), // Close Main Content div

    // Import JSON Modal
    showImportModal && React.createElement(
      "div",
      {
        className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50",
        onClick: (e) => {
          if (e.target === e.currentTarget) setShowImportModal(false);
        }
      },
      React.createElement(
        "div",
        { className: "bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4" },

        // Modal header
        React.createElement(
          "div",
          { className: "flex items-center justify-between mb-4" },
          React.createElement(
            "h3",
            { className: "text-lg font-semibold" },
            "Import JSON Configuration"
          ),
          React.createElement(
            "button",
            {
              className: "text-gray-500 hover:text-gray-700 text-xl font-bold",
              onClick: () => setShowImportModal(false)
            },
            "×"
          )
        ),

        // Instructions
        React.createElement(
          "p",
          { className: "text-sm text-gray-600 mb-3" },
          "Paste your previously exported JSON configuration below:"
        ),

        // Textarea for JSON input
        React.createElement("textarea", {
          className: "w-full h-48 border rounded-lg p-3 text-sm font-mono resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500",
          placeholder: '{\n  "groups": [...],\n  "containers": [...],\n  "settings": {...}\n}',
          value: importJsonText,
          onChange: (e) => {
            setImportJsonText(e.target.value);
            setImportError("");
          }
        }),

        // Error message
        importError && React.createElement(
          "div",
          { className: "mt-2 text-sm text-red-600" },
          importError
        ),

        // Buttons
        React.createElement(
          "div",
          { className: "flex justify-end gap-2 mt-4" },
          React.createElement(
            "button",
            {
              className: "px-4 py-2 text-gray-600 hover:text-gray-800 text-sm font-medium",
              onClick: () => setShowImportModal(false)
            },
            "Cancel"
          ),
          React.createElement(
            "button",
            {
              className: "px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50",
              onClick: handleImportJSON,
              disabled: !importJsonText.trim()
            },
            "Import"
          )
        )
      )
    ),

    // Export JSON Modal
    showExportModal && React.createElement(
      "div",
      {
        className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50",
        onClick: (e) => {
          if (e.target === e.currentTarget) setShowExportModal(false);
        }
      },
      React.createElement(
        "div",
        { className: "bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4" },

        // Modal header
        React.createElement(
          "div",
          { className: "flex items-center justify-between mb-4" },
          React.createElement(
            "h3",
            { className: "text-lg font-semibold" },
            "Export JSON Configuration"
          ),
          React.createElement(
            "button",
            {
              className: "text-gray-500 hover:text-gray-700 text-xl font-bold",
              onClick: () => setShowExportModal(false)
            },
            "×"
          )
        ),

        // Instructions
        React.createElement(
          "p",
          { className: "text-sm text-gray-600 mb-3" },
          "Copy the JSON configuration below:"
        ),

        // Textarea with JSON (readonly)
        React.createElement("textarea", {
          className: "w-full h-48 border rounded-lg p-3 text-sm font-mono resize-none bg-gray-50",
          value: exportJsonText,
          readOnly: true,
          onClick: (e) => e.target.select()
        }),

        // Buttons
        React.createElement(
          "div",
          { className: "flex justify-end gap-2 mt-4" },
          React.createElement(
            "button",
            {
              className: "px-4 py-2 text-gray-600 hover:text-gray-800 text-sm font-medium",
              onClick: () => setShowExportModal(false)
            },
            "Close"
          ),
          React.createElement(
            "button",
            {
              className: `px-4 py-2 ${exportCopied ? "bg-green-600" : "bg-blue-600"} text-white rounded-lg text-sm font-medium hover:${exportCopied ? "bg-green-700" : "bg-blue-700"}`,
              onClick: handleCopyExport
            },
            exportCopied ? "Copied!" : "Copy to Clipboard"
          )
        )
      )
    )
  ); // Close root div
};

// -----------------------------------------------
// Initialize App
// -----------------------------------------------
(function initApp() {
  const root = document.getElementById("root");
  if (!root) {
    console.error("❌ Root element #root not found.");
    return;
  }

  console.log("🚀 Mounting React App...");
  ReactDOM.createRoot(root).render(
    React.createElement(window.CartonApp.MainApp)
  );
})();
