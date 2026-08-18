import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BirthDateSelector } from "./BirthDateSelector";

describe("BirthDateSelector", () => {
  it("construye la fecha únicamente cuando están las tres partes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BirthDateSelector value="" onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Año"), "2002");
    await user.selectOptions(screen.getByLabelText("Mes"), "10");
    await user.selectOptions(screen.getByLabelText("Día"), "28");

    expect(onChange).toHaveBeenLastCalledWith("2002-10-28");
  });

  it("ajusta un día inválido al cambiar de mes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <BirthDateSelector value="2000-01-31" onChange={onChange} />
    );

    await user.selectOptions(screen.getByLabelText("Mes"), "02");
    expect(onChange).toHaveBeenLastCalledWith("2000-02-29");
  });
});
