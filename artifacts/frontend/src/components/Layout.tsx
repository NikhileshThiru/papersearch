import { Link, useLocation } from "wouter";
import { BookOpen, BarChart2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-lg shadow-sm">
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="font-serif text-xl font-semibold tracking-tight">PaperSearch</span>
          </Link>
          
          <nav className="flex items-center gap-2">
            <Link href="/" className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full transition-colors",
              location === "/" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}>
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Search</span>
            </Link>
            <Link href="/stats" className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full transition-colors",
              location === "/stats" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}>
              <BarChart2 className="w-4 h-4" />
              <span className="hidden sm:inline">Index Stats</span>
            </Link>
          </nav>
        </div>
      </header>
      
      <main className="flex-1 flex flex-col">
        {children}
      </main>

      <footer className="border-t border-border/50 py-8 bg-muted/20">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p className="flex items-center justify-center gap-2">
            <BookOpen className="w-4 h-4" />
            PaperSearch &copy; {new Date().getFullYear()} — Academic Index & Retrieval Engine
          </p>
        </div>
      </footer>
    </div>
  );
}
