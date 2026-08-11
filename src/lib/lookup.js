import Anthropic from "@anthropic-ai/sdk";

/**
 * Looks up a convention's public details with Claude + web search.
 *
 * Everything this returns is a *suggestion*. Nothing is written to the database
 * here — the boss reviews the result and saves what's right.
 *
 * Unknown values come back as empty strings rather than guesses, so a blank
 * field means "couldn't find it", not "no hours that day".
 */

const MODEL = "claude-opus-5";

// All fields are required and use "" for unknown — the structured-output schema
// doesn't support nullable types, and "" is unambiguous here.
const LOOKUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "confidence", "notes", "event", "days", "sources"],
  properties: {
    found: { type: "boolean" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
    event: {
      type: "object",
      additionalProperties: false,
      required: ["name", "venue", "address", "website", "starts_on", "ends_on"],
      properties: {
        name: { type: "string" },
        venue: { type: "string" },
        address: { type: "string" },
        website: { type: "string" },
        starts_on: { type: "string" },
        ends_on: { type: "string" }
      }
    },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "day_date",
          "early_start",
          "early_end",
          "regular_start",
          "regular_end",
          "setup_start",
          "setup_end",
          "notes"
        ],
        properties: {
          day_date: { type: "string" },
          early_start: { type: "string" },
          early_end: { type: "string" },
          regular_start: { type: "string" },
          regular_end: { type: "string" },
          setup_start: { type: "string" },
          setup_end: { type: "string" },
          notes: { type: "string" }
        }
      }
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: {
          title: { type: "string" },
          url: { type: "string" }
        }
      }
    }
  }
};

function buildPrompt(name, today) {
  return `Find the public details and hours of operation for this convention: "${name}".

Today's date is ${today}. If the name doesn't include a year, assume the next
upcoming edition.

Search for the convention's own official website and use that as the primary
source. Prefer the official site over aggregators, wikis, or news coverage.

Return:
- event.name: the convention's full official name, including the year.
- event.venue / event.address: the venue name and its street address.
- event.website: the official site's URL.
- event.starts_on / event.ends_on: the first and last public show day, as YYYY-MM-DD.
- days: one entry per public show day, each with:
  - day_date as YYYY-MM-DD
  - regular_start / regular_end: general-admission hall hours that day, as 24-hour HH:MM
  - early_start / early_end: early or priority access hours that day, if the
    convention publishes them for premium or VIP badge holders
  - setup_start / setup_end: exhibitor setup or load-in hours that day
  - notes: anything unusual about that specific day, briefly

Rules that matter more than completeness:
- Use "" for anything you cannot find on a real source. Never estimate,
  interpolate between days, or carry hours over from a previous year.
- Exhibitor setup and load-in times are usually published only in an exhibitor
  kit behind a vendor login, not on the public site. If you cannot find them,
  leave them "" and say so in notes. Do not substitute public show hours.
- Distinguish general admission from early access carefully. If a convention
  publishes only one set of hall hours, those are regular hours and early
  access should be "".
- If the convention has multiple halls or tracks with different hours, report
  the dealer/exhibitor hall hours and mention the discrepancy in notes.
- Set found to false if you cannot identify the convention at all.
- confidence reflects the hours specifically: "high" only when they came from
  the official site for the correct year.
- notes should be one or two plain sentences for a shop owner: what you could
  not find, and anything they should double-check. No preamble.
- sources: the pages you actually used, official site first.`;
}

/**
 * Runs the lookup. Returns the parsed suggestion object.
 * Throws with a readable message on configuration or API failure.
 */
export async function lookupConvention(name, env) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Convention lookup isn't configured yet — the worker needs an ANTHROPIC_API_KEY secret."
    );
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const today = new Date().toISOString().slice(0, 10);

  const messages = [{ role: "user", content: buildPrompt(name, today) }];
  let response;

  // Server-side web search runs its own loop; when it hits the iteration limit
  // the turn comes back as pause_turn and we re-send to let it continue.
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      output_config: { format: { type: "json_schema", schema: LOOKUP_SCHEMA } },
      messages
    });

    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") {
    throw new Error("The lookup was declined for this search. Enter the details by hand.");
  }

  if (response.stop_reason === "pause_turn") {
    throw new Error("The lookup ran long without finishing. Try again, or enter the details by hand.");
  }

  const text = response.content.find(block => block.type === "text")?.text;

  if (!text) {
    throw new Error("The lookup came back empty. Try again, or enter the details by hand.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Couldn't read the lookup result. Try again, or enter the details by hand.");
  }
}
