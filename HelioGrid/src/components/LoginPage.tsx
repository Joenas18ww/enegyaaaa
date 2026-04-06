import { useState, useEffect } from 'react';
import { Zap, ShieldCheck, Activity, Mail } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { parseAuthFromUrl } from '../utils/api';
import type { GoogleUser } from '../App';

interface LoginPageProps {
  onLogin: (user: GoogleUser) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const user = parseAuthFromUrl();
    if (user) onLogin(user as GoogleUser);

    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      setError('Sign-in failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [onLogin]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setInfo('');

    try {
      const res = await fetch(`${BACKEND_URL}/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send verification code.');

      setStep('verify');
      setInfo('Verification code sent to your email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot connect to server.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setInfo('');

    try {
      const res = await fetch(`${BACKEND_URL}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid verification code.');

      onLogin(data.user as GoogleUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot connect to server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-svh bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4 md:p-6 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -top-48 -left-48 animate-pulse" />
        <div className="absolute w-96 h-96 bg-sky-500/10 rounded-full blur-3xl -bottom-48 -right-48 animate-pulse delay-700" />
        <div className="absolute w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse delay-300" />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 relative z-10 items-center">
        <div className="hidden lg:flex flex-col justify-center text-white space-y-8 px-6 xl:px-8">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 bg-gradient-to-br from-sky-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl">
              <Zap className="w-9 h-9 text-white" />
            </div>
            <div>
              <h1 className="text-4xl mb-1">HelioGrid</h1>
              <p className="text-xl text-blue-200">Campus Resilience System</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-start gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
              <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <Activity className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h3 className="text-lg mb-1">Real-Time Monitoring</h3>
                <p className="text-sm text-blue-200">Monitor solar power, grid voltage, battery health, and load management in real-time</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
              <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <Zap className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg mb-1">Automated Control</h3>
                <p className="text-sm text-blue-200">Threshold-based anomaly detection and automatic source switching for optimal safety</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
              <div className="w-12 h-12 bg-orange-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-lg mb-1">Anomaly Detection</h3>
                <p className="text-sm text-blue-200">Advanced fault detection with instant email notifications and protective actions</p>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-white/10">
            <p className="text-sm text-blue-300">Raspberry Pi 4B-powered IoT solution for intelligent campus energy management</p>
          </div>
        </div>

        <div className="flex items-center justify-center px-0 sm:px-4 lg:px-0">
          <Card className="w-full max-w-md border-slate-200 shadow-2xl mx-auto">
            <CardHeader className="pb-3 pt-6">
              <div className="flex items-center justify-center gap-3 mb-4 lg:hidden">
                <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Zap className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h2 className="text-xl">HelioGrid</h2>
                  <p className="text-sm text-slate-600">Campus System</p>
                </div>
              </div>
              <h2 className="text-center text-2xl text-slate-800">Welcome Back</h2>
              <p className="text-center text-slate-500 text-sm mt-1">
                {step === 'request' ? 'Enter your email to receive a login code' : 'Enter the code sent to your email'}
              </p>
            </CardHeader>

            <CardContent className="pb-6">
              <div className="space-y-3">
                {error && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    {error}
                  </div>
                )}

                {info && (
                  <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                    {info}
                  </div>
                )}

                <form onSubmit={step === 'request' ? handleSendCode : handleVerifyCode} className="space-y-2">
                  <div>
                    <label className="block text-sm text-slate-500 mb-1 ml-0.5">Email address</label>
                    <div className="flex items-center gap-2 px-3 border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-sky-500 focus-within:border-transparent transition-all bg-white">
                      <Mail className="w-5 h-5 text-slate-400 flex-shrink-0" />
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        className="flex-1 py-2 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
                        required
                        disabled={step === 'verify'}
                      />
                    </div>
                  </div>

                  {step === 'verify' && (
                    <div>
                      <label className="block text-sm text-slate-500 mb-1 ml-0.5">Verification Code</label>
                      <div className="flex items-center gap-2 px-3 border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-sky-500 focus-within:border-transparent transition-all bg-white">
                        <input
                          id="code"
                          type="text"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          placeholder="Enter 6-digit code"
                          className="flex-1 py-2 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400 tracking-widest"
                          inputMode="numeric"
                          maxLength={8}
                          required
                        />
                      </div>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white py-3 rounded-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading
                      ? (step === 'request' ? 'Sending code...' : 'Verifying...')
                      : (step === 'request' ? 'Send verification code' : 'Continue')}
                  </Button>

                  {step === 'verify' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isLoading}
                      onClick={() => { setStep('request'); setCode(''); setInfo(''); setError(''); }}
                      className="w-full"
                    >
                      Change email
                    </Button>
                  )}
                </form>

                <div className="text-center text-xs text-slate-500">
                  Use your registered email to receive a one-time login code.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
