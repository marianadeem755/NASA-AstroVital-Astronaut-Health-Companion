import { useState } from 'react';
import { Bell, ChevronDown, Menu, Orbit, Search, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useUIStore } from '../../store/useUIStore';
import { navigation } from '../../shared/constants/navigation';

export function Topbar() {
  const toggle = useUIStore((state) => state.toggleSidebar);
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const active = navigation.find((item) => item.path === location.pathname)?.label ?? 'Overview';
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={toggle} aria-label="Toggle navigation"><Menu size={19}/></button>
      <div className="breadcrumb"><span>MISSION CONTROL</span><b>/</b><strong>{active.toUpperCase()}</strong></div>
      <div className="top-actions">
        <div className="mission-status"><span className="live-dot"/> DEMO ENVIRONMENT</div>
        {searchOpen && <input className="top-search" autoFocus placeholder="Search modules…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); }}/>}
        <button className="icon-button" aria-label={searchOpen ? 'Close search' : 'Search'} onClick={() => setSearchOpen((value) => !value)}>{searchOpen ? <X size={18}/> : <Search size={18}/>}</button>
        <Link className="icon-button notification" aria-label="Open risk alerts" to="/alerts"><Bell size={18}/><i/></Link>
        <div className="top-divider"/><div className="mission-select"><Orbit size={17}/><span>ARTEMIS · DEMO</span><ChevronDown size={14}/></div>
      </div>
    </header>
  );
}
