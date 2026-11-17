import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useToast } from '../../hooks/useToast';
import { notificationsService } from '../../services/accountService';
import { cx } from '../../utils/cx';
import { formatRelative } from '../../utils/format';
import styles from './NotificationBell.module.scss';

/**
 * Campana de notificaciones de la barra superior. Muestra cuántas hay sin
 * leer y se actualiza sola cuando llega una nueva por el canal en tiempo real.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const toast = useToast();
  const panelId = useId();
  const wrapper = useRef(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ items: [], unread: 0, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const response = await notificationsService.list({ per_page: 10 });
      setState({ items: response.data, unread: response.meta.unread_count, loading: false, error: null });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(['notifications'], load, { debounceMs: 200 });

  // Cerrar con Escape o al hacer clic fuera.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    const onClick = (event) => wrapper.current && !wrapper.current.contains(event.target) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function openItem(item) {
    setOpen(false);
    if (!item.read_at) {
      setState((prev) => ({
        ...prev,
        unread: Math.max(0, prev.unread - 1),
        items: prev.items.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)),
      }));
      notificationsService.read(item.id).catch(() => load());
    }
    if (item.url) navigate(item.url);
  }

  async function readAll() {
    try {
      await notificationsService.readAll();
      load();
    } catch (error) {
      toast.error(error.message);
    }
  }

  const badge = state.unread > 9 ? '9+' : String(state.unread);

  return (
    <div className={styles.wrapper} ref={wrapper}>
      <button
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
      >
        <Icon name="bell" size={20} />
        <span className="visually-hidden">Notificaciones{state.unread ? `, ${state.unread} sin leer` : ''}</span>
        {state.unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} className={styles.panel} role="dialog" aria-label="Notificaciones">
          <div className={styles.header}>
            <p className={styles.title}>Notificaciones</p>
            {state.unread > 0 && (
              <button type="button" className={styles.link} onClick={readAll}>
                Marcar todas como leídas
              </button>
            )}
          </div>

          {state.loading && !state.items.length ? (
            <p className={styles.empty}>
              <Spinner size={14} /> Cargando…
            </p>
          ) : state.error && !state.items.length ? (
            <p className={styles.empty}>{state.error.message}</p>
          ) : state.items.length === 0 ? (
            <div className={styles.empty}>
              <Icon name="bell" size={22} />
              <p>No tienes notificaciones. Aquí verás, por ejemplo, los proyectos que están por vencer.</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {state.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={cx(styles.item, !item.read_at && styles.unread)} onClick={() => openItem(item)}>
                    <span className={styles.icon} aria-hidden="true">
                      <Icon name={item.kind === 'project_ending' ? 'calendar' : 'bell'} size={18} />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.itemTitle}>{item.title}</span>
                      {item.body && <span className={styles.body}>{item.body}</span>}
                      <span className={styles.time}>{formatRelative(item.created_at)}</span>
                    </span>
                    {!item.read_at && <span className={styles.dot} aria-label="Sin leer" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
