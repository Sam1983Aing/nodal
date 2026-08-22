/*
 * NODAL — scroll conductor (carried over from AXIAL, which is where this
 * pattern was worked out).
 *
 * Scroll conductor.
 *
 * One normalized, reversible state object that every subsystem reads. The
 * camera reads `smooth`, the interface reads `exact`, and the rotor reads
 * `speed`. Nothing recomputes chapter rules on its own.
 */

/* Some embedded/headless viewers report a zero-height window before their
   first real layout. Every measurement here goes through these so a single
   division can never poison the state with NaN. */
let probe = null;
const probeBox = () => (probe = probe || document.getElementById('vh-probe'));
export const vw = () =>
  Math.max(1, window.innerWidth || document.documentElement.clientWidth || probeBox()?.offsetWidth || 1280);
export const vh = () =>
  Math.max(1, window.innerHeight || document.documentElement.clientHeight || probeBox()?.offsetHeight || 800);

export class Conductor {
  constructor(sections) {
    this.sections = sections;
    this.anchors = [];
    this.state = {
      exact: 0,        // fractional chapter from the document, undamped
      smooth: 0,       // damped, what the camera follows
      index: 0,        // Math.round(exact), what the interface owns
      next: 1,
      localExact: 0,
      localSmooth: 0,
      direction: 1,
      progress: 0,     // 0..1 across the whole route
      speed: 0,        // |scroll velocity| in viewport heights per second
      signedSpeed: 0,
      jolt: 0,         // one-frame spike when speed changes abruptly
    };
    this._lastY = window.scrollY;
    this._lastSpeed = 0;
    this._speedRaw = 0;
    this.hold = null; // test override: pin `exact` to a fractional chapter
    this.measure();
  }

  measure() {
    this.anchors = this.sections.map((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top + window.scrollY + rect.height * 0.5 - vh() * 0.5;
    });
  }

  /** Convert document scroll into a fractional chapter such as 2.35. */
  read(dt) {
    const y = window.scrollY;
    const a = this.anchors;
    const s = this.state;

    let exact = 0;
    if (this.hold != null) {
      exact = this.hold;
    } else if (a.length > 1) {
      if (y <= a[0]) {
        exact = 0;
      } else if (y >= a[a.length - 1]) {
        exact = a.length - 1;
      } else {
        for (let i = 0; i < a.length - 1; i++) {
          if (y >= a[i] && y <= a[i + 1]) {
            const span = a[i + 1] - a[i];
            exact = i + (span > 0 ? (y - a[i]) / span : 0);
            break;
          }
        }
      }
    }

    const dy = y - this._lastY;
    this._lastY = y;

    // Viewport heights per second, low-passed so a trackpad's spiky deltas
    // do not read as a hundred separate jolts.
    const instant = dt > 0 ? dy / vh() / dt : 0;
    this._speedRaw += (instant - this._speedRaw) * Math.min(1, dt * 14);
    if (!Number.isFinite(this._speedRaw)) this._speedRaw = 0;

    const speed = Math.abs(this._speedRaw);
    s.jolt = Math.max(0, speed - this._lastSpeed);
    this._lastSpeed = speed;

    if (Math.abs(dy) > 0.5) s.direction = Math.sign(dy);

    s.exact = exact;
    s.index = Math.min(a.length - 1, Math.max(0, Math.round(exact)));
    s.next = Math.min(a.length - 1, Math.floor(exact) + 1);
    s.localExact = exact - Math.floor(exact);
    s.progress = a.length > 1 ? exact / (a.length - 1) : 0;
    s.speed = speed;
    s.signedSpeed = this._speedRaw;

    const damp = 1 - Math.exp(-5.4 * dt);
    s.smooth += (exact - s.smooth) * damp;
    s.localSmooth = s.smooth - Math.floor(s.smooth);

    return s;
  }

  /** Test hook: drive the conductor without a real scroll event. */
  force(progress) {
    const n = this.anchors.length;
    const exact = progress * (n - 1);
    const s = this.state;
    s.exact = exact;
    s.smooth = exact;
    s.index = Math.min(n - 1, Math.max(0, Math.round(exact)));
    s.progress = progress;
    s.localExact = s.localSmooth = exact - Math.floor(exact);
  }
}

/* --- interpolation helpers ---------------------------------------- */

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Monotone interpolation across an array of scalars. The cutting station
 * must never travel backwards while the visitor scrolls forwards, so this
 * deliberately avoids Catmull-Rom overshoot.
 */
export function monotone(values, t) {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  const f = clamp(t, 0, n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  return lerp(values[i], values[i + 1], smootherstep(f - i));
}
