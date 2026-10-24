export const fmt = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const utcTime = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export const utcDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export const utcDateTime = (iso: string): string => `${utcDate(iso)} ${utcTime(iso)} UTC`;

export const shortId = (id: string | null | undefined): string => (id ? id.slice(0, 8).toUpperCase() : "—");

export const gbp = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `£${fmt(value, digits)}`;

export const usd = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `$${fmt(value, digits)}`;

export function nowUtc(): string {
  const d = new Date();
  return `${utcTime(d.toISOString())}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}
