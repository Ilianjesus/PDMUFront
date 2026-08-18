import { useEffect, useState } from "react";

const MONTH_OPTIONS = [
  { value: "01", label: "Enero" },
  { value: "02", label: "Febrero" },
  { value: "03", label: "Marzo" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Mayo" },
  { value: "06", label: "Junio" },
  { value: "07", label: "Julio" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" },
];

function getDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return { year: "", month: "", day: "" };
  return { year: match[1], month: match[2], day: match[3] };
}

function getDaysInMonth(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!numericYear || !numericMonth) return 31;
  return new Date(numericYear, numericMonth, 0).getDate();
}

function normalizeBirthDateParts(parts) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  const next = { ...parts };

  if (Number(next.year) === currentYear && Number(next.month) > currentMonth) {
    next.month = String(currentMonth).padStart(2, "0");
  }

  const daysInMonth = getDaysInMonth(next.year, next.month);
  const maxDay =
    Number(next.year) === currentYear && Number(next.month) === currentMonth
      ? Math.min(daysInMonth, currentDay)
      : daysInMonth;

  if (Number(next.day) > maxDay) {
    next.day = String(maxDay).padStart(2, "0");
  }

  return next;
}

function buildDateValue(parts) {
  const { year, month, day } = normalizeBirthDateParts(parts);
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

function getBirthYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear; year >= currentYear - 80; year -= 1) {
    years.push(String(year));
  }
  return years;
}

export function BirthDateSelector({ value, onChange, disabled = false }) {
  const [draftParts, setDraftParts] = useState(() => getDateParts(value));
  const parts = normalizeBirthDateParts(draftParts);
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  const daysInMonth = getDaysInMonth(parts.year, parts.month);
  const maxDay =
    Number(parts.year) === currentYear && Number(parts.month) === currentMonth
      ? Math.min(daysInMonth, currentDay)
      : daysInMonth;
  const birthYears = getBirthYearOptions();

  useEffect(() => {
    setDraftParts(getDateParts(value));
  }, [value]);

  const handlePartChange = (part, nextValue) => {
    const nextParts = normalizeBirthDateParts({
      ...parts,
      [part]: nextValue,
    });

    setDraftParts(nextParts);
    onChange(buildDateValue(nextParts));
  };

  return (
    <fieldset className="birth-date-selector" disabled={disabled}>
      <legend>Fecha de nacimiento</legend>
      <div className="birth-date-selector__grid">
        <label>
          Día
          <select
            value={parts.day}
            onChange={(event) => handlePartChange("day", event.target.value)}
            required
          >
            <option value="">Día</option>
            {Array.from({ length: maxDay }, (_, index) => {
              const day = String(index + 1).padStart(2, "0");
              return (
                <option key={day} value={day}>
                  {index + 1}
                </option>
              );
            })}
          </select>
        </label>

        <label>
          Mes
          <select
            value={parts.month}
            onChange={(event) => handlePartChange("month", event.target.value)}
            required
          >
            <option value="">Mes</option>
            {MONTH_OPTIONS.map((month) => (
              <option
                key={month.value}
                value={month.value}
                disabled={
                  Number(parts.year) === currentYear &&
                  Number(month.value) > currentMonth
                }
              >
                {month.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Año
          <select
            value={parts.year}
            onChange={(event) => handlePartChange("year", event.target.value)}
            required
          >
            <option value="">Año</option>
            {birthYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
