import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "./auth/supabaseClient";
import {
  provisionElementAssets,
  queueElementAssetJob,
  removeElementDocumentAsset,
  stageElementDocuments,
} from "./elementAssetsService";

vi.mock("./auth/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    rpc: vi.fn(),
    storage: {
      from: vi.fn(),
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
    supabase.storage.from.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      remove: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });
    supabase.rpc.mockResolvedValue({ data: { ok: true, job: {} }, error: null });
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

  it("persiste las capturas antes de encolar el procesamiento", async () => {
    const storage = {
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      remove: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };
    supabase.storage.from.mockReturnValue(storage);

    const staged = await stageElementDocuments({
      elementId: "element-1",
      requestId: "request-1",
      files: {
        actaNacimiento: new File(["foto"], "acta.jpg", { type: "image/jpeg" }),
      },
    });

    expect(staged.ok).toBe(true);
    expect(storage.upload).toHaveBeenCalledWith(
      "element-1/request-1/birth_certificate-acta.jpg",
      expect.any(File),
      expect.objectContaining({ contentType: "image/jpeg", upsert: true })
    );
    expect(staged.documents).toEqual([
      expect.objectContaining({
        type: "birth_certificate",
        storagePath: "element-1/request-1/birth_certificate-acta.jpg",
      }),
    ]);
  });

  it("encola el trabajo con el mismo request id idempotente", async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        ok: true,
        job: { requestId: "request-1", status: "queued" },
      },
      error: null,
    });

    const result = await queueElementAssetJob({
      requestId: "request-1",
      elementId: "element-1",
      documents: [],
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("queue_element_assets", {
      p_request_id: "request-1",
      p_element_id: "element-1",
      p_documents: [],
    });
  });

  it("solicita a n8n la eliminación idempotente de un documento en Drive", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, requestId: "request-delete" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await removeElementDocumentAsset({
      elementId: "element-1",
      requestId: "request-delete",
      document: {
        documentId: "document-1",
        driveFileId: "drive-file-1",
      },
    });

    expect(result.ok).toBe(true);
    const [, request] = fetchMock.mock.calls[0];
    expect(request.headers).toMatchObject({
      Authorization: "Bearer session-token",
      "Idempotency-Key": "request-delete",
    });
    expect(JSON.parse(request.body)).toMatchObject({
      action: "element.document.delete",
      documentId: "document-1",
      fileId: "drive-file-1",
    });
  });

  it("elimina directamente los documentos heredados de Storage", async () => {
    const remove = vi.fn().mockResolvedValue({ data: {}, error: null });
    supabase.storage.from.mockReturnValue({ remove });

    const result = await removeElementDocumentAsset({
      elementId: "element-1",
      requestId: "request-delete",
      document: {
        documentId: "document-1",
        storageObjectPath: "element-1/curp/document.pdf",
      },
    });

    expect(result.ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(["element-1/curp/document.pdf"]);
  });
});
