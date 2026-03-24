import { useParams, Link } from "wouter";
import { ArrowLeft, ExternalLink, Calendar, Users, MapPin, Quote, FileText, Share2, BookmarkPlus } from "lucide-react";
import { motion } from "framer-motion";
import { useGetPaper, useGetSimilarPapers, getGetPaperQueryKey, getGetSimilarPapersQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PaperCard } from "@/components/PaperCard";
import { Separator } from "@/components/ui/separator";

export function PaperDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data: paper, isLoading, error } = useGetPaper(id, {
    query: { queryKey: getGetPaperQueryKey(id), enabled: !!id },
  });

  const { data: similarData, isLoading: isLoadingSimilar } = useGetSimilarPapers(
    id,
    { limit: 4 },
    { query: { queryKey: getGetSimilarPapersQueryKey(id, { limit: 4 }), enabled: !!id } }
  );

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center">
          <h2 className="text-2xl font-serif font-bold text-destructive mb-4">Paper Not Found</h2>
          <p className="text-muted-foreground mb-8">The paper you requested does not exist or has been removed from the index.</p>
          <Link href="/">
            <Button><ArrowLeft className="w-4 h-4 mr-2" /> Return to Search</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group">
            <ArrowLeft className="w-4 h-4 mr-1.5 group-hover:-translate-x-1 transition-transform" />
            Back to search
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <div className="flex gap-4">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
            <div className="mt-12 space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ) : paper ? (
          <motion.article 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card rounded-3xl p-6 md:p-10 lg:p-12 shadow-sm border border-border/50"
          >
            {/* Header / Meta */}
            <header className="mb-10">
              <div className="flex flex-wrap gap-2 mb-4">
                {paper.fieldOfStudy && (
                  <Badge variant="secondary" className="bg-primary/5 text-primary hover:bg-primary/10 border-0 text-sm py-1 px-3">
                    {paper.fieldOfStudy}
                  </Badge>
                )}
                {paper.year && (
                  <Badge variant="outline" className="text-sm py-1 px-3 border-border/60">
                    <Calendar className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                    {paper.year}
                  </Badge>
                )}
              </div>

              <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif font-bold text-foreground leading-[1.15] tracking-tight mb-6">
                {paper.title}
              </h1>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-8 border-b border-border/40">
                <div className="space-y-3 flex-1">
                  <div className="flex items-start gap-2.5 text-lg text-foreground/80">
                    <Users className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium leading-relaxed">{paper.authors}</span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
                    {paper.venue && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 opacity-70" />
                        <span>{paper.venue}</span>
                      </div>
                    )}
                    {paper.citationCount !== null && (
                      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500 font-medium">
                        <Quote className="w-4 h-4 opacity-80" />
                        <span>{paper.citationCount} Citations</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-row sm:flex-col gap-3 shrink-0">
                  {paper.url ? (
                    <Button asChild size="lg" className="rounded-xl shadow-sm hover:shadow">
                      <a href={paper.url} target="_blank" rel="noopener noreferrer" className="flex items-center">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Source Link
                      </a>
                    </Button>
                  ) : (
                    <Button disabled size="lg" className="rounded-xl">
                      No Link Available
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon" className="rounded-xl" title="Save paper">
                      <BookmarkPlus className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="outline" size="icon" className="rounded-xl" title="Share paper">
                      <Share2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
            </header>

            {/* Abstract */}
            <section className="mb-12">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-foreground">
                <FileText className="w-5 h-5 text-accent" />
                Abstract
              </h2>
              {paper.abstract ? (
                <p className="text-lg text-muted-foreground leading-relaxed md:leading-loose">
                  {paper.abstract}
                </p>
              ) : (
                <p className="text-muted-foreground italic bg-muted/30 p-4 rounded-xl">No abstract available for this paper.</p>
              )}
            </section>
            
            {/* Meta IDs */}
            {paper.externalIds && Object.keys(paper.externalIds).length > 0 && (
              <section className="bg-muted/30 p-6 rounded-2xl border border-border/40">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">External Identifiers</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(paper.externalIds).map(([key, value]) => (
                    <Badge key={key} variant="secondary" className="font-mono text-xs bg-background">
                      {key}: {String(value)}
                    </Badge>
                  ))}
                </div>
              </section>
            )}
          </motion.article>
        ) : null}

        {/* Similar Papers */}
        {paper && (
          <section className="mt-16 mb-20">
            <div className="flex items-center gap-4 mb-8">
              <h2 className="text-2xl font-serif font-bold text-foreground">Similar Papers</h2>
              <Separator className="flex-1" />
            </div>
            
            {isLoadingSimilar ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
              </div>
            ) : similarData?.papers && similarData.papers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {similarData.papers.map((p, idx) => (
                  <motion.div 
                    key={p.paperId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 + 0.3 }}
                    className="h-full"
                  >
                    <PaperCard paper={p} />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center p-8 bg-muted/20 rounded-2xl border border-dashed border-border/50">
                <p className="text-muted-foreground">No semantically similar papers found in the index.</p>
              </div>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
