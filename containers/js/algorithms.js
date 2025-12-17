// Enhanced Container Packing Algorithm
// MaxRects-based multi-group packing
// - Uses free-space slicing (MaxRects) in L×W plane
// - Tries all 6 orientations per group
// - Packs layer-by-layer in height (Z)
// - Produces placements compatible with PalletView3D / LayerGrid2D

window.CartonApp = window.CartonApp || {};
window.CartonApp.Constants = window.CartonApp.Constants || {};

// Configuration constants for algorithm behavior
window.CartonApp.Constants.PACKING_CONFIG = {
    STABILITY_THRESHOLD: 0.7,           // 70% support required
    WEIGHT_DISTRIBUTION_TOLERANCE: 0.15,// 15% deviation allowed
    HEIGHT_MAP_RESOLUTION: 10,          // mm per cell (kept for compatibility)
    MIN_SUPPORT_AREA: 0.5,              // 50% of base area must be supported
    EPSILON: 0.001,                     // Tolerance for floating point comparisons
    MAX_ITERATIONS: 5000,
    ENABLE_STABILITY_CHECK: true,
    ENABLE_WEIGHT_OPTIMIZATION: true,
    PREFER_WALL_BUILDING: true          // Now expressed via wall-friendly heuristics
};

window.CartonApp.Algorithms = {
    // ------------------------------------------------
    // Single-box tiling (kept, used by single-carton mode)
    // ------------------------------------------------
    bestTile: function (boxL, boxW, boxH, spaceL, spaceW, spaceH, allowVerticalFlip = true) {
        if (boxL <= 0 || boxW <= 0 || boxH <= 0 || spaceL <= 0 || spaceW <= 0 || spaceH <= 0) {
            return emptyResult();
        }

        const orientations = [
            { l: boxL, w: boxW, h: boxH, label: "upright", stability: 1.0 },
            { l: boxW, w: boxL, h: boxH, label: "upright-rotated", stability: 1.0 }
        ];

        if (allowVerticalFlip) {
            orientations.push(
                { l: boxW, w: boxH, h: boxL, label: "laid-side-l", stability: 0.9 },
                { l: boxL, w: boxH, h: boxW, label: "laid-side-w", stability: 0.9 },
                { l: boxH, w: boxL, h: boxW, label: "laid-h-l", stability: 0.85 },
                { l: boxH, w: boxW, h: boxL, label: "laid-h-w", stability: 0.85 }
            );
        }

        const palletVariants = [
            { L: spaceL, W: spaceW, swapped: false },
            { L: spaceW, W: spaceL, swapped: true }
        ];

        const candidates = [];

        const fitPattern = (o, pallet, labelSuffix = "") => {
            const countL = Math.floor(pallet.L / o.l);
            const countW = Math.floor(pallet.W / o.w);
            const layers = Math.floor(spaceH / o.h);
            if (countL <= 0 || countW <= 0 || layers <= 0) return null;

            const perLayer = countL * countW;

            const aspectRatio = Math.max(o.l, o.w) / Math.min(o.l, o.w);
            const heightRatio = o.h / Math.max(o.l, o.w);
            const stabilityScore =
                o.stability *
                (1 / (1 + aspectRatio * 0.1)) *
                (1 / (1 + heightRatio * 0.2));

            return {
                pattern: o.label + labelSuffix,
                countL,
                countW,
                layers,
                perLayer,
                total: perLayer * layers,
                boxL: o.l,
                boxW: o.w,
                boxH: o.h,
                usedL: countL * o.l,
                usedW: countW * o.w,
                usedH: layers * o.h,
                patternRows: null,
                palletSwapped: pallet.swapped,
                stabilityScore,
                volumeEfficiency:
                    (countL * o.l * countW * o.w * layers * o.h) /
                    (pallet.L * pallet.W * spaceH)
            };
        };

        const fitMixed = (o, pallet, labelSuffix = "") => {
            if (o.l === o.w) return null;
            const layers = Math.floor(spaceH / o.h);
            if (layers <= 0) return null;

            const patternRows = [];
            let remainingW = pallet.W;
            let totalInLayer = 0;
            let usedL = 0;
            let usedW = 0;
            let rowIndex = 0;

            while (remainingW >= Math.min(o.l, o.w)) {
                const rotated = rowIndex % 2 === 1;
                const rowL = rotated ? o.w : o.l;
                const rowW = rotated ? o.l : o.w;

                if (remainingW < rowW) break;
                const cols = Math.floor(pallet.L / rowL);
                if (cols <= 0) break;

                patternRows.push({
                    rotated,
                    countL: cols,
                    boxL: rowL,
                    boxW: rowW,
                    interlocked: true
                });
                totalInLayer += cols;
                usedL = Math.max(usedL, cols * rowL);
                usedW += rowW;
                remainingW -= rowW;
                rowIndex++;
            }

            if (!patternRows.length) return null;

            const stabilityScore = o.stability * 1.15;

            return {
                pattern: "mixed-" + o.label + labelSuffix,
                countL: null,
                countW: null,
                layers,
                perLayer: totalInLayer,
                total: totalInLayer * layers,
                boxL: o.l,
                boxW: o.w,
                boxH: o.h,
                usedL,
                usedW,
                usedH: layers * o.h,
                patternRows,
                palletSwapped: pallet.swapped,
                stabilityScore,
                volumeEfficiency:
                    (totalInLayer * o.l * o.w * o.h * layers) /
                    (pallet.L * pallet.W * spaceH)
            };
        };

        palletVariants.forEach((pallet) => {
            orientations.forEach((o) => {
                const uniform = fitPattern(o, pallet, pallet.swapped ? "-pallet-swapped" : "");
                if (uniform) candidates.push(uniform);

                const mixed = fitMixed(o, pallet, pallet.swapped ? "-pallet-swapped" : "");
                if (mixed) candidates.push(mixed);
            });
        });

        if (!candidates.length) return emptyResult();

        candidates.sort((a, b) => {
            const totalDiff = b.total - a.total;
            if (Math.abs(totalDiff) > 1) return totalDiff;

            const stabilityDiff = (b.stabilityScore || 0) - (a.stabilityScore || 0);
            if (Math.abs(stabilityDiff) > 0.05) return stabilityDiff;

            return (b.volumeEfficiency || 0) - (a.volumeEfficiency || 0);
        });

        return candidates[0];
    },

    // ------------------------------------------------
    // Multi-group packing (MaxRects-driven)
    // ------------------------------------------------
    packGroups: function packGroups(groups, limits, allowVerticalFlip) {
        const palletL = Number(limits.palletL) || 0;
        const palletW = Number(limits.palletW) || 0;
        const palletH = Number(limits.palletH) || 0;
        const config = window.CartonApp.Constants.PACKING_CONFIG;

        if (palletL <= 0 || palletW <= 0 || palletH <= 0) {
            return {
                multi: true,
                palletL,
                palletW,
                palletH,
                totalCartons: 0,
                totalLayers: 0,
                totalVolume: 0,
                usedL: 0,
                usedW: 0,
                usedH: 0,
                groups: [],
                palletSwapped: false,
                stability: { score: 0, issues: [] },
                weightDistribution: { centerOfMass: { x: 0, y: 0, z: 0 } }
            };
        }

        // Prepare group data
        const groupData = (groups || []).map((g, index) => {
            const l = Number(g.l) || 0;
            const w = Number(g.w) || 0;
            const h = Number(g.h) || 0;
            const qty = Math.max(0, Number(g.qty) || 0);
            const weight = Number(g.weight) || 1;
            const color = g.color || (window.CartonApp.Constants.GROUP_COLORS
                ? window.CartonApp.Constants.GROUP_COLORS[index % window.CartonApp.Constants.GROUP_COLORS.length]
                : "#4a9eff");

            // Use per-group allowVerticalFlip if defined, otherwise fall back to global setting
            const groupAllowVerticalFlip = g.allowVerticalFlip !== undefined ? g.allowVerticalFlip : allowVerticalFlip;

            const orientations = window.CartonApp.Algorithms.generateOrientationsWithStability(
                l, w, h, groupAllowVerticalFlip
            );

            const validOrientations = orientations.filter(o =>
                o.l > 0 && o.w > 0 && o.h > 0 &&
                o.l <= palletL && o.w <= palletW && o.h <= palletH
            );

            return {
                id: g.id,
                name: g.name,
                color,
                l,
                w,
                h,
                originalQty: qty,
                remainingQty: qty,
                weight,
                validOrientations,
                placements: [],
                placedCount: 0,
                volume: l * w * h,
                density: weight / (l * w * h || 1)
            };
        });

        const activeGroups = groupData
            .filter(g => g.remainingQty > 0 && g.validOrientations.length > 0)
            .sort((a, b) => {
                if (config.ENABLE_WEIGHT_OPTIMIZATION) {
                    return b.density - a.density;
                }
                return b.volume - a.volume;
            });

        if (!activeGroups.length) {
            return window.CartonApp.Algorithms.createEmptyResult(
                palletL, palletW, palletH, groupData
            );
        }

        // Choose best orientation per group (still try all later in MaxRects)
        activeGroups.forEach(group => {
            const bestOrientation = window.CartonApp.Algorithms.selectBestOrientation(
                group.validOrientations,
                palletL, palletW, palletH,
                config
            );
            group.boxL = bestOrientation.l;
            group.boxW = bestOrientation.w;
            group.boxH = bestOrientation.h;
            group.orientationLabel = bestOrientation.label;
            group.stabilityScore = bestOrientation.stabilityScore;
        });

        // Run MaxRects-based 3D-ish packing (layer by layer in height)
        const packingResult = window.CartonApp.Algorithms.runMaxRectsPacking(
            activeGroups,
            palletL,
            palletW,
            palletH,
            config
        );

        const allPlacements = packingResult.placements;
        let totalCartons = 0;
        let totalVolume = 0;
        let maxUsedH = 0;

        let minUsedL = palletL;
        let maxUsedL = 0;
        let minUsedW = palletW;
        let maxUsedW = 0;

        let totalWeight = 0;
        let weightedX = 0;
        let weightedY = 0;
        let weightedZ = 0;

        allPlacements.forEach(p => {
            totalCartons++;
            totalVolume += p.volume || (p.l * p.w * p.h);
            maxUsedH = Math.max(maxUsedH, (p.localH || 0) + p.h);

            minUsedL = Math.min(minUsedL, p.localL);
            maxUsedL = Math.max(maxUsedL, p.localL + p.l);
            minUsedW = Math.min(minUsedW, p.localW);
            maxUsedW = Math.max(maxUsedW, p.localW + p.w);

            const w = p.weight || 0;
            totalWeight += w;
            weightedX += (p.x || 0) * w;
            weightedY += (p.y || 0) * w;
            weightedZ += (p.z || 0) * w;
        });

        const usedL = totalCartons > 0 && maxUsedL > minUsedL ? maxUsedL - minUsedL : 0;
        const usedW = totalCartons > 0 && maxUsedW > minUsedW ? maxUsedW - minUsedW : 0;
        const usedH = maxUsedH;

        // Stability analysis (support calculation)
        if (config.ENABLE_STABILITY_CHECK && allPlacements.length > 0) {
            // Sort placements by height so support checks see lower boxes first
            allPlacements.sort((a, b) => (a.localH || 0) - (b.localH || 0));
            window.CartonApp.Algorithms.calculateSupport(allPlacements);
        }

        const stabilityResult = config.ENABLE_STABILITY_CHECK && allPlacements.length > 0
            ? window.CartonApp.Algorithms.analyzeStability(allPlacements, config)
            : { score: 1, issues: [], isStable: true, recommendation: "" };

        // Center of mass
        const centerOfMass = totalWeight > 0 ? {
            x: weightedX / totalWeight,
            y: weightedY / totalWeight,
            z: weightedZ / totalWeight
        } : { x: 0, y: 0, z: 0 };

        const weightDistribution = {
            centerOfMass,
            isBalanced: window.CartonApp.Algorithms.isWeightBalanced(
                centerOfMass, palletL, palletW, palletH, config
            ),
            deviation: window.CartonApp.Algorithms.calculateDeviation(
                centerOfMass,
                { x: 0, y: palletH / 4, z: 0 }
            )
        };

        // Build group results (preserve original groups, even those that couldn't be placed)
        const resultGroups = groupData.map(group => ({
            id: group.id,
            name: group.name,
            color: group.color,
            l: group.l,
            w: group.w,
            h: group.h,
            qty: group.originalQty,
            weight: group.weight,
            placedQty: group.placedCount || 0,
            placements: group.placements || []
        }));

        // Layer count: unique localH values
        const allHeights = new Set();
        resultGroups.forEach(g => {
            (g.placements || []).forEach(p => {
                allHeights.add(p.localH || 0);
            });
        });
        const totalLayers = allHeights.size || 0;

        return {
            multi: true,
            palletL,
            palletW,
            palletH,
            totalCartons,
            totalLayers,
            totalVolume,
            usedL,
            usedW,
            usedH,
            maxHeight: usedH,
            groups: resultGroups,
            palletSwapped: false,
            stability: stabilityResult,
            weightDistribution,
            volumeUtilization: (totalVolume / (palletL * palletW * palletH)) * 100,
            packingDensity: totalCartons > 0 && usedL > 0 && usedW > 0 && usedH > 0
                ? totalVolume / (usedL * usedW * usedH)
                : 0
        };
    },

    // ------------------------------------------------
    // Orientation helpers (6 orientations + stability)
    // ------------------------------------------------
    generateOrientationsWithStability: function (l, w, h, allowVerticalFlip) {
        const orientations = [
            { l, w, h, label: "upright",          stabilityScore: 1.0 },
            { l: w, w: l, h, label: "upright-rotated", stabilityScore: 1.0 }
        ];

        if (allowVerticalFlip) {
            orientations.push(
                {
                    l: w, w: h, h: l,
                    label: "laid-side-l",
                    stabilityScore: window.CartonApp.Algorithms
                        .calculateOrientationStability(w, h, l)
                },
                {
                    l, w: h, h: w,
                    label: "laid-side-w",
                    stabilityScore: window.CartonApp.Algorithms
                        .calculateOrientationStability(l, h, w)
                },
                {
                    l: h, w: l, h: w,
                    label: "laid-h-l",
                    stabilityScore: window.CartonApp.Algorithms
                        .calculateOrientationStability(h, l, w)
                },
                {
                    l: h, w, h: l,
                    label: "laid-h-w",
                    stabilityScore: window.CartonApp.Algorithms
                        .calculateOrientationStability(h, w, l)
                }
            );
        }

        return orientations;
    },

    calculateOrientationStability: function (l, w, h) {
        const baseArea = l * w;
        if (baseArea <= 0) return 0;

        const height = h;
        const aspectRatio = Math.max(l, w) / Math.min(l, w || 1);
        const heightRatio = height / Math.sqrt(baseArea);
        const squareness = 1 / (1 + Math.abs(aspectRatio - 1));

        return (1 / (1 + heightRatio * 0.5)) * (0.7 + squareness * 0.3);
    },

    selectBestOrientation: function (orientations, palletL, palletW, palletH, config) {
        let bestOrientation = orientations[0];
        let bestScore = -Infinity;

        for (const o of orientations) {
            if (o.l <= 0 || o.w <= 0 || o.h <= 0) continue;
            if (o.l > palletL || o.w > palletW || o.h > palletH) continue;

            const fitL = Math.floor(palletL / o.l);
            const fitW = Math.floor(palletW / o.w);
            const fitH = Math.floor(palletH / o.h);

            const volumeScore = fitL * fitW * fitH;
            const stabilityScore = o.stabilityScore || 1;
            const heightEfficiency = (fitH * o.h) / palletH;

            const score = volumeScore * stabilityScore * (0.8 + heightEfficiency * 0.2);

            if (score > bestScore) {
                bestScore = score;
                bestOrientation = o;
            }
        }

        return bestOrientation;
    },

    // ------------------------------------------------
    // SeaRates-Style Greedy Packing with Heightmap
    // - Uses heightmap for proper stacking
    // - Greedy placement: lowest floor first, back-to-front, left-to-right
    // - Tries ALL 6 ORIENTATIONS for each box at each position
    // ------------------------------------------------
    runMaxRectsPacking: function (groups, palletL, palletW, palletH, config) {
        const startTime = performance.now();
        const placements = [];

        // Sort groups by volume (largest first)
        const sortedGroups = [...groups].sort((a, b) => {
            const volA = a.boxL * a.boxW * a.boxH;
            const volB = b.boxL * b.boxW * b.boxH;
            return volB - volA;
        });

        console.log(`[runMaxRectsPacking] Groups sorted by volume:`,
            sortedGroups.map(g => `${g.boxL}x${g.boxW}x${g.boxH}`));

        // Generate all 6 orientations for a box (using original dimensions from group)
        const getOrientations = (group) => {
            const l = group.l;
            const w = group.w;
            const h = group.h;
            const orientations = [
                { l: l, w: w, h: h, label: 'LWH' },
                { l: l, w: h, h: w, label: 'LHW' },
                { l: w, w: l, h: h, label: 'WLH' },
                { l: w, w: h, h: l, label: 'WHL' },
                { l: h, w: l, h: w, label: 'HLW' },
                { l: h, w: w, h: l, label: 'HWL' }
            ];
            // Remove duplicates and filter to only those that fit container
            const seen = new Set();
            return orientations.filter(o => {
                const key = `${o.l},${o.w},${o.h}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return o.l <= palletL && o.w <= palletW && o.h <= palletH;
            });
        };

        // Heightmap for tracking floor level at each position
        const resolution = 50;
        const gridL = Math.ceil(palletL / resolution);
        const gridW = Math.ceil(palletW / resolution);
        const heightMap = [];
        for (let i = 0; i < gridL; i++) {
            heightMap[i] = new Array(gridW).fill(0);
        }

        // Get floor height at a position
        const getFloorHeight = (posL, posW, boxL, boxW) => {
            const startI = Math.floor(posL / resolution);
            const startJ = Math.floor(posW / resolution);
            const endI = Math.min(gridL, Math.ceil((posL + boxL) / resolution));
            const endJ = Math.min(gridW, Math.ceil((posW + boxW) / resolution));

            let maxH = 0;
            for (let i = startI; i < endI; i++) {
                for (let j = startJ; j < endJ; j++) {
                    if (heightMap[i] && heightMap[i][j] > maxH) {
                        maxH = heightMap[i][j];
                    }
                }
            }
            return maxH;
        };

        // Update heightmap after placement
        const setFloorHeight = (posL, posW, boxL, boxW, newHeight) => {
            const startI = Math.floor(posL / resolution);
            const startJ = Math.floor(posW / resolution);
            const endI = Math.min(gridL, Math.ceil((posL + boxL) / resolution));
            const endJ = Math.min(gridW, Math.ceil((posW + boxW) / resolution));

            for (let i = startI; i < endI; i++) {
                for (let j = startJ; j < endJ; j++) {
                    if (heightMap[i]) {
                        heightMap[i][j] = newHeight;
                    }
                }
            }
        };

        // Helper: check if any group has boxes left
        const hasRemainingBoxes = () => sortedGroups.some(g => g.remainingQty > 0);

        // Collect candidate positions
        const getCandidatePositions = () => {
            const positions = [];
            const seen = new Set();

            const addPos = (posL, posW) => {
                const key = `${posL},${posW}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    positions.push({ posL, posW });
                }
            };

            // Grid positions (sparse for speed)
            for (let i = 0; i < gridL; i++) {
                for (let j = 0; j < gridW; j++) {
                    addPos(i * resolution, j * resolution);
                }
            }

            // Corner positions from placed boxes (for tight packing)
            for (const p of placements) {
                addPos(p.localL + p.l, p.localW);
                addPos(p.localL, p.localW + p.w);
                addPos(p.localL + p.l, p.localW + p.w);
            }

            return positions;
        };

        // Main packing loop
        const maxIterations = 50000;
        let iterations = 0;

        while (hasRemainingBoxes() && iterations < maxIterations) {
            iterations++;

            let bestPlacement = null;
            let bestScore = Infinity;
            let bestGroup = null;
            let bestOrient = null;

            const candidates = getCandidatePositions();

            // For each group, try ALL orientations at ALL positions
            for (const group of sortedGroups) {
                if (group.remainingQty <= 0) continue;

                const orientations = getOrientations(group);

                for (const orient of orientations) {
                    const boxL = orient.l;
                    const boxW = orient.w;
                    const boxH = orient.h;

                    for (const { posL, posW } of candidates) {
                        if (posL + boxL > palletL || posW + boxW > palletW) continue;

                        const floorH = getFloorHeight(posL, posW, boxL, boxW);
                        if (floorH + boxH > palletH) continue;

                        // Score: prefer low floor, then back, then left
                        // Bonus for larger boxes
                        const volumeBonus = (boxL * boxW * boxH) / 1000000;
                        const score = floorH * 100000 + posL * 100 + posW - volumeBonus * 1000;

                        if (score < bestScore) {
                            bestScore = score;
                            bestGroup = group;
                            bestOrient = orient;
                            bestPlacement = { posL, posW, floorH };
                        }
                    }
                }
            }

            if (!bestPlacement || !bestGroup || !bestOrient) break;

            // Place the box with best orientation
            const boxL = bestOrient.l;
            const boxW = bestOrient.w;
            const boxH = bestOrient.h;

            const placement = {
                x: bestPlacement.posL + boxL / 2 - palletL / 2,
                y: bestPlacement.floorH + boxH / 2 + 100,
                z: bestPlacement.posW + boxW / 2 - palletW / 2,
                l: boxL,
                w: boxW,
                h: boxH,
                groupId: bestGroup.id,
                color: bestGroup.color,
                orientation: bestOrient.label,
                localL: bestPlacement.posL,
                localW: bestPlacement.posW,
                localH: bestPlacement.floorH,
                volume: boxL * boxW * boxH,
                weight: bestGroup.weight,
                support: bestPlacement.floorH === 0 ? 1.0 : 0
            };

            placements.push(placement);
            bestGroup.placements.push(placement);
            bestGroup.remainingQty--;
            bestGroup.placedCount = (bestGroup.placedCount || 0) + 1;

            // Update heightmap
            setFloorHeight(bestPlacement.posL, bestPlacement.posW, boxL, boxW, bestPlacement.floorH + boxH);
        }

        // Calculate max height used
        let maxUsedH = 0;
        for (const p of placements) {
            const top = p.localH + p.h;
            if (top > maxUsedH) maxUsedH = top;
        }

        const elapsed = performance.now() - startTime;
        console.log(`[runMaxRectsPacking] Done in ${elapsed.toFixed(0)}ms, ${placements.length} placed, ${iterations} iterations`);

        return {
            placements,
            usedHeight: maxUsedH
        };
    },

    // ------------------------------------------------
    // Stability + weight helpers
    // ------------------------------------------------
    calculateSupport: function (placements) {
        const config = window.CartonApp.Constants.PACKING_CONFIG;

        for (let i = 0; i < placements.length; i++) {
            const box = placements[i];

            if ((box.localH || 0) === 0) {
                box.support = 1.0;
                continue;
            }

            let supportArea = 0;
            const boxArea = box.l * box.w;

            for (let j = 0; j < i; j++) {
                const below = placements[j];

                if (Math.abs((below.localH || 0) + below.h - (box.localH || 0)) < config.EPSILON) {
                    const overlapL = Math.min(box.localL + box.l, below.localL + below.l) -
                        Math.max(box.localL, below.localL);
                    const overlapW = Math.min(box.localW + box.w, below.localW + below.w) -
                        Math.max(box.localW, below.localW);

                    if (overlapL > 0 && overlapW > 0) {
                        supportArea += overlapL * overlapW;
                    }
                }
            }

            box.support = boxArea > 0 ? supportArea / boxArea : 0;
        }
    },

    analyzeStability: function (placements, config) {
        const issues = [];
        let totalScore = 0;
        let count = 0;

        for (const placement of placements) {
            count++;
            const support = placement.support || 0;
            totalScore += support;

            if (support < config.STABILITY_THRESHOLD) {
                issues.push({
                    position: { x: placement.x, y: placement.y, z: placement.z },
                    support: support,
                    recommendation: window.CartonApp.Algorithms.getStabilityRecommendation(support)
                });
            }
        }

        const averageScore = count > 0 ? totalScore / count : 1;

        return {
            score: averageScore,
            issues: issues,
            isStable: issues.length === 0,
            recommendation: window.CartonApp.Algorithms.getOverallRecommendation(
                averageScore,
                issues.length
            )
        };
    },

    getStabilityRecommendation: function (support) {
        if (support < 0.3) {
            return "Critical: Less than 30% support. High risk of falling.";
        } else if (support < 0.5) {
            return "Warning: Less than 50% support. May shift during transport.";
        } else if (support < 0.7) {
            return "Caution: Marginal support. Consider repositioning.";
        }
        return "Acceptable support level.";
    },

    getOverallRecommendation: function (score, issueCount) {
        if (score > 0.9 && issueCount === 0) {
            return "Excellent stability. Load is well-balanced and secure.";
        } else if (score > 0.8 && issueCount <= 2) {
            return "Good stability with minor issues. Check highlighted items.";
        } else if (score > 0.7) {
            return "Acceptable stability. Some adjustments recommended.";
        } else if (score > 0.5) {
            return "Poor stability. Significant adjustments needed.";
        }
        return "Critical stability issues. Complete reorganization recommended.";
    },

    isWeightBalanced: function (centerOfMass, palletL, palletW, palletH, config) {
        const idealCenter = { x: 0, y: palletH * 0.25, z: 0 };
        const deviation = window.CartonApp.Algorithms.calculateDeviation(centerOfMass, idealCenter);
        const maxDeviation =
            Math.sqrt(palletL * palletL + palletW * palletW) *
            config.WEIGHT_DISTRIBUTION_TOLERANCE;
        return deviation <= maxDeviation;
    },

    calculateDeviation: function (point1, point2) {
        return Math.sqrt(
            Math.pow(point1.x - point2.x, 2) +
            Math.pow(point1.y - point2.y, 2) +
            Math.pow(point1.z - point2.z, 2)
        );
    },

    // ------------------------------------------------
    // Empty result structure
    // ------------------------------------------------
    createEmptyResult: function (palletL, palletW, palletH, groupData) {
        return {
            multi: true,
            palletL,
            palletW,
            palletH,
            totalCartons: 0,
            totalLayers: 0,
            totalVolume: 0,
            usedL: 0,
            usedW: 0,
            usedH: 0,
            groups: groupData.map(g => ({
                id: g.id,
                name: g.name,
                color: g.color,
                l: g.l,
                w: g.w,
                h: g.h,
                qty: g.originalQty,
                weight: g.weight,
                placedQty: 0,
                placements: []
            })),
            palletSwapped: false,
            stability: { score: 1, issues: [], isStable: true, recommendation: "" },
            weightDistribution: {
                centerOfMass: { x: 0, y: 0, z: 0 },
                isBalanced: true,
                deviation: 0
            }
        };
    },

    // ------------------------------------------------
    // Multi-container wrapper (kept, calls new packGroups)
    // ------------------------------------------------
    packMultipleContainers: function packMultipleContainers(
        groups,
        containers,
        allowVerticalFlip,
        spreadAcrossContainers
    ) {
        console.log('[packMultipleContainers] Called with', containers.length, 'containers, first:', containers[0]?.type);

        if (!Array.isArray(groups) || !Array.isArray(containers) || containers.length === 0) {
            return [];
        }

        let workingGroups;
        let spreadAllocations = null;

        if (spreadAcrossContainers && containers.length > 1) {
            spreadAllocations = groups.map(g => {
                const totalQty = Number(g.qty) || 0;
                const baseQty = Math.floor(totalQty / containers.length);
                const remainder = totalQty % containers.length;

                const allocations = containers.map((_, idx) =>
                    idx < remainder ? baseQty + 1 : baseQty
                );

                return {
                    groupId: g.id,
                    totalQty,
                    allocations
                };
            });

            workingGroups = groups.map((g, idx) => ({
                ...g,
                qty: spreadAllocations[idx].allocations[0]
            }));
        } else {
            workingGroups = groups.map(g => ({
                ...g,
                qty: Number(g.qty) || 0
            }));
        }

        const remainingGroups = workingGroups.map(g => ({ ...g }));
        const containerResults = [];

        for (let containerIndex = 0; containerIndex < containers.length; containerIndex++) {
            const container = containers[containerIndex];

            if (spreadAcrossContainers && spreadAllocations) {
                remainingGroups.forEach((g, idx) => {
                    g.qty = spreadAllocations[idx].allocations[containerIndex];
                });
            }

            const totalRemaining = remainingGroups.reduce(
                (sum, g) => sum + (g.qty || 0),
                0
            );
            if (totalRemaining === 0) {
                containerResults.push({
                    containerId: container.id,
                    containerIndex,
                    multi: true,
                    palletL: container.L,
                    palletW: container.W,
                    palletH: container.H,
                    totalCartons: 0,
                    totalLayers: 0,
                    totalVolume: 0,
                    totalWeight: 0,
                    usedL: 0,
                    usedW: 0,
                    usedH: 0,
                    groups: remainingGroups.map(g => ({
                        id: g.id,
                        name: g.name,
                        color: g.color,
                        l: g.l,
                        w: g.w,
                        h: g.h,
                        qty: 0,
                        weight: Number(g.weight) || 0,
                        placedQty: 0,
                        placements: []
                    })),
                    palletSwapped: false,
                    stability: { score: 1, issues: [], isStable: true, recommendation: "" },
                    weightDistribution: {
                        centerOfMass: { x: 0, y: 0, z: 0 },
                        isBalanced: true,
                        deviation: 0
                    }
                });
                continue;
            }

            const containerLimits = {
                palletL: container.L,
                palletW: container.W,
                palletH: container.H,
                palletGrossMax: container.weightLimit
            };

            let groupsForThisContainer = remainingGroups;
            if (Array.isArray(container.allowedGroups) && container.allowedGroups.length > 0) {
                groupsForThisContainer = remainingGroups.map(g => {
                    const isAllowed = container.allowedGroups.includes(g.id);
                    return isAllowed ? g : { ...g, qty: 0 };
                });
            }

            const packResult = window.CartonApp.Algorithms.packGroups(
                groupsForThisContainer,
                containerLimits,
                allowVerticalFlip
            );

            const correctedGroups = packResult.groups.map((packedGroup, idx) => {
                const placed = packedGroup.placedQty || 0;

                if (!spreadAcrossContainers || containers.length <= 1) {
                    remainingGroups[idx].qty = Math.max(
                        0,
                        (remainingGroups[idx].qty || 0) - placed
                    );
                }

                return {
                    ...packedGroup,
                    qty: placed
                };
            });

            const totalWeight = correctedGroups.reduce((sum, g) => {
                const weight = Number(g.weight) || 0;
                const placed = Number(g.placedQty) || 0;
                return sum + weight * placed;
            }, 0);

            containerResults.push({
                ...packResult,
                groups: correctedGroups,
                containerId: container.id,
                containerIndex,
                totalWeight
            });
        }

        return containerResults;
    },

    // ------------------------------------------------
    // Container recommendation with cost-weight optimization
    // Prefers cost-efficient combinations:
    // - 1x 20' if it fits
    // - 1x 40'HC over 2x 20' (40'HC cost 1.5 < 2x 20' cost 2.0)
    // - 1x 40'HC + 1x 20' over 2x 40'HC (cost 2.5 < cost 3.0)
    // ------------------------------------------------
    recommendContainers: function recommendContainers(
        groups,
        availableContainerTypes,
        allowVerticalFlip
    ) {
        console.log('[recommendContainers] Starting with cost optimization...');

        if (!Array.isArray(groups) || groups.length === 0) {
            return [];
        }

        const validTypes = availableContainerTypes.filter(
            t => t.L && t.W && t.H && t.WeightLimit
        );

        if (validTypes.length === 0) {
            return [];
        }

        const totalCartons = groups.reduce(
            (sum, g) => sum + (Number(g.qty) || 0),
            0
        );

        if (totalCartons === 0) {
            return [];
        }

        // Test capacity for each container type
        const typeCapacities = validTypes.map(type => {
            const testContainer = [{
                id: "test",
                type: type.label,
                L: type.L,
                W: type.W,
                H: type.H,
                weightLimit: type.WeightLimit
            }];

            const result = window.CartonApp.Algorithms.packMultipleContainers(
                groups,
                testContainer,
                allowVerticalFlip,
                false
            );

            return {
                type,
                capacity: result[0] ? result[0].totalCartons : 0,
                costWeight: type.costWeight || 1.0
            };
        }).filter(t => t.capacity > 0);

        if (typeCapacities.length === 0) {
            return [];
        }

        // Sort by capacity (largest first) for efficient searching
        typeCapacities.sort((a, b) => b.capacity - a.capacity);

        // Generate candidate configurations
        const candidates = [];
        const maxContainers = 4; // Limit search space

        // Helper to test a configuration
        const testConfig = (containerList) => {
            const result = window.CartonApp.Algorithms.packMultipleContainers(
                groups,
                containerList,
                allowVerticalFlip,
                false
            );

            const totalPlaced = result.reduce((sum, r) => sum + (r.totalCartons || 0), 0);
            const totalCost = containerList.reduce((sum, c) => {
                const typeInfo = typeCapacities.find(t => t.type.label === c.type);
                return sum + (typeInfo ? typeInfo.costWeight : 1.0);
            }, 0);

            return { totalPlaced, totalCost, containers: containerList };
        };

        // Strategy 1: Single container types (1x, 2x, 3x of same type)
        for (const typeInfo of typeCapacities) {
            for (let count = 1; count <= maxContainers; count++) {
                const containers = Array.from({ length: count }, (_, idx) => ({
                    id: Date.now() + idx,
                    type: typeInfo.type.label,
                    L: typeInfo.type.L,
                    W: typeInfo.type.W,
                    H: typeInfo.type.H,
                    weightLimit: typeInfo.type.WeightLimit
                }));

                const result = testConfig(containers);
                if (result.totalPlaced >= totalCartons) {
                    candidates.push(result);
                    break; // Found minimum count for this type
                }
            }
        }

        // Strategy 2: Mixed combinations (e.g., 1x 40'HC + 1x 20')
        // Try combinations of different container types
        for (let i = 0; i < typeCapacities.length; i++) {
            for (let j = i; j < typeCapacities.length; j++) {
                const type1 = typeCapacities[i];
                const type2 = typeCapacities[j];

                // Try 1 of each
                if (i !== j) {
                    const containers = [
                        {
                            id: Date.now(),
                            type: type1.type.label,
                            L: type1.type.L,
                            W: type1.type.W,
                            H: type1.type.H,
                            weightLimit: type1.type.WeightLimit
                        },
                        {
                            id: Date.now() + 1,
                            type: type2.type.label,
                            L: type2.type.L,
                            W: type2.type.W,
                            H: type2.type.H,
                            weightLimit: type2.type.WeightLimit
                        }
                    ];

                    const result = testConfig(containers);
                    if (result.totalPlaced >= totalCartons) {
                        candidates.push(result);
                    }
                }

                // Try 1 large + 2 smaller (common: 1x 40'HC + 2x 20')
                if (i !== j && type1.capacity > type2.capacity) {
                    const containers = [
                        {
                            id: Date.now(),
                            type: type1.type.label,
                            L: type1.type.L,
                            W: type1.type.W,
                            H: type1.type.H,
                            weightLimit: type1.type.WeightLimit
                        },
                        {
                            id: Date.now() + 1,
                            type: type2.type.label,
                            L: type2.type.L,
                            W: type2.type.W,
                            H: type2.type.H,
                            weightLimit: type2.type.WeightLimit
                        },
                        {
                            id: Date.now() + 2,
                            type: type2.type.label,
                            L: type2.type.L,
                            W: type2.type.W,
                            H: type2.type.H,
                            weightLimit: type2.type.WeightLimit
                        }
                    ];

                    const result = testConfig(containers);
                    if (result.totalPlaced >= totalCartons) {
                        candidates.push(result);
                    }
                }
            }
        }

        if (candidates.length === 0) {
            // Fallback: just use largest containers
            const largest = typeCapacities[0];
            const numNeeded = Math.ceil(totalCartons / largest.capacity);
            return Array.from({ length: numNeeded }, (_, idx) => ({
                id: Date.now() + idx,
                type: largest.type.label,
                L: largest.type.L,
                W: largest.type.W,
                H: largest.type.H,
                weightLimit: largest.type.WeightLimit
            }));
        }

        // Score candidates: lower cost is better, prefer higher utilization
        candidates.sort((a, b) => {
            // Primary: lower total cost
            const costDiff = a.totalCost - b.totalCost;
            if (Math.abs(costDiff) > 0.01) return costDiff;

            // Secondary: fewer containers
            const countDiff = a.containers.length - b.containers.length;
            if (countDiff !== 0) return countDiff;

            // Tertiary: higher utilization (more cartons placed beyond minimum)
            return b.totalPlaced - a.totalPlaced;
        });

        console.log('[recommendContainers] Best config:',
            candidates[0].containers.map(c => c.type).join(' + '),
            'cost:', candidates[0].totalCost,
            'placed:', candidates[0].totalPlaced);

        return candidates[0].containers;
    }
};

