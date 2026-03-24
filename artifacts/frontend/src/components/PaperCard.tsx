import { Link } from "wouter";
import { Users, Calendar, MapPin, Quote, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PaperResult } from "@workspace/api-client-react";

export function PaperCard({ paper }: { paper: PaperResult }) {
  return (
    <Card className="p-5 md:p-6 group hover:shadow-md transition-all duration-300 border-border/50 hover:border-accent/30 bg-card flex flex-col h-full">
      <div className="flex justify-between items-start gap-4 mb-3">
        <Link href={`/papers/${paper.paperId}`} className="flex-1 block outline-none">
          <h3 className="font-serif text-xl md:text-2xl font-medium leading-tight text-foreground group-hover:text-accent transition-colors decoration-accent/30 underline-offset-4 group-hover:underline">
            {paper.title}
          </h3>
        </Link>
        {paper.score !== undefined && (
          <Badge variant="secondary" className="shrink-0 font-mono text-xs bg-accent/10 text-accent hover:bg-accent/15 border-0">
            Score: {paper.score.toFixed(2)}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-sm text-muted-foreground mb-4">
        {paper.authors && (
          <div className="flex items-center gap-1.5 text-foreground/80 font-medium">
            <Users className="w-4 h-4 opacity-70" />
            <span className="line-clamp-1">{paper.authors}</span>
          </div>
        )}
        
        {paper.year && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 opacity-70" />
            <span>{paper.year}</span>
          </div>
        )}
        
        {paper.venue && (
          <div className="flex items-center gap-1.5 max-w-[200px] sm:max-w-xs">
            <MapPin className="w-4 h-4 opacity-70" />
            <span className="truncate">{paper.venue}</span>
          </div>
        )}

        {paper.citationCount !== null && paper.citationCount !== undefined && (
          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500/90 font-medium">
            <Quote className="w-4 h-4 opacity-80" />
            <span>{paper.citationCount} citations</span>
          </div>
        )}
      </div>

      {paper.fieldOfStudy && (
        <div className="mb-4">
          <Badge variant="outline" className="text-xs font-normal text-muted-foreground border-border/60">
            {paper.fieldOfStudy}
          </Badge>
        </div>
      )}

      {paper.abstract && (
        <div className="mt-auto pt-4 border-t border-border/40">
          <div className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
            <FileText className="w-4 h-4 shrink-0 mt-0.5 opacity-50" />
            <p className="line-clamp-3">
              {paper.abstract.length > 280 ? `${paper.abstract.substring(0, 280)}...` : paper.abstract}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
