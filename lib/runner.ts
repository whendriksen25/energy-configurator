// Runs the optimisation on a small pool of background workers.
import type { Inputs, Packed } from "./engine/configurator";
import { pack } from "./engine/configurator";
import type { Design, Row } from "./engine/model";

export type Options = {
  pv: number[]; battery: number[]; chargers: [number, number][]; connections: string[];
  pattern: string; ref_set: [number, number] | null;
};
export type RunResult = { options: Options; designs: Design[]; rows: Row[]; packed: Packed; seconds: number };
export type Detail = {
  row: Row; cf: number[];
  days: Record<"building" | "ev" | "solar" | "import" | "export" | "battery" | "baseImport", number[][]>;
  monthlyPeak: number[]; baseMonthlyPeak: number[];
};

let seq = 0;
const newWorker = () => new Worker(new URL("./engine/worker.ts", import.meta.url));

function call<T>(w: Worker, msg: Record<string, unknown>, onProgress?: (done: number) => void): Promise<T> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const h = (e: MessageEvent) => {
      const d = e.data;
      if (d.id !== id) return;
      if (d.kind === "progress") { onProgress?.(d.done); return; }
      w.removeEventListener("message", h);
      if (d.kind === "error") reject(new Error(d.message));
      else resolve(d as T);
    };
    w.addEventListener("message", h);
    w.postMessage({ ...msg, id });
  });
}

export async function optimise(inputs: Inputs, onProgress: (done: number, total: number) => void): Promise<RunResult> {
  const t0 = performance.now();
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers = Array.from({ length: n }, newWorker);
  try {
    const prep = await call<{ options: Options; designs: Design[] }>(workers[0], { kind: "prepare", inputs });
    const designs = prep.designs;
    const total = designs.length;
    onProgress(0, total);
    // contiguous chunks keep designs that share smart-charging results together
    const size = Math.ceil(total / n);
    const done = new Array(n).fill(0);
    const parts = await Promise.all(workers.map((w, k) => {
      const slice = designs.slice(k * size, (k + 1) * size);
      if (!slice.length) return Promise.resolve({ rows: [] as Row[] });
      return call<{ rows: Row[] }>(w, { kind: "run", inputs, designs: slice }, (d) => {
        done[k] = d;
        onProgress(done.reduce((a, b) => a + b, 0), total);
      });
    }));
    const rows = parts.flatMap((p) => p.rows);
    return { options: prep.options, designs, rows, packed: pack(rows), seconds: (performance.now() - t0) / 1000 };
  } finally {
    workers.forEach((w) => w.terminate());
  }
}

export async function detail(inputs: Inputs, design: Design): Promise<Detail> {
  const w = newWorker();
  try {
    return await call<Detail>(w, { kind: "detail", inputs, design });
  } finally {
    w.terminate();
  }
}
