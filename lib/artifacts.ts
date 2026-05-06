/**
 * Artifact types emitted by Astra.
 *
 * Each matches a tool in astra/tools/artifact_tools.py; the `content`
 * payload here mirrors the JSON that tool wraps in the sentinel.
 */

export interface TableArtifact {
  kind: "table";
  title: string;
  columns: string[];
  rows: (string | number)[][];
  caption: string;
}

export interface DraftArtifact {
  kind: "draft";
  to: string;
  cc: string;
  subject: string;
  body: string;
  channel: "email" | "whatsapp" | "linkedin" | "slack" | string;
}

export interface MetricArtifact {
  kind: "metric";
  label: string;
  value: string;
  sub: string;
  tone: "default" | "urgent" | string;
}

export interface PaletteSwatch {
  hex: string;
  label: string;
}

export interface PaletteArtifact {
  kind: "palette";
  name: string;
  colors: PaletteSwatch[];
  notes: string;
}

export type Artifact =
  | TableArtifact
  | DraftArtifact
  | MetricArtifact
  | PaletteArtifact;

/**
 * Normalize a raw artifact event payload into one of our typed
 * shapes. Returns null if the type isn't one we know how to render.
 */
export function parseArtifact(raw: unknown): Artifact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = String(r.type ?? "");

  switch (kind) {
    case "table":
      return {
        kind: "table",
        title: String(r.title ?? ""),
        columns: Array.isArray(r.columns) ? r.columns.map(String) : [],
        rows: Array.isArray(r.rows)
          ? r.rows.map((row) =>
              Array.isArray(row)
                ? (row as (string | number)[])
                : [],
            )
          : [],
        caption: String(r.caption ?? ""),
      };

    case "draft":
      return {
        kind: "draft",
        to: String(r.to ?? ""),
        cc: String(r.cc ?? ""),
        subject: String(r.subject ?? ""),
        body: String(r.body ?? ""),
        channel: String(r.channel ?? "email"),
      };

    case "metric":
      return {
        kind: "metric",
        label: String(r.label ?? ""),
        value: String(r.value ?? ""),
        sub: String(r.sub ?? ""),
        tone: String(r.tone ?? "default"),
      };

    case "palette": {
      const rawColors = Array.isArray(r.colors) ? r.colors : [];
      const colors: PaletteSwatch[] = [];
      for (const c of rawColors) {
        if (!c || typeof c !== "object") continue;
        const cr = c as Record<string, unknown>;
        let hex = String(cr.hex ?? cr.color ?? "").trim();
        if (hex && !hex.startsWith("#")) hex = `#${hex}`;
        const label = String(cr.label ?? cr.name ?? "").trim();
        // Only keep entries with a parseable hex — avoids rendering
        // empty/garbage swatches if the agent's payload is partial.
        if (/^#[0-9a-fA-F]{3,8}$/.test(hex)) {
          colors.push({ hex, label });
        }
      }
      return {
        kind: "palette",
        name: String(r.name ?? ""),
        colors,
        notes: String(r.notes ?? ""),
      };
    }

    default:
      return null;
  }
}
