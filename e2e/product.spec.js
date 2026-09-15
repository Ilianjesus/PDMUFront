import fs from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import { expect, test } from "@playwright/test";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ELEMENT_ID = "22222222-2222-4222-8222-222222222222";
function readLocalEnv() {
  const values = { ...process.env };
  const envPath = new URL("../.env.local", import.meta.url);
  if (!fs.existsSync(envPath)) return values;

  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

const env = readLocalEnv();
const supabaseUrl = env.VITE_SUPABASE_URL;
const elementAssetsWorkflowUrl = env.VITE_N8N_ELEMENTS_ASSETS_URL;
if (!supabaseUrl || !elementAssetsWorkflowUrl) {
  throw new Error("Faltan variables públicas requeridas para las pruebas E2E.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const storageKey = `sb-${projectRef}-auth-token`;
const nowIso = new Date().toISOString();

const user = {
  id: ADMIN_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "admin@pdmu.test",
  email_confirmed_at: nowIso,
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { display_name: "Administración PDMU" },
  created_at: nowIso,
};

const session = {
  access_token: "e2e-access-token",
  refresh_token: "e2e-refresh-token",
  token_type: "bearer",
  expires_in: 86_400,
  expires_at: Math.floor(Date.now() / 1000) + 86_400,
  user,
};

const elementRow = {
  id: ELEMENT_ID,
  element_id: ELEMENT_ID,
  element_code: "PDMU-0001",
  given_names: "Aura Kristhell",
  paternal_surname: "Murillo",
  maternal_surname: "Flores",
  display_name: "Aura Kristhell Murillo Flores",
  birth_date: "2000-05-14",
  age_years: 26,
  sex_code: "F",
  group_code: "Femenil Mayor",
  group_label: "Femenil Mayor",
  guardian_name: "Aura Kristhell Murillo Flores",
  guardian_phone: "5512345678",
  is_self_tutor: true,
  enrolled_on: "2026-07-01",
  billing_start_on: "2026-07-01",
  billing_policy: "first_15_current_else_next",
  status: "active",
  created_at: nowIso,
};

function rpcPayload(functionName) {
  if (functionName === "get_dashboard_summary") {
    return {
      ok: true,
      resumenRapido: {
        elementosActivos: 5,
        pagosPendientes: 3,
        asistenciasHoy: 2,
      },
      alertasImportantes: [
        "3 mensualidades requieren seguimiento.",
        "2 expedientes tienen documentación pendiente.",
      ],
      actividadReciente: [],
    };
  }

  if (functionName === "search_elements") {
    return { ok: true, items: [elementRow], limit: 20, hasMore: false };
  }

  if (functionName === "create_element") {
    return {
      ok: true,
      element: {
        elementId: ELEMENT_ID,
        elementCode: "PDMU-20260815-E2E",
        enrollmentId: "33333333-3333-4333-8333-333333333333",
        enrollmentCode: "ENR-PDMU-20260815-E2E-001",
        reactivated: false,
        status: "active",
      },
    };
  }

  if (functionName === "complete_element_assets") {
    return {
      ok: true,
      elementId: ELEMENT_ID,
      driveFolder: { id: "drive-folder-e2e", url: "https://drive.test/folder" },
      qr: { value: `pdmu:element:${ELEMENT_ID}` },
      documents: [],
    };
  }

  if (functionName === "get_element") {
    return {
      ok: true,
      element: {
        elementId: ELEMENT_ID,
        elementCode: "PDMU-0001",
        givenNames: "Aura Kristhell",
        paternalSurname: "Murillo",
        maternalSurname: "Flores",
        birthDate: "2000-05-14",
        sexCode: "F",
        groupCode: "Femenil Mayor",
        medicalNotes: "Sin observaciones",
        guardianName: "Aura Kristhell Murillo Flores",
        guardianPhone: "5512345678",
        enrollmentId: "33333333-3333-4333-8333-333333333333",
        enrollmentCode: "INS-0001",
        enrolledOn: "2026-07-01",
        billingStartOn: "2026-07-01",
        billingPolicy: "first_15_current_else_next",
        status: "active",
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      documents: [],
      enrollments: [],
    };
  }

  if (functionName === "get_element_payment_statement") {
    return {
      ok: true,
      elementId: ELEMENT_ID,
      elementName: "Aura Kristhell Murillo Flores",
      year: 2026,
      enrolledOn: "2026-07-01",
      billingStartOn: "2026-07-01",
      summary: {
        paidCount: 0,
        pendingCount: 2,
        overdueCount: 1,
        futureCount: 3,
        totalDueCents: 40000,
        totalPaidCents: 0,
      },
      months: [
        {
          year: 2026,
          month: 7,
          status: "overdue",
          amount: { value: 20000, currency: "MXN" },
        },
        {
          year: 2026,
          month: 8,
          status: "pending",
          amount: { value: 20000, currency: "MXN" },
        },
        {
          year: 2026,
          month: 9,
          status: "future",
          amount: { value: 20000, currency: "MXN" },
        },
      ],
    };
  }

  if (functionName === "get_element_attendance_statement") {
    return {
      ok: true,
      elementId: ELEMENT_ID,
      elementName: "Aura Kristhell Murillo Flores",
      summary: {
        requiredSessions: 4,
        presentCount: 3,
        lateCount: 0,
        excusedCount: 0,
        absentCount: 1,
        exemptCount: 0,
        activityRecords: 0,
      },
      sessions: [],
      records: [],
      exceptions: [],
    };
  }

  if (functionName === "get_operational_statistics") {
    return {
      ok: true,
      period: { from: "2026-08-01", to: "2026-08-12" },
      filters: {},
      summary: {
        activeElements: 5,
        newEnrollments: 1,
        pendingPayments: 3,
        pendingAmountCents: 60000,
        attendanceRegistered: 12,
        requiredAbsences: 1,
      },
      attendanceAttention: [],
      paymentAttention: [],
      monthlyTrend: [],
    };
  }

  return { ok: true, items: [] };
}

async function mockSupabase(
  page,
  { otpStatus = 200, otpErrorCode = "hook_timeout" } = {}
) {
  let queuedAssetJob = null;
  const stagedFiles = new Map();
  let elementDocuments = [
    {
      id: "55555555-5555-4555-8555-555555555555",
      document_type: "guardian_id",
      drive_file_id: "drive-file-ine-e2e",
      drive_url: "https://drive.test/ine.pdf",
      original_filename: "ine-tutor.pdf",
      mime_type: "application/pdf",
      size_bytes: 2048,
      status: "active",
      version: 1,
      uploaded_at: nowIso,
    },
  ];

  await page.route(`${supabaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/auth/v1/otp") {
      await route.fulfill({
        status: otpStatus,
        json:
          otpStatus === 200
            ? {}
            : {
                code: otpStatus,
                error_code: otpErrorCode,
                msg: "Send Email Hook failed",
              },
      });
      return;
    }
    if (url.pathname === "/auth/v1/user") {
      await route.fulfill({ status: 200, json: user });
      return;
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const functionName = url.pathname.split("/").pop();

      if (functionName === "queue_element_assets") {
        const body = request.postDataJSON();
        queuedAssetJob = {
          requestId: body.p_request_id,
          elementId: body.p_element_id,
          elementCode: "PDMU-20260815-E2E",
          folderName: "MURILLO FLORES AURA KRISTHELL",
          documents: body.p_documents,
          attempts: 0,
        };
        await route.fulfill({
          status: 200,
          json: { ok: true, job: { ...queuedAssetJob, status: "queued" } },
        });
        return;
      }

      if (functionName === "claim_next_element_asset_job") {
        const job = queuedAssetJob;
        queuedAssetJob = null;
        await route.fulfill({
          status: 200,
          json: { ok: true, job: job ? { ...job, attempts: 1 } : null },
        });
        return;
      }

      if (functionName === "fail_element_asset_job") {
        await route.fulfill({
          status: 200,
          json: { ok: true, job: { status: "failed" } },
        });
        return;
      }

      await route.fulfill({ status: 200, json: rpcPayload(functionName) });
      return;
    }
    if (url.pathname.startsWith("/storage/v1/object/element-intake/")) {
      const path = decodeURIComponent(
        url.pathname.replace("/storage/v1/object/element-intake/", "")
      );
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          body: stagedFiles.get(path) || Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          headers: { "Content-Type": "image/jpeg" },
        });
      } else {
        stagedFiles.set(path, request.postDataBuffer() || Buffer.from([]));
        await route.fulfill({ status: 200, json: { Key: path } });
      }
      return;
    }
    if (url.pathname.startsWith("/storage/v1/object/authenticated/element-intake/")) {
      const path = decodeURIComponent(
        url.pathname.replace("/storage/v1/object/authenticated/element-intake/", "")
      );
      await route.fulfill({
        status: 200,
        body: stagedFiles.get(path) || Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        headers: { "Content-Type": "image/jpeg" },
      });
      return;
    }
    if (url.pathname === "/storage/v1/object/element-intake") {
      await route.fulfill({ status: 200, json: [] });
      return;
    }
    if (url.pathname === "/rest/v1/operator_profiles") {
      await route.fulfill({
        status: 200,
        json: {
          id: ADMIN_ID,
          email: "admin@pdmu.test",
          display_name: "Administración PDMU",
          role: "admin",
          status: "active",
          created_at: nowIso,
          updated_at: nowIso,
        },
      });
      return;
    }
    if (url.pathname === "/rest/v1/element_documents") {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        if (body.status === "cancelled") elementDocuments = [];
        await route.fulfill({ status: 200, json: [] });
      } else {
        await route.fulfill({ status: 200, json: elementDocuments });
      }
      return;
    }
    if (url.pathname === "/rest/v1/elements") {
      const select = url.searchParams.get("select") || "";
      await route.fulfill({
        status: 200,
        json: select === "is_self_tutor" ? { is_self_tutor: true } : [elementRow],
      });
      return;
    }

    await route.fulfill({ status: 200, json: [] });
  });
}

async function seedAuthenticatedSession(page) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: session }
  );
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("acceso OTP", () => {
  test("solicita código sin exponer acceso por contraseña", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("#/login");

    await expect(page.getByRole("heading", { name: "PDMU Digital" })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const email = page.getByLabel("Correo electrónico");
    await email.fill("operador@pdmu.test");
    await page.getByRole("button", { name: "Enviar código" }).click();

    await expect(
      page.getByRole("heading", { name: "Verificación por código" })
    ).toBeVisible();
    const otp = page.getByLabel("Código de acceso");
    expect(parseFloat(await otp.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    await assertNoHorizontalOverflow(page);
  });

  test("no avanza cuando Supabase no pudo entregar el OTP", async ({ page }) => {
    await mockSupabase(page, { otpStatus: 500 });
    await page.goto("#/login");

    await page.getByLabel("Correo electrónico").fill("operador@pdmu.test");
    await page.getByRole("button", { name: "Enviar código" }).click();

    await expect(page.getByText("No se pudo solicitar el código.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ingresar correo" })).toBeVisible();
    await expect(page.getByLabel("Código de acceso")).toHaveCount(0);
  });

  test("explica cuando Supabase limita nuevas solicitudes OTP", async ({ page }) => {
    await mockSupabase(page, {
      otpStatus: 429,
      otpErrorCode: "over_email_send_rate_limit",
    });
    await page.goto("#/login");

    await page.getByLabel("Correo electrónico").fill("operador@pdmu.test");
    await page.getByRole("button", { name: "Enviar código" }).click();

    await expect(
      page.getByText(
        "Se solicitaron varios códigos. Espera unos minutos antes de intentar nuevamente."
      )
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ingresar correo" })).toBeVisible();
  });
});

test.describe("producto autenticado", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await seedAuthenticatedSession(page);
  });

  test("mantiene el inicio legible y el encabezado fijo", async ({ page }, testInfo) => {
    await page.goto("#/inicio");
    await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
    await expect(page.getByText("Elementos activos")).toBeVisible();
    await expect(page.getByText("5", { exact: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const headerTop = await page.locator(".page-header").evaluate((node) =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(headerTop).toBe(0);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
  });

  test("separa filtros y directorio, y abre el expediente desde arriba", async ({ page }, testInfo) => {
    await page.goto("#/elementos");
    await expect(
      page.getByRole("heading", { name: "Elementos", exact: true })
    ).toBeVisible();
    const listSurface = page.locator(".panel-list-surface");
    const beforeSearch = await listSurface.boundingBox();

    await expect(page.getByRole("region", { name: "Filtros de elementos" })).toBeHidden();
    await page.getByRole("button", { name: "Abrir filtros" }).click();
    const filters = page.getByRole("region", { name: "Filtros de elementos" });
    await expect(filters).toBeVisible();
    await filters.getByRole("button", { name: "Varonil" }).click();
    await filters.getByRole("button", { name: "Mayor" }).click();
    await expect(
      page.getByRole("button", { name: "Filtros activos: Varonil · Mayor" })
    ).toBeVisible();
    const withFiltersOpen = await listSurface.boundingBox();
    expect(Math.round(withFiltersOpen.y)).toBe(Math.round(beforeSearch.y));
    await page.screenshot({ path: testInfo.outputPath("elements-filters.png"), fullPage: false });
    await filters.getByRole("button", { name: "Restablecer" }).click();
    await filters.getByRole("button", { name: "Cerrar filtros" }).click();
    await expect(page.getByRole("button", { name: "Abrir filtros" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("elements-directory.png"), fullPage: false });

    const search = page.getByRole("textbox", { name: "Buscar elemento" });
    await search.fill("Aura");
    await expect(page.locator(".buscador-lista")).toBeVisible();
    const afterSearch = await listSurface.boundingBox();
    expect(Math.round(afterSearch.y)).toBe(Math.round(beforeSearch.y));
    await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
    await expect(search).toHaveValue("");

    await page.getByRole("button", { name: /Aura Kristhell Murillo Flores/ }).last().click();
    await expect(page.getByRole("heading", { name: "Elemento", exact: true })).toBeVisible();
    await expect(page.locator(".page-header")).toContainText("Aura Kristhell Murillo Flores");
    await expect(page.locator('input[name="Sexo"]')).toHaveValue("Femenino");
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(3);

    await page.getByRole("button", { name: /Pagos/ }).click();
    await expect(page.getByRole("heading", { name: "Estado de cuenta" })).toBeVisible();
    await page.getByRole("button", { name: "+ Pago" }).first().click();
    const paymentDialog = page.getByRole("dialog", { name: /Julio 2026/ });
    await expect(paymentDialog).toBeVisible();
    await expect(paymentDialog).toContainText("$200.00");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("payment-sheet.png"), fullPage: false });
  });

  test("presenta navegación adecuada para cada tamaño", async ({ page, isMobile }) => {
    await page.goto("#/inicio");
    if (isMobile) {
      await expect(page.locator(".mobile-nav")).toBeVisible();
      await expect(page.locator(".app-sidebar")).toBeHidden();
    } else {
      await expect(page.locator(".app-sidebar")).toBeVisible();
      await expect(page.locator(".mobile-nav")).toBeHidden();
      await expect(page.getByRole("link", { name: "Operadores" })).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
  });

  test("abre el selector de asistencia como modal completo y centrado", async ({ page }, testInfo) => {
    await page.goto("#/asistencia");
    await expect(page.getByRole("heading", { name: "Asistencia", exact: true })).toBeVisible();
    await expect(page.getByText("Control de asistencia", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Nueva sesión" }).click();
    const dialog = page.getByRole("dialog", { name: "Tipo de asistencia" });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box.y).toBeGreaterThan(8);
    expect(box.y + box.height).toBeLessThan(viewport.height - 8);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(50);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("attendance-modal.png"), fullPage: false });
  });

  test("permite fotografiar y eliminar documentos del expediente", async ({ page }, testInfo) => {
    let deletePayload = null;
    let uploadedPhoto = false;
    await page.route(elementAssetsWorkflowUrl, async (route) => {
      const request = route.request();
      if (request.headers()["content-type"]?.includes("application/json")) {
        deletePayload = request.postDataJSON();
      } else {
        uploadedPhoto = request.postData()?.includes("proof_of_address") ?? false;
      }
      await route.fulfill({
        status: 200,
        json: {
          ok: true,
          requestId: "66666666-6666-4666-8666-666666666666",
          data: {
            driveFolder: { id: "drive-folder-e2e", url: "https://drive.test/folder" },
            qr: { value: `pdmu:element:${ELEMENT_ID}` },
            documents: [],
          },
        },
      });
    });

    await page.goto("#/elementos");
    await page.getByRole("button", { name: /Aura Kristhell Murillo Flores/ }).last().click();
    await page.getByRole("button", { name: "Editar Nombre(s)" }).click();
    await page.screenshot({ path: testInfo.outputPath("element-edit-actions.png"), fullPage: false });
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("button", { name: "Eliminar INE del tutor" })).toBeVisible();
    await page.getByRole("button", { name: "Eliminar INE del tutor" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("element-documents.png"), fullPage: false });
    await page.getByRole("button", { name: "Eliminar INE del tutor" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Eliminar documento" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByText("Documento eliminado correctamente.")).toBeVisible();
    expect(deletePayload).toMatchObject({
      action: "element.document.delete",
      elementId: ELEMENT_ID,
      fileId: "drive-file-ine-e2e",
    });

    const addressCard = page.locator(".document-group").filter({
      has: page.getByText("Comprobante de domicilio", { exact: true }),
    });
    const cameraInput = addressCard.locator('input[capture="environment"]');
    await expect(cameraInput).toHaveAttribute("accept", "image/*");
    await cameraInput.setInputFiles({
      name: "domicilio.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    await addressCard.getByRole("button", { name: "Procesar" }).click();
    await expect(page.getByText(/Foto recibida/)).toBeVisible();
    await expect.poll(() => uploadedPhoto).toBe(true);
    await assertNoHorizontalOverflow(page);
  });

  test("completa la inscripción móvil con decisiones simples y cámara primaria", async ({ page }, testInfo) => {
    let workflowRequest = null;
    let workflowCompleted = false;
    let releaseWorkflow;
    const workflowGate = new Promise((resolve) => {
      releaseWorkflow = resolve;
    });
    await page.route(elementAssetsWorkflowUrl, async (route) => {
      workflowRequest = route.request();
      await workflowGate;
      await route.fulfill({
        status: 200,
        json: {
          ok: true,
          requestId: "44444444-4444-4444-8444-444444444444",
          data: {
            driveFolder: {
              id: "drive-folder-e2e",
              url: "https://drive.test/folder",
            },
            qr: { status: "ready", value: `pdmu:element:${ELEMENT_ID}` },
            documents: [
              {
                type: "birth_certificate",
                fileId: "drive-file-e2e",
                url: "https://drive.test/file",
                originalFilename: "acta.jpg",
                fileName: "PDMU-20260815-E2E-birth_certificate.pdf",
                mimeType: "application/pdf",
                sizeBytes: 4,
              },
            ],
          },
        },
      });
      workflowCompleted = true;
    });

    await page.goto("#/elementos/nuevo");
    await expect(page.getByRole("heading", { name: "Nueva inscripción" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Femenino" })).toBeVisible();
    await expect(page.locator('select[name="sexo"]')).toHaveCount(0);

    await page.getByLabel("Nombre(s)").fill("Aura Kristhell");
    await page.getByLabel("Apellido paterno").fill("Murillo");
    await page.getByLabel("Apellido materno").fill("Flores");
    await page.getByRole("radio", { name: "Femenino" }).check();
    await page.getByLabel("Año").selectOption("2000");
    await page.getByLabel("Mes").selectOption("05");
    await page.getByLabel("Día").selectOption("14");
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(3);

    await page.getByRole("button", { name: /El elemento/ }).click();
    await page.getByLabel("Teléfono de contacto (10 dígitos)").fill("5512345678");
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(3);

    const cameraInput = page.locator('input[capture="environment"]').first();
    await expect(cameraInput).toHaveAttribute("accept", "image/*");
    await expect(page.getByRole("button", { name: "Fotografiar Acta de nacimiento" })).toBeVisible();
    await cameraInput.setInputFiles({
      name: "acta.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    const birthCertificate = page.locator(".document-capture").first();
    await expect(
      birthCertificate.getByRole("button", { name: "Repetir foto de Acta de nacimiento" })
    ).toBeVisible();
    await expect(
      birthCertificate.getByRole("button", { name: "Quitar Acta de nacimiento" })
    ).toBeVisible();
    await expect(birthCertificate.getByText("Archivo", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("registration-documents.png"),
      fullPage: false,
    });
    await page.getByRole("button", { name: "Revisar inscripción" }).click();
    await expect(page.getByRole("heading", { name: "Revisar y confirmar" })).toBeVisible();
    await page.getByRole("button", { name: "Crear expediente" }).click();

    await expect(page.getByLabel("Aura Kristhell Murillo Flores")).toContainText(
      "Inscripción guardada"
    );
    await expect(page.locator(".loading-overlay")).toHaveCount(0);
    await expect.poll(() => workflowRequest !== null).toBe(true);
    expect(workflowRequest.headers()["content-type"]).toContain("multipart/form-data");
    expect(workflowRequest.postData()).toContain("MURILLO FLORES AURA KRISTHELL");
    releaseWorkflow();
    await expect.poll(() => workflowCompleted).toBe(true);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("registration.png"), fullPage: false });
  });
});
