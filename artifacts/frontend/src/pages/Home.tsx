import { useState, useEffect, useRef } from "react";
import { Search, SlidersHorizontal, AlertCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useSearchPapers,
  useSuggestTerms,
  getSearchPapersQueryKey,
  getSuggestTermsQueryKey,
  type SearchPapersParams,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PaperCard } from "@/components/PaperCard";
import { Layout } from "@/components/Layout";
import { useIsMobile } from "@/hooks/use-mobile";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1950;

const FIELDS_OF_STUDY = [
  "Computer Science",
  "Mathematics",
  "Physics",
  "Biology",
  "Medicine",
  "Chemistry",
  "Engineering",
  "Psychology",
  "Economics",
  "Linguistics",
  "Sociology",
  "Political Science",
  "Environmental Science",
  "Materials Science",
  "Geography",
  "Art",
  "History",
  "Philosophy",
];

interface Filters {
  yearRange: [number, number];
  fieldsOfStudy: string[];
  minCitations: number;
}

const DEFAULT_FILTERS: Filters = {
  yearRange: [MIN_YEAR, CURRENT_YEAR],
  fieldsOfStudy: [],
  minCitations: 0,
};

function filtersToParams(q: string, filters: Filters, page: number): SearchPapersParams {
  const params: SearchPapersParams = { q, page, pageSize: 10 };
  if (filters.yearRange[0] !== MIN_YEAR) params.yearFrom = filters.yearRange[0];
  if (filters.yearRange[1] !== CURRENT_YEAR) params.yearTo = filters.yearRange[1];
  if (filters.fieldsOfStudy.length > 0) {
    params.fieldOfStudy = filters.fieldsOfStudy.join(",");
  }
  if (filters.minCitations > 0) params.minCitations = filters.minCitations;
  return params;
}

function toggleField(current: string[], field: string): string[] {
  return current.includes(field)
    ? current.filter((f) => f !== field)
    : [...current, field];
}

