// The vault door drawn in SVG (steel plate, rivets, brass wheel). Colours come from style.css.
import { s } from './dom';

const C = 100;
const RIVETS = 14;

export const vaultDoor = (): SVGSVGElement => {
  const rivets = Array.from({ length: RIVETS }, (_, i) => {
    const a = (i / RIVETS) * Math.PI * 2;
    return s('circle', {
      class: 'd-rivet',
      cx: (C + Math.cos(a) * 78).toFixed(1),
      cy: (C + Math.sin(a) * 78).toFixed(1),
      r: 4.5,
    });
  });
  const spokes = [0, 60, 120].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a) * 44;
    const dy = Math.sin(a) * 44;
    const line = (cls: string) =>
      s('line', {
        class: cls,
        x1: (C - dx).toFixed(1),
        y1: (C - dy).toFixed(1),
        x2: (C + dx).toFixed(1),
        y2: (C + dy).toFixed(1),
      });
    return [line('d-spoke-o'), line('d-spoke')];
  });
  const knobs = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return s('circle', {
      class: 'd-knob',
      cx: (C + Math.cos(a) * 46).toFixed(1),
      cy: (C + Math.sin(a) * 46).toFixed(1),
      r: 8,
    });
  });
  return s(
    'svg',
    {
      class: 'door-svg',
      viewBox: '0 0 200 200',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    s('rect', { class: 'd-hinge', x: 2, y: 56, width: 30, height: 24, rx: 7 }),
    s('rect', { class: 'd-hinge', x: 2, y: 120, width: 30, height: 24, rx: 7 }),
    s('circle', { class: 'd-plate', cx: C, cy: C, r: 90 }),
    s('circle', { class: 'd-face', cx: C, cy: C, r: 66 }),
    s('circle', { class: 'd-groove', cx: C, cy: C, r: 57 }),
    s('path', { class: 'd-shine', d: 'M30 82 A72 72 0 0 1 74 33' }),
    ...rivets,
    s(
      'g',
      { class: 'd-wheel' },
      ...spokes.flat(),
      ...knobs,
      s('circle', { class: 'd-hub', cx: C, cy: C, r: 17 }),
      s('circle', { class: 'd-hub-dot', cx: C, cy: C, r: 5 })
    )
  );
};
