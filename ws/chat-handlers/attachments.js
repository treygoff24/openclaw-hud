const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB server-side limit
const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Attachment rate limiting — per WebSocket connection.
const connectionAttachmentTimestamps = new WeakMap();
const MAX_ATTACHMENTS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60000;

function checkAttachmentRateLimit(ws) {
  const now = Date.now();

  let timestamps = connectionAttachmentTimestamps.get(ws);
  if (!timestamps) {
    timestamps = [];
    connectionAttachmentTimestamps.set(ws, timestamps);
  }

  while (timestamps.length && timestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }

  if (timestamps.length >= MAX_ATTACHMENTS_PER_MINUTE) {
    return { allowed: false, error: { code: 'RATE_LIMITED', message: 'Too many attachment uploads' } };
  }

  timestamps.push(now);
  return { allowed: true };
}

function validateAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return { code: 'INVALID', message: 'attachments must be an array' };
  }

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];

    if (att.type !== 'image') {
      return { code: 'INVALID_ATTACHMENT_TYPE', message: 'only image attachments are supported, got: ' + att.type };
    }

    if (!att.source || !att.source.type) {
      return { code: 'INVALID', message: 'attachment missing source' };
    }

    if (!att.source.media_type) {
      return { code: 'INVALID_MEDIA_TYPE', message: 'attachment missing media_type' };
    }
    if (!ALLOWED_MEDIA_TYPES.includes(att.source.media_type)) {
      return { code: 'INVALID_MEDIA_TYPE', message: 'media_type not allowed: ' + att.source.media_type };
    }

    if (att.source.type === 'base64') {
      if (!att.source.data) {
        return { code: 'INVALID', message: 'attachment missing data' };
      }
      const approxSize = Math.ceil(att.source.data.length * 0.75);
      if (approxSize > MAX_ATTACHMENT_SIZE) {
        return { code: 'ATTACHMENT_TOO_LARGE', message: 'attachment exceeds 10MB limit' };
      }
    }
  }

  return null;
}

function buildContentBlocks(message, attachments) {
  const content = [];

  if (message && message.trim()) {
    content.push({ type: 'text', text: message });
  }

  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      content.push({
        type: 'image',
        source: {
          type: att.source.type,
          media_type: att.source.media_type,
          data: att.source.data,
          url: att.source.url,
        },
      });
    }
  }

  return content;
}

module.exports = {
  validateAttachments,
  buildContentBlocks,
  checkAttachmentRateLimit,
  MAX_ATTACHMENTS_PER_MINUTE,
  RATE_LIMIT_WINDOW_MS,
  connectionAttachmentTimestamps,
};
