import { useState } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { Button, Field, Input, Mark } from './ui';

/** Email-link sign-in: no passwords, no accounts to set up beyond an email address. */
export default function SignIn({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setState('sending');
    setError(null);
    const { error } = await supabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) {
      setError(error.message);
      setState('idle');
    } else {
      setState('sent');
    }
  };

  return (
    <div className="min-h-screen bg-paper px-4 py-10 text-ink">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-2 text-forest">
          <Mark size={26} />
          <span className="text-2xl font-extrabold tracking-tight text-ink">JobSnipe</span>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          JobSnipe checks your target companies' job boards every hour and emails you the moment a role that fits is
          posted, so you can be one of the first applicants.
        </p>

        <div className="mt-6 rounded-xl border border-line-strong bg-white p-5 shadow-sm">
          {state === 'sent' ? (
            <>
              <h2 className="text-base font-bold">Check your email</h2>
              <p className="mt-1 text-sm text-ink-soft">
                We sent a sign-in link to <b>{email.trim()}</b>. Open it on this device to continue. It can take a minute,
                and it may land in spam the first time.
              </p>
              <button onClick={() => setState('idle')} className="mt-3 text-sm font-medium text-forest underline-offset-2 hover:underline">
                Use a different email
              </button>
            </>
          ) : (
            <>
              <h2 className="text-base font-bold">Sign in</h2>
              <p className="mt-1 text-sm text-muted">Enter your email and we'll send you a link. New here? The same link creates your account.</p>
              <div className="mt-4 space-y-3">
                <Field label="Email">
                  <Input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && send()}
                    placeholder="you@example.com"
                    disabled={!supabaseConfigured}
                  />
                </Field>
                {!supabaseConfigured && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Sign-in isn't switched on yet. Try the demo meanwhile.</p>}
                {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button variant="primary" onClick={send} disabled={!supabaseConfigured || state === 'sending' || !email.includes('@')}>
                    {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
                  </Button>
                  <button onClick={onDemo} className="text-sm font-medium text-forest underline-offset-2 hover:underline">
                    Just looking? See the demo →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
