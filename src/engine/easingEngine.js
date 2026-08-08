/**
 * Animation Easing & Spline Curves Engine for Professional Keyframe Animation System
 */

// Preset Cubic Easing Curves
export const EASING_PRESETS = {
  linear: { name: 'Linear', ease: (t) => t, cubic: [0, 0, 1, 1] },
  easeInQuad: { name: 'Ease In (Quad)', ease: (t) => t * t, cubic: [0.11, 0, 0.5, 0] },
  easeOutQuad: { name: 'Ease Out (Quad)', ease: (t) => t * (2 - t), cubic: [0.5, 1, 0.89, 1] },
  easeInOutQuad: { name: 'Ease In-Out (Quad)', ease: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t, cubic: [0.45, 0, 0.55, 1] },
  easeInCubic: { name: 'Ease In (Cubic)', ease: (t) => t * t * t, cubic: [0.32, 0, 0.67, 0] },
  easeOutCubic: { name: 'Ease Out (Cubic)', ease: (t) => (--t) * t * t + 1, cubic: [0.33, 1, 0.68, 1] },
  easeInOutCubic: { name: 'Ease In-Out (Cubic)', ease: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1, cubic: [0.65, 0, 0.35, 1] },
  easeInBack: { name: 'Ease In (Back/Anticipate)', ease: (t) => { const c1 = 1.70158; return (c1 + 1) * t * t * t - c1 * t * t; }, cubic: [0.36, 0, 0.66, -0.56] },
  easeOutBack: { name: 'Ease Out (Back/Overshoot)', ease: (t) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }, cubic: [0.34, 1.56, 0.64, 1] },
  easeOutBounce: { name: 'Ease Out (Bounce)', ease: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }, cubic: [0.34, 1.34, 0.64, 1] },
  hold: { name: 'Hold (Step)', ease: (t) => (t >= 1 ? 1 : 0), cubic: [0, 0, 0, 0] },
};

/**
 * 1D Catmull-Rom Cubic Spline evaluation for smooth continuous bezier curves across points
 */
export function evaluateCatmullRomSpline(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Get eased progress ratio based on selected easing type or custom bezier curve
 */
export function getEasedProgress(easingType, progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const preset = EASING_PRESETS[easingType] || EASING_PRESETS.linear;
  return preset.ease(clamped);
}
