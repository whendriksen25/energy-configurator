"use client";
import { useState } from "react";
import { useWidth, ticks, barPath } from "./useWidth";

export type ConnItem = { id: string; label: string; npv: number | null; summary: string };

export default function ConnectionsChart({ items, selected, onSelect, eur, notPossible, title }: {
  items: ConnItem[]; selected: string; onSelect: (id: string) => void;
  eur: (v: number) => string; notPossible: string; title: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 260, top = 18, bottom = 44, left = 64, right = 8;
  const vals = items.map((i) => i.npv ?? 0);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const tk = ticks(lo, hi, 4);
  const y0v = Math.min(lo, tk[0]), y1v = Math.max(hi, tk[tk.length - 1]);
  const y = (v: number) => top + ((y1v - v) / (y1v - y0v || 1)) * (H - top - bottom);
  const band = (width - left - right) / Math.max(items.length, 1);
  const bw = Math.min(56, band * 0.62);
  const kfmt = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : `${v}`);

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={H} role="img" aria-label={title} className="block">
        {tk.map((v) => (
          <g key={v}>
            <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--line)"} strokeWidth={1} />
            <text x={left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="num">€{kfmt(v)}</text>
          </g>
        ))}
        {items.map((it, i) => {
          const cx = left + band * i + band / 2;
          const sel = it.id === selected;
          return (
            <g key={it.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onClick={() => it.npv !== null && onSelect(it.id)} style={{ cursor: it.npv !== null ? "pointer" : "default" }}>
              <rect x={left + band * i} y={top} width={band} height={H - top - bottom} fill="transparent" />
              {it.npv !== null ? (
                <path d={barPath(cx - bw / 2, bw, y(0), y(it.npv))} fill="var(--s1)" opacity={sel || hover === i ? 1 : 0.55}
                  stroke={sel ? "var(--ink)" : "none"} strokeWidth={sel ? 1.5 : 0} />
              ) : (
                <text x={cx} y={y(0) - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">n/a</text>
              )}
              {sel && it.npv !== null && (
                <text x={cx} y={it.npv >= 0 ? y(it.npv) - 6 : y(it.npv) + 14} textAnchor="middle" fontSize="11" fontWeight={600} fill="var(--ink)" className="num">
                  {eur(it.npv)}
                </text>
              )}
              <text x={cx} y={H - bottom + 16} textAnchor={band < 48 ? "end" : "middle"} fontSize="11"
                fill={sel ? "var(--ink)" : "var(--ink-2)"} fontWeight={sel ? 600 : 400}
                transform={band < 48 ? `rotate(-40 ${cx} ${H - bottom + 12})` : undefined}>
                {band < 80 ? it.label.replace(/\s/g, "") : it.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(left + band * hover + band / 2, width - 180), top: 4 }}>
          <div className="font-semibold">{items[hover].label}</div>
          <div className="num">{items[hover].npv !== null ? eur(items[hover].npv!) : notPossible}</div>
          {items[hover].npv !== null && <div className="text-ink2">{items[hover].summary}</div>}
        </div>
      )}
    </div>
  );
}
