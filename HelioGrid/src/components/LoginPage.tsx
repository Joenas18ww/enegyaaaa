import { useState, useEffect } from 'react';
import { Zap, ShieldCheck, Activity, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { loginWithGoogle, parseAuthFromUrl } from '../utils/api';
import type { GoogleUser } from '../App';

interface LoginPageProps {
  onLogin: (user: GoogleUser) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const user = parseAuthFromUrl();
    if (user) {
      onLogin(user as GoogleUser);
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      setError('Google sign-in failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleGoogleSignIn = () => {
    setIsLoading(true);
    setError('');
    loginWithGoogle();
  };

  const handleEmailContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed.');
        setIsLoading(false);
        return;
      }
      onLogin(data.user as GoogleUser);
    } catch {
      setError('Cannot connect to server.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -top-48 -left-48 animate-pulse" />
        <div className="absolute w-96 h-96 bg-sky-500/10 rounded-full blur-3xl -bottom-48 -right-48 animate-pulse delay-700" />
        <div className="absolute w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse delay-300" />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10 items-center">

        {/* Left side - Branding */}
        <div className="hidden lg:flex flex-col justify-center text-white space-y-8 px-8">
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

        {/* Right side - Login Form */}
        <div className="flex items-center justify-center px-4">
          <Card className="w-full max-w-md border-slate-200 shadow-2xl">
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
              <h2 className="text-center text-2xl  text-slate-800">Welcome Back</h2>
              <p className="text-center text-slate-500 text-sm mt-1">Sign in to access your energy dashboard</p>
            </CardHeader>

            <CardContent className="pb-6">
              <div className="space-y-3">

                {/* Error */}
                {error && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    {error}
                  </div>
                )}

                {/* Google */}
                <button
                  onClick={handleGoogleSignIn}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      <span className="text-base text-slate-700 group-hover:text-slate-900">Continue with Google</span>
                    </>
                  )}
                </button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 bg-white text-xs text-slate-400">or</span>
                  </div>
                </div>

                {/* Form */}
                <form onSubmit={handleEmailContinue} className="space-y-2">

                  {/* Email field */}
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
                    />
                  </div>
                  </div>

                {/* Paswwrod field */}
                  <div>
                    <label className="block text-sm text-slate-500 mb-1 ml-0.5">Password</label>
                    <div className="flex items-center gap-2 px-3 border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-sky-500 focus-within:border-transparent transition-all bg-white">
                    <Lock className="w-5 h-5 text-slate-400 flex-shrink-0" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="flex-1 py-2 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 bg-white text-xs text-slate-400"></span>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white py-3 rounded-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Signing in...' : 'Sign in'}
                  </Button>
                </form>

                {/* Sign up link */}
                <div className="text-center">
                  <p className="text-xs text-slate-500">
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setShowSignUp(!showSignUp)}
                      className="text-sky-600 hover:text-sky-700 font-medium transition-colors"
                    >
                      Sign up
                    </button>
                  </p>
                </div>

                {showSignUp && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-800 font-medium mb-1">Create an Account</p>
                    <p className="text-xs text-blue-700 mb-2">Sign up to access the HelioGrid System dashboard.</p>
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs transition-all disabled:opacity-50"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Sign up with Google
                    </button>
                  </div>
                )}

                {/* Footer */}
                <div className="pt-2 border-t border-slate-100 text-center">
                  <p className="text-sm text-slate-400">For authorized administrators only</p>
                </div>

              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile features */}
      <div className="lg:hidden absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-900 to-transparent">
        <div className="flex items-center justify-center gap-6 text-white text-xs">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-400" />
            <span>Real-Time</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400" />
            <span>Automated</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-orange-400" />
            <span>Secure</span>
          </div>
        </div>
      </div>
    </div>
  );
}