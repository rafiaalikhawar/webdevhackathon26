import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import './magnetic-button.css';

export default function MagneticButton({ children, className = '', ...props }) {
  const zoneRef = useRef();
  const buttonRef = useRef();
  const labelRef = useRef();

  useEffect(() => {
    const zone = zoneRef.current;
    const button = buttonRef.current;
    const label = labelRef.current;
    const mm = gsap.matchMedia();

    mm.add('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
      function move(event) {
        if (event.pointerType === 'touch') return;
        const bounds = zone.getBoundingClientRect();
        const x = event.clientX - bounds.left - bounds.width / 2;
        const y = event.clientY - bounds.top - bounds.height / 2;
        gsap.to(button, {
          x: gsap.utils.clamp(-24, 24, x * .4),
          y: gsap.utils.clamp(-14, 14, y * .4),
          duration: .4, ease: 'power2.out', overwrite: true,
        });
        gsap.to(label, {
          x: gsap.utils.clamp(-10, 10, x * .24),
          y: gsap.utils.clamp(-5, 5, y * .24),
          duration: .4, ease: 'power2.out', overwrite: true,
        });
      }

      function reset() {
        gsap.to([button, label], {
          x: 0, y: 0, duration: .7,
          ease: 'elastic.out(1, 0.4)', overwrite: true,
        });
      }

      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerleave', reset);
      button.addEventListener('focus', reset);
      return () => {
        zone.removeEventListener('pointermove', move);
        zone.removeEventListener('pointerleave', reset);
        button.removeEventListener('focus', reset);
        gsap.killTweensOf([button, label]);
        gsap.set([button, label], { clearProps: 'transform' });
      };
    });

    return () => mm.revert();
  }, []);

  return <span className="magnetic-zone" ref={zoneRef}>
    <button type="button" {...props} className={`magnetic-button ${className}`} ref={buttonRef}>
      <span className="magnetic-label" ref={labelRef}>{children}</span>
    </button>
  </span>;
}
