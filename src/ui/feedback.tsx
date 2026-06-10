// Shared UI primitives — toasts, a promise-based confirm modal, and a lightbox.
// Ported 1:1 in spirit from the extension's ccToast / ccConfirm / openLightbox,
// exposed as imperative functions so any module can call them, with a single
// <FeedbackHost/> mounted at the app root that does the rendering.
import { useEffect, useState } from 'react';

// ── tiny pub/sub so imperative calls reach the React host ──
type Toast = { id: number; msg: string; err?: boolean };
type Confirm = {
  id: number;
  title: string;
  message?: string;
  okLabel: string;
  cancelLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};
type Light = { src: string; kind: 'image' | 'video'; caption?: string } | null;

let _id = 1;
const toastSubs = new Set<(t: Toast[]) => void>();
const confirmSubs = new Set<(c: Confirm | null) => void>();
const lightSubs = new Set<(l: Light) => void>();
let _toasts: Toast[] = [];
let _confirm: Confirm | null = null;
let _light: Light = null;

const emitToasts = () => toastSubs.forEach((f) => f(_toasts));
const emitConfirm = () => confirmSubs.forEach((f) => f(_confirm));
const emitLight = () => lightSubs.forEach((f) => f(_light));

/** Top-right auto-dismissing toast (3.5s, 5.5s for errors). */
export function toast(msg: string, err = false) {
  const t: Toast = { id: _id++, msg, err };
  _toasts = [..._toasts, t];
  emitToasts();
  setTimeout(() => {
    _toasts = _toasts.filter((x) => x.id !== t.id);
    emitToasts();
  }, err ? 5500 : 3500);
}

/** Promise-based confirm. Resolves true on OK, false on cancel/Esc/backdrop. */
export function confirmDialog(opts: {
  title: string; message?: string; okLabel?: string; cancelLabel?: string; danger?: boolean;
}): Promise<boolean> {
  // Rapid-click guard: a new confirm replaces (and cancels) any open one.
  if (_confirm) { _confirm.resolve(false); }
  return new Promise<boolean>((resolve) => {
    _confirm = {
      id: _id++,
      title: opts.title,
      message: opts.message,
      okLabel: opts.okLabel || 'OK',
      cancelLabel: opts.cancelLabel || 'Cancel',
      danger: opts.danger,
      resolve,
    };
    emitConfirm();
  });
}

export function openLightbox(l: NonNullable<Light>) { _light = l; emitLight(); }
export function closeLightbox() { _light = null; emitLight(); }

// ── the single host that renders everything ──
export const FeedbackHost: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>(_toasts);
  const [confirm, setConfirm] = useState<Confirm | null>(_confirm);
  const [light, setLight] = useState<Light>(_light);

  useEffect(() => {
    toastSubs.add(setToasts); confirmSubs.add(setConfirm); lightSubs.add(setLight);
    return () => { toastSubs.delete(setToasts); confirmSubs.delete(setConfirm); lightSubs.delete(setLight); };
  }, []);

  const resolveConfirm = (ok: boolean) => {
    if (!confirm) return;
    confirm.resolve(ok);
    _confirm = null; emitConfirm();
  };

  // Esc / Enter on the confirm modal; Esc on the lightbox.
  useEffect(() => {
    if (!confirm && !light) return;
    const onKey = (e: KeyboardEvent) => {
      if (confirm) {
        if (e.key === 'Escape') { e.preventDefault(); resolveConfirm(false); }
        else if (e.key === 'Enter') { e.preventDefault(); resolveConfirm(true); }
      } else if (light && e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, light]);

  return (
    <>
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>
        ))}
      </div>

      {confirm && (
        <div className="cc-confirm" onMouseDown={(e) => { if (e.target === e.currentTarget) resolveConfirm(false); }}>
          <div className="cc-card" role="dialog" aria-modal>
            <div className="cc-title">{confirm.title}</div>
            {confirm.message && <div className="cc-msg">{confirm.message}</div>}
            <div className="cc-actions">
              <button className="cc-btn" onClick={() => resolveConfirm(false)}>{confirm.cancelLabel}</button>
              <button className={'cc-btn ' + (confirm.danger ? 'danger' : 'primary')} onClick={() => resolveConfirm(true)}>{confirm.okLabel}</button>
            </div>
          </div>
        </div>
      )}

      {light && (
        <div className="lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}>
          <button className="lightbox-close" onClick={closeLightbox} aria-label="Close">✕</button>
          <div className="lightbox-body">
            {light.kind === 'video'
              ? <video src={light.src} autoPlay loop controls />
              : <img src={light.src} alt={light.caption || ''} />}
          </div>
          {light.caption && <div className="lightbox-cap">{light.caption}</div>}
        </div>
      )}
    </>
  );
};
