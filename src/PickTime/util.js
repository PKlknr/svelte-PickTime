const markerIndex2Rad =
  (markerIndex, div) => (-markerIndex) / (div / 2) * Math.PI + Math.PI;

const sico = fn =>
  (markerIndex, r, div = 12) => r * fn(markerIndex2Rad(markerIndex, div));

export const cx = sico(Math.sin);
export const cy = sico(Math.cos);
