// In-memory session tracking for multi-step WhatsApp conversations

const sessions = new Map();
const timers = new Map();

const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function getSession(phone) {
  return sessions.get(phone) || null;
}

export function setSession(phone, data) {
  // Clear existing timer
  if (timers.has(phone)) clearTimeout(timers.get(phone));

  sessions.set(phone, data);

  // Auto-expire after 5 minutes
  const timer = setTimeout(() => {
    sessions.delete(phone);
    timers.delete(phone);
  }, SESSION_TIMEOUT);

  timers.set(phone, timer);
}

export function clearSession(phone) {
  if (timers.has(phone)) clearTimeout(timers.get(phone));
  sessions.delete(phone);
  timers.delete(phone);
}
