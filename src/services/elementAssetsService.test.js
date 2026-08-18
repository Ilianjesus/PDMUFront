import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "./auth/supabaseClient";
import { provisionElementAssets } from "./elementAssetsService";

vi.mock("./auth/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

describe("provisionElementAssets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    });
  });

  it("envía la inscripción y los documentos como multipart al webhook configurado", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          requestId: "request-1",
          data: {
            driveFolder: { status: "ready" },
            qr: { status: "ready" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await provisionElementAssets({
      elementId: "element-1",
      elementCode: "PDMU-1",
      elementData: {
        nombre: "Ilian Jesús",
        apellidoPaterno: "Orduña",
        apellidoMaterno: "Herrera",
      },
      files: {
        actaNacimiento: new File(["foto"], "acta.jpg", { type: "image/jpeg" }),
      },
      requestId: "request-1",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\//),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
          "Idempotency-Key": "request-1",
        }),
      })
    );

    const request = fetchMock.mock.calls[0][1];
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.body.get("contractVersion")).toBe("3.0");
    expect(request.body.get("action")).toBe("element.registration.assets");
    expect(request.body.get("folderName")).toBe("ORDUÑA HERRERA ILIAN JESÚS");
    expect(JSON.parse(request.body.get("documents"))).toEqual([
      expect.objectContaining({
        type: "birth_certificate",
        fieldName: "document_birth_certificate",
        originalFilename: "acta.jpg",
        sourceMimeType: "image/jpeg",
      }),
    ]);
    expect(request.body.get("document_birth_certificate")).toBeInstanceOf(File);
  });

  it("mantiene el alta utilizable si la automatización no responde", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));

    const result = await provisionElementAssets({
      elementId: "element-1",
      requestId: "request-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: "WORKFLOW_UNAVAILABLE",
        message: "La carpeta y los documentos quedaron pendientes.",
      })
    );
  });
});
