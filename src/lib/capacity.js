/**
 * How much fits on a shelf.
 *
 * Groupings say which family stands on a unit and how deep each SKU is faced.
 * That is only half the answer — the question the spreadsheet used to answer is
 * how many of the family to actually pack, and that falls out of the unit's
 * dimensions.
 *
 * The catalogue is about ten times the booth: ~4,700 in-stock SKUs across the
 * families against roughly 250 box widths on the floor. So a family's SKU count
 * is the pool it is picked from, never a target. Capacity answers "this tier
 * shows 4 of your 383 Girls", and the picking stays a person's job.
 *
 * Nothing here blocks. An over-full tier is reported and drawn amber; a plan
 * that doesn't fit is still a plan you can save, the same way layoutConflicts()
 * reports an overlapping unit rather than refusing the move.
 */

/**
 * How wide one box of a family stands, in inches.
 *
 * The classes were written against a 49.5″ tier — six small boxes across, four
 * medium, three large, two oversize — so these are that tier divided up. Width
 * is a property of the product, not of the shelf it lands on, which is why it
 * sits on the family.
 */
export const BOX_WIDTH_IN = {
  small: 49.5 / 6,
  medium: 49.5 / 4,
  large: 49.5 / 3,
  oversize: 49.5 / 2
};

/** Families that never take a tier, and why the plan shouldn't call them unplaced. */
export const PLACEMENTS = {
  tier: { label: "On tiers" },
  side: { label: "Zip-tied to the side" },
  up_top: { label: "Up top" }
};

export const DEFAULT_USABLE_HEIGHT_IN = 72;

/** The tier width of a unit: its long footprint side, which is the face it shows. */
export function tierWidthIn(geometry) {
  const w = Number(geometry?.w) || 0;
  const h = Number(geometry?.h) || 0;
  return Math.max(w, h) * 12;
}

/**
 * The height of each tier, top first.
 *
 * Shelves are adjustable — SIZED means the unit was built to its tier count —
 * so the default is the usable height split evenly. Overrides are sparse: a
 * blind-box unit is four short tiers over two taller ones, and only the two
 * tall ones need a row.
 */
export function tierHeights(position, overrides = []) {
  const count = Math.max(0, Number(position?.tier_count) || 0);
  if (!count) return [];

  const byIndex = new Map(overrides.map(o => [Number(o.tier_index), Number(o.height_in)]));
  const usable = Number(position?.usable_height_in) || DEFAULT_USABLE_HEIGHT_IN;

  // What the overrides claim, and what's left to share between the rest.
  let spoken = 0;
  let unspoken = 0;
  for (let tier = 1; tier <= count; tier++) {
    if (byIndex.has(tier)) spoken += byIndex.get(tier);
    else unspoken++;
  }
  const even = unspoken > 0 ? Math.max(0, usable - spoken) / unspoken : 0;

  const heights = [];
  for (let tier = 1; tier <= count; tier++) {
    heights.push(byIndex.has(tier) ? byIndex.get(tier) : even);
  }
  return heights;
}

/**
 * What one tier holds.
 *
 * Families on a tier split its width evenly — nobody measures out a share, and
 * an even split is what the photos show when two families share a unit. Each
 * one then shows as many SKUs as its faced boxes fit into that share.
 *
 * A family is over capacity when it can't show even one SKU: either its share
 * is narrower than one SKU at the chosen facings, or its box is taller than the
 * tier. Both are worth saying out loud, and neither stops anything.
 */
export function tierCapacity(widthIn, heightIn, families) {
  const share = families.length ? widthIn / families.length : widthIn;

  const rows = families.map(family => {
    const boxWidth = BOX_WIDTH_IN[family.box_class] || BOX_WIDTH_IN.medium;
    const facings = Math.max(1, Number(family.facings) || 1);
    const boxHeight = Number(family.box_height_in) || 0;

    const perSku = boxWidth * facings;
    const tooTall = boxHeight > heightIn + 0.01;
    const skus = tooTall ? 0 : Math.floor((share + 0.01) / perSku);

    return {
      id: family.id,
      name: family.name,
      skus,
      facings,
      usedIn: skus * perSku,
      tooTall,
      // The one that reads as a problem on the phone: it's on the tier and
      // showing nothing.
      over: tooTall || skus === 0
    };
  });

  const usedIn = rows.reduce((sum, r) => sum + r.usedIn, 0);

  return {
    widthIn,
    heightIn,
    families: rows,
    holds: rows.reduce((sum, r) => sum + r.skus, 0),
    usedIn,
    // Cells for the battery-style bar, out of ten, so an empty tier reads empty.
    fill: widthIn > 0 ? Math.min(1, usedIn / widthIn) : 0,
    over: rows.some(r => r.over)
  };
}

/**
 * The whole unit, tier by tier.
 *
 * `placements` is a row per (grouping, tier) — a family can skip a tier, since
 * small easy-to-pocket stock is kept in the top three or four so nobody is
 * bending over an open bag.
 */
export function positionCapacity(position, groupings = [], placements = [], tierOverrides = []) {
  const heights = tierHeights(position, tierOverrides);
  const widthIn = tierWidthIn(position.geometry || position);
  const onTiers = groupings.filter(g => (g.placement || "tier") === "tier");

  const byTier = new Map();
  for (const row of placements) {
    const tier = Number(row.tier_index);
    if (!byTier.has(tier)) byTier.set(tier, []);
    const family = onTiers.find(g => g.id === row.grouping_id);
    if (family) byTier.get(tier).push(family);
  }

  const tiers = heights.map((heightIn, index) => {
    const tier = index + 1;
    return { tier, ...tierCapacity(widthIn, heightIn, byTier.get(tier) || []) };
  });

  // What each family ends up showing across every tier it's on, against the
  // pool it's picked from.
  const perFamily = onTiers.map(family => {
    const tiersOn = tiers.filter(t => t.families.some(f => f.id === family.id));
    return {
      id: family.id,
      name: family.name,
      tiers: tiersOn.map(t => t.tier),
      shows: tiersOn.reduce(
        (sum, t) => sum + t.families.find(f => f.id === family.id).skus, 0
      ),
      pool: family.sku_count ?? null,
      placed: tiersOn.length > 0
    };
  });

  return {
    tiers,
    families: perFamily,
    holds: tiers.reduce((sum, t) => sum + t.holds, 0),
    over: tiers.some(t => t.over),
    // Families that need a number rather than a place: tools and TCG go on the
    // side of a unit, the big boxes go on top.
    offTier: groupings
      .filter(g => (g.placement || "tier") !== "tier")
      .map(g => ({ id: g.id, name: g.name, placement: g.placement, pool: g.sku_count ?? null }))
  };
}
