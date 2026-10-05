"use client";
import { useState } from "react";
import { useWidth, ticks, barPath } from "./useWidth";

/** Yearly cash flow (bars) and cumulative cash flow (line) on one euro axis. */
export default function CashflowChart({ cf, eur, labels }: {
  cf: number[]; eur: (v: number) => string; labels: { year: string; yearly: string; cum: string; title: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const cum: number[] = [];
  cf.reduce((s, v) => { cum.push(s + v); return s + v; }, 0);
  const H = 240, top = 12, bottom = 26, left = 64, right = 10;
  const lo = Math.min(0, ...cf, ...cum), hi = Math.max(0, ...cf, ...cum);
  const tk = ticks(lo, hi, 4);
  const y0v = Math.min(lo, tk[0]), y1v = Math.max(hi, tk[tk.length - 1]);
  const y = (v: number) => top + ((y1v - v) / (y1v - y0v || 1)) * (H - top - bottom);
  const band = (width - left - right) / cf.length;
  const bw = Math.max(3, Math.min(28, band * 0.6));
  const cx = (i: number) => left + band * i + band / 2;
  const kfmt = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`);
  const line = cum.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  return (
    <div ref={ref} className="relative">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--s1)" }} />{labels.yearly}</span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" stroke="var(--s2)" strokeWidth="2" /></svg>{labels.cum}
        </span>
      </div>
      <svg width={width} height={H} role="img" aria-label={labels.title} className="block">
        {tk.map((v) => (
          <g key={v}>
            <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--line)"} />
            <text x={left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="num">€{kfmt(v)}</text>
          </g>
        ))}
        {cf.map((v, i) => (
          <path key={i} d={barPath(cx(i) - bw / 2, bw, y(0), y(v))} fill="var(--s1)" opacity={hover === null || hover === i ? 1 : 0.55} />
        ))}
        <path d={line} fill="none" stroke="var(--s2)" strokeWidth={2} strokeLinejoin="round" />
        {cum.map((v, i) => (
          <circle key={i} cx={cx(i)} cy={y(v)} r={hover === i ? 5 : 3} fill="var(--s2)" stroke="var(--surface)" strokeWidth={1.5} />
        ))}
        {cf.map((_, i) => (i % (band < 22 ? 5 : 1) === 0 || i === cf.length - 1) && (
          <text key={i} x={cx(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)" className="num">{i}</text>
        ))}
        {cf.map((_, i) => (
          <rect key={i} x={left + band * i} y={top} width={band} height={H - top - bottom} fill="transparent"
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.max(0, Math.min(cx(hover) - 70, width - 190)), top: 26 }}>
          <div className="font-semibold">{labels.year} {hover}</div>
          <div className="flex justify-between gap-4"><span className="text-ink2">{labels.yearly}</span><span className="num">{eur(cf[hover])}</span></div>
          <div className="flex justify-between gap-4"><span className="text-ink2">{labels.cum}</span><span className="num">{eur(cum[hover])}</span></div>
        </div>
      )}
    </div>
  );
}
