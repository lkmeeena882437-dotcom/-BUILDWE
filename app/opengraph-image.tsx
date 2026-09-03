import { ImageResponse } from "next/og";
import { TOOLS } from "@/lib/tools/registry";

/**
 * Open Graph card.
 *
 * Shared BUILDWE links previously unfurled as a bare title and description
 * with no image, which on Slack, WhatsApp, X and iMessage reads as a broken or
 * untrustworthy link. This renders one at request time and Next caches it.
 *
 * Deliberately dependency-free: no external font fetch, no remote asset, no
 * network at render. A webfont here would be a runtime dependency on
 * fonts.googleapis.com, so a font outage (or an egress-restricted host) would
 * turn every social share into a 500. System fonts render fine at this size.
 *
 * The palette is the product's own: warm cream, near-black, terracotta accent.
 */

export const runtime = "edge";
export const alt = "BUILDWE.ONLINE — Build anything. Create everything.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "#F7F4EE";
const INK = "#14110F";
const ACCENT = "#C45C26";
const MUTED = "#6B6560";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CREAM,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Accent rule — the one piece of brand furniture that reads at thumbnail size. */}
        <div style={{ display: "flex", width: 120, height: 10, background: ACCENT, borderRadius: 999 }} />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 76,
                height: 76,
                borderRadius: 22,
                background: INK,
                color: CREAM,
                fontSize: 42,
                fontWeight: 700,
              }}
            >
              B
            </div>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 600, color: INK, letterSpacing: -0.5 }}>
              BUILDWE.ONLINE
            </div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 34,
              fontSize: 82,
              fontWeight: 700,
              color: INK,
              letterSpacing: -2.5,
              lineHeight: 1.05,
            }}
          >
            Build anything.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              fontWeight: 700,
              color: ACCENT,
              letterSpacing: -2.5,
              lineHeight: 1.05,
            }}
          >
            Create everything.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 27, color: MUTED, letterSpacing: -0.3 }}>
          {`Chat · Code · Images · Voice · Web search — ${TOOLS.length} AI tools in one free workspace`}
        </div>
      </div>
    ),
    size
  );
}
