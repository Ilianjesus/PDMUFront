import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, UserPlus, UsersRound } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { useAuth } from "../hooks/useAuth";
import { inviteOperator, listOperators, updateOperator } from "../services/operatorsService";
import "../styles/Operadores.css";

const EMPTY_INVITE = { email: "", displayName: "", role: "operator" };

export function Operadores() {
  const { session } = useAuth();
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE);
  const [pendingUpdate, setPendingUpdate] = useState(null);

  const loadOperators = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await listOperators();
    if (result.ok) setOperators(result.data);
    else setError(result.message);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadOperators();
  }, [loadOperators]);

  const activeCount = useMemo(
    () => operators.filter((operator) => operator.status === "active").length,
    [operators]
  );

  const submitInvite = async () => {
    const normalizedEmail = inviteForm.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Captura un correo válido para enviar la invitación.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const result = await inviteOperator({
      ...inviteForm,
      email: normalizedEmail,
      displayName: inviteForm.displayName.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setInviteOpen(false);
    setInviteForm(EMPTY_INVITE);
    setMessage("Operador invitado correctamente.");
    await loadOperators();
  };

  const confirmUpdate = async () => {
    if (!pendingUpdate) return;
    setSaving(true);
    setError("");
    setMessage("");
    const result = await updateOperator(pendingUpdate);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPendingUpdate(null);
    setMessage("Perfil de operador actualizado.");
    await loadOperators();
  };

  return (
    <div className="operators-page page-shell">
      <div className="page-shell__inner">
        <PageHeader
          title="Operadores"
          description={`${activeCount} cuenta(s) activa(s) con acceso operativo.`}
          menuActions={[
            {
              id: "operators-refresh",
              label: loading ? "Consultando" : "Actualizar",
              icon: RefreshCw,
              onSelect: loadOperators,
              disabled: loading,
            },
          ]}
          actions={(
            <button
              type="button"
              className="page-header__icon-action"
              aria-label="Invitar operador"
              title="Invitar operador"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus aria-hidden="true" />
            </button>
          )}
        />

        {error && <StatusMessage variant="error">{error}</StatusMessage>}
        {message && <StatusMessage variant="success">{message}</StatusMessage>}

        <section className="operators-section" aria-labelledby="operators-list-title">
          <div className="operators-section__header">
            <div>
              <span>Control de acceso</span>
              <h2 id="operators-list-title">Cuentas autorizadas</h2>
            </div>
            <strong>{operators.length}</strong>
          </div>

          {loading ? (
            <LoadingState label="Cargando operadores..." />
          ) : operators.length === 0 ? (
            <EmptyState title="Sin operadores" description="Invita la primera cuenta para comenzar." />
          ) : (
            <div className="operators-list">
              {operators.map((operator) => (
                <article className="operator-row" key={operator.id}>
                  <div className="operator-row__identity">
                    <span className="operator-row__avatar" aria-hidden="true">
                      <UsersRound />
                    </span>
                    <div>
                      <strong>{operator.displayName}</strong>
                      <span>
                        {operator.email}
                        {operator.id === session?.uid ? " · Tu cuenta" : ""}
                      </span>
                    </div>
                  </div>

                  <label>
                    <span>Rol</span>
                    <select
                      value={operator.role}
                      disabled={operator.id === session?.uid}
                      title={operator.id === session?.uid ? "Tu propio rol no se modifica desde esta vista" : undefined}
                      onChange={(event) => setPendingUpdate({
                        operatorId: operator.id,
                        role: event.target.value,
                        status: operator.status,
                      })}
                    >
                      <option value="operator">Operador</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className={`operator-status${operator.status === "active" ? " is-active" : ""}`}
                    disabled={operator.id === session?.uid}
                    title={operator.id === session?.uid ? "Tu propia cuenta debe permanecer activa" : undefined}
                    onClick={() => setPendingUpdate({
                      operatorId: operator.id,
                      role: operator.role,
                      status: operator.status === "active" ? "inactive" : "active",
                    })}
                  >
                    {operator.status === "active" ? "Activo" : "Inactivo"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={inviteOpen}
        title="Invitar operador"
        message="La cuenta quedará autorizada y podrá solicitar su código OTP con este correo."
        confirmLabel="Enviar invitación"
        cancelLabel="Cancelar"
        busy={saving}
        onConfirm={submitInvite}
        onCancel={() => setInviteOpen(false)}
      >
        <div className="operator-dialog-fields">
          <label>
            Nombre
            <input
              type="text"
              value={inviteForm.displayName}
              onChange={(event) => setInviteForm((current) => ({ ...current, displayName: event.target.value }))}
              autoComplete="name"
            />
          </label>
          <label>
            Correo
            <input
              type="email"
              value={inviteForm.email}
              onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Rol
            <select
              value={inviteForm.role}
              onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}
            >
              <option value="operator">Operador</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingUpdate)}
        title="Confirmar acceso"
        message="Este cambio modifica los permisos efectivos de la cuenta."
        confirmLabel="Guardar cambio"
        cancelLabel="Cancelar"
        busy={saving}
        onConfirm={confirmUpdate}
        onCancel={() => setPendingUpdate(null)}
      />
    </div>
  );
}
