import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Logo } from '../components/brand/Logo';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { LOGIN_PROVIDERS, NEXT_PATH_KEY } from '../config/app';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { authService } from '../services/authService';
import { authErrorMessage } from '../utils/authMessages';
import styles from './LoginPage.module.scss';

/** Solo se aceptan rutas internas del panel (evita redirecciones abiertas). */
function safeNext(value) {
  return value && /^\/app(\/[\w\-/?=&%.]*)?$/.test(value) ? value : null;
}

export default function LoginPage() {
  useDocumentTitle('Ingresar');
  const auth = useAuth();
  const [params] = useSearchParams();
  const [config, setConfig] = useState({ loading: true, configured: null, providers: [], error: null });
  const [redirecting, setRedirecting] = useState(null);

  const errorCode = params.get('error');
  const loggedOut = params.get('logged_out') === '1';
  const next = safeNext(params.get('next'));

  useEffect(() => {
    if (auth.status === 'idle') auth.load();
  }, [auth]);

  useEffect(() => {
    let active = true;
    authService
      .config()
      .then(
        (data) =>
          active && setConfig({ loading: false, configured: data.configured, providers: data.providers ?? [], error: null }),
      )
      .catch((error) => active && setConfig({ loading: false, configured: null, providers: [], error }));
    return () => {
      active = false;
    };
  }, []);

  if (auth.status === 'authenticated') {
    return <Navigate to={next ?? '/app'} replace />;
  }

  function startLogin(provider) {
    setRedirecting(provider.id);
    try {
      if (next) sessionStorage.setItem(NEXT_PATH_KEY, next);
    } catch {
      // Almacenamiento no disponible: se ingresa al panel principal.
    }
    // Navegación completa: Laravel inicia el flujo OAuth 2.0 / OpenID Connect.
    window.location.assign(provider.path);
  }

  const message = authErrorMessage(errorCode);
  const isConfigured = (id) => config.providers.some((p) => p.id === id && p.configured);
  // Mientras se consulta la configuración se muestran los dos botones
  // deshabilitados; luego solo los proveedores listos en el servidor.
  const providers = config.loading || config.configured === false || config.error
    ? LOGIN_PROVIDERS
    : LOGIN_PROVIDERS.filter((p) => isConfigured(p.id));

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link to="/" className={styles.brand} aria-label="Volver al inicio de Nova Sync Systems">
          <Logo />
        </Link>
        <Link to="/" className={styles.back}>
          <Icon name="chevron-left" size={16} />
          Volver al inicio
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="login-title">
          <h1 id="login-title" className={styles.title}>
            Ingresa a Nova Sync Systems
          </h1>
          <p className={styles.text}>
            Usa tu cuenta corporativa de Microsoft 365 o de Google Workspace. Te llevaremos a la página oficial de tu proveedor:
            tu contraseña nunca se escribe ni se guarda en este sistema.
          </p>

          {message && (
            <div className={styles.alert} role="alert">
              <Icon name="alert" size={18} />
              <p>{message}</p>
            </div>
          )}

          {loggedOut && !message && (
            <div className={styles.notice} role="status">
              <Icon name="check" size={18} />
              <p>Cerraste sesión correctamente.</p>
            </div>
          )}

          {config.configured === false && errorCode !== 'not_configured' && (
            <div className={styles.warning} role="status">
              <Icon name="info" size={18} />
              <p>
                El inicio de sesión corporativo aún no está configurado en el servidor. Consulta las guías de Microsoft Entra ID y
                de Google Workspace del proyecto.
              </p>
            </div>
          )}

          {config.error && (
            <div className={styles.warning} role="status">
              <Icon name="info" size={18} />
              <p>{config.error.message}</p>
            </div>
          )}

          <div className={styles.providers}>
            {providers.map((provider) => (
              <Button
                key={provider.id}
                size="lg"
                variant="secondary"
                block
                icon={provider.icon}
                onClick={() => startLogin(provider)}
                loading={redirecting === provider.id}
                disabled={config.loading || !isConfigured(provider.id) || Boolean(redirecting)}
              >
                {redirecting === provider.id ? 'Redirigiendo…' : `Ingresar con ${provider.name}`}
              </Button>
            ))}
          </div>

          {config.loading && (
            <p className={styles.checking}>
              <Spinner size={14} /> Comprobando la configuración de acceso…
            </p>
          )}

          <p className={styles.help}>
            ¿No tienes acceso? Solicita al administrador del sistema que autorice tu cuenta corporativa.
          </p>
        </section>
      </main>
    </div>
  );
}
