// Calibrated per-model coefficient profiles (see the host package README).
export interface H20Coefficients {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly nRequests: number
  readonly r2: number
  readonly medianRelErr: number
}

const QWEN_H20_INSTANT = {
  a: 0.1472796518,
  b: 8.8999022474,
  c: 0.7736639824,
  nRequests: 1434,
  r2: 0.999596,
  medianRelErr: 0.028229,
}

const QWEN_H20_THINKING = {
  a: 0.1434396374,
  b: 8.7922757907,
  c: 0.8881486801,
  nRequests: 1301,
  r2: 0.999739,
  medianRelErr: 0.026014,
}

const GEMMA_H20_INSTANT = {
  a: 0.2061794517,
  b: 10.5588686730,
  c: 1.3962853656,
  nRequests: 1202,
  r2: 0.998300,
  medianRelErr: 0.024305,
}

const GEMMA_H20_THINKING = {
  a: 0.2093063688,
  b: 10.6376018484,
  c: 1.2931363736,
  nRequests: 1188,
  r2: 0.999427,
  medianRelErr: 0.012332,
}

export const H20_PROFILES: Readonly<Record<string, Readonly<H20Coefficients>>> = {
  'qwen-h20-instant': QWEN_H20_INSTANT,
  'qwen-h20-thinking': QWEN_H20_THINKING,
  'gemma-h20-instant': GEMMA_H20_INSTANT,
  'gemma-h20-thinking': GEMMA_H20_THINKING,
}

export const H20_MODEL_PROFILES: Readonly<Record<string, Readonly<H20Coefficients>>> = {
  'qwen-h20': { a: 0.1453596446, b: 8.8460890191, c: 0.8309063313,
    nRequests: 0, r2: 0, medianRelErr: 0 },
  'gemma-h20': { a: 0.2077429103, b: 10.5982352607, c: 1.3447108696,
    nRequests: 0, r2: 0, medianRelErr: 0 },
}

export const H20_PROXY_COEFFICIENTS: Readonly<H20Coefficients> = {
  a: 0.1765512774,
  b: 9.7221621399,
  c: 1.0878086004,
  nRequests: 5125,
  r2: 0.982134,
  medianRelErr: 0.124239,
}

