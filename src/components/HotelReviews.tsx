import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { GoogleReview } from '@/types/station';

interface HotelReviewsResponse {
  reviews?: GoogleReview[];
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
}

interface HotelReviewsProps {
  placeId?: string;
  rating?: number | null;
  mapsUrl?: string;
}

const VISIBLE_REVIEW_LIMIT = 3;

const ReviewStars: React.FC<{ value?: number }> = ({ value }) => (
  <span aria-label={`${value ?? 0} out of 5 stars`} className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map(star => (
      <Star
        key={star}
        className={cn(
          'h-3 w-3',
          star <= Math.round(value ?? 0) ? 'fill-current text-amber-500' : 'text-muted-foreground/40',
        )}
      />
    ))}
  </span>
);

/** Real Google Maps reviews for one hotel, cached by the existing reviews API. */
export function HotelReviews({ placeId, rating, mapsUrl }: HotelReviewsProps) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(Boolean(placeId));
  const [reviews, setReviews] = useState<GoogleReview[]>([]);
  const [mapsLink, setMapsLink] = useState(mapsUrl);

  // The rating badge at the top links here. If a visitor collapsed the
  // accordion earlier, following that link should reveal the reviews again.
  useEffect(() => {
    const revealFromHash = () => {
      if (window.location.hash === '#ratings') setOpen(true);
    };
    revealFromHash();
    window.addEventListener('hashchange', revealFromHash);
    return () => window.removeEventListener('hashchange', revealFromHash);
  }, []);

  useEffect(() => {
    if (!placeId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/station-reviews?placeId=${encodeURIComponent(placeId)}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Reviews request ${response.status}`);
        return response.json() as Promise<HotelReviewsResponse>;
      })
      .then(data => {
        setReviews(Array.isArray(data.reviews) ? data.reviews : []);
        if (data.googleMapsUri) setMapsLink(data.googleMapsUri);
      })
      .catch(error => {
        if ((error as Error).name !== 'AbortError') setReviews([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [placeId]);

  const visibleReviews = expanded ? reviews : reviews.slice(0, VISIBLE_REVIEW_LIMIT);
  const totalLabel = typeof rating === 'number' ? `${rating.toFixed(1)} from Google Maps` : 'Google Maps reviews';

  return (
    <Card id="ratings" data-hotel-reviews="true" aria-label="Ratings and reviews" className="scroll-mt-20 rounded-2xl border-border/70">
      <CardContent className="p-4 sm:p-6">
        <button
          type="button"
          data-hotel-reviews-toggle="true"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          aria-controls="hotel-reviews-body"
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-50">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Ratings &amp; reviews</span>
              <span className="block text-xs text-muted-foreground">{totalLabel}</span>
            </span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div id="hotel-reviews-body" className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Ratings and reviews are from Google Maps and may be out of date.
              </p>
              {mapsLink && (
                <a
                  href={mapsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  See all on Google Maps <ExternalLink className="inline h-2.5 w-2.5" />
                </a>
              )}
            </div>

            {loading ? (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Google reviews…
              </p>
            ) : visibleReviews.length ? (
              <ul className="mt-3 space-y-2" data-testid="hotel-google-reviews">
                {visibleReviews.map((review, index) => (
                  <li
                    key={review.googleMapsUri ?? `${review.authorName}-${index}`}
                    data-hotel-review="true"
                    className="rounded-lg border bg-muted/20 p-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-foreground">{review.authorName}</span>
                      <ReviewStars value={review.rating} />
                      {review.relativeTime && (
                        <span className="text-[11px] text-muted-foreground">{review.relativeTime}</span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-3 leading-relaxed text-foreground">
                      {review.text ? `“${review.text}”` : 'No written review was added on Google Maps.'}
                    </p>
                    {review.googleMapsUri && (
                      <a
                        href={review.googleMapsUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
                      >
                        Read on Google Maps
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No Google reviews found for this place.</p>
            )}

            {reviews.length > VISIBLE_REVIEW_LIMIT && (
              <button
                type="button"
                data-hotel-reviews-more="true"
                onClick={() => setExpanded(value => !value)}
                className="mt-2 h-7 px-0 text-xs font-medium text-primary hover:underline"
              >
                {expanded
                  ? 'Show fewer reviews'
                  : `See ${reviews.length - VISIBLE_REVIEW_LIMIT} more reviews`}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default HotelReviews;