// ----------------------------------------------------
// Helper for empty result used by bestTile
// ----------------------------------------------------
function emptyResult() {
    return {
        countL: 0,
        countW: 0,
        layers: 0,
        perLayer: 0,
        total: 0,
        boxL: 0,
        boxW: 0,
        boxH: 0,
        usedL: 0,
        usedW: 0,
        usedH: 0,
        pattern: "none",
        patternRows: null,
        palletSwapped: false,
        stabilityScore: 0,
        volumeEfficiency: 0
    };
}

// ----------------------------------------------------
// (Legacy) HeightMap + SpaceManager left for compatibility
// (currently unused by MaxRects, but kept so nothing else breaks)
// ----------------------------------------------------
class EnhancedHeightMap {
    constructor(length, width, resolution) {
        this.resolution = resolution;
        this.gridL = Math.ceil(length / resolution);
        this.gridW = Math.ceil(width / resolution);
        this.heightMap = [];
        this.supportMap = [];

        for (let i = 0; i < this.gridL; i++) {
            this.heightMap[i] = new Array(this.gridW).fill(0);
            this.supportMap[i] = new Array(this.gridW).fill(null);
        }
    }

    getBaseHeight(posL, posW, boxL, boxW) {
        const startI = Math.floor(posL / this.resolution);
        const startJ = Math.floor(posW / this.resolution);
        const endI = Math.min(this.gridL, Math.ceil((posL + boxL) / this.resolution));
        const endJ = Math.min(this.gridW, Math.ceil((posW + boxW) / this.resolution));

        let maxH = 0;
        for (let i = startI; i < endI; i++) {
            for (let j = startJ; j < endJ; j++) {
                if (this.heightMap[i] && this.heightMap[i][j] > maxH) {
                    maxH = this.heightMap[i][j];
                }
            }
        }
        return maxH;
    }

