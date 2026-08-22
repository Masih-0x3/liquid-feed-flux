import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { BrandLogo } from '@/components/layout/BrandLogo';
import { Mail, Lock, Loader2 } from 'lucide-react';

export default function AuthPage() {
  const { signIn, status, authError, refreshSession } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [retryingAuth, setRetryingAuth] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  if (status === 'authorised' || status === 'denied') {
    return <Navigate to="/" replace />;
  }

  if (status === 'booting' || status === 'authenticated-role-loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="glass-panel p-8 rounded-2xl">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        </div>
      </div>
    );
  }

  const handleAuthRetry = async () => {
    setRetryingAuth(true);
    try {
      await refreshSession();
    } finally {
      setRetryingAuth(false);
    }
  };

  if (status === 'degraded') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="glass-card w-full max-w-md border-destructive/40">
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-display">Authentication needs attention</CardTitle>
            <CardDescription>
              {authError?.message ?? 'We could not verify access to the XOT Panel.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={handleAuthRetry} disabled={retryingAuth} className="w-full">
              {retryingAuth ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Retrying authentication…
                </>
              ) : (
                'Retry authentication'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = new FormData(e.currentTarget as HTMLFormElement);
    const email = String(submitted.get('email') ?? formData.email).trim();
    const password = String(submitted.get('password') ?? formData.password);

    if (!email || !password) {
      toast({
        title: "Sign in failed",
        description: "Enter an email and password.",
        variant: "destructive",
      });
      return;
    }

    setFormData({ email, password });
    setLoading(true);
    
    try {
      const { error } = await signIn(email, password);
      
      if (error) {
        toast({
          title: "Sign in failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Welcome back!",
          description: "You've successfully signed in to the XOT Panel.",
        });
      }
    } catch (error) {
      toast({
        title: "An error occurred",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <BrandLogo className="mx-auto h-32 w-32 shadow-2xl shadow-primary/20 ring-1 ring-glass-border sm:h-40 sm:w-40" />
          <h1 className="text-3xl font-display font-bold text-glass-foreground">XOT Panel</h1>
          <p className="text-muted-foreground">Secure access to your RSS → OpenAI → Telegram pipeline</p>
        </div>

        {/* Auth Form */}
        <Card className="glass-card border-glass-border">
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-display">Access Panel</CardTitle>
            <CardDescription>Sign in to view and manage your RSS pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-glass-foreground">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleInputChange}
                    className="glass-input pl-10"
                    placeholder="admin@example.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-glass-foreground">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    value={formData.password}
                    onChange={handleInputChange}
                    className="glass-input pl-10"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-primary hover:opacity-90 text-white font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Secure access powered by Supabase
        </p>
      </div>
    </div>
  );
}
