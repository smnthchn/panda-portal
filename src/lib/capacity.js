/**
 * What stands where on a unit, and the hand-set guide for how many pieces fit.
 *
 * This used to compute capacity from box widths and tier dimensions. That math
 * never matched the floor — the guides Sam actually packs to are per family,
 * written against a 4-tier unit ("Girls fit 20, MG fit 12"), so that's what's
 * stored now (`groupings.guide_pieces`) and everything derived from geometry
 * is gone. A family's guide scales by the share of tiers it occupies: MG on 2
 * tiers of a 4-tier unit reads ~6, and MG with a whole unit reads exactly the
 * number Sam wrote.
 *
 * The catalogue is still about ten times the booth, so a family's SKU count
 * stays the pool it is picked from, never a target. The picking is a person's
 * job; the guide just says how many winners to pick.
 */

/** The guides are written against a unit this many tiers tall. */
export const GUIDE_TIERS = 4;

export const DEFAULT_USABLE_HEIGHT_IN = 72;

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
 * The whole unit, tier by tier: which family stands on which tier, and what
 * each family's guide comes to on this unit.
 *
 * `placements` is a row per (grouping, tier) — a family can skip a tier, since
 * small easy-to-pocket stock is kept in the top three or four so nobody is
 * bending over an open bag.
 */
export function positionLayout(position, groupings = [], placements = [], tierOverrides = []) {
  const heights = tierHeights(position, tierOverrides);
  const onTiers = groupings.filter(g => (g.placement || "tier") === "tier");

  const byTier = new Map();
  for (const row of placements) {
    const tier = Number(row.tier_index);
    if (!byTier.has(tier)) byTier.set(tier, []);
    const family = onTiers.find(g => g.id === row.grouping_id);
    if (family) byTier.get(tier).push({ id: family.id, name: family.name });
  }

  const tiers = heights.map((heightIn, index) => {
    const tier = index + 1;
    return { tier, heightIn, families: byTier.get(tier) || [] };
  });

  const perFamily = onTiers.map(family => {
    const tiersOn = tiers.filter(t => t.families.some(f => f.id === family.id)).map(t => t.tier);
    const guideUnit = Number(family.guide_pieces) || null;

    return {
      id: family.id,
      name: family.name,
      tiers: tiersOn,
      placed: tiersOn.length > 0,
      // The guide scaled to this unit's share: the raw number is "a 4-tier
      // unit fits this many", so half the tiers reads as half the pieces.
      guide: guideUnit && tiersOn.length
        ? Math.max(1, Math.round(guideUnit * tiersOn.length / GUIDE_TIERS))
        : null,
      guideUnit,
      pool: family.sku_count ?? null
    };
  });

  return {
    tiers,
    families: perFamily,
    // Families that need a number rather than a place: tools and TCG go on the
    // side of a unit, the big boxes go on top.
    offTier: groupings
      .filter(g => (g.placement || "tier") !== "tier")
      .map(g => ({ id: g.id, name: g.name, placement: g.placement, pool: g.sku_count ?? null }))
  };
}
