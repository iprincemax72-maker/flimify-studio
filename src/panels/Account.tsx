// Account widget — REAL Google sign-in via the same Supabase project the
// Premiere extension uses, so the real name + Google profile picture show up.
// If you're already signed into the extension, Studio picks up that session on
// load (no re-login). "Sign in with Google" opens the bridge's /connect OAuth
// page in the browser, then polls until signed in.
import { useEffect, useRef, useState } from 'react';
import { authStatus, authSignOut, authReconnect, BRIDGE, type AuthStatus } from '../api';
import { toast } from '../ui/feedback';

const openUrl = (url: string) => { try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ } };

export const Account: React.FC = () => {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | undefined>(undefined);

  const refresh = async () => { try { setStatus(await authStatus()); } catch { setStatus(null); } };
  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => { clearInterval(t); clearInterval(pollRef.current); }; }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const dashboard = () => openUrl(status?.dashboard || 'https://www.flimify.com/account.html');

  const signIn = async () => {
    // First, undo an explicit sign-out + reuse the extension session if present
    // (instant, no browser round-trip).
    try { const s = await authReconnect(); if (s.signedIn) { setStatus(s); toast('Signed in as ' + (s.name || s.email) + '.'); return; } } catch { /* ignore */ }
    openUrl(BRIDGE + '/connect?reauth=1');  // else: Supabase Google OAuth in the browser
    setPending(true);
    let tries = 0;
    clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      tries++;
      try {
        const s = await authStatus();
        if (s.signedIn) { setStatus(s); setPending(false); clearInterval(pollRef.current); toast('Signed in as ' + (s.name || s.email) + '.'); }
      } catch { /* ignore */ }
      if (tries > 150) { setPending(false); clearInterval(pollRef.current); }
    }, 2000);
  };
  const signOut = async () => { try { setStatus(await authSignOut()); toast('Signed out.'); } catch { /* ignore */ } setOpen(false); };

  const signedIn = !!status?.signedIn;
  const initial = (status?.name || status?.email || 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="acct" ref={ref}>
      <button className={'btn icon acct-btn' + (signedIn ? ' on' : '')} onClick={() => setOpen((o) => !o)} title="Account" aria-label="Account">
        {signedIn ? (
          status?.avatar ? <img src={status.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="acct-initial">{initial}</span>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        )}
      </button>

      {open && (
        <div className="acct-pop">
          {signedIn ? (
            <>
              <div className="acct-head">
                <div className="acct-av">{status?.avatar ? <img src={status.avatar} alt="" referrerPolicy="no-referrer" /> : initial}</div>
                <div className="acct-id">
                  <b>{status?.name || 'Account'}</b>
                  {status?.email && <span>{status.email}</span>}
                </div>
              </div>
              <div className="acct-plan">
                <span className="acct-plan-name">{status?.owner ? 'Owner' : (status?.plan || 'Free')}</span>
                <span className="acct-usage">{status?.unlimited ? '∞ renders' : `${status?.renders_used}/${status?.renders_limit}`}</span>
              </div>
              <div className="acct-note">Unlimited — running on your own Claude.</div>
              <div className="acct-actions">
                <button onClick={dashboard}>Dashboard ↗</button>
                <button className="danger" onClick={signOut}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <div className="acct-title">Sign in</div>
              <div className="acct-sub">Continue with Google. Studio runs unlimited on your own Claude — no account needed.</div>
              <button className="acct-google" onClick={signIn} disabled={pending}>
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" /></svg>
                {pending ? 'Waiting for browser…' : 'Continue with Google'}
              </button>
              <button className="acct-link" onClick={dashboard}>Open Dashboard ↗</button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
