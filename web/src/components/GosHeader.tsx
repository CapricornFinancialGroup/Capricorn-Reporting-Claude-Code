// The navy Growth OS header (strawman anatomy): brand · page title + live clock · date + LIVE
// badge. The clock ticks client-side every second — the Formula One "alive" signal.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

function useClock(): { time: string; date: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    date: `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`,
  };
}

export function GosHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { time, date } = useClock();
  return (
    <header className="gos-header">
      <div className="gos-brand">
        <span className="gos-brand-icon">{"♑︎"}</span>
        <span className="gos-brand-name">Capricorn Financial Group</span>
      </div>
      <div className="gos-header-center">
        <div className="gos-title">{title}</div>
        <div className="gos-clock">{time}</div>
      </div>
      <div className="gos-header-right">
        <div className="gos-date">{date}</div>
        <div className="live-badge"><span className="live-dot" />Live</div>
        {right}
      </div>
    </header>
  );
}
