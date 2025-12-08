// js/components/PalletView3D.js
// Pallet visualization component (2D + 3D)

window.CartonApp = window.CartonApp || {};
window.CartonApp.Components = window.CartonApp.Components || {};
window.CartonApp.Constants = window.CartonApp.Constants || {};
window.CartonApp.Utils = window.CartonApp.Utils || {};

const LayerGrid2D = window.CartonApp.Components.LayerGrid2D;

// ----------------------------------------------------
// Helper: Create 3D Scene
// ----------------------------------------------------
function create3DScene(mountRef, config) {
  const { width, height, cameraDistance = 3000, cameraHeight = 2000, groundSize = 5000, farPlane = 10000 } = config;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, farPlane);
  camera.position.set(cameraDistance, cameraHeight, cameraDistance);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mountRef.current.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
  directionalLight.position.set(cameraDistance * 0.3, cameraHeight, cameraDistance * 0.3);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -10;
  ground.receiveShadow = true;
  scene.add(ground);

  return { scene, camera, renderer };
}

// ----------------------------------------------------
// Helper: Add pallet base
// ----------------------------------------------------
function addPalletBase(scene, palletL, palletW) {
  const geometry = new THREE.BoxGeometry(palletL, 100, palletW);
  const material = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
  const pallet = new THREE.Mesh(geometry, material);
  pallet.position.y = 50;
  pallet.castShadow = true;
  pallet.receiveShadow = true;
  scene.add(pallet);
  return pallet;
}

