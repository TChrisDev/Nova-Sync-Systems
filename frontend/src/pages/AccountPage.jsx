import { useRef, useState } from 'react';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Field';
import { PageHeader } from '../components/ui/PageHeader';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { accountService } from '../services/accountService';
import { formatDateTime } from '../utils/format';
import styles from './AccountPage.module.scss';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Configuración de la propia cuenta: foto de perfil y avisos por correo. */
export default function AccountPage() {
  useDocumentTitle('Configuración de cuenta');
  const { user, isSuperAdmin, load } = useAuth();
  const toast = useToast();
  const input = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const roles = isSuperAdmin ? ['Super Admin'] : (user.roles ?? []).filter((r) => r.is_active).map((r) => r.name);

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!TYPES.includes(file.type)) {
      setPhotoError('La foto debe ser JPG, PNG o WebP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhotoError('La foto no puede pesar más de 2 MB.');
      return;
    }

    setPhotoError(null);
    setUploading(true);
    try {
      const response = await accountService.uploadAvatar(file);
      toast.success(response.message);
      await load();
    } catch (error) {
      setPhotoError(error.fieldErrors?.avatar ?? error.message);
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    setRemoving(true);
    try {
      const response = await accountService.removeAvatar();
      toast.success(response.message);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRemoving(false);
    }
  }

  async function toggleEmail(event) {
    const value = event.target.checked;
    setSavingPrefs(true);
    try {
      const response = await accountService.updatePreferences({ notify_by_email: value });
      toast.success(response.message);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <>
      <PageHeader title="Configuración de cuenta" description="Tu foto de perfil y cómo quieres recibir los avisos del ERP." />

      <div className={styles.layout}>
        <section className={styles.card} aria-labelledby="account-profile">
          <h2 id="account-profile" className={styles.cardTitle}>
            Perfil
          </h2>
          <div className={styles.profile}>
            <Avatar user={user} size={96} />
            <div className={styles.identity}>
              <p className={styles.name}>{user.name}</p>
              <p className={styles.email}>{user.email}</p>
              <p className={styles.roles}>
                {roles.length ? roles.map((role) => <Badge key={role} tone={isSuperAdmin ? 'accent' : 'neutral'}>{role}</Badge>) : <Badge>Sin roles asignados</Badge>}
              </p>
            </div>
          </div>

          <div className={styles.photoActions}>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" onChange={onFile} tabIndex={-1} aria-hidden="true" />
            <Button icon="camera" onClick={() => input.current?.click()} loading={uploading} disabled={removing}>
              {user.avatar_url ? 'Cambiar foto' : 'Subir foto'}
            </Button>
            {user.avatar_url && (
              <Button variant="secondary" icon="trash" onClick={removePhoto} loading={removing} disabled={uploading}>
                Quitar foto
              </Button>
            )}
          </div>
          {photoError ? (
            <p className={styles.error} role="alert">
              {photoError}
            </p>
          ) : (
            <p className={styles.hint}>JPG, PNG o WebP de hasta 2 MB. Se recomienda una foto cuadrada de al menos 256 × 256 píxeles. Solo la ven las personas con acceso al ERP.</p>
          )}
          <p className={styles.hint}>Tu nombre y tu correo vienen de tu cuenta corporativa y se actualizan cada vez que ingresas.</p>
        </section>

        <section className={styles.card} aria-labelledby="account-notifications">
          <h2 id="account-notifications" className={styles.cardTitle}>
            Notificaciones
          </h2>
          <p className={styles.hint}>Los avisos siempre aparecen en la campana de la barra superior. Además puedes recibirlos por correo.</p>
          <Checkbox
            checked={user.notify_by_email ?? true}
            onChange={toggleEmail}
            disabled={savingPrefs}
            label="Recibir avisos por correo"
            description={`Por ejemplo, cuando un proyecto que lideras o administras está por vencer. Se envían a ${user.email}.`}
          />
        </section>

        <section className={styles.card} aria-labelledby="account-access">
          <h2 id="account-access" className={styles.cardTitle}>
            Inicio de sesión
          </h2>
          <ul className={styles.providers}>
            <li>
              <span>Microsoft 365</span>
              <Badge tone={user.microsoft_linked ? 'success' : 'neutral'} dot>
                {user.microsoft_linked ? 'Vinculada' : 'Sin usar'}
              </Badge>
            </li>
            <li>
              <span>Google Workspace</span>
              <Badge tone={user.google_linked ? 'success' : 'neutral'} dot>
                {user.google_linked ? 'Vinculada' : 'Sin usar'}
              </Badge>
            </li>
          </ul>
          <p className={styles.hint}>Último ingreso: {formatDateTime(user.last_login_at)}</p>
        </section>
      </div>
    </>
  );
}
