import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("se monta como diálogo modal y confirma la acción", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Confirmar cambios"
        message="¿Deseas guardar?"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cierra con Escape y restaura el scroll", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Confirmar"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    rerender(
      <ConfirmDialog
        open={false}
        title="Confirmar"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    expect(document.body.style.overflow).toBe("");
  });
});
