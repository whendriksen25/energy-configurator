// Port of numpy's default_rng (PCG64) with the standard-normal (ziggurat) and
// beta distributions, so the browser draws the same weather, price and noise
// series as the Python reference model.

const M128 = (1n << 128n) - 1n;
const M64 = (1n << 64n) - 1n;
const MULT = (2549297995355413924n << 64n) | 4865540595714422341n;
const TWO53 = 9007199254740992;

// PCG64 state right after numpy seeds it (SeedSequence), for the seeds the model uses.
const SEEDED: Record<number, [bigint, bigint]> = {
  42: [0xcea44f6798798f2aacbc7c9d68860ac8n, 0xfa505436c9a8416e66caf2e28d25abffn],
  49: [0x55ab433d97f3eff9ae9ca52e64c4d4ebn, 0xf62371b0e8585c3f4904de7892f39ce3n],
  55: [0xc4beab6ef9a6a205a0dd943e48f2d2a8n, 0x19a1dc093c6e2305b4265993c26ff2dfn],
  63: [0x9e465455af3515de79e88da76442c3e4n, 0xbafd2e9dbd5eb50d3417021107c672a1n],
};

// Ziggurat tables (256 layers), rebuilt the way numpy's were generated.
const ZIG_R = 3.6541528853610087963519472518;
const ZIG_INV_R = 0.27366123732975827203338247596;
const KI = new Float64Array(256);
const WI = new Float64Array(256);
const FI = new Float64Array(256);
(function buildTables() {
  const v = 0.004928673233974652; // layer area implied by numpy's table
  const m1 = 2 ** 52;
  let dn = ZIG_R;
  let tn = dn;
  const q = v / Math.exp(-0.5 * dn * dn);
  KI[0] = Math.floor((dn / q) * m1);
  KI[1] = 0;
  WI[0] = q / m1;
  WI[255] = dn / m1;
  FI[0] = 1.0;
  FI[255] = Math.exp(-0.5 * dn * dn);
  for (let i = 254; i >= 1; i--) {
    dn = Math.sqrt(-2 * Math.log(v / dn + Math.exp(-0.5 * dn * dn)));
    KI[i + 1] = Math.floor((dn / tn) * m1);
    tn = dn;
    FI[i] = Math.exp(-0.5 * dn * dn);
    WI[i] = dn / m1;
  }
})();

export class Rng {
  private state: bigint;
  private inc: bigint;

  constructor(seed: number) {
    const s = SEEDED[seed];
    if (!s) throw new Error(`No PCG64 state for seed ${seed}`);
    [this.state, this.inc] = s;
  }

  nextUint64(): bigint {
    this.state = (this.state * MULT + this.inc) & M128;
    const hi = this.state >> 64n;
    const lo = this.state & M64;
    const x = hi ^ lo;
    const rot = this.state >> 122n;
    return ((x >> rot) | (x << ((64n - rot) & 63n))) & M64;
  }

  nextDouble(): number {
    return Number(this.nextUint64() >> 11n) / TWO53;
  }

  standardNormal(): number {
    for (;;) {
      let r = this.nextUint64();
      const idx = Number(r & 0xffn);
      r >>= 8n;
      const sign = Number(r & 1n);
      const rabsBig = (r >> 1n) & 0x000fffffffffffffn;
      const rabs = Number(rabsBig);
      let x = rabs * WI[idx];
      if (sign) x = -x;
      if (rabs < KI[idx]) return x;
      if (idx === 0) {
        for (;;) {
          const xx = -ZIG_INV_R * Math.log1p(-this.nextDouble());
          const yy = -Math.log1p(-this.nextDouble());
          if (yy + yy > xx * xx) {
            return Number((rabsBig >> 8n) & 1n) ? -(ZIG_R + xx) : ZIG_R + xx;
          }
        }
      } else if ((FI[idx - 1] - FI[idx]) * this.nextDouble() + FI[idx] < Math.exp(-0.5 * x * x)) {
        return x;
      }
    }
  }

  normal(loc: number, scale: number, n: number): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = loc + scale * this.standardNormal();
    return out;
  }

  private standardGamma(shape: number): number {
    // shape > 1 only (all betas in the model use a, b > 1)
    const b = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * b);
    for (;;) {
      let X: number;
      let V: number;
      do {
        X = this.standardNormal();
        V = 1 + c * X;
      } while (V <= 0);
      V = V * V * V;
      const U = this.nextDouble();
      if (U < 1 - 0.0331 * (X * X) * (X * X)) return b * V;
      if (Math.log(U) < 0.5 * X * X + b * (1 - V + Math.log(V))) return b * V;
    }
  }

  beta(a: number, b: number, n: number): Float64Array {
    if (a <= 1 || b <= 1) throw new Error("beta: only a, b > 1 supported");
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ga = this.standardGamma(a);
      const gb = this.standardGamma(b);
      out[i] = ga / (ga + gb);
    }
    return out;
  }
}
