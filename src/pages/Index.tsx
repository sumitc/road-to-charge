import { useEffect } from 'react';
import { EVApp } from '@/components/EVApp';

const SCROLL_KEY = 'ruvo-list-scroll';

const Index = () => {
  useEffect(() => {
    const saved = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0);
    const restore = () => window.scrollTo(0, saved);

    // Restore once immediately and again after the cached list has painted.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      restore();
      timer = setTimeout(restore, 120);
    });

    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    };
  }, []);

  return <EVApp />;
};

export default Index;
