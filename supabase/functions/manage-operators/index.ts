import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return respond(status, { ok: false, error: { code, message } });
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Método no permitido.");

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return fail(500, "SERVER_CONFIG_ERROR", "Gestión de operadores no configurada.");

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return fail(401, "SESSION_REQUIRED", "Inicia sesión nuevamente.");

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const actor = userData.user;
  if (userError || !actor) return fail(401, "SESSION_INVALID", "La sesión ya no es válida.");

  // Authorization comes from the database, never from mutable user_metadata or stale JWT claims.
  const { data: profile, error: profileError } = await supabase
    .from("operator_profiles")
    .select("id,role,status")
    .eq("id", actor.id)
    .maybeSingle();
  if (profileError) return fail(500, "PROFILE_QUERY_FAILED", "No se pudo validar el acceso.");
  if (profile?.role !== "admin" || profile.status !== "active") {
    return fail(403, "ADMIN_REQUIRED", "Se requiere una cuenta administradora activa.");
  }

  let body: { action?: unknown; data?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return fail(400, "INVALID_JSON", "Solicitud inválida.");
  }
  const data = body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return fail(400, "INVALID_DATA", "Faltan los datos del operador.");
  }

  if (body.action === "operator.invite") {
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
    const role = data.role;
    if (!emailPattern.test(email) || email.length > 320 || displayName.length > 160 ||
      (role !== "admin" && role !== "operator")) {
      return fail(400, "INVALID_OPERATOR", "Revisa el correo, nombre y rol.");
    }

    const { data: existing, error: lookupError } = await supabase
      .from("operator_profiles").select("id").eq("email", email).maybeSingle();
    if (lookupError) return fail(500, "OPERATOR_LOOKUP_FAILED", "No se pudo verificar el correo.");
    if (existing) return fail(409, "OPERATOR_EXISTS", "Este correo ya tiene una cuenta.");

    // No separate invitation workflow: the account is enabled and its first OTP
    // goes through the existing Supabase Auth email hook.
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { display_name: displayName || email },
      app_metadata: { pdmu_role: role, pdmu_status: "active" },
    });
    if (createError || !created.user) {
      return fail(409, "OPERATOR_CREATE_FAILED", "No se pudo crear la cuenta; verifica si ya existe.");
    }

    const { data: createdProfile, error: createdProfileError } = await supabase
      .from("operator_profiles")
      .select("id,email,role,status")
      .eq("id", created.user.id)
      .maybeSingle();
    if (createdProfileError || !createdProfile || createdProfile.status !== "active") {
      return fail(500, "PROFILE_BOOTSTRAP_FAILED", "La cuenta se creó, pero su perfil requiere revisión.");
    }
    return respond(201, { ok: true, data: { operator: createdProfile } });
  }

  if (body.action === "operator.update") {
    const operatorId = typeof data.operatorId === "string" ? data.operatorId : "";
    const role = data.role;
    const status = data.status;
    if (!uuidPattern.test(operatorId) || (role !== "admin" && role !== "operator") ||
      (status !== "active" && status !== "inactive")) {
      return fail(400, "INVALID_OPERATOR", "Revisa los permisos del operador.");
    }
    if (operatorId === actor.id) {
      return fail(400, "SELF_UPDATE_DENIED", "No puedes modificar tu propia cuenta aquí.");
    }

    const { data: updated, error: updateError } = await supabase
      .from("operator_profiles")
      .update({ role, status })
      .eq("id", operatorId)
      .select("id,email,role,status")
      .maybeSingle();
    if (updateError) {
      return fail(409, "OPERATOR_UPDATE_FAILED", "No se pudo actualizar; comprueba que quede un administrador activo.");
    }
    if (!updated) return fail(404, "OPERATOR_NOT_FOUND", "Operador no encontrado.");
    return respond(200, { ok: true, data: { operator: updated } });
  }

  return fail(400, "UNKNOWN_ACTION", "Acción no reconocida.");
});
