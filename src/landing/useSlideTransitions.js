import { useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './slide-transitions.css';

gsap.registerPlugin(ScrollTrigger);

export default function useSlideTransitions(root) {
  useLayoutEffect(() => {
    const mm = gsap.matchMedia();
    let disposed = false;

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const panels = [...root.current.querySelectorAll('main > section[data-slide-exit]')];
      const originalInert = panels.map(panel => panel.inert);

      const ctx = gsap.context(() => {
        // Only marked slides shrink. The long overview and contact section
        // retain their normal scrolling when new content is appended.
        panels.forEach((panel, index) => {
          const timeline = gsap.timeline({
            scrollTrigger: {
              id: `resx-slide-${index}`,
              trigger: panel,
              start: 'bottom bottom',
              end: () => `+=${window.innerHeight}`,
              pin: true,
              pinSpacing: false,
              scrub: true,
              anticipatePin: 1,
              invalidateOnRefresh: true,
              refreshPriority: 10,
              onUpdate: self => { panel.inert = self.progress >= .99; },
            },
          });
          timeline.fromTo(panel,
            { scale: 1, opacity: 1, transformOrigin: '50% 50%' },
            { scale: .7, opacity: .5, duration: .9, ease: 'none' },
          ).to(panel, { opacity: 0, duration: .1, ease: 'none' });
        });
      }, root);

      // Fixed pins have viewport coordinates: make home/back-to-top links
      // target the actual start rather than the pin's current on-screen rect.
      function navigateHome(event) {
        const link = event.target.closest?.('a[href="#product"]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        history.replaceState(null, '', `${location.pathname}${location.search}#product`);
      }
      root.current.addEventListener('click', navigateHome);

      return () => {
        root.current?.removeEventListener('click', navigateHome);
        ctx.revert();
        panels.forEach((panel, index) => { panel.inert = originalInert[index]; });
      };
    });

    // Refresh after fonts settle without leaving a delayed refresh on unmount.
    document.fonts.ready.then(() => { if (!disposed) ScrollTrigger.refresh(); });
    return () => { disposed = true; mm.revert(); };
  }, [root]);
}
