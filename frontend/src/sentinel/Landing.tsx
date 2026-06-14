import {
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  CircleDot,
  Map as MapIcon,
  Radio,
  ShieldCheck,
  Siren,
  Users,
  Waves,
  Wind,
} from "lucide-react";
import type { View } from "./SentinelApp";

export default function Landing({ onEnter }: { onEnter: (v: View) => void }) {
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <span className="landing-kicker"><CircleDot size={12} /> Emergency Operations · Live</span>
          <h1 className="landing-title">
            Urban Drainage Intelligence<br />&amp; <span>Sewer Safety</span> Platform
          </h1>
          <p className="landing-tag">
            A real-time flood early-warning and drainage command system for municipal authorities
            and citizens — powered by IoT sensors, predictive AI, and explainable decision support.
          </p>
          <p className="landing-pos">
            HydroMind Sentinel unifies an Urban Drainage Digital Twin, Flood Intelligence, and Sewer
            Safety monitoring to help citizens stay safe and help municipal authorities make proactive
            decisions through real-time monitoring, predictive analytics, and multilingual communication.
          </p>
        </div>
      </section>

      <div className="landing-portals">
        <div className="portal-card cit" onClick={() => onEnter("citizen")}>
          <div className="portal-card-icon cit"><Users size={26} /></div>
          <h2>Citizen Portal</h2>
          <p>Simple, actionable flood-safety information for residents — know your risk, find safe zones, and report problems.</p>
          <ul>
            <li><Waves size={15} /> Live risk status &amp; AI situation summary</li>
            <li><MapIcon size={15} /> Flood map with safe zones &amp; relief centers</li>
            <li><Siren size={15} /> Time-to-flood &amp; area safety score</li>
            <li><Bell size={15} /> Multilingual alerts &amp; community reporting</li>
          </ul>
          <button className="portal-enter">Enter Citizen Portal <ArrowRight size={16} /></button>
        </div>

        <div className="portal-card adm" onClick={() => onEnter("admin")}>
          <div className="portal-card-icon adm"><ShieldCheck size={26} /></div>
          <h2>Admin Command Center</h2>
          <p>A municipal operations console for drainage engineers and disaster-management staff — full digital twin and analytics.</p>
          <ul>
            <li><Boxes size={15} /> Digital drainage twin &amp; live drain network</li>
            <li><Waves size={15} /> Flood escalation &amp; recovery forecasts</li>
            <li><Wind size={15} /> Sewer safety &amp; worker-entry clearance</li>
            <li><BarChart3 size={15} /> Anomaly detection, asset prioritization, analytics</li>
          </ul>
          <button className="portal-enter">Enter Command Center <ArrowRight size={16} /></button>
        </div>
      </div>

      <div className="landing-strip">
        <div className="landing-strip-inner">
          <div className="landing-stat"><b>₹560</b><span>per sensor node — 30× denser than manual gauges</span></div>
          <div className="landing-stat"><b>2 hr</b><span>predictive flood warning window</span></div>
          <div className="landing-stat"><b>3</b><span>languages — Telugu · Tamil · English</span></div>
          <div className="landing-stat"><b><Radio size={20} style={{ verticalAlign: "-3px" }} /> 24×7</b><span>real-time sensor monitoring</span></div>
        </div>
      </div>
    </div>
  );
}
