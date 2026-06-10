// Account widget — ported from the extension: a header button + a popover with
// sign-in (Google), the signed-in account (avatar, name, plan, usage), and
// sign-out. Studio runs on the user's own Claude, so generation is always
// unlimited and never requires an account — sign-in is for syncing a
// flimify.com account (real Google auth completes on the website).
import { useEffect, useRef, useState } from 'react';
import { authStatus, authSignIn, authSignOut, authConnectUrl, type AuthStatus } from '../api';
import { toast } from '../ui/feedback';

const openExternal = (url: string) => {
  // desktop opens via the OS; browser opens a tab
  try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
};

export const Account: React.FC = () => {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = async () => { try { setStatus(await authStatus()); } catch { setStatus(null); } };
  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const signIn = async () => {
    const url = await authConnectUrl();
    openExternal(url); // real Google sign-in lives on flimify.com
    try { setStatus(await authSignIn('You', '')); toast('Signed in (local). Manage your account on flimify.com.'); }
    catch { /* ignore */ }
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
                <span className="acct-plan-name">{status?.owner ? 'Owner' : (status?.plan || 'Local')}</span>
                <span className="acct-usage">{status?.unlimited ? '∞ renders' : `${status?.renders_used}/${status?.renders_limit}`}</span>
              </div>
              <div className="acct-note">Unlimited — running on your own Claude.</div>
              <div className="acct-actions">
                <button onClick={() => openExternal((status?.site || 'https://www.flimify.com') + '/account')}>Open account ↗</button>
                <button className="danger" onClick={signOut}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <div className="acct-title">Sign in</div>
              <div className="acct-sub">Generation is unlimited on your own Claude — no account needed. Sign in to sync a flimify.com account.</div>
              <button className="acct-google" onClick={signIn}>
                <svg viewBox="0 0 24 24" width="15" height="15"><path fill="#4285F4" d="M21.6 12.2c0-.6 0-1.2-.2-1.8H12v3.5h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" /><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.8V7.6H3.1a10 10 0 0 0 0 8.9z" /><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.6L6.4 10c.8-2.4 3-4 5.6-4z" /></svg>
                Sign in with Google
              </button>
              <button className="acct-link" onClick={() => openExternal((status?.site || 'https://www.flimify.com'))}>Open flimify.com ↗</button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
