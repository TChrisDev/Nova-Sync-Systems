import { useState } from 'react';
import { cx } from '../../utils/cx';
import { initials } from '../../utils/format';
import styles from './Avatar.module.scss';

/**
 * Foto de perfil o, si no hay (o no carga), las iniciales. La foto la
 * entrega la API solo a usuarios con sesión.
 */
export function Avatar({ user, size = 36, className }) {
  const [failed, setFailed] = useState(null);
  const url = user?.avatar_url;
  const showImage = url && failed !== url;

  return (
    <span className={cx(styles.avatar, className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {showImage ? <img src={url} alt="" className={styles.image} onError={() => setFailed(url)} /> : initials(user?.name ?? '')}
    </span>
  );
}
