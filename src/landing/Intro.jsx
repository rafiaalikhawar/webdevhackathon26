import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ArrowRight } from 'lucide-react';

function Mono({children,className=''}){return <span className={`mono ${className}`}>{children}</span>;}

export default function Intro({onComplete,onReveal}){
  const ref=useRef(), progressRef=useRef(), markerRef=useRef(), percentageRef=useRef(), trailRef=useRef();
  useEffect(()=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){onComplete();return;}
    const deadline = setTimeout(onComplete, 5500);
    ref.current.querySelector('.skip-intro')?.focus({preventScroll:true});
    const ctx=gsap.context(()=>{
      const progress={value:0};
      const updateProgress=()=>{
        if(!markerRef.current||!trailRef.current||!percentageRef.current||!progressRef.current)return;
        const value=Math.round(progress.value);
        markerRef.current.style.left=`${progress.value}%`;
        trailRef.current.style.width=`${progress.value}%`;
        percentageRef.current.textContent=`${value}%`;
        progressRef.current.setAttribute('aria-valuenow',String(value));
      };
      gsap.timeline({onComplete})
      .to(progress,{value:12,duration:.4,ease:'power2.in',onUpdate:updateProgress},.18)
      .to(progress,{value:51,duration:.55,ease:'power2.inOut',onUpdate:updateProgress})
      .to(progress,{value:100,duration:.75,ease:'power3.inOut',onUpdate:updateProgress},'+=.12')
      .to('.opening-loader',{opacity:0,duration:.3},'+=.18')
      .set('.intro-center',{visibility:'visible'},2.2)
      .fromTo('.intro-glow',{opacity:0,scale:.6},{opacity:1,scale:1,duration:1.1},2.2)
      .fromTo('.intro-letter',{y:70,opacity:0},{y:0,opacity:1,stagger:.085,duration:.7,ease:'power3.out'},2.45)
      .fromTo('.intro-tagline',{opacity:0,y:12},{opacity:1,y:0,duration:.5},2.95)
      .fromTo('.intro-bottom',{opacity:0},{opacity:1,duration:.5},3.1)
      .call(onReveal,[],3.95)
      .to(ref.current,{opacity:0,duration:.75,ease:'power2.inOut'},4.05);
    },ref);return()=>{clearTimeout(deadline);ctx.revert();};
  },[onComplete,onReveal]);
  return <div className="intro" ref={ref} role="dialog" aria-modal="true" aria-label="Welcome to RESX" onKeyDown={e=>{if(e.key==='Escape')onComplete();if(e.key==='Tab')e.preventDefault();}}><div className="opening-loader"><div className="opening-progress" ref={progressRef} role="progressbar" aria-label="Opening animation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><div className="opening-trail" ref={trailRef}/><div className="opening-marker" ref={markerRef} aria-hidden="true"><span className="opening-square"/><span className="opening-percentage" ref={percentageRef}>0%</span><span className="opening-guide"/></div></div></div><div className="intro-glow"/><div className="intro-center"><div className="intro-logo"><div>{'RESX'.split('').map((c,i)=><span className="intro-letter" key={i}>{c}</span>)}</div></div><Mono className="intro-tagline">EVERYTHING, IN MOTION.</Mono></div><button className="skip-intro" onClick={onComplete}>Skip intro <ArrowRight size={14}/></button><Mono className="intro-bottom">A MORE CONNECTED WAY TO WORK</Mono></div>;
}