    setHeight(posL, posW, boxL, boxW, newHeight, boxId = null) {
        const startI = Math.floor(posL / this.resolution);
        const startJ = Math.floor(posW / this.resolution);
        const endI = Math.min(this.gridL, Math.ceil((posL + boxL) / this.resolution));
        const endJ = Math.min(this.gridW, Math.ceil((posW + boxW) / this.resolution));

        for (let i = startI; i < endI; i++) {
            for (let j = startJ; j < endJ; j++) {
                if (this.heightMap[i]) {
                    this.heightMap[i][j] = newHeight;
                    if (this.supportMap[i]) {
                        this.supportMap[i][j] = boxId;
                    }
                }
            }
        }
    }

    getSupportingBoxes(posL, posW, boxL, boxW) {
        const startI = Math.floor(posL / this.resolution);
        const startJ = Math.floor(posW / this.resolution);
        const endI = Math.min(this.gridL, Math.ceil((posL + boxL) / this.resolution));
        const endJ = Math.min(this.gridW, Math.ceil((posW + boxW) / this.resolution));

        const supportingBoxes = new Set();
        for (let i = startI; i < endI; i++) {
            for (let j = startJ; j < endJ; j++) {
                if (this.supportMap[i] && this.supportMap[i][j]) {
                    supportingBoxes.add(this.supportMap[i][j]);
                }
            }
        }
        return Array.from(supportingBoxes);
    }
}

