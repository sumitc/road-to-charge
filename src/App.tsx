import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AdBanner } from "./components/AdBanner";
import { WebAdBanner } from "./components/WebAdBanner";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Detail and SEO pages are separate route chunks so the list (the default view)
// parses less JS. Hotel data stays out of the entry chunk.
const StationDetail = lazy(() => import("./pages/StationDetail"));
const SeoHubPage = lazy(() => import("./components/SeoHubPage"));
const HotelsPage = lazy(() => import("./pages/HotelsPage"));
const HotelDetailPage = lazy(() => import("./pages/HotelDetailPage"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Analytics />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/station/:id" element={<StationDetail />} />
            <Route path="/ev-charging/:slug" element={<SeoHubPage />} />
            <Route path="/hotels" element={<HotelsPage />} />
            <Route path="/hotels/:id" element={<HotelDetailPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <AdBanner />
        <WebAdBanner />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
