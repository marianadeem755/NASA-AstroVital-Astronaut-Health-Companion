import { NavLink } from 'react-router-dom';
import { Activity, Atom, Brain, BarChart3, ClipboardCheck, HeartPulse, Moon, Radio, ShieldAlert, UserRound, Bone, PanelLeftClose, Stethoscope, Sparkles } from 'lucide-react';
import { navigation } from '../../shared/constants/navigation';
import { useUIStore } from '../../store/useUIStore';

const icons = [Atom, HeartPulse, Radio, Brain, Moon, Bone, BarChart3, ShieldAlert, Sparkles, ClipboardCheck, UserRound, Stethoscope];

export function Sidebar() {
  const open = useUIStore((state) => state.sidebarOpen);
  const toggle = useUIStore((state) => state.toggleSidebar);
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : 'sidebar-mini'}`}>
      <div className="brand"><div className="brand-mark"><Activity size={22}/></div>{open && <div><b>ASTRO<span>VITAL</span></b><small>MISSION HEALTH SYSTEM</small></div>}</div>
      <div className="mission-chip"><span className="live-dot"/>{open ? 'MISSION CONTROL · DEMO' : 'DEMO'}</div>
      <nav className="nav-list" aria-label="Main navigation">
        {navigation.map((item, index) => {
          const Icon = icons[index] || Atom;
          return <NavLink key={item.path} to={item.path} end={item.path === '/'} title={item.label} onClick={() => { if (window.matchMedia('(max-width: 700px)').matches) toggle(); }} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon size={18}/>{open && <span>{item.label}</span>}
          </NavLink>;
        })}
      </nav>
      <div className="sidebar-bottom">
        {open && <div className="crew-card"><div className="crew-avatar">AI</div><div><b>Demo Astronaut</b><small>CREW-001 · Lunar mission</small></div></div>}
        <button className="collapse-btn" onClick={toggle} aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}><PanelLeftClose size={17}/>{open && 'Collapse sidebar'}</button>
      </div>
    </aside>
  );
}
