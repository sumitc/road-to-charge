import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  Map,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Phone,
  Smartphone,
  Star,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { BrandTitle } from '@/components/BrandTitle';
import { SiteFooter } from '@/components/SiteFooter';
import { connectorBadgeLabel, connectorSpeed } from '@/lib/connectorLabels';
import { chargingAppUrl, directionsUrl, mapsPlaceUrl } from '@/lib/appLinks';
import { photoSourceLabel, placePhotoUrl } from '@/lib/placePhotos';
import { EVStationService } from '@/services/evStationService';
import { useStationDetail, useStationFeedback, useUserLocation } from '@/hooks/useStationQueries';
import { FavouritesService } from '@/services/favouritesService';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  operational: 'Available',
  maintenance: 'Maintenance',
  'out-of-service': 'Offline',
};

const FEEDBACK_OPTIONS = [
  { kind: 'working', label: 'Working', icon: CheckCircle2, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { kind: 'not_working', label: 'Not working', icon: XCircle, tone: 'border-rose-300 bg-rose-50 text-rose-700' },
  { kind: 'wrong_location', label: 'Wrong location', icon: MapPin, tone: 'border-amber-300 bg-amber-50 text-amber-700' },
  { kind: 'other', label: 'Something else', icon: Info, tone: 'border-slate-300 bg-slate-50 text-slate-700' },
] as const;

function relativeDate(value?: string | null): string {
  if (!value) return 'not reported yet';
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return value;
  }
}

