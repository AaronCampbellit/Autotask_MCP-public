/** Native timestamps must be paired, canonical UTC instants with the supplied duration. */
export function validTimeInterval(start: unknown, end: unknown, hours: number): boolean {
  if (start === undefined && end === undefined) return true;
  const valid = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  return valid(start) && valid(end) && Date.parse(end) > Date.parse(start)
    && Math.abs((Date.parse(end) - Date.parse(start)) / 3600000 - hours) < 1e-9;
}
