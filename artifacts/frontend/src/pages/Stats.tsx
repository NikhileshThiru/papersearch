import { Database, FileText, Hash, Clock, Server, BarChart } from "lucide-react";
import { motion } from "framer-motion";
import { useGetStats } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function Stats() {
  const { data: stats, isLoading, error } = useGetStats();

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "Never";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "Unknown" : d.toLocaleString();
  };

  const statCards = stats ? [
    {
      title: "Total Documents",
      value: stats.totalDocs.toLocaleString(),
      icon: <FileText className="w-5 h-5 text-blue-500" />,
      description: "Documents indexed in the inverted index",
    },
    {
      title: "Total Terms",
      value: stats.totalTerms.toLocaleString(),
      icon: <Hash className="w-5 h-5 text-emerald-500" />,
      description: "Unique stemmed terms vocabulary size",
    },
    {
      title: "Avg Length (Title)",
      value: stats.avgdlTitle.toFixed(2),
      icon: <BarChart className="w-5 h-5 text-amber-500" />,
      description: "Average terms per title field",
    },
    {
      title: "Avg Length (Abstract)",
      value: stats.avgdlAbstract.toFixed(2),
      icon: <BarChart className="w-5 h-5 text-purple-500" />,
      description: "Average terms per abstract field",
    },
  ] : [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="text-center mb-16 space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <Server className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground tracking-tight">Index Health & Statistics</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Real-time metrics from the PostgreSQL-powered inverted index and BM25 ranking engine.
          </p>
        </div>

        {error && (
          <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-2xl text-center text-destructive mb-8">
            Failed to load statistics from the server.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {isLoading ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="rounded-2xl border-border/50">
                  <CardHeader className="pb-2">
                    <Skeleton className="h-5 w-1/2 mb-2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-10 w-3/4 mb-2" />
                    <Skeleton className="h-3 w-full" />
                  </CardContent>
                </Card>
              ))}
            </>
          ) : stats ? (
            <>
              {statCards.map((stat, idx) => (
                <motion.div
                  key={stat.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <Card className="rounded-2xl border-border/50 hover:shadow-md transition-shadow bg-card h-full">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                        {stat.title}
                      </CardTitle>
                      <div className="p-2 bg-muted/50 rounded-lg">
                        {stat.icon}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-foreground mb-2">{stat.value}</div>
                      <p className="text-xs text-muted-foreground">{stat.description}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </>
          ) : null}
        </div>

        {!isLoading && stats && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            transition={{ delay: 0.5 }}
            className="mt-12 flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/30 py-3 px-6 rounded-full w-fit mx-auto border border-border/40"
          >
            <Clock className="w-4 h-4" />
            <span>Last Indexed: <strong className="text-foreground">{formatDate(stats.lastIndexedAt)}</strong></span>
            <span className="mx-2 opacity-30">|</span>
            <Database className="w-4 h-4" />
            <span>PostgreSQL Backend</span>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
