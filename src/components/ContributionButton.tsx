import React, { useState } from 'react';
import { Camera, Crosshair, Loader2, Plus, Sparkles, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ConnectorFilter } from './ConnectorFilter';
import {
  connectorRawType,
  inferConnectorTypesFromText,
} from '@/lib/connectorLabels';
import { preparePhoto, type PreparedPhoto } from '@/lib/imageUpload';
import { SiteFooter } from './SiteFooter';
import { useToast } from '@/hooks/use-toast';

interface ContributionButtonProps {
  location: { lat: number; lng: number } | null;
}

export const ContributionButton: React.FC<ContributionButtonProps> = ({ location }) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [stationName, setStationName] = useState('');
  const [provider, setProvider] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState(location?.lat?.toFixed(6) ?? '');
  const [longitude, setLongitude] = useState(location?.lng?.toFixed(6) ?? '');
  const [connectorValues, setConnectorValues] = useState<string[]>([]);
  const [connectorText, setConnectorText] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [notes, setNotes] = useState('');
  const [submitterEmail, setSubmitterEmail] = useState('');
  const [stationPhoto, setStationPhoto] = useState<PreparedPhoto | null>(null);
  const [connectorPhoto, setConnectorPhoto] = useState<PreparedPhoto | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (location && !latitude && !longitude) {
      setLatitude(location.lat.toFixed(6));
      setLongitude(location.lng.toFixed(6));
    }
  }, [location, latitude, longitude]);

  const resetForm = () => {
    setStationName('');
    setProvider('');
    setAddress('');
    setLatitude(location?.lat?.toFixed(6) ?? '');
    setLongitude(location?.lng?.toFixed(6) ?? '');
    setConnectorValues([]);
    setConnectorText('');
    setOcrText('');
    setNotes('');
    setSubmitterEmail('');
    setStationPhoto(null);
    setConnectorPhoto(null);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: 'Location unavailable',
        description: 'Your browser does not support location detection.',
        variant: 'destructive',
      });
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setIsLocating(false);
        toast({ title: 'Location captured', description: 'You can adjust it before submitting.' });
      },
      () => {
        setIsLocating(false);
        toast({
          title: 'Could not get location',
          description: 'Enter the latitude and longitude manually.',
          variant: 'destructive',
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleStationPhoto = async (file?: File) => {
    if (!file) return;
    try {
      setStationPhoto(await preparePhoto(file));
    } catch (error) {
      toast({
        title: 'Photo could not be added',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleConnectorPhoto = async (file?: File) => {
    if (!file) return;
    setIsReading(true);
    try {
      const prepared = await preparePhoto(file, 1200);
      setConnectorPhoto(prepared);

      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const result = await worker.recognize(prepared.dataUrl);
      await worker.terminate();

      const text = String(result.data.text ?? '').trim();
      setOcrText(text);
      const detected = inferConnectorTypesFromText(text);
      if (detected.length > 0) {
        setConnectorValues(current => Array.from(new Set([...current, ...detected])));
      }
      toast({
        title: detected.length > 0 ? 'Connector detected' : 'Photo read',
        description: detected.length > 0
          ? `Found: ${detected.map(connectorRawType).join(', ')}. Please confirm.`
          : text.slice(0, 140) || 'No known connector text found. You can enter it manually.',
      });
    } catch (error) {
      toast({
        title: 'Could not read connector photo',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsReading(false);
    }
  };

  const handleSubmit = async () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!stationName.trim()) {
      toast({ title: 'Station name required', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast({ title: 'Valid location required', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationName: stationName.trim(),
          provider: provider.trim(),
          address: address.trim(),
          latitude: lat,
          longitude: lng,
          connectorTypes: connectorValues.map(connectorRawType),
          connectorText: connectorText.trim(),
          ocrText,
          notes: notes.trim(),
          submitterEmail: submitterEmail.trim(),
          photos: [stationPhoto, connectorPhoto].filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Submission failed');
      }
      toast({
        title: 'Thanks — submitted for review',
        description: 'We check Google Maps/OpenStreetMap and email Sumit for approval before publishing.',
      });
      resetForm();
      setOpen(false);
    } catch (error) {
      toast({
        title: 'Submission failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          aria-label="Add a charging station"
          style={{ bottom: 'calc(1rem + var(--ampo-banner-height, 0px))' }}
          className="fixed right-4 z-40 h-14 w-14 rounded-full bg-gradient-to-br from-primary to-emerald-500 text-primary-foreground shadow-electric transition-transform hover:scale-105"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5 pr-12 text-left">
          <SheetTitle>Add a charging station</SheetTitle>
          <SheetDescription>
            Share a new location. We verify it on the map, then publish it after review.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 p-5">
          <div className="space-y-2">
            <Label htmlFor="submission-name">Station name *</Label>
            <Input
              id="submission-name"
              value={stationName}
              onChange={event => setStationName(event.target.value)}
              placeholder="e.g. Koramangala Fast Charging"
              className="min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="submission-provider">Provider / network</Label>
              <Input
                id="submission-provider"
                value={provider}
                onChange={event => setProvider(event.target.value)}
                placeholder="e.g. Tata Power"
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="submission-email">Your email (optional)</Label>
              <Input
                id="submission-email"
                type="email"
                value={submitterEmail}
                onChange={event => setSubmitterEmail(event.target.value)}
                placeholder="you@example.com"
                className="min-h-[44px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="submission-address">Address or landmark</Label>
            <Textarea
              id="submission-address"
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder="Street, landmark, city"
              rows={2}
            />
          </div>

          <div className="space-y-2 rounded-2xl border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label>Location *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={useCurrentLocation}
                disabled={isLocating}
                className="h-9"
              >
                {isLocating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                Use my location
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label="Latitude"
                inputMode="decimal"
                value={latitude}
                onChange={event => setLatitude(event.target.value)}
                placeholder="Latitude"
                className="min-h-[44px]"
              />
              <Input
                aria-label="Longitude"
                inputMode="decimal"
                value={longitude}
                onChange={event => setLongitude(event.target.value)}
                placeholder="Longitude"
                className="min-h-[44px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Connector type</Label>
            <ConnectorFilter selected={connectorValues} onChange={setConnectorValues} className="w-full" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="submission-connector-text">Connector details</Label>
            <Input
              id="submission-connector-text"
              value={connectorText}
              onChange={event => setConnectorText(event.target.value)}
              placeholder="e.g. CCS, CHAdeMO, Type 2"
              className="min-h-[44px]"
            />
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:bg-accent">
              {isReading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {isReading ? 'Reading connector photo…' : 'Take or upload a connector photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={event => handleConnectorPhoto(event.target.files?.[0])}
              />
            </label>
            {connectorPhoto && (
              <p className="flex items-center gap-1 text-xs text-emerald-600">
                <Sparkles className="h-3.5 w-3.5" /> Connector photo attached
              </p>
            )}
            {ocrText && (
              <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
                <span className="font-medium">Read from photo:</span> {ocrText.slice(0, 300)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Station photo (optional)</Label>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:bg-accent">
              <UploadCloud className="h-4 w-4" />
              {stationPhoto ? stationPhoto.name : 'Take or upload a station photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={event => handleStationPhoto(event.target.files?.[0])}
              />
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="submission-notes">Anything else?</Label>
            <Textarea
              id="submission-notes"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Access notes, timings, payment info…"
              rows={2}
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="h-12 w-full rounded-xl bg-gradient-to-br from-primary to-emerald-500"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {isSubmitting ? 'Submitting…' : 'Submit for review'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Photos are deleted after review. Submissions are not published until approved.
          </p>
          <SiteFooter />
        </div>
      </SheetContent>
    </Sheet>
  );
};
