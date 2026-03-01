const BASE = 'https://graph.facebook.com/v19.0';

function token()   { return process.env.WHATSAPP_TOKEN; }
function phoneId() { return process.env.WHATSAPP_PHONE_ID; }

/**
 * Send a text message via Meta WhatsApp Cloud API.
 * @param {string} to   - recipient phone number (international format, no +)
 * @param {string} text - message body
 */
export async function sendMessage(to, text) {
  const res = await fetch(`${BASE}/${phoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`WhatsApp send failed: ${JSON.stringify(err)}`);
  }

  return res.json();
}

/**
 * Download media from Meta's CDN and return { buffer, mimeType }.
 * @param {string} mediaId
 * @returns {{ buffer: Buffer, mimeType: string }}
 */
export async function downloadMedia(mediaId) {
  // Step 1: get the download URL
  const urlRes = await fetch(`${BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });

  if (!urlRes.ok) throw new Error(`Failed to fetch media URL for ${mediaId}`);

  const { url, mime_type: mimeType } = await urlRes.json();

  // Step 2: download the actual bytes
  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}` },
  });

  if (!imgRes.ok) throw new Error(`Failed to download media from ${url}`);

  const arrayBuf = await imgRes.arrayBuffer();
  return {
    buffer:   Buffer.from(arrayBuf),
    mimeType: mimeType || 'image/jpeg',
  };
}
