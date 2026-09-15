import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Home } from "./Home";
import { getDashboardSummary } from "../services/dashboardService";

vi.mock("../services/dashboardService", () => ({ getDashboardSummary: vi.fn() }));
vi.mock("../components/ui/PageHeader", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  );
}

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("permite reintentar un fallo recuperable con sesión real", async () => {
    getDashboardSummary
      .mockResolvedValueOnce({ ok: false, message: "Error temporal" })
      .mockResolvedValueOnce({
        ok: true,
        data: { resumenRapido: { elementosActivos: 5 } },
      });

    renderHome();

    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.queryByText("Error temporal")).not.toBeInTheDocument();
  });
});
