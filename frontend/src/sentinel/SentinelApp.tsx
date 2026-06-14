import { useEffect, useState } from "react";
import { Phone, ShieldCheck, Users, Waves } from "lucide-react";

import Landing from "./Landing";
import CitizenPortal from "./citizen/CitizenPortal";
import AdminPortal from "./admin/AdminPortal";

export type View = "landing" | "citizen" | "admin";

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Masthead({ view, setView }: { view: View; setView: (v: View) => void }) {
  const now = useClock();
  return (
    <>
      <div className="gov-utilbar" />
      <div className="gov-topstrip">
        <div className="gov-topstrip-inner">
          <span>भारत सरकार · Government of India — Smart Cities Mission · State Disaster Management Authority</span>
          <span>
            <Phone size={11} style={{ verticalAlign: "-1px" }} /> Emergency Helpline <b style={{ color: "#fff" }}>1077</b>
            <span className="sep">|</span>
            <a href="#">A+ A-</a>
            <span className="sep">|</span>
            <a href="#">English</a>
          </span>
        </div>
      </div>

      <div className="gov-masthead">
        <div className="gov-masthead-inner">
          <button
            onClick={() => setView("landing")}
            style={{ display: "flex", alignItems: "center", gap: 14, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <div className="gov-emblem"><Waves size={24} /></div>
            <div style={{ textAlign: "left" }}>
              <div className="gov-mast-title">HydroMind <span>Sentinel</span></div>
              <div className="gov-mast-sub">AI-Powered Urban Drainage Intelligence &amp; Sewer Safety Platform</div>
            </div>
          </button>

          <div className="gov-mast-right">
            <div className="gov-clock">
              <b>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</b>
              <div>{now.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</div>
            </div>
            <div className="portal-switch">
              <button className={view === "citizen" ? "active" : ""} onClick={() => setView("citizen")}>
                <Users size={14} /> Citizen
              </button>
              <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
                <ShieldCheck size={14} /> Admin
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="gov-footer">
      <div className="gov-footer-inner">
        <div>
          <strong style={{ color: "#cfe0f0" }}>HydroMind Sentinel</strong> — Urban Drainage Digital Twin, Flood Intelligence &amp; Sewer Safety.
          <br />Real-time monitoring · Predictive analytics · Multilingual alerts · Explainable AI.
        </div>
        <div style={{ textAlign: "right" }}>
          <a href="#">Disaster Helpline 1077</a> · <a href="#">Ambulance 108</a><br />
          © {new Date().getFullYear()} State Disaster Management Authority. For official use.
        </div>
      </div>
    </footer>
  );
}

export default function SentinelApp() {
  const [view, setView] = useState<View>("landing");
  return (
    <div className="sentinel-root">
      <Masthead view={view} setView={setView} />
      {view === "landing" && <Landing onEnter={setView} />}
      {view === "citizen" && <CitizenPortal />}
      {view === "admin" && <AdminPortal />}
      <Footer />
    </div>
  );
}
