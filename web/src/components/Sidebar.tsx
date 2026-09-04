import {
  BarChart3,
  Kanban,
  GitGraph,
  CheckSquare,
  Activity,
  Settings,
} from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

export default function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const pages = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'kanban', label: 'Kanban', icon: Kanban },
    { id: 'graph', label: 'Graph', icon: GitGraph },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare },
    { id: 'events', label: 'Events', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-base-200 border-r border-base-300 overflow-y-auto flex flex-col">
      <nav className="menu menu-sm p-4 space-y-1 flex-1 w-full">
        {pages.map((page) => {
          const Icon = page.icon;
          return (
            <li key={page.id}>
              <a
                className={currentPage === page.id ? 'active' : ''}
                onClick={() => onPageChange(page.id)}
              >
                <Icon className="w-5 h-5" />
                <span>{page.label}</span>
              </a>
            </li>
          );
        })}
      </nav>
    </aside>
  );
}
