import { useContext, useState } from 'react';
import { RealtimeContext } from '../../context/RealtimeContext';
import { Icon } from '../ui/Icon';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { initials } from '../../utils/format';
import styles from './Topbar.module.scss';

export function Topbar({ onMenu, sidebarOpen }) {
  const { user, isSuperAdmin, logout } = useAuth();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  const roleLabel = isSuperAdmin ? 'Super Admin' : user.roles?.filter((r) => r.is_active).map((r) => r.name).join(', ') || 'Sin roles asignados';

  async function handleLogout() {
    setLeaving(true);
    try {
      await logout(); // la ruta protegida redirige al login
    } catch (error) {
      setLeaving(false);
      toast.error(error.message);
    }
  }

  return (
    <header className={styles.topbar}>
      <button type="button" className={styles.menu} onClick={onMenu} aria-expanded={sidebarOpen} aria-controls="admin-sidebar">
        <Icon name="menu" size={22} />
        <span className="visually-hidden">Abrir menú de navegación</span>
      </button>

      <div className={styles.spacer} />

      <LiveStatus />

      <div className={styles.user}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className={styles.identity}>
          <span className={styles.name}>
            {user.name}
            {isSuperAdmin && (
              <Badge tone="accent" className={styles.badge}>
                Super Admin
              </Badge>
            )}
          </span>
          <span className={styles.meta}>{isSuperAdmin ? user.email : roleLabel}</span>
        </span>
      </div>

      <button type="button" className={styles.logout} onClick={handleLogout} disabled={leaving}>
        <Icon name="logout" size={18} />
        <span className={styles.logoutLabel}>{leaving ? 'Cerrando…' : 'Cerrar sesión'}</span>
      </button>
    </header>
  );
}

const LIVE_LABELS = {
  connecting: 'Conectando…',
  live: 'En vivo',
  reconnecting: 'Reconectando…',
};

/** Estado del canal en tiempo real; no se muestra si el servidor no lo tiene. */
function LiveStatus() {
  const realtime = useContext(RealtimeContext);
  const status = realtime?.status ?? 'off';
  if (status === 'off') return null;

  return (
    <span
      className={styles.live}
      data-status={status}
      role="status"
      title={status === 'live' ? 'Los datos se actualizan automáticamente' : 'Los datos se actualizarán al reconectar'}
    >
      <span className={styles.liveDot} aria-hidden="true" />
      {LIVE_LABELS[status]}
    </span>
  );
}
