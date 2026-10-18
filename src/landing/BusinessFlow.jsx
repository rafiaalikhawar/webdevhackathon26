import React, { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Target, Users, MessageSquare, CreditCard } from 'lucide-react';
import './business-flow.css';

const steps = [
  { title: 'Capture the opportunity.', description: 'Bring every new inquiry into one place.', label: 'INQUIRY', icon: Target },
  { title: 'Give it an owner.', description: 'Assign the right available teammate. Keep follow-ups moving.', label: 'ASSIGNMENT', icon: Users },
  { title: 'Keep the conversation.', description: 'Messages, appointments, and customer history stay connected.', label: 'CONVERSATION', icon: MessageSquare },
  { title: 'Connect the final payment.', description: 'Track collections alongside the relationship that started it all.', label: 'PAYMENT', icon: CreditCard },
];

export default function BusinessFlow() {
  const root = useRef(null);
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const ctx = gsap.context(() => {
        gsap.utils.toArray('.flow-step').forEach((step, index) => {
          ScrollTrigger.create({
            trigger: step, start: 'top 62%', end: 'bottom 62%',
            onEnter: () => setActive(index), onEnterBack: () => setActive(index),
          });
          gsap.from(step.querySelector('.flow-step-copy'), {
            x: -30, opacity: 0, duration: .8, ease: 'power2.out',
            scrollTrigger: { trigger: step, start: 'top 88%', toggleActions: 'play none none reverse' },
          });
        });
        gsap.fromTo('.flow-line-progress', { scaleY: 0 }, { scaleY: 1, ease: 'none',
          scrollTrigger: { trigger: '.flow-steps', start: 'top 62%', end: 'bottom 62%', scrub: .6 },
        });
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return <div className="business-flow" ref={root}>
    <div className="flow-section-top"><span className="mono">01 / THE CONNECTED JOURNEY</span><span className="mono">BUILT AROUND YOUR CUSTOMER</span></div>
    <div className="flow-layout">
      <div className="flow-visual">
        <h3>From first inquiry.<br /><span>To final payment.</span></h3>
        <div className="flow-map" role="img" aria-label="RESX connects inquiries, team assignments, conversations, and payments.">
          <svg viewBox="0 0 520 360" fill="none" aria-hidden="true">
            <path className="map-base" d="M80 74H170Q200 74 200 104V150Q200 180 230 180H290Q320 180 320 150V104Q320 74 350 74H440M80 286H170Q200 286 200 256V210Q200 180 230 180M290 180Q320 180 320 210V256Q320 286 350 286H440" />
            <path className={`map-route ${active === 0 ? 'is-active' : ''}`} d="M80 74H170Q200 74 200 104V150Q200 180 230 180H260" />
            <path className={`map-route ${active === 1 ? 'is-active' : ''}`} d="M260 180H290Q320 180 320 150V104Q320 74 350 74H440" />
            <path className={`map-route ${active === 2 ? 'is-active' : ''}`} d="M80 286H170Q200 286 200 256V210Q200 180 230 180H260" />
            <path className={`map-route ${active === 3 ? 'is-active' : ''}`} d="M260 180H290Q320 180 320 210V256Q320 286 350 286H440" />
          </svg>
          <div className="flow-map-center">RESX<span className="mono">ONE WORKSPACE</span></div>
          {steps.map((step, index) => <div className={`flow-node flow-node-${index} ${active === index ? 'is-active' : ''}`} key={step.label}><step.icon size={21} strokeWidth={1.3}/><span className="mono">{step.label}</span></div>)}
        </div>
        <div className="flow-caption"><span className="flow-signal"/><span className="mono">EVERY HANDOFF. STILL CONNECTED.</span></div>
      </div>
      <div className="flow-steps">
        <div className="flow-line" aria-hidden="true"><div className="flow-line-progress" /></div>
        {steps.map((step, index) => <div className={`flow-step ${active === index ? 'is-active' : ''}`} key={step.label}>
          <span className="flow-step-marker" aria-hidden="true"/><span className="mono flow-step-number">0{index + 1}</span>
          <div className="flow-step-copy"><h4>{step.title}</h4><p>{step.description}</p></div>
        </div>)}
      </div>
    </div>
  </div>;
}
