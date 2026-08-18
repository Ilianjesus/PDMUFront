import { describe, expect, it } from "vitest";
import {
  calculateAge,
  formatElementGroupLabel,
  getElementGroup,
} from "./elementGroups";

describe("elementGroups", () => {
  const referenceDate = new Date(2026, 7, 12);

  it("calcula la edad respetando si ya ocurrió el cumpleaños", () => {
    expect(calculateAge("2010-08-12", referenceDate)).toBe(16);
    expect(calculateAge("2010-08-13", referenceDate)).toBe(15);
  });

  it("rechaza fechas inexistentes o futuras", () => {
    expect(calculateAge("2026-02-30", referenceDate)).toBeNull();
    expect(calculateAge("2027-01-01", referenceDate)).toBeNull();
  });

  it("deriva rama y categoría en una sola etiqueta", () => {
    expect(
      getElementGroup({
        birthDate: "2010-08-12",
        sex: "F",
        referenceDate,
      })
    ).toEqual({
      label: "Femenil Mayor",
      sexGroup: "Femenil",
      category: "Mayor",
      age: 16,
    });
    expect(formatElementGroupLabel("varonil_juvenil")).toBe(
      "Varonil Juvenil"
    );
  });
});