class SpaceManager {
    constructor(length, width, height) {
        this.length = length;
        this.width = width;
        this.height = height;
        this.usedSpaces = [];
        this.freeSpaces = [{
            x: 0,
            y: 0,
            z: 0,
            l: length,
            w: width,
            h: height
        }];
    }

    findBestPositions(boxL, boxW, boxH, quantity) {
        // Legacy placeholder (no-op, kept for compatibility)
        return [];
    }

    markUsed(x, y, l, w) {
        this.usedSpaces.push({ x, y, l, w });
    }
}

// ----------------------------------------------------
// MaxRectsBin implementation (2D L×W)
// ----------------------------------------------------
class MaxRectsBin {
    constructor(width, height) {
        this.binWidth = width;
        this.binHeight = height;
        this.freeRects = [{ x: 0, y: 0, w: width, h: height }];
    }

    static rectsIntersect(a, b) {
        return !(
            a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y
        );
    }

    static rectContainedIn(a, b) {
        return (
            a.x >= b.x &&
            a.y >= b.y &&
            a.x + a.w <= b.x + b.w &&
            a.y + a.h <= b.y + b.h
        );
    }

    static splitFreeRect(freeRect, usedRect) {
        if (!MaxRectsBin.rectsIntersect(freeRect, usedRect)) {
            return [freeRect];
        }

        const newRects = [];

        // Left
        if (usedRect.x > freeRect.x && usedRect.x < freeRect.x + freeRect.w) {
            newRects.push({
                x: freeRect.x,
                y: freeRect.y,
                w: usedRect.x - freeRect.x,
                h: freeRect.h
            });
        }

        // Right
        if (usedRect.x + usedRect.w < freeRect.x + freeRect.w) {
            newRects.push({
                x: usedRect.x + usedRect.w,
                y: freeRect.y,
                w: freeRect.x + freeRect.w - (usedRect.x + usedRect.w),
                h: freeRect.h
            });
        }

        // Top
        if (usedRect.y > freeRect.y && usedRect.y < freeRect.y + freeRect.h) {
            newRects.push({
                x: freeRect.x,
                y: freeRect.y,
                w: freeRect.w,
                h: usedRect.y - freeRect.y
            });
        }

        // Bottom
        if (usedRect.y + usedRect.h < freeRect.y + freeRect.h) {
            newRects.push({
                x: freeRect.x,
                y: usedRect.y + usedRect.h,
                w: freeRect.w,
                h: freeRect.y + freeRect.h - (usedRect.y + usedRect.h)
            });
        }

        return newRects;
    }

