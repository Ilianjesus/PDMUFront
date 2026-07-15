export function calculateAge(birthDateValue, referenceDate = new Date()) {
  if (!birthDateValue) return null;

  const [year, month, day] = String(birthDateValue).split("-").map(Number);
  if (!year || !month || !day) return null;

  const birthDate = new Date(year, month - 1, day);
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day ||
    birthDate > referenceDate
  ) {
    return null;
  }

  let age = referenceDate.getFullYear() - year;
  const hasBirthdayPassed =
    referenceDate.getMonth() > birthDate.getMonth() ||
    (referenceDate.getMonth() === birthDate.getMonth() &&
      referenceDate.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) age -= 1;
  return age;
}

function normalizeSexGroup(sex) {
  const normalized = String(sex ?? "").trim().toLowerCase();
  if (["f", "femenino", "femenil", "femeni"].includes(normalized)) return "Femenil";
  if (["m", "masculino", "varonil"].includes(normalized)) return "Varonil";
  return "";
}

function getAgeCategory(age) {
  if (!Number.isInteger(age) || age < 0) return "";
  if (age <= 12) return "Menor";
  if (age < 16) return "Juvenil";
  return "Mayor";
}

export function formatElementGroupLabel(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";

  const parts = normalized.replace(/[_-]+/g, " ").toLowerCase().split(/\s+/);
  const sex = parts.some((part) => ["f", "femenil", "femenino", "femeni"].includes(part))
    ? "Femenil"
    : parts.some((part) => ["m", "varonil", "masculino"].includes(part))
      ? "Varonil"
      : "";
  const category = parts.includes("menor")
    ? "Menor"
    : parts.includes("juvenil")
      ? "Juvenil"
      : parts.includes("mayor")
        ? "Mayor"
        : "";

  return sex && category ? `${sex} ${category}` : normalized;
}

export function getElementGroup({ birthDate, sex, referenceDate = new Date() } = {}) {
  const sexGroup = normalizeSexGroup(sex);
  const age = calculateAge(birthDate, referenceDate);
  const category = getAgeCategory(age);

  if (!sexGroup || !category) return null;

  return {
    label: `${sexGroup} ${category}`,
    sexGroup,
    category,
    age,
  };
}