export function Home() {
  const [searchInput, setSearchInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobile = useIsMobile();

  const searchEnabled = !!submittedQuery;
  const searchParams: SearchPapersParams = submittedQuery
    ? filtersToParams(submittedQuery, filters, page)
    : { q: "__disabled__" };

  const { data: searchResults, isLoading: isSearching, error } = useSearchPapers(
    searchParams,
    {
      query: {
        queryKey: getSearchPapersQueryKey(searchParams),
        enabled: searchEnabled,
      },
    }
  );

  const suggestEnabled = searchInput.length > 2 && !submittedQuery;
  const { data: suggestions } = useSuggestTerms(
    { q: searchInput },
    {
      query: {
        queryKey: getSuggestTermsQueryKey({ q: searchInput }),
        enabled: suggestEnabled,
      },
    }
  );

  useEffect(() => {
    if (!submittedQuery) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setSubmittedQuery(q);
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const applySuggestion = (term: string) => {
    setSearchInput(term);
    setSubmittedQuery(term);
    setPage(1);
  };

  const totalPages = Math.ceil((searchResults?.total ?? 0) / (searchResults?.pageSize ?? 10));

  const hasActiveFilters =
    filters.yearRange[0] !== MIN_YEAR ||
    filters.yearRange[1] !== CURRENT_YEAR ||
    filters.fieldsOfStudy.length > 0 ||
    filters.minCitations > 0;

  return (
    <Layout>
      <div className="flex-1 flex flex-col w-full">
        {/* Hero State */}
        {!submittedQuery && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col items-center justify-center p-6 min-h-[70vh] relative overflow-hidden"
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
            <div className="text-center max-w-3xl w-full mx-auto space-y-8">
              <div className="space-y-4">
                <h1 className="text-5xl md:text-7xl font-serif font-semibold tracking-tight text-foreground">
                  Academic Search<br className="hidden md:block" />
                  <span className="text-accent italic">Reimagined.</span>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                  Discover academic papers with advanced BM25 retrieval, typo correction, and semantic similarity.
                </p>
              </div>

              <form onSubmit={handleSearchSubmit} className="relative w-full max-w-2xl mx-auto group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-accent transition-colors">
                  <Search className="w-6 h-6" />
                </div>
                <Input
                  type="text"
                  placeholder="Search for papers, authors, or topics..."
                  className="w-full pl-12 pr-32 py-8 text-lg md:text-xl rounded-2xl bg-card border-2 border-border/50 shadow-lg shadow-black/5 focus-visible:ring-4 focus-visible:ring-accent/10 focus-visible:border-accent transition-all placeholder:text-muted-foreground/60"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <div className="absolute inset-y-0 right-2 flex items-center">
                  <Button type="submit" size="lg" className="rounded-xl px-8 h-12 font-medium bg-primary hover:bg-primary/90 shadow-md">
                    Search
                  </Button>
                </div>
              </form>

              {suggestEnabled && suggestions?.suggestions && suggestions.suggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 flex flex-wrap justify-center gap-2"
                >
                  <span className="text-sm text-muted-foreground py-1">Suggestions:</span>
                  {suggestions.suggestions.slice(0, 5).map((s) => (
                    <button
                      key={s}
                      onClick={() => applySuggestion(s)}
                      className="text-sm px-3 py-1 bg-secondary/50 hover:bg-secondary rounded-full text-secondary-foreground transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {/* Results State */}
        {submittedQuery && (
          <div className="container mx-auto px-4 py-8 w-full max-w-7xl">
            {/* Compact Search Bar */}
            <div className="mb-8 flex flex-col md:flex-row gap-4 items-center justify-between">
              <form onSubmit={handleSearchSubmit} className="relative flex-1 w-full max-w-3xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="text"
                  className="w-full pl-10 pr-24 h-12 bg-card border-border/60 text-base rounded-xl focus-visible:ring-accent/20"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <Button
                  type="submit"
                  className="absolute right-1 top-1 bottom-1 h-auto px-4 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
                >
                  Update
                </Button>
              </form>
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
                className="w-full md:w-auto h-12 rounded-xl gap-2 md:hidden"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters {hasActiveFilters && <span className="ml-1 w-2 h-2 rounded-full bg-accent inline-block" />}
              </Button>
            </div>

            <div className="flex flex-col md:flex-row gap-8 items-start relative">
              {/* Filter Sidebar */}
              <AnimatePresence>
                {(showFilters || !isMobile) && (
                  <motion.aside
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="w-full md:w-72 shrink-0 md:sticky md:top-24 space-y-6 bg-card border border-border/50 p-6 rounded-2xl shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4" />
                        Refine Results
                      </h3>
                      {hasActiveFilters && (
                        <button
                          onClick={handleClearFilters}
                          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        >
                          Clear all
                        </button>
                      )}
                    </div>

                    <div className="space-y-6">
                      {/* Year Range Slider */}
                      <div className="space-y-4">
                        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Publication Year
                        </Label>
                        <Slider
                          min={MIN_YEAR}
                          max={CURRENT_YEAR}
                          step={1}
                          value={filters.yearRange}
                          onValueChange={(value) =>
                            setFilters((f) => ({ ...f, yearRange: value as [number, number] }))
                          }
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground font-mono">
                          <span>{filters.yearRange[0]}</span>
                          <span>{filters.yearRange[1]}</span>
                        </div>
                      </div>

                      {/* Field of Study Multi-select (checkboxes) */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Field of Study
                          </Label>
                          {filters.fieldsOfStudy.length > 0 && (
                            <button
                              onClick={() => setFilters((f) => ({ ...f, fieldsOfStudy: [] }))}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {filters.fieldsOfStudy.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {filters.fieldsOfStudy.map((f) => (
                              <Badge
                                key={f}
                                variant="secondary"
                                className="text-xs cursor-pointer"
                                onClick={() =>
                                  setFilters((prev) => ({
                                    ...prev,
                                    fieldsOfStudy: toggleField(prev.fieldsOfStudy, f),
                                  }))
                                }
                              >
                                {f} <X className="w-2.5 h-2.5 ml-1" />
                              </Badge>
                            ))}
                          </div>
                        )}
                        <ScrollArea className="h-40 rounded-lg border border-border/50 bg-background p-2">
                          <div className="space-y-2">
                            {FIELDS_OF_STUDY.map((field) => (
                              <div key={field} className="flex items-center gap-2">
                                <Checkbox
                                  id={`field-${field}`}
                                  checked={filters.fieldsOfStudy.includes(field)}
                                  onCheckedChange={() =>
                                    setFilters((prev) => ({
                                      ...prev,
                                      fieldsOfStudy: toggleField(prev.fieldsOfStudy, field),
                                    }))
                                  }
                                />
                                <label
                                  htmlFor={`field-${field}`}
                                  className="text-sm text-foreground cursor-pointer leading-none"
                                >
                                  {field}
                                </label>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>

                      {/* Minimum Citations */}
                      <div className="space-y-3">
                        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Minimum Citations
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          className="bg-background"
                          value={filters.minCitations === 0 ? "" : String(filters.minCitations)}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              minCitations: e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0,
                            }))
                          }
                        />
                      </div>
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>

              {/* Results Area */}
              <div className="flex-1 w-full min-w-0">
                {/* Meta Bar */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-border/40">
                  {isSearching ? (
                    <Skeleton className="h-6 w-48" />
                  ) : searchResults ? (
                    <div className="text-sm text-muted-foreground">
                      Found{" "}
                      <span className="font-medium text-foreground">
                        {searchResults.total.toLocaleString()}
                      </span>{" "}
                      results in{" "}
                      <span className="font-mono text-xs">{searchResults.latencyMs}ms</span>
                    </div>
                  ) : null}
                </div>

                {/* Did you mean banner */}
                {searchResults?.suggestion && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 p-4 rounded-xl bg-accent/5 border border-accent/20 flex items-start gap-3"
                  >
                    <AlertCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-accent-foreground">Did you mean:</h4>
                      <button
                        onClick={() => applySuggestion(searchResults.suggestion!)}
                        className="text-base font-semibold text-accent hover:underline underline-offset-4 mt-1"
                      >
                        {searchResults.suggestion}
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Error State */}
                {error && (
                  <div className="p-8 text-center border-2 border-destructive/20 bg-destructive/5 rounded-2xl">
                    <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-destructive-foreground">Search Failed</h3>
                    <p className="text-muted-foreground mt-2">There was an error connecting to the search index.</p>
                  </div>
                )}

                {/* Loading Skeletons */}
                {isSearching && (
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map((i) => (
                      <Card key={i} className="p-6 space-y-4">
                        <Skeleton className="h-8 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-20 w-full" />
                      </Card>
                    ))}
                  </div>
                )}

                {/* Results List */}
                {!isSearching && searchResults && (
                  <>
                    {searchResults.results.length === 0 ? (
                      <div className="py-20 text-center flex flex-col items-center">
                        <div className="bg-muted w-20 h-20 rounded-full flex items-center justify-center mb-6">
                          <Search className="w-10 h-10 text-muted-foreground/50" />
                        </div>
                        <h3 className="text-2xl font-serif font-medium text-foreground mb-2">No papers found</h3>
                        <p className="text-muted-foreground max-w-md">
                          No papers match your search. Try adjusting your keywords or clearing filters.
                        </p>
                        {hasActiveFilters && (
                          <Button variant="outline" onClick={handleClearFilters} className="mt-6">
                            Clear all filters
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <AnimatePresence mode="popLayout">
                          {searchResults.results.map((paper, idx) => (
                            <motion.div
                              key={paper.paperId}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.05 }}
                            >
                              <PaperCard paper={paper} />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="mt-12 flex items-center justify-center gap-2">
                        <Button
                          variant="outline"
                          disabled={page === 1}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          Previous
                        </Button>
                        <div className="text-sm font-medium px-4 text-muted-foreground">
                          Page {page} of {totalPages}
                        </div>
                        <Button
                          variant="outline"
                          disabled={page === totalPages}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
