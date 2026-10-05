"use client";
import { useState } from "react";
import { useWidth } from "./useWidth";

export type CostBar = { label: string; parts: number[]; export: number };

/** Two stacked horizontal bars: annual costs of doing nothing vs. the design. */
export default function CostChart({ bars, partLabels, exportLabel, eur, title }: {
  bars: CostBar[]; partLabels: string[]; exportLabel: string; eur: (v: number) => string; title: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ b: number; p: number; x: number } | null>(null);
  const colors = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
  const labelW = Math.min(130, width * 0.3), right = 92, rowH = 30, gap = 26, top = 8;
  const H = top + bars.length * (rowH + gap);
  const maxV = Math.max(1, ...bars.map((b) => b.parts.reduce((a, c) => a + Math.max(c, 0), 0)));
  const sx = (v: number) => (v / maxV) * (width - labelW - right);

  return (
    <div ref={ref} className="relative">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
        {partLabels.map((l, i) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />{l}
          </span>
        ))}
      </div>
      <svg width={width} height={H} role="img" aria-label={title} className="block">
        {bars.map((b, bi) => {
          const yy = top + bi * (rowH + gap);
          let x = labelW;
          const total = b.parts.reduce((a, c) => a + c, 0) - b.export;
          const segs = b.parts.map((v, pi) => {
            const w = sx(Math.max(v, 0));
            const seg = { x, w, pi, v };
            x += w;
            return seg;
          });
          const last = segs.filter((s) => s.w > 0.5).pop();
          return (
            <g key={b.label}>
              <text x={0} y={yy + rowH / 2} dy="0.32em" fontSize="12" fill="var(--ink)">{b.label}</text>
              {segs.map((s) => s.w > 0.5 && (
                <rect key={s.pi} x={s.x} y={yy} width={Math.max(s.w - 2, 0.5)} height={rowH}
                  rx={s === last ? 4 : 0} fill={colors[s.pi]}
                  opacity={hover && (hover.b !== bi || hover.p !== s.pi) ? 0.55 : 1}
                  onMouseEnter={() => setHover({ b: bi, p: s.pi, x: s.x + s.w / 2 })} onMouseLeave={() => setHover(null)} />
              ))}
              <text x={x + 6} y={yy + rowH / 2} dy="0.32em" fontSize="12" fontWeight={600} fill="var(--ink)" className="num">{eur(total)}</text>
              {b.export > 0 && (
                <text x={width < 480 ? 0 : labelW} y={yy + rowH + 14} fontSize="11" fill="var(--muted)" className="num">
                  − {exportLabel}: {eur(b.export)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(hover.x, width - 200), top: top + hover.b * (rowH + gap) - 30 }}>
          {partLabels[hover.p]}: <span className="num font-semibold">{eur(bars[hover.b].parts[hover.p])}</span>
        </div>
      )}
    </div>
  );
}
