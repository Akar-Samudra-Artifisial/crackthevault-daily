// Title of the daily vault post (pure; no imports, unit tests load this file directly).

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAY_RE = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * "Crack the Vault — Daily Vault · Tue 17 Nov" for a UTC day key (yyyymmdd). English names
 * from fixed arrays (no locale-dependent Intl); weekday computed in UTC. Throws on a key
 * that is not a real calendar day.
 */
export const postTitle = (day: string): string => {
  const m = DAY_RE.exec(day);
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    !m ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  )
    throw new Error(`postTitle: invalid day key "${day}"`);
  return `Crack the Vault — Daily Vault · ${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[mo - 1]}`;
};
