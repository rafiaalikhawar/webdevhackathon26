import React from 'react';
import { ArrowUpRight, Mail, Phone } from 'lucide-react';
import { contactDetails } from './contactDetails';
import './contact.css';

function ContactMethod({ label, value, href, icon: Icon }) {
  const content = <>
    <span className="contact-method-label"><Icon size={23} strokeWidth={1.3} /><span>{label}</span></span>
    <span className={`contact-method-value ${value ? '' : 'contact-pending'}`}>{value || 'Coming soon'}{value && <ArrowUpRight size={23} />}</span>
  </>;
  return value ? <a className="contact-method" href={href}>{content}</a> : <div className="contact-method">{content}</div>;
}

export default function Contact() {
  return <section className="contact-section" id="contact" aria-labelledby="contact-heading">
    <div className="contact-top"><span className="mono">03 / CONTACT RESX</span><span className="mono">A CONVERSATION IS A GOOD START.</span></div>
    <div className="contact-introduction"><h2 id="contact-heading">Let’s talk<br /><span>about your business.</span></h2><p>Questions about RESX? We’d love to hear from you.</p></div>
    <div className="contact-methods">
      <ContactMethod label="Email us" value={contactDetails.email} href={`mailto:${contactDetails.email}`} icon={Mail} />
      <ContactMethod label="Call us" value={contactDetails.phone} href={`tel:${contactDetails.phone.replace(/[^+\d]/g, '')}`} icon={Phone} />
    </div>
  </section>;
}