const StationDetail: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  // Both queries are cached, so revisiting a station (or going back to the
  // list) shows instantly instead of re-fetching station + feedback.
  const { data: station, isLoading } = useStationDetail(id);
  const { data: feedback, refetch: refetchFeedback } = useStationFeedback(id);
  const { data: userLocation } = useUserLocation();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<string>('working');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const loadFeedback = async () => {
    await refetchFeedback();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!station) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md rounded-2xl">
          <CardContent className="space-y-4 p-6 text-center">
            <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold">Station not found</h1>
              <p className="text-sm text-muted-foreground">It may have been removed by a catalog refresh.</p>
            </div>
            <Button onClick={() => navigate('/')} className="w-full">Back to Ruvo</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const photos = station.photoRefs ?? [];
  const photoRef = photos[photoIndex];
  const details = station.placeDetails;
  const photoSourceLabelText = photoSourceLabel(details?.photoSource);
  const isFavourite = FavouritesService.isFavourite(station.id);
  const status = (station.status ?? '').toLowerCase();

  const toggleFavourite = () => {
    if (isFavourite) FavouritesService.removeFavourite(station.id);
    else FavouritesService.addFavourite(station);
    toast({ title: isFavourite ? 'Removed from favourites' : 'Saved to favourites' });
  };

  const submitFeedback = async () => {
    setIsSubmittingFeedback(true);
    const ok = await EVStationService.submitFeedback(
      station.id,
      feedbackKind as 'working' | 'not_working' | 'wrong_location' | 'other',
      feedbackNote
    );
    setIsSubmittingFeedback(false);
    if (!ok) {
      toast({ title: 'Could not save feedback', variant: 'destructive' });
      return;
    }
    setFeedbackNote('');
    setFeedbackOpen(false);
    await loadFeedback();
    toast({ title: 'Thanks — feedback recorded' });
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-30 bg-gradient-hero text-primary-foreground shadow-electric">
        <div
          className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-4"
          style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            aria-label="Back"
            className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <BrandTitle subtitle="Station details" />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFavourite}
            aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            className={cn(
              'hover:bg-primary-foreground/20',
              isFavourite ? 'text-amber-300 hover:text-amber-200' : 'text-primary-foreground'
            )}
          >
            <Star className={cn('h-5 w-5', isFavourite && 'fill-current')} />
          </Button>
        </div>
      </header>

      <main
        className="mx-auto max-w-3xl space-y-4 p-4"
        style={{ paddingBottom: 'calc(6rem + var(--ruvo-banner-height, 0px))' }}
      >
        <Card className="overflow-hidden rounded-3xl border-border/70 shadow-sm">
          <div className="relative aspect-[4/3] bg-gradient-to-br from-primary/15 to-emerald-500/15 sm:aspect-[16/9]">
            {photoRef ? (
              <img
                src={placePhotoUrl(photoRef, 800)}
                alt={station.name}
                loading="eager"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-primary/60">
                <Camera className="h-10 w-10" />
                <p className="text-sm font-medium">No photo available yet</p>
                {details?.googleMapsUri && (
                  <a
                    href={details.googleMapsUri}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline"
                  >
                    See photos on Google Maps
                  </a>
                )}
              </div>
            )}
            {photoRef && (
              <span
                className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white"
                title={details?.photoSource?.name ?? 'Photo from Google Maps'}
              >
                {photoSourceLabelText
                  ? `Photo: ${photoSourceLabelText} · ${details?.photoSource?.name}`
                  : 'Photo: Google Maps'}
              </span>
            )}
            {photos.length > 1 && (
              <div className="absolute bottom-2 right-2 flex gap-1.5">
                {photos.slice(0, 5).map((ref, index) => (
                  <button
                    key={ref}
                    type="button"
                    onClick={() => setPhotoIndex(index)}
                    aria-label={`Show photo ${index + 1}`}
                    className={cn(
                      'h-10 w-10 overflow-hidden rounded-lg border-2 transition',
                      index === photoIndex ? 'border-white' : 'border-white/40 opacity-70'
                    )}
                  >
                    <img src={placePhotoUrl(ref, 160)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {details?.photoSource && (
            <p className="border-t bg-muted/40 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {details.photoSource.note} The photo is from{' '}
              <span className="font-medium">{details.photoSource.name}</span>, not a verified image of this charger.
            </p>
          )}

          <CardContent className="space-y-4 p-5">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-xl font-semibold leading-tight">{station.name}</h1>
                {typeof station.distance === 'number' && station.distance > 0 && (
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
                    {station.distance.toFixed(1)} km
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> {station.provider}
                </span>
                <span className="flex items-center gap-1">
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    status === 'operational' ? 'bg-emerald-500' : status === 'maintenance' ? 'bg-amber-500' : 'bg-rose-500'
                  )} />
                  {STATUS_LABEL[status] ?? station.status}
                </span>
                {typeof details?.rating === 'number' && (
                  <span className="flex items-center gap-1 font-medium text-amber-600">
                    <Star className="h-3.5 w-3.5 fill-current" />
                    {details.rating.toFixed(1)}
                    {details.userRatingCount ? ` (${details.userRatingCount})` : ''}
                  </span>
                )}
              </div>
              <p className="flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                {details?.formattedAddress || station.address}
              </p>
            </div>

            {(station.connectorTypes?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {station.connectorTypes?.map((type, index) => {
                  const speed = connectorSpeed(type);
                  return (
                    <span
                      key={`${type}-${index}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary"
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', speed === 'super-fast' ? 'bg-violet-500' : speed === 'fast' ? 'bg-amber-500' : 'bg-emerald-500')} />
                      {connectorBadgeLabel(type)}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 border-t pt-4 sm:grid-cols-3">
              {station.maxPowerKw !== undefined && (
                <Detail icon={Zap} label="Power" value={`${station.maxPowerKw} kW`} />
              )}
              {station.totalConnectors !== undefined && (
                <Detail icon={Zap} label="Connectors" value={`${station.totalConnectors} guns`} />
              )}
              {station.openingHours && (
                <Detail icon={Clock} label="Hours" value={station.openingHours} />
              )}
              {station.paymentModes?.length ? (
                <Detail icon={Wallet} label="Payment" value={station.paymentModes.join(', ')} />
              ) : null}
              {station.contactNumbers?.length ? (
                <Detail icon={Phone} label="Contact" value={station.contactNumbers.join(', ')} />
              ) : null}
              {details?.websiteUri && (
                <a href={details.websiteUri} target="_blank" rel="noreferrer">
                  <Detail icon={ExternalLink} label="Website" value="Open provider site" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 border-t pt-4 sm:grid-cols-4">
              <Button onClick={() => window.open(directionsUrl(station, userLocation), '_blank')}>
                <Navigation className="h-4 w-4" /> Directions
              </Button>
              <Button variant="outline" onClick={() => window.open(mapsPlaceUrl(station), '_blank')}>
                <Map className="h-4 w-4" /> Maps
              </Button>
              <Button variant="outline" onClick={() => window.open(chargingAppUrl(station), '_blank')}>
                <Smartphone className="h-4 w-4" /> Charging app
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href);
                  toast({ title: 'Link copied' });
                }}
              >
                <ExternalLink className="h-4 w-4" /> Share
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70">
          <CardContent className="space-y-4 p-5">
            {/* Stack on mobile: title on one line, subtitle directly below it. */}
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquarePlus className="h-4 w-4 shrink-0 text-primary" /> Visit &amp; community updates
              </h2>
              <span className="text-[11px] text-muted-foreground">Community powered</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="text-lg font-semibold text-emerald-700">{feedback?.working ?? 0}</p>
                <p className="text-[11px] text-emerald-700/80">Working</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3">
                <p className="text-lg font-semibold text-rose-700">{feedback?.notWorking ?? 0}</p>
                <p className="text-[11px] text-rose-700/80">Not working</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3">
                <p className="text-lg font-semibold text-amber-700">{feedback?.wrongLocation ?? 0}</p>
                <p className="text-[11px] text-amber-700/80">Wrong location</p>
              </div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Last confirmed working:</span>{' '}
                {relativeDate(feedback?.lastWorkingAt)}
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">Live in-use status:</span> coming soon from charging networks.
              </p>
              {feedback?.recent?.length ? (
                <ul className="mt-2 space-y-1 border-t pt-2">
                  {feedback.recent.slice(0, 3).map((item, index) => (
                    <li key={index} className="flex items-start gap-1.5">
                      <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        {item.kind.replace(/_/g, ' ')} · {relativeDate(item.createdAt)}
                        {item.note ? ` — “${item.note}”` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70">
          <CardContent className="space-y-2 p-5 text-xs text-muted-foreground">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Info className="h-4 w-4 text-primary" /> Source &amp; accuracy
            </h2>
            <p>Source: {station.sourceName || 'Catalog sync'}</p>
            <p>Coordinates: {station.lat.toFixed(6)}, {station.lng.toFixed(6)}</p>
            {station.locationQuality === 'suspect' && (
              <p className="font-medium text-amber-600">Location flagged — please confirm on Google Maps.</p>
            )}
            {station.photoEnrichedAt && (
              <p>Photos checked {relativeDate(station.photoEnrichedAt)}.</p>
            )}
          </CardContent>
        </Card>
        <SiteFooter />
      </main>

      <Button
        onClick={() => setFeedbackOpen(true)}
        style={{ bottom: 'calc(1rem + var(--ruvo-banner-height, 0px))' }}
        className="fixed right-4 z-40 h-14 rounded-full bg-gradient-to-br from-primary to-emerald-500 px-5 shadow-electric"
      >
        <MessageSquarePlus className="h-5 w-5" />
        Feedback
      </Button>

      <Sheet open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-3xl p-0">
          <SheetHeader className="border-b p-5 text-left">
            <SheetTitle>How is this station?</SheetTitle>
            <SheetDescription>Your report helps other riders on the road.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_OPTIONS.map(option => {
                const Icon = option.icon;
                const selected = feedbackKind === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => setFeedbackKind(option.kind)}
                    className={cn(
                      'flex min-h-[48px] items-center gap-2 rounded-xl border px-3 text-sm font-medium transition',
                      selected ? option.tone : 'border-border bg-background text-muted-foreground hover:bg-accent'
                    )}
                  >
                    <Icon className="h-4 w-4" /> {option.label}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={feedbackNote}
              onChange={event => setFeedbackNote(event.target.value)}
              placeholder="Optional: what did you find?"
              rows={3}
            />
            <Button
              onClick={submitFeedback}
              disabled={isSubmittingFeedback}
              className="h-12 w-full rounded-xl bg-gradient-to-br from-primary to-emerald-500"
            >
              {isSubmittingFeedback ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
              Submit feedback
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

function Detail({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-2.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1 line-clamp-2 text-xs font-medium">{value}</p>
    </div>
  );
}

export default StationDetail;
