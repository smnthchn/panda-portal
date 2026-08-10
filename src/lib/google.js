const TOKEN_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly"
].join(" ");

// Access tokens last an hour; reuse them across requests on a warm isolate
// instead of signing a fresh JWT for every Drive call.
let accessTokenCache = { token: null, expiresAt: 0 };

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function arrayBufferToBase64Url(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\\n/g, "\n")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function getGoogleAccessToken(env) {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Google service account is not configured on the worker.");
  }

  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: TOKEN_SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const unsignedJwt =
    `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claimSet))}`;

  const key = await importPrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedJwt)
  );

  const jwt = `${unsignedJwt}.${arrayBufferToBase64Url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const data = await res.json();

  if (!data.access_token) {
    throw new Error("Could not get Google access token");
  }

  // Refresh a minute early so a request never starts with a token about to die.
  const lifetimeMs = ((data.expires_in || 3600) - 60) * 1000;
  accessTokenCache = { token: data.access_token, expiresAt: Date.now() + lifetimeMs };

  return data.access_token;
}

export async function listDriveFiles(folderId, env) {
  if (!folderId) return [];

  const token = await getGoogleAccessToken(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,mimeType,webViewLink)");
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}` +
    `&orderBy=folder,name&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Could not load Drive files");
  }

  return data.files || [];
}

export async function fetchGoogleDoc(docId, env) {
  const token = await getGoogleAccessToken(env);

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const meta = await metaRes.json();

  if (!metaRes.ok) {
    return { ok: false, error: meta.error?.message || "File not found" };
  }

  if (meta.mimeType !== "application/vnd.google-apps.document") {
    return {
      ok: false,
      error: `This viewer currently only supports Google Docs. File type: ${meta.mimeType}`
    };
  }

  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json();

  if (!res.ok) {
    return { ok: false, error: data.error?.message || "Failed to load doc" };
  }

  return { ok: true, title: data.title, html: renderGoogleDocToHtml(data) };
}

export function renderGoogleDocToHtml(doc) {
  const content = doc.body?.content || [];
  let html = "";

  for (const block of content) {
    if (block.paragraph) {
      html += renderParagraph(block.paragraph);
    } else if (block.table) {
      html += renderTable(block.table);
    }
  }

  return html || "<p>No content</p>";
}

function renderParagraph(paragraph) {
  const text = (paragraph.elements || [])
    .map(el => {
      const tr = el.textRun;
      if (!tr?.content) return "";

      let value = escapeHtml(tr.content).replace(/\n/g, "");
      const style = tr.textStyle || {};

      if (style.link?.url) {
        value = `<a href="${escapeHtml(style.link.url)}" target="_blank" rel="noopener">${value}</a>`;
      }
      if (style.bold) value = `<strong>${value}</strong>`;
      if (style.italic) value = `<em>${value}</em>`;
      if (style.underline) value = `<u>${value}</u>`;

      return value;
    })
    .join("")
    .trim();

  if (!text) return "";

  const named = paragraph.paragraphStyle?.namedStyleType || "";

  if (named === "TITLE") return `<h1>${text}</h1>`;
  if (named === "SUBTITLE") return `<h2>${text}</h2>`;
  if (named === "HEADING_1") return `<h2>${text}</h2>`;
  if (named === "HEADING_2") return `<h3>${text}</h3>`;
  if (named === "HEADING_3") return `<h4>${text}</h4>`;

  return `<p>${text}</p>`;
}

function renderTable(table) {
  let html = '<table class="doc-table">';

  for (const row of table.tableRows || []) {
    html += "<tr>";
    for (const cell of row.tableCells || []) {
      let cellHtml = "";
      for (const item of cell.content || []) {
        if (item.paragraph) cellHtml += renderParagraph(item.paragraph);
      }
      html += `<td>${cellHtml || ""}</td>`;
    }
    html += "</tr>";
  }

  return `${html}</table>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
