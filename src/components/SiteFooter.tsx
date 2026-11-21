import React, { useState } from 'react';
import { Github, Loader2, MessageSquarePlus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

/** Compact, shared footer for every Ampo screen and sheet. */
export const SiteFooter: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  const submitFeedback = async () => {
    if (message.trim().length < 3) {
      toast({ title: 'Please write a short note first', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const response = await fetch('/api/app-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, email, website, page: window.location.pathname }),
      });
      if (!response.ok) throw new Error('Feedback request failed');
      setMessage('');
      setEmail('');
      setWebsite('');
      setOpen(false);
      toast({ title: 'Thanks — feedback sent' });
    } catch {
      toast({
        title: 'Could not send feedback',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <footer className="mt-6 border-t border-border/70 px-4 py-4 text-center text-[11px] leading-relaxed text-muted-foreground">
      <p>© 2026 Fibuladreams Pvt Ltd. All rights reserved.</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Help us Improve!
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Send feedback</DialogTitle>
              <DialogDescription>
                No login needed — your note is emailed straight to the Ampo team.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Textarea
                aria-label="Your feedback"
                value={message}
                onChange={event => setMessage(event.target.value)}
                placeholder="Tell us what worked or what didn't…"
                rows={5}
                maxLength={4000}
              />
              <Input
                aria-label="Your email (optional)"
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="Your email (optional)"
                maxLength={200}
              />
              <div className="absolute -left-[9999px]" aria-hidden="true">
                <label htmlFor="ampo-feedback-website">Leave this blank</label>
                <input
                  id="ampo-feedback-website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={event => setWebsite(event.target.value)}
                />
              </div>
              <Button onClick={submitFeedback} disabled={sending} className="h-11 w-full">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? 'Sending…' : 'Send feedback'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <a
          href="https://github.com/sumitc/road-to-charge"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <Github className="h-3.5 w-3.5" />
          Star on GitHub
        </a>
      </div>
    </footer>
  );
};
