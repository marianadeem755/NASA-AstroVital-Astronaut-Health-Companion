import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { StarfieldBackground } from './StarfieldBackground';
import { useUIStore } from '../../store/useUIStore';

export function MainLayout() {
  const open = useUIStore((state) => state.sidebarOpen);
  return (
    <div className="app-shell">
      <StarfieldBackground />
      <Sidebar />
      <main className={`main-area ${open ? '' : 'sidebar-collapsed'}`}>
        <Topbar />
        <div className="page-content"><Outlet /></div>
      </main>
    </div>
  );
}
