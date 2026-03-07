const BASE = 'https://graph.facebook.com/v21.0';

function token()   { return process.env.WHATSAPP_TOKEN; }
function phoneId() { return process.env.WHATSAPP_PHONE_ID; }

/**
 * Send a text message via Meta WhatsApp Cloud API.
 * @param {string} to   - recipient phone number (international format, no +)
 * @param {string} text - message body
 */
export async function sendMessage(to, text) {
  console.log(`[Meta] sendMessage to=${to} phoneId=${phoneId()} tokenSet=${!!token()}`);
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
    console.error(`[Meta] sendMessage failed: status=${res.status}`, JSON.stringify(err));
    throw new Error(`WhatsApp send failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  console.log(`[Meta] sendMessage success: messageId=${data?.messages?.[0]?.id}`);
  return data;
}

/**
 * Download media from Meta's CDN and return { buffer, mimeType }.
 * @param {string} mediaId
 * @returns {{ buffer: Buffer, mimeType: string }}
 */
export async function downloadMedia(mediaId) {
  // Step 1: get the download URL
  console.log(`[Meta] downloadMedia: fetching URL for mediaId=${mediaId}`);
  const urlRes = await fetch(`${BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });

  if (!urlRes.ok) {
    const body = await urlRes.text().catch(() => '');
    console.error(`[Meta] downloadMedia URL fetch failed: status=${urlRes.status} body=${body}`);
    throw new Error(`Failed to fetch media URL for ${mediaId}`);
  }

  const { url, mime_type: mimeType } = await urlRes.json();
  console.log(`[Meta] downloadMedia: got URL, mimeType=${mimeType}`);

  // Step 2: download the actual bytes
  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}` },
  });

  if (!imgRes.ok) {
    console.error(`[Meta] downloadMedia image fetch failed: status=${imgRes.status}`);
    throw new Error(`Failed to download media from ${url}`);
  }

  const arrayBuf = await imgRes.arrayBuffer();
  console.log(`[Meta] downloadMedia: downloaded ${arrayBuf.byteLength} bytes`);
  return {
    buffer:   Buffer.from(arrayBuf),
    mimeType: mimeType || 'image/jpeg',
  };
}
