export const SYSTEM_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/;

export function isStrongSystemPassword(password: string) {
  return SYSTEM_PASSWORD_REGEX.test(String(password || ""));
}

