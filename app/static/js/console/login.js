// Login error copy. Reads Retry-After (header) or retry_after (JSON body).
export function retryAfterSeconds(headers, body) {
  let secs = null;
  const h = headers && typeof headers.get === 'function' ? headers.get('Retry-After') : null;
  if (h !== null && h !== undefined && h !== '' && Number.isFinite(Number(h))) secs = Number(h);
  if (secs === null && body && Number.isFinite(Number(body.retry_after))) secs = Number(body.retry_after);
  return secs;
}

export function lockoutMessage(seconds) {
  if (seconds === null || seconds === undefined) return 'Too many attempts, try again in a few minutes';
  const mins = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts, try again in ${mins} min`;
}

export async function describeLoginFailure(res) {
  if (res.status === 429) {
    let body = null;
    try { body = await res.json(); } catch (e) {}
    return {locked: true, message: lockoutMessage(retryAfterSeconds(res.headers, body)),
      retryAfter: retryAfterSeconds(res.headers, body)};
  }
  if (res.status === 401 || res.status === 403) return {locked: false, message: 'Incorrect PIN. Please try again.'};
  return {locked: false, message: 'Could not sign in. Check the connection and try again.'};
}
