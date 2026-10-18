import React, { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { LayoutDashboard, Users, Target, Layers, MessageSquare, CalendarDays, CreditCard, Settings, Search, Bell, ChevronDown, ArrowUpRight, MoreHorizontal } from 'lucide-react';
import './dashboard-preview.css';

const navigation = [
  [LayoutDashboard, 'Overview'], [Users, 'Customers'], [Target, 'Leads'],
  [Layers, 'Pipeline'], [MessageSquare, 'Messages'], [CalendarDays, 'Appointments'], [CreditCard, 'Payments'],
];
const leads = [
  ['AM', 'Ava Mitchell', 'Home consultation', 'New lead', 'JK'],
  ['JL', 'James Lee', 'Maintenance plan', 'Contacted', 'SP'],
  ['SK', 'Sofia Khan', 'Office installation', 'Qualified', 'JK'],
];
const pipeline = [['New leads', 24, 88], ['Contacted', 18, 67], ['Qualified', 12, 45], ['Proposal sent', 8, 30]];

export default function DashboardPreview() {
  const root = useRef(null);
  useLayoutEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const ctx = gsap.context(() => {
        const line = root.current.querySelector('.mock-chart-line');
        const length = line.getTotalLength();
        const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: 'top 86%', toggleActions: 'play none none none' } });
        tl.from('.mock-window', { y: 90, rotationX: 9, scale: .94, opacity: 0, duration: 1.2, ease: 'power3.out' })
          .from('.mock-stat', { y: 18, opacity: 0, stagger: .09, duration: .65, ease: 'power2.out' }, .45)
          .fromTo(line, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.out' }, .65)
          .from('.mock-pipeline-fill', { scaleX: 0, transformOrigin: 'left', duration: 1, stagger: .12, ease: 'power3.out' }, .8)
          .from('.mock-lead-row', { y: 10, opacity: 0, stagger: .1, duration: .55 }, 1);
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return <div className="dashboard-preview" id="dashboard-preview" ref={root}>
    <div className="mock-caption"><span className="mono"><span className="mock-caption-square" />YOUR WORKSPACE, AT A GLANCE</span><span className="mono">ILLUSTRATIVE PREVIEW / SAMPLE DATA</span></div>
    <div className="mock-stage">
      <div className="mock-halo" aria-hidden="true" />
      <div className="mock-window" role="group" aria-label="RESX dashboard design mockup with illustrative sample data">
        <div className="mock-browser"><span className="mock-browser-dots" aria-hidden="true"><i/><i/><i/></span><span>RESX / Your connected workspace</span><span className="mock-demo-badge">SAMPLE DATA</span></div>
        <div className="mock-app">
          <aside className="mock-sidebar" aria-label="Illustrative dashboard sidebar">
            <div className="mock-brand">RESX<span>WORKSPACE</span></div>
            <div className="mock-workspace"><span className="mock-avatar">S</span><span>Studio workspace<small>Service business</small></span><ChevronDown size={12}/></div>
            <div className="mock-nav">{navigation.map(([Icon, label], i) => <div className={i === 0 ? 'is-selected' : ''} key={label}><Icon size={15} strokeWidth={1.5}/><span>{label}</span>{label === 'Messages' && <small>4</small>}</div>)}</div>
            <div className="mock-sidebar-bottom"><Settings size={14}/><span>Workspace settings</span></div>
            <div className="mock-profile"><span className="mock-avatar">JK</span><span>Jamie Kim<small>Workspace admin</small></span></div>
          </aside>
          <div className="mock-main">
            <div className="mock-topbar"><span><span className="mock-live-dot"/>Workspace overview</span><div><Search size={15}/><Bell size={15}/><span className="mock-avatar">JK</span></div></div>
            <div className="mock-content">
              <div className="mock-greeting"><div><span className="mock-eyebrow">YOUR BUSINESS, IN FOCUS</span><h3>Good morning, Jamie<span>.</span></h3><p>Every customer. Every next step. In one place.</p></div><span className="mock-date">This month <ChevronDown size={12}/></span></div>
              <div className="mock-stats">
                {[['Active leads', '62', Target, '12 awaiting follow-up'], ['Pipeline value', '$48,500', Layers, 'Across 4 sales stages'], ['Collected revenue', '$24,800', CreditCard, '18 payments received'], ['Appointments', '16', CalendarDays, '4 scheduled today']].map(([label, value, Icon, detail]) => <div className="mock-stat" key={label}><div><span>{label}</span><Icon size={14}/></div><strong>{value}</strong><small>{detail}</small></div>)}
              </div>
              <div className="mock-chart-grid">
                <div className="mock-panel mock-revenue"><div className="mock-panel-heading"><h4>Revenue overview</h4><span className="mock-chart-key"><i/>Collected</span></div><div className="mock-revenue-total">$24,800 <span>THIS MONTH</span></div>
                  <div className="mock-chart"><div className="mock-chart-axis"><span>$30k</span><span>$20k</span><span>$10k</span></div><svg viewBox="0 0 520 145" preserveAspectRatio="none" role="img" aria-label="Illustrative revenue trend increasing through the month"><defs><linearGradient id="mock-chart-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#386fc2" stopOpacity=".32"/><stop offset="100%" stopColor="#386fc2" stopOpacity="0"/></linearGradient></defs><path className="mock-chart-gridline" d="M0 15H520M0 65H520M0 115H520"/><path d="M0 127C25 125 30 104 55 108S88 122 110 96S142 104 166 79S199 95 221 69S256 85 280 57S314 69 339 43S370 61 396 32S429 46 454 20S494 31 520 7V145H0Z" fill="url(#mock-chart-gradient)"/><path className="mock-chart-line" d="M0 127C25 125 30 104 55 108S88 122 110 96S142 104 166 79S199 95 221 69S256 85 280 57S314 69 339 43S370 61 396 32S429 46 454 20S494 31 520 7"/></svg><div className="mock-chart-dates"><span>01</span><span>07</span><span>14</span><span>21</span><span>28</span></div></div>
                </div>
                <div className="mock-panel mock-pipeline"><div className="mock-panel-heading"><h4>Sales pipeline</h4><Layers size={14}/></div><p className="mock-pipeline-note">62 opportunities, moving forward.</p>{pipeline.map(([label, count, width]) => <div className="mock-pipeline-row" key={label}><div><span>{label}</span><span>{count}</span></div><div className="mock-pipeline-track"><div className="mock-pipeline-fill" style={{width:`${width}%`}}/></div></div>)}</div>
              </div>
              <div className="mock-bottom-grid">
                <div className="mock-panel mock-leads"><div className="mock-panel-heading"><h4>Recent leads</h4><span className="mock-view-label">All leads <ArrowUpRight size={11}/></span></div><table><thead><tr><th>Customer</th><th>Interest</th><th>Status</th><th>Owner</th></tr></thead><tbody>{leads.map(([initials, name, interest, status, owner], i) => <tr className="mock-lead-row" key={name}><td><span className="mock-customer"><span className={`mock-avatar mock-avatar-${i}`}>{initials}</span>{name}</span></td><td>{interest}</td><td><span className={`mock-status mock-status-${i}`}>{status}</span></td><td><span className="mock-owner">{owner}</span></td></tr>)}</tbody></table></div>
                <div className="mock-panel mock-today"><div className="mock-panel-heading"><h4>Up next</h4><MoreHorizontal size={15}/></div><span className="mock-meeting-time">10:30 — 11:00 AM</span><h5>Home consultation</h5><p>Ava Mitchell · Jamie Kim</p><span className="mock-meeting-tag"><CalendarDays size={11}/>Customer appointment</span><div className="mock-followup"><span className="mock-live-dot"/>3 follow-ups need attention</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p className="mock-footnote">A preview of your connected workspace. All figures and customer details are illustrative.</p>
  </div>;
}
