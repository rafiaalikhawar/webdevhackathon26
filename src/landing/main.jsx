import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight, Plus, X, Menu, Users, MessageSquare, CreditCard, CalendarDays, Workflow, ChartNoAxesCombined, Target, Bell, Layers, ShieldCheck } from 'lucide-react';
import HeroBackground from './HeroBackground';
import MagneticButton from './MagneticButton';
import Intro from './Intro';
import useSlideTransitions from './useSlideTransitions';
import Contact from './Contact.jsx';
import BusinessFlow from './BusinessFlow.jsx';
import DashboardPreview from './DashboardPreview.jsx';
import './styles.css';
import './opening.css';
import './landing-refinements.css';
import './services-layout.css';
import './service-list.css';
import './responsive.css';

gsap.registerPlugin(ScrollTrigger);
gsap.ticker.lagSmoothing(0);

const navigation = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Integrations', href: '#integrations' },
  { label: 'Contact', href: '#contact' },
];

const services = [
  { icon: Users, title: 'Customer Relationship Management', description: 'Contacts, companies, opportunities, and every customer interaction. Together.' },
  { icon: Target, title: 'Smart Lead Management', description: 'Assign leads to available teammates. Track responses and escalate misses.' },
  { icon: Layers, title: 'Customizable Sales Pipelines', description: 'Your stages. Your fields. A sales process that fits.' },
  { icon: MessageSquare, title: 'Unified Communications', description: 'WhatsApp and SMS conversations, with the full customer history.' },
  { icon: CreditCard, title: 'Payments & Revenue Tracking', description: 'Stripe payment links and collections, connected to customer records.' },
  { icon: CalendarDays, title: 'Appointments & Scheduling', description: 'Google Calendar, team availability, and easy appointment rescheduling.' },
  { icon: Workflow, title: 'Team & Employee Management', description: 'Clear roles, permissions, availability, and ownership of every lead.' },
  { icon: ChartNoAxesCombined, title: 'Business Analytics & Reporting', description: 'Leads, revenue, response times, and escalations. A clearer picture.' },
  { icon: Bell, title: 'Automated Notifications & Recovery', description: 'Assignment alerts, missed acknowledgements, and leads that need attention.' },
  { icon: ShieldCheck, title: 'Security & Accountability', description: 'Isolated workspaces, role-based access, secure integrations, and audit histories.' },
];

