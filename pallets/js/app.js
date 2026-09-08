// js/App.js
// Main Application Component

window.CartonApp = window.CartonApp || {};

window.CartonApp.MainApp = function () {
  const { useState, useMemo, useEffect } = React;
  const { DEFAULT_VALUES, PALLET_SIZES } = window.CartonApp.Constants;
  const { handleNumberInput, numberFmt, parseUrlParams, updateUrlParams } = window.CartonApp.Utils;
  const { bestTile } = window.CartonApp.Algorithms;
  const {
    InputSection,
    MetricCard,
    PalletSizeSelector,
    OptimizationDetails,
    NotesAndTips,
    PalletView3D,
  } = window.CartonApp.Components;

  // -------------------------------------------------
  // Initialize state from URL params or defaults
  // -------------------------------------------------
  // Parsed once — the sku is resolved later, when the catalogue has loaded
  const urlInit = React.useRef(parseUrlParams());

  const getInitialState = () => {
    const urlParams = urlInit.current;

    const cartonInit = urlParams.carton
      ? { ...DEFAULT_VALUES.carton, ...urlParams.carton }
      : { ...DEFAULT_VALUES.carton, weight: 10.0 };

    if (urlParams.weight != null) cartonInit.weight = urlParams.weight;
    if (urlParams.innersPerCarton != null) {
      cartonInit.innersPerCarton = urlParams.innersPerCarton;
    }

    const limitsInit = urlParams.pallet
      ? {
          ...DEFAULT_VALUES.limits,
          palletL: urlParams.pallet.L,
          palletW: urlParams.pallet.W,
          palletH: urlParams.pallet.H,
        }
      : DEFAULT_VALUES.limits;

    return { cartonInit, limitsInit };
  };

  const { cartonInit, limitsInit } = getInitialState();

  // -------------------------------------------------
  // STATE
  // -------------------------------------------------
  const [carton, setCarton] = useState(cartonInit);
  const [limits, setLimits] = useState(limitsInit);
  const [allowVerticalFlip, setAllowVerticalFlip] = useState(true);
  // SKU of the catalogue product whose dimensions were loaded, if any.
  // Dimensions stay editable after selection, so this records provenance only.
  const [selectedSku, setSelectedSku] = useState(null);

  // -------------------------------------------------
  // PRODUCT CATALOGUE
  // Owned here because two features consume it: the picker and the bulk import.
  // -------------------------------------------------
  const Products = window.CartonApp.Products;
  const [products, setProducts] = useState([]);
  const [catalogueState, setCatalogueState] = useState("loading"); // loading | ready | error
  const [catalogueSource, setCatalogueSource] = useState(null);
  const [catalogueGenerated, setCatalogueGenerated] = useState(null);
  const [urlSkuMissing, setUrlSkuMissing] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Products.load()
      .then((list) => {
        if (cancelled) return;
        setProducts(list);
        setCatalogueSource(Products.meta().source);
        setCatalogueGenerated(Products.meta().generated);
        setCatalogueState("ready");
      })
      .catch(() => {
        if (!cancelled) setCatalogueState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve ?sku= once the catalogue is available. Explicit dimension params
  // win over the catalogue values, so an adjusted link reproduces faithfully.
  const urlSkuApplied = React.useRef(false);
  useEffect(() => {
    if (urlSkuApplied.current || catalogueState !== "ready") return;
    const wanted = urlInit.current.sku;
    if (!wanted) {
      urlSkuApplied.current = true;
      return;
    }
    urlSkuApplied.current = true;

    const product = Products.findBySku(products, wanted);
    if (!product) {
      setUrlSkuMissing(wanted);
      return;
    }

    const u = urlInit.current;
    setCarton({
      ...Products.toCarton(product),
      ...(u.carton || {}),
      ...(u.weight != null ? { weight: u.weight } : {}),
      ...(u.innersPerCarton != null ? { innersPerCarton: u.innersPerCarton } : {}),
    });
    setSelectedSku(product.sku);
  }, [catalogueState, products]);

  const selectedProduct = useMemo(
    () => Products.findBySku(products, selectedSku),
    [products, selectedSku]
  );

  const handleProductSelect = (product) => {
    setCarton({ ...carton, ...Products.toCarton(product) });
    setSelectedSku(product.sku);
    setUrlSkuMissing(null);
  };

  // Clearing drops the product link but keeps the dimensions on screen —
  // wiping the fields would throw away work the user may still want.
  const handleProductClear = () => setSelectedSku(null);

  // -------------------------------------------------
  // Update URL when carton or limits change
  // -------------------------------------------------
  useEffect(() => {
    updateUrlParams(carton, limits, selectedSku, selectedProduct);
  }, [
    carton.l,
    carton.w,
    carton.h,
    carton.weight,
    carton.innersPerCarton,
    limits.palletL,
    limits.palletW,
    limits.palletH,
    selectedSku,
    selectedProduct,
  ]);

  // -------------------------------------------------
  // COMPUTATIONS
  // -------------------------------------------------
  const cartonWeight = carton.weight;
  const overweight = cartonWeight > limits.cartonGrossMax;

  const palletTile = useMemo(
    () =>
      bestTile(
        carton.l,
        carton.w,
        carton.h,
        limits.palletL,
        limits.palletW,
        limits.palletH,
        allowVerticalFlip
      ),
    [carton, limits, allowVerticalFlip]
  );

  // Expose current tile globally for 2D view awareness
  window.CartonApp.lastTile = palletTile;

  const palletLayers = palletTile.layers;
  const cartonsPerPallet = palletTile.perLayer * palletLayers;
  const totalInnersPerPallet = cartonsPerPallet * (carton.innersPerCarton || 0);
  const palletWeight = cartonsPerPallet * cartonWeight;
  const palletOverweight = limits.palletGrossMax && palletWeight > limits.palletGrossMax;

  // -------------------------------------------------
  // BULK IMPORT / EXPORT (TiHi)
  // -------------------------------------------------
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkUnit, setBulkUnit] = useState("mm");
  const bulkFileRef = React.useRef(null);

  function handleBulkImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    // File size limit (10 MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      alert("File too large. Maximum size is 10 MB.");
      e.target.value = "";
      return;
    }

    // File type validation
    const validExtensions = [".xlsx", ".xls", ".csv"];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!validExtensions.includes(ext)) {
      alert("Please upload a valid Excel (.xlsx, .xls) or CSV (.csv) file.");
      e.target.value = "";
      return;
    }

    setIsBulkProcessing(true);

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (!rows.length) {
          alert("No data rows found in file.");
          setIsBulkProcessing(false);
          return;
        }

        // Map column headers flexibly (case-insensitive, partial match)
        const findCol = (row, ...keywords) => {
          const keys = Object.keys(row);
          for (const kw of keywords) {
            const match = keys.find(k => k.toLowerCase().includes(kw.toLowerCase()));
            if (match !== undefined) return match;
          }
          return null;
        };

        const sample = rows[0];
        const colSku = findCol(sample, "sku", "product code", "item code");
        const colCartonL = findCol(sample, "carton length", "carton l");
        const colCartonW = findCol(sample, "carton width", "carton w");
        const colCartonH = findCol(sample, "carton height", "carton h");
        const colWeight = findCol(sample, "weight");
        const colInners = findCol(sample, "inner");
        const colFlip = findCol(sample, "laying", "side", "flip");
        const colPalletL = findCol(sample, "pallet length", "pallet l");
        const colPalletW = findCol(sample, "pallet width", "pallet w");
        const colPalletH = findCol(sample, "height");
        const colMaxCarton = findCol(sample, "max carton", "carton gross");
        const colMaxPallet = findCol(sample, "max pallet", "pallet gross");

        // Disambiguate height columns: if colPalletH matched the carton height col, find another
        const findPalletHeight = () => {
          const keys = Object.keys(sample);
          const candidates = keys.filter(k => k.toLowerCase().includes("height") || k.toLowerCase() === "height");
          // If we have "Carton Height" and "Height", pick the one that's NOT carton height
          for (const c of candidates) {
            if (c !== colCartonH) return c;
          }
          return colPalletH;
        };
        const resolvedPalletH = findPalletHeight();

        // Distinguish "catalogue unavailable" from "SKU genuinely absent" —
        // otherwise every row would report NOT FOUND and misplace the blame.
        if (colSku && !products.length) {
          alert(
            "The product catalogue has not loaded, so SKU lookups cannot run.\n\n" +
            "Rows will use the dimensions given in the sheet, or defaults where blank."
          );
        }

        // Parse a numeric cell, stripping units like "mm", "kg", "%" etc.
        const parseNum = (val) => {
          if (val === "" || val === null || val === undefined) return NaN;
          if (typeof val === "number") return val;
          return Number(String(val).replace(/[^0-9.\-]/g, ""));
        };

        const defaults = DEFAULT_VALUES;
        const results = [];

        // Unit conversion: cm → mm multiplier
        const toMm = bulkUnit === "cm" ? 10 : 1;
        const unitLabel = bulkUnit === "cm" ? "cm" : "mm";

        // Process each row using bestTile algorithm
        for (const row of rows) {
          // A SKU supplies the baseline carton spec; any explicit dimension
          // column in the sheet still overrides it, so a row can quote a
          // product and then adjust one figure.
          const skuRaw = colSku ? String(row[colSku] ?? "").trim() : "";
          const resolved = skuRaw
            ? Products.resolveSku(products, skuRaw)
            : { product: null, status: "" };
          const product = resolved.product;
          const skuStatus = resolved.status;

          // Catalogue dimensions are always mm; the /toMm here cancels the
          // *toMm below so they are not scaled a second time in cm mode.
          const base = product
            ? Products.toCarton(product)
            : {
                l: defaults.carton.l,
                w: defaults.carton.w,
                h: defaults.carton.h,
                weight: defaults.carton.weight,
                innersPerCarton: 0,
              };

          const cL = (parseNum(row[colCartonL]) || base.l / toMm) * toMm;
          const cW = (parseNum(row[colCartonW]) || base.w / toMm) * toMm;
          const cH = (parseNum(row[colCartonH]) || base.h / toMm) * toMm;
          const weight = colWeight ? (parseNum(row[colWeight]) || base.weight) : base.weight;
          const inners = colInners ? (parseNum(row[colInners]) || base.innersPerCarton) : base.innersPerCarton;

          const flipRaw = colFlip ? String(row[colFlip]).trim().toLowerCase() : "";
          const flip = flipRaw === "" || flipRaw === "yes" || flipRaw === "y" || flipRaw === "true" || flipRaw === "1";

          const pL = colPalletL ? (parseNum(row[colPalletL]) || defaults.limits.palletL) : defaults.limits.palletL;
          const pW = colPalletW ? (parseNum(row[colPalletW]) || defaults.limits.palletW) : defaults.limits.palletW;
          const pH = resolvedPalletH ? (parseNum(row[resolvedPalletH]) || defaults.limits.palletH) : defaults.limits.palletH;
          const maxCarton = colMaxCarton ? (parseNum(row[colMaxCarton]) || defaults.limits.cartonGrossMax) : defaults.limits.cartonGrossMax;
          const maxPallet = colMaxPallet ? (parseNum(row[colMaxPallet]) || defaults.limits.palletGrossMax) : defaults.limits.palletGrossMax;

          const tile = bestTile(cL, cW, cH, pL, pW, pH, flip);

          const totalCartons = tile.total || 0;
          const layers = tile.layers || 0;
          const perLayer = tile.perLayer || 0;
          const totalWeight = totalCartons * weight;
          const totalInners = totalCartons * inners;
          const surfaceUsed = pL * pW > 0
            ? (((tile.usedL || 0) * (tile.usedW || 0)) / (pL * pW) * 100)
            : 0;
          const volUsed = pL * pW * pH > 0
            ? (((tile.usedL || 0) * (tile.usedW || 0) * (tile.usedH || 0)) / (pL * pW * pH) * 100)
            : 0;
          const overweightCarton = weight > maxCarton;
          const overweightPallet = totalWeight > maxPallet;

          // Convert mm back to display unit for output
          const toDisplay = (mm) => bulkUnit === "cm" ? Math.round(mm / 10 * 100) / 100 : mm;

          results.push({
            ...(colSku
              ? {
                  SKU: product ? product.sku : skuRaw,
                  "Product Name": product ? product.name : "",
                  "SKU Status": skuStatus,
                }
              : {}),
            [`Carton Length (${unitLabel})`]: toDisplay(cL),
            [`Carton Width (${unitLabel})`]: toDisplay(cW),
            [`Carton Height (${unitLabel})`]: toDisplay(cH),
            "(Ti) Cartons per Layer": perLayer,
            "(Hi) Layers": layers,
            "Total Cartons": totalCartons,
            "Weight (kg)": weight,
            "Inners per Carton": inners,
            "Total Inners": totalInners,
            "Total Weight (kg)": Math.round(totalWeight * 100) / 100,
            "Surface Usage %": Math.round(surfaceUsed) + "%",
            "Vol Usage %": Math.round(volUsed) + "%",
            [`Stack Height (${unitLabel})`]: toDisplay(tile.usedH || 0),
            [`Pallet Length (${unitLabel})`]: toDisplay(pL),
            [`Pallet Width (${unitLabel})`]: toDisplay(pW),
            [`Pallet Height (${unitLabel})`]: toDisplay(pH),
            "Max Carton (kg)": maxCarton,
            "Max Pallet (kg)": maxPallet,
            "Carton Overweight": overweightCarton ? "YES" : "",
            "Pallet Overweight": overweightPallet ? "YES" : "",
          });
        }

        // Unresolved SKUs fall back to defaults, which would otherwise look
        // like real figures in the output — say so before the download.
        const unresolved = results.filter(
          (r) => r["SKU Status"] === "NOT FOUND" || r["SKU Status"] === "AMBIGUOUS"
        );
        const coerced = results.filter(
          (r) => r["SKU Status"] === "MATCHED — CHECK CELL FORMAT"
        );
        if (unresolved.length || coerced.length) {
          const notes = [];
          if (unresolved.length) {
            notes.push(
              `${unresolved.length} of ${results.length} row(s) could not be matched to a product. ` +
              `Those rows used default dimensions — see the SKU Status column.`
            );
          }
          if (coerced.length) {
            notes.push(
              `${coerced.length} row(s) matched only after treating the SKU as a number. ` +
              `Excel likely reformatted the cell (dropping leading zeros, or turning ` +
              `something like 5642E10 into 56420000000000). Format the SKU column as ` +
              `Text in your sheet to avoid this.`
            );
          }
          alert(notes.join("\n\n"));
        }

        // Generate and download the results as xlsx
        const ws = XLSX.utils.json_to_sheet(results);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Results");
        XLSX.writeFile(wb, `TiHi-results-${new Date().toISOString().split("T")[0]}.xlsx`);

      } catch (err) {
        console.error("Bulk import error:", err);
        alert("Error processing file: " + err.message);
      }

      setIsBulkProcessing(false);
      // Reset file input so the same file can be re-uploaded
      if (bulkFileRef.current) bulkFileRef.current.value = "";
    };

    reader.readAsArrayBuffer(file);
  }

  function handleDownloadTemplate() {
    const u = bulkUnit === "cm" ? "cm" : "mm";
    const d = bulkUnit === "cm" ? 10 : 1; // divisor from mm defaults
    const sampleSku = (products[0] && products[0].sku) || "";
    const templateData = [
      // Row 1: SKU only — dimensions come from the catalogue
      {
        "SKU": sampleSku,
        [`Carton Length (${u})`]: "",
        [`Carton Width (${u})`]: "",
        [`Carton Height (${u})`]: "",
        "Weight (kg)": "",
        "Inners": "",
        "Allow laying on side": "Yes",
        [`Pallet Length (${u})`]: 1200 / d,
        [`Pallet Width (${u})`]: 1000 / d,
        [`Height (${u})`]: 1200 / d,
        "Max Carton gross (kg)": 25,
        "Max Pallet Gross (kg)": 1600,
      },
      // Row 2: SKU with an override — the stated height wins
      {
        "SKU": sampleSku,
        [`Carton Length (${u})`]: "",
        [`Carton Width (${u})`]: "",
        [`Carton Height (${u})`]: 400 / d,
        "Weight (kg)": "",
        "Inners": "",
        "Allow laying on side": "Yes",
        [`Pallet Length (${u})`]: 1200 / d,
        [`Pallet Width (${u})`]: 1000 / d,
        [`Height (${u})`]: 1200 / d,
        "Max Carton gross (kg)": 25,
        "Max Pallet Gross (kg)": 1600,
      },
      // Row 3: no SKU — fully manual, as before
      {
        "SKU": "",
        [`Carton Length (${u})`]: 600 / d,
        [`Carton Width (${u})`]: 400 / d,
        [`Carton Height (${u})`]: 300 / d,
        "Weight (kg)": 10,
        "Inners": 0,
        "Allow laying on side": "Yes",
        [`Pallet Length (${u})`]: 1200 / d,
        [`Pallet Width (${u})`]: 1000 / d,
        [`Height (${u})`]: 1200 / d,
        "Max Carton gross (kg)": 25,
        "Max Pallet Gross (kg)": 1600,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "TiHi-import-template.xlsx");
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
      { className: "bg-gray-700 text-white" },
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
              "Carton & Pallet - Planner & Visualizer"
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
                className: "px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 transition-colors"
              },
              "Pallets"
            ),
            React.createElement(
              "a",
              {
                href: "https://tools.e-bedding.co.uk/containers",
                className: "px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
              },
              "Containers"
            ),
            // Divider
            React.createElement("div", {
              className: "h-6 w-px bg-gray-500 mr-4"
            }),
            // Report Problem button
            React.createElement(window.CartonApp.Components.ReportProblem)
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
        { className: "" },
        React.createElement(
          "div",
          { className: "text-md text-blue-600" },
          "All dimensions in ",
          React.createElement("b", {}, "mm"),
          " and weights in ",
          React.createElement("b", {}, "kg"),
          "."
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

        // CARTON section
        React.createElement(
          "section",
          { className: "p-4 border rounded-2xl shadow-sm bg-white" },
          React.createElement(
            "h3",
            { className: "font-semibold mb-2" },
            "Carton (external)"
          ),

          // Product picker — fills the fields below; they remain editable
          React.createElement(window.CartonApp.Components.ProductSelector, {
            products,
            catalogueState,
            catalogueSource,
            catalogueGenerated,
            selectedSku,
            carton,
            onSelect: handleProductSelect,
            onClear: handleProductClear,
            missingSku: urlSkuMissing,
          }),

          ...[
            ["l", "Length (mm)", carton.l],
            ["w", "Width (mm)", carton.w],
            ["h", "Height (mm)", carton.h],
            ["weight", "Weight (kg)", carton.weight],
            ['innersPerCarton', 'Inner (products) per carton', carton.innersPerCarton || 0],
          ].map(([key, label, value]) =>
            React.createElement(
              "label",
              { key, className: "block text-sm my-1" },
              label,
              React.createElement("input", {
                type: "number",
                min: 0,
                value,
                onChange: (e) =>
                  handleNumberInput(setCarton, carton, key, e.target.value),
                className: "border rounded-lg px-2 py-1 ml-2 w-28",
              })
            )
          ),

          // Overweight warning
          React.createElement(
            "div",
            {
              className: `mt-2 text-sm ${
                overweight
                  ? "text-red-600 font-semibold"
                  : "text-gray-600"
              }`,
            },
            `${cartonWeight.toFixed(2)} kg gross`,
            overweight &&
              React.createElement(
                "span",
                {},
                ` — exceeds ${limits.cartonGrossMax} kg limit!`
              )
          ),

          // Allow flip checkbox
          React.createElement(
            "label",
            { className: "flex items-center space-x-2 mt-3 text-sm" },
            React.createElement("input", {
              type: "checkbox",
              checked: allowVerticalFlip,
              onChange: (e) => setAllowVerticalFlip(e.target.checked),
            }),
            React.createElement(
              "span",
              {},
              "Allow cartons to be laid on their side (vertical flipping)"
            )
          )
        ),

        // PALLET size selector
        React.createElement(PalletSizeSelector, {
          limits,
          setLimits,
        }),

        // TOTAL WEIGHT
        React.createElement(
          "div",
          {
            className: `mt-2 text-sm px-4 ${palletOverweight ? "text-red-600 font-semibold" : "text-gray-600"}`
          },
          palletOverweight
            ? `⚠️ Total pallet weight ${palletWeight.toFixed(2)} kg exceeds ${limits.palletGrossMax} kg limit!`
            : `Total pallet weight: ${palletWeight.toFixed(2)} kg`
        ),

        // BULK IMPORT (TiHi)
        React.createElement(
          "section",
          { className: "p-4 border rounded-2xl shadow-sm bg-white space-y-3" },
          React.createElement(
            "h3",
            { className: "font-semibold" },
            "Bulk Import (TiHi)"
          ),
          React.createElement(
            "p",
            { className: "text-xs text-gray-600" },
            "Upload an Excel or CSV file with multiple carton/pallet configurations. The system will run the algorithm on each row and return the results as a downloadable spreadsheet."
          ),
          React.createElement(
            "p",
            { className: "text-xs text-gray-600" },
            "Include a ",
            React.createElement("b", {}, "SKU"),
            " column to pull carton dimensions from the product catalogue. Any dimension column you fill in overrides the catalogue value for that row."
          ),
          // Unit toggle (mm / cm)
          React.createElement(
            "div",
            { className: "flex items-center gap-3" },
            React.createElement("span", { className: "text-sm text-gray-600" }, "Import carton dimensions in:"),
            React.createElement(
              "div",
              { className: "inline-flex rounded-lg border border-gray-300 overflow-hidden" },
              React.createElement(
                "button",
                {
                  className: `px-3 py-1 text-sm font-medium transition-colors ${bulkUnit === "mm" ? "bg-blue-500 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`,
                  onClick: () => setBulkUnit("mm"),
                },
                "mm"
              ),
              React.createElement(
                "button",
                {
                  className: `px-3 py-1 text-sm font-medium transition-colors ${bulkUnit === "cm" ? "bg-blue-500 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`,
                  onClick: () => setBulkUnit("cm"),
                },
                "cm"
              )
            )
          ),
          // Hidden file input
          React.createElement("input", {
            ref: bulkFileRef,
            type: "file",
            accept: ".xlsx,.xls,.csv",
            onChange: handleBulkImport,
            className: "hidden",
          }),
          // Buttons row
          React.createElement(
            "div",
            { className: "flex gap-2" },
            // Upload button
            React.createElement(
              "button",
              {
                className: "px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2",
                onClick: () => bulkFileRef.current && bulkFileRef.current.click(),
                disabled: isBulkProcessing,
              },
              isBulkProcessing && React.createElement(
                "svg",
                {
                  className: "animate-spin h-4 w-4",
                  xmlns: "http://www.w3.org/2000/svg",
                  fill: "none",
                  viewBox: "0 0 24 24"
                },
                React.createElement("circle", {
                  className: "opacity-25",
                  cx: "12", cy: "12", r: "10",
                  stroke: "currentColor", strokeWidth: "4"
                }),
                React.createElement("path", {
                  className: "opacity-75",
                  fill: "currentColor",
                  d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                })
              ),
              !isBulkProcessing && React.createElement(
                "svg",
                { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" },
                React.createElement("path", {
                  strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "2",
                  d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                })
              ),
              isBulkProcessing ? "Processing..." : "Upload & Process"
            ),
            // Download template button
            React.createElement(
              "button",
              {
                className: "px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 flex items-center gap-2",
                onClick: handleDownloadTemplate,
              },
              React.createElement(
                "svg",
                { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" },
                React.createElement("path", {
                  strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "2",
                  d: "M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                })
              ),
              "Download Template"
            )
          ),
          React.createElement(
            "p",
            { className: "text-xs text-gray-500" },
            "Missing values will use defaults. Column order does not matter."
          )
        )
      ),

      // -----------------------
      // VISUALIZATION PANEL
      // -----------------------
      React.createElement(
        "div",
        { className: "lg:col-span-2 space-y-4" },

        // 3D Pallet View
        React.createElement(window.CartonApp.Components.PalletView3D, {
          palletL: limits.palletL,
          palletW: limits.palletW,
          palletH: limits.palletH,
          cartonL: palletTile.boxL,
          cartonW: palletTile.boxW,
          cartonH: palletTile.boxH,
          pattern: palletTile.pattern,
          perLayer: palletTile.perLayer,
          layers: palletLayers,
          patternRows: palletTile.patternRows,
          palletTile,
          cartonWeight,
        }),

        // Flip Info
        React.createElement(
          "div",
          {
            className: `text-s mt-1 pl-1 ${
              allowVerticalFlip ? "text-green-600" : "text-orange-500"
            }`,
          },
          allowVerticalFlip
            ? "All orientations, including side-laying and flat, will be tested."
            : "Only upright and horizontal rotations will be considered (no side or flat flips)."
        ),

        // Metric Cards
        React.createElement(
          "section",
          { className: "grid md:grid-cols-2 gap-4" },

          // Carton card
          React.createElement(MetricCard, {
            title: "Carton",
            subtitle: `${carton.l}×${carton.w}×${carton.h} mm`,
            value: 1,
            unit: "carton",
            footer: `${cartonWeight.toFixed(2)} kg gross ${
              overweight ? "(OVER LIMIT)" : ""
            }`,
            error: overweight,
          }),

          // Per pallet card
          React.createElement(MetricCard, {
            title: "Per Pallet",
            subtitle: `${palletTile.perLayer} cartons/layer × ${palletLayers} layers`,
            value: `${numberFmt(cartonsPerPallet)} cartons with  ${totalInnersPerPallet}`,
            unit: "inner products",
            footer: `${palletWeight.toFixed(1)} kg total  ${
              palletOverweight ? " ⚠️ OVER LIMIT" : ""
            }`,
            error: palletOverweight,
          })
        ),

        // Optimization summary
        React.createElement(window.CartonApp.Components.OptimizationDetails, {
          palletTile,
          limits,
          palletLayers,
          cartonsPerPallet,
          carton
        }),

        // Notes section
        React.createElement(window.CartonApp.Components.NotesAndTips)
      )
      )
    ) // Close main content div
  );
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
