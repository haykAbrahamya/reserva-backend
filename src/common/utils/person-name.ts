/**
 * A specialist name as the salon wants it SHOWN. Salons that type names surname
 * first ("Aghajanyan Mari") have it shown given-name first ("Mari Aghajanyan"):
 * the first word moves to the end. One-word names are left alone.
 *
 * Mirrors `displayPersonName` in @reserva/shared (frontends) — keep the two in step.
 */
export function displayPersonName(name: string, surnameFirst?: boolean | null): string {
  const trimmed = name.trim();
  if (!surnameFirst) return trimmed;
  const parts = trimmed.split(/\s+/);
  return parts.length < 2 ? trimmed : [...parts.slice(1), parts[0]].join(' ');
}