function Mono({ children, className = '' }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

function Brand() {
  return <a className="brand" href="#product" aria-label="RESX home">RESX</a>;
}

function Header({ onAction }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButton = useRef();
  const panel = useRef();

  useEffect(() => {
    const scroll = () => setScrolled(window.scrollY > 30);
    scroll();
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current.querySelector('a')?.focus();
    const handler = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        menuButton.current.focus();
      }
      if (event.key === 'Tab') {
        const links = panel.current.querySelectorAll('a,button');
        const first = links[0], last = links[links.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return <header className={`header ${scrolled ? 'scrolled' : ''}`}>
    <Brand />
    <nav className="desktop-nav" aria-label="Main navigation">
      {navigation.map(item => <a href={item.href} key={item.label}>{item.label}<Plus size={13} /></a>)}
    </nav>
    <div className="header-actions">
      <button className="header-sign-in" onClick={() => onAction('signin')}>Sign In</button>
      <MagneticButton className="nav-cta" onClick={() => onAction('signup')}>Get Started</MagneticButton>
      <button ref={menuButton} className="menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
    </div>
    {open && <nav id="mobile-navigation" className="mobile-nav" ref={panel} aria-label="Mobile navigation">
      {navigation.map(item => <a href={item.href} key={item.label} onClick={() => setOpen(false)}>{item.label}<ArrowUpRight size={17} /></a>)}
      <button onClick={() => { setOpen(false); onAction('signin'); }}>Sign In <ArrowUpRight size={17} /></button>
    </nav>}
  </header>;
}

function Hero({ ready, onAction }) {
  return <section className="hero" id="product" data-slide-exit aria-labelledby="hero-heading">
    <HeroBackground active={ready} />
    <div className="hero-grid" aria-hidden="true" />
    <div className={`hero-content ${ready ? 'is-ready' : ''}`}>
      <h1 id="hero-heading"><span>Every Lead Accounted For.</span><span className="hero-line">Every Customer <span className="motion-word">Connected.<svg viewBox="0 0 420 20" preserveAspectRatio="none" aria-hidden="true"><path d="M2 15 Q200 -8 418 9" /></svg></span></span></h1>
      <div className="hero-buttons">
        <MagneticButton className="button button-white" onClick={() => onAction('signup')}>Get Started</MagneticButton>
        <MagneticButton className="button button-white" onClick={() => onAction('signup')}>Sign Up</MagneticButton>
      </div>
    </div>
  </section>;
}

function Services() {
  const section = useRef(null);
  useLayoutEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const ctx = gsap.context(() => {
        gsap.from('.services-heading-copy h2', { y: 50, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: '.services-heading-copy', start: 'top 85%', toggleActions: 'play none none reverse' } });
        gsap.from('.services-heading-copy p', { y: 20, opacity: 0, duration: .8, delay: .2, scrollTrigger: { trigger: '.services-heading-copy', start: 'top 85%', toggleActions: 'play none none reverse' } });
        gsap.utils.toArray('.plain-service-row').forEach(row => {
          gsap.from(row, { x: -24, opacity: 0, duration: .7, ease: 'power2.out', scrollTrigger: { trigger: row, start: 'top 94%', toggleActions: 'play none none reverse' } });
        });
      }, section);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);
  return <section ref={section} id="features" className="services services-story" aria-labelledby="services-heading">
    <div className="services-heading-area">
      <div className="services-heading-copy">
        <div className="services-eyebrow mono"><span />YOUR BUSINESS. IN SYNC.</div>
        <h2 id="services-heading">One Platform.<span>Every Part of Your Business.</span></h2>
        <p>Your customers, team, and daily work. All connected.</p>
      </div>
      <div className="services-heading-bottom mono"><span>CUSTOMERS / TEAM / OPERATIONS</span><a href="#business-toolkit">EXPLORE RESX <ArrowUpRight size={13} /></a></div>
    </div>
    <BusinessFlow />
    <DashboardPreview />
    <div className="service-list-shell">
      <div className="toolkit-heading" id="business-toolkit"><span className="mono">02 / THE RESX TOOLKIT</span><p>Everything you need.<span>Working together.</span></p><span className="mono">10 CONNECTED CAPABILITIES</span></div>
      <ul id="solutions" className="plain-service-list">
        {services.map((service, index) => <li className="plain-service-row" key={service.title} id={service.icon === MessageSquare ? 'integrations' : undefined} tabIndex={0}>
          <Mono className="plain-service-number">{String(index + 1).padStart(2, '0')}</Mono>
          <service.icon className="plain-service-icon" size={23} strokeWidth={1.4} aria-hidden="true" />
          <div className="plain-service-copy"><h3>{service.title}</h3><p>{service.description}</p></div>
        </li>)}
      </ul>
    </div>
  </section>;
}

function App() {
  const root = useRef();
  useSlideTransitions(root);
  const noticeTimer = useRef();
  const [notice, setNotice] = useState('');
  const [intro, setIntro] = useState(() => {
    try { return (new URLSearchParams(location.search).get('intro') === '1' || !sessionStorage.getItem('resx-intro-seen')) && !matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  });
  const [heroReady, setHeroReady] = useState(!intro);
  const revealHero = useCallback(() => setHeroReady(true), []);
  const finishIntro = useCallback(() => {
    setHeroReady(true);
    setIntro(false);
    try { sessionStorage.setItem('resx-intro-seen', '1'); } catch {}
  }, []);

  function onAction(action) {
    window.location.assign(`/workspace?auth=${action === 'signup' ? 'signup' : 'login'}`);
  }

  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    document.body.classList.toggle('intro-active', intro);
    root.current.querySelectorAll('header,main,footer,.skip-link').forEach(element => { element.inert = intro; });
    return () => document.body.classList.remove('intro-active');
  }, [intro]);
  return <div ref={root}>
    {intro && <Intro onReveal={revealHero} onComplete={finishIntro} />}
    <a className="skip-link" href="#features">Skip to features</a>
    <Header onAction={onAction} />
    <main><Hero ready={heroReady} onAction={onAction} /><Services /><Contact /></main>
    <footer><Brand /><Mono>© {new Date().getFullYear()} RESX. EVERY PART, CONNECTED.</Mono><a href="#product">Back to top <ArrowUpRight size={15} /></a></footer>
    {notice && <div className="action-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={17} /></button></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
