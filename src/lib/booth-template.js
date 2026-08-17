/**
 * The Fan Expo booth as it actually stands: 31 shelving units in a 16 ft × 30 ft
 * island, arranged against Samantha's floor plan.
 *
 * Lifted from the design handoff's own POS and SHELVES tables rather than
 * re-measured. Geometry is in feet from the booth's top-left; every unit is
 * 50″ × 20″ except N1, E7 and O2, which are 38″ long.
 */

const LONG = 50 / 12;
const SHORT = 20 / 12;
const MID = 38 / 12;

export const BOOTH_FEET = { width: 16, depth: 30 };

export const STAGES = ["SIZED", "PRODUCT +", "PREPPED", "SCANNED", "BOARDS"];

export const SIGNAGE = {
  fb: { label: "FULL BOARD", bg: "#F2B53B", fg: "#5C4413" },
  sb: { label: "SIDE BOARD", bg: "#FBEFD6", fg: "#6B5A2E" },
  bc: { label: "BOARD + CLEAR", bg: "#DDEAEE", fg: "#186071" },
  fc: { label: "FULL CLEAR", bg: "#EDE7D6", fg: "#5C5947" },
  sc: { label: "SIDE CLEAR", bg: "#EDE7D6", fg: "#5C5947" }
};

export const SIGNAGE_KEYS = ["fb", "sb", "bc", "fc", "sc"];

export const UNIT_TYPES = [
  "4 Tier", "5 Tier", "6 Tier", "7 Tier", "3 ft", "SD", "Nendo",
  "Pop Up", "Blindbox", "Plushie", "Cash", "Overstock", "A"
];

export const WALLS = [
  "SOUTH", "EAST WALL", "NORTH WALL", "WEST WALL", "CENTER", "OVERSTOCK & OTHER"
];

/* code, wall, wallNote, product, type, signage, board, kind, x, y, w, h */
export const BOOTH_TEMPLATE = [
  ["S1", "SOUTH", "front of booth", "PG", "4 Tier", ["fb"], "Entrance [R]", "shelf", 1.6667, 0, LONG, SHORT],
  ["O1", "SOUTH", null, "Overstock", "4 Tier", ["fb"], "Entrance [L]", "other", 10.1667, 0, LONG, SHORT],

  ["E1", "EAST WALL", null, "PG", "4 Tier", ["bc"], "Hoops", "shelf", 0, 0, SHORT, LONG],
  ["E2", "EAST WALL", null, "P Bandai", "4 Tier", ["bc"], "Space", "shelf", 0, 4.1667, SHORT, LONG],
  ["E3", "EAST WALL", null, "MG", "4 Tier", ["bc"], "Pokemon", "shelf", 0, 8.3333, SHORT, LONG],
  ["E4", "EAST WALL", null, "MG", "4 Tier", ["bc"], "Claw [L]", "shelf", 0, 12.5, SHORT, LONG],
  ["E5", "EAST WALL", null, "MG", "4 Tier", ["bc"], "Lectibles [R]", "shelf", 0, 16.6667, SHORT, LONG],
  ["E6", "EAST WALL", null, "MG", "4 Tier", ["bc"], "Rolls", "shelf", 0, 20.8333, SHORT, LONG],
  ["E7", "EAST WALL", null, "3ft Star Wars etc", "3 ft", ["fb"], "3ft Generic", "shelf", 0, 25, SHORT, MID],

  ["N1", "NORTH WALL", null, "3ft One Piece", "3 ft", ["sb", "fb"], "Generic 3ft & Gunpla Corner", "shelf", 0.1667, 28.3333, MID, SHORT],
  ["N2", "NORTH WALL", null, "Girls", "4 Tier", ["bc"], "Hot", "shelf", 3.3333, 28.3333, LONG, SHORT],
  ["N3", "NORTH WALL", null, "Cars", "4 Tier", ["fb"], "Chef", "shelf", 7.5, 28.3333, LONG, SHORT],
  ["N4", "NORTH WALL", null, "Anime", "4 Tier", ["sb", "bc"], "Space & Gunpla Corner", "shelf", 11.6667, 28.3333, LONG, SHORT],

  ["W1", "WEST WALL", null, "SD", "SD", [], "", "shelf", 10.1667, 8.4167, LONG, SHORT],
  ["W2", "WEST WALL", null, "HG", "4 Tier", ["bc"], "Hot", "shelf", 14.3333, 11.5, SHORT, LONG],
  ["W3", "WEST WALL", null, "HG", "4 Tier", ["bc"], "Gundam No Chef", "shelf", 14.3333, 15.6667, SHORT, LONG],
  ["W4", "WEST WALL", null, "HG", "4 Tier", ["bc"], "Hot", "shelf", 14.3333, 19.8333, SHORT, LONG],
  ["W5", "WEST WALL", null, "RG", "4 Tier", ["bc"], "Pokemon", "shelf", 14.3333, 24, SHORT, LONG],

  ["C1", "CENTER", "islands", "Nendo, Funko & figs", "Nendo", [], "", "shelf", 5, 5.5, SHORT, LONG],
  ["C2", "CENTER", null, "3ft figs", "3 ft", [], "", "shelf", 5, 9.6667, SHORT, LONG],
  ["C3", "CENTER", null, "Pop Up", "Pop Up", [], "", "shelf", 4.9167, 15.1667, SHORT, LONG],
  ["C4", "CENTER", null, "Pokemon", "SD", [], "", "shelf", 4.9167, 19.3333, SHORT, LONG],
  ["C7", "CENTER", null, "Blind boxes", "Blindbox", [], "", "shelf", 8.25, 15.1667, SHORT, LONG],
  ["C8", "CENTER", null, "Plushie & figs", "Plushie", [], "", "shelf", 8.25, 19.3333, SHORT, LONG],
  ["C9", "CENTER", null, "Anime", "3 ft", [], "", "shelf", 5, 23.5, LONG, SHORT],

  ["O2", "OVERSTOCK & OTHER", null, "", "4 Tier", ["sb", "fb"], "QR Code & 3ft Board", "other", 14.3333, 0, SHORT, MID],
  ["O3", "OVERSTOCK & OTHER", null, "", "4 Tier", ["fb"], "Chef", "other", 14.3333, 7.3333, SHORT, LONG],
  ["O4", "OVERSTOCK & OTHER", null, "Overstock", "4 Tier", [], "", "other", 6.5833, 15.1667, SHORT, LONG],
  ["O5", "OVERSTOCK & OTHER", null, "Overstock", "4 Tier", [], "", "other", 6.5833, 19.3333, SHORT, LONG],
  ["Cash", "OVERSTOCK & OTHER", null, "", "Cash", ["bc"], "Cash", "other", 14.3333, 3.1667, SHORT, LONG],
  ["A", "OVERSTOCK & OTHER", null, "", "A", [], "", "other", 10.25, 1.6667, SHORT, LONG]
];

/** The template as plain objects, in the order they should appear in the grid. */
export function templatePositions() {
  return BOOTH_TEMPLATE.map(
    ([code, wall, wallNote, product, unitType, signage, board, kind, x, y, w, h], i) => ({
      code,
      wall,
      wall_note: wallNote,
      product,
      unit_type: unitType,
      signage: signage.join(","),
      board_name: board,
      kind,
      sort_order: i,
      x, y, w, h
    })
  );
}
