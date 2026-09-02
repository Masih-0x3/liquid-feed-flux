import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section aria-labelledby="not-found-title" className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-lg">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 id="not-found-title" className="mt-2 text-3xl font-bold">
          Oops! Page not found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The page you requested does not exist or may have moved.
        </p>
        <Button asChild variant="outline" className="mt-6 border-primary/60 text-primary hover:border-primary hover:bg-background hover:text-primary">
          <Link to="/">Return to Home</Link>
        </Button>
      </section>
    </main>
  );
};

export default NotFound;
