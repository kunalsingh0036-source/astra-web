/**
 * pg timestamp helpers.
 *
 * The `pg` driver returns JS `Date` objects for `timestamp` /
 * `timestamptz` columns by default. Our route handlers serialize
 * to JSON, where the wire format is ISO 8601 strings — so we
 * convert at the API boundary.
 *
 * Several routes used to do this with a runtime `instanceof Date`
 * guard:
 *
 *   created_at: row.created_at instanceof Date
 *     ? row.created_at.toISOString()
 *     : (row.created_at as string | null)
 *
 * That pattern was a TS workaround: row interfaces typed timestamps
 * as `string | null`, which lied — they're actually `Date | null` —
 * and then defended at runtime against the lie. Both halves were
 * wrong. The fix: type the row interface honestly (`Date | null`)
 * and use `toISO()` here for the projection.
 *
 * If you ever find yourself reaching for `instanceof Date` in a
 * route handler, the row interface is mistyped.
 */
export function toISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}