    static pruneFreeList(freeRects) {
        const pruned = [];
        for (let i = 0; i < freeRects.length; i++) {
            let rect = freeRects[i];
            let contained = false;
            for (let j = 0; j < freeRects.length; j++) {
                if (i !== j && MaxRectsBin.rectContainedIn(rect, freeRects[j])) {
                    contained = true;
                    break;
                }
            }
            if (!contained) {
                pruned.push(rect);
            }
        }
        return pruned;
    }

    // Heuristic: Best Short Side Fit + wall + clustering bonuses
    findPositionForNewNode(width, height, layerPlacements, palletL, palletW) {
        let bestScore = Infinity;
        let bestNode = null;

        for (let i = 0; i < this.freeRects.length; i++) {
            const r = this.freeRects[i];

            if (width <= r.w && height <= r.h) {
                const leftoverHoriz = r.w - width;
                const leftoverVert = r.h - height;
                const shortSideFit = Math.min(leftoverHoriz, leftoverVert);
                const longSideFit = Math.max(leftoverHoriz, leftoverVert);

                let score = shortSideFit * 1000 + longSideFit;

                const x = r.x;
                const y = r.y;

                let wallTouches = 0;
                if (x === 0 || x + width === palletL) wallTouches++;
                if (y === 0 || y + height === palletW) wallTouches++;
                score -= wallTouches * 50; // push towards walls

                const clusterTerm = (x + y) / (palletL + palletW + 1);
                score += clusterTerm * 10; // small pull towards origin

                if (score < bestScore) {
                    bestScore = score;
                    bestNode = {
                        x,
                        y,
                        w: width,
                        h: height,
                        score,
                        freeRectIndex: i
                    };
                }
            }
        }

        return bestNode;
    }

    insertAt(candidate, width, height) {
        if (!candidate) return null;

        const usedRect = {
            x: candidate.x,
            y: candidate.y,
            w: width,
            h: height
        };

        const newFreeRects = [];
        for (let i = 0; i < this.freeRects.length; i++) {
            const fr = this.freeRects[i];
            if (!MaxRectsBin.rectsIntersect(usedRect, fr)) {
                newFreeRects.push(fr);
            } else {
                const splits = MaxRectsBin.splitFreeRect(fr, usedRect);
                for (let s = 0; s < splits.length; s++) {
                    if (splits[s].w > 0 && splits[s].h > 0) {
                        newFreeRects.push(splits[s]);
                    }
                }
            }
        }

        this.freeRects = MaxRectsBin.pruneFreeList(newFreeRects);
        return usedRect;
    }
}

// Export for Node-style testing if needed
if (typeof module !== "undefined" && module.exports) {
    module.exports = window.CartonApp.Algorithms;
}
