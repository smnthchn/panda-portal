import { BadRequest } from "./http.js";

/**
 * Pictures the portal stores itself: staff avatars and board artwork. Both
 * are shrunk in the browser first and kept as a data URI in D1, so the rules
 * about what may be stored belong in one place.
 */

const IMAGE_TYPES = ["image/webp", "image/png", "image/jpeg"];

/**
 * Validates an uploaded data URI and splits it into its parts.
 *
 * Throws BadRequest on anything that isn't a plain base64 image — the string
 * ends up in an <img src>, so a stray `svg+xml` would be script execution
 * dressed up as a picture.
 */
export function parseImageDataUri(value, maxBytes) {
  const text = String(value || "").trim();
  const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(text);

  if (!match) {
    throw new BadRequest("That image didn't upload cleanly. Try another file.");
  }

  const [, mimeType, base64] = match;

  if (!IMAGE_TYPES.includes(mimeType)) {
    throw new BadRequest("Pictures have to be a PNG, JPEG or WebP.");
  }

  // 4 base64 chars carry 3 bytes; padding trims one byte each.
  const padding = (base64.match(/=*$/) || [""])[0].length;
  const bytes = (base64.length * 3) / 4 - padding;

  if (bytes > maxBytes) {
    throw new BadRequest("That image is too big even after shrinking. Try a smaller one.");
  }

  return { mimeType, base64, bytes };
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Serves a stored data URI as a real image response. Cache-busted by the ?v=
 * the client appends, so the cache header can be a long one.
 */
export function imageResponse(dataUri, maxBytes) {
  let parsed;
  try {
    parsed = parseImageDataUri(dataUri, maxBytes);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(base64ToBytes(parsed.base64), {
    headers: {
      "Content-Type": parsed.mimeType,
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    }
  });
}

/** A picture's url, stamped so a replacement isn't served from cache. */
export function imageUrlFor(path, updatedAt) {
  const version = String(updatedAt || "").replace(/\D/g, "").slice(0, 14);
  return `${path}?v=${version}`;
}
