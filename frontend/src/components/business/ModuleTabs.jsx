import { Link, NavLink } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { cx } from '../../utils/cx';
import styles from './Business.module.scss';

// Pestañas de cada módulo. Una pestaña con `anyOf` solo aparece si la
// persona tiene alguno de esos permisos (la API igual lo vuelve a revisar).
const MODULE_TABS = {
  clients: [
    { to: '/app/commercial', label: 'Indicadores' },
    { to: '/app/clients', label: 'Clientes' },
    { to: '/app/contracts', label: 'Contratos' },
  ],
  projects: [
    { to: '/app/projects-overview', label: 'Indicadores', anyOf: ['projects.view', 'projects.lead'] },
    { to: '/app/projects', label: 'Proyectos', anyOf: ['projects.view', 'projects.lead'] },
    { to: '/app/capacity', label: 'Capacidad', anyOf: ['projects.capacity'] },
    { to: '/app/staff', label: 'Perfiles', anyOf: ['projects.staff'] },
  ],
  assets: [
    { to: '/app/assets', label: 'Panel técnico', end: true },
    { to: '/app/assets/inventory', label: 'Inventario' },
    { to: '/app/assets/map', label: 'Mapa de red' },
    { to: '/app/assets/coverage', label: 'Cobertura' },
    { to: '/app/assets/telemetry', label: 'Telemetría' },
    { to: '/app/assets/incidents', label: 'Incidentes' },
  ],
  timesheets: [
    { to: '/app/timesheets', label: 'Mis horas', anyOf: ['timesheets.create'], end: true },
    { to: '/app/timesheets/review', label: 'Aprobaciones', anyOf: ['timesheets.approve', 'timesheets.approve_any'] },
    { to: '/app/timesheets/reports', label: 'Reportes', anyOf: ['timesheets.view', 'timesheets.approve', 'timesheets.approve_any'] },
  ],
};

export function ModuleTabs({ module = 'clients' }) {
  const { canAny } = useAuth();
  const tabs = MODULE_TABS[module].filter((tab) => !tab.anyOf || canAny(tab.anyOf));

  if (tabs.length < 2) return null;

  return (
    <nav className={styles.tabs} aria-label="Secciones del módulo">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cx(styles.tab, isActive && styles.tabActive)}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function BackLink({ to, children }) {
  return (
    <Link to={to} className={styles.back}>
      <span aria-hidden="true">‹</span> {children}
    </Link>
  );
}
