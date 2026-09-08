// js/components/ProductSelector.js
// Searchable product picker. Selecting a SKU fills the carton dimension fields;
// those fields stay fully editable afterwards, so a catalogue product is a
// starting point rather than a lock-in.

window.CartonApp = window.CartonApp || {};
window.CartonApp.Components = window.CartonApp.Components || {};

// Maximum rows rendered at once. See `visible` below.
const MAX_VISIBLE = 50;

window.CartonApp.Components.ProductSelector = function ({
  products,
  catalogueState,
  catalogueSource,
  catalogueGenerated,
  selectedSku,
  carton,
  onSelect,
  onClear,
  missingSku,
}) {
  const { useState, useRef, useEffect, useMemo } = React;
  const Products = window.CartonApp.Products;

  const loadState = catalogueState || "loading"; // loading | ready | error
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setIsOpen(false);
        setQuery("");
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const selected = useMemo(
    () => Products.findBySku(products, selectedSku),
    [products, selectedSku]
  );

  const results = useMemo(
    () => Products.search(products, query),
    [products, query]
  );

  // Only a slice is rendered. With a full catalogue an uncapped list is tens of
  // thousands of DOM nodes rebuilt on every keystroke, which makes typing lag
  // badly; nobody scrolls thousands of rows anyway — they narrow the search.
  const visible = useMemo(() => results.slice(0, MAX_VISIBLE), [results]);
  const hiddenCount = results.length - visible.length;

  const adjusted = selected && Products.isAdjusted(selected, carton);

  // Keep the highlighted row in view as the user arrows through
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const node = listRef.current.children[highlight];
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
  }, [highlight, isOpen]);

  const choose = (product) => {
    if (!product) return;
    onSelect(product);
    setIsOpen(false);
    setQuery("");
    setHighlight(0);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) return setIsOpen(true);
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && visible[highlight]) choose(visible[highlight]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setQuery("");
    }
  };

  // -------------------------------------------------
  // Catalogue unavailable → say so and get out of the way
  // -------------------------------------------------
  if (loadState === "error") {
    return React.createElement(
      "div",
      { className: "text-xs text-orange-600 mb-3" },
      "Product catalogue unavailable — enter dimensions manually below."
    );
  }

  // -------------------------------------------------
  // Result row
  // -------------------------------------------------
  const renderRow = (p, i) =>
    React.createElement(
      "li",
      {
        key: `${p.sku}-${i}`,
        onMouseDown: (e) => {
          e.preventDefault();
          choose(p);
        },
        onMouseEnter: () => setHighlight(i),
        className: `px-3 py-2 cursor-pointer border-b last:border-b-0 ${
          i === highlight ? "bg-blue-50" : "hover:bg-gray-50"
        }`,
      },
      React.createElement(
        "div",
        { className: "text-sm font-medium text-gray-800" },
        p.name
      ),
      React.createElement(
        "div",
        { className: "text-xs text-gray-500 flex justify-between gap-2" },
        React.createElement("span", { className: "font-mono" }, p.sku),
        React.createElement(
          "span",
          null,
          `${p.carton.l}×${p.carton.w}×${p.carton.h} mm · ${p.carton.weight} kg`
        )
      )
    );

  return React.createElement(
    "div",
    { ref: wrapRef, className: "relative mb-3" },

    React.createElement(
      "label",
      { className: "block text-sm text-gray-700 mb-1" },
      "Product (optional)"
    ),

    // Search input
    React.createElement("input", {
      ref: inputRef,
      type: "text",
      value: isOpen ? query : selected ? `${selected.sku} — ${selected.name}` : "",
      placeholder:
        loadState === "loading"
          ? "Loading products…"
          : "Search by SKU or name, or leave blank for manual entry",
      disabled: loadState === "loading",
      onChange: (e) => {
        setQuery(e.target.value);
        setHighlight(0);
        if (!isOpen) setIsOpen(true);
      },
      onFocus: () => {
        setIsOpen(true);
        setQuery("");
      },
      onKeyDown: handleKeyDown,
      className:
        "w-full border rounded-lg px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400",
    }),

    // Status line: which product is loaded, and whether it has been adjusted
    React.createElement(
      "div",
      { className: "flex items-center gap-2 mt-1 text-xs min-h-[18px]" },
      selected
        ? React.createElement(
            React.Fragment,
            null,
            adjusted
              ? React.createElement(
                  "span",
                  { className: "text-amber-600 font-medium" },
                  "Dimensions adjusted from catalogue"
                )
              : React.createElement(
                  "span",
                  { className: "text-green-600" },
                  "Using dimensions from Plytix"
                ),
            adjusted &&
              React.createElement(
                "button",
                {
                  type: "button",
                  onClick: () => onSelect(selected),
                  className: "text-blue-600 hover:underline",
                },
                "Reset"
              ),
            React.createElement(
              "button",
              {
                type: "button",
                onClick: () => {
                  onClear();
                  setQuery("");
                },
                className: "text-gray-500 hover:underline ml-auto",
              },
              "Clear"
            )
          )
        : React.createElement(
            "span",
            { className: "text-gray-500" },
            "Manual entry — dimensions below are set by user"
          )
    ),

    // Catalogue freshness. The export runs daily, so more than two days old
    // means runs have been failing — and a stale catalogue is otherwise
    // invisible, since it looks exactly like a working one.
    (function () {
      if (catalogueSource !== "plytix") return null;
      const age = window.CartonApp.Utils.relativeAge(catalogueGenerated);
      if (!age) return null;
      const stale = age.hours >= 48;
      return React.createElement(
        "div",
        {
          key: "freshness",
          className: `text-xs mt-1 ${stale ? "text-amber-600 font-medium" : "text-gray-400"}`,
        },
        stale
          ? `\u26a0 Product data last updated ${age.text} \u2014 the daily sync may be failing.`
          : `Product data updated ${age.text}.`
      );
    })(),

    // Sample data standing in for the real feed — say so, or the status line
    // above would claim Plytix dimensions for products that are invented.
    catalogueSource === "sample" &&
      React.createElement(
        "div",
        { className: "text-xs text-amber-600 mt-1" },
        "Sample catalogue \u2014 not live Plytix data."
      ),

    // A shared link referenced a SKU that is not in the catalogue
    missingSku &&
      React.createElement(
        "div",
        { className: "text-xs text-amber-600 mt-1" },
        `SKU "${missingSku}" from the link was not found — showing manual dimensions.`
      ),

    // Dropdown
    isOpen &&
      React.createElement(
        "ul",
        {
          ref: listRef,
          className:
            "absolute z-20 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto",
        },
        results.length
          ? [
              ...visible.map(renderRow),
              hiddenCount > 0 &&
                React.createElement(
                  "li",
                  {
                    key: "__more",
                    className:
                      "px-3 py-2 text-xs text-gray-500 italic bg-gray-50 border-t sticky bottom-0",
                  },
                  `${hiddenCount.toLocaleString("en-GB")} more match — keep typing to narrow`
                ),
            ].filter(Boolean)
          : React.createElement(
              "li",
              { className: "px-3 py-2 text-sm text-gray-500 italic" },
              `No products match "${query}"`
            )
      )
  );
};