// ----------------------------------------------------
// Helper: Add height guide plane + dashed box outline
// ----------------------------------------------------
function addHeightGuide(scene, palletL, palletW, palletH) {
  const planeGeometry = new THREE.PlaneGeometry(palletL, palletW);
  const planeMaterial = new THREE.MeshBasicMaterial({
    color: 0x60a5fa,
    opacity: 0.15,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = palletH + 100;
  scene.add(plane);

  const edges = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(palletL, palletH, palletW)
  );
  const material = new THREE.LineDashedMaterial({
    color: 0x3b82f6,
    dashSize: 50,
    gapSize: 30,
    opacity: 0.4,
    transparent: true,
  });
  const outline = new THREE.LineSegments(edges, material);
  outline.computeLineDistances();
  outline.position.y = palletH / 2 + 100;
  scene.add(outline);
}

// ----------------------------------------------------
// PalletView3D Component
// ----------------------------------------------------
window.CartonApp.Components.PalletView3D = function ({
  palletL,
  palletW,
  palletH,
  cartonL,
  cartonW,
  cartonH,
  pattern,
  perLayer,
  layers,
  patternRows,
  palletTile,
  cartonWeight,
  effectiveCartons,
  multiTile, // NEW: multi-group packing result (or null)
  palletGrossMax, // Weight limit
  activeContainerIndex, // Index of current container being viewed
  totalContainers, // Total number of containers
  onContainerChange, // Callback to change active container
  totalInners, // Total inners in container (sum of placedQty * innersPerBox for all groups)
}) {
  const mountRef = React.useRef(null);
  const sceneRef = React.useRef(null);
  const rendererRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const [viewMode, setViewMode] = React.useState("3D");

  // Track visibility of each group by group id
  const [hiddenGroups, setHiddenGroups] = React.useState({});

  const isMulti = !!multiTile && !!multiTile.multi;

  // Get unique groups for visibility toggles
  const groupList = React.useMemo(() => {
    if (!isMulti || !multiTile || !Array.isArray(multiTile.groups)) return [];
    return multiTile.groups.map(g => ({
      id: g.id,
      name: g.name || `${g.l}×${g.w}×${g.h}`,  // Use name, or dimensions as fallback
      color: g.color || 0x4a9eff,
      count: g.placements ? g.placements.length : 0
    }));
  }, [isMulti, multiTile]);

  // Toggle visibility for a group
  const toggleGroupVisibility = (groupId) => {
    setHiddenGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Compute usage metrics
  const palletSurfaceArea = palletL * palletW;
  const palletVolume = palletL * palletW * palletH;

  const maxCartons = isMulti
    ? multiTile.totalCartons || 0
    : (perLayer || 0) * (layers || 0);

  const activeCartonCount =
    Number.isFinite(effectiveCartons) && effectiveCartons > 0 && !isMulti
      ? Math.min(effectiveCartons, maxCartons)
      : maxCartons;

  let usedSurfaceArea = 0;
  if (isMulti && multiTile.usedL && multiTile.usedW) {
    usedSurfaceArea = multiTile.usedL * multiTile.usedW;
  } else if (!isMulti && palletTile && palletTile.usedL && palletTile.usedW) {
    usedSurfaceArea = palletTile.usedL * palletTile.usedW;
  }

  const surfaceUsage =
    palletSurfaceArea > 0 ? (usedSurfaceArea / palletSurfaceArea) * 100 : 0;

  const cartonsVolume = isMulti
    ? multiTile.totalVolume || 0
    : activeCartonCount * cartonL * cartonW * cartonH;

  const volumeUsage =
    palletVolume > 0 ? (cartonsVolume / palletVolume) * 100 : 0;

  const stackHeight = isMulti
    ? multiTile.maxHeight || 0
    : layers * cartonH;

  const heightUnused = isMulti
    ? null
    : palletH - stackHeight;

  React.useEffect(() => {
    if (!mountRef.current || viewMode !== "3D") return;

    const mount = mountRef.current;
    let width = mount.clientWidth;
    let height = 400;

    // Calculate scene scale based on pallet/container dimensions
    const maxDimension = Math.max(palletL, palletW, palletH);

    // Scale camera distance and ground size based on object size
    // For containers (>5000mm), we need much larger scene
    const scaleFactor = Math.max(1, maxDimension / 2000);
    const baseCameraDistance = 2500;
    const baseCameraHeight = 2000;
    const baseGroundSize = 5000;

    const cameraDistance = baseCameraDistance * scaleFactor;
    const cameraHeight = baseCameraHeight * scaleFactor;
    const groundSize = baseGroundSize * scaleFactor * 1.5;
    const farPlane = cameraDistance * 10;

    const { scene, camera, renderer } = create3DScene(mountRef, {
      width,
      height,
      cameraDistance,
      cameraHeight,
      groundSize,
      farPlane,
    });

    sceneRef.current = scene;
    rendererRef.current = renderer;

    const resizeObserver = new ResizeObserver(() => {
      if (!rendererRef.current || !camera) return;
      const newWidth = mount.clientWidth;
      const newHeight = 400;
      rendererRef.current.setSize(newWidth, newHeight);
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    const drawL = palletL;
    const drawW = palletW;

    // Pallet base + height guide
    addPalletBase(scene, drawL, drawW);
    addHeightGuide(scene, drawL, drawW, palletH);

    const cartonGeometry = new THREE.BoxGeometry(1, 1, 1);
    const edgeGeometry = new THREE.EdgesGeometry(cartonGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x1e40af,
      linewidth: 1,
    });

    if (isMulti && multiTile && Array.isArray(multiTile.groups)) {
      // ---------------------------
      // MULTI-GROUP DRAWING
      // ---------------------------
      multiTile.groups.forEach((group) => {
        // Skip hidden groups
        if (hiddenGroups[group.id]) return;
        if (!group.placements || !group.placements.length) return;

        const mat = new THREE.MeshLambertMaterial({
          color: group.color || 0x4a9eff,
        });

        group.placements.forEach((p) => {
          const mesh = new THREE.Mesh(cartonGeometry, mat);
          const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);

          mesh.scale.set(p.l, p.h, p.w);
          edges.scale.set(p.l, p.h, p.w);

          mesh.position.set(p.x, p.y, p.z);
          edges.position.set(p.x, p.y, p.z);

          mesh.castShadow = true;
          mesh.receiveShadow = true;

          scene.add(mesh);
          scene.add(edges);
        });
      });
    } else {
      // ---------------------------
      // SINGLE-CARTON DRAWING
      // ---------------------------
      const standardMaterial = new THREE.MeshLambertMaterial({
        color: 0x4a9eff,
      });
      const rotatedMaterial = new THREE.MeshLambertMaterial({
        color: 0x60a5fa,
      });

      let placed = 0;

      for (let layerIndex = 0; layerIndex < layers; layerIndex++) {
        const yOffset = 100 + layerIndex * cartonH + cartonH / 2;

        if (patternRows) {
          let zStart = -drawW / 2;
          patternRows.forEach((row) => {
            if (placed >= activeCartonCount) return;

            const { rotated, countL, boxL: rowBoxL, boxW: rowBoxW } = row;
            const rowCountL = Math.max(0, Math.floor(countL) || 0);
            const rowUsedL = countL * rowBoxL;
            const xStart = -rowUsedL / 2;

            for (let i = 0; i < rowCountL; i++) {
              if (placed >= activeCartonCount) break;

              const carton = new THREE.Mesh(
                cartonGeometry,
                rotated ? rotatedMaterial : standardMaterial
              );
              const edges = new THREE.LineSegments(
                edgeGeometry,
                edgeMaterial
              );

              const xPos = xStart + rowBoxL / 2 + i * rowBoxL;
              const zPos = zStart + rowBoxW / 2;

              carton.scale.set(rowBoxL, cartonH, rowBoxW);
              edges.scale.set(rowBoxL, cartonH, rowBoxW);
              carton.position.set(xPos, yOffset, zPos);
              edges.position.set(xPos, yOffset, zPos);

              carton.castShadow = true;
              carton.receiveShadow = true;

              scene.add(carton);
              scene.add(edges);

              placed++;
            }
            zStart += rowBoxW;
          });
        } else {
          const safeCountL = Math.max(0, Math.floor(drawL / cartonL));
          const safeCountW = Math.max(0, Math.floor(drawW / cartonW));

          const usedL = safeCountL * cartonL;
          const usedW = safeCountW * cartonW;

          const xStart = -usedL / 2;
          const zStart = -usedW / 2;

          for (let i = 0; i < safeCountL; i++) {
            for (let j = 0; j < safeCountW; j++) {
              if (placed >= activeCartonCount) break;

              const carton = new THREE.Mesh(
                cartonGeometry,
                standardMaterial
              );
              const edges = new THREE.LineSegments(
                edgeGeometry,
                edgeMaterial
              );

              carton.scale.set(cartonL, cartonH, cartonW);
              edges.scale.set(cartonL, cartonH, cartonW);

              const xPos = xStart + cartonL / 2 + i * cartonL;
              const zPos = zStart + cartonW / 2 + j * cartonW;

              carton.position.set(xPos, yOffset, zPos);
              edges.position.set(xPos, yOffset, zPos);

              carton.castShadow = true;
              carton.receiveShadow = true;

              scene.add(carton);
              scene.add(edges);

              placed++;
            }
          }
        }
      }
    }

    // Camera controls with zoom
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let rotX = Math.PI / 4;
    let rotY = 0.3;
    let zoomLevel = 1.0;

    const onDown = (e) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
      mountRef.current.style.cursor = "grabbing";
    };
    const onMove = (e) => {
      if (!isDragging || !mountRef.current) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      rotX += dx * 0.01;
      rotY = Math.max(0.1, Math.min(1.2, rotY - dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onUp = () => {
      isDragging = false;
      if (mountRef.current) mountRef.current.style.cursor = "grab";
    };

    // Zoom with mouse wheel
    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY * -0.001;
      zoomLevel = Math.max(0.3, Math.min(3.0, zoomLevel + delta));
    };

    mountRef.current.addEventListener("mousedown", onDown);
    mountRef.current.addEventListener("mousemove", onMove);
    mountRef.current.addEventListener("mouseup", onUp);
    mountRef.current.addEventListener("mouseleave", onUp);
    mountRef.current.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    mountRef.current.style.cursor = "grab";

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const radius = cameraDistance / zoomLevel;
      const height = (cameraHeight * 0.4 + rotY * cameraHeight * 0.6) / zoomLevel;
      camera.position.x = Math.sin(rotX) * radius;
      camera.position.y = height;
      camera.position.z = Math.cos(rotX) * radius;
      camera.lookAt(0, palletH / 2, 0);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      resizeObserver.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      if (rendererRef.current) rendererRef.current.dispose();
    };
  }, [
    palletL,
    palletW,
    palletH,
    cartonL,
    cartonW,
    cartonH,
    pattern,
    perLayer,
    layers,
    patternRows,
    viewMode,
    effectiveCartons,
    isMulti,
    multiTile,
    hiddenGroups,
  ]);

  const displayLayers = isMulti ? (multiTile.totalLayers || 0) : layers;
  const displayCartonsPerLayer = isMulti ? "–" : perLayer;
  const displayTotalCartons = isMulti
    ? multiTile.totalCartons || 0
    : (perLayer || 0) * (layers || 0);

  // ----------------------------------------------------
  // Render
  // ----------------------------------------------------
  return React.createElement(
    "div",
    { className: "p-4 border rounded-2xl shadow-sm bg-white" },
    React.createElement(
      "div",
      { className: "flex items-center justify-between mb-2" },
      React.createElement("h4", { className: "font-semibold" }, "Container Visualization"),
      React.createElement(
        "div",
        { className: "flex gap-1" },
        React.createElement(
          "button",
          {
            onClick: () => setViewMode("2D"),
            className: `px-3 py-1 text-sm rounded-lg transition-colors ${
              viewMode === "2D"
                ? "bg-teal-500 text-white"
                : "bg-gray-100 hover:bg-gray-200"
            }`,
          },
          "2D"
        ),
        React.createElement(
          "button",
          {
            onClick: () => setViewMode("3D"),
            className: `px-3 py-1 text-sm rounded-lg transition-colors ${
              viewMode === "3D"
                ? "bg-teal-500 text-white"
                : "bg-gray-100 hover:bg-gray-200"
            }`,
          },
          "3D"
        )
      )
    ),

    // Container Navigation (only show if multiple containers)
    totalContainers > 1 && React.createElement(
      "div",
      { className: "flex items-center justify-center gap-3 mb-3 py-2 bg-gray-50 rounded-lg" },
      React.createElement(
        "button",
        {
          onClick: () => onContainerChange(activeContainerIndex - 1),
          disabled: activeContainerIndex === 0,
          className: `px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
            activeContainerIndex === 0
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-teal-500 text-white hover:bg-teal-600"
          }`,
        },
        "← Previous"
      ),
      React.createElement(
        "span",
        { className: "text-sm font-medium text-gray-700 min-w-[140px] text-center" },
        `Container ${activeContainerIndex + 1} of ${totalContainers}`
      ),
      React.createElement(
        "button",
        {
          onClick: () => onContainerChange(activeContainerIndex + 1),
          disabled: activeContainerIndex === totalContainers - 1,
          className: `px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
            activeContainerIndex === totalContainers - 1
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-teal-500 text-white hover:bg-teal-600"
          }`,
        },
        "Next →"
      )
    ),

    viewMode === "3D"
      ? React.createElement(
          React.Fragment,
          null,
          // Group visibility toggles (only for multi-group mode)
          isMulti && groupList.length > 0 && React.createElement(
            "div",
            { className: "flex flex-wrap gap-2 mb-3 p-2 bg-gray-50 rounded-lg" },
            React.createElement("span", { className: "text-xs text-gray-500 mr-2 self-center" }, "Show/Hide:"),
            ...groupList.map(group =>
              React.createElement(
                "button",
                {
                  key: group.id,
                  onClick: () => toggleGroupVisibility(group.id),
                  className: `flex items-center gap-2 px-3 py-1 text-xs rounded-lg transition-all border ${
                    hiddenGroups[group.id]
                      ? "bg-gray-200 text-gray-500 border-gray-300"
                      : "bg-white text-gray-700 border-gray-300 shadow-sm"
                  }`,
                  title: hiddenGroups[group.id] ? `Show ${group.id}` : `Hide ${group.id}`
                },
                React.createElement("span", {
                  className: "w-3 h-3 rounded-sm",
                  style: {
                    backgroundColor: hiddenGroups[group.id]
                      ? "#d1d5db"
                      : (typeof group.color === "number"
                          ? `#${group.color.toString(16).padStart(6, '0')}`
                          : group.color),
                    opacity: hiddenGroups[group.id] ? 0.5 : 1
                  }
                }),
                React.createElement("span", null, group.name),
                React.createElement("span", { className: "text-gray-400" }, `(${group.count})`),
                React.createElement("span", { className: "ml-1" }, hiddenGroups[group.id] ? "👁️‍🗨️" : "👁️")
              )
            )
          ),
          React.createElement("div", {
            ref: mountRef,
            className: "bg-gray-50 rounded-xl overflow-hidden",
            style: { height: "400px" },
          }),
          React.createElement(
            "div",
            {
              className: "text-xs text-gray-500 mt-2 text-center",
            },
            isMulti
              ? "Click and drag to rotate • Scroll to zoom • Colours represent different carton groups"
              : "Click and drag to rotate • Scroll to zoom"
          )
        )
      : React.createElement(LayerGrid2D, {
          spaceL: palletL,
          spaceW: palletW,
          boxL: cartonL,
          boxW: cartonW,
          boxH: cartonH,
          countL: Math.floor(palletL / cartonL),
          countW: Math.floor(palletW / cartonW),
          usedL: Math.floor(palletL / cartonL) * cartonL,
          usedW: Math.floor(palletW / cartonW) * cartonW,
          patternRows: patternRows,
          pattern: palletTile.pattern,
          activeCartons: effectiveCartons,
          multiTile: isMulti ? multiTile : null,
        }),

    // Stats summary
    React.createElement(
      "div",
      { className: "grid grid-cols-2 gap-2 text-sm mt-4" },
      React.createElement(
        "div",
        { className: "grid grid-cols-2 gap-2" },
         React.createElement(
          "div",
          null,
          React.createElement("span", { className: "text-gray-500" }, "Volume usage:"),
          " ",
          volumeUsage.toFixed(1),
          "% (",
          (cartonsVolume / 1000000000).toFixed(2),
          " m³ / ",
          (palletVolume / 1000000000).toFixed(2),
          " m³)"
        ),
        React.createElement(
          "div",
          null,
          React.createElement("span", { className: "text-gray-500" }, "Total cartons:"),
          " ",
          displayTotalCartons
        ),
        React.createElement(
          "div",
          null,
          React.createElement("span", { className: "text-gray-500" }, "Total weight:"),
          " ",
          (displayTotalCartons * cartonWeight).toFixed(1),
          " kg",
          palletGrossMax ? ` (max: ${palletGrossMax.toFixed(0)} kg)` : ""
        ),
        React.createElement(
          "div",
          null,
          React.createElement("span", { className: "text-gray-500" }, "Total inners:"),
          " ",
          totalInners > 0 ? totalInners.toLocaleString() : "—"
        ),
      ),
      React.createElement(
        "div",
        { className: "grid grid-cols-2 gap-2" },
        React.createElement(
          "div",
          null,
          React.createElement("span", { className: "text-gray-500" }, "Surface usage:"),
          " ",
          surfaceUsage.toFixed(1),
          "%"
        ),
        React.createElement(
          "div",
          null,
          React.createElement("span", { className: "text-gray-500" }, "Layers:"),
          " ",
          isMulti ? "multi" : displayLayers
        )
      )
    )
  );
};
