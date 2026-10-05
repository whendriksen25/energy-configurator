"use client";
import { useState } from "react";
import { useWidth, ticks } from "./useWidth";

export type Line = { key: string; label: string; color: string; values: number[]; dashed?: boolean };

/** Average day: kW per hour for several series, with a crosshair tooltip. */
export default function ProfileChart({ lines, title, hourLabel, kw, showTable, tableLabels }: {
  lines: Line[]; title: string; hourLabel: string; kw: (v: number) => string; showTable: boolean;
  tableLabels: { hour: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hx, setHx] = useState<number | null>(null);
  const H = 260, top = 12, bottom = 28, left = 52, right = 22;
  const hi = Math.max(1, ...lines.flatMap((l) => l.values));
  const tk = ticks(0, hi, 4);
  const ymax = Math.max(hi, tk[tk.length - 1]);
  const x = (h: number) => left + (h / 23) * (width - left - right);
  const y = (v: number) => top + (1 - v / ymax) * (H - top - bottom);
  const path = (vals: number[]) => vals.map((v, h) => `${h ? "L" : "M"}${x(h).toFixed(1)},${y(Math.max(v, 0)).toFixed(1)}`).join("");

  function move(e: React.PointerEvent<SVGRectElement>) {
    const r = (e.target as SVGRectElement).getBoundingClientRect();
    const h = Math.round(((e.clientX - r.left) / r.width) * 23);
    setHx(Math.max(0, Math.min(23, h)));
  }

  return (
    <div ref={ref} className="relative">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
        {lines.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? "4 3" : undefined} /></svg>
            {l.label}
          </span>
        ))}
      </div>
      {!showTable ? (
        <>
          <svg width={width} height={H} role="img" aria-label={title} className="block">
            {tk.map((v) => (
              <g key={v}>
                <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--line)"} />
                <text x={left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{kw(v)}</text>
              </g>
            ))}
            {[0, 6, 12, 18, 23].map((h) => (
              <text key={h} x={x(h)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)" className="num">{`${String(h).padStart(2, "0")}:00`}</text>
            ))}
            {lines.map((l) => (
              <path key={l.key} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round"
                strokeDasharray={l.dashed ? "5 4" : undefined} />
            ))}
            {hx !== null && (
              <g>
                <line x1={x(hx)} x2={x(hx)} y1={top} y2={H - bottom} stroke="var(--axis)" />
                {lines.map((l) => (
                  <circle key={l.key} cx={x(hx)} cy={y(Math.max(l.values[hx], 0))} r={4} fill={l.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
            <rect x={left} y={top} width={width - left - right} height={H - top - bottom} fill="transparent"
              onPointerMove={move} onPointerLeave={() => setHx(null)} />
          </svg>
          {hx !== null && (
            <div className="tooltip" style={{ left: x(hx) > width / 2 ? x(hx) - 190 : x(hx) + 12, top: 30 }}>
              <div className="font-semibold">{hourLabel} {String(hx).padStart(2, "0")}:00</div>
              {lines.map((l) => (
                <div key={l.key} className="flex justify-between gap-4">
                  <span className="text-ink2">{l.label}</span><span className="num">{kw(l.values[hx])}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs num">
            <thead><tr className="text-left text-ink2"><th className="py-1 pr-2">{tableLabels.hour}</th>{lines.map((l) => <th key={l.key} className="py-1 pr-2 text-right">{l.label}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => (
                <tr key={h} className="border-t border-line">
                  <td className="py-1 pr-2">{String(h).padStart(2, "0")}:00</td>
                  {lines.map((l) => <td key={l.key} className="py-1 pr-2 text-right">{kw(l.values[h])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
