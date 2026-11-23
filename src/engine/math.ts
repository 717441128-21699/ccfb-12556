import type { Vec2 } from './types';

/** 确定性伪随机数生成器（mulberry32），保证赛道可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-12 ? { x: 0, y: 1 } : { x: a.x / l, y: a.y / l };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 二维叉积标量（a×b 的 z 分量） */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 分段线性插值：profile 按 key 升序 */
export function interpolateProfile(
  profile: { y: number; value: number }[],
  y: number,
): number {
  if (y <= profile[0].y) return profile[0].value;
  const last = profile[profile.length - 1];
  if (y >= last.y) return last.value;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return lerp(a.value, b.value, t);
    }
  }
  return last.value;
}
