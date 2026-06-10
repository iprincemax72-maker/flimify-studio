// Settings — ported 1:1 from the Premiere extension (same accent palette, the
// same theme backgrounds, the same generation defaults), persisted to
// localStorage and applied live via CSS variables.

export type Settings = {
  theme: string;
  accent: string;
  particles: 'off' | 'dust' | 'bokeh' | 'stars' | 'network';
  bootIntro: boolean;
  aspect: 'auto' | '9:16' | '16:9' | '1:1';
  duration: 'auto' | '3' | '5' | '10' | '15' | '30';
  engine: 'remotion' | 'hyperframes';
  versions: '1' | '2' | '3' | '5' | 'all';
  expand: 'light' | 'medium' | 'heavy';
  confirmImport: boolean;
};

export const SETTINGS_DEFAULTS: Settings = {
  theme: 'dark',
  accent: 'coral',
  particles: 'dust',
  bootIntro: true,
  aspect: 'auto',
  duration: 'auto',
  engine: 'remotion',
  versions: '3',
  expand: 'light',
  confirmImport: false,
};

const KEY = 'flimifyStudio.settings';

// 1:1 from the extension
export const ACCENT_PALETTES: Record<string, { accent: string; accent2: string; hover: string; soft: string; line: string; glow: string; rgb: string }> = {
  coral:   { accent: '#d97757', accent2: '#e89a6c', hover: '#e88566', soft: 'rgba(217,119,87,0.14)', line: 'rgba(217,119,87,0.45)', glow: 'rgba(217,119,87,0.55)', rgb: '217,119,87' },
  violet:  { accent: '#8b6dd9', accent2: '#a48de0', hover: '#9a7fe0', soft: 'rgba(139,109,217,0.14)', line: 'rgba(139,109,217,0.45)', glow: 'rgba(139,109,217,0.55)', rgb: '139,109,217' },
  emerald: { accent: '#6fbf8a', accent2: '#89cfa1', hover: '#7fc998', soft: 'rgba(111,191,138,0.14)', line: 'rgba(111,191,138,0.45)', glow: 'rgba(111,191,138,0.55)', rgb: '111,191,138' },
  amber:   { accent: '#e89a4e', accent2: '#f0b370', hover: '#eda864', soft: 'rgba(232,154,78,0.14)', line: 'rgba(232,154,78,0.45)', glow: 'rgba(232,154,78,0.55)', rgb: '232,154,78' },
  sky:     { accent: '#5eb6e8', accent2: '#7fc6ec', hover: '#73beea', soft: 'rgba(94,182,232,0.14)', line: 'rgba(94,182,232,0.45)', glow: 'rgba(94,182,232,0.55)', rgb: '94,182,232' },
  rose:    { accent: '#e85d8a', accent2: '#f07ea3', hover: '#ec6e96', soft: 'rgba(232,93,138,0.14)', line: 'rgba(232,93,138,0.45)', glow: 'rgba(232,93,138,0.55)', rgb: '232,93,138' },
  cyan:    { accent: '#43d6c8', accent2: '#6ee0d5', hover: '#57dbce', soft: 'rgba(67,214,200,0.14)', line: 'rgba(67,214,200,0.45)', glow: 'rgba(67,214,200,0.55)', rgb: '67,214,200' },
  lime:    { accent: '#a8d85c', accent2: '#bce07e', hover: '#b2dc6d', soft: 'rgba(168,216,92,0.14)', line: 'rgba(168,216,92,0.45)', glow: 'rgba(168,216,92,0.55)', rgb: '168,216,92' },
  gold:    { accent: '#e8c44e', accent2: '#f0d375', hover: '#eccb61', soft: 'rgba(232,196,78,0.14)', line: 'rgba(232,196,78,0.45)', glow: 'rgba(232,196,78,0.55)', rgb: '232,196,78' },
  magenta: { accent: '#c95ee8', accent2: '#d77fee', hover: '#d06eeb', soft: 'rgba(201,94,232,0.14)', line: 'rgba(201,94,232,0.45)', glow: 'rgba(201,94,232,0.55)', rgb: '201,94,232' },
  crimson: { accent: '#e8526a', accent2: '#f0758a', hover: '#ec6378', soft: 'rgba(232,82,106,0.14)', line: 'rgba(232,82,106,0.45)', glow: 'rgba(232,82,106,0.55)', rgb: '232,82,106' },
  ice:     { accent: '#8fb8f0', accent2: '#aacaf4', hover: '#9cc1f2', soft: 'rgba(143,184,240,0.14)', line: 'rgba(143,184,240,0.45)', glow: 'rgba(143,184,240,0.55)', rgb: '143,184,240' },
};

export const THEME_BGS: Record<string, { base: string; elevated: string }> = {
  dark:     { base: '#0b0c0e', elevated: '#131418' },
  dim:      { base: '#16161a', elevated: '#1f1f24' },
  midnight: { base: '#06060a', elevated: '#0e0e14' },
  aurora:   { base: '#07120f', elevated: '#0d1c18' },
  nebula:   { base: '#0c0814', elevated: '#160f20' },
  carbon:   { base: '#050506', elevated: '#101012' },
};

export const ACCENT_ORDER = Object.keys(ACCENT_PALETTES);
export const THEME_ORDER: { val: string; label: string }[] = [
  { val: 'dark', label: 'Dark' }, { val: 'dim', label: 'Dim' }, { val: 'midnight', label: 'Midnight' },
  { val: 'aurora', label: 'Aurora' }, { val: 'nebula', label: 'Nebula' }, { val: 'carbon', label: 'Carbon' },
];

export function loadSettings(): Settings {
  try {
    return { ...SETTINGS_DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>) };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

/** Apply accent + theme to CSS variables (live). */
export function applySettings(s: Settings) {
  const root = document.documentElement.style;
  const p = ACCENT_PALETTES[s.accent] || ACCENT_PALETTES.coral;
  root.setProperty('--accent', p.accent);
  root.setProperty('--accent-2', p.accent2);
  root.setProperty('--accent-hover', p.hover);
  root.setProperty('--accent-soft', p.soft);
  root.setProperty('--accent-line', p.line);
  root.setProperty('--accent-glow', p.glow);
  root.setProperty('--accent-rgb', p.rgb);
  const t = THEME_BGS[s.theme] || THEME_BGS.dark;
  root.setProperty('--bg', t.base);
  root.setProperty('--panel', t.elevated);
}

/** aspect → composition dimensions for generated graphics. */
export function aspectDims(aspect: Settings['aspect'], fallbackW: number, fallbackH: number): [number, number] {
  switch (aspect) {
    case '9:16': return [1080, 1920];
    case '16:9': return [1920, 1080];
    case '1:1': return [1080, 1080];
    default: return [fallbackW, fallbackH];
  }
}
