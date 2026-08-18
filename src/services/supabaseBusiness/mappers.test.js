import { describe, expect, it } from "vitest";
import {
  mapCreateElementInput,
  mapElementDetails,
  mapPaymentStatementResponse,
} from "./mappers";

describe("supabase business mappers", () => {
  it("normaliza una inscripción al contrato de la RPC", () => {
    const result = mapCreateElementInput({
      nombre: "  Ana María ",
      apellidoPaterno: " López ",
      fechaNacimiento: "2010-01-15",
      sexo: "Femenino",
      tutor: "Laura López",
      telefonoTutor: "5512345678",
      fechaInscripcion: "2026-08-12",
    });

    expect(result).toMatchObject({
      p_given_names: "Ana María",
      p_paternal_surname: "López",
      p_birth_date: "2010-01-15",
      p_sex_code: "F",
      p_group_code: "Femenil Mayor",
      p_guardian_name: "Laura López",
      p_guardian_phone: "5512345678",
    });
  });

  it("proyecta el expediente y sus documentos", () => {
    const result = mapElementDetails({
      element: {
        elementId: "element-1",
        givenNames: "Ana",
        paternalSurname: "López",
        birthDate: "2010-01-15",
        sexCode: "F",
        guardianName: "Laura López",
        guardianPhone: "5512345678",
      },
      documents: [
        {
          type: "curp",
          downloadUrl: "https://example.test/curp.pdf",
        },
      ],
    });

    expect(result.displayName).toBe("Ana López");
    expect(result.Grupo).toBe("Femenil Mayor");
    expect(result.curp).toBe("https://example.test/curp.pdf");
  });

  it("convierte centavos y estados del estado de cuenta", () => {
    const result = mapPaymentStatementResponse({
      elementId: "element-1",
      elementName: "Ana López",
      year: 2026,
      summary: { totalDueCents: 20000, overdueCount: 1 },
      months: [
        {
          year: 2026,
          month: 8,
          status: "overdue",
          amount: { value: 20000, currency: "MXN" },
        },
      ],
    });

    expect(result.summary.totalDue).toBe(200);
    expect(result.months[0]).toMatchObject({
      Mes: "Agosto",
      statusLabel: "Vencida",
      amount: 200,
      isPayable: true,
    });
  });
});
